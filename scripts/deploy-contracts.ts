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
  };
  vaultManager: {
    utxo: Utxo;
    appId: string;
    vk: string;
  };
  stabilityPool: {
    utxo: Utxo;
    appId: string;
    vk: string;
  };
  fundingUtxo: Utxo;
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

  // Fetch prev_txs
  log('Fetching previous transactions...');
  const [utxoPrevTx, fundingPrevTx] = await Promise.all([
    fetchRawTx(utxo.txid),
    fetchRawTx(fundingUtxo.txid),
  ]);

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

  // Save transactions
  fs.writeFileSync(`/tmp/zkusd-${name}-commit.hex`, commitTx);
  fs.writeFileSync(`/tmp/zkusd-${name}-spell.hex`, spellTx);
  log('Transactions saved to /tmp/');

  // Broadcast
  log('Broadcasting commit transaction...');
  const commitTxId = await broadcastTx(commitTx);
  log(`Commit TX ID: ${commitTxId}`);

  log('Waiting 10s for propagation...');
  await new Promise(r => setTimeout(r, 10000));

  log('Broadcasting spell transaction...');
  const spellTxId = await broadcastTx(spellTx);
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
  const contractFilter = args.find((_, i, arr) => arr[i - 1] === '--contract');

  log('zkUSD Contract Deployment Script');
  log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DEPLOYMENT'}`);
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
  const utxos = allUtxos
    .filter(u => u.status.confirmed && u.value >= 547)
    .sort((a, b) => b.value - a.value);

  log(`Found ${utxos.length} usable UTXOs`);

  // Need at least 4 UTXOs: 3 for contracts + 1 for funding
  if (utxos.length < 4) {
    throw new Error('Need at least 4 UTXOs for deployment (3 contracts + 1 funding)');
  }

  // Select UTXOs
  // Use largest for funding, next 3 for contracts
  const fundingUtxo = utxos[0];
  const tokenUtxo = utxos[1];
  const spUtxo = utxos[2];
  const vmUtxo = utxos[3];

  // Compute App IDs
  const plan: DeploymentPlan = {
    token: {
      utxo: tokenUtxo,
      appId: computeAppId(tokenUtxo),
      vk: tokenVk,
    },
    vaultManager: {
      utxo: vmUtxo,
      appId: computeAppId(vmUtxo),
      vk: vmVk,
    },
    stabilityPool: {
      utxo: spUtxo,
      appId: computeAppId(spUtxo),
      vk: spVk,
    },
    fundingUtxo,
  };

  log('\nDeployment Plan:');
  log(`  Funding UTXO: ${fundingUtxo.txid}:${fundingUtxo.vout} (${fundingUtxo.value} sats)`);
  log(`  Token UTXO: ${tokenUtxo.txid}:${tokenUtxo.vout} -> App ID: ${plan.token.appId.slice(0, 16)}...`);
  log(`  SP UTXO: ${spUtxo.txid}:${spUtxo.vout} -> App ID: ${plan.stabilityPool.appId.slice(0, 16)}...`);
  log(`  VM UTXO: ${vmUtxo.txid}:${vmUtxo.vout} -> App ID: ${plan.vaultManager.appId.slice(0, 16)}...`);

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
      fundingUtxo,
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
      fundingUtxo,
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
      fundingUtxo,
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
