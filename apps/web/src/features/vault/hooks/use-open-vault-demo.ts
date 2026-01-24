'use client';

/**
 * useOpenVaultDemo Hook - Demo mode for live presentations
 *
 * This hook provides the same interface as useOpenVault but uses
 * simulated transactions for reliable demo presentations.
 *
 * Features:
 * - Real wallet connection
 * - Real UTXO and balance data
 * - Real price data
 * - Simulated ZK proof generation with realistic timing
 * - Simulated transaction broadcast
 *
 * Enable via:
 * - URL: ?demo=true
 * - localStorage: zkusd_demo_mode=true
 * - ENV: NEXT_PUBLIC_DEMO_MODE=true
 */

import {
  executeDemoFlow,
  selectDemoUtxos,
  isDemoMode,
  type DemoConfig,
  type DemoStep,
} from '@/lib/services/demo-service';
import { useVaultsStore } from '@/stores/vaults';
import { useWallet } from '@/stores/wallet';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

export interface OpenVaultDemoParams {
  collateralSats: bigint;
  debtRaw: bigint;
}

export interface OpenVaultDemoResult {
  commitTxId: string;
  spellTxId: string;
  vaultId: string;
}

type DemoState =
  | 'idle'
  | 'selecting'
  | 'building'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'success'
  | 'error';

// ============================================================================
// Hook
// ============================================================================

export function useOpenVaultDemo(config?: Partial<DemoConfig>) {
  const { address, publicKey, isConnected, balance } = useWallet();
  const addVault = useVaultsStore((s) => s.addVault);

  const [state, setState] = useState<DemoState>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpenVaultDemoResult | null>(null);

  /**
   * Map demo step to state
   */
  const mapStepToState = (stepName: string): DemoState => {
    switch (stepName) {
      case 'selecting':
      case 'validating':
        return 'selecting';
      case 'ready':
      case 'building':
      case 'loading_binaries':
        return 'building';
      case 'proving_init':
      case 'proving':
        return 'proving';
      case 'signing':
        return 'signing';
      case 'broadcast_commit':
      case 'broadcast_spell':
        return 'broadcasting';
      case 'success':
        return 'success';
      default:
        return 'idle';
    }
  };

  /**
   * Handle progress updates from demo flow
   */
  const handleProgress = useCallback((step: DemoStep, index: number, total: number) => {
    setState(mapStepToState(step.name));
    setProgress(step.progress);
    setStatusMessage(step.message);

    // Show toast for key steps
    if (step.name === 'proving') {
      toast.loading('Generating ZK proof...', { id: 'demo-tx' });
    } else if (step.name === 'signing') {
      toast.loading('Awaiting signature...', { id: 'demo-tx' });
    } else if (step.name === 'broadcast_commit') {
      toast.loading('Broadcasting...', { id: 'demo-tx' });
    }
  }, []);

  /**
   * Open vault (demo mode)
   */
  const openVault = useCallback(
    async (params: OpenVaultDemoParams): Promise<OpenVaultDemoResult> => {
      if (!isConnected || !address || !publicKey) {
        throw new Error('Wallet not connected');
      }

      // Reset state
      setError(null);
      setResult(null);
      setState('selecting');
      setProgress(0);

      try {
        // Step 1: Check UTXOs (real data)
        toast.loading('Checking UTXOs...', { id: 'demo-tx' });

        const collateralAmount = Number(params.collateralSats);
        const feeBuffer = 50000; // 0.0005 BTC

        const utxoResult = await selectDemoUtxos(address, collateralAmount, feeBuffer);

        if (utxoResult.status === 'no_utxos') {
          throw new Error('No UTXOs available. Please fund your wallet.');
        }

        if (utxoResult.status === 'insufficient') {
          throw new Error(
            `Insufficient balance. Have ${utxoResult.totalBalance} sats, need ${collateralAmount + feeBuffer} sats.`
          );
        }

        // Step 2: Execute demo flow
        const demoResult = await executeDemoFlow(
          {
            collateralSats: params.collateralSats,
            debtRaw: params.debtRaw,
            address,
            publicKey,
          },
          handleProgress,
          {
            proofTime: config?.proofTime ?? 12000,
            signTime: config?.signTime ?? 3000,
            broadcastTime: config?.broadcastTime ?? 5000,
            shouldSucceed: config?.shouldSucceed ?? true,
            failAt: config?.failAt,
          }
        );

        // Success!
        const vaultResult: OpenVaultDemoResult = {
          commitTxId: demoResult.commitTxId,
          spellTxId: demoResult.spellTxId,
          vaultId: demoResult.vaultId,
        };

        setResult(vaultResult);
        setState('success');
        setProgress(100);
        setStatusMessage('Vault opened successfully!');

        toast.success('Vault opened successfully!', {
          id: 'demo-tx',
          description: `TX: ${demoResult.spellTxId.slice(0, 8)}...`,
        });

        // Add to local store
        addVault({
          id: demoResult.vaultId,
          utxo: `${demoResult.spellTxId}:0`,
          owner: publicKey,
          collateral: params.collateralSats,
          debt: params.debtRaw,
          status: 'active',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          interestRateBps: 100,
          accruedInterest: 0n,
          redistributedDebt: 0n,
          redistributedCollateral: 0n,
          insuranceBalance: 0n,
          localUpdatedAt: Date.now(),
        });

        return vaultResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Demo failed';
        setError(message);
        setState('error');
        setProgress(0);
        setStatusMessage('Error');

        toast.error('Failed to open vault', {
          id: 'demo-tx',
          description: message,
        });

        throw err;
      }
    },
    [isConnected, address, publicKey, addVault, handleProgress, config]
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setStatusMessage('Ready');
    setError(null);
    setResult(null);
  }, []);

  return {
    openVault,
    status: state,
    error,
    errorType: error ? 'demo_error' : null,
    isLoading: ['selecting', 'building', 'proving', 'signing', 'broadcasting'].includes(state),
    isSuccess: state === 'success',
    isError: state === 'error',
    isWaiting: false,
    data: result,
    progress,
    statusMessage,
    nextAvailableAt: null,
    getTimeUntilAvailable: () => null,
    reset,
    // Demo-specific
    isDemoMode: true,
  };
}

/**
 * Hook that automatically uses demo mode when enabled
 */
export function useOpenVaultWithDemo(config?: Partial<DemoConfig>) {
  const demoHook = useOpenVaultDemo(config);

  // Import the real hook dynamically to avoid circular deps
  // For now, we'll just return demo hook and let the form component
  // decide which to use based on isDemoMode()

  return {
    ...demoHook,
    isDemoMode: isDemoMode(),
  };
}

// Re-export isDemoMode for convenience
export { isDemoMode } from '@/lib/services/demo-service';
