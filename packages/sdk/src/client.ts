// zkUSD Client - Main entry point for SDK

import type { Network, DeploymentConfig, NetworkConfig } from '@zkusd/types';
import { TESTNET4_CONFIG } from '@zkusd/config';
import { VaultService } from './vault';
import { OracleService } from './oracle';
import { StabilityPoolService } from './stability-pool';
import { BitcoinApiService, ProverService } from './services';
import type { Spell, ProveRequest, ProveResponse, Utxo, FeeEstimates } from './services';

export interface ZkUsdClientConfig {
  network: Network;
  charmsApiUrl?: string;
  bitcoinRpcUrl?: string;
}

const NETWORK_CONFIGS: Record<Network, NetworkConfig> = {
  mainnet: {
    network: 'mainnet',
    explorerUrl: 'https://mempool.space',
  },
  testnet4: {
    network: 'testnet4',
    explorerUrl: 'https://mempool.space/testnet4',
  },
  signet: {
    network: 'signet',
    explorerUrl: 'https://mempool.space/signet',
  },
  regtest: {
    network: 'regtest',
    explorerUrl: 'http://localhost:8080',
  },
};

/**
 * Main client for interacting with zkUSD protocol
 */
export class ZkUsdClient {
  readonly network: Network;
  readonly networkConfig: NetworkConfig;
  readonly vault: VaultService;
  readonly oracle: OracleService;
  readonly stabilityPool: StabilityPoolService;

  // Services
  readonly bitcoin: BitcoinApiService;
  readonly prover: ProverService;

  private deploymentConfig: DeploymentConfig | null = null;

  constructor(config: ZkUsdClientConfig) {
    this.network = config.network;
    this.networkConfig = NETWORK_CONFIGS[config.network];

    // Initialize services
    this.bitcoin = new BitcoinApiService(config.network, config.bitcoinRpcUrl);
    this.prover = new ProverService(config.network, {
      apiUrl: config.charmsApiUrl,
    });

    // Initialize domain services
    this.vault = new VaultService(this);
    this.oracle = new OracleService(this);
    this.stabilityPool = new StabilityPoolService(this);
  }

  /**
   * Get explorer URL for a transaction
   */
  getTxUrl(txid: string): string {
    return `${this.networkConfig.explorerUrl}/tx/${txid}`;
  }

  /**
   * Get explorer URL for an address
   */
  getAddressUrl(address: string): string {
    return `${this.networkConfig.explorerUrl}/address/${address}`;
  }

  /**
   * Load deployment config for current network
   */
  async getDeploymentConfig(): Promise<DeploymentConfig> {
    if (this.deploymentConfig) {
      return this.deploymentConfig;
    }

    // Load from config package based on network
    switch (this.network) {
      case 'testnet4':
        this.deploymentConfig = {
          network: TESTNET4_CONFIG.network,
          contracts: {
            priceOracle: {
              appId: TESTNET4_CONFIG.contracts.priceOracle.appId,
              vk: TESTNET4_CONFIG.contracts.priceOracle.vk,
              appRef: TESTNET4_CONFIG.contracts.priceOracle.appRef,
              wasmPath: TESTNET4_CONFIG.contracts.priceOracle.wasmPath,
            },
            zkusdToken: {
              appId: TESTNET4_CONFIG.contracts.zkusdToken.appId,
              vk: TESTNET4_CONFIG.contracts.zkusdToken.vk,
              appRef: TESTNET4_CONFIG.contracts.zkusdToken.appRef,
              wasmPath: TESTNET4_CONFIG.contracts.zkusdToken.wasmPath,
            },
            vaultManager: {
              appId: TESTNET4_CONFIG.contracts.vaultManager.appId,
              vk: TESTNET4_CONFIG.contracts.vaultManager.vk,
              appRef: TESTNET4_CONFIG.contracts.vaultManager.appRef,
              wasmPath: TESTNET4_CONFIG.contracts.vaultManager.wasmPath,
            },
            stabilityPool: {
              appId: TESTNET4_CONFIG.contracts.stabilityPool.appId,
              vk: TESTNET4_CONFIG.contracts.stabilityPool.vk,
              appRef: TESTNET4_CONFIG.contracts.stabilityPool.appRef,
              wasmPath: TESTNET4_CONFIG.contracts.stabilityPool.wasmPath,
            },
          },
          addresses: {
            admin: TESTNET4_CONFIG.addresses.admin,
            outputAddress: TESTNET4_CONFIG.addresses.outputAddress,
          },
        };
        break;

      case 'mainnet':
        throw new Error('Mainnet deployment not yet available');

      default:
        throw new Error(`Unknown network: ${this.network}`);
    }

    return this.deploymentConfig;
  }

  /**
   * Execute a Charms spell
   */
  async executeSpell(options: {
    spell: Spell;
    binaries: Record<string, string>;
    prevTxs: string[];
    fundingUtxo: string;
    fundingUtxoValue: number;
    changeAddress: string;
    feeRate?: number;
  }): Promise<ProveResponse> {
    // Get fee rate if not provided
    let feeRate = options.feeRate;
    if (!feeRate) {
      const estimates = await this.bitcoin.getFeeEstimates();
      feeRate = estimates.halfHourFee; // Use medium priority
    }

    const request: ProveRequest = {
      spell: options.spell,
      binaries: options.binaries,
      prev_txs: options.prevTxs,
      funding_utxo: options.fundingUtxo,
      funding_utxo_value: options.fundingUtxoValue,
      change_address: options.changeAddress,
      fee_rate: feeRate,
    };

    // Call prover to get signed transactions
    const result = await this.prover.prove(request);

    return result;
  }

  /**
   * Execute spell and broadcast transactions
   */
  async executeAndBroadcast(options: {
    spell: Spell;
    binaries: Record<string, string>;
    prevTxs: string[];
    fundingUtxo: string;
    fundingUtxoValue: number;
    changeAddress: string;
    feeRate?: number;
    signTransaction?: (txHex: string) => Promise<string>;
  }): Promise<{
    commitTxId: string;
    spellTxId: string;
  }> {
    // Get the prove result
    const proveResult = await this.executeSpell(options);

    // Check if these are demo/simulated transactions
    // Demo transactions are short and end with zeros
    const isDemoTx = proveResult.commitTx.length < 150 ||
                     proveResult.commitTx.endsWith('0000000000') ||
                     this.prover.isDemo();

    if (isDemoTx) {
      console.warn('[ZkUsdClient] Demo mode: Skipping signing and using simulated txids');
      // Generate deterministic fake txids from the transaction content
      const commitTxId = this.hashString(proveResult.commitTx + 'commit').padStart(64, '0');
      const spellTxId = this.hashString(proveResult.spellTx + 'spell').padStart(64, '0');

      return {
        commitTxId,
        spellTxId,
      };
    }

    // Sign transactions if a signer is provided
    let commitTx = proveResult.commitTx;
    let spellTx = proveResult.spellTx;

    if (options.signTransaction) {
      commitTx = await options.signTransaction(commitTx);
      spellTx = await options.signTransaction(spellTx);
    }

    // Broadcast commit transaction first
    const commitTxId = await this.bitcoin.broadcast(commitTx);

    // Wait a moment for propagation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Broadcast spell transaction
    const spellTxId = await this.bitcoin.broadcast(spellTx);

    return {
      commitTxId,
      spellTxId,
    };
  }

  /**
   * Simple hash for deterministic ID generation
   */
  private hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get current Bitcoin block height
   */
  async getBlockHeight(): Promise<number> {
    return await this.bitcoin.getBlockHeight();
  }

  /**
   * Get UTXO details
   */
  async getUtxo(txid: string, vout: number): Promise<{
    value: bigint;
    scriptPubKey: string;
    address?: string;
    spent: boolean;
  } | null> {
    const utxo = await this.bitcoin.getUtxo(txid, vout);
    if (!utxo) return null;

    return {
      value: BigInt(utxo.value),
      scriptPubKey: utxo.scriptPubKey,
      address: utxo.address,
      spent: utxo.spent,
    };
  }

  /**
   * Get UTXOs for an address
   */
  async getAddressUtxos(address: string): Promise<Utxo[]> {
    return await this.bitcoin.getAddressUtxos(address);
  }

  /**
   * Get address balance
   */
  async getAddressBalance(address: string): Promise<{
    confirmed: number;
    unconfirmed: number;
    total: number;
  }> {
    const balance = await this.bitcoin.getAddressBalance(address);
    return {
      ...balance,
      total: balance.confirmed + balance.unconfirmed,
    };
  }

  /**
   * Check if a transaction is confirmed
   */
  async getTxConfirmations(txid: string): Promise<number> {
    return await this.bitcoin.getTxConfirmations(txid);
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    txid: string,
    options?: {
      confirmations?: number;
      timeout?: number;
      onProgress?: (confirmations: number) => void;
    }
  ): Promise<number> {
    return await this.bitcoin.waitForConfirmation(txid, options);
  }

  /**
   * Get recommended fee rates
   */
  async getFeeEstimates(): Promise<FeeEstimates> {
    return await this.bitcoin.getFeeEstimates();
  }

  /**
   * Get raw transaction hex
   */
  async getRawTransaction(txid: string): Promise<string> {
    return await this.bitcoin.getRawTransaction(txid);
  }

  /**
   * Create a PSBT from a spell
   * This is a simplified version - full implementation would use the prover service
   */
  async createPsbt(spell: Spell): Promise<{ psbt: string; fee: number }> {
    // TODO: Implement proper PSBT creation with prover
    // For now, create a placeholder that would be filled by prover
    console.log('[ZkUsdClient] Creating PSBT for spell:', spell);

    // Get fee estimate
    const feeEstimates = await this.getFeeEstimates();

    // In production, this would:
    // 1. Call the prover service to create transactions
    // 2. Convert the commit tx to PSBT format
    // 3. Return the PSBT for signing

    // For now, return a placeholder
    return {
      psbt: '', // Would be actual PSBT hex
      fee: feeEstimates.halfHourFee * 250, // Estimated fee in sats
    };
  }

  /**
   * Broadcast a signed transaction
   */
  async broadcastTransaction(signedPsbt: string): Promise<string> {
    // In production, this would:
    // 1. Finalize the PSBT
    // 2. Extract the raw transaction
    // 3. Broadcast to the network

    console.log('[ZkUsdClient] Broadcasting transaction...');

    // For now, return a placeholder txid
    // Full implementation would extract tx from PSBT and broadcast
    if (!signedPsbt) {
      throw new Error('No signed PSBT provided');
    }

    // This would be: const txid = await this.bitcoin.broadcast(extractedTx);
    const placeholderTxid = 'pending_' + Date.now().toString(16);

    return placeholderTxid;
  }
}
