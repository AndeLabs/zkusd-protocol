import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format satoshis to BTC string
 */
export function formatBTC(satoshis: bigint | number, decimals = 8): string {
  const sats = typeof satoshis === 'bigint' ? satoshis : BigInt(satoshis);
  const btc = Number(sats) / 100_000_000;
  return btc.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format zkUSD amount (8 decimals) to display string
 */
export function formatZkUSD(amount: bigint | number, decimals = 2): string {
  const raw = typeof amount === 'bigint' ? amount : BigInt(amount);
  const value = Number(raw) / 100_000_000;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format USD value
 */
export function formatUSD(amount: number, decimals = 2): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format percentage from basis points
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
 * Truncate transaction ID
 */
export function truncateTxId(txid: string, chars = 8): string {
  if (txid.length <= chars * 2 + 3) return txid;
  return `${txid.slice(0, chars)}...${txid.slice(-chars)}`;
}

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
 * Calculate ICR (Individual Collateral Ratio) in basis points
 */
export function calculateICR(
  collateralSats: bigint,
  debtZkUSD: bigint,
  btcPriceUsd: number
): number {
  if (debtZkUSD === 0n) return Number.POSITIVE_INFINITY;

  // collateral value in USD (8 decimals)
  const collateralValueUsd = (Number(collateralSats) * btcPriceUsd) / 100_000_000;
  // debt in USD (already 8 decimals, convert to number)
  const debtValueUsd = Number(debtZkUSD) / 100_000_000;

  // ICR in basis points
  return Math.round((collateralValueUsd / debtValueUsd) * 10000);
}

/**
 * Get health status based on ICR
 */
export function getHealthStatus(icr: number): 'safe' | 'warning' | 'danger' {
  if (icr >= 15000) return 'safe'; // >= 150%
  if (icr >= 11000) return 'warning'; // >= 110%
  return 'danger'; // < 110%
}

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
