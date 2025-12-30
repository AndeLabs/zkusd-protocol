import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export interface Vault {
  id: string;
  txid: string;
  vout: number;
  collateralSats: number;
  debtZkusd: number;
  collateralRatio: number;
  liquidationPrice: number;
  status: 'active' | 'liquidated' | 'closed';
  createdAt: number;
  lastUpdated: number;
}

export interface VaultOperation {
  type: 'open' | 'adjust' | 'close' | 'liquidate';
  txid: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  details: {
    collateralChange?: number;
    debtChange?: number;
  };
}

interface VaultState {
  // User vaults
  vaults: Vault[];
  isLoading: boolean;
  error: string | null;

  // Pending operations
  pendingOperations: VaultOperation[];

  // Selected vault for modal
  selectedVaultId: string | null;

  // Protocol stats
  protocolStats: {
    totalCollateral: number;
    totalDebt: number;
    totalVaults: number;
    minCollateralRatio: number;
  } | null;
}

interface VaultActions {
  // Vault management
  setVaults: (vaults: Vault[]) => void;
  addVault: (vault: Vault) => void;
  updateVault: (id: string, updates: Partial<Vault>) => void;
  removeVault: (id: string) => void;

  // Operations
  addPendingOperation: (op: VaultOperation) => void;
  updateOperation: (txid: string, status: VaultOperation['status']) => void;
  clearPendingOperations: () => void;

  // UI
  selectVault: (id: string | null) => void;

  // Protocol
  setProtocolStats: (stats: VaultState['protocolStats']) => void;

  // Loading
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Reset
  reset: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: VaultState = {
  vaults: [],
  isLoading: false,
  error: null,
  pendingOperations: [],
  selectedVaultId: null,
  protocolStats: null,
};

// ============================================================================
// Store
// ============================================================================

export const useVaultStore = create<VaultState & VaultActions>()((set, get) => ({
  ...initialState,

  setVaults: (vaults) => set({ vaults }),

  addVault: (vault) =>
    set((state) => ({
      vaults: [...state.vaults, vault],
    })),

  updateVault: (id, updates) =>
    set((state) => ({
      vaults: state.vaults.map((v) =>
        v.id === id ? { ...v, ...updates, lastUpdated: Date.now() } : v
      ),
    })),

  removeVault: (id) =>
    set((state) => ({
      vaults: state.vaults.filter((v) => v.id !== id),
      selectedVaultId: state.selectedVaultId === id ? null : state.selectedVaultId,
    })),

  addPendingOperation: (op) =>
    set((state) => ({
      pendingOperations: [...state.pendingOperations, op],
    })),

  updateOperation: (txid, status) =>
    set((state) => ({
      pendingOperations: state.pendingOperations.map((op) =>
        op.txid === txid ? { ...op, status } : op
      ),
    })),

  clearPendingOperations: () =>
    set((state) => ({
      pendingOperations: state.pendingOperations.filter((op) => op.status === 'pending'),
    })),

  selectVault: (id) => set({ selectedVaultId: id }),

  setProtocolStats: (stats) => set({ protocolStats: stats }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  reset: () => set({ ...initialState }),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectVaults = (state: VaultState) => state.vaults;
export const selectActiveVaults = (state: VaultState) => state.vaults.filter((v) => v.status === 'active');
export const selectSelectedVault = (state: VaultState) =>
  state.vaults.find((v) => v.id === state.selectedVaultId) || null;
export const selectPendingOperations = (state: VaultState) =>
  state.pendingOperations.filter((op) => op.status === 'pending');
export const selectProtocolStats = (state: VaultState) => state.protocolStats;

// ============================================================================
// Derived Calculations
// ============================================================================

export function calculateVaultHealth(vault: Vault, minCR: number = 150): 'safe' | 'warning' | 'danger' {
  if (vault.collateralRatio >= minCR * 1.5) return 'safe';
  if (vault.collateralRatio >= minCR * 1.1) return 'warning';
  return 'danger';
}

export function calculateLiquidationPrice(
  collateralSats: number,
  debtZkusd: number,
  minCR: number = 150
): number {
  if (collateralSats === 0) return 0;
  // liquidation_price = (debt * minCR) / collateral
  const collateralBtc = collateralSats / 100_000_000;
  return (debtZkusd * (minCR / 100)) / collateralBtc;
}

export function calculateCollateralRatio(
  collateralSats: number,
  debtZkusd: number,
  btcPrice: number
): number {
  if (debtZkusd === 0) return Infinity;
  const collateralUsd = (collateralSats / 100_000_000) * btcPrice;
  return (collateralUsd / debtZkusd) * 100;
}
