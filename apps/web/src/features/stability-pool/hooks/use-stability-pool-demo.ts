'use client';

/**
 * Stability Pool Demo Hooks - Demo mode for Earn section
 *
 * Simulates stability pool operations for presentations.
 */

import { isDemoMode } from '@/lib/services/demo-service';
import { useWallet } from '@/stores/wallet';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

// Types
export interface StabilityPoolDemoState {
  totalDeposits: bigint;
  totalCollateralGains: bigint;
  apy: number;
  depositorCount: number;
}

export interface UserDepositDemo {
  deposit: bigint;
  collateralGain: bigint;
  depositedAt: number;
}

interface DemoStep {
  name: string;
  duration: number;
  message: string;
}

const DEMO_STEPS: DemoStep[] = [
  { name: 'building', duration: 1200, message: 'Building transaction...' },
  { name: 'proving', duration: 8000, message: 'Generating zero-knowledge proof...' },
  { name: 'signing', duration: 2500, message: 'Please sign in your wallet...' },
  { name: 'broadcasting', duration: 3000, message: 'Broadcasting transaction...' },
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

// ============================================================================
// Pool State Hook (Demo)
// ============================================================================

export function useStabilityPoolStateDemo() {
  // Return mock pool state
  const data: StabilityPoolDemoState = {
    totalDeposits: 125000000000000n, // 1,250,000 zkUSD
    totalCollateralGains: 50000000n, // 0.5 BTC
    apy: 8.5,
    depositorCount: 47,
  };

  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: async () => ({ data }),
  };
}

// ============================================================================
// User Deposit Hook (Demo)
// ============================================================================

// Store demo deposits in memory
const demoDeposits = new Map<string, UserDepositDemo>();

export function useUserDepositDemo() {
  const { address, isConnected } = useWallet();

  const deposit = address ? demoDeposits.get(address) : null;

  return {
    data: deposit,
    isLoading: false,
    isError: false,
    error: null,
    refetch: async () => ({ data: deposit }),
  };
}

// ============================================================================
// Deposit Hook (Demo)
// ============================================================================

export function useStabilityPoolDepositDemo() {
  const { address, isConnected } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);

  const deposit = useCallback(
    async (amount: bigint): Promise<{ txId: string }> => {
      if (!isConnected || !address) {
        throw new Error('Wallet not connected');
      }

      setIsLoading(true);
      setIsSuccess(false);
      setIsError(false);

      try {
        // Run through demo steps
        for (const step of DEMO_STEPS) {
          toast.loading(step.message, { id: 'sp-deposit' });
          await sleep(step.duration);
        }

        const txId = generateTxId();

        // Update demo deposit
        const existing = demoDeposits.get(address);
        demoDeposits.set(address, {
          deposit: (existing?.deposit ?? 0n) + amount,
          collateralGain: existing?.collateralGain ?? 0n,
          depositedAt: Date.now(),
        });

        setIsSuccess(true);
        toast.success('Deposit successful!', {
          id: 'sp-deposit',
          description: `Deposited ${(Number(amount) / 1e8).toFixed(2)} zkUSD`,
        });

        return { txId };
      } catch (err) {
        setIsError(true);
        const message = err instanceof Error ? err.message : 'Deposit failed';
        toast.error('Deposit failed', { id: 'sp-deposit', description: message });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [isConnected, address]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
    setIsSuccess(false);
    setIsError(false);
  }, []);

  return {
    deposit,
    isLoading,
    isSuccess,
    isError,
    reset,
  };
}

// ============================================================================
// Withdraw Hook (Demo)
// ============================================================================

export function useStabilityPoolWithdrawDemo() {
  const { address, isConnected } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);

  const withdraw = useCallback(
    async (amount: bigint): Promise<{ txId: string }> => {
      if (!isConnected || !address) {
        throw new Error('Wallet not connected');
      }

      const currentDeposit = demoDeposits.get(address);
      if (!currentDeposit || currentDeposit.deposit < amount) {
        throw new Error('Insufficient deposit balance');
      }

      setIsLoading(true);
      setIsSuccess(false);
      setIsError(false);

      try {
        // Run through demo steps
        for (const step of DEMO_STEPS) {
          toast.loading(step.message, { id: 'sp-withdraw' });
          await sleep(step.duration);
        }

        const txId = generateTxId();

        // Update demo deposit
        const newDeposit = currentDeposit.deposit - amount;
        if (newDeposit <= 0n) {
          demoDeposits.delete(address);
        } else {
          demoDeposits.set(address, {
            ...currentDeposit,
            deposit: newDeposit,
          });
        }

        setIsSuccess(true);
        toast.success('Withdrawal successful!', {
          id: 'sp-withdraw',
          description: `Withdrew ${(Number(amount) / 1e8).toFixed(2)} zkUSD`,
        });

        return { txId };
      } catch (err) {
        setIsError(true);
        const message = err instanceof Error ? err.message : 'Withdrawal failed';
        toast.error('Withdrawal failed', { id: 'sp-withdraw', description: message });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [isConnected, address]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
    setIsSuccess(false);
    setIsError(false);
  }, []);

  return {
    withdraw,
    isLoading,
    isSuccess,
    isError,
    reset,
  };
}

// ============================================================================
// Claim Gains Hook (Demo)
// ============================================================================

export function useStabilityPoolClaimGainsDemo() {
  const { address, isConnected } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);

  const claimGains = useCallback(async (): Promise<{ txId: string; claimedBtc: bigint }> => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    const currentDeposit = demoDeposits.get(address);
    if (!currentDeposit || currentDeposit.collateralGain <= 0n) {
      throw new Error('No gains to claim');
    }

    setIsLoading(true);
    setIsSuccess(false);
    setIsError(false);

    try {
      // Run through demo steps
      for (const step of DEMO_STEPS) {
        toast.loading(step.message, { id: 'sp-claim' });
        await sleep(step.duration);
      }

      const txId = generateTxId();
      const claimedBtc = currentDeposit.collateralGain;

      // Clear pending gains
      demoDeposits.set(address, {
        ...currentDeposit,
        collateralGain: 0n,
      });

      setIsSuccess(true);
      toast.success('Gains claimed!', {
        id: 'sp-claim',
        description: `Claimed ${(Number(claimedBtc) / 1e8).toFixed(8)} BTC`,
      });

      return { txId, claimedBtc };
    } catch (err) {
      setIsError(true);
      const message = err instanceof Error ? err.message : 'Claim failed';
      toast.error('Claim failed', { id: 'sp-claim', description: message });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address]);

  const reset = useCallback(() => {
    setIsLoading(false);
    setIsSuccess(false);
    setIsError(false);
  }, []);

  return {
    claimGains,
    isLoading,
    isSuccess,
    isError,
    reset,
  };
}

// ============================================================================
// Combined Hook with Demo Mode Detection
// ============================================================================

export function useStabilityPoolWithDemo() {
  const poolState = useStabilityPoolStateDemo();
  const userDeposit = useUserDepositDemo();
  const depositHook = useStabilityPoolDepositDemo();
  const withdrawHook = useStabilityPoolWithdrawDemo();
  const claimHook = useStabilityPoolClaimGainsDemo();

  return {
    poolState,
    userDeposit,
    deposit: depositHook,
    withdraw: withdrawHook,
    claim: claimHook,
    isDemoMode: true,
  };
}

export { isDemoMode };
