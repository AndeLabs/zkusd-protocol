#!/usr/bin/env npx ts-node
/**
 * VaultManager V5 Deployment Script
 *
 * Deploys VaultManager V5 with Charms v8 compatibility fixes:
 * - btc_inputs check fix
 * - close_vault Charms v8 compatibility
 * - liquidation safe_sub for underflow prevention
 *
 * VK: 8b3834c2f233d1abc6b1473833f4addd113873e21624a6ddf419406c09e1fa42
 *
 * Usage:
 *   npx ts-node scripts/deploy-vault-manager-v5.ts
 *   npx ts-node scripts/deploy-vault-manager-v5.ts --dry-run
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

bitcoin.initEccLib(ecc);

// ============================================================================
// Configuration
// ============================================================================

const TESTNET4: bitcoin.Network = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'tb',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

const MEMPOOL_API = 'https://mempool.space/testnet4/api';
const CHARMS_PROVER_API = 'https://v8.charms.dev/spells/prove';

const V5_CONFIG = {
  wasmPath: 'apps/web/public/wasm/zkusd-vault-manager-app.wasm',
  expectedVk: '8b3834c2f233d1abc6b1473833f4addd113873e21624a6ddf419406c09e1fa42',

  // Cross-references from existing deployment
  crossRefs: {
    zkusdTokenId: '7ff62ba48cbb4e8437aab1a32050ad0e4c8c874db34ab10aa015a9d98bddcef1',
    stabilityPoolId: '001537495ecc1bc1e19892052ece990bcbcf301a043e5ce1019680d721a5dc6b',
    oracleId: '26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5',
  },
};

// ============================================================================
// Types
// ============================================================================

interface WalletConfig {
  network: string;
  address: string;
  public_key: string;
  private_key_wif: string;
  private_key_hex: string;
}

interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const response = await fetch(`${MEMPOOL_API}/address/${address}/utxo`);
  if (!response.ok) {
    throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
  }
  return response.json();
}

async function fetchRawTx(txid: string): Promise<string> {
  const response = await fetch(`${MEMPOOL_API}/tx/${txid}/hex`);
  if (!response.ok) {
    throw new Error(`Failed to fetch raw tx ${txid}: ${response.statusText}`);
  }
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
    throw new Error(`Failed to broadcast: ${error}`);
  }
  return response.text();
}

async function getFeeRate(): Promise<number> {
  const response = await fetch(`${MEMPOOL_API}/v1/fees/recommended`);
  if (!response.ok) return 5; // Default
  const fees = await response.json();
  return fees.halfHourFee || 5;
}

// ============================================================================
// Helper Functions
// ============================================================================

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function loadWasm(wasmPath: string): string {
  const fullPath = path.join(process.cwd(), wasmPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`WASM not found: ${fullPath}`);
  }
  const wasm = fs.readFileSync(fullPath);
  return wasm.toString('base64');
}

function getVk(wasmPath: string): string {
  const fullPath = path.join(process.cwd(), wasmPath);
  try {
    const result = execSync(`charms app vk ${fullPath}`, { encoding: 'utf-8' });
    return result.trim();
  } catch (e) {
    throw new Error(`Failed to get VK. Is charms CLI installed? Error: ${e}`);
  }
}

function loadWallet(): WalletConfig {
  const walletPath = path.join(process.cwd(), 'deployments/testnet4/wallet.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}`);
  }
  return JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
}

// ============================================================================
// Deployment Logic
// ============================================================================

function buildDeploySpell(
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  vk: string
): object {
  const appRef = `n/new/${vk}`;
  const collateralUtxoId = `${collateralUtxo.txid}:${collateralUtxo.vout}`;

  // Admin bytes (pubkey without prefix)
  const adminBytes = hexToBytes(wallet.public_key.slice(2));

  // Initial state with cross-references
  const initialState = {
    _type: 'VaultManagerState',
    zkusd_token_id: hexToBytes(V5_CONFIG.crossRefs.zkusdTokenId),
    stability_pool_id: hexToBytes(V5_CONFIG.crossRefs.stabilityPoolId),
    oracle_id: hexToBytes(V5_CONFIG.crossRefs.oracleId),
    active_pool: adminBytes,
    default_pool: adminBytes,
    total_collateral: 0,
    total_debt: 0,
    active_vault_count: 0,
    base_rate: 50, // 0.5%
    last_fee_operation_block: 0,
    is_paused: false,
  };

  return {
    version: 8,
    apps: {
      [appRef]: appRef,
    },
    ins: [
      {
        utxo_id: collateralUtxoId,
        charms: {},
      },
    ],
    outs: [
      {
        address: wallet.address,
        charms: {
          [appRef]: initialState,
        },
      },
    ],
  };
}

async function proveSpell(
  spell: object,
  vk: string,
  prevTxs: string[],
  fundingUtxo: Utxo,
  changeAddress: string,
  feeRate: number
): Promise<{ commitTx: string; spellTx: string }> {
  const wasmBase64 = loadWasm(V5_CONFIG.wasmPath);

  const requestBody = {
    spell,
    binaries: {
      [vk]: wasmBase64,
    },
    prev_txs: prevTxs.map(tx => ({ bitcoin: tx })),
    funding_utxo: `${fundingUtxo.txid}:${fundingUtxo.vout}`,
    funding_utxo_value: fundingUtxo.value,
    change_address: changeAddress,
    fee_rate: feeRate,
    chain: 'bitcoin',
  };

  console.log('\n📡 Sending prove request to Charms API...');
  console.log(`   Prover: ${CHARMS_PROVER_API}`);
  console.log(`   Fee rate: ${feeRate} sat/vB`);

  const response = await fetch(CHARMS_PROVER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Prover failed: ${response.status} - ${error}`);
  }

  const result = await response.json();

  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error(`Invalid prover response: ${JSON.stringify(result)}`);
  }

  return {
    commitTx: result[0].bitcoin || result[0],
    spellTx: result[1].bitcoin || result[1],
  };
}

async function signTransaction(
  txHex: string,
  wallet: WalletConfig,
  inputIndex: number,
  prevOutput: { script: Buffer; value: bigint }
): Promise<string> {
  const tx = bitcoin.Transaction.fromHex(txHex);
  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  // Add all inputs with witness UTXO info
  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];

    if (i === inputIndex) {
      // This is the input we need to sign
      psbt.addInput({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: prevOutput,
      });
    } else {
      // For other inputs, we need to fetch their prev outputs
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const prevTxHex = await fetchRawTx(txid);
      const prevTx = bitcoin.Transaction.fromHex(prevTxHex);
      const prevOut = prevTx.outs[input.index];

      psbt.addInput({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: {
          script: prevOut.script,
          value: BigInt(prevOut.value),
        },
      });
    }
  }

  // Add all outputs
  for (const output of tx.outs) {
    psbt.addOutput({
      script: output.script,
      value: BigInt(output.value),
    });
  }

  // Sign the specified input
  const privateKey = Buffer.from(wallet.private_key_hex, 'hex');
  const keyPair = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    privateKey,
    sign: (hash: Buffer): Buffer => {
      const sig = ecc.sign(hash, privateKey);
      return Buffer.from(sig);
    },
  };

  psbt.signInput(inputIndex, keyPair);

  // Extract signature
  const partialSig = psbt.data.inputs[inputIndex].partialSig;
  if (!partialSig || partialSig.length === 0) {
    throw new Error('Signing failed');
  }

  // Reconstruct transaction with signature
  const finalTx = tx.clone();
  finalTx.ins[inputIndex].witness = [partialSig[0].signature, partialSig[0].pubkey];

  return finalTx.toHex();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       VaultManager V5 Deployment Script                  ║');
  console.log('║       Charms v8 Compatibility Fixes                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No transactions will be broadcast\n');
  }

  // 1. Load wallet
  console.log('📁 Loading wallet...');
  const wallet = loadWallet();
  console.log(`   Address: ${wallet.address}`);

  // 2. Verify VK
  console.log('\n🔑 Verifying WASM VK...');
  const vk = getVk(V5_CONFIG.wasmPath);
  console.log(`   Computed VK: ${vk}`);
  console.log(`   Expected VK: ${V5_CONFIG.expectedVk}`);

  if (vk !== V5_CONFIG.expectedVk) {
    console.error('\n❌ VK MISMATCH! WASM may not be V5.');
    console.error('   Please rebuild: cd contracts/vault-manager && charms app build');
    process.exit(1);
  }
  console.log('   ✓ VK matches expected V5');

  // 3. Get UTXOs
  console.log('\n💰 Fetching UTXOs...');
  const utxos = await fetchUtxos(wallet.address);
  const confirmedUtxos = utxos.filter(u => u.status.confirmed);
  console.log(`   Total UTXOs: ${utxos.length}`);
  console.log(`   Confirmed UTXOs: ${confirmedUtxos.length}`);

  if (confirmedUtxos.length < 2) {
    console.error('\n❌ Need at least 2 confirmed UTXOs for deployment');
    console.error('   1 for genesis state, 1 for funding fees');
    console.error('   Please split UTXOs or wait for confirmations');
    process.exit(1);
  }

  // Sort by value
  const sorted = confirmedUtxos.sort((a, b) => b.value - a.value);
  const [feeUtxo, collateralUtxo] = sorted;

  console.log(`   Collateral UTXO: ${collateralUtxo.txid}:${collateralUtxo.vout} (${collateralUtxo.value} sats)`);
  console.log(`   Fee UTXO: ${feeUtxo.txid}:${feeUtxo.vout} (${feeUtxo.value} sats)`);

  // 4. Get fee rate
  const feeRate = await getFeeRate();
  console.log(`\n⛽ Fee rate: ${feeRate} sat/vB`);

  // 5. Build spell
  console.log('\n📜 Building deployment spell...');
  const spell = buildDeploySpell(wallet, collateralUtxo, vk);

  if (isDryRun) {
    console.log('\nSpell preview:');
    console.log(JSON.stringify(spell, null, 2));
  }

  // 6. Fetch prev txs
  console.log('\n📥 Fetching previous transactions...');
  const [collateralPrevTx, feePrevTx] = await Promise.all([
    fetchRawTx(collateralUtxo.txid),
    fetchRawTx(feeUtxo.txid),
  ]);

  // 7. Prove
  console.log('\n⚡ Proving spell (this may take 2-5 minutes)...');
  const { commitTx, spellTx } = await proveSpell(
    spell,
    vk,
    [collateralPrevTx, feePrevTx],
    feeUtxo,
    wallet.address,
    feeRate
  );

  console.log(`   Commit TX: ${commitTx.length / 2} bytes`);
  console.log(`   Spell TX: ${spellTx.length / 2} bytes`);

  // Save raw transactions
  const outputDir = path.join(process.cwd(), 'deployments/testnet4/v5');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'commit-unsigned.hex'), commitTx);
  fs.writeFileSync(path.join(outputDir, 'spell-unsigned.hex'), spellTx);
  console.log(`   Saved unsigned TXs to ${outputDir}`);

  if (isDryRun) {
    console.log('\n✅ Dry run complete. Transactions ready for signing.');
    console.log('   Run without --dry-run to sign and broadcast.');
    return;
  }

  // 8. Sign transactions
  console.log('\n✍️  Signing transactions...');

  // Get prev output for signing commit tx (fee UTXO)
  const feePrevTxParsed = bitcoin.Transaction.fromHex(feePrevTx);
  const feePrevOutput = feePrevTxParsed.outs[feeUtxo.vout];

  const signedCommit = await signTransaction(
    commitTx,
    wallet,
    0, // Input index to sign
    {
      script: feePrevOutput.script,
      value: BigInt(feePrevOutput.value),
    }
  );
  console.log('   ✓ Commit TX signed');

  // For spell TX, we need to sign the genesis UTXO input
  const collateralPrevTxParsed = bitcoin.Transaction.fromHex(collateralPrevTx);
  const collateralPrevOutput = collateralPrevTxParsed.outs[collateralUtxo.vout];

  const signedSpell = await signTransaction(
    spellTx,
    wallet,
    0, // Input index to sign
    {
      script: collateralPrevOutput.script,
      value: BigInt(collateralPrevOutput.value),
    }
  );
  console.log('   ✓ Spell TX signed');

  // Save signed transactions
  fs.writeFileSync(path.join(outputDir, 'commit-signed.hex'), signedCommit);
  fs.writeFileSync(path.join(outputDir, 'spell-signed.hex'), signedSpell);

  // 9. Broadcast
  console.log('\n📡 Broadcasting transactions...');

  console.log('   Broadcasting commit TX...');
  const commitTxId = await broadcastTx(signedCommit);
  console.log(`   ✓ Commit TX: ${commitTxId}`);

  // Wait for propagation
  console.log('   Waiting for mempool propagation (5s)...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('   Broadcasting spell TX...');
  const spellTxId = await broadcastTx(signedSpell);
  console.log(`   ✓ Spell TX: ${spellTxId}`);

  // 10. Calculate App ID and save result
  // App ID is SHA256 of the genesis outpoint
  const genesisOutpoint = `${collateralUtxo.txid}:${collateralUtxo.vout}`;
  const crypto = require('crypto');
  const appId = crypto.createHash('sha256')
    .update(Buffer.from(genesisOutpoint))
    .digest('hex');

  const result = {
    version: 'V5',
    network: 'testnet4',
    deployed_at: new Date().toISOString(),
    appId,
    vk,
    appRef: `n/${appId}/${vk}`,
    commitTxId,
    spellTxId,
    stateUtxo: `${spellTxId}:0`,
    explorer: `https://mempool.space/testnet4/tx/${spellTxId}`,
  };

  fs.writeFileSync(
    path.join(outputDir, 'deployment-result.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║               DEPLOYMENT SUCCESSFUL!                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`App ID:     ${appId}`);
  console.log(`VK:         ${vk}`);
  console.log(`App Ref:    n/${appId}/${vk}`);
  console.log(`Spell TX:   ${spellTxId}`);
  console.log(`State UTXO: ${spellTxId}:0`);
  console.log('');
  console.log(`🔗 Explorer: https://mempool.space/testnet4/tx/${spellTxId}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Wait for confirmation (1-2 blocks)');
  console.log('2. Update packages/config/src/testnet4.ts with new values');
  console.log('3. Update deployments/testnet4/deployment-status.json');
}

main().catch(err => {
  console.error('\n❌ Deployment failed:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
