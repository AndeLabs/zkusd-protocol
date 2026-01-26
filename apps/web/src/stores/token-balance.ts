'use client';

import type { TrackedTokenBalance } from '@zkusd/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Serialization helpers for bigint
function serializeBalance(balance: TrackedTokenBalance): Record<string, unknown> {
  return {
    ...balance,
    amount: balance.amount.toString(),
  };
}

function deserializeBalance(data: Record<string, unknown>): TrackedTokenBalance {
  return {
    address: data.address as string,
    amount: BigInt(data.amount as string),
    utxo: data.utxo as string,
    sourceTxId: data.sourceTxId as string,
    sourceOperation: data.sourceOperation as 'mint' | 'transfer' | 'redeem',
    updatedAt: data.updatedAt as number,
  };
}

interface TokenBalanceStore {
  balances: TrackedTokenBalance[];
  addBalance: (balance: TrackedTokenBalance) => void;
  removeBalance: (utxo: string) => void;
  getBalancesByAddress: (address: string) => TrackedTokenBalance[];
  getTotalByAddress: (address: string) => bigint;
  clearBalances: () => void;
}

export const useTokenBalanceStore = create<TokenBalanceStore>()(
  persist(
    (set, get) => ({
      balances: [],

      addBalance: (balance) =>
        set((state) => ({
          balances: [...state.balances.filter((b) => b.utxo !== balance.utxo), balance],
        })),

      removeBalance: (utxo) =>
        set((state) => ({
          balances: state.balances.filter((b) => b.utxo !== utxo),
        })),

      getBalancesByAddress: (address) => get().balances.filter((b) => b.address === address),

      getTotalByAddress: (address) =>
        get()
          .balances.filter((b) => b.address === address)
          .reduce((sum, b) => sum + b.amount, 0n),

      clearBalances: () => set({ balances: [] }),
    }),
    {
      name: 'zkusd-token-balances',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          return {
            ...parsed,
            state: {
              ...parsed.state,
              balances: parsed.state.balances.map(deserializeBalance),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              balances: value.state.balances.map(serializeBalance),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
