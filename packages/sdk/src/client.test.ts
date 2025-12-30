import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ZkUsdClient } from './client';

// Save original fetch
const originalFetch = global.fetch;

// Mock fetch
const mockFetch = vi.fn();

describe('ZkUsdClient', () => {
  let client: ZkUsdClient;

  beforeAll(() => {
    client = new ZkUsdClient({ network: 'testnet4' });
  });

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  describe('Initialization', () => {
    it('should initialize with testnet4 config', () => {
      const testnetClient = new ZkUsdClient({ network: 'testnet4' });
      expect(testnetClient.network).toBe('testnet4');
      expect(testnetClient.networkConfig.explorerUrl).toBe('https://mempool.space/testnet4');
    });

    it('should initialize with mainnet config', () => {
      const mainnetClient = new ZkUsdClient({ network: 'mainnet' });
      expect(mainnetClient.network).toBe('mainnet');
      expect(mainnetClient.networkConfig.explorerUrl).toBe('https://mempool.space');
    });

    it('should initialize services', () => {
      expect(client.bitcoin).toBeDefined();
      expect(client.prover).toBeDefined();
      expect(client.vault).toBeDefined();
      expect(client.oracle).toBeDefined();
    });
  });

  describe('URL Generation', () => {
    it('should generate correct transaction URL', () => {
      const txid = 'abc123def456';
      const url = client.getTxUrl(txid);
      expect(url).toBe('https://mempool.space/testnet4/tx/abc123def456');
    });

    it('should generate correct address URL', () => {
      const address = 'tb1qtest';
      const url = client.getAddressUrl(address);
      expect(url).toBe('https://mempool.space/testnet4/address/tb1qtest');
    });
  });

  describe('Deployment Config', () => {
    it('should load testnet4 deployment config', async () => {
      const config = await client.getDeploymentConfig();

      expect(config.network).toBe('testnet4');
      expect(config.contracts.priceOracle).toBeDefined();
      expect(config.contracts.zkusdToken).toBeDefined();
      expect(config.contracts.vaultManager).toBeDefined();
      expect(config.contracts.stabilityPool).toBeDefined();
    });

    it('should have valid app IDs in config', async () => {
      const config = await client.getDeploymentConfig();

      // App IDs should be 64 character hex strings
      expect(config.contracts.priceOracle.appId).toMatch(/^[0-9a-f]{64}$/);
      expect(config.contracts.zkusdToken.appId).toMatch(/^[0-9a-f]{64}$/);
      expect(config.contracts.vaultManager.appId).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should cache deployment config', async () => {
      const config1 = await client.getDeploymentConfig();
      const config2 = await client.getDeploymentConfig();

      expect(config1).toBe(config2); // Same reference
    });

    it('should throw for mainnet (not yet available)', async () => {
      const mainnetClient = new ZkUsdClient({ network: 'mainnet' });
      await expect(mainnetClient.getDeploymentConfig()).rejects.toThrow('Mainnet deployment not yet available');
    });
  });

  describe('Bitcoin API Delegation', () => {
    it('should delegate getBlockHeight to bitcoin service', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '12345',
      });

      const height = await client.getBlockHeight();
      expect(height).toBe(12345);
    });

    it('should delegate getFeeEstimates to bitcoin service', async () => {
      const mockFees = {
        fastestFee: 50,
        halfHourFee: 30,
        hourFee: 20,
        economyFee: 10,
        minimumFee: 1,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockFees),
      });

      const fees = await client.getFeeEstimates();
      expect(fees.fastestFee).toBe(50);
    });

    it('should delegate getAddressUtxos to bitcoin service', async () => {
      const mockUtxos = [
        { txid: 'tx1', vout: 0, value: 10000, status: { confirmed: true } },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockUtxos),
      });

      const utxos = await client.getAddressUtxos('tb1qtest');
      expect(utxos).toHaveLength(1);
    });

    it('should convert UTXO value to bigint', async () => {
      // Mock getTransaction
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          txid: 'abc123',
          vout: [{ scriptpubkey: '0014abc', value: 50000 }],
          status: { confirmed: true },
        }),
      });

      // Mock getOutspends
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ spent: false }]),
      });

      const utxo = await client.getUtxo('abc123', 0);
      expect(utxo).not.toBeNull();
      expect(typeof utxo!.value).toBe('bigint');
      expect(utxo!.value).toBe(50000n);
    });
  });

  describe('Address Balance', () => {
    it('should calculate total balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 30000 },
          mempool_stats: { funded_txo_sum: 5000, spent_txo_sum: 0 },
        }),
      });

      const balance = await client.getAddressBalance('tb1qtest');
      expect(balance.confirmed).toBe(70000);
      expect(balance.unconfirmed).toBe(5000);
      expect(balance.total).toBe(75000);
    });
  });

  describe('Execute Spell', () => {
    it('should call prover with correct parameters', async () => {
      // Mock fee estimates
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          fastestFee: 50,
          halfHourFee: 30,
          hourFee: 20,
          economyFee: 10,
          minimumFee: 1,
        }),
      });

      // Mock prover response (use valid hex)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['abc123def456', '789012345678'],
      });

      const result = await client.executeSpell({
        spell: {
          version: 1,
          apps: {},
          ins: [{ utxo: 'txid:0' }],
          outs: [],
        },
        binaries: {},
        prevTxs: ['prevTxHex'],
        fundingUtxo: 'txid:0',
        fundingUtxoValue: 10000,
        changeAddress: 'tb1qtest',
      });

      expect(result.commitTx).toBe('abc123def456');
      expect(result.spellTx).toBe('789012345678');
    });

    it('should use provided fee rate', async () => {
      // Mock prover response (no fee estimates call needed, use valid hex)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['abc123def456', '789012345678'],
      });

      await client.executeSpell({
        spell: {
          version: 1,
          apps: {},
          ins: [{ utxo: 'txid:0' }],
          outs: [],
        },
        binaries: {},
        prevTxs: ['prevTxHex'],
        fundingUtxo: 'txid:0',
        fundingUtxoValue: 10000,
        changeAddress: 'tb1qtest',
        feeRate: 25, // Provided fee rate
      });

      // Should only call prover, not fee estimates
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ZkUsdClient Integration Tests', () => {
  let client: ZkUsdClient;

  beforeAll(() => {
    // Restore real fetch for integration tests
    global.fetch = originalFetch;
    client = new ZkUsdClient({ network: 'testnet4' });
  });

  afterAll(() => {
    // Restore mock for any subsequent tests
    global.fetch = mockFetch;
  });

  it('should fetch real block height', async () => {
    const height = await client.getBlockHeight();
    expect(height).toBeGreaterThan(0);
  });

  it('should fetch real fee estimates', async () => {
    const fees = await client.getFeeEstimates();
    expect(fees.minimumFee).toBeGreaterThan(0);
  });

  it('should load real deployment config', async () => {
    const config = await client.getDeploymentConfig();
    expect(config.contracts.priceOracle.appId).toBeDefined();
    expect(config.contracts.vaultManager.appId).toBeDefined();
  });
});
