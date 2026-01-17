'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWallet } from '@/stores/wallet';
import { getClient } from '@/lib/sdk';
import { useState, useCallback } from 'react';

// Pool state hook
export function useStabilityPoolState() {
  const client = getClient();

  return useQuery({
    queryKey: ['stability-pool-state'],
    queryFn: async () => {
      const state = await client.stabilityPool.getPoolState();
      return state;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// User deposit hook
export function useUserDeposit() {
  const { address, isConnected } = useWallet();
  const client = getClient();

  return useQuery({
    queryKey: ['stability-pool-deposit', address],
    queryFn: async () => {
      if (!address) return null;
      const deposit = await client.stabilityPool.getDeposit(address);
      return deposit;
    },
    enabled: isConnected && !!address,
    staleTime: 30_000,
  });
}

type DepositStatus = 'idle' | 'building' | 'proving' | 'signing' | 'broadcasting' | 'success' | 'error';

// Deposit mutation hook
export function useStabilityPoolDeposit() {
  const { address, publicKey, isConnected } = useWallet();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DepositStatus>('idle');

  const deposit = useCallback(async (amount: bigint) => {
    if (!isConnected || !address || !publicKey) {
      throw new Error('Wallet not connected');
    }

    if (!window.unisat) {
      throw new Error('Unisat wallet not found');
    }

    const client = getClient();

    try {
      setStatus('building');
      toast.loading('Preparing deposit...', { id: 'sp-deposit' });

      // Get user's zkUSD UTXOs
      // For now, we'll use a placeholder - in production, need to scan for zkUSD charm UTXOs
      // This would require a Charms indexer to find UTXOs with zkUSD token charms

      // Get existing deposit if any
      const existingDeposit = await client.stabilityPool.getDeposit(address);

      // Since we don't have a way to find zkUSD UTXOs without an indexer,
      // we'll show a message to the user
      toast.error('Stability Pool deposits require zkUSD tokens', {
        id: 'sp-deposit',
        description: 'First open a vault to mint zkUSD, then you can deposit to the pool.',
      });

      setStatus('idle');
      return null;

      // Full implementation would:
      // 1. Find zkUSD UTXO with sufficient balance
      // 2. Build deposit spell
      // 3. Prove and sign
      // 4. Broadcast

    } catch (err) {
      setStatus('error');
      const message = err instanceof Error ? err.message : 'Deposit failed';
      toast.error('Deposit failed', { id: 'sp-deposit', description: message });
      throw err;
    }
  }, [isConnected, address, publicKey]);

  const mutation = useMutation({
    mutationFn: deposit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stability-pool-state'] });
      queryClient.invalidateQueries({ queryKey: ['stability-pool-deposit'] });
    },
  });

  return {
    deposit: mutation.mutateAsync,
    status,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
}

// Withdraw mutation hook
export function useStabilityPoolWithdraw() {
  const { address, isConnected } = useWallet();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DepositStatus>('idle');

  const withdraw = useCallback(async (amount: bigint) => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    const client = getClient();

    try {
      setStatus('building');
      toast.loading('Preparing withdrawal...', { id: 'sp-withdraw' });

      // Get existing deposit
      const deposit = await client.stabilityPool.getDeposit(address);

      if (!deposit) {
        throw new Error('No deposit found');
      }

      if (amount > deposit.deposit) {
        throw new Error('Insufficient deposit balance');
      }

      // Similar to deposit, requires finding the deposit UTXO
      toast.error('Withdrawal requires deposit UTXO', {
        id: 'sp-withdraw',
        description: 'This feature requires a Charms indexer to locate your deposit.',
      });

      setStatus('idle');
      return null;

    } catch (err) {
      setStatus('error');
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      toast.error('Withdrawal failed', { id: 'sp-withdraw', description: message });
      throw err;
    }
  }, [isConnected, address]);

  const mutation = useMutation({
    mutationFn: withdraw,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stability-pool-state'] });
      queryClient.invalidateQueries({ queryKey: ['stability-pool-deposit'] });
    },
  });

  return {
    withdraw: mutation.mutateAsync,
    status,
    isLoading: mutation.isPending,
  };
}
