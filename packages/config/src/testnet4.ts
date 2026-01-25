// Testnet4 Deployment Configuration
// Generated from deployments/testnet4/deployment-config.json
//
// STATUS: V7 - VAULTMANAGER V2 DEPLOYED 2026-01-25
// - VaultManager V2: Fixed for Charms v0.11.1 (coin_ins/coin_outs not populated)
// - StabilityPool V5: Deployed with Charms v0.11.1 SDK
//
// Current WASM VKs (from compiled binaries with Charms v0.11.1):
//   price-oracle:    98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d
//   zkusd-token:     ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128
//   vault-manager:   a2359b5a481117a9be19f8f3fa21e1d979bac5bfd16c94e0a46c2bc1326c837d (V2 - DEPLOYED)
//   stability-pool:  54f84ff2ed2892b5c580b2f49ee38cf5365f04f69b0dca9f5d6a833802bf6143 (DEPLOYED)

import type { NetworkDeployment } from './networks';

// All contracts deployed to testnet4
export const TESTNET4_NEEDS_REDEPLOYMENT = false;

// All VKs deployed to testnet4
export const TESTNET4_VKS = {
  priceOracle: '98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d',
  zkusdToken: 'ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128',
  // V7 VK - deployed 2026-01-25 (Fixed for Charms v0.11.1 - coin_ins check disabled)
  vaultManager: 'a2359b5a481117a9be19f8f3fa21e1d979bac5bfd16c94e0a46c2bc1326c837d',
  // V5 VK - deployed 2026-01-24
  stabilityPool: '54f84ff2ed2892b5c580b2f49ee38cf5365f04f69b0dca9f5d6a833802bf6143',
};

export const TESTNET4_CONFIG: NetworkDeployment = {
  network: 'testnet4',
  charmsVersion: 9,
  explorerUrl: 'https://mempool.space/testnet4',
  explorerApiUrl: 'https://mempool.space/testnet4/api',

  // V7 DEPLOYED CONTRACTS (2026-01-25)
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
      // V7 - Deployed 2026-01-25 (Fixed for Charms v0.11.1 - coin_ins check disabled)
      // State updated after first vault opened (TX d8c6e9e8...)
      appId: 'd93540abec20ae20159f9f4de685975f17ad68004b970ae765d71bad42103649',
      vk: 'a2359b5a481117a9be19f8f3fa21e1d979bac5bfd16c94e0a46c2bc1326c837d',
      appRef: 'n/d93540abec20ae20159f9f4de685975f17ad68004b970ae765d71bad42103649/a2359b5a481117a9be19f8f3fa21e1d979bac5bfd16c94e0a46c2bc1326c837d',
      spellTx: 'd8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9',
      stateUtxo: 'd8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9:0',
      status: 'confirmed', // Block 120151 - First vault created
      wasmPath: '/wasm/vault-manager-v2-app.wasm',
    },
    stabilityPool: {
      // V5 - Deployed 2026-01-24 with Charms v0.11.1 SDK
      appId: 'b9412ca5d8ed6ca34d5b316ca51c960c8bc69aa96de467c9e4eb7bbfab24e320',
      vk: '54f84ff2ed2892b5c580b2f49ee38cf5365f04f69b0dca9f5d6a833802bf6143',
      appRef: 'n/b9412ca5d8ed6ca34d5b316ca51c960c8bc69aa96de467c9e4eb7bbfab24e320/54f84ff2ed2892b5c580b2f49ee38cf5365f04f69b0dca9f5d6a833802bf6143',
      spellTx: '678046c4a16e1dfd4cc7686c30f2c6fbda3350ce21380611c23aba922013bb30',
      stateUtxo: '678046c4a16e1dfd4cc7686c30f2c6fbda3350ce21380611c23aba922013bb30:0',
      status: 'confirmed',
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
// Updated to match V7 deployment (2026-01-25)
export const TESTNET4_CROSS_REFS = {
  // Token.authorized_minter = VaultManager App ID (V7)
  tokenAuthorizedMinter: [217, 53, 64, 171, 236, 32, 174, 32, 21, 159, 159, 77, 230, 133, 151, 95, 23, 173, 104, 0, 75, 151, 10, 231, 101, 215, 27, 173, 66, 16, 54, 73],
  // VaultManager.zkusd_token_id = Token App ID
  vmTokenId: [127, 246, 43, 164, 140, 187, 78, 132, 55, 170, 177, 163, 32, 80, 173, 14, 76, 140, 135, 77, 179, 74, 177, 10, 160, 21, 169, 217, 139, 221, 206, 241],
  // VaultManager.stability_pool_id = StabilityPool App ID (V5 - 2026-01-24)
  vmStabilityPoolId: [185, 65, 44, 165, 216, 237, 108, 163, 77, 91, 49, 108, 165, 28, 150, 12, 139, 198, 154, 169, 109, 228, 103, 201, 228, 235, 123, 191, 171, 36, 227, 32],
  // VaultManager.oracle_id = PriceOracle App ID
  vmOracleId: [38, 24, 109, 124, 39, 187, 40, 116, 141, 30, 200, 155, 161, 251, 96, 18, 93, 138, 37, 109, 253, 154, 151, 130, 150, 170, 89, 248, 199, 233, 232, 181],
  // StabilityPool.zkusd_token_id = Token App ID
  spTokenId: [127, 246, 43, 164, 140, 187, 78, 132, 55, 170, 177, 163, 32, 80, 173, 14, 76, 140, 135, 77, 179, 74, 177, 10, 160, 21, 169, 217, 139, 221, 206, 241],
  // StabilityPool.vault_manager_id = VaultManager App ID (V7)
  spVaultManagerId: [217, 53, 64, 171, 236, 32, 174, 32, 21, 159, 159, 77, 230, 133, 151, 95, 23, 173, 104, 0, 75, 151, 10, 231, 101, 215, 27, 173, 66, 16, 54, 73],
};
