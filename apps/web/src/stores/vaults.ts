'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TrackedVault {
  id: string;
  utxo: string; // txid:vout where vault NFT lives
  owner: string;
  collateral: bigint;
  debt: bigint;
  createdAt: number;
  lastUpdated: number;
  interestRateBps: number;
  accruedInterest: bigint;
  redistributedDebt: bigint;
  redistributedCollateral: bigint;
  insuranceBalance: bigint;
}

// Serialization helpers for bigint
function serializeVault(vault: TrackedVault): Record<string, unknown> {
  return {
    ...vault,
    collateral: vault.collateral.toString(),
    debt: vault.debt.toString(),
    accruedInterest: vault.accruedInterest.toString(),
    redistributedDebt: vault.redistributedDebt.toString(),
    redistributedCollateral: vault.redistributedCollateral.toString(),
    insuranceBalance: vault.insuranceBalance.toString(),
  };
}

function deserializeVault(data: Record<string, unknown>): TrackedVault {
  return {
    id: data.id as string,
    utxo: data.utxo as string,
    owner: data.owner as string,
    collateral: BigInt(data.collateral as string),
    debt: BigInt(data.debt as string),
    createdAt: data.createdAt as number,
    lastUpdated: data.lastUpdated as number,
    interestRateBps: data.interestRateBps as number,
    accruedInterest: BigInt(data.accruedInterest as string),
    redistributedDebt: BigInt(data.redistributedDebt as string),
    redistributedCollateral: BigInt(data.redistributedCollateral as string),
    insuranceBalance: BigInt(data.insuranceBalance as string),
  };
}

interface VaultsStore {
  vaults: TrackedVault[];
  addVault: (vault: TrackedVault) => void;
  updateVault: (id: string, updates: Partial<TrackedVault>) => void;
  removeVault: (id: string) => void;
  getVaultById: (id: string) => TrackedVault | undefined;
  getVaultsByOwner: (owner: string) => TrackedVault[];
  clearVaults: () => void;
}

export const useVaultsStore = create<VaultsStore>()(
  persist(
    (set, get) => ({
      vaults: [],

      addVault: (vault) =>
        set((state) => ({
          vaults: [...state.vaults.filter((v) => v.id !== vault.id), vault],
        })),

      updateVault: (id, updates) =>
        set((state) => ({
          vaults: state.vaults.map((v) => (v.id === id ? { ...v, ...updates } : v)),
        })),

      removeVault: (id) =>
        set((state) => ({
          vaults: state.vaults.filter((v) => v.id !== id),
        })),

      getVaultById: (id) => get().vaults.find((v) => v.id === id),

      getVaultsByOwner: (owner) => get().vaults.filter((v) => v.owner === owner),

      clearVaults: () => set({ vaults: [] }),
    }),
    {
      name: 'zkusd-vaults',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          return {
            ...parsed,
            state: {
              ...parsed.state,
              vaults: parsed.state.vaults.map(deserializeVault),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              vaults: value.state.vaults.map(serializeVault),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
