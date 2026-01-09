// ============================================================================
// Protocol Constants
// ============================================================================

/**
 * Minimum Collateral Ratio (MCR) - 110%
 * Vaults below this ratio are eligible for liquidation
 */
export const MCR = 11000; // basis points (11000 = 110%)

/**
 * Critical Collateral Ratio (CCR) - 150%
 * Recommended safe ratio to avoid liquidation risk
 */
export const CCR = 15000; // basis points (15000 = 150%)

/**
 * Maximum display ICR for progress bars
 * ICR above this is capped for visualization purposes
 */
export const MAX_DISPLAY_ICR = 25000; // 250%

/**
 * Basis points divisor for ICR calculations
 */
export const BASIS_POINTS = 10000;

// ============================================================================
// Fee Constants
// ============================================================================

/**
 * Opening fee percentage for new vaults
 */
export const OPENING_FEE_PERCENT = 1.0; // 1%

/**
 * Fee buffer for transaction estimation (satoshis)
 * Used to ensure enough BTC for network fees
 */
export const FEE_BUFFER_SATS = 10000; // 10,000 sats

/**
 * Minimum network fee rate (sat/vB)
 */
export const MIN_FEE_RATE = 1;

/**
 * Default network fee rate when estimation fails (sat/vB)
 */
export const DEFAULT_FEE_RATE = 2;

// ============================================================================
// Vault Limits
// ============================================================================

/**
 * Minimum debt amount for a vault (in zkUSD base units)
 */
export const MIN_VAULT_DEBT = 10_00000000n; // 10 zkUSD (8 decimals)

/**
 * Maximum LTV for vault creation display purposes
 */
export const MAX_LTV_PERCENT = 90; // 90%

// ============================================================================
// Refresh Intervals (milliseconds)
// ============================================================================

export const REFRESH_INTERVALS = {
  /** BTC price refresh interval */
  PRICE: 60_000, // 1 minute

  /** Protocol state refresh interval */
  PROTOCOL_STATE: 30_000, // 30 seconds

  /** Block height refresh interval */
  BLOCK_HEIGHT: 30_000, // 30 seconds

  /** Fee estimates refresh interval */
  FEE_ESTIMATES: 120_000, // 2 minutes

  /** Vault data refresh interval */
  VAULTS: 60_000, // 1 minute

  /** Error retry interval */
  ERROR_RETRY: 5_000, // 5 seconds
} as const;

// ============================================================================
// Cache TTL (milliseconds)
// ============================================================================

export const CACHE_TTL = {
  /** Price data cache duration */
  PRICE: 60_000, // 1 minute

  /** Oracle data staleness threshold */
  ORACLE_STALENESS: 10 * 60 * 1000, // 10 minutes

  /** UTXO cache duration */
  UTXOS: 30_000, // 30 seconds
} as const;

// ============================================================================
// UI Constants
// ============================================================================

export const UI = {
  /** Decimals for BTC display */
  BTC_DECIMALS: 8,

  /** Decimals for zkUSD display */
  ZKUSD_DECIMALS: 8,

  /** Satoshis per BTC */
  SATS_PER_BTC: 100_000_000,

  /** Maximum decimal places to show for prices */
  PRICE_DECIMALS: 2,

  /** Truncate address to show first/last N characters */
  ADDRESS_TRUNCATE_LENGTH: 8,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert ICR basis points to percentage string
 */
export function icrToPercent(icr: number): string {
  return `${(icr / 100).toFixed(1)}%`;
}

/**
 * Check if ICR is below MCR (liquidatable)
 */
export function isLiquidatable(icr: number): boolean {
  return icr < MCR;
}

/**
 * Check if ICR is at risk (between MCR and CCR)
 */
export function isAtRisk(icr: number): boolean {
  return icr >= MCR && icr < CCR;
}

/**
 * Check if ICR is healthy (above CCR)
 */
export function isHealthy(icr: number): boolean {
  return icr >= CCR;
}

/**
 * Get ICR status color class
 */
export function getIcrColorClass(icr: number): string {
  if (icr < MCR) return 'text-red-400';
  if (icr < CCR) return 'text-yellow-400';
  return 'text-green-400';
}

/**
 * Get ICR background color class
 */
export function getIcrBgClass(icr: number): string {
  if (icr < MCR) return 'bg-red-400/10';
  if (icr < CCR) return 'bg-yellow-400/10';
  return 'bg-green-400/10';
}

/**
 * Calculate normalized progress for ICR bar (0-100)
 */
export function getIcrProgress(icr: number): number {
  return Math.min(100, Math.max(0, ((icr - MCR) / (MAX_DISPLAY_ICR - MCR)) * 100));
}

/**
 * Get progress bar color class based on ICR
 */
export function getIcrProgressClass(icr: number): string {
  if (icr < MCR) return 'bg-red-500';
  if (icr < CCR) return 'bg-yellow-500';
  return 'bg-green-500';
}
