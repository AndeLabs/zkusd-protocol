#!/usr/bin/env npx ts-node
/**
 * zkUSD Contract Deployment Script
 *
 * Deploys Charms contracts without requiring a local Bitcoin node.
 * Uses mempool.space API for transactions and Charms prover API.
 *
 * Usage:
 *   npx ts-node scripts/deploy-contract.ts --contract price-oracle
 *   npx ts-node scripts/deploy-contract.ts --contract vault-manager
 *
 * Prerequisites:
 *   - Funded wallet in deployments/testnet4/wallet.json
 *   - Compiled WASM in apps/web/public/wasm/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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

interface DeploymentResult {
  appId: string;
  vk: string;
  appRef: string;
  commitTxId: string;
  spellTxId: string;
  stateUtxo: string;
}

// ============================================================================
// Configuration
// ============================================================================

const CONTRACTS = {
  'price-oracle': {
    name: 'zkusd-price-oracle-app',
    wasmPath: 'apps/web/public/wasm/zkusd-price-oracle-app.wasm',
    initialState: {
      _type: 'PriceOracleState',
      price: 10400000000000, // $104,000 in 8 decimals
      last_update_block: 0,
      admin: [], // Will be filled with admin bytes
    },
  },
  'zkusd-token': {
    name: 'zkusd-token-app',
    wasmPath: 'apps/web/public/wasm/zkusd-token-app.wasm',
    initialState: {
      _type: 'TokenState',
      authorized_minter: [], // Will be filled with VM app ID
      total_supply: 0,
    },
  },
  'vault-manager': {
    name: 'zkusd-vault-manager-app',
    wasmPath: 'apps/web/public/wasm/zkusd-vault-manager-app.wasm',
    initialState: {
      _type: 'VaultManagerState',
      zkusd_token_id: [], // Will be filled with token app ID
      stability_pool_id: [], // Will be filled with SP app ID
      oracle_id: [], // Will be filled with oracle app ID
      active_pool: [], // Will be filled with admin
      default_pool: [], // Will be filled with admin
      total_collateral: 0,
      total_debt: 0,
      active_vault_count: 0,
      base_rate: 50,
      last_fee_operation_block: 0,
      is_paused: false,
    },
  },
  'stability-pool': {
    name: 'zkusd-stability-pool-app',
    wasmPath: 'apps/web/public/wasm/zkusd-stability-pool-app.wasm',
    initialState: {
      _type: 'StabilityPoolState',
      total_zkusd: 0,
      total_btc: 0,
      product_p: '1000000000000000000', // 10^18
      epoch_sum_s: [],
      depositor_count: 0,
    },
  },
};

const MEMPOOL_API = 'https://mempool.space/testnet4/api';
const CHARMS_PROVER_API = 'https://v8.charms.dev/spells/prove';

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
  const { execSync } = require('child_process');
  const result = execSync(`charms app vk ${wasmPath}`, { encoding: 'utf-8' });
  return result.trim();
}

// ============================================================================
// Deployment Logic
// ============================================================================

function loadWallet(): WalletConfig {
  const walletPath = path.join(process.cwd(), 'deployments/testnet4/wallet.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}`);
  }
  return JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
}

function loadWasmBase64(wasmPath: string): string {
  const fullPath = path.join(process.cwd(), wasmPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`WASM not found at ${fullPath}`);
  }
  const wasm = fs.readFileSync(fullPath);
  return wasm.toString('base64');
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function generateAppId(fundingUtxo: string, vout: number): string {
  // App ID is derived from the genesis UTXO
  const input = `${fundingUtxo}:${vout}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hash;
}

async function selectUtxos(
  utxos: Utxo[],
  minCollateral: number,
  minFee: number
): Promise<{ collateralUtxo: Utxo; feeUtxo: Utxo }> {
  // Sort by value descending
  const sorted = [...utxos]
    .filter((u) => u.status.confirmed)
    .sort((a, b) => b.value - a.value);

  if (sorted.length < 2) {
    throw new Error(
      `Need at least 2 confirmed UTXOs. Found: ${sorted.length}. ` +
        'Please split UTXOs or wait for confirmations.'
    );
  }

  const collateralUtxo = sorted.find((u) => u.value >= minCollateral);
  const feeUtxo = sorted.find((u) => u !== collateralUtxo && u.value >= minFee);

  if (!collateralUtxo || !feeUtxo) {
    throw new Error(
      `Insufficient UTXOs. Need ${minCollateral} sats for collateral and ${minFee} sats for fees.`
    );
  }

  return { collateralUtxo, feeUtxo };
}

async function buildDeploySpell(
  contractKey: keyof typeof CONTRACTS,
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  vk: string
): Promise<object> {
  const contract = CONTRACTS[contractKey];
  const appRef = `n/new/${vk}`;
  const collateralUtxoId = `${collateralUtxo.txid}:${collateralUtxo.vout}`;

  // Build initial state with proper admin/cross-references
  const adminBytes = hexToBytes(wallet.public_key.slice(2)); // Remove '03' or '02' prefix
  const state = { ...contract.initialState };

  // Fill in admin/cross-references based on contract type
  if ('admin' in state) {
    state.admin = adminBytes;
  }
  if ('active_pool' in state) {
    state.active_pool = adminBytes;
    state.default_pool = adminBytes;
  }

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
          [appRef]: state,
        },
      },
    ],
  };
}

async function proveSpell(
  spell: object,
  wasmPath: string,
  vk: string,
  prevTxs: string[],
  fundingUtxo: Utxo,
  changeAddress: string
): Promise<{ commitTx: string; spellTx: string }> {
  const wasmBase64 = loadWasmBase64(wasmPath);

  const requestBody = {
    spell,
    binaries: {
      [vk]: wasmBase64,
    },
    prev_txs: prevTxs.map((tx) => ({ bitcoin: tx })),
    funding_utxo: `${fundingUtxo.txid}:${fundingUtxo.vout}`,
    funding_utxo_value: fundingUtxo.value,
    change_address: changeAddress,
    fee_rate: 5, // 5 sat/vbyte
    chain: 'bitcoin',
  };

  console.log('Sending prove request to Charms API...');
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

// ============================================================================
// Main
// ============================================================================

async function deployContract(contractKey: keyof typeof CONTRACTS): Promise<DeploymentResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Deploying: ${contractKey}`);
  console.log(`${'='.repeat(60)}\n`);

  const contract = CONTRACTS[contractKey];

  // 1. Load wallet
  console.log('Loading wallet...');
  const wallet = loadWallet();
  console.log(`  Address: ${wallet.address}`);

  // 2. Get VK
  console.log('\nCalculating VK...');
  const vk = await getVk(path.join(process.cwd(), contract.wasmPath));
  console.log(`  VK: ${vk}`);

  // 3. Get UTXOs
  console.log('\nFetching UTXOs...');
  const utxos = await fetchUtxos(wallet.address);
  console.log(`  Found ${utxos.length} UTXOs`);

  // 4. Select UTXOs
  const { collateralUtxo, feeUtxo } = await selectUtxos(utxos, 1000, 50000);
  console.log(`  Collateral UTXO: ${collateralUtxo.txid}:${collateralUtxo.vout} (${collateralUtxo.value} sats)`);
  console.log(`  Fee UTXO: ${feeUtxo.txid}:${feeUtxo.vout} (${feeUtxo.value} sats)`);

  // 5. Fetch prev txs
  console.log('\nFetching previous transactions...');
  const [collateralPrevTx, feePrevTx] = await Promise.all([
    fetchRawTx(collateralUtxo.txid),
    fetchRawTx(feeUtxo.txid),
  ]);

  // 6. Build spell
  console.log('\nBuilding deployment spell...');
  const spell = await buildDeploySpell(contractKey, wallet, collateralUtxo, vk);
  console.log(JSON.stringify(spell, null, 2));

  // 7. Prove spell
  console.log('\nProving spell (this may take a few minutes)...');
  const { commitTx, spellTx } = await proveSpell(
    spell,
    contract.wasmPath,
    vk,
    [collateralPrevTx, feePrevTx],
    feeUtxo,
    wallet.address
  );

  console.log(`  Commit TX size: ${commitTx.length / 2} bytes`);
  console.log(`  Spell TX size: ${spellTx.length / 2} bytes`);

  // 8. Sign transactions (for testnet, we can sign without full wallet)
  // Note: In production, this would use proper signing with the private key
  console.log('\n*** SIGNING NOT YET IMPLEMENTED ***');
  console.log('The transactions need to be signed before broadcasting.');
  console.log('Raw transactions saved to /tmp/deploy_txs.json');

  fs.writeFileSync(
    '/tmp/deploy_txs.json',
    JSON.stringify({ commitTx, spellTx, vk, contract: contractKey }, null, 2)
  );

  // For now, return placeholder
  const appId = generateAppId(collateralUtxo.txid, collateralUtxo.vout);

  return {
    appId,
    vk,
    appRef: `n/${appId}/${vk}`,
    commitTxId: 'NEEDS_SIGNING',
    spellTxId: 'NEEDS_SIGNING',
    stateUtxo: 'NEEDS_SIGNING:0',
  };
}

// Parse arguments and run
const args = process.argv.slice(2);
const contractArg = args.find((a) => a.startsWith('--contract='))?.split('=')[1] ||
  args[args.indexOf('--contract') + 1];

if (!contractArg || !(contractArg in CONTRACTS)) {
  console.log('Usage: npx ts-node scripts/deploy-contract.ts --contract <name>');
  console.log('\nAvailable contracts:');
  Object.keys(CONTRACTS).forEach((k) => console.log(`  - ${k}`));
  process.exit(1);
}

deployContract(contractArg as keyof typeof CONTRACTS)
  .then((result) => {
    console.log('\n=== Deployment Result ===');
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error('\nDeployment failed:', err.message);
    process.exit(1);
  });
