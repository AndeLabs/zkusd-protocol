// Mainnet Deployment Configuration
// Production configuration with proper values
//
// IMPORTANT: This config is for mainnet. All contracts must be:
// 1. Compiled with `--features mainnet` flag
// 2. Thoroughly audited
// 3. Deployed with multi-sig admin

import type { NetworkDeployment } from './networks';

export const MAINNET_CONFIG: NetworkDeployment = {
  network: 'mainnet',
  charmsVersion: 8,
  explorerUrl: 'https://mempool.space',
  explorerApiUrl: 'https://mempool.space/api',

  // MAINNET CONTRACTS - TO BE DEPLOYED
  // All contracts should be marked 'pending' until actual deployment
  contracts: {
    priceOracle: {
      appId: '', // Will be set after deployment
      vk: '', // Will be set after deployment
      appRef: '', // Will be set after deployment
      spellTx: '', // Will be set after deployment
      stateUtxo: '', // Will be set after deployment
      status: 'pending',
      wasmPath: '/wasm/zkusd-price-oracle-app.wasm',
    },
    zkusdToken: {
      appId: '',
      vk: '',
      appRef: '',
      spellTx: '',
      stateUtxo: '',
      status: 'pending',
      wasmPath: '/wasm/zkusd-token-app.wasm',
    },
    vaultManager: {
      appId: '',
      vk: '',
      appRef: '',
      spellTx: '',
      stateUtxo: '',
      status: 'pending',
      wasmPath: '/wasm/zkusd-vault-manager-app.wasm',
    },
    stabilityPool: {
      appId: '',
      vk: '',
      appRef: '',
      spellTx: '',
      stateUtxo: '',
      status: 'pending',
      wasmPath: '/wasm/zkusd-stability-pool-app.wasm',
    },
  },

  // MAINNET ADDRESSES
  // IMPORTANT: These should be multi-sig addresses for production
  addresses: {
    // Admin should be a multi-sig (2-of-3 minimum)
    admin: '', // TODO: Set to multi-sig address before mainnet launch
    // Output address for protocol-owned liquidity
    outputAddress: '', // TODO: Set to multi-sig address before mainnet launch
  },

  // MAINNET PROTOCOL PARAMETERS
  // These values are for production use
  protocolParams: {
    // Minimum Collateral Ratio: 110%
    mcr: 11000,
    // Critical Collateral Ratio: 150%
    ccr: 15000,
    // Minimum debt: 2,000 zkUSD (ensures liquidation profitability)
    minDebt: 200_000_000_000n, // 2000 * 10^8
    // Gas compensation: 200 zkUSD (covers real gas costs + incentive)
    gasCompensation: 20_000_000_000n, // 200 * 10^8
    // Liquidation bonus: 0.5%
    liquidationBonusBps: 50,
    // Redemption fee floor: 0.5%
    redemptionFeeFloorBps: 50,
  },
};

// Cross-reference App IDs - will be populated after deployment
export const MAINNET_CROSS_REFS = {
  tokenAuthorizedMinter: [] as number[],
  vmTokenId: [] as number[],
  vmStabilityPoolId: [] as number[],
  vmOracleId: [] as number[],
};

/**
 * Validate mainnet config before use
 * Throws if any required field is missing
 */
export function validateMainnetConfig(): void {
  const errors: string[] = [];

  // Check contracts
  const contracts = MAINNET_CONFIG.contracts;
  for (const [name, contract] of Object.entries(contracts)) {
    if (!contract.appId) {
      errors.push(`Contract ${name} missing appId`);
    }
    if (!contract.vk) {
      errors.push(`Contract ${name} missing vk`);
    }
    if (contract.status !== 'confirmed') {
      errors.push(`Contract ${name} not confirmed (status: ${contract.status})`);
    }
  }

  // Check addresses
  if (!MAINNET_CONFIG.addresses.admin) {
    errors.push('Admin address not set');
  }
  if (!MAINNET_CONFIG.addresses.outputAddress) {
    errors.push('Output address not set');
  }

  // Validate admin is not a single-sig (basic check for multi-sig pattern)
  // In production, this should verify it's actually a multi-sig
  if (MAINNET_CONFIG.addresses.admin && MAINNET_CONFIG.addresses.admin.length < 40) {
    errors.push('Admin address appears to be single-sig - use multi-sig for mainnet');
  }

  if (errors.length > 0) {
    throw new Error(`Mainnet config validation failed:\n${errors.join('\n')}`);
  }
}
