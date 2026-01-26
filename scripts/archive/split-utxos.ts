#!/usr/bin/env npx tsx
/**
 * UTXO Splitter for zkUSD Deployment
 *
 * Splits a large UTXO into multiple smaller ones for contract deployment.
 * Each contract deployment needs its own funding UTXO to avoid prover cache conflicts.
 *
 * Usage:
 *   npx tsx scripts/split-utxos.ts [--broadcast]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { fileURLToPath } from 'url';

// Initialize ECC library
bitcoin.initEccLib(ecc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const WALLET_PATH = path.join(ROOT_DIR, 'deployments/testnet4/wallet.json');
const MEMPOOL_API = 'https://mempool.space/testnet4/api';

// Testnet4 network
const TESTNET4: bitcoin.Network = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'tb',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

interface WalletConfig {
  address: string;
  public_key: string;
  private_key_hex: string;
}

interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const response = await fetch(`${MEMPOOL_API}/address/${address}/utxo`);
  if (!response.ok) throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
  return response.json() as Promise<Utxo[]>;
}

async function fetchRawTx(txid: string): Promise<string> {
  const response = await fetch(`${MEMPOOL_API}/tx/${txid}/hex`);
  if (!response.ok) throw new Error(`Failed to fetch tx: ${response.statusText}`);
  return response.text();
}

async function broadcastTx(txHex: string): Promise<string> {
  const response = await fetch(`${MEMPOOL_API}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Broadcast failed: ${error}`);
  }
  return response.text();
}

async function main() {
  const args = process.argv.slice(2);
  const shouldBroadcast = args.includes('--broadcast');

  log('UTXO Splitter for zkUSD Deployment');
  log(`Mode: ${shouldBroadcast ? 'BROADCAST' : 'DRY RUN'}`);

  // Load wallet
  const wallet: WalletConfig = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  log(`Wallet: ${wallet.address}`);

  // Fetch UTXOs
  const allUtxos = await fetchUtxos(wallet.address);
  const utxos = allUtxos
    .filter(u => u.status.confirmed && u.value >= 50000)
    .sort((a, b) => b.value - a.value);

  if (utxos.length === 0) {
    throw new Error('No UTXOs with >= 50000 sats found');
  }

  // Use the largest UTXO
  const inputUtxo = utxos[0];
  log(`\nInput UTXO: ${inputUtxo.txid}:${inputUtxo.vout} (${inputUtxo.value} sats)`);

  // Fetch the raw transaction for the input
  const rawTx = await fetchRawTx(inputUtxo.txid);
  const prevTx = bitcoin.Transaction.fromHex(rawTx);

  // Calculate outputs:
  // - 3 outputs of 50000 sats each for contract deployment funding
  // - 3 outputs of 547 sats each for contract genesis UTXOs
  // - 1 change output
  const FUNDING_AMOUNT = 50000;
  const DUST_AMOUNT = 547;
  const FEE_RATE = 5; // sats/vbyte

  // Estimate tx size: ~10 + 68*inputs + 31*outputs bytes for P2WPKH
  const estimatedSize = 10 + 68 * 1 + 31 * 7; // 1 input, 7 outputs
  const fee = Math.ceil(estimatedSize * FEE_RATE);

  const totalOutputs = (FUNDING_AMOUNT * 3) + (DUST_AMOUNT * 3);
  const change = inputUtxo.value - totalOutputs - fee;

  if (change < DUST_AMOUNT) {
    throw new Error(`Insufficient funds. Need ${totalOutputs + fee + DUST_AMOUNT} sats, have ${inputUtxo.value}`);
  }

  log(`\nOutput plan:`);
  log(`  3x ${FUNDING_AMOUNT} sats (funding) = ${FUNDING_AMOUNT * 3} sats`);
  log(`  3x ${DUST_AMOUNT} sats (genesis) = ${DUST_AMOUNT * 3} sats`);
  log(`  1x ${change} sats (change)`);
  log(`  Fee: ${fee} sats (${FEE_RATE} sat/vB)`);
  log(`  Total: ${totalOutputs + fee + change} sats`);

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  // Add input
  psbt.addInput({
    hash: inputUtxo.txid,
    index: inputUtxo.vout,
    witnessUtxo: {
      script: prevTx.outs[inputUtxo.vout].script,
      value: BigInt(inputUtxo.value),
    },
  });

  // Get output script for our address
  const outputScript = bitcoin.address.toOutputScript(wallet.address, TESTNET4);

  // Add outputs: 3 funding UTXOs
  for (let i = 0; i < 3; i++) {
    psbt.addOutput({
      script: outputScript,
      value: BigInt(FUNDING_AMOUNT),
    });
  }

  // Add outputs: 3 genesis UTXOs (dust)
  for (let i = 0; i < 3; i++) {
    psbt.addOutput({
      script: outputScript,
      value: BigInt(DUST_AMOUNT),
    });
  }

  // Add change output
  psbt.addOutput({
    script: outputScript,
    value: BigInt(change),
  });

  // Sign
  const privateKey = Buffer.from(wallet.private_key_hex, 'hex');
  const keyPair = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    privateKey,
    sign: (hash: Buffer): Buffer => {
      const sig = ecc.sign(hash, privateKey);
      return Buffer.from(sig);
    },
  };

  psbt.signInput(0, keyPair);
  psbt.finalizeAllInputs();

  const signedTx = psbt.extractTransaction();
  const txHex = signedTx.toHex();
  const txId = signedTx.getId();

  log(`\nSigned transaction:`);
  log(`  TXID: ${txId}`);
  log(`  Size: ${txHex.length / 2} bytes`);
  log(`  Hex: ${txHex.slice(0, 64)}...`);

  // Save transaction
  fs.writeFileSync('/tmp/zkusd-split-utxos.hex', txHex);
  log(`\nTransaction saved to /tmp/zkusd-split-utxos.hex`);

  if (shouldBroadcast) {
    log('\nBroadcasting transaction...');
    const broadcastTxId = await broadcastTx(txHex);
    log(`✓ Broadcast successful!`);
    log(`  TXID: ${broadcastTxId}`);
    log(`  Explorer: https://mempool.space/testnet4/tx/${broadcastTxId}`);
    log(`\nNew UTXOs (available after 1 confirmation):`);
    for (let i = 0; i < 3; i++) {
      log(`  Funding ${i+1}: ${txId}:${i} (${FUNDING_AMOUNT} sats)`);
    }
    for (let i = 0; i < 3; i++) {
      log(`  Genesis ${i+1}: ${txId}:${i+3} (${DUST_AMOUNT} sats)`);
    }
    log(`  Change: ${txId}:6 (${change} sats)`);
  } else {
    log('\n[DRY RUN] Transaction not broadcast. Use --broadcast to send.');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
