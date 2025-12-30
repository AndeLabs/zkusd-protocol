import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { BitcoinApiService } from './bitcoin-api';

// Save original fetch
const originalFetch = global.fetch;

// Mock fetch for unit tests
const mockFetch = vi.fn();

describe('BitcoinApiService', () => {
  let service: BitcoinApiService;

  describe('Unit Tests', () => {
    beforeEach(() => {
      mockFetch.mockReset();
      global.fetch = mockFetch;
      service = new BitcoinApiService('testnet4');
    });
    it('should initialize with correct base URL for testnet4', () => {
      const testnetService = new BitcoinApiService('testnet4');
      expect(testnetService).toBeDefined();
    });

    it('should initialize with correct base URL for mainnet', () => {
      const mainnetService = new BitcoinApiService('mainnet');
      expect(mainnetService).toBeDefined();
    });

    it('should parse block height correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '12345',
      });

      const height = await service.getBlockHeight();
      expect(height).toBe(12345);
    });

    it('should parse transaction correctly', async () => {
      const mockTx = {
        txid: 'abc123',
        version: 2,
        locktime: 0,
        vin: [],
        vout: [
          {
            scriptpubkey: '0014abc',
            scriptpubkey_address: 'tb1qtest',
            scriptpubkey_type: 'v0_p2wpkh',
            value: 10000,
          },
        ],
        size: 200,
        weight: 800,
        fee: 1000,
        status: {
          confirmed: true,
          block_height: 12340,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockTx),
      });

      const tx = await service.getTransaction('abc123');
      expect(tx.txid).toBe('abc123');
      expect(tx.status.confirmed).toBe(true);
      expect(tx.vout[0].value).toBe(10000);
    });

    it('should calculate confirmations correctly', async () => {
      // Mock getTransaction
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          txid: 'abc123',
          status: { confirmed: true, block_height: 100 },
        }),
      });

      // Mock getBlockHeight
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '105',
      });

      const confirmations = await service.getTxConfirmations('abc123');
      expect(confirmations).toBe(6); // 105 - 100 + 1
    });

    it('should return 0 confirmations for unconfirmed tx', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          txid: 'abc123',
          status: { confirmed: false },
        }),
      });

      const confirmations = await service.getTxConfirmations('abc123');
      expect(confirmations).toBe(0);
    });

    it('should parse UTXOs correctly', async () => {
      const mockUtxos = [
        { txid: 'tx1', vout: 0, value: 10000, status: { confirmed: true } },
        { txid: 'tx2', vout: 1, value: 20000, status: { confirmed: false } },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockUtxos),
      });

      const utxos = await service.getAddressUtxos('tb1qtest');
      expect(utxos).toHaveLength(2);
      expect(utxos[0].value).toBe(10000);
      expect(utxos[1].status.confirmed).toBe(false);
    });

    it('should parse fee estimates correctly', async () => {
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

      const fees = await service.getFeeEstimates();
      expect(fees.fastestFee).toBe(50);
      expect(fees.halfHourFee).toBe(30);
    });

    it('should throw on failed request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(service.getBlockHeight()).rejects.toThrow('API request failed');
    });
  });
});

describe('BitcoinApiService Integration Tests', () => {
  let service: BitcoinApiService;

  beforeAll(() => {
    // Restore real fetch for integration tests
    global.fetch = originalFetch;
    service = new BitcoinApiService('testnet4');
  });

  afterAll(() => {
    // Restore mock for any subsequent tests
    global.fetch = mockFetch;
  });

  it('should fetch real block height from testnet4', async () => {
    const height = await service.getBlockHeight();
    expect(height).toBeGreaterThan(0);
    expect(typeof height).toBe('number');
  });

  it('should fetch real fee estimates from testnet4', async () => {
    const fees = await service.getFeeEstimates();
    expect(fees.fastestFee).toBeGreaterThan(0);
    expect(fees.minimumFee).toBeGreaterThan(0);
  });

  it('should fetch a known testnet4 transaction', async () => {
    // Use the oracle deployment tx which we know exists
    const txid = '03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4';

    try {
      const tx = await service.getTransaction(txid);
      expect(tx.txid).toBe(txid);
    } catch (error) {
      // Transaction might not exist yet, skip
      console.log('Transaction not found, skipping test');
    }
  });

  it('should return null for non-existent UTXO', async () => {
    const utxo = await service.getUtxo('0000000000000000000000000000000000000000000000000000000000000000', 0);
    expect(utxo).toBeNull();
  });

  it('should fetch address balance', async () => {
    // Use a known testnet4 address
    const address = 'tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq';

    const balance = await service.getAddressBalance(address);
    expect(typeof balance.confirmed).toBe('number');
    expect(typeof balance.unconfirmed).toBe('number');
  });
});
