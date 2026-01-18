'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWallet } from '@/stores/wallet';
import { getClient } from '@/lib/sdk';
import { useCallback } from 'react';

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

// Deposit mutation hook
// Note: Full implementation requires Charms indexer to find zkUSD UTXOs
export function useStabilityPoolDeposit() {
  const { address, publicKey, isConnected } = useWallet();
  const queryClient = useQueryClient();

  const depositFn = useCallback(async (amount: bigint): Promise<null> => {
    if (!isConnected || !address || !publicKey) {
      throw new Error('Wallet not connected');
    }

    if (!window.unisat) {
      throw new Error('Unisat wallet not found');
    }

    // Since we don't have a way to find zkUSD UTXOs without an indexer,
    // show a message to the user explaining the limitation
    toast.info('Stability Pool deposits require zkUSD tokens', {
      id: 'sp-deposit',
      description: 'First open a vault to mint zkUSD. Full SP integration requires a Charms indexer.',
    });

    // Return null to indicate operation not completed (not an error, just not supported yet)
    return null;
  }, [isConnected, address, publicKey]);

  const mutation = useMutation({
    mutationFn: depositFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stability-pool-state'] });
      queryClient.invalidateQueries({ queryKey: ['stability-pool-deposit'] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      toast.error('Deposit failed', { id: 'sp-deposit', description: message });
    },
  });

  return {
    deposit: mutation.mutateAsync,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}

// Withdraw mutation hook
// Note: Full implementation requires Charms indexer to find deposit UTXOs
export function useStabilityPoolWithdraw() {
  const { address, isConnected } = useWallet();
  const queryClient = useQueryClient();

  const withdrawFn = useCallback(async (amount: bigint): Promise<null> => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    // Similar to deposit, requires finding the deposit UTXO via indexer
    toast.info('Withdrawal requires deposit UTXO', {
      id: 'sp-withdraw',
      description: 'This feature requires a Charms indexer to locate your deposit.',
    });

    return null;
  }, [isConnected, address]);

  const mutation = useMutation({
    mutationFn: withdrawFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stability-pool-state'] });
      queryClient.invalidateQueries({ queryKey: ['stability-pool-deposit'] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      toast.error('Withdrawal failed', { id: 'sp-withdraw', description: message });
    },
  });

  return {
    withdraw: mutation.mutateAsync,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}
