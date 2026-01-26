import { TESTNET4_CONFIG } from '@zkusd/config';
import type { ExplorerContract, ExplorerTx } from './types';

/** Protocol output address for state UTXOs */
export const PROTOCOL_OUTPUT_ADDRESS = TESTNET4_CONFIG.addresses.outputAddress;

/** Mempool.space explorer base URL */
export const EXPLORER_BASE_URL = TESTNET4_CONFIG.explorerUrl;

/** First successful mint transaction */
export const FIRST_MINT_TX = 'f5a19de4e1297fd681711b912c61dc5514aea2676aafce4737b377267ef6167d';

/** Deployed contracts with metadata for explorer display */
export const EXPLORER_CONTRACTS: ExplorerContract[] = [
  {
    name: 'VaultManager',
    key: 'vaultManager',
    version: 'V6',
    description: 'Manages vault creation, collateral, and debt tracking',
    appId: TESTNET4_CONFIG.contracts.vaultManager.appId,
    vk: TESTNET4_CONFIG.contracts.vaultManager.vk,
    stateUtxo: TESTNET4_CONFIG.contracts.vaultManager.stateUtxo ?? '',
    deployTxId: TESTNET4_CONFIG.contracts.vaultManager.spellTx ?? '',
  },
  {
    name: 'zkUSD Token',
    key: 'zkusdToken',
    version: 'V8',
    description: 'Fungible stablecoin token with authorized minter',
    appId: TESTNET4_CONFIG.contracts.zkusdToken.appId,
    vk: TESTNET4_CONFIG.contracts.zkusdToken.vk,
    stateUtxo: TESTNET4_CONFIG.contracts.zkusdToken.stateUtxo ?? '',
    deployTxId: TESTNET4_CONFIG.contracts.zkusdToken.spellTx ?? '',
  },
  {
    name: 'Price Oracle',
    key: 'priceOracle',
    version: 'V2',
    description: 'BTC/USD price feed for collateral valuation',
    appId: TESTNET4_CONFIG.contracts.priceOracle.appId,
    vk: TESTNET4_CONFIG.contracts.priceOracle.vk,
    stateUtxo: TESTNET4_CONFIG.contracts.priceOracle.stateUtxo ?? '',
    deployTxId: TESTNET4_CONFIG.contracts.priceOracle.spellTx ?? '',
  },
  {
    name: 'Stability Pool',
    key: 'stabilityPool',
    version: 'V5',
    description: 'Liquidation backstop and reward distribution',
    appId: TESTNET4_CONFIG.contracts.stabilityPool.appId,
    vk: TESTNET4_CONFIG.contracts.stabilityPool.vk,
    stateUtxo: TESTNET4_CONFIG.contracts.stabilityPool.stateUtxo ?? '',
    deployTxId: TESTNET4_CONFIG.contracts.stabilityPool.spellTx ?? '',
  },
];

/** Known protocol transactions in chronological order */
export const PROTOCOL_TRANSACTIONS: ExplorerTx[] = [
  {
    txid: TESTNET4_CONFIG.contracts.priceOracle.spellTx ?? '',
    type: 'deploy',
    label: 'Deploy Price Oracle V2',
  },
  {
    txid: TESTNET4_CONFIG.contracts.zkusdToken.spellTx ?? '',
    type: 'deploy',
    label: 'Deploy zkUSD Token V8',
  },
  {
    txid: TESTNET4_CONFIG.contracts.vaultManager.spellTx ?? '',
    type: 'deploy',
    label: 'Deploy VaultManager V6',
  },
  {
    txid: TESTNET4_CONFIG.contracts.stabilityPool.spellTx ?? '',
    type: 'deploy',
    label: 'Deploy Stability Pool V5',
  },
  {
    txid: '5f0e8aa6b39ae268c743bf6216e299533612344dc1daecdcf98dc7eae726d48d',
    type: 'set-minter',
    label: 'Authorize VaultManager as Token Minter',
  },
  {
    txid: FIRST_MINT_TX,
    type: 'mint',
    label: 'First zkUSD Mint (10 zkUSD)',
  },
];
