// Network Configuration for zkUSD Protocol
//
// This module provides network-aware configuration for the protocol.
// Use getNetworkConfig() to get the appropriate config for your target network.

export type NetworkId = 'testnet4' | 'mainnet';

export interface ContractDeployment {
  /** App ID (32 bytes hex) */
  appId: string;
  /** Verification Key (32 bytes hex) */
  vk: string;
  /** Full app reference in format n/{appId}/{vk} */
  appRef: string;
  /** Transaction ID where the contract was deployed */
  spellTx: string;
  /** UTXO containing the contract state */
  stateUtxo: string;
  /** Deployment status */
  status: 'confirmed' | 'in_mempool' | 'pending';
  /** Path to the WASM binary (for prover) */
  wasmPath?: string;
}

export interface NetworkDeployment {
  network: NetworkId;
  /** Charms protocol version */
  charmsVersion: number;
  /** Block explorer URL (for user-facing links) */
  explorerUrl: string;
  /** Block explorer API URL (for data fetching) */
  explorerApiUrl: string;
  /** Deployed contracts */
  contracts: {
    priceOracle: ContractDeployment;
    zkusdToken: ContractDeployment;
    vaultManager: ContractDeployment;
    stabilityPool: ContractDeployment;
  };
  /** Protocol addresses */
  addresses: {
    /** Admin address (should be multi-sig on mainnet) */
    admin: string;
    /** Default output address for protocol operations */
    outputAddress: string;
  };
  /** Protocol parameters */
  protocolParams: {
    /** Minimum Collateral Ratio in basis points (11000 = 110%) */
    mcr: number;
    /** Critical Collateral Ratio in basis points (15000 = 150%) */
    ccr: number;
    /** Minimum debt in base units (with 8 decimals) */
    minDebt: bigint;
    /** Gas compensation for liquidators in base units */
    gasCompensation: bigint;
    /** Liquidation bonus in basis points */
    liquidationBonusBps: number;
    /** Redemption fee floor in basis points */
    redemptionFeeFloorBps: number;
  };
}

// Prover API URLs with fallbacks
export interface ProverEndpoint {
  url: string;
  priority: number;
  healthCheckUrl?: string;
}

export const PROVER_ENDPOINTS: Record<NetworkId, ProverEndpoint[]> = {
  testnet4: [
    // v9 prover for Charms v0.11.1 (spell version 9)
    { url: 'https://v9.charms.dev/spells/prove', priority: 1 },
    // Fallback to v8 (only works with version 8 spells)
    { url: 'https://v8.charms.dev/spells/prove', priority: 2 },
  ],
  mainnet: [
    { url: 'https://v9.charms.dev/spells/prove', priority: 1 },
    { url: 'https://v8.charms.dev/spells/prove', priority: 2 },
  ],
};

// Import network-specific configs
import { TESTNET4_CONFIG } from './testnet4';
import { MAINNET_CONFIG, validateMainnetConfig } from './mainnet';

const NETWORK_CONFIGS: Record<NetworkId, NetworkDeployment> = {
  testnet4: TESTNET4_CONFIG,
  mainnet: MAINNET_CONFIG,
};

/**
 * Get network configuration
 * @param network - Network identifier
 * @param validate - If true, validates the config (throws on error)
 */
export function getNetworkConfig(network: NetworkId, validate = false): NetworkDeployment {
  const config = NETWORK_CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }

  if (validate && network === 'mainnet') {
    validateMainnetConfig();
  }

  return config;
}

/**
 * Check if a network is configured and ready for use
 */
export function isNetworkReady(network: NetworkId): boolean {
  const config = NETWORK_CONFIGS[network];
  if (!config) return false;

  // Check that all contracts are confirmed
  const contracts = config.contracts;
  for (const contract of Object.values(contracts)) {
    if (contract.status !== 'confirmed' || !contract.appId || !contract.vk) {
      return false;
    }
  }

  // Check addresses are set
  if (!config.addresses.admin || !config.addresses.outputAddress) {
    return false;
  }

  return true;
}

/**
 * Get prover endpoints for a network (ordered by priority)
 */
export function getProverEndpoints(network: NetworkId): ProverEndpoint[] {
  return PROVER_ENDPOINTS[network]
    .slice()
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerTxUrl(network: NetworkId, txid: string): string {
  const config = getNetworkConfig(network);
  return `${config.explorerUrl}/tx/${txid}`;
}

/**
 * Get explorer URL for an address
 */
export function getExplorerAddressUrl(network: NetworkId, address: string): string {
  const config = getNetworkConfig(network);
  return `${config.explorerUrl}/address/${address}`;
}

/**
 * Validate a contract deployment is properly configured
 */
export function validateContract(contract: ContractDeployment, name: string): string[] {
  const errors: string[] = [];

  if (!contract.appId || contract.appId.length !== 64) {
    errors.push(`${name}: Invalid appId (expected 64 hex chars)`);
  }

  if (!contract.vk || contract.vk.length !== 64) {
    errors.push(`${name}: Invalid vk (expected 64 hex chars)`);
  }

  if (!contract.appRef || !contract.appRef.startsWith('n/')) {
    errors.push(`${name}: Invalid appRef format`);
  }

  if (contract.status !== 'confirmed') {
    errors.push(`${name}: Contract not confirmed`);
  }

  return errors;
}

/**
 * Get the testnet4 or mainnet constant values that match Rust constants
 * These should align with the values in contracts/common/src/constants.rs
 */
export function getProtocolConstants(network: NetworkId) {
  const isMainnet = network === 'mainnet';

  return {
    // Token constants (same for all networks)
    TOKEN_DECIMALS: 8,
    ONE_TOKEN: 100_000_000n, // 10^8

    // Ratio constants (in percentage points)
    MCR: 110, // 110%
    CCR: 150, // 150%
    RECOMMENDED_MIN_RATIO: 200, // 200%

    // Fee constants (in basis points)
    MIN_BORROWING_FEE_BPS: 50, // 0.5%
    MAX_BORROWING_FEE_BPS: 500, // 5%
    REDEMPTION_FEE_FLOOR_BPS: 50, // 0.5%

    // Debt limits (network-dependent)
    MIN_DEBT: isMainnet ? 200_000_000_000n : 1_000_000_000n, // 2000 vs 10 zkUSD
    LIQUIDATION_RESERVE: isMainnet ? 20_000_000_000n : 200_000_000n, // 200 vs 2 zkUSD

    // Stability pool
    MIN_SP_DEPOSIT: isMainnet ? 10_000_000_000n : 100_000_000n, // 100 vs 1 zkUSD

    // Liquidation
    LIQUIDATOR_BONUS_BPS: 50, // 0.5%
    GAS_COMP_BPS: 50, // 0.5%

    // Time (in Bitcoin blocks, ~10 min each)
    BLOCKS_PER_DAY: 144,
    BLOCKS_PER_HOUR: 6,
    MAX_PRICE_AGE_BLOCKS: 6, // ~1 hour
  };
}
