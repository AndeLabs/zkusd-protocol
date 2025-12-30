// Network Configuration for zkUSD Protocol

export type NetworkId = 'testnet4' | 'mainnet';

export interface ContractDeployment {
  appId: string;
  vk: string;
  appRef: string;
  spellTx: string;
  stateUtxo: string;
  status: 'confirmed' | 'in_mempool' | 'pending';
}

export interface NetworkDeployment {
  network: NetworkId;
  charmsVersion: number;
  explorerUrl: string;
  explorerApiUrl: string;
  contracts: {
    priceOracle: ContractDeployment;
    zkusdToken: ContractDeployment;
    vaultManager: ContractDeployment;
    stabilityPool: ContractDeployment;
  };
  addresses: {
    admin: string;
    outputAddress: string;
  };
  protocolParams: {
    mcr: number;
    ccr: number;
    minDebt: bigint;
    gasCompensation: bigint;
    liquidationBonusBps: number;
    redemptionFeeFloorBps: number;
  };
}

// Import network-specific configs
import { TESTNET4_CONFIG } from './testnet4';

const NETWORK_CONFIGS: Record<NetworkId, NetworkDeployment> = {
  testnet4: TESTNET4_CONFIG,
  mainnet: {
    ...TESTNET4_CONFIG,
    network: 'mainnet',
    explorerUrl: 'https://mempool.space',
    explorerApiUrl: 'https://mempool.space/api',
    // Mainnet addresses will be different - placeholder for now
    contracts: {
      priceOracle: { ...TESTNET4_CONFIG.contracts.priceOracle, status: 'pending' as const },
      zkusdToken: { ...TESTNET4_CONFIG.contracts.zkusdToken, status: 'pending' as const },
      vaultManager: { ...TESTNET4_CONFIG.contracts.vaultManager, status: 'pending' as const },
      stabilityPool: { ...TESTNET4_CONFIG.contracts.stabilityPool, status: 'pending' as const },
    },
  },
};

export function getNetworkConfig(network: NetworkId): NetworkDeployment {
  const config = NETWORK_CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }
  return config;
}

export function getExplorerTxUrl(network: NetworkId, txid: string): string {
  const config = getNetworkConfig(network);
  return `${config.explorerUrl}/tx/${txid}`;
}

export function getExplorerAddressUrl(network: NetworkId, address: string): string {
  const config = getNetworkConfig(network);
  return `${config.explorerUrl}/address/${address}`;
}
