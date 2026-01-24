#!/usr/bin/env npx ts-node
/**
 * zkUSD Unified Deployment Script
 *
 * Single entry point for all contract deployments.
 * Uses mempool.space API (no Bitcoin Core required).
 *
 * Usage:
 *   npx ts-node scripts/deploy.ts --contract vault-manager
 *   npx ts-node scripts/deploy.ts --contract price-oracle --dry-run
 *   npx ts-node scripts/deploy.ts --list
 *
 * Prerequisites:
 *   - Funded wallet in deployments/testnet4/wallet.json
 *   - Compiled WASM in apps/web/public/wasm/
 *   - charms CLI installed (for VK calculation)
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
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

// Cross-references from V3 deployment (Jan 2026)
// Updated Jan 24, 2026 with new Stability Pool deployment
const DEPLOYED_CONTRACTS = {
  priceOracle: '26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5',
  zkusdToken: '7ff62ba48cbb4e8437aab1a32050ad0e4c8c874db34ab10aa015a9d98bddcef1',
  // NEW: Stability Pool V5 - deployed 2026-01-24
  stabilityPool: 'b9412ca5d8ed6ca34d5b316ca51c960c8bc69aa96de467c9e4eb7bbfab24e320',
  vaultManager: 'ca8ab2dc30c97b7be1d6e9175c33f828aac447917ff5605fca0ff3acffcb1fa9',
};

const CONTRACTS: Record<string, ContractConfig> = {
  'price-oracle': {
    name: 'Price Oracle',
    wasmPath: 'apps/web/public/wasm/zkusd-price-oracle-app.wasm',
    buildInitialState: (adminBytes: number[]) => ({
      _type: 'PriceOracleState',
      price: 10400000000000, // $104,000 in 8 decimals
      last_update_block: 0,
      admin: adminBytes,
    }),
  },
  'zkusd-token': {
    name: 'zkUSD Token',
    wasmPath: 'apps/web/public/wasm/zkusd-token-app.wasm',
    buildInitialState: () => ({
      _type: 'TokenState',
      authorized_minter: hexToBytes(DEPLOYED_CONTRACTS.vaultManager),
      total_supply: 0,
    }),
  },
  'vault-manager': {
    name: 'Vault Manager',
    wasmPath: 'apps/web/public/wasm/zkusd-vault-manager-app.wasm',
    // V5 VK: 8b3834c2f233d1abc6b1473833f4addd113873e21624a6ddf419406c09e1fa42
    buildInitialState: (adminBytes: number[]) => ({
      // Correct structure matching VaultManagerState in Rust
      protocol: {
        total_collateral: 0,
        total_debt: 0,
        active_vault_count: 0,
        base_rate: 50,
        last_fee_update_block: 0,
        admin: adminBytes,
        is_paused: false,
      },
      zkusd_token_id: hexToBytes(DEPLOYED_CONTRACTS.zkusdToken),
      stability_pool_id: hexToBytes(DEPLOYED_CONTRACTS.stabilityPool),
      price_oracle_id: hexToBytes(DEPLOYED_CONTRACTS.priceOracle),
      active_pool: adminBytes,
      default_pool: adminBytes,
    }),
    // InitWitness for INITIALIZE operation (op=0x00)
    buildInitWitness: (adminBytes: number[]) => ({
      op: 0,
      admin: adminBytes,
      zkusd_token_id: hexToBytes(DEPLOYED_CONTRACTS.zkusdToken),
      stability_pool_id: hexToBytes(DEPLOYED_CONTRACTS.stabilityPool),
      price_oracle_id: hexToBytes(DEPLOYED_CONTRACTS.priceOracle),
      active_pool: adminBytes,
      default_pool: adminBytes,
    }),
  },
  'stability-pool': {
    name: 'Stability Pool',
    wasmPath: 'apps/web/public/wasm/zkusd-stability-pool-app.wasm',
    // Flat structure - all fields at same level (Charms template pattern)
    buildInitialState: (adminBytes: number[]) => ({
      // Config fields
      zkusd_token_id: hexToBytes(DEPLOYED_CONTRACTS.zkusdToken),
      vault_manager_id: hexToBytes(DEPLOYED_CONTRACTS.vaultManager),
      admin: adminBytes,
      // State fields
      total_zkusd: 0,
      total_btc: 0,
      product_p: '1000000000000000000',
      sum_s: 0,
      current_epoch: 0,
      current_scale: 0,
      depositor_count: 0,
    }),
    // Witness: simple string format (UTXO ID) - Charms template pattern
    useSimpleWitness: true,
  },
};

// ============================================================================
// Types
// ============================================================================

interface ContractConfig {
  name: string;
  wasmPath: string;
  buildInitialState: (adminBytes: number[]) => object;
  buildInitWitness?: (adminBytes: number[]) => object;
  useSimpleWitness?: boolean;  // Use UTXO ID string as witness (Charms template pattern)
}

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

interface DeploymentResult {
  contract: string;
  version: string;
  network: string;
  deployed_at: string;
  appId: string;
  vk: string;
  appRef: string;
  commitTxId: string;
  spellTxId: string;
  stateUtxo: string;
  explorer: string;
}

// ============================================================================
// Utilities
// ============================================================================

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function log(message: string, indent = 0): void {
  const prefix = '   '.repeat(indent);
  console.log(`${prefix}${message}`);
}

function logSection(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const response = await fetch(`${MEMPOOL_API}/address/${address}/utxo`);
  if (!response.ok) throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
  return response.json() as Promise<Utxo[]>;
}

async function fetchRawTx(txid: string): Promise<string> {
  const response = await fetch(`${MEMPOOL_API}/tx/${txid}/hex`);
  if (!response.ok) throw new Error(`Failed to fetch tx ${txid}`);
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

async function getFeeRate(): Promise<number> {
  try {
    const response = await fetch(`${MEMPOOL_API}/v1/fees/recommended`);
    if (!response.ok) return 5;
    const fees = await response.json() as { halfHourFee?: number };
    return fees.halfHourFee || 5;
  } catch {
    return 5;
  }
}

// ============================================================================
// Core Functions
// ============================================================================

function loadWallet(): WalletConfig {
  const walletPath = path.join(process.cwd(), 'deployments/testnet4/wallet.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}\nCreate with: scripts/create-wallet.ts`);
  }
  return JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
}

function getVk(wasmPath: string): string {
  const fullPath = path.join(process.cwd(), wasmPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`WASM not found: ${fullPath}\nBuild with: cd contracts/<name> && charms app build`);
  }
  try {
    return execSync(`charms app vk ${fullPath}`, { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Failed to get VK. Is charms CLI installed?\nInstall: cargo install --locked charms');
  }
}

function loadWasmBase64(wasmPath: string): string {
  const fullPath = path.join(process.cwd(), wasmPath);
  return fs.readFileSync(fullPath).toString('base64');
}

function formatYamlValue(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // For byte arrays (numbers 0-255), format inline
    if (value.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
      return `[${value.join(', ')}]`;
    }
    return '[]';
  }
  if (typeof value === 'object' && value !== null) {
    // Nested object
    const lines = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${indent}  ${k}: ${formatYamlValue(v, indent + '  ')}`);
    return '\n' + lines.join('\n');
  }
  if (typeof value === 'boolean') return value.toString();
  if (typeof value === 'string') {
    // Check if it's a numeric string (for large integers like u128)
    // Output without quotes so YAML parser treats it as number
    if (/^\d+$/.test(value) && value.length <= 40) {
      return value;
    }
    return `"${value}"`;
  }
  return String(value);
}

function buildSpellYaml(
  contract: ContractConfig,
  wallet: WalletConfig,
  collateralUtxo: Utxo,
  vk: string
): string {
  const adminBytes = hexToBytes(wallet.public_key.slice(2));
  const state = contract.buildInitialState(adminBytes);
  const witness = contract.buildInitWitness?.(adminBytes);

  // Build state YAML with proper indentation for nested objects
  const stateLines = Object.entries(state)
    .map(([key, value]) => {
      const formatted = formatYamlValue(value, '        ');
      if (formatted.startsWith('\n')) {
        return `        ${key}:${formatted}`;
      }
      return `        ${key}: ${formatted}`;
    })
    .join('\n');

  // CLI format: n/<identity_hex>/<vk_hex>
  // For new deployments, use collateral UTXO txid as identity (genesis)
  const genesisId = collateralUtxo.txid;

  // Build private_inputs section
  let privateInputsSection = '';
  if (contract.useSimpleWitness) {
    // Simple string witness pattern (Charms template style)
    const utxoIdStr = `${collateralUtxo.txid}:${collateralUtxo.vout}`;
    privateInputsSection = `
private_inputs:
  ${vk}: "${utxoIdStr}"
`;
  } else if (witness) {
    // Struct witness pattern
    const witnessLines = Object.entries(witness)
      .map(([key, value]) => {
        const formatted = formatYamlValue(value, '    ');
        if (formatted.startsWith('\n')) {
          return `    ${key}:${formatted}`;
        }
        return `    ${key}: ${formatted}`;
      })
      .join('\n');
    privateInputsSection = `
private_inputs:
  ${vk}:
${witnessLines}
`;
  }

  return `version: 9
apps:
  ${vk}: n/${genesisId}/${vk}${privateInputsSection}
ins:
  - utxo_id: "${collateralUtxo.txid}:${collateralUtxo.vout}"
    charms: {}
outs:
  - address: ${wallet.address}
    charms:
      ${vk}:
${stateLines}
`;
}

async function proveSpellWithCli(
  spellYaml: string,
  wasmPath: string,
  prevTxs: string[],
  fundingUtxo: Utxo,
  changeAddress: string,
  feeRate: number,
  useMock = false
): Promise<{ commitTx: string; spellTx: string }> {
  const outputDir = path.join(process.cwd(), 'deployments/testnet4/pending');
  fs.mkdirSync(outputDir, { recursive: true });

  // Write spell YAML
  const spellFile = path.join(outputDir, 'deploy-spell.yaml');
  fs.writeFileSync(spellFile, spellYaml);

  // Build charms CLI command
  const wasmFullPath = path.join(process.cwd(), wasmPath);
  const prevTxsArg = prevTxs.join(',');
  const fundingUtxoId = `${fundingUtxo.txid}:${fundingUtxo.vout}`;

  const cmdParts = [
    'charms', 'spell', 'prove',
    '--spell', spellFile,
    '--app-bins', wasmFullPath,
    '--prev-txs', prevTxsArg,
    '--funding-utxo', fundingUtxoId,
    '--funding-utxo-value', String(fundingUtxo.value),
    '--change-address', changeAddress,
    '--fee-rate', String(feeRate),
    '--chain', 'bitcoin',
  ];
  if (useMock) {
    cmdParts.push('--mock');
  }
  const cmd = cmdParts.join(' ');

  log(`Running: charms spell prove`, 1);
  log(`Spell file: ${spellFile}`, 1);

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });

    // Parse output - last line should be JSON array of transactions
    const lines = output.trim().split('\n');
    const jsonLine = lines[lines.length - 1];

    let result;
    try {
      result = JSON.parse(jsonLine);
    } catch {
      // Maybe the whole output is JSON
      result = JSON.parse(output);
    }

    if (!Array.isArray(result)) {
      throw new Error(`Invalid prover output: expected array, got ${jsonLine.slice(0, 200)}`);
    }

    // Handle different prover output formats
    if (result.length === 1) {
      // Single combined transaction (newer Charms versions or mock mode)
      const tx = result[0].bitcoin || result[0];
      return {
        commitTx: tx,
        spellTx: tx,  // Same tx - will only broadcast once
      };
    }

    if (result.length === 2) {
      // Traditional two-transaction format (commit + spell)
      return {
        commitTx: result[0].bitcoin || result[0],
        spellTx: result[1].bitcoin || result[1],
      };
    }

    throw new Error(`Invalid prover output: expected 1 or 2 txs, got ${result.length}`);
  } catch (err) {
    const error = err as Error & { stderr?: string };
    throw new Error(`charms CLI failed: ${error.message}\n${error.stderr || ''}`);
  }
}

async function signCombinedTransaction(
  txHex: string,
  wallet: WalletConfig,
  collateralPrevTxHex: string,
  collateralVout: number,
  fundingPrevTxHex: string,
  fundingVout: number
): Promise<string> {
  const tx = bitcoin.Transaction.fromHex(txHex);
  const collateralPrevTx = bitcoin.Transaction.fromHex(collateralPrevTxHex);
  const fundingPrevTx = bitcoin.Transaction.fromHex(fundingPrevTxHex);

  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  // Add all inputs with their witnessUtxo
  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    let witnessUtxo;

    if (i === 0) {
      // Input 0 is collateral
      const prevOut = collateralPrevTx.outs[collateralVout];
      witnessUtxo = { script: prevOut.script, value: BigInt(prevOut.value) };
    } else if (i === 1) {
      // Input 1 is funding
      const prevOut = fundingPrevTx.outs[fundingVout];
      witnessUtxo = { script: prevOut.script, value: BigInt(prevOut.value) };
    } else {
      // Fetch other inputs if needed
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const inputPrevTx = bitcoin.Transaction.fromHex(await fetchRawTx(txid));
      const prevOut = inputPrevTx.outs[input.index];
      witnessUtxo = { script: prevOut.script, value: BigInt(prevOut.value) };
    }

    psbt.addInput({
      hash: input.hash,
      index: input.index,
      sequence: input.sequence,
      witnessUtxo,
    });
  }

  // Add all outputs
  for (const output of tx.outs) {
    psbt.addOutput({ script: output.script, value: BigInt(output.value) });
  }

  // Sign all inputs
  const privateKey = Buffer.from(wallet.private_key_hex, 'hex');
  const signer = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privateKey)),
  };

  for (let i = 0; i < tx.ins.length; i++) {
    psbt.signInput(i, signer);
  }

  // Finalize and extract
  const finalTx = tx.clone();
  for (let i = 0; i < tx.ins.length; i++) {
    const partialSig = psbt.data.inputs[i].partialSig;
    if (partialSig?.length) {
      finalTx.ins[i].witness = [partialSig[0].signature, partialSig[0].pubkey];
    }
  }

  return finalTx.toHex();
}

async function signTransaction(
  txHex: string,
  wallet: WalletConfig,
  inputIndex: number,
  prevTxHex: string,
  prevVout: number
): Promise<string> {
  const tx = bitcoin.Transaction.fromHex(txHex);
  const prevTx = bitcoin.Transaction.fromHex(prevTxHex);
  const prevOutput = prevTx.outs[prevVout];

  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  // Add all inputs
  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    if (i === inputIndex) {
      psbt.addInput({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: { script: prevOutput.script, value: BigInt(prevOutput.value) },
      });
    } else {
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const inputPrevTx = bitcoin.Transaction.fromHex(await fetchRawTx(txid));
      const inputPrevOut = inputPrevTx.outs[input.index];
      psbt.addInput({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: { script: inputPrevOut.script, value: BigInt(inputPrevOut.value) },
      });
    }
  }

  // Add outputs
  for (const output of tx.outs) {
    psbt.addOutput({ script: output.script, value: BigInt(output.value) });
  }

  // Sign
  const privateKey = Buffer.from(wallet.private_key_hex, 'hex');
  const signer = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privateKey)),
  };
  psbt.signInput(inputIndex, signer);

  const partialSig = psbt.data.inputs[inputIndex].partialSig;
  if (!partialSig?.length) throw new Error('Signing failed');

  const finalTx = tx.clone();
  finalTx.ins[inputIndex].witness = [partialSig[0].signature, partialSig[0].pubkey];
  return finalTx.toHex();
}

// ============================================================================
// Main Deployment Function
// ============================================================================

async function deploy(contractKey: string, isDryRun: boolean): Promise<DeploymentResult> {
  const contract = CONTRACTS[contractKey];
  if (!contract) {
    throw new Error(`Unknown contract: ${contractKey}`);
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Deploying: ${contract.name.padEnd(44)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (isDryRun) {
    log('\n🔍 DRY RUN - No transactions will be broadcast');
  }

  // 1. Load wallet
  logSection('Loading Wallet');
  const wallet = loadWallet();
  log(`Address: ${wallet.address}`);

  // 2. Calculate VK
  logSection('Calculating VK');
  const vk = getVk(contract.wasmPath);
  log(`VK: ${vk}`);

  // 3. Get UTXOs
  logSection('Fetching UTXOs');
  const utxos = await fetchUtxos(wallet.address);
  const confirmed = utxos.filter(u => u.status.confirmed).sort((a, b) => b.value - a.value);
  log(`Found ${confirmed.length} confirmed UTXOs`);

  if (confirmed.length < 2) {
    throw new Error('Need 2+ confirmed UTXOs for deployment');
  }

  // Sort by block height (most recent first) to use fresh UTXOs
  const byHeight = [...confirmed].sort((a, b) =>
    ((b.status as { block_height?: number }).block_height || 0) -
    ((a.status as { block_height?: number }).block_height || 0)
  );

  // ALL UTXOs from previous attempts are burned with the prover
  // Only fresh UTXOs from new faucet requests will work
  const burnedUtxos = [
    'fa1e910b896d1ebed8f3f13cc718f8e2aa5e21804157ba66b4fded21552cd1d3',
    'f9d78d57a74d374fc63121620b44dc924fb37f97a680c89b1b5a53bda2a19a9f',
    '17b3a1b61cc94f19bfb3a9ebb65323bd0bb184b35ebdc72836daa01f91e590df',
    '5cff4e4ff471c0341bf6154ba869e52a143f68487b78587f2db5a57f213fc518',
    '20d41c6e5b4df501f6394392a56a534730bc84794da1f8adabe5dc6084ee560c',
    'c7f436f44d97a8c67713e9cfecbd0f63222f8c6f1b6dc8af74cac860bf54e907',
    'aac009d17665311d94ec0accf48aad8db6a06c54cc383bb8933c28eb92b03f02',
    '3859354fa7c71791c62a08613c1168048a31fbeee46cab6d468c9198831b7866',
    '6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988',
    '458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423',
    'b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3',
    // 2026-01-23: Attempt with v0.12 SDK - "unexecutable" error
    'd93540abec20ae20159f9f4de685975f17ad68004b970ae765d71bad42103649',
    'da723ed8e69542b7c9552d3a461ff9c52b2fa8835970826bc6db9fbf71a832bd',
    // 2026-01-23: Attempt with v0.11.1 SDK - contract validated but funding UTXO burned
    'c49257d0a5ecc28b1c9919270eb799e85365de121ffb0a6432aec47af109cc11',
    '4af324cfb4ac98789ec8df037ecc2ee3fd96db70cf8b1342badc2ebb96b58547',
    // 2026-01-23: Second attempt with v0.11.1 - same duplicate error
    '7c9295a5f070a92938abb7de26569f7b38d4c18096cf4c4446cd33f1bc931e9c',
    '73758b50c86f19839c139402ededbcffea85a1f9aa79c7cb61cbf4db3c258a22',
    // 2026-01-23: Third attempt - also burned
    '67f1cfd8be188ff66363a57d741517d54cc2f06b80a149fd3e9b7b167e01af1a',
  ];
  // Collateral blocklist - UTXOs used in previous spell attempts (burned in prover cache)
  const collateralBlocklist = burnedUtxos;

  // Funding blocklist - EMPTY! We'll try using old UTXOs for funding
  // Theory: "duplicate funding UTXO" error only applies when same spell
  // With a fresh collateral UTXO (new app identity), old funding UTXOs might work
  const fundingBlocklist: string[] = [];

  // For collateral: need fresh UTXO (not in collateralBlocklist) - creates new spell
  const freshForCollateral = byHeight.filter(u =>
    !collateralBlocklist.includes(u.txid) && u.value >= 10000
  );

  // For funding: need UTXO not in fundingBlocklist (CAN use former collateral UTXOs)
  const freshForFunding = byHeight.filter(u =>
    !fundingBlocklist.includes(u.txid) && u.value >= 40000
  );

  if (freshForCollateral.length < 1) {
    throw new Error('Need fresh UTXO for collateral (not used as collateral before). Get new UTXOs from faucet.');
  }

  // Pick collateral first (must be fresh)
  const collateralUtxo = freshForCollateral[0];

  // Pick funding from available (excluding the exact UTXO we picked for collateral)
  // Allow different vouts from the same txid
  const fundingCandidates = freshForFunding.filter(u =>
    !(u.txid === collateralUtxo.txid && u.vout === collateralUtxo.vout)
  );
  if (fundingCandidates.length < 1) {
    throw new Error('Need UTXO for funding. Get new UTXOs from faucet.');
  }
  const feeUtxo = fundingCandidates[0];

  log(`Collateral: ${collateralUtxo.txid.slice(0, 8)}...:${collateralUtxo.vout} (${collateralUtxo.value} sats)`);
  log(`Fee:        ${feeUtxo.txid.slice(0, 8)}...:${feeUtxo.vout} (${feeUtxo.value} sats)`);

  // 4. Get fee rate
  const feeRate = await getFeeRate();
  log(`Fee rate: ${feeRate} sat/vB`);

  // 5. Build spell YAML
  logSection('Building Spell');
  const spellYaml = buildSpellYaml(contract, wallet, collateralUtxo, vk);
  if (isDryRun) {
    console.log(spellYaml);
  }

  // 6. Fetch prev txs
  logSection('Fetching Previous TXs');
  const [collateralPrevTx, feePrevTx] = await Promise.all([
    fetchRawTx(collateralUtxo.txid),
    fetchRawTx(feeUtxo.txid),
  ]);
  log('Done');

  // 7. Prove using charms CLI (use mock mode for dry-run to avoid prover cache issues)
  logSection(isDryRun ? 'Validating Spell (mock mode)' : 'Proving Spell (2-5 minutes)');
  const { commitTx, spellTx } = await proveSpellWithCli(
    spellYaml,
    contract.wasmPath,
    [collateralPrevTx],  // Only spell input txs, not funding tx
    feeUtxo,
    wallet.address,
    feeRate,
    isDryRun  // Use mock mode for dry-run
  );
  log(`Commit TX: ${commitTx.length / 2} bytes`);
  log(`Spell TX:  ${spellTx.length / 2} bytes`);

  // Save unsigned
  const outputDir = path.join(process.cwd(), 'deployments/testnet4/pending');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${contractKey}-commit.hex`), commitTx);
  fs.writeFileSync(path.join(outputDir, `${contractKey}-spell.hex`), spellTx);

  if (isDryRun) {
    log('\n✅ Dry run complete. Run without --dry-run to broadcast.');
    return {
      contract: contractKey,
      version: 'pending',
      network: 'testnet4',
      deployed_at: new Date().toISOString(),
      appId: 'DRY_RUN',
      vk,
      appRef: `n/new/${vk}`,
      commitTxId: 'DRY_RUN',
      spellTxId: 'DRY_RUN',
      stateUtxo: 'DRY_RUN:0',
      explorer: '',
    };
  }

  // 8. Sign and Broadcast
  logSection('Signing and Broadcasting');

  // Check if combined transaction (same tx for both commit and spell)
  const isCombinedTx = commitTx === spellTx;

  if (isCombinedTx) {
    log('Combined transaction detected - signing both inputs');
    // Combined tx has: input 0 = collateral, input 1 = funding
    const signedTx = await signCombinedTransaction(
      commitTx, wallet,
      collateralPrevTx, collateralUtxo.vout,  // Input 0
      feePrevTx, feeUtxo.vout                  // Input 1
    );
    log('Transaction signed');

    log('Broadcasting...');
    const txId = await broadcastTx(signedTx);
    log(`✓ ${txId}`);

    // For combined tx, commit and spell are the same
    var commitTxId = txId;
    var spellTxId = txId;
  } else {
    // Traditional two-transaction flow
    const signedCommit = await signTransaction(commitTx, wallet, 0, feePrevTx, feeUtxo.vout);
    log('Commit TX signed');
    const signedSpell = await signTransaction(spellTx, wallet, 0, collateralPrevTx, collateralUtxo.vout);
    log('Spell TX signed');

    log('Broadcasting Commit TX...');
    var commitTxId = await broadcastTx(signedCommit);
    log(`✓ ${commitTxId}`);

    log('Waiting 5s for propagation...');
    await new Promise(r => setTimeout(r, 5000));

    log('Broadcasting Spell TX...');
    var spellTxId = await broadcastTx(signedSpell);
    log(`✓ ${spellTxId}`);
  }

  // 10. Calculate App ID
  const appId = crypto.createHash('sha256')
    .update(`${collateralUtxo.txid}:${collateralUtxo.vout}`)
    .digest('hex');

  const result: DeploymentResult = {
    contract: contractKey,
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

  // Save result
  fs.writeFileSync(
    path.join(outputDir, `${contractKey}-result.json`),
    JSON.stringify(result, null, 2)
  );

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║               DEPLOYMENT SUCCESSFUL!                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nApp ID:     ${appId}`);
  console.log(`VK:         ${vk}`);
  console.log(`State UTXO: ${spellTxId}:0`);
  console.log(`\n🔗 ${result.explorer}`);
  console.log('\nNext: Update packages/config/src/testnet4.ts');

  return result;
}

// ============================================================================
// CLI
// ============================================================================

function showUsage(): void {
  console.log(`
zkUSD Contract Deployment

Usage:
  npx ts-node scripts/deploy.ts --contract <name> [--dry-run]
  npx ts-node scripts/deploy.ts --list

Options:
  --contract <name>  Contract to deploy
  --dry-run          Prove spell without broadcasting
  --list             Show available contracts

Available contracts:`);
  Object.entries(CONTRACTS).forEach(([key, config]) => {
    console.log(`  ${key.padEnd(20)} ${config.name}`);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.length === 0) {
    showUsage();
    return;
  }

  const contractIdx = args.indexOf('--contract');
  const contractKey = contractIdx >= 0 ? args[contractIdx + 1] : undefined;
  const isDryRun = args.includes('--dry-run');

  if (!contractKey) {
    showUsage();
    process.exit(1);
  }

  try {
    await deploy(contractKey, isDryRun);
  } catch (err) {
    console.error('\n❌ Deployment failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
