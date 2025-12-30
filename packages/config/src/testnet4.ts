// Testnet4 Deployment Configuration
// Generated from deployments/testnet4/deployment-config.json

import type { NetworkDeployment } from './networks';

export const TESTNET4_CONFIG: NetworkDeployment = {
  network: 'testnet4',
  charmsVersion: 8,
  explorerUrl: 'https://mempool.space/testnet4',
  explorerApiUrl: 'https://mempool.space/testnet4/api',

  contracts: {
    priceOracle: {
      appId: '26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5',
      vk: '98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d',
      appRef: 'n/26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5/98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d',
      spellTx: '03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4',
      stateUtxo: '03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4:0',
      status: 'confirmed',
    },
    zkusdToken: {
      appId: 'eb6bae049ef366de081886f4f712be6e3eb991c92729aae4d9fab680a29ad540',
      vk: 'e056dfec9aea81d33caed5470c51c2f86bb6551aced4c570b66cbdc3594275fe',
      appRef: 'n/eb6bae049ef366de081886f4f712be6e3eb991c92729aae4d9fab680a29ad540/e056dfec9aea81d33caed5470c51c2f86bb6551aced4c570b66cbdc3594275fe',
      spellTx: '458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423',
      stateUtxo: '458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423:0',
      status: 'confirmed',
    },
    vaultManager: {
      appId: 'c1c47ab32a707f9fad3f57aa09c58020d0c5ce43f24ee5fd0c22be41114cd490',
      vk: 'd535fdc354e87af6e750bfe957a4a90e467eba1457f37f05c858beaf09e763bf',
      appRef: 'n/c1c47ab32a707f9fad3f57aa09c58020d0c5ce43f24ee5fd0c22be41114cd490/d535fdc354e87af6e750bfe957a4a90e467eba1457f37f05c858beaf09e763bf',
      spellTx: 'b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3',
      stateUtxo: 'b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3:0',
      status: 'confirmed',
    },
    stabilityPool: {
      appId: 'c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf',
      vk: 'ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752',
      appRef: 'n/c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf/ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752',
      spellTx: 'ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c',
      stateUtxo: 'ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c:0',
      status: 'confirmed',
    },
  },

  addresses: {
    admin: 'd54fa831ac19574c5503f1cbd505934a0bab3cee',
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
export const TESTNET4_CROSS_REFS = {
  // Token.authorized_minter = VaultManager App ID
  tokenAuthorizedMinter: [193, 196, 122, 179, 42, 112, 127, 159, 173, 63, 87, 170, 9, 197, 128, 32, 208, 197, 206, 67, 242, 78, 229, 253, 12, 34, 190, 65, 17, 76, 212, 144],
  // VaultManager.zkusd_token_id = Token App ID
  vmTokenId: [235, 107, 174, 4, 158, 243, 102, 222, 8, 24, 134, 244, 247, 18, 190, 110, 62, 185, 145, 201, 39, 41, 170, 228, 217, 250, 182, 128, 162, 154, 213, 64],
  // VaultManager.stability_pool_id = StabilityPool App ID
  vmStabilityPoolId: [193, 28, 84, 81, 200, 52, 245, 78, 213, 98, 39, 179, 251, 72, 211, 102, 222, 44, 19, 156, 42, 15, 85, 154, 238, 191, 180, 90, 248, 160, 103, 191],
  // VaultManager.oracle_id = PriceOracle App ID
  vmOracleId: [38, 24, 109, 124, 39, 187, 40, 116, 141, 30, 200, 155, 161, 251, 96, 18, 93, 138, 37, 109, 253, 154, 151, 130, 150, 170, 89, 248, 199, 233, 232, 181],
};
