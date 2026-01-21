#!/usr/bin/env npx tsx
/**
 * Deploy remaining contracts (SP and VM) using specific UTXOs
 * Used after Token was already deployed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

bitcoin.initEccLib(ecc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const WALLET_PATH = path.join(ROOT_DIR, 'deployments/testnet4/wallet.json');
const WASM_DIR = path.join(ROOT_DIR, 'apps/web/public/wasm');
const SPELLS_DIR = path.join(ROOT_DIR, 'spells/deploy');
const MEMPOOL_API = 'https://mempool.space/testnet4/api';
const CHARMS_PROVER_API = 'https://v8.charms.dev/spells/prove';

// Already deployed Token and Oracle
const TOKEN_APP_ID = '7ff62ba48cbb4e8437aab1a32050ad0e4c8c874db34ab10aa015a9d98bddcef1';
const ORACLE_APP_ID = '26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5';

const TESTNET4: bitcoin.Network = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'tb',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// Specific UTXOs from the split transaction
const SPLIT_TXID = '3859354fa7c71791c62a08613c1168048a31fbeee46cab6d468c9198831b7866';
const SP_FUNDING_VOUT = 1;  // 50000 sats
const VM_FUNDING_VOUT = 2;  // 50000 sats
const SP_GENESIS_VOUT = 4;  // 547 sats
const VM_GENESIS_VOUT = 5;  // 547 sats

interface WalletConfig {
  address: string;
  public_key: string;
  private_key_hex: string;
}

interface Utxo {
  txid: string;
  vout: number;
  value: number;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Custom JSON stringify that handles BigInt
function jsonStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? Number(value) : value
  );
}

function computeAppId(utxo: Utxo): string {
  const utxoStr = `${utxo.txid}:${utxo.vout}`;
  return crypto.createHash('sha256').update(utxoStr, 'utf8').digest('hex');
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function getVk(wasmPath: string): string {
  return execSync(`charms app vk "${wasmPath}"`, { encoding: 'utf-8' }).trim();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
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

function computeAdminHash(pubkey: string): number[] {
  const pubkeyBytes = hexToBytes(pubkey);
  const hash = crypto.createHash('sha256').update(Buffer.from(pubkeyBytes)).digest();
  return Array.from(hash.slice(0, 32));
}

async function signTransaction(
  txHex: string,
  wallet: WalletConfig,
  prevTxsCache: Map<string, string>
): Promise<string> {
  const tx = bitcoin.Transaction.fromHex(txHex);

  // Find inputs with existing witness (Charms prover witness)
  const inputsWithWitness: number[] = [];
  const existingWitness: Buffer[][] = [];
  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    const hasWitness = input.witness.length > 0 && input.witness.some(w => w.length > 0);
    if (hasWitness) {
      inputsWithWitness.push(i);
      existingWitness[i] = input.witness;
    }
  }

  log(`Inputs with Charms witness: ${inputsWithWitness.join(', ') || 'none'}`);

  // Build PSBT
  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputVout = input.index;

    let prevTxHex = prevTxsCache.get(inputTxid);
    if (!prevTxHex) {
      log(`Fetching prev tx ${inputTxid.slice(0, 16)}...`);
      prevTxHex = await fetchText(`${MEMPOOL_API}/tx/${inputTxid}/hex`);
      prevTxsCache.set(inputTxid, prevTxHex);
    }

    const prevTx = bitcoin.Transaction.fromHex(prevTxHex);
    const prevOutput = prevTx.outs[inputVout];

    psbt.addInput({
      hash: input.hash,
      index: input.index,
      sequence: input.sequence,
      witnessUtxo: {
        script: prevOutput.script,
        value: BigInt(prevOutput.value),
      },
    });
  }

  for (const output of tx.outs) {
    psbt.addOutput({
      script: output.script,
      value: BigInt(output.value),
    });
  }

  // Sign non-Charms inputs
  const privateKey = Buffer.from(wallet.private_key_hex, 'hex');
  const keyPair = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    privateKey,
    sign: (hash: Buffer): Buffer => Buffer.from(ecc.sign(hash, privateKey)),
  };

  for (let i = 0; i < tx.ins.length; i++) {
    if (!inputsWithWitness.includes(i)) {
      try {
        psbt.signInput(i, keyPair);
        log(`Signed input ${i}`);
      } catch (err) {
        log(`Warning: Could not sign input ${i}`);
      }
    }
  }

  // Build final transaction
  const finalTx = tx.clone();
  for (let i = 0; i < tx.ins.length; i++) {
    if (inputsWithWitness.includes(i)) {
      finalTx.ins[i].witness = existingWitness[i];
    } else {
      const partialSig = psbt.data.inputs[i].partialSig;
      if (partialSig && partialSig.length > 0) {
        finalTx.ins[i].witness = [partialSig[0].signature, partialSig[0].pubkey];
      }
    }
  }

  return finalTx.toHex();
}

async function proveAndDeploy(
  name: string,
  spell: object,
  wasmPath: string,
  genesisUtxo: Utxo,
  fundingUtxo: Utxo,
  wallet: WalletConfig
): Promise<string> {
  log(`\n${'='.repeat(60)}`);
  log(`Deploying ${name}`);
  log(`${'='.repeat(60)}`);

  // Save spell
  const spellPath = path.join(SPELLS_DIR, `${name.toLowerCase().replace(/\s+/g, '-')}.json`);
  fs.mkdirSync(path.dirname(spellPath), { recursive: true });
  fs.writeFileSync(spellPath, jsonStringify(spell).replace(/,/g, ',\n  '));
  log(`Spell saved to ${spellPath}`);

  // Fetch prev txs
  const prevTxsCache = new Map<string, string>();
  log('Fetching previous transactions...');
  const [genesisPrevTx, fundingPrevTx] = await Promise.all([
    fetchText(`${MEMPOOL_API}/tx/${genesisUtxo.txid}/hex`),
    fetchText(`${MEMPOOL_API}/tx/${fundingUtxo.txid}/hex`),
  ]);
  prevTxsCache.set(genesisUtxo.txid, genesisPrevTx);
  prevTxsCache.set(fundingUtxo.txid, fundingPrevTx);

  // Prove
  const vk = getVk(wasmPath);
  const wasmBase64 = fs.readFileSync(wasmPath).toString('base64');

  const requestBody = {
    spell,
    binaries: { [vk]: wasmBase64 },
    prev_txs: [genesisPrevTx, fundingPrevTx].map(hex => ({ bitcoin: hex })),
    funding_utxo: `${fundingUtxo.txid}:${fundingUtxo.vout}`,
    funding_utxo_value: fundingUtxo.value,
    change_address: wallet.address,
    fee_rate: 5,
    chain: 'bitcoin',
  };

  log('Calling prover API...');
  const startTime = Date.now();

  const response = await fetch(CHARMS_PROVER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: jsonStringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    log(`Prover status: ${response.status}`);
    log(`Prover error: ${error || '(empty)'}`);
    throw new Error(`Prover failed: ${error}`);
  }

  log(`Prover responded in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  const result = await response.json() as any[];
  const commitTx = result[0].bitcoin || result[0];
  const spellTx = result[1].bitcoin || result[1];

  log(`Commit TX: ${commitTx.length / 2} bytes`);
  log(`Spell TX: ${spellTx.length / 2} bytes`);

  // Sign and broadcast commit
  log('Signing commit transaction...');
  const signedCommitTx = await signTransaction(commitTx, wallet, prevTxsCache);

  log('Broadcasting commit transaction...');
  const commitTxId = await broadcastTx(signedCommitTx);
  log(`Commit TX ID: ${commitTxId}`);

  // Wait for propagation
  log('Waiting 10s for propagation...');
  await new Promise(r => setTimeout(r, 10000));

  // Add commit tx to cache
  prevTxsCache.set(commitTxId, signedCommitTx);

  // Sign and broadcast spell
  log('Signing spell transaction...');
  const signedSpellTx = await signTransaction(spellTx, wallet, prevTxsCache);

  log('Broadcasting spell transaction...');
  const spellTxId = await broadcastTx(signedSpellTx);

  log(`\n${name} deployed successfully!`);
  log(`  Spell TX ID: ${spellTxId}`);
  log(`  State UTXO: ${spellTxId}:0`);
  log(`  Explorer: https://mempool.space/testnet4/tx/${spellTxId}`);

  return spellTxId;
}

async function main() {
  const args = process.argv.slice(2);
  const contract = args[0]; // 'sp' or 'vm'

  if (!contract || !['sp', 'vm'].includes(contract)) {
    console.log('Usage: npx tsx scripts/deploy-remaining.ts <sp|vm>');
    process.exit(1);
  }

  log(`Deploying: ${contract === 'sp' ? 'Stability Pool' : 'Vault Manager'}`);

  // Load wallet
  const wallet: WalletConfig = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  log(`Wallet: ${wallet.address}`);

  const admin = computeAdminHash(wallet.public_key);

  // Get VKs
  const spVk = getVk(path.join(WASM_DIR, 'zkusd-stability-pool-app.wasm'));
  const vmVk = getVk(path.join(WASM_DIR, 'zkusd-vault-manager-app.wasm'));

  // Define UTXOs
  const spGenesis: Utxo = { txid: SPLIT_TXID, vout: SP_GENESIS_VOUT, value: 547 };
  const spFunding: Utxo = { txid: SPLIT_TXID, vout: SP_FUNDING_VOUT, value: 50000 };
  const vmGenesis: Utxo = { txid: SPLIT_TXID, vout: VM_GENESIS_VOUT, value: 547 };
  const vmFunding: Utxo = { txid: SPLIT_TXID, vout: VM_FUNDING_VOUT, value: 50000 };

  // Compute App IDs
  const spAppId = computeAppId(spGenesis);
  const vmAppId = computeAppId(vmGenesis);

  log(`\nApp IDs:`);
  log(`  Token (deployed): ${TOKEN_APP_ID}`);
  log(`  Stability Pool: ${spAppId}`);
  log(`  Vault Manager: ${vmAppId}`);

  if (contract === 'sp') {
    // Deploy Stability Pool
    const spSpell = {
      version: 8,
      apps: { '$SP': `n/${spAppId}/${spVk}` },
      private_inputs: {
        '$SP': {
          op: 0,
          zkusd_token_id: hexToBytes(TOKEN_APP_ID),
          vault_manager_id: hexToBytes(vmAppId),
          admin: admin,
        },
      },
      ins: [{ utxo_id: `${spGenesis.txid}:${spGenesis.vout}`, charms: {} }],
      outs: [{
        address: wallet.address,
        charms: {
          '$SP': {
            config: {
              zkusd_token_id: hexToBytes(TOKEN_APP_ID),
              vault_manager_id: hexToBytes(vmAppId),
              admin: admin,
            },
            state: {
              total_zkusd: 0,
              total_btc: 0,
              product_p: BigInt('1000000000000000000'),
              sum_s: BigInt(0),
              current_epoch: 0,
              current_scale: 0,
              depositor_count: 0,
            },
          },
        },
      }],
    };

    await proveAndDeploy('Stability Pool', spSpell, path.join(WASM_DIR, 'zkusd-stability-pool-app.wasm'), spGenesis, spFunding, wallet);

  } else {
    // Deploy Vault Manager
    const activePool = admin.slice();
    const defaultPool = admin.slice();
    activePool[0] = 0xAC;
    defaultPool[0] = 0xDE;

    const vmSpell = {
      version: 8,
      apps: { '$VM': `n/${vmAppId}/${vmVk}` },
      private_inputs: {
        '$VM': {
          op: 0,
          admin: admin,
          zkusd_token_id: hexToBytes(TOKEN_APP_ID),
          stability_pool_id: hexToBytes(spAppId),
          price_oracle_id: hexToBytes(ORACLE_APP_ID),
          active_pool: activePool,
          default_pool: defaultPool,
        },
      },
      ins: [{ utxo_id: `${vmGenesis.txid}:${vmGenesis.vout}`, charms: {} }],
      outs: [{
        address: wallet.address,
        charms: {
          '$VM': {
            protocol: {
              total_collateral: 0,
              total_debt: 0,
              active_vault_count: 0,
              base_rate: 50,
              last_fee_update_block: 0,
              admin: admin,
              is_paused: false,
            },
            zkusd_token_id: hexToBytes(TOKEN_APP_ID),
            stability_pool_id: hexToBytes(spAppId),
            price_oracle_id: hexToBytes(ORACLE_APP_ID),
            active_pool: activePool,
            default_pool: defaultPool,
          },
        },
      }],
    };

    await proveAndDeploy('Vault Manager', vmSpell, path.join(WASM_DIR, 'zkusd-vault-manager-app.wasm'), vmGenesis, vmFunding, wallet);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
