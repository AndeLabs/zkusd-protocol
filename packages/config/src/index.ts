// zkUSD Protocol Configuration
//
// This package provides network-aware configuration for the zkUSD protocol.
//
// Usage:
// ```typescript
// import { getNetworkConfig, isNetworkReady, getProtocolConstants } from '@zkusd/config';
//
// const config = getNetworkConfig('testnet4');
// const constants = getProtocolConstants('testnet4');
// ```

// Core exports
export {
  type NetworkId,
  type NetworkDeployment,
  type ContractDeployment,
  type ProverEndpoint,
  PROVER_ENDPOINTS,
  getNetworkConfig,
  isNetworkReady,
  getProverEndpoints,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  validateContract,
  getProtocolConstants,
} from './networks';

// Network-specific configs
export {
  TESTNET4_CONFIG,
  TESTNET4_CROSS_REFS,
  TESTNET4_NEEDS_REDEPLOYMENT,
  TESTNET4_NEW_VKS,
} from './testnet4';
export { MAINNET_CONFIG, MAINNET_CROSS_REFS, validateMainnetConfig } from './mainnet';
