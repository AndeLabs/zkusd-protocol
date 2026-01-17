// zkUSD Core Types

// ============================================================================
// Protocol Constants
// ============================================================================

export const PROTOCOL_CONSTANTS = {
  MCR: 11000, // 110% Minimum Collateral Ratio
  CCR: 15000, // 150% Critical Collateral Ratio
  MIN_DEBT: 1_000_000_000n, // 10 zkUSD (8 decimals)
  GAS_COMPENSATION: 200_000_000n, // 2 zkUSD
  SCALE_FACTOR: 10_000n, // Basis points scale
  DECIMALS: 8,
} as const;

// Individual exports for convenience
export const MCR = PROTOCOL_CONSTANTS.MCR;
export const CCR = PROTOCOL_CONSTANTS.CCR;
export const MIN_DEBT = PROTOCOL_CONSTANTS.MIN_DEBT;
export const DECIMALS = PROTOCOL_CONSTANTS.DECIMALS;

// ============================================================================
// Vault Types
// ============================================================================

export interface Vault {
  id: string;
  owner: string;
  collateral: bigint; // satoshis
  debt: bigint; // zkUSD (8 decimals)
  status: VaultStatus;
  createdAt: number;
  updatedAt: number;
  // Extended fields from charm state
  lastUpdated?: number;
  interestRateBps?: number;
  accruedInterest?: bigint;
  redistributedDebt?: bigint;
  redistributedCollateral?: bigint;
  insuranceBalance?: bigint;
}

export type VaultStatus = 'active' | 'closed' | 'liquidated';

export interface VaultPosition {
  vault: Vault;
  icr: number; // Individual Collateral Ratio (basis points)
  healthFactor: number;
  liquidationPrice: bigint;
  maxWithdrawable: bigint;
  maxMintable: bigint;
}

// ============================================================================
// Token Types
// ============================================================================

export interface TokenState {
  authorizedMinter: string; // VM App ID
  totalSupply: bigint;
}

export interface TokenBalance {
  address: string;
  balance: bigint;
}

// ============================================================================
// Oracle Types
// ============================================================================

export interface OraclePrice {
  price: bigint; // BTC/USD price (8 decimals)
  timestamp: number;
  source: PriceSource;
}

export type PriceSource = 'manual' | 'aggregator' | 'coingecko' | 'coinbase' | 'kraken';

// ============================================================================
// Protocol State Types
// ============================================================================

export interface ProtocolState {
  totalCollateral: bigint;
  totalDebt: bigint;
  activeVaultCount: number;
  baseRate: number;
  lastFeeUpdateBlock: number;
  admin: string;
  isPaused: boolean;
}

export interface VaultManagerState {
  protocol: ProtocolState;
  zkusdTokenId: string;
  stabilityPoolId: string;
  priceOracleId: string;
  activePool: string;
  defaultPool: string;
}

// ============================================================================
// Stability Pool Types
// ============================================================================

export interface StabilityPoolState {
  totalDeposits: bigint; // Total zkUSD deposited
  totalCollateralGains: bigint; // Total BTC from liquidations
  depositorCount: number;
  epochScale: number; // For loss distribution tracking
  lastUpdated: number;
}

export interface StabilityPoolDeposit {
  depositor: string;
  deposit: bigint; // zkUSD deposited
  collateralGain: bigint; // BTC earned from liquidations
  snapshotEpoch: number;
  snapshotScale: number;
  depositTime: number;
}

export interface DepositParams {
  amount: bigint; // zkUSD to deposit
}

export interface WithdrawParams {
  amount: bigint; // zkUSD to withdraw (0 = all)
}

export interface ClaimGainsParams {
  // No params needed - claims all accumulated gains
}

// ============================================================================
// Transaction Types
// ============================================================================

export interface OpenVaultParams {
  collateral: bigint;
  debt: bigint;
  owner: string;
}

export interface AdjustVaultParams {
  vaultId: string;
  collateralChange: bigint;
  debtChange: bigint;
  isCollateralIncrease: boolean;
  isDebtIncrease: boolean;
}

export interface CloseVaultParams {
  vaultId: string;
}

// ============================================================================
// Charms Types
// ============================================================================

export interface CharmApp {
  appId: string;
  vk: string;
  appRef: string; // n/{appId}/{vk} or t/{appId}/{vk}
  wasmPath?: string; // Path to WASM binary for prover
}

export interface SpellInput {
  utxoId: string;
  charms: Record<string, unknown>;
}

export interface SpellOutput {
  address: string;
  charms: Record<string, unknown>;
}

// ============================================================================
// Network Types
// ============================================================================

export type Network = 'mainnet' | 'testnet4' | 'signet' | 'regtest';

export interface NetworkConfig {
  network: Network;
  explorerUrl: string;
  charmsApiUrl?: string;
}

// ============================================================================
// Deployment Types
// ============================================================================

export interface DeploymentConfig {
  network: Network;
  contracts: {
    priceOracle: CharmApp;
    zkusdToken: CharmApp;
    vaultManager: CharmApp;
    stabilityPool: CharmApp;
  };
  addresses: {
    admin: string;
    outputAddress: string;
  };
}
