'use client';

/**
 * useAdjustVaultDemo Hook - Demo mode for vault adjustments
 *
 * Simulates the complete adjust vault flow for presentations.
 */

import { isDemoMode } from '@/lib/services/demo-service';
import { type TrackedVault, useVaultsStore } from '@/stores/vaults';
import { useWallet } from '@/stores/wallet';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

// Types
export interface AdjustVaultDemoParams {
  vault: TrackedVault;
  collateralChange: bigint;
  isCollateralIncrease: boolean;
  debtChange: bigint;
  isDebtIncrease: boolean;
}

export interface AdjustVaultDemoResult {
  txId: string;
  newCollateral: bigint;
  newDebt: bigint;
}

type AdjustStatus =
  | 'idle'
  | 'building_spell'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'success'
  | 'error';

interface DemoStep {
  name: AdjustStatus;
  duration: number;
  message: string;
}

// Demo timing configuration
const DEMO_STEPS: DemoStep[] = [
  { name: 'building_spell', duration: 1500, message: 'Building adjustment spell...' },
  { name: 'proving', duration: 10000, message: 'Generating zero-knowledge proof...' },
  { name: 'signing', duration: 2500, message: 'Please sign in your wallet...' },
  { name: 'broadcasting', duration: 4000, message: 'Broadcasting transaction...' },
];

function generateTxId(): string {
  const chars = '0123456789abcdef';
  let txId = '';
  for (let i = 0; i < 64; i++) {
    txId += chars[Math.floor(Math.random() * chars.length)];
  }
  return txId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useAdjustVaultDemo() {
  const { isConnected } = useWallet();
  const updateVault = useVaultsStore((s) => s.updateVault);
  const [status, setStatus] = useState<AdjustStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdjustVaultDemoResult | null>(null);

  const adjustVault = useCallback(
    async (params: AdjustVaultDemoParams): Promise<AdjustVaultDemoResult> => {
      if (!isConnected) {
        throw new Error('Wallet not connected');
      }

      try {
        setError(null);
        setResult(null);

        // Calculate new values
        const collateralDelta = params.isCollateralIncrease
          ? params.collateralChange
          : -params.collateralChange;
        const debtDelta = params.isDebtIncrease ? params.debtChange : -params.debtChange;

        const newCollateral = params.vault.collateral + collateralDelta;
        const newDebt = params.vault.debt + debtDelta;

        // Validate
        if (newCollateral < 0n) {
          throw new Error('Cannot remove more collateral than available');
        }
        if (newDebt < 0n) {
          throw new Error('Cannot repay more debt than owed');
        }

        // Run through demo steps
        for (const step of DEMO_STEPS) {
          setStatus(step.name);

          if (step.name === 'building_spell') {
            toast.loading(step.message, { id: 'adjust-tx' });
          } else if (step.name === 'proving') {
            toast.loading(step.message, { id: 'adjust-tx' });
          } else if (step.name === 'signing') {
            toast.loading(step.message, { id: 'adjust-tx' });
          } else if (step.name === 'broadcasting') {
            toast.loading(step.message, { id: 'adjust-tx' });
          }

          await sleep(step.duration);
        }

        // Generate simulated result
        const txId = generateTxId();

        // Update local vault state
        updateVault(params.vault.id, {
          utxo: `${txId}:0`,
          collateral: newCollateral,
          debt: newDebt,
          lastUpdated: Date.now(),
          localUpdatedAt: Date.now(),
        });

        const adjustResult: AdjustVaultDemoResult = {
          txId,
          newCollateral,
          newDebt,
        };

        setResult(adjustResult);
        setStatus('success');

        toast.success('Vault adjusted successfully!', {
          id: 'adjust-tx',
          description: `TX: ${txId.slice(0, 8)}...${txId.slice(-8)}`,
        });

        return adjustResult;
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to adjust vault';
        setError(message);
        toast.error('Failed to adjust vault', {
          id: 'adjust-tx',
          description: message,
        });
        throw err;
      }
    },
    [isConnected, updateVault]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  return {
    adjustVault,
    status,
    error,
    isLoading: ['building_spell', 'proving', 'signing', 'broadcasting'].includes(status),
    isSuccess: status === 'success',
    isError: status === 'error',
    data: result,
    reset,
    isDemoMode: true,
  };
}

// Re-export isDemoMode for convenience
export { isDemoMode };
