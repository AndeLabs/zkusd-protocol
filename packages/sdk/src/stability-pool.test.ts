import type { StabilityPoolDeposit } from '@zkusd/types';
// Stability Pool Service Tests
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ZkUsdClient } from './client';

describe('StabilityPoolService', () => {
  let client: ZkUsdClient;

  beforeAll(() => {
    client = new ZkUsdClient({ network: 'testnet4' });
  });

  describe('getPoolState', () => {
    it('should return default pool state', async () => {
      const state = await client.stabilityPool.getPoolState();

      expect(state.totalDeposits).toBe(0n);
      expect(state.totalCollateralGains).toBe(0n);
      expect(state.depositorCount).toBe(0);
      expect(state.epochScale).toBe(0);
      expect(state.lastUpdated).toBe(0);
    });
  });

  describe('getDeposit', () => {
    it('should return null for non-existent deposit', async () => {
      const deposit = await client.stabilityPool.getDeposit('tb1qtest123');

      expect(deposit).toBeNull();
    });
  });

  describe('getAllDeposits', () => {
    it('should return empty array (requires indexer)', async () => {
      const deposits = await client.stabilityPool.getAllDeposits();

      expect(deposits).toEqual([]);
    });
  });

  describe('calculateExpectedGains', () => {
    it('should calculate proportional gains correctly', () => {
      const deposit = 1000_00000000n; // 1000 zkUSD
      const poolTotal = 10000_00000000n; // 10000 zkUSD total
      const liquidationCollateral = 100000000n; // 1 BTC

      const gains = client.stabilityPool.calculateExpectedGains(
        deposit,
        poolTotal,
        liquidationCollateral
      );

      // 1000/10000 * 1 BTC = 0.1 BTC
      expect(gains).toBe(10000000n); // 0.1 BTC in sats
    });

    it('should return 0 for empty pool', () => {
      const gains = client.stabilityPool.calculateExpectedGains(1000_00000000n, 0n, 100000000n);

      expect(gains).toBe(0n);
    });

    it('should calculate full gains for single depositor', () => {
      const deposit = 5000_00000000n;
      const poolTotal = 5000_00000000n; // Same as deposit
      const liquidationCollateral = 200000000n; // 2 BTC

      const gains = client.stabilityPool.calculateExpectedGains(
        deposit,
        poolTotal,
        liquidationCollateral
      );

      expect(gains).toBe(200000000n); // Full 2 BTC
    });
  });

  describe('buildDepositSpell', () => {
    it('should generate valid deposit spell structure', async () => {
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(115000);

      const spell = await client.stabilityPool.buildDepositSpell({
        amount: 500_00000000n, // 500 zkUSD
        zkusdUtxo: 'abc123:0',
        zkusdAmount: 600_00000000n, // 600 zkUSD available
        depositorAddress: 'tb1qdepositor',
      });

      // Verify spell structure
      expect(spell.version).toBe(9);
      expect(Object.keys(spell.apps)).toHaveLength(2);
      expect(spell.ins).toHaveLength(1);
      expect(spell.outs).toHaveLength(2);

      // Verify input
      expect(spell.ins[0].utxo).toBe('abc123:0');
      expect(spell.ins[0].charms.$01).toBe(60000000000); // zkUSD input

      // Verify deposit receipt output
      expect(spell.outs[0].address).toBe('tb1qdepositor');
      expect(spell.outs[0].charms.$00).toBeDefined();
      expect(spell.outs[0].charms.$00.deposit).toBe(50000000000);
      expect(spell.outs[0].charms.$00.deposit_time).toBe(115000);
    });

    it('should handle existing deposit (top-up)', async () => {
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(116000);

      const existingDeposit: StabilityPoolDeposit = {
        depositor: 'tb1qexisting',
        deposit: 100_00000000n,
        collateralGain: 5000000n, // 0.05 BTC gain
        snapshotEpoch: 0,
        snapshotScale: 0,
        depositTime: 115000,
      };

      const spell = await client.stabilityPool.buildDepositSpell({
        amount: 200_00000000n, // Adding 200 zkUSD
        zkusdUtxo: 'def456:1',
        zkusdAmount: 200_00000000n,
        depositorAddress: 'tb1qexisting',
        existingDeposit,
      });

      // Verify combined deposit
      const depositOutput = spell.outs[0].charms.$00;
      expect(depositOutput.deposit).toBe(30000000000); // 100 + 200 = 300 zkUSD
      expect(depositOutput.collateral_gain).toBe(5000000); // Preserved gains
    });
  });

  describe('buildWithdrawSpell', () => {
    it('should generate valid full withdrawal spell', async () => {
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(120000);

      const deposit: StabilityPoolDeposit = {
        depositor: 'tb1qdepositor',
        deposit: 500_00000000n,
        collateralGain: 10000000n, // 0.1 BTC
        snapshotEpoch: 1,
        snapshotScale: 2,
        depositTime: 100000,
      };

      const spell = await client.stabilityPool.buildWithdrawSpell({
        amount: 0n, // 0 means withdraw all
        depositUtxo: 'deposit123:0',
        deposit,
        depositorAddress: 'tb1qdepositor',
      });

      expect(spell.version).toBe(9);
      expect(spell.ins).toHaveLength(1);

      // Verify input includes deposit state
      expect(spell.ins[0].utxo).toBe('deposit123:0');
      expect(spell.ins[0].charms.$00.deposit).toBe(50000000000);

      // Should have zkUSD output and collateral gains output
      const zkusdOutput = spell.outs.find((o) => o.charms.$01 !== undefined);
      expect(zkusdOutput?.charms.$01).toBe(50000000000); // Full deposit returned
    });

    it('should generate partial withdrawal spell', async () => {
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(121000);

      const deposit: StabilityPoolDeposit = {
        depositor: 'tb1qpartial',
        deposit: 1000_00000000n,
        collateralGain: 0n,
        snapshotEpoch: 0,
        snapshotScale: 0,
        depositTime: 110000,
      };

      const spell = await client.stabilityPool.buildWithdrawSpell({
        amount: 300_00000000n, // Withdraw 300 of 1000
        depositUtxo: 'partial123:0',
        deposit,
        depositorAddress: 'tb1qpartial',
      });

      // Should have remaining deposit output
      const depositOutput = spell.outs.find((o) => o.charms.$00 !== undefined);
      expect(depositOutput?.charms.$00.deposit).toBe(70000000000); // 700 remaining

      // And withdrawn zkUSD output
      const zkusdOutput = spell.outs.find((o) => o.charms.$01 !== undefined);
      expect(zkusdOutput?.charms.$01).toBe(30000000000); // 300 withdrawn
    });
  });

  describe('buildClaimGainsSpell', () => {
    it('should generate gains claim spell without withdrawing deposit', async () => {
      vi.spyOn(client, 'getBlockHeight').mockResolvedValue(125000);

      const deposit: StabilityPoolDeposit = {
        depositor: 'tb1qclaimer',
        deposit: 500_00000000n,
        collateralGain: 25000000n, // 0.25 BTC gains
        snapshotEpoch: 2,
        snapshotScale: 1,
        depositTime: 100000,
      };

      const spell = await client.stabilityPool.buildClaimGainsSpell({
        depositUtxo: 'claim123:0',
        deposit,
        depositorAddress: 'tb1qclaimer',
      });

      expect(spell.version).toBe(9);
      expect(spell.ins).toHaveLength(1);

      // Input should have deposit with gains
      expect(spell.ins[0].charms.$00.collateral_gain).toBe(25000000);

      // Output should have deposit with zeroed gains
      const depositOutput = spell.outs[0].charms.$00;
      expect(depositOutput.deposit).toBe(50000000000); // Deposit preserved
      expect(depositOutput.collateral_gain).toBe(0); // Gains claimed (zeroed)

      // Should have collateral output
      expect(spell.outs).toHaveLength(2);
    });
  });

  describe('simulateDeposit', () => {
    it('should validate positive deposit amount', async () => {
      const result = await client.stabilityPool.simulateDeposit({
        amount: 0n,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Deposit amount must be positive');
    });

    it('should calculate pool share for new deposit', async () => {
      // Mock getPoolState to return some existing deposits
      vi.spyOn(client.stabilityPool, 'getPoolState').mockResolvedValue({
        totalDeposits: 9000_00000000n, // 9000 zkUSD in pool
        totalCollateralGains: 0n,
        depositorCount: 5,
        epochScale: 0,
        lastUpdated: 0,
      });

      const result = await client.stabilityPool.simulateDeposit({
        amount: 1000_00000000n, // 1000 zkUSD deposit
      });

      expect(result.valid).toBe(true);
      // 1000 / (9000 + 1000) = 10%
      expect(result.newPoolShare).toBeCloseTo(10, 0);
    });

    it('should calculate 100% share for first depositor', async () => {
      vi.spyOn(client.stabilityPool, 'getPoolState').mockResolvedValue({
        totalDeposits: 0n,
        totalCollateralGains: 0n,
        depositorCount: 0,
        epochScale: 0,
        lastUpdated: 0,
      });

      const result = await client.stabilityPool.simulateDeposit({
        amount: 500_00000000n,
      });

      expect(result.valid).toBe(true);
      expect(result.newPoolShare).toBe(100);
    });
  });
});
