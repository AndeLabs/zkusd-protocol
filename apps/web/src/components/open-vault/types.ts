import type { Utxo } from '@/stores/wallet';

export type FormStep = 'input' | 'confirm' | 'signing' | 'broadcasting' | 'success' | 'error';

export interface VaultFormState {
  collateralBtc: string;
  debtZkusd: string;
  formStep: FormStep;
  txResult: TxResult | null;
  errorMessage: string | null;
}

export interface TxResult {
  commitTxId?: string;
  spellTxId?: string;
}

export interface VaultCalculations {
  collateralSats: bigint;
  debtRaw: bigint;
  fee: bigint;
  totalDebt: bigint;
  icr: number;
  liquidationPrice: bigint;
  maxMintable: bigint;
  collateralUsd: number;
  feeRate: number;
}

export interface VaultValidation {
  isValid: boolean;
  hasEnoughBalance: boolean;
  fundingUtxo: Utxo | undefined;
}

export interface VaultFormActions {
  setCollateralBtc: (value: string) => void;
  setDebtZkusd: (value: string) => void;
  handleSetMax: () => void;
  handleSetMaxDebt: () => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleConfirm: () => Promise<void>;
  resetForm: () => void;
}
