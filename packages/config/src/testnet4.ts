// Testnet4 Deployment Configuration
// Generated from deployments/testnet4/deployment-config.json
//
// STATUS: DEPLOYED - V3 deployment with wasm32-wasip1 target (correct for Charms)
// All contracts redeployed 2026-01-21 with matching VKs
//
// Current WASM VKs (from compiled binaries) - ALL MATCH DEPLOYED:
//   price-oracle:    98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d
//   zkusd-token:     ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128
//   vault-manager:   833e8d5ec3f31d6cd0a9346d08d12916abd52c3c12ff8eb9f14ebeb265b3085f
//   stability-pool:  98ef9f08108227ab28aab842a9370cb0ec0e289b8dba21a319ec106927ea08e9

import type { NetworkDeployment } from './networks';

// Contracts are now deployed with matching VKs
export const TESTNET4_NEEDS_REDEPLOYMENT = false;

// VKs from current compiled WASM (now match deployed contracts)
export const TESTNET4_VKS = {
  priceOracle: '98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d',
  zkusdToken: 'ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128',
  vaultManager: '833e8d5ec3f31d6cd0a9346d08d12916abd52c3c12ff8eb9f14ebeb265b3085f',
  stabilityPool: '98ef9f08108227ab28aab842a9370cb0ec0e289b8dba21a319ec106927ea08e9',
};

export const TESTNET4_CONFIG: NetworkDeployment = {
  network: 'testnet4',
  charmsVersion: 8,
  explorerUrl: 'https://mempool.space/testnet4',
  explorerApiUrl: 'https://mempool.space/testnet4/api',

  // V3 DEPLOYED CONTRACTS (2026-01-21)
  // All VKs match the current WASM binaries compiled with wasm32-wasip1 target
  contracts: {
    priceOracle: {
      appId: '26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5',
      vk: '98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d',
      appRef: 'n/26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5/98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d',
      spellTx: '03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4',
      stateUtxo: '03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4:0',
      status: 'confirmed',
      wasmPath: '/wasm/zkusd-price-oracle-app.wasm',
    },
    zkusdToken: {
      appId: '7ff62ba48cbb4e8437aab1a32050ad0e4c8c874db34ab10aa015a9d98bddcef1',
      vk: 'ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128',
      appRef: 'n/7ff62ba48cbb4e8437aab1a32050ad0e4c8c874db34ab10aa015a9d98bddcef1/ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128',
      spellTx: '6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988',
      stateUtxo: '6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988:0',
      status: 'confirmed',
      wasmPath: '/wasm/zkusd-token-app.wasm',
    },
    vaultManager: {
      appId: 'ca8ab2dc30c97b7be1d6e9175c33f828aac447917ff5605fca0ff3acffcb1fa9',
      vk: '833e8d5ec3f31d6cd0a9346d08d12916abd52c3c12ff8eb9f14ebeb265b3085f',
      appRef: 'n/ca8ab2dc30c97b7be1d6e9175c33f828aac447917ff5605fca0ff3acffcb1fa9/833e8d5ec3f31d6cd0a9346d08d12916abd52c3c12ff8eb9f14ebeb265b3085f',
      spellTx: 'aac009d17665311d94ec0accf48aad8db6a06c54cc383bb8933c28eb92b03f02',
      stateUtxo: 'aac009d17665311d94ec0accf48aad8db6a06c54cc383bb8933c28eb92b03f02:0',
      status: 'pending',
      wasmPath: '/wasm/zkusd-vault-manager-app.wasm',
    },
    stabilityPool: {
      appId: '001537495ecc1bc1e19892052ece990bcbcf301a043e5ce1019680d721a5dc6b',
      vk: '98ef9f08108227ab28aab842a9370cb0ec0e289b8dba21a319ec106927ea08e9',
      appRef: 'n/001537495ecc1bc1e19892052ece990bcbcf301a043e5ce1019680d721a5dc6b/98ef9f08108227ab28aab842a9370cb0ec0e289b8dba21a319ec106927ea08e9',
      spellTx: '20d41c6e5b4df501f6394392a56a534730bc84794da1f8adabe5dc6084ee560c',
      stateUtxo: '20d41c6e5b4df501f6394392a56a534730bc84794da1f8adabe5dc6084ee560c:0',
      status: 'pending',
      wasmPath: '/wasm/zkusd-stability-pool-app.wasm',
    },
  },

  addresses: {
    admin: '0fef72e8286c0dd8d5dd569e930433c322330d338650adc1aa0a4502d35a1748',
    outputAddress: 'tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq',
  },

  protocolParams: {
    mcr: 11000, // 110%
    ccr: 15000, // 150%
    minDebt: 1_000_000_000n, // 10 zkUSD
    gasCompensation: 200_000_000n, // 2 zkUSD
    liquidationBonusBps: 50, // 0.5%
    redemptionFeeFloorBps: 50, // 0.5%
  },
};

// Cross-reference App IDs (for building spells)
// Updated to match V3 deployment
export const TESTNET4_CROSS_REFS = {
  // Token.authorized_minter = VaultManager App ID
  tokenAuthorizedMinter: [202, 138, 178, 220, 48, 201, 123, 123, 225, 214, 233, 23, 92, 51, 248, 40, 170, 196, 71, 145, 127, 245, 96, 95, 202, 15, 243, 172, 255, 203, 31, 169],
  // VaultManager.zkusd_token_id = Token App ID
  vmTokenId: [127, 246, 43, 164, 140, 187, 78, 132, 55, 170, 177, 163, 32, 80, 173, 14, 76, 140, 135, 77, 179, 74, 177, 10, 160, 21, 169, 217, 139, 221, 206, 241],
  // VaultManager.stability_pool_id = StabilityPool App ID
  vmStabilityPoolId: [0, 21, 55, 73, 94, 204, 27, 193, 225, 152, 146, 5, 46, 206, 153, 11, 203, 207, 48, 26, 4, 62, 92, 225, 1, 150, 128, 215, 33, 165, 220, 107],
  // VaultManager.oracle_id = PriceOracle App ID
  vmOracleId: [38, 24, 109, 124, 39, 187, 40, 116, 141, 30, 200, 155, 161, 251, 96, 18, 93, 138, 37, 109, 253, 154, 151, 130, 150, 170, 89, 248, 199, 233, 232, 181],
  // StabilityPool.zkusd_token_id = Token App ID
  spTokenId: [127, 246, 43, 164, 140, 187, 78, 132, 55, 170, 177, 163, 32, 80, 173, 14, 76, 140, 135, 77, 179, 74, 177, 10, 160, 21, 169, 217, 139, 221, 206, 241],
  // StabilityPool.vault_manager_id = VaultManager App ID
  spVaultManagerId: [202, 138, 178, 220, 48, 201, 123, 123, 225, 214, 233, 23, 92, 51, 248, 40, 170, 196, 71, 145, 127, 245, 96, 95, 202, 15, 243, 172, 255, 203, 31, 169],
};
