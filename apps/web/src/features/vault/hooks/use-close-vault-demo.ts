'use client';

/**
 * useCloseVaultDemo Hook - Demo mode for closing vaults
 *
 * Simulates the complete close vault flow for presentations.
 */

import { isDemoMode } from '@/lib/services/demo-service';
import { type TrackedVault, useVaultsStore } from '@/stores/vaults';
import { useWallet } from '@/stores/wallet';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export interface CloseVaultDemoParams {
  vault: TrackedVault;
}

export interface CloseVaultDemoResult {
  txId: string;
  recoveredCollateral: bigint;
}

type CloseStatus =
  | 'idle'
  | 'building_spell'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'success'
  | 'error';

interface DemoStep {
  name: CloseStatus;
  duration: number;
  message: string;
}

const DEMO_STEPS: DemoStep[] = [
  { name: 'building_spell', duration: 1500, message: 'Building close spell...' },
  { name: 'proving', duration: 8000, message: 'Generating zero-knowledge proof...' },
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

export function useCloseVaultDemo() {
  const { isConnected } = useWallet();
  const { updateVault, removeVault } = useVaultsStore();
  const [status, setStatus] = useState<CloseStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseVaultDemoResult | null>(null);

  const closeVault = useCallback(
    async (params: CloseVaultDemoParams): Promise<CloseVaultDemoResult> => {
      if (!isConnected) {
        throw new Error('Wallet not connected');
      }

      // Check if vault has debt
      const totalDebt =
        params.vault.debt + params.vault.accruedInterest + params.vault.redistributedDebt;

      if (totalDebt > 0n) {
        toast.error('Cannot close vault with outstanding debt', {
          id: 'close-tx',
          description: `You need ${(Number(totalDebt) / 1e8).toFixed(2)} zkUSD to repay the debt.`,
        });
        throw new Error('Vault has outstanding debt that must be repaid');
      }

      try {
        setError(null);
        setResult(null);

        // Run through demo steps
        for (const step of DEMO_STEPS) {
          setStatus(step.name);
          toast.loading(step.message, { id: 'close-tx' });
          await sleep(step.duration);
        }

        // Generate simulated result
        const txId = generateTxId();
        const recoveredCollateral = params.vault.collateral;

        // Update local vault state
        updateVault(params.vault.id, {
          status: 'closed',
          utxo: `${txId}:0`,
          collateral: 0n,
          debt: 0n,
          localUpdatedAt: Date.now(),
        });

        const closeResult: CloseVaultDemoResult = {
          txId,
          recoveredCollateral,
        };

        setResult(closeResult);
        setStatus('success');

        toast.success('Vault closed successfully!', {
          id: 'close-tx',
          description: `Recovered ${(Number(recoveredCollateral) / 1e8).toFixed(8)} BTC`,
        });

        return closeResult;
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to close vault';
        setError(message);
        toast.error('Failed to close vault', {
          id: 'close-tx',
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
    closeVault,
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

export { isDemoMode };
