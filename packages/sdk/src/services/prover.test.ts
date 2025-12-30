import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ProverService, ProverError, type Spell, type ProveRequest } from './prover';

// Save original fetch
const originalFetch = global.fetch;

// Mock fetch
const mockFetch = vi.fn();

describe('ProverService', () => {
  let service: ProverService;

  beforeAll(() => {
    service = new ProverService('testnet4');
  });

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  describe('Initialization', () => {
    it('should initialize with correct URL for testnet4', () => {
      const testnetService = new ProverService('testnet4');
      expect(testnetService).toBeDefined();
    });

    it('should initialize with custom URL', () => {
      const customService = new ProverService('testnet4', {
        apiUrl: 'http://localhost:17784/spells/prove',
      });
      expect(customService).toBeDefined();
    });
  });

  describe('Request Validation', () => {
    it('should reject missing spell', async () => {
      const invalidRequest = {
        binaries: {},
        prev_txs: ['abc'],
        funding_utxo: 'txid:0',
        funding_utxo_value: 10000,
        change_address: 'tb1qtest',
        fee_rate: 10,
      } as ProveRequest;

      await expect(service.prove(invalidRequest)).rejects.toThrow('Missing spell');
    });

    it('should reject invalid funding_utxo format', async () => {
      const spell: Spell = {
        version: 1,
        apps: {},
        ins: [],
        outs: [],
      };

      const invalidRequest: ProveRequest = {
        spell,
        binaries: {},
        prev_txs: ['abc'],
        funding_utxo: 'invalid', // Missing :vout
        funding_utxo_value: 10000,
        change_address: 'tb1qtest',
        fee_rate: 10,
      };

      await expect(service.prove(invalidRequest)).rejects.toThrow('Invalid funding_utxo format');
    });

    it('should reject invalid funding_utxo_value', async () => {
      const spell: Spell = {
        version: 1,
        apps: {},
        ins: [],
        outs: [],
      };

      const invalidRequest: ProveRequest = {
        spell,
        binaries: {},
        prev_txs: ['abc'],
        funding_utxo: 'txid:0',
        funding_utxo_value: 0,
        change_address: 'tb1qtest',
        fee_rate: 10,
      };

      await expect(service.prove(invalidRequest)).rejects.toThrow('Invalid funding_utxo_value');
    });

    it('should reject missing change_address', async () => {
      const spell: Spell = {
        version: 1,
        apps: {},
        ins: [],
        outs: [],
      };

      const invalidRequest: ProveRequest = {
        spell,
        binaries: {},
        prev_txs: ['abc'],
        funding_utxo: 'txid:0',
        funding_utxo_value: 10000,
        change_address: '',
        fee_rate: 10,
      };

      await expect(service.prove(invalidRequest)).rejects.toThrow('Missing change_address');
    });

    it('should reject invalid fee_rate', async () => {
      const spell: Spell = {
        version: 1,
        apps: {},
        ins: [],
        outs: [],
      };

      const invalidRequest: ProveRequest = {
        spell,
        binaries: {},
        prev_txs: ['abc'],
        funding_utxo: 'txid:0',
        funding_utxo_value: 10000,
        change_address: 'tb1qtest',
        fee_rate: 0,
      };

      await expect(service.prove(invalidRequest)).rejects.toThrow('Invalid fee_rate');
    });

    it('should reject missing prev_txs', async () => {
      const spell: Spell = {
        version: 1,
        apps: {},
        ins: [],
        outs: [],
      };

      const invalidRequest: ProveRequest = {
        spell,
        binaries: {},
        prev_txs: [],
        funding_utxo: 'txid:0',
        funding_utxo_value: 10000,
        change_address: 'tb1qtest',
        fee_rate: 10,
      };

      await expect(service.prove(invalidRequest)).rejects.toThrow('Missing prev_txs');
    });
  });

  describe('Response Parsing', () => {
    const validSpell: Spell = {
      version: 1,
      apps: {},
      ins: [{ utxo: 'txid:0' }],
      outs: [{ address: 'tb1qtest' }],
    };

    const validRequest: ProveRequest = {
      spell: validSpell,
      binaries: {},
      prev_txs: ['0100000001...'],
      funding_utxo: 'txid:0',
      funding_utxo_value: 10000,
      change_address: 'tb1qtest',
      fee_rate: 10,
    };

    it('should parse valid response correctly', async () => {
      const mockResponse = ['abc123def', '456789abc'];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.prove(validRequest);
      expect(result.commitTx).toBe('abc123def');
      expect(result.spellTx).toBe('456789abc');
    });

    it('should reject non-array response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ commitTx: 'abc', spellTx: 'def' }),
      });

      await expect(service.prove(validRequest)).rejects.toThrow('Invalid prover response format');
    });

    it('should reject response with wrong number of elements', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['abc'],
      });

      await expect(service.prove(validRequest)).rejects.toThrow('Invalid prover response format');
    });

    it('should reject response with non-string elements', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [123, 456],
      });

      await expect(service.prove(validRequest)).rejects.toThrow('Invalid transaction format');
    });

    it('should reject response with invalid hex', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['abc123', 'not-hex!@#'],
      });

      await expect(service.prove(validRequest)).rejects.toThrow('Invalid hex format');
    });
  });

  describe('Error Handling', () => {
    const validSpell: Spell = {
      version: 1,
      apps: {},
      ins: [{ utxo: 'txid:0' }],
      outs: [{ address: 'tb1qtest' }],
    };

    const validRequest: ProveRequest = {
      spell: validSpell,
      binaries: {},
      prev_txs: ['0100000001...'],
      funding_utxo: 'txid:0',
      funding_utxo_value: 10000,
      change_address: 'tb1qtest',
      fee_rate: 10,
    };

    it('should not retry on 4xx errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      await expect(service.prove(validRequest)).rejects.toThrow('Prover request failed: 400');
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should throw ProverError with correct code for client errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => 'Invalid spell',
      });

      try {
        await service.prove(validRequest);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProverError);
        expect((error as ProverError).code).toBe('CLIENT_ERROR');
        expect((error as ProverError).statusCode).toBe(422);
      }
    });

    it('should retry on 5xx errors', async () => {
      // First call fails with 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['abc123', 'def456'],
      });

      const result = await service.prove(validRequest);
      expect(result.commitTx).toBe('abc123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Spell Building', () => {
    it('should build a valid transfer spell', () => {
      const spell = service.buildTransferSpell({
        tokenAppId: 'abc123',
        tokenVk: 'def456',
        inputUtxo: 'txid:0',
        inputCharms: { token: { amount: '1000' } },
        outputAddress: 'tb1qrecipient',
        outputCharms: { token: { amount: '1000' } },
      });

      expect(spell.version).toBe(1);
      expect(spell.ins).toHaveLength(1);
      expect(spell.outs).toHaveLength(1);
      expect(spell.ins[0].utxo).toBe('txid:0');
      expect(spell.outs[0].address).toBe('tb1qrecipient');
    });

    it('should build a transfer spell with change', () => {
      const spell = service.buildTransferSpell({
        tokenAppId: 'abc123',
        tokenVk: 'def456',
        inputUtxo: 'txid:0',
        inputCharms: { token: { amount: '1000' } },
        outputAddress: 'tb1qrecipient',
        outputCharms: { token: { amount: '800' } },
        changeAddress: 'tb1qchange',
        changeCharms: { token: { amount: '200' } },
      });

      expect(spell.outs).toHaveLength(2);
      expect(spell.outs[1].address).toBe('tb1qchange');
    });

    it('should build a valid vault spell', () => {
      const spell = service.buildVaultSpell({
        operation: 'open',
        vmAppId: 'vm123',
        vmVk: 'vmvk456',
        tokenAppId: 'token123',
        tokenVk: 'tokenvk456',
        oracleAppId: 'oracle123',
        oracleVk: 'oraclevk456',
        inputs: [{ utxo: 'txid:0' }],
        outputs: [
          { address: 'tb1qvault', charms: { vault: { collateral: '100000' } } },
        ],
        publicInputs: ['100000', '50000'],
      });

      expect(spell.version).toBe(1);
      expect(Object.keys(spell.apps)).toHaveLength(3);
      expect(spell.ins).toHaveLength(1);
      expect(spell.outs).toHaveLength(1);
    });
  });
});

describe('ProverError', () => {
  it('should have correct properties', () => {
    const error = new ProverError('Test error', 'CLIENT_ERROR', 400);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('CLIENT_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('ProverError');
  });

  it('should work without status code', () => {
    const error = new ProverError('Test error', 'INVALID_REQUEST');
    expect(error.statusCode).toBeUndefined();
  });
});
