// zkUSD Utility Functions

import { PROTOCOL_CONSTANTS } from '@zkusd/types';

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format satoshis to BTC string
 */
export function formatBTC(satoshis: bigint, decimals = 8): string {
  const btc = Number(satoshis) / 100_000_000;
  return btc.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format zkUSD amount (8 decimals) to string
 */
export function formatZkUSD(amount: bigint, decimals = 2): string {
  const value = Number(amount) / 10 ** PROTOCOL_CONSTANTS.DECIMALS;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format USD price
 */
export function formatUSD(amount: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Format percentage
 */
export function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Truncate txid for display
 */
export function truncateTxId(txid: string, chars = 8): string {
  return truncateAddress(txid, chars);
}

// ============================================================================
// Calculations
// ============================================================================

/**
 * Calculate Individual Collateral Ratio (ICR)
 * Returns basis points (10000 = 100%)
 */
export function calculateICR(
  collateralSats: bigint,
  debtZkUSD: bigint,
  btcPriceUsd: bigint
): number {
  if (debtZkUSD === 0n) return Number.MAX_SAFE_INTEGER;

  // collateral value in USD (8 decimals)
  const collateralUsd = (collateralSats * btcPriceUsd) / 100_000_000n;

  // ICR = (collateral / debt) * 10000
  const icr = (collateralUsd * 10000n) / debtZkUSD;

  return Number(icr);
}

/**
 * Check if vault is healthy (ICR >= MCR)
 */
export function isVaultHealthy(icr: number): boolean {
  return icr >= PROTOCOL_CONSTANTS.MCR;
}

/**
 * Check if vault is at risk (MCR <= ICR < CCR)
 */
export function isVaultAtRisk(icr: number): boolean {
  return icr >= PROTOCOL_CONSTANTS.MCR && icr < PROTOCOL_CONSTANTS.CCR;
}

/**
 * Check if vault is critical (ICR < MCR)
 */
export function isVaultCritical(icr: number): boolean {
  return icr < PROTOCOL_CONSTANTS.MCR;
}

/**
 * Calculate liquidation price
 * Returns price in USD (8 decimals) at which vault becomes liquidatable
 */
export function calculateLiquidationPrice(
  collateralSats: bigint,
  debtZkUSD: bigint
): bigint {
  if (collateralSats === 0n) return 0n;

  // liquidation_price = (debt * MCR * 100_000_000) / (collateral * 10000)
  const liquidationPrice =
    (debtZkUSD * BigInt(PROTOCOL_CONSTANTS.MCR) * 100_000_000n) /
    (collateralSats * 10000n);

  return liquidationPrice;
}

/**
 * Calculate maximum mintable zkUSD for given collateral and price
 */
export function calculateMaxMintable(
  collateralSats: bigint,
  btcPriceUsd: bigint,
  currentDebt: bigint = 0n
): bigint {
  // collateral value in zkUSD (8 decimals)
  const collateralValue = (collateralSats * btcPriceUsd) / 100_000_000n;

  // max debt at MCR
  const maxDebt = (collateralValue * 10000n) / BigInt(PROTOCOL_CONSTANTS.MCR);

  // subtract current debt and gas compensation
  const available = maxDebt - currentDebt - PROTOCOL_CONSTANTS.GAS_COMPENSATION;

  return available > 0n ? available : 0n;
}

/**
 * Calculate required collateral for given debt
 */
export function calculateRequiredCollateral(
  debtZkUSD: bigint,
  btcPriceUsd: bigint,
  targetICR: number = PROTOCOL_CONSTANTS.CCR
): bigint {
  if (btcPriceUsd === 0n) return 0n;

  // required collateral = (debt * targetICR * 100_000_000) / (price * 10000)
  const required =
    (debtZkUSD * BigInt(targetICR) * 100_000_000n) / (btcPriceUsd * 10000n);

  return required;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate minimum debt requirement
 */
export function validateMinDebt(debt: bigint): boolean {
  return debt >= PROTOCOL_CONSTANTS.MIN_DEBT;
}

/**
 * Validate Bitcoin address format (basic check)
 */
export function isValidBitcoinAddress(address: string, network: 'mainnet' | 'testnet4' = 'testnet4'): boolean {
  if (network === 'testnet4') {
    // Testnet addresses start with tb1, 2, m, n
    return /^(tb1|2|m|n)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address);
  }
  // Mainnet addresses start with bc1, 1, 3
  return /^(bc1|1|3)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address);
}

/**
 * Validate hex string
 */
export function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Validate txid format
 */
export function isValidTxId(txid: string): boolean {
  return txid.length === 64 && isValidHex(txid);
}

// ============================================================================
// Conversions
// ============================================================================

/**
 * Convert BTC to satoshis
 */
export function btcToSats(btc: number): bigint {
  return BigInt(Math.round(btc * 100_000_000));
}

/**
 * Convert satoshis to BTC
 */
export function satsToBtc(sats: bigint): number {
  return Number(sats) / 100_000_000;
}

/**
 * Convert zkUSD display value to raw (8 decimals)
 */
export function zkUsdToRaw(value: number): bigint {
  return BigInt(Math.round(value * 10 ** PROTOCOL_CONSTANTS.DECIMALS));
}

/**
 * Convert raw zkUSD (8 decimals) to display value
 */
export function rawToZkUsd(raw: bigint): number {
  return Number(raw) / 10 ** PROTOCOL_CONSTANTS.DECIMALS;
}

/**
 * Hex string to byte array
 */
export function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Byte array to hex string
 */
export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
