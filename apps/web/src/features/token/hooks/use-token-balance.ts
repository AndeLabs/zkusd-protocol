'use client';

import { useTokenBalanceStore } from '@/stores/token-balance';
import { useWallet } from '@/stores/wallet';
import { useMemo } from 'react';

export function useTokenBalance() {
  const { publicKey } = useWallet();
  const balances = useTokenBalanceStore((s) => s.balances);
  const addBalance = useTokenBalanceStore((s) => s.addBalance);
  const removeBalance = useTokenBalanceStore((s) => s.removeBalance);

  const userBalances = useMemo(
    () => balances.filter((b) => b.address === (publicKey || '')),
    [balances, publicKey]
  );

  const totalBalance = useMemo(
    () => userBalances.reduce((sum, b) => sum + b.amount, 0n),
    [userBalances]
  );

  return {
    balances: userBalances,
    totalBalance,
    hasBalance: totalBalance > 0n,
    addBalance,
    removeBalance,
  };
}
