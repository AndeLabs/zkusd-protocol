// Vault Service Tests
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ZkUsdClient } from './client';

describe('VaultService Spell Builders', () => {
  let client: ZkUsdClient;

  beforeAll(() => {
    client = new ZkUsdClient({ network: 'testnet4' });
  });

  describe('buildOpenVaultSpell', () => {
    it('should generate a valid open vault spell', async () => {
      // Mock getBlockHeight
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(115000);

      const spell = await client.vault.buildOpenVaultSpell({
        collateral: 10000000n, // 0.1 BTC
        debt: 500000000000n, // 5000 zkUSD
        owner: 'tb1qtest123',
        collateralUtxo: 'abc123def456789abc123def456789abc123def456789abc123def456789abcd:0',
        ownerAddress: 'tb1qtest123',
        ownerPubkey: '02abc123def456789',
      });

      // Verify spell structure
      expect(spell.version).toBe(9);
      expect(Object.keys(spell.apps)).toHaveLength(2);
      expect(spell.ins).toHaveLength(1);
      expect(spell.outs).toHaveLength(3);

      // Verify app references use correct format
      expect(spell.apps['$00']).toMatch(/^n\//); // Vault Manager NFT
      expect(spell.apps['$01']).toMatch(/^t\//); // Token fungible

      // Verify input
      expect(spell.ins[0].utxo).toBe('abc123def456789abc123def456789abc123def456789abc123def456789abcd:0');
      expect(spell.ins[0].charms).toEqual({});

      // Verify outputs
      // Output 1: Vault NFT
      expect(spell.outs[0].address).toBe('tb1qtest123');
      expect(spell.outs[0].charms['$00']).toBeDefined();
      expect(spell.outs[0].charms['$00'].collateral).toBe(10000000);
      expect(spell.outs[0].charms['$00'].status).toBe(0); // Active

      // Output 2: zkUSD tokens
      expect(spell.outs[1].address).toBe('tb1qtest123');
      expect(spell.outs[1].charms['$01']).toBeDefined();

      // Output 3: Change
      expect(spell.outs[2].address).toBe('tb1qtest123');
      expect(spell.outs[2].charms).toEqual({});
    });

    it('should include correct vault state fields', async () => {
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(115000);

      const spell = await client.vault.buildOpenVaultSpell({
        collateral: 50000000n, // 0.5 BTC
        debt: 1000000000000n, // 10000 zkUSD
        owner: 'tb1qowner',
        collateralUtxo: 'txid123:1',
        ownerAddress: 'tb1qowner',
        ownerPubkey: '03pubkey',
        interestRateBps: 150, // 1.5% APR
      });

      const vaultState = spell.outs[0].charms['$00'];

      // Verify all vault state fields
      expect(vaultState.id).toBeDefined();
      expect(vaultState.owner).toBe('03pubkey');
      expect(vaultState.collateral).toBe(50000000);
      expect(vaultState.created_at).toBe(115000);
      expect(vaultState.last_updated).toBe(115000);
      expect(vaultState.status).toBe(0);
      expect(vaultState.interest_rate_bps).toBe(150);
      expect(vaultState.accrued_interest).toBe(0);
      expect(vaultState.redistributed_debt).toBe(0);
      expect(vaultState.redistributed_collateral).toBe(0);
      expect(vaultState.insurance_balance).toBe(0);
    });
  });

  describe('getProtocolState', () => {
    it('should return default protocol state', async () => {
      const state = await client.vault.getProtocolState();

      expect(state.protocol.baseRate).toBe(50);
      expect(state.protocol.isPaused).toBe(false);
      expect(state.zkusdTokenId).toBeDefined();
      expect(state.stabilityPoolId).toBeDefined();
      expect(state.priceOracleId).toBeDefined();
    });
  });

  describe('getVaultsByOwner', () => {
    it('should return empty array (no indexer yet)', async () => {
      // Mock getAddressUtxos
      vi.spyOn(client, 'getAddressUtxos').mockResolvedValue([]);

      const vaults = await client.vault.getVaultsByOwner('tb1qtest');

      expect(vaults).toEqual([]);
    });
  });

  describe('calculateOpeningFee', () => {
    it('should calculate correct fee', () => {
      const debt = 1000_00000000n; // 1000 zkUSD
      const baseRate = 50; // 0.5%

      // Fee = debt * (baseRate + 50) / 10000
      // Fee = 1000 * (50 + 50) / 10000 = 1000 * 100 / 10000 = 10 zkUSD
      const fee = client.vault.calculateOpeningFee(debt, baseRate);

      expect(fee).toBe(10_00000000n);
    });
  });
});
