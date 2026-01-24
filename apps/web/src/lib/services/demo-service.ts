/**
 * Demo Service - Professional simulation for live presentations
 *
 * This service simulates the complete vault opening flow with:
 * - Real wallet connection and UTXO data
 * - Realistic timing for ZK proof generation
 * - Simulated transaction IDs that look authentic
 * - Full state machine progression
 *
 * Used for pitch demos when the prover is unavailable or unreliable.
 */

import { getClient } from '@/lib/sdk';
import type { UtxoInfo } from './utxo-service';

// ============================================================================
// Types
// ============================================================================

export interface DemoConfig {
  /** Simulate proof generation time (ms) - default 12000 (12s) */
  proofTime: number;
  /** Simulate signing time (ms) - default 3000 (3s) */
  signTime: number;
  /** Simulate broadcast time (ms) - default 5000 (5s) */
  broadcastTime: number;
  /** Should simulation succeed? - default true */
  shouldSucceed: boolean;
  /** Failure point (if shouldSucceed is false) */
  failAt?: 'proof' | 'sign' | 'broadcast';
}

export interface DemoStep {
  name: string;
  duration: number;
  progress: number;
  message: string;
}

export interface DemoResult {
  commitTxId: string;
  spellTxId: string;
  vaultId: string;
  explorerUrl: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DemoConfig = {
  proofTime: 12000, // 12 seconds - realistic for ZK proof
  signTime: 3000,   // 3 seconds - wallet interaction
  broadcastTime: 5000, // 5 seconds - network propagation
  shouldSucceed: true,
};

// ============================================================================
// Demo Steps
// ============================================================================

export function getDemoSteps(config: DemoConfig = DEFAULT_CONFIG): DemoStep[] {
  return [
    {
      name: 'selecting',
      duration: 800,
      progress: 10,
      message: 'Checking UTXO availability...',
    },
    {
      name: 'validating',
      duration: 600,
      progress: 15,
      message: 'Validating collateral ratio...',
    },
    {
      name: 'ready',
      duration: 400,
      progress: 20,
      message: 'UTXOs selected. Building transaction...',
    },
    {
      name: 'building',
      duration: 1500,
      progress: 30,
      message: 'Building spell transaction...',
    },
    {
      name: 'loading_binaries',
      duration: 2000,
      progress: 40,
      message: 'Loading WASM binaries...',
    },
    {
      name: 'proving_init',
      duration: 1000,
      progress: 45,
      message: 'Initializing zkVM...',
    },
    {
      name: 'proving',
      duration: config.proofTime,
      progress: 65,
      message: 'Generating zero-knowledge proof...',
    },
    {
      name: 'signing',
      duration: config.signTime,
      progress: 75,
      message: 'Please sign in your wallet...',
    },
    {
      name: 'broadcast_commit',
      duration: config.broadcastTime / 2,
      progress: 85,
      message: 'Broadcasting commit transaction...',
    },
    {
      name: 'broadcast_spell',
      duration: config.broadcastTime / 2,
      progress: 95,
      message: 'Broadcasting spell transaction...',
    },
    {
      name: 'success',
      duration: 500,
      progress: 100,
      message: 'Vault opened successfully!',
    },
  ];
}

// ============================================================================
// Demo Execution
// ============================================================================

/**
 * Generate a realistic-looking transaction ID
 */
function generateTxId(): string {
  const chars = '0123456789abcdef';
  let txId = '';
  for (let i = 0; i < 64; i++) {
    txId += chars[Math.floor(Math.random() * chars.length)];
  }
  return txId;
}

/**
 * Generate a vault ID
 */
function generateVaultId(): string {
  return `vault_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Execute the demo flow with callbacks for progress updates
 */
export async function executeDemoFlow(
  params: {
    collateralSats: bigint;
    debtRaw: bigint;
    address: string;
    publicKey: string;
  },
  onProgress: (step: DemoStep, index: number, total: number) => void,
  config: DemoConfig = DEFAULT_CONFIG
): Promise<DemoResult> {
  const steps = getDemoSteps(config);
  const client = getClient();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Call progress callback
    onProgress(step, i, steps.length);

    // Check for simulated failure
    if (!config.shouldSucceed) {
      if (
        (config.failAt === 'proof' && step.name === 'proving') ||
        (config.failAt === 'sign' && step.name === 'signing') ||
        (config.failAt === 'broadcast' && step.name === 'broadcast_commit')
      ) {
        await sleep(step.duration / 2);
        throw new Error(getFailureMessage(config.failAt));
      }
    }

    // Wait for step duration
    await sleep(step.duration);
  }

  // Generate result
  const commitTxId = generateTxId();
  const spellTxId = generateTxId();
  const vaultId = generateVaultId();

  return {
    commitTxId,
    spellTxId,
    vaultId,
    explorerUrl: client.getTxUrl(spellTxId),
  };
}

/**
 * Get failure message based on failure point
 */
function getFailureMessage(failAt: string): string {
  switch (failAt) {
    case 'proof':
      return 'ZK proof generation failed - prover timeout';
    case 'sign':
      return 'User rejected transaction signing';
    case 'broadcast':
      return 'Transaction broadcast failed - network error';
    default:
      return 'Demo simulation failed';
  }
}

// ============================================================================
// UTXO Selection (Real Data)
// ============================================================================

/**
 * Select UTXOs for demo - uses real UTXO data
 */
export async function selectDemoUtxos(
  address: string,
  collateralAmount: number,
  feeBuffer: number
): Promise<{
  status: 'ready' | 'insufficient' | 'no_utxos';
  collateralUtxo?: UtxoInfo;
  feeUtxo?: UtxoInfo;
  totalBalance: number;
}> {
  const client = getClient();

  try {
    const utxos = await client.getAddressUtxos(address);

    if (utxos.length === 0) {
      return { status: 'no_utxos', totalBalance: 0 };
    }

    const totalBalance = utxos.reduce((sum, u) => sum + u.value, 0);
    const requiredTotal = collateralAmount + feeBuffer;

    if (totalBalance < requiredTotal) {
      return { status: 'insufficient', totalBalance };
    }

    // Sort by value descending
    const sorted = [...utxos].sort((a, b) => b.value - a.value);

    // Find best UTXOs
    let collateralUtxo: UtxoInfo | undefined;
    let feeUtxo: UtxoInfo | undefined;

    for (const utxo of sorted) {
      if (!collateralUtxo && utxo.value >= collateralAmount) {
        collateralUtxo = {
          id: `${utxo.txid}:${utxo.vout}`,
          txid: utxo.txid,
          vout: utxo.vout,
          value: utxo.value,
          confirmed: utxo.status?.confirmed ?? false,
        };
      } else if (!feeUtxo && utxo.value >= feeBuffer) {
        feeUtxo = {
          id: `${utxo.txid}:${utxo.vout}`,
          txid: utxo.txid,
          vout: utxo.vout,
          value: utxo.value,
          confirmed: utxo.status?.confirmed ?? false,
        };
      }
    }

    if (collateralUtxo && feeUtxo) {
      return { status: 'ready', collateralUtxo, feeUtxo, totalBalance };
    }

    // Fallback: use largest UTXO for both
    if (sorted[0].value >= requiredTotal) {
      const utxo = sorted[0];
      const utxoInfo: UtxoInfo = {
        id: `${utxo.txid}:${utxo.vout}`,
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        confirmed: utxo.status?.confirmed ?? false,
      };
      return {
        status: 'ready',
        collateralUtxo: utxoInfo,
        feeUtxo: utxoInfo,
        totalBalance,
      };
    }

    return { status: 'insufficient', totalBalance };
  } catch (error) {
    console.error('[DemoService] Failed to fetch UTXOs:', error);
    // Return mock UTXOs for completely offline demo
    return {
      status: 'ready',
      collateralUtxo: createMockUtxo(collateralAmount),
      feeUtxo: createMockUtxo(feeBuffer),
      totalBalance: collateralAmount + feeBuffer,
    };
  }
}

/**
 * Create a mock UTXO for offline demo
 */
function createMockUtxo(value: number): UtxoInfo {
  const mockTxid = generateTxId();
  return {
    id: `${mockTxid}:0`,
    txid: mockTxid,
    vout: 0,
    value,
    confirmed: true,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if demo mode is enabled
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;

  // Check environment variable
  const envDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  // Check URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const urlDemo = urlParams.get('demo') === 'true';

  // Check localStorage
  const localDemo = localStorage.getItem('zkusd_demo_mode') === 'true';

  return envDemo || urlDemo || localDemo;
}

/**
 * Enable demo mode via localStorage
 */
export function enableDemoMode(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('zkusd_demo_mode', 'true');
  }
}

/**
 * Disable demo mode
 */
export function disableDemoMode(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('zkusd_demo_mode');
  }
}

/**
 * Toggle demo mode
 */
export function toggleDemoMode(): boolean {
  if (isDemoMode()) {
    disableDemoMode();
    return false;
  } else {
    enableDemoMode();
    return true;
  }
}
