// Protocol Constants
// Note: These mirror values from @zkusd/config/testnet4 for synchronous access.
// Keep in sync with packages/config/src/testnet4.ts
export const PROTOCOL = {
  MCR: 11000, // 110% Minimum Collateral Ratio (basis points)
  CCR: 15000, // 150% Critical Collateral Ratio (basis points)
  MIN_DEBT: 1_000_000_000n, // 10 zkUSD (8 decimals)
  GAS_COMPENSATION: 200_000_000n, // 2 zkUSD
  DECIMALS: 8,
  LIQUIDATION_BONUS_BPS: 50, // 0.5%
  REDEMPTION_FEE_FLOOR_BPS: 50, // 0.5%
} as const;

// Network Configuration
export const NETWORKS = {
  testnet4: {
    name: 'Testnet4',
    explorerUrl: 'https://mempool.space/testnet4',
    explorerApiUrl: 'https://mempool.space/testnet4/api',
    charmsProverUrl: 'https://v8.charms.dev/spells/prove',
  },
  mainnet: {
    name: 'Mainnet',
    explorerUrl: 'https://mempool.space',
    explorerApiUrl: 'https://mempool.space/api',
    charmsProverUrl: 'https://v8.charms.dev/spells/prove',
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

// Default Network
export const DEFAULT_NETWORK: NetworkId = 'testnet4';

// Refresh Intervals (ms)
export const REFRESH_INTERVALS = {
  price: 60_000, // 1 minute
  fees: 120_000, // 2 minutes
  blockHeight: 30_000, // 30 seconds
  balance: 30_000, // 30 seconds
} as const;

// UI Constants
export const UI = {
  MAX_DECIMALS_DISPLAY: 4,
  TOAST_DURATION: 5000,
  DEBOUNCE_MS: 300,
} as const;
