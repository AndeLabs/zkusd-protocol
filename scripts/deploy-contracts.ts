#!/usr/bin/env npx ts-node
/**
 * zkUSD Contract Deployment Script
 *
 * Deploys zkUSD contracts to testnet4 using the Charms protocol.
 * Handles App ID computation, spell generation, proving, signing, and broadcasting.
 *
 * Usage:
 *   npx ts-node scripts/deploy-contracts.ts [--dry-run] [--contract <name>]
 *
 * Options:
 *   --dry-run     Generate spells without deploying
 *   --contract    Deploy only specified contract (token, vault-manager, stability-pool)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

// Initialize elliptic curve library
bitcoin.initEccLib(ecc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const ROOT_DIR = path.join(__dirname, '..');
const WALLET_PATH = path.join(ROOT_DIR, 'deployments/testnet4/wallet.json');
const WASM_DIR = path.join(ROOT_DIR, 'apps/web/public/wasm');
const SPELLS_DIR = path.join(ROOT_DIR, 'spells/deploy');

const MEMPOOL_API = 'https://mempool.space/testnet4/api';
const CHARMS_PROVER_API = 'https://v8.charms.dev/spells/prove';

// Already deployed and matching Oracle
const ORACLE_APP_ID = '26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5';
const ORACLE_VK = '98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d';

// ============================================================================
// Types
// ============================================================================

interface WalletConfig {
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

interface DeploymentPlan {
  token: {
    utxo: Utxo;
    appId: string;
    vk: string;
    fundingUtxo: Utxo;
  };
  vaultManager: {
    utxo: Utxo;
    appId: string;
    vk: string;
    fundingUtxo: Utxo;
  };
  stabilityPool: {
    utxo: Utxo;
    appId: string;
    vk: string;
    fundingUtxo: Utxo;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
  return response.text();
}

async function fetchUtxos(address: string): Promise<Utxo[]> {
  return fetchJson<Utxo[]>(`${MEMPOOL_API}/address/${address}/utxo`);
}

async function fetchRawTx(txid: string): Promise<string> {
  return fetchText(`${MEMPOOL_API}/tx/${txid}/hex`);
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

// ============================================================================
// PSBT Signing
// ============================================================================

// Testnet4 network configuration
const TESTNET4_NETWORK: bitcoin.Network = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'tb',
  bip32: {
    public: 0x043587cf,
    private: 0x04358394,
  },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

async function signTransaction(
  txHex: string,
  wallet: WalletConfig,
  prevTxsCache: Map<string, string>
): Promise<string> {
  // Check if it's a PSBT (starts with 'psbt' magic bytes in base64 or hex)
  const isPsbt = txHex.startsWith('70736274') || txHex.startsWith('cHNidP');

  if (isPsbt) {
    // Handle PSBT format
    let psbt: bitcoin.Psbt;
    try {
      if (txHex.startsWith('cHNidP')) {
        psbt = bitcoin.Psbt.fromBase64(txHex, { network: TESTNET4_NETWORK });
      } else {
        psbt = bitcoin.Psbt.fromHex(txHex, { network: TESTNET4_NETWORK });
      }
    } catch (err) {
      throw new Error(`Failed to parse PSBT: ${err}`);
    }

    const privateKeyBuffer = Buffer.from(wallet.private_key_hex, 'hex');
    const keyPair = {
      publicKey: Buffer.from(wallet.public_key, 'hex'),
      privateKey: privateKeyBuffer,
      sign: (hash: Buffer): Buffer => Buffer.from(ecc.sign(hash, privateKeyBuffer)),
    };

    for (let i = 0; i < psbt.inputCount; i++) {
      try {
        psbt.signInput(i, keyPair);
      } catch {
        // Ignore inputs we can't sign
      }
    }

    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }

  // Handle raw transaction format (from Charms prover)
  log('Converting raw transaction to PSBT for signing...');
  const tx = bitcoin.Transaction.fromHex(txHex);

  // Check which inputs have existing witness data (from Charms prover)
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

  log(`Inputs with existing witness: ${inputsWithWitness.join(', ') || 'none'}`);

  // Build PSBT for sighash calculation (need ALL inputs and outputs)
  const psbt = new bitcoin.Psbt({ network: TESTNET4_NETWORK });

  // Add all inputs
  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputVout = input.index;

    let prevTxHex = prevTxsCache.get(inputTxid);
    if (!prevTxHex) {
      log(`Fetching previous tx ${inputTxid.slice(0, 16)}...`);
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

  // Add all outputs
  for (const output of tx.outs) {
    psbt.addOutput({
      script: output.script,
      value: BigInt(output.value),
    });
  }

  // Sign inputs that don't have existing witness (P2WPKH inputs we own)
  const privateKeyBuffer = Buffer.from(wallet.private_key_hex, 'hex');
  const keyPair = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    privateKey: privateKeyBuffer,
    sign: (hash: Buffer): Buffer => Buffer.from(ecc.sign(hash, privateKeyBuffer)),
  };

  for (let i = 0; i < tx.ins.length; i++) {
    if (!inputsWithWitness.includes(i)) {
      try {
        psbt.signInput(i, keyPair);
        log(`Signed input ${i}`);
      } catch (err) {
        log(`Warning: Could not sign input ${i}: ${err}`);
      }
    }
  }

  // Extract signatures from PSBT and build final transaction
  const finalTx = tx.clone();

  for (let i = 0; i < tx.ins.length; i++) {
    if (inputsWithWitness.includes(i)) {
      // Keep existing witness from Charms prover
      finalTx.ins[i].witness = existingWitness[i];
    } else {
      // Use signature from PSBT
      const partialSig = psbt.data.inputs[i].partialSig;
      if (partialSig && partialSig.length > 0) {
        finalTx.ins[i].witness = [partialSig[0].signature, partialSig[0].pubkey];
      }
    }
  }

  return finalTx.toHex();
}

// ============================================================================
// Admin Address Computation
// ============================================================================

function computeAdminHash(pubkey: string): number[] {
  const pubkeyBytes = hexToBytes(pubkey);
  const hash = crypto.createHash('sha256').update(Buffer.from(pubkeyBytes)).digest();
  return Array.from(hash.slice(0, 32));
}

// ============================================================================
// Spell Generation
// ============================================================================

function generateTokenSpell(
  plan: DeploymentPlan,
  wallet: WalletConfig,
  admin: number[]
): object {
  const appRef = `n/${plan.token.appId}/${plan.token.vk}`;

  // authorized_minter = VaultManager App ID
  const authorizedMinter = hexToBytes(plan.vaultManager.appId);

  return {
    version: 8,
    apps: {
      '$TOKEN': appRef,
    },
    private_inputs: {
      '$TOKEN': {
        op: 0,
        authorized_minter: authorizedMinter,
      },
    },
    ins: [
      {
        utxo_id: `${plan.token.utxo.txid}:${plan.token.utxo.vout}`,
        charms: {},
      },
    ],
    outs: [
      {
        address: wallet.address,
        charms: {
          '$TOKEN': {
            authorized_minter: authorizedMinter,
            total_supply: 0,
          },
        },
      },
    ],
  };
}

function generateStabilityPoolSpell(
  plan: DeploymentPlan,
  wallet: WalletConfig,
  admin: number[]
): object {
  const appRef = `n/${plan.stabilityPool.appId}/${plan.stabilityPool.vk}`;

  // Cross-reference App IDs
  const tokenId = hexToBytes(plan.token.appId);
  const vmId = hexToBytes(plan.vaultManager.appId);

  return {
    version: 8,
    apps: {
      '$SP': appRef,
    },
    private_inputs: {
      '$SP': {
        op: 0,
        zkusd_token_id: tokenId,
        vault_manager_id: vmId,
        admin: admin,
      },
    },
    ins: [
      {
        utxo_id: `${plan.stabilityPool.utxo.txid}:${plan.stabilityPool.utxo.vout}`,
        charms: {},
      },
    ],
    outs: [
      {
        address: wallet.address,
        charms: {
          '$SP': {
            config: {
              zkusd_token_id: tokenId,
              vault_manager_id: vmId,
              admin: admin,
            },
            state: {
              total_zkusd: 0,
              total_btc: 0,
              product_p: '1000000000000000000', // 1e18 as string for u128
              sum_s: 0,
              current_epoch: 0,
              current_scale: 0,
              depositor_count: 0,
            },
          },
        },
      },
    ],
  };
}

function generateVaultManagerSpell(
  plan: DeploymentPlan,
  wallet: WalletConfig,
  admin: number[]
): object {
  const appRef = `n/${plan.vaultManager.appId}/${plan.vaultManager.vk}`;

  // Cross-references
  const tokenId = hexToBytes(plan.token.appId);
  const stabilityPoolId = hexToBytes(plan.stabilityPool.appId);
  const oracleId = hexToBytes(ORACLE_APP_ID);

  // Pool addresses (using admin as placeholder)
  const activePool = admin.slice();
  const defaultPool = admin.slice();
  activePool[0] = 0xAC;
  defaultPool[0] = 0xDE;

  return {
    version: 8,
    apps: {
      '$VM': appRef,
    },
    private_inputs: {
      '$VM': {
        op: 0,
        admin: admin,
        zkusd_token_id: tokenId,
        stability_pool_id: stabilityPoolId,
        price_oracle_id: oracleId,
        active_pool: activePool,
        default_pool: defaultPool,
      },
    },
    ins: [
      {
        utxo_id: `${plan.vaultManager.utxo.txid}:${plan.vaultManager.utxo.vout}`,
        charms: {},
      },
    ],
    outs: [
      {
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
            zkusd_token_id: tokenId,
            stability_pool_id: stabilityPoolId,
            price_oracle_id: oracleId,
            active_pool: activePool,
            default_pool: defaultPool,
          },
        },
      },
    ],
  };
}

// ============================================================================
// Deployment Functions
// ============================================================================

async function proveSpell(
  spell: object,
  wasmPath: string,
  fundingUtxo: Utxo,
  prevTxs: string[],
  wallet: WalletConfig
): Promise<{ commitTx: string; spellTx: string }> {
  const vk = getVk(wasmPath);
  const wasmBase64 = fs.readFileSync(wasmPath).toString('base64');

  const requestBody = {
    spell,
    binaries: {
      [vk]: wasmBase64,
    },
    prev_txs: prevTxs.map(hex => ({ bitcoin: hex })),
    funding_utxo: `${fundingUtxo.txid}:${fundingUtxo.vout}`,
    funding_utxo_value: fundingUtxo.value,
    change_address: wallet.address,
    fee_rate: 5,
    chain: 'bitcoin',
  };

  log('Calling prover API (this may take several minutes)...');
  const startTime = Date.now();

  const response = await fetch(CHARMS_PROVER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Prover failed (${response.status}): ${error}`);
  }

  log(`Prover responded in ${elapsed}s`);

  const result = await response.json() as any[];

  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error('Invalid prover response format');
  }

  return {
    commitTx: result[0].bitcoin || result[0],
    spellTx: result[1].bitcoin || result[1],
  };
}

async function deployContract(
  name: string,
  spell: object,
  wasmPath: string,
  utxo: Utxo,
  fundingUtxo: Utxo,
  wallet: WalletConfig,
  dryRun: boolean
): Promise<{ commitTxId: string; spellTxId: string } | null> {
  log(`\n${'='.repeat(60)}`);
  log(`Deploying ${name}`);
  log(`${'='.repeat(60)}`);

  // Save spell for debugging
  const spellPath = path.join(SPELLS_DIR, `${name.toLowerCase().replace(/\s+/g, '-')}.json`);
  fs.mkdirSync(path.dirname(spellPath), { recursive: true });
  fs.writeFileSync(spellPath, JSON.stringify(spell, null, 2));
  log(`Spell saved to ${spellPath}`);

  if (dryRun) {
    log('[DRY RUN] Skipping deployment');
    return null;
  }

  // Fetch prev_txs and build cache for signing
  log('Fetching previous transactions...');
  const prevTxsCache = new Map<string, string>();
  const [utxoPrevTx, fundingPrevTx] = await Promise.all([
    fetchRawTx(utxo.txid),
    fetchRawTx(fundingUtxo.txid),
  ]);
  prevTxsCache.set(utxo.txid, utxoPrevTx);
  prevTxsCache.set(fundingUtxo.txid, fundingPrevTx);

  // Prove spell
  const { commitTx, spellTx } = await proveSpell(
    spell,
    wasmPath,
    fundingUtxo,
    [utxoPrevTx, fundingPrevTx],
    wallet
  );

  log(`Commit TX size: ${commitTx.length / 2} bytes`);
  log(`Spell TX size: ${spellTx.length / 2} bytes`);

  // Save unsigned transactions
  fs.writeFileSync(`/tmp/zkusd-${name}-commit-unsigned.hex`, commitTx);
  fs.writeFileSync(`/tmp/zkusd-${name}-spell-unsigned.hex`, spellTx);
  log('Unsigned transactions saved to /tmp/');

  // Sign transactions (handles both PSBT and raw tx formats)
  log('Signing commit transaction...');
  const signedCommitTx = await signTransaction(commitTx, wallet, prevTxsCache);
  log('Signing spell transaction...');
  const signedSpellTx = await signTransaction(spellTx, wallet, prevTxsCache);

  // Save signed transactions
  fs.writeFileSync(`/tmp/zkusd-${name}-commit-signed.hex`, signedCommitTx);
  fs.writeFileSync(`/tmp/zkusd-${name}-spell-signed.hex`, signedSpellTx);
  log('Signed transactions saved to /tmp/');

  // Broadcast
  log('Broadcasting commit transaction...');
  const commitTxId = await broadcastTx(signedCommitTx);
  log(`Commit TX ID: ${commitTxId}`);

  log('Waiting 10s for propagation...');
  await new Promise(r => setTimeout(r, 10000));

  log('Broadcasting spell transaction...');
  const spellTxId = await broadcastTx(signedSpellTx);
  log(`Spell TX ID: ${spellTxId}`);

  log(`\n✓ ${name} deployed successfully!`);
  log(`  State UTXO: ${spellTxId}:0`);
  log(`  Explorer: https://mempool.space/testnet4/tx/${spellTxId}`);

  return { commitTxId, spellTxId };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const allowUnconfirmed = args.includes('--allow-unconfirmed');
  const useTxidIdx = args.findIndex(a => a === '--use-txid');
  const useTxid = useTxidIdx >= 0 ? args[useTxidIdx + 1] : undefined;
  const contractFilter = args.find((_, i, arr) => arr[i - 1] === '--contract');

  log('zkUSD Contract Deployment Script');
  log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DEPLOYMENT'}`);
  if (allowUnconfirmed) {
    log('WARNING: Using unconfirmed UTXOs (--allow-unconfirmed)');
  }
  if (useTxid) {
    log(`Using UTXOs from specific txid: ${useTxid.slice(0, 16)}...`);
  }
  if (contractFilter) {
    log(`Deploying only: ${contractFilter}`);
  }

  // Load wallet
  log('\nLoading wallet...');
  const wallet: WalletConfig = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  log(`Address: ${wallet.address}`);

  // Compute admin hash
  const admin = computeAdminHash(wallet.public_key);
  log(`Admin hash: ${Buffer.from(admin).toString('hex').slice(0, 16)}...`);

  // Get VKs
  log('\nGetting verification keys...');
  const tokenVk = getVk(path.join(WASM_DIR, 'zkusd-token-app.wasm'));
  const vmVk = getVk(path.join(WASM_DIR, 'zkusd-vault-manager-app.wasm'));
  const spVk = getVk(path.join(WASM_DIR, 'zkusd-stability-pool-app.wasm'));
  log(`  Token VK: ${tokenVk}`);
  log(`  VM VK: ${vmVk}`);
  log(`  SP VK: ${spVk}`);

  // Fetch UTXOs
  log('\nFetching UTXOs...');
  const allUtxos = await fetchUtxos(wallet.address);
  let utxos = allUtxos
    .filter(u => (allowUnconfirmed || u.status.confirmed) && u.value >= 547)
    .sort((a, b) => b.value - a.value);

  log(`Found ${utxos.length} usable UTXOs total`);

  // If --use-txid is specified, only use UTXOs from that transaction
  if (useTxid) {
    const txidUtxos = utxos.filter(u => u.txid === useTxid);
    if (txidUtxos.length < 6) {
      throw new Error(`Need at least 6 UTXOs from txid ${useTxid.slice(0,16)}..., found ${txidUtxos.length}`);
    }
    // Sort by vout to get predictable order: 0,1,2 are funding (50k), 3,4,5 are genesis (547)
    utxos = txidUtxos.sort((a, b) => a.vout - b.vout);
    log(`Using ${utxos.length} UTXOs from specified txid`);
  } else if (utxos.length < 6) {
    throw new Error('Need at least 6 UTXOs for deployment (3 contracts + 3 funding). Run faucet or split UTXOs.');
  }

  // Select UTXOs based on whether we're using a specific txid
  let tokenFundingUtxo: Utxo, spFundingUtxo: Utxo, vmFundingUtxo: Utxo;
  let tokenUtxo: Utxo, spUtxo: Utxo, vmUtxo: Utxo;

  if (useTxid) {
    // From split-utxos.ts: vout 0,1,2 are 50k funding, vout 3,4,5 are 547 genesis
    tokenFundingUtxo = utxos.find(u => u.vout === 0)!;
    spFundingUtxo = utxos.find(u => u.vout === 1)!;
    vmFundingUtxo = utxos.find(u => u.vout === 2)!;
    tokenUtxo = utxos.find(u => u.vout === 3)!;
    spUtxo = utxos.find(u => u.vout === 4)!;
    vmUtxo = utxos.find(u => u.vout === 5)!;
  } else {
    // Use largest 3 for funding, next 3 for contract genesis
    tokenFundingUtxo = utxos[0];
    spFundingUtxo = utxos[1];
    vmFundingUtxo = utxos[2];
    tokenUtxo = utxos[3];
    spUtxo = utxos[4];
    vmUtxo = utxos[5];
  }

  // Compute App IDs
  const plan: DeploymentPlan = {
    token: {
      utxo: tokenUtxo,
      appId: computeAppId(tokenUtxo),
      vk: tokenVk,
      fundingUtxo: tokenFundingUtxo,
    },
    vaultManager: {
      utxo: vmUtxo,
      appId: computeAppId(vmUtxo),
      vk: vmVk,
      fundingUtxo: vmFundingUtxo,
    },
    stabilityPool: {
      utxo: spUtxo,
      appId: computeAppId(spUtxo),
      vk: spVk,
      fundingUtxo: spFundingUtxo,
    },
  };

  log('\nDeployment Plan:');
  log(`  Token: genesis=${tokenUtxo.txid.slice(0,8)}:${tokenUtxo.vout}, funding=${tokenFundingUtxo.txid.slice(0,8)}:${tokenFundingUtxo.vout} (${tokenFundingUtxo.value} sats)`);
  log(`  SP: genesis=${spUtxo.txid.slice(0,8)}:${spUtxo.vout}, funding=${spFundingUtxo.txid.slice(0,8)}:${spFundingUtxo.vout} (${spFundingUtxo.value} sats)`);
  log(`  VM: genesis=${vmUtxo.txid.slice(0,8)}:${vmUtxo.vout}, funding=${vmFundingUtxo.txid.slice(0,8)}:${vmFundingUtxo.vout} (${vmFundingUtxo.value} sats)`);
  log(`\nPlanned App IDs:`);
  log(`  Token: ${plan.token.appId}`);
  log(`  SP: ${plan.stabilityPool.appId}`);
  log(`  VM: ${plan.vaultManager.appId}`);

  // Generate spells
  log('\nGenerating spell files...');
  const tokenSpell = generateTokenSpell(plan, wallet, admin);
  const spSpell = generateStabilityPoolSpell(plan, wallet, admin);
  const vmSpell = generateVaultManagerSpell(plan, wallet, admin);

  const results: Record<string, any> = {};

  // Deploy Token
  if (!contractFilter || contractFilter === 'token') {
    results.token = await deployContract(
      'zkUSD Token',
      tokenSpell,
      path.join(WASM_DIR, 'zkusd-token-app.wasm'),
      plan.token.utxo,
      plan.token.fundingUtxo,
      wallet,
      dryRun
    );
  }

  // Deploy Stability Pool
  if (!contractFilter || contractFilter === 'stability-pool') {
    results.stabilityPool = await deployContract(
      'Stability Pool',
      spSpell,
      path.join(WASM_DIR, 'zkusd-stability-pool-app.wasm'),
      plan.stabilityPool.utxo,
      plan.stabilityPool.fundingUtxo,
      wallet,
      dryRun
    );
  }

  // Deploy Vault Manager
  if (!contractFilter || contractFilter === 'vault-manager') {
    results.vaultManager = await deployContract(
      'Vault Manager',
      vmSpell,
      path.join(WASM_DIR, 'zkusd-vault-manager-app.wasm'),
      plan.vaultManager.utxo,
      plan.vaultManager.fundingUtxo,
      wallet,
      dryRun
    );
  }

  // Summary
  log('\n' + '='.repeat(60));
  log('DEPLOYMENT SUMMARY');
  log('='.repeat(60));

  if (dryRun) {
    log('\n[DRY RUN] No transactions were broadcast.');
    log('\nPlanned App IDs:');
    log(`  Token: ${plan.token.appId}`);
    log(`  Stability Pool: ${plan.stabilityPool.appId}`);
    log(`  Vault Manager: ${plan.vaultManager.appId}`);
    log(`  Oracle (existing): ${ORACLE_APP_ID}`);
  } else {
    log('\nDeployed Contracts:');
    for (const [name, result] of Object.entries(results)) {
      if (result) {
        log(`  ${name}: ${result.spellTxId}:0`);
      }
    }

    // Save deployment info
    const deploymentInfo = {
      timestamp: new Date().toISOString(),
      network: 'testnet4',
      plan,
      results,
    };

    const infoPath = path.join(ROOT_DIR, 'deployments/testnet4/latest-deployment.json');
    fs.writeFileSync(infoPath, JSON.stringify(deploymentInfo, null, 2));
    log(`\nDeployment info saved to ${infoPath}`);
  }

  log('\nUpdate packages/config/src/testnet4.ts with new App IDs and VKs');
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
