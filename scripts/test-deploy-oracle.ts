#!/usr/bin/env npx ts-node
/**
 * Test deployment script - Deploy only Price Oracle
 * This tests the full deployment workflow before attempting all contracts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const WALLET_PATH = path.join(ROOT_DIR, 'deployments/testnet4/wallet.json');
const WASM_PATH = path.join(ROOT_DIR, 'apps/web/public/wasm/zkusd-price-oracle-app.wasm');

const MEMPOOL_API = 'https://mempool.space/testnet4/api';
const CHARMS_PROVER_API = 'https://v8.charms.dev/spells/prove';

interface WalletConfig {
  address: string;
  public_key: string;
  private_key_wif: string;
}

interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

// ============================================================================
// Utility Functions
// ============================================================================

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const response = await fetch(`${MEMPOOL_API}/address/${address}/utxo`);
  if (!response.ok) throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
  return response.json() as Promise<Utxo[]>;
}

async function fetchRawTx(txid: string): Promise<string> {
  const response = await fetch(`${MEMPOOL_API}/tx/${txid}/hex`);
  if (!response.ok) throw new Error(`Failed to fetch raw tx: ${response.statusText}`);
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

function getVk(wasmPath: string): string {
  return execSync(`charms app vk "${wasmPath}"`, { encoding: 'utf-8' }).trim();
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n=== Test Deploy: Price Oracle ===\n');

  // 1. Load wallet
  console.log('Loading wallet...');
  const wallet: WalletConfig = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  console.log(`  Address: ${wallet.address}`);

  // 2. Get VK
  console.log('\nGetting VK...');
  const vk = getVk(WASM_PATH);
  console.log(`  VK: ${vk}`);

  // 3. Get UTXOs
  console.log('\nFetching UTXOs...');
  const utxos = await fetchUtxos(wallet.address);
  const confirmed = utxos
    .filter((u) => u.status.confirmed && u.value > 1000)
    .sort((a, b) => b.value - a.value);

  console.log(`  Found ${confirmed.length} usable UTXOs`);

  if (confirmed.length < 2) {
    console.error('  ERROR: Need at least 2 UTXOs (1 for collateral, 1 for fees)');
    process.exit(1);
  }

  // Use smallest usable for collateral, largest for fees
  const collateralUtxo = confirmed[confirmed.length - 1]; // Smallest
  const feeUtxo = confirmed[0]; // Largest

  console.log(`  Collateral UTXO: ${collateralUtxo.txid}:${collateralUtxo.vout} (${collateralUtxo.value} sats)`);
  console.log(`  Fee UTXO: ${feeUtxo.txid}:${feeUtxo.vout} (${feeUtxo.value} sats)`);

  // 4. Build spell
  console.log('\nBuilding spell...');

  const adminPubkey = wallet.public_key;
  // Create admin hash from pubkey
  const pubkeyBytes = hexToBytes(adminPubkey);
  const adminHash = crypto.createHash('sha256').update(Buffer.from(pubkeyBytes)).digest();
  const admin = Array.from(adminHash.slice(0, 32));

  // For new deployment, we need to generate a unique app ID first
  // The app ID is typically derived from the first output of the spell tx
  // For deployment, we can use a placeholder and let the prover determine it
  // BUT the prover API expects the app_id to be pre-determined

  // Actually, looking at existing YAML spells, they use pre-computed App IDs
  // This means deployment requires:
  // 1. First compute what the App ID will be (from the genesis UTXO)
  // 2. Then create the spell with that App ID

  // The app ID is derived from: SHA256(genesis_utxo_txid || genesis_utxo_vout)
  // Since our collateral UTXO will become the genesis UTXO for this charm
  const genesisInput = `${collateralUtxo.txid}:${collateralUtxo.vout}`;
  const appIdBuffer = crypto.createHash('sha256')
    .update(Buffer.from(genesisInput, 'utf-8'))
    .digest();
  const appId = appIdBuffer.toString('hex');

  console.log(`  Computed App ID: ${appId}`);

  const appRef = `n/${appId}/${vk}`;
  const appName = '$ORACLE';

  // Initial price: $104,000 with 8 decimals
  const initialPrice = 10400000000000;

  // PriceSource enum variant name (serde default)
  const priceSourceMock = 'Mock';

  // Build the OracleState with proper nested structure
  // Matches Rust: OracleState { price: PriceData, operator, admin, is_active, last_valid_price }
  const oracleState = {
    price: {
      price: initialPrice,
      timestamp_block: 0,
      source: priceSourceMock,
      confidence: 100,
    },
    operator: admin, // Same as admin for initial deployment
    admin: admin,
    is_active: true,
    last_valid_price: initialPrice,
  };

  // InitWitness for the operation
  const initWitness = {
    op: 0, // INITIALIZE
    admin: admin,
    operator: admin, // Same as admin initially
    price: initialPrice,
  };

  const spell = {
    version: 8,
    apps: {
      [appName]: appRef,
    },
    private_inputs: {
      [appName]: initWitness,
    },
    ins: [
      {
        utxo_id: `${collateralUtxo.txid}:${collateralUtxo.vout}`,
        charms: {},
      },
    ],
    outs: [
      {
        address: wallet.address,
        charms: {
          [appName]: oracleState,
        },
      },
    ],
  };

  console.log('  Spell built successfully');
  console.log(JSON.stringify(spell, null, 2));

  // 5. Load WASM
  console.log('\nLoading WASM binary...');
  const wasmBase64 = fs.readFileSync(WASM_PATH).toString('base64');
  console.log(`  WASM size: ${Math.round(wasmBase64.length * 0.75 / 1024)} KB`);

  // 6. Fetch prev_txs
  console.log('\nFetching previous transactions...');
  const [collateralPrevTx, feePrevTx] = await Promise.all([
    fetchRawTx(collateralUtxo.txid),
    fetchRawTx(feeUtxo.txid),
  ]);
  console.log(`  Collateral prev_tx: ${collateralPrevTx.length / 2} bytes`);
  console.log(`  Fee prev_tx: ${feePrevTx.length / 2} bytes`);

  // 7. Call prover
  console.log('\nCalling Charms prover API...');
  console.log('  (This may take several minutes for ZK proof generation)');

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

  // Save request for debugging
  fs.writeFileSync('/tmp/prover-request.json', JSON.stringify(requestBody, null, 2));
  console.log('  Request saved to /tmp/prover-request.json');

  const startTime = Date.now();
  const response = await fetch(CHARMS_PROVER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`  Response received in ${elapsed.toFixed(1)}s`);

  if (!response.ok) {
    const error = await response.text();
    console.error(`  ERROR: Prover failed (${response.status})`);
    console.error(`  ${error}`);
    fs.writeFileSync('/tmp/prover-error.txt', error);
    process.exit(1);
  }

  const result = await response.json();
  fs.writeFileSync('/tmp/prover-response.json', JSON.stringify(result, null, 2));
  console.log('  Response saved to /tmp/prover-response.json');

  if (!Array.isArray(result) || result.length !== 2) {
    console.error('  ERROR: Invalid response format');
    console.error(JSON.stringify(result));
    process.exit(1);
  }

  const commitTx = result[0].bitcoin || result[0];
  const spellTx = result[1].bitcoin || result[1];

  console.log(`  Commit TX: ${commitTx.length / 2} bytes`);
  console.log(`  Spell TX: ${spellTx.length / 2} bytes`);

  // 8. The prover returns signed transactions, try to broadcast
  console.log('\nBroadcasting transactions...');

  try {
    console.log('  Broadcasting commit TX...');
    const commitTxId = await broadcastTx(commitTx);
    console.log(`  Commit TX ID: ${commitTxId}`);

    console.log('  Waiting 10s for propagation...');
    await new Promise((r) => setTimeout(r, 10000));

    console.log('  Broadcasting spell TX...');
    const spellTxId = await broadcastTx(spellTx);
    console.log(`  Spell TX ID: ${spellTxId}`);

    console.log('\n=== DEPLOYMENT SUCCESSFUL ===');
    console.log(`  App ID: (derived from spell tx - check on explorer)`);
    console.log(`  VK: ${vk}`);
    console.log(`  Spell TX: ${spellTxId}`);
    console.log(`  State UTXO: ${spellTxId}:0`);
    console.log(`  Explorer: https://mempool.space/testnet4/tx/${spellTxId}`);

  } catch (broadcastError) {
    console.error('\n  Broadcast failed:', broadcastError);
    console.log('\n  Transactions saved to /tmp/ for manual broadcast');
    fs.writeFileSync('/tmp/commit.hex', commitTx);
    fs.writeFileSync('/tmp/spell.hex', spellTx);
    console.log('  - /tmp/commit.hex');
    console.log('  - /tmp/spell.hex');
    console.log('\n  Try manual broadcast with:');
    console.log('    curl -X POST https://mempool.space/testnet4/api/tx -d @/tmp/commit.hex');
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
