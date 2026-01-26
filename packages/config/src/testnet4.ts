// Testnet4 Deployment Configuration
// Generated from deployments/testnet4/deployment-config.json
//
// STATUS: V9 - TOKEN V8 + VAULTMANAGER V6 DEPLOYED 2026-01-26
// - Token V8: VK-based matching (matches_app) for deploy identity transition
// - VaultManager V6: VK-based matching + Token V8 app_id
// - SetMinter V4: VaultManager V6 authorized as Token V8 minter
// - StabilityPool V5: Deployed with Charms v0.11.1 SDK
// - Oracle V2: Confirmed block 120191
//
// Current WASM VKs (from compiled binaries with Charms v0.11.1):
//   price-oracle:    372723f020b5030a53f2f40a5feb9c96c8f80fad19ed0a78b0591e363001175f
//   zkusd-token:     395ceff8ff029ff4399fb158859cf7e59a6b1b7383306d2229bcf20e014201c4
//   vault-manager:   5d4f82322c90250b7db0402449708c6871627c38139f17df3806d0926de9367b
//   stability-pool:  54f84ff2ed2892b5c580b2f49ee38cf5365f04f69b0dca9f5d6a833802bf6143

import type { NetworkDeployment } from './networks';

// All contracts deployed to testnet4
export const TESTNET4_NEEDS_REDEPLOYMENT = false;

// All VKs deployed to testnet4
export const TESTNET4_VKS = {
  priceOracle: '372723f020b5030a53f2f40a5feb9c96c8f80fad19ed0a78b0591e363001175f',
  zkusdToken: '395ceff8ff029ff4399fb158859cf7e59a6b1b7383306d2229bcf20e014201c4',
  vaultManager: '5d4f82322c90250b7db0402449708c6871627c38139f17df3806d0926de9367b',
  stabilityPool: '54f84ff2ed2892b5c580b2f49ee38cf5365f04f69b0dca9f5d6a833802bf6143',
};

export const TESTNET4_CONFIG: NetworkDeployment = {
  network: 'testnet4',
  charmsVersion: 9,
  explorerUrl: 'https://mempool.space/testnet4',
  explorerApiUrl: 'https://mempool.space/testnet4/api',

  // V9 DEPLOYED CONTRACTS (2026-01-26)
  contracts: {
    priceOracle: {
      // Oracle V2 - confirmed block 120191
      appId: 'ee779405f88f890c68581e716b0dcad05762440941a6aa0248c722a1ede05943',
      vk: '372723f020b5030a53f2f40a5feb9c96c8f80fad19ed0a78b0591e363001175f',
      appRef: 'n/ee779405f88f890c68581e716b0dcad05762440941a6aa0248c722a1ede05943/372723f020b5030a53f2f40a5feb9c96c8f80fad19ed0a78b0591e363001175f',
      spellTx: '68dd47f7f3759262533e2049fe0313bd848657fb7f05875b9b5fb2d325eca3b2',
      stateUtxo: '68dd47f7f3759262533e2049fe0313bd848657fb7f05875b9b5fb2d325eca3b2:0',
      status: 'confirmed',
      wasmPath: '/wasm/zkusd-price-oracle-app.wasm',
    },
    zkusdToken: {
      // Token V8 - VK-based matching (matches_app) for deploy identity transition
      // SetMinter V4 authorized VaultManager V6 (TX 5f0e8aa6...)
      appId: 'a2a55bf3131001674e2dfc952944d870aab7b5eddf929c1bde1f1e739c230770',
      vk: '395ceff8ff029ff4399fb158859cf7e59a6b1b7383306d2229bcf20e014201c4',
      appRef: 'n/a2a55bf3131001674e2dfc952944d870aab7b5eddf929c1bde1f1e739c230770/395ceff8ff029ff4399fb158859cf7e59a6b1b7383306d2229bcf20e014201c4',
      spellTx: '574e778f7dd27ac1985f24b956b926b10190f69c374019ba9aba60a459d8a394',
      stateUtxo: '5f0e8aa6b39ae268c743bf6216e299533612344dc1daecdcf98dc7eae726d48d:0',
      status: 'in_mempool',
      wasmPath: '/wasm/zkusd-token-app.wasm',
    },
    vaultManager: {
      // VaultManager V6 - VK-based matching + Token V8 app_id
      appId: 'e6564c00d5ea8cb8226c7c334ab7089c806149debe1382c75c1909f447290b3c',
      vk: '5d4f82322c90250b7db0402449708c6871627c38139f17df3806d0926de9367b',
      appRef: 'n/e6564c00d5ea8cb8226c7c334ab7089c806149debe1382c75c1909f447290b3c/5d4f82322c90250b7db0402449708c6871627c38139f17df3806d0926de9367b',
      spellTx: 'eb13f9b9d0ed1eb8160b7e0732ad03ca0473cb3e3ed5e3b7936630e7a4c4d261',
      stateUtxo: 'eb13f9b9d0ed1eb8160b7e0732ad03ca0473cb3e3ed5e3b7936630e7a4c4d261:0',
      status: 'in_mempool',
      wasmPath: '/wasm/zkusd-vault-manager-app.wasm',
    },
    stabilityPool: {
      // StabilityPool V5 - Deployed 2026-01-24 with Charms v0.11.1 SDK
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
// Updated to match V9 deployment (2026-01-26)
export const TESTNET4_CROSS_REFS = {
  // Token.authorized_minter = VaultManager V6 App ID
  tokenAuthorizedMinter: [230, 86, 76, 0, 213, 234, 140, 184, 34, 108, 124, 51, 74, 183, 8, 156, 128, 97, 73, 222, 190, 19, 130, 199, 92, 25, 9, 244, 71, 41, 11, 60],
  // VaultManager.zkusd_token_id = Token V8 App ID
  vmTokenId: [162, 165, 91, 243, 19, 16, 1, 103, 78, 45, 252, 149, 41, 68, 216, 112, 170, 183, 181, 237, 223, 146, 156, 27, 222, 31, 30, 115, 156, 35, 7, 112],
  // VaultManager.stability_pool_id = StabilityPool V5 App ID
  vmStabilityPoolId: [185, 65, 44, 165, 216, 237, 108, 163, 77, 91, 49, 108, 165, 28, 150, 12, 139, 198, 154, 169, 109, 228, 103, 201, 228, 235, 123, 191, 171, 36, 227, 32],
  // VaultManager.oracle_id = PriceOracle V2 App ID
  vmOracleId: [238, 119, 148, 5, 248, 143, 137, 12, 104, 88, 30, 113, 107, 13, 202, 208, 87, 98, 68, 9, 65, 166, 170, 2, 72, 199, 34, 161, 237, 224, 89, 67],
  // StabilityPool.zkusd_token_id = Token V8 App ID
  spTokenId: [162, 165, 91, 243, 19, 16, 1, 103, 78, 45, 252, 149, 41, 68, 216, 112, 170, 183, 181, 237, 223, 146, 156, 27, 222, 31, 30, 115, 156, 35, 7, 112],
  // StabilityPool.vault_manager_id = VaultManager V6 App ID
  spVaultManagerId: [230, 86, 76, 0, 213, 234, 140, 184, 34, 108, 124, 51, 74, 183, 8, 156, 128, 97, 73, 222, 190, 19, 130, 199, 92, 25, 9, 244, 71, 41, 11, 60],
};
