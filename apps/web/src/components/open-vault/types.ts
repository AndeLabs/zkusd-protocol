import type { Utxo } from '@/stores/wallet';

// ============================================================================
// Form State
// ============================================================================

export type FormStep = 'input' | 'confirm' | 'signing' | 'broadcasting' | 'success' | 'error';

export interface TxResult {
  commitTxId?: string;
  spellTxId?: string;
}

// ============================================================================
// Calculations
// ============================================================================

export interface VaultCalculations {
  /** Collateral amount in satoshis */
  collateralSats: bigint;
  /** Raw debt amount (before fees) in zkUSD base units */
  debtRaw: bigint;
  /** Opening fee in zkUSD base units */
  fee: bigint;
  /** Total debt including fees */
  totalDebt: bigint;
  /** Individual Collateral Ratio (basis points, e.g., 15000 = 150%) */
  icr: number;
  /** Price at which vault would be liquidated */
  liquidationPrice: bigint;
  /** Maximum zkUSD that can be minted with current collateral */
  maxMintable: bigint;
  /** Collateral value in USD */
  collateralUsd: number;
  /** Fee rate in basis points */
  feeRate: number;
}

// ============================================================================
// Validation
// ============================================================================

export interface VaultValidation {
  /** Whether all validation checks pass */
  isValid: boolean;
  /** Whether user has enough total BTC balance */
  hasEnoughBalance: boolean;
  /** Whether a suitable UTXO exists for the transaction */
  hasEnoughUtxos: boolean;
  /**
   * The UTXO that will fund the vault (collateral + fees).
   * For open vault, this is the only UTXO needed since spell.ins is empty.
   */
  fundingUtxo: Utxo | undefined;
}

// ============================================================================
// Actions
// ============================================================================

export interface VaultFormActions {
  setCollateralBtc: (value: string) => void;
  setDebtZkusd: (value: string) => void;
  handleSetMax: () => void;
  handleSetMaxDebt: () => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleConfirm: () => Promise<void>;
  resetForm: () => void;
}
