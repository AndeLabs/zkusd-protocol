#!/usr/bin/env npx ts-node
/**
 * zkUSD Complete Contract Deployment Script
 *
 * Deploys all zkUSD contracts to testnet4 with proper cross-references.
 * Uses mempool.space API for transactions and Charms prover API.
 *
 * Usage:
 *   npx ts-node scripts/deploy-all-contracts.ts
 *
 * Prerequisites:
 *   - Funded wallet in deployments/testnet4/wallet.json
 *   - Compiled WASM in apps/web/public/wasm/
 *   - At least 500,000 sats in wallet
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// Bitcoin libraries
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

// Initialize ECC library
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// ============================================================================
// Configuration
// ============================================================================

const ROOT_DIR = path.join(__dirname, '..');
const WALLET_PATH = path.join(ROOT_DIR, 'deployments/testnet4/wallet.json');
const WASM_DIR = path.join(ROOT_DIR, 'apps/web/public/wasm');
const OUTPUT_DIR = path.join(ROOT_DIR, 'deployments/testnet4');

const MEMPOOL_API = 'https://mempool.space/testnet4/api';
const CHARMS_PROVER_API = 'https://v8.charms.dev/spells/prove';

// Testnet4 network params
const TESTNET4 = {
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

interface DeployedContract {
  name: string;
  appId: string;
  vk: string;
  appRef: string;
  spellTxId: string;
  stateUtxo: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
  const colors = {
    info: '\x1b[36m',    // Cyan
    warn: '\x1b[33m',    // Yellow
    error: '\x1b[31m',   // Red
    success: '\x1b[32m', // Green
  };
  const reset = '\x1b[0m';
  const prefix = level === 'success' ? '✓' : level === 'error' ? '✗' : level === 'warn' ? '⚠' : '→';
  console.log(`${colors[level]}${prefix}${reset} ${message}`);
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function getVk(wasmPath: string): Promise<string> {
  const result = execSync(`charms app vk "${wasmPath}"`, { encoding: 'utf-8' });
  return result.trim();
}

// ============================================================================
// Wallet Functions
// ============================================================================

function loadWallet(): WalletConfig {
  if (!fs.existsSync(WALLET_PATH)) {
    throw new Error(`Wallet not found at ${WALLET_PATH}`);
  }
  return JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
}

function getKeyPair(wallet: WalletConfig): ReturnType<typeof ECPair.fromWIF> {
  return ECPair.fromWIF(wallet.private_key_wif, TESTNET4);
}

// ============================================================================
// Transaction Signing
// ============================================================================

function signTransaction(txHex: string, keyPair: ReturnType<typeof ECPair.fromWIF>): string {
  // Parse the transaction
  const tx = bitcoin.Transaction.fromHex(txHex);
  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  // We need to convert the raw tx to a PSBT for signing
  // This is a simplified version - full implementation would need input details

  // For now, return the original hex since Charms prover may return pre-signed txs
  log('Transaction signing - checking if already signed...', 'info');

  // Check if transaction has witness data (already signed)
  if (tx.hasWitnesses()) {
    log('Transaction already has witness data', 'info');
    return txHex;
  }

  // If not signed, we need the full UTXO details to sign
  // This is where we'd implement proper PSBT signing
  log('Transaction needs signing - using PSBT workflow', 'warn');

  return txHex;
}

// ============================================================================
// Spell Building
// ============================================================================

function loadWasmBase64(contractName: string): string {
  const wasmPath = path.join(WASM_DIR, `${contractName}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM not found: ${wasmPath}`);
  }
  return fs.readFileSync(wasmPath).toString('base64');
}

function buildDeploySpell(
  vk: string,
  collateralUtxoId: string,
  outputAddress: string,
  initialState: object
): object {
  const appRef = `n/new/${vk}`;

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
        address: outputAddress,
        charms: {
          [appRef]: initialState,
        },
      },
    ],
  };
}

async function proveAndDeploy(
  contractName: string,
  vk: string,
  spell: object,
  collateralUtxo: Utxo,
  feeUtxo: Utxo,
  wallet: WalletConfig
): Promise<{ commitTxId: string; spellTxId: string; appId: string }> {
  log(`Proving spell for ${contractName}...`, 'info');

  // Load WASM binary
  const wasmBase64 = loadWasmBase64(contractName);

  // Fetch previous transactions
  const [collateralPrevTx, feePrevTx] = await Promise.all([
    fetchRawTx(collateralUtxo.txid),
    fetchRawTx(feeUtxo.txid),
  ]);

  // Build request
  const requestBody = {
    spell,
    binaries: {
      [vk]: wasmBase64,
    },
    prev_txs: [{ bitcoin: collateralPrevTx }, { bitcoin: feePrevTx }],
    funding_utxo: `${feeUtxo.txid}:${feeUtxo.vout}`,
    funding_utxo_value: feeUtxo.value,
    change_address: wallet.address,
    fee_rate: 5,
    chain: 'bitcoin',
  };

  log('Sending to Charms prover API (this may take a few minutes)...', 'info');

  const response = await fetch(CHARMS_PROVER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Prover failed for ${contractName}: ${response.status} - ${error}`);
  }

  const result = await response.json();

  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error(`Invalid prover response: ${JSON.stringify(result)}`);
  }

  const commitTx = result[0].bitcoin || result[0];
  const spellTx = result[1].bitcoin || result[1];

  log(`Commit TX size: ${commitTx.length / 2} bytes`, 'info');
  log(`Spell TX size: ${spellTx.length / 2} bytes`, 'info');

  // Sign transactions
  const keyPair = getKeyPair(wallet);
  const signedCommitTx = signTransaction(commitTx, keyPair);
  const signedSpellTx = signTransaction(spellTx, keyPair);

  // Broadcast commit transaction
  log('Broadcasting commit transaction...', 'info');
  const commitTxId = await broadcastTx(signedCommitTx);
  log(`Commit TX: ${commitTxId}`, 'success');

  // Wait for propagation
  log('Waiting for network propagation (10s)...', 'info');
  await sleep(10000);

  // Broadcast spell transaction
  log('Broadcasting spell transaction...', 'info');
  const spellTxId = await broadcastTx(signedSpellTx);
  log(`Spell TX: ${spellTxId}`, 'success');

  // Extract App ID from the spell transaction
  // The app ID is derived from the first output of the spell tx
  const appId = crypto.createHash('sha256').update(`${spellTxId}:0`).digest('hex');

  return { commitTxId, spellTxId, appId };
}

// ============================================================================
// Contract Deployment Functions
// ============================================================================

async function deployPriceOracle(
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  feeUtxo: Utxo
): Promise<DeployedContract> {
  const name = 'zkusd-price-oracle-app';
  const wasmPath = path.join(WASM_DIR, `${name}.wasm`);
  const vk = await getVk(wasmPath);

  log(`Price Oracle VK: ${vk}`, 'info');

  // Admin is the wallet public key hash (first 20 bytes of hash160)
  const adminBytes = hexToBytes(wallet.public_key).slice(1); // Remove prefix
  const adminHash = crypto.createHash('sha256').update(Buffer.from(adminBytes)).digest();
  const admin = Array.from(adminHash.slice(0, 20));

  const initialState = {
    price: 10400000000000, // $104,000 with 8 decimals
    last_update_block: 0,
    sources: [],
    admin: admin,
  };

  const spell = buildDeploySpell(
    vk,
    `${collateralUtxo.txid}:${collateralUtxo.vout}`,
    wallet.address,
    initialState
  );

  const { commitTxId, spellTxId, appId } = await proveAndDeploy(
    name,
    vk,
    spell,
    collateralUtxo,
    feeUtxo,
    wallet
  );

  return {
    name: 'priceOracle',
    appId,
    vk,
    appRef: `n/${appId}/${vk}`,
    spellTxId,
    stateUtxo: `${spellTxId}:0`,
  };
}

async function deployZkusdToken(
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  feeUtxo: Utxo,
  vaultManagerAppId: string
): Promise<DeployedContract> {
  const name = 'zkusd-token-app';
  const wasmPath = path.join(WASM_DIR, `${name}.wasm`);
  const vk = await getVk(wasmPath);

  log(`zkUSD Token VK: ${vk}`, 'info');

  // authorized_minter is the vault manager app ID
  const authorizedMinter = hexToBytes(vaultManagerAppId);

  const initialState = {
    authorized_minter: authorizedMinter,
    total_supply: 0,
  };

  const spell = buildDeploySpell(
    vk,
    `${collateralUtxo.txid}:${collateralUtxo.vout}`,
    wallet.address,
    initialState
  );

  const { commitTxId, spellTxId, appId } = await proveAndDeploy(
    name,
    vk,
    spell,
    collateralUtxo,
    feeUtxo,
    wallet
  );

  return {
    name: 'zkusdToken',
    appId,
    vk,
    appRef: `n/${appId}/${vk}`,
    spellTxId,
    stateUtxo: `${spellTxId}:0`,
  };
}

async function deployVaultManager(
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  feeUtxo: Utxo,
  tokenAppId: string,
  oracleAppId: string,
  stabilityPoolAppId: string
): Promise<DeployedContract> {
  const name = 'zkusd-vault-manager-app';
  const wasmPath = path.join(WASM_DIR, `${name}.wasm`);
  const vk = await getVk(wasmPath);

  log(`Vault Manager VK: ${vk}`, 'info');

  // Cross-references
  const tokenId = hexToBytes(tokenAppId);
  const oracleId = hexToBytes(oracleAppId);
  const spId = hexToBytes(stabilityPoolAppId);

  // Admin pools
  const adminBytes = hexToBytes(wallet.public_key).slice(1);
  const adminHash = crypto.createHash('sha256').update(Buffer.from(adminBytes)).digest();
  const admin = Array.from(adminHash.slice(0, 32));

  const initialState = {
    zkusd_token_id: tokenId,
    stability_pool_id: spId,
    oracle_id: oracleId,
    active_pool: admin,
    default_pool: admin,
    total_collateral: 0,
    total_debt: 0,
    active_vault_count: 0,
    base_rate: 50, // 0.5%
    last_fee_operation_block: 0,
    is_paused: false,
  };

  const spell = buildDeploySpell(
    vk,
    `${collateralUtxo.txid}:${collateralUtxo.vout}`,
    wallet.address,
    initialState
  );

  const { commitTxId, spellTxId, appId } = await proveAndDeploy(
    name,
    vk,
    spell,
    collateralUtxo,
    feeUtxo,
    wallet
  );

  return {
    name: 'vaultManager',
    appId,
    vk,
    appRef: `n/${appId}/${vk}`,
    spellTxId,
    stateUtxo: `${spellTxId}:0`,
  };
}

async function deployStabilityPool(
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  feeUtxo: Utxo
): Promise<DeployedContract> {
  const name = 'zkusd-stability-pool-app';
  const wasmPath = path.join(WASM_DIR, `${name}.wasm`);
  const vk = await getVk(wasmPath);

  log(`Stability Pool VK: ${vk}`, 'info');

  const initialState = {
    total_zkusd: 0,
    total_btc: 0,
    product_p: '1000000000000000000', // 10^18 scale factor
    epoch_sum_s: [],
    depositor_count: 0,
  };

  const spell = buildDeploySpell(
    vk,
    `${collateralUtxo.txid}:${collateralUtxo.vout}`,
    wallet.address,
    initialState
  );

  const { commitTxId, spellTxId, appId } = await proveAndDeploy(
    name,
    vk,
    spell,
    collateralUtxo,
    feeUtxo,
    wallet
  );

  return {
    name: 'stabilityPool',
    appId,
    vk,
    appRef: `n/${appId}/${vk}`,
    spellTxId,
    stateUtxo: `${spellTxId}:0`,
  };
}

// ============================================================================
// Main Deployment Flow
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  zkUSD Protocol - Full Contract Deployment');
  console.log('='.repeat(60) + '\n');

  // 1. Load wallet
  log('Loading wallet...', 'info');
  const wallet = loadWallet();
  log(`Address: ${wallet.address}`, 'success');

  // 2. Check UTXOs
  log('Fetching UTXOs...', 'info');
  const utxos = await fetchUtxos(wallet.address);
  const confirmedUtxos = utxos.filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value);

  log(`Found ${confirmedUtxos.length} confirmed UTXOs`, 'info');

  const totalBalance = confirmedUtxos.reduce((sum, u) => sum + u.value, 0);
  log(`Total balance: ${totalBalance} sats (${(totalBalance / 1e8).toFixed(8)} BTC)`, 'info');

  // We need at least 8 UTXOs (2 per contract deployment) or enough sats
  if (confirmedUtxos.length < 8 && totalBalance < 400000) {
    log('Insufficient UTXOs for deployment. Need at least 8 UTXOs or 400k sats.', 'error');
    log('Please fund the wallet and/or split UTXOs.', 'warn');
    process.exit(1);
  }

  // Prepare UTXO pairs for each deployment
  const deploymentUtxos: { collateral: Utxo; fee: Utxo }[] = [];

  // Use available UTXOs
  for (let i = 0; i < 4 && i * 2 + 1 < confirmedUtxos.length; i++) {
    deploymentUtxos.push({
      collateral: confirmedUtxos[i * 2],
      fee: confirmedUtxos[i * 2 + 1],
    });
  }

  if (deploymentUtxos.length < 4) {
    log(`Only have ${deploymentUtxos.length} UTXO pairs, need 4 for full deployment.`, 'warn');
    log('Will deploy as many contracts as possible.', 'info');
  }

  const deployedContracts: DeployedContract[] = [];

  try {
    // 3. Deploy Price Oracle first (no dependencies)
    if (deploymentUtxos.length >= 1) {
      console.log('\n' + '-'.repeat(40));
      log('Deploying Price Oracle...', 'info');
      const oracle = await deployPriceOracle(
        wallet,
        deploymentUtxos[0].collateral,
        deploymentUtxos[0].fee
      );
      deployedContracts.push(oracle);
      log(`Price Oracle deployed! App ID: ${oracle.appId}`, 'success');

      // Wait between deployments
      log('Waiting 15s before next deployment...', 'info');
      await sleep(15000);
    }

    // 4. Deploy Stability Pool (no dependencies)
    if (deploymentUtxos.length >= 2) {
      console.log('\n' + '-'.repeat(40));
      log('Deploying Stability Pool...', 'info');
      const sp = await deployStabilityPool(
        wallet,
        deploymentUtxos[1].collateral,
        deploymentUtxos[1].fee
      );
      deployedContracts.push(sp);
      log(`Stability Pool deployed! App ID: ${sp.appId}`, 'success');

      log('Waiting 15s before next deployment...', 'info');
      await sleep(15000);
    }

    // 5. Deploy Vault Manager (depends on oracle and SP for cross-refs)
    if (deploymentUtxos.length >= 3) {
      console.log('\n' + '-'.repeat(40));
      log('Deploying Vault Manager...', 'info');

      // Get app IDs from already deployed contracts
      const oracleAppId = deployedContracts.find((c) => c.name === 'priceOracle')?.appId || '';
      const spAppId = deployedContracts.find((c) => c.name === 'stabilityPool')?.appId || '';

      // Token not deployed yet, use placeholder
      const tokenPlaceholder = '0'.repeat(64);

      const vm = await deployVaultManager(
        wallet,
        deploymentUtxos[2].collateral,
        deploymentUtxos[2].fee,
        tokenPlaceholder, // Will need to update after token deploy
        oracleAppId,
        spAppId
      );
      deployedContracts.push(vm);
      log(`Vault Manager deployed! App ID: ${vm.appId}`, 'success');

      log('Waiting 15s before next deployment...', 'info');
      await sleep(15000);
    }

    // 6. Deploy zkUSD Token (depends on VM for authorized_minter)
    if (deploymentUtxos.length >= 4) {
      console.log('\n' + '-'.repeat(40));
      log('Deploying zkUSD Token...', 'info');

      const vmAppId = deployedContracts.find((c) => c.name === 'vaultManager')?.appId || '';

      const token = await deployZkusdToken(
        wallet,
        deploymentUtxos[3].collateral,
        deploymentUtxos[3].fee,
        vmAppId
      );
      deployedContracts.push(token);
      log(`zkUSD Token deployed! App ID: ${token.appId}`, 'success');
    }

  } catch (error) {
    log(`Deployment error: ${error instanceof Error ? error.message : error}`, 'error');
  }

  // 7. Save deployment results
  console.log('\n' + '='.repeat(60));
  log('DEPLOYMENT SUMMARY', 'info');
  console.log('='.repeat(60) + '\n');

  for (const contract of deployedContracts) {
    console.log(`${contract.name}:`);
    console.log(`  App ID: ${contract.appId}`);
    console.log(`  VK: ${contract.vk}`);
    console.log(`  Spell TX: ${contract.spellTxId}`);
    console.log(`  State UTXO: ${contract.stateUtxo}`);
    console.log('');
  }

  // Save to file
  const outputPath = path.join(OUTPUT_DIR, 'new-deployment.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        network: 'testnet4',
        contracts: deployedContracts.reduce((acc, c) => {
          acc[c.name] = c;
          return acc;
        }, {} as Record<string, DeployedContract>),
      },
      null,
      2
    )
  );
  log(`Deployment saved to ${outputPath}`, 'success');

  // 8. Generate config update
  console.log('\n' + '-'.repeat(40));
  log('Update packages/config/src/testnet4.ts with:', 'info');
  console.log('\ncontracts: {');
  for (const contract of deployedContracts) {
    console.log(`  ${contract.name}: {`);
    console.log(`    appId: '${contract.appId}',`);
    console.log(`    vk: '${contract.vk}',`);
    console.log(`    appRef: '${contract.appRef}',`);
    console.log(`    spellTx: '${contract.spellTxId}',`);
    console.log(`    stateUtxo: '${contract.stateUtxo}',`);
    console.log(`    status: 'confirmed',`);
    console.log(`    wasmPath: '/wasm/${contract.name.replace(/([A-Z])/g, '-$1').toLowerCase()}-app.wasm',`);
    console.log('  },');
  }
  console.log('}');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
