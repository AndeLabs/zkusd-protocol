// Stability Pool Service - Manage stability pool deposits in zkUSD protocol

import type {
  StabilityPoolState,
  StabilityPoolDeposit,
  DepositParams,
  WithdrawParams,
} from '@zkusd/types';
import type { ZkUsdClient } from './client';
import type { Spell, SpellInput, SpellOutput } from './services';

/**
 * Service for managing stability pool operations
 */
export class StabilityPoolService {
  constructor(private client: ZkUsdClient) {}

  /**
   * Get current stability pool state
   *
   * Note: Full implementation requires scanning the Stability Pool UTXO
   * for charm state. Currently returns default/initial values.
   */
  async getPoolState(): Promise<StabilityPoolState> {
    const config = await this.client.getDeploymentConfig();

    // TODO: Query actual stability pool UTXO state
    // For now, return initial deployment values
    return {
      totalDeposits: 0n,
      totalCollateralGains: 0n,
      depositorCount: 0,
      epochScale: 0,
      lastUpdated: 0,
    };
  }

  /**
   * Get deposit for a specific address
   *
   * Note: Requires scanning UTXOs with stability pool charm state
   */
  async getDeposit(address: string): Promise<StabilityPoolDeposit | null> {
    // TODO: Scan for user's stability pool deposit UTXO
    // For now, return null (no deposit found)
    console.log(`[StabilityPool] Looking for deposit from ${address}`);

    return null;
  }

  /**
   * Get all deposits in the stability pool
   *
   * Note: Requires a Charms indexer for efficient querying
   */
  async getAllDeposits(): Promise<StabilityPoolDeposit[]> {
    // TODO: Implement with Charms indexer
    console.log('[StabilityPool] getAllDeposits - requires indexer');
    return [];
  }

  /**
   * Calculate expected gains for a depositor
   */
  calculateExpectedGains(
    deposit: bigint,
    poolTotalDeposits: bigint,
    liquidationCollateral: bigint
  ): bigint {
    if (poolTotalDeposits === 0n) return 0n;
    return (deposit * liquidationCollateral) / poolTotalDeposits;
  }

  /**
   * Build spell for depositing to stability pool
   */
  async buildDepositSpell(params: DepositParams & {
    zkusdUtxo: string;
    zkusdAmount: bigint;
    depositorAddress: string;
    existingDeposit?: StabilityPoolDeposit;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();
    const currentBlock = await this.client.getBlockHeight();

    const spAppRef = config.contracts.stabilityPool.appRef;
    const tokenAppRef = config.contracts.zkusdToken.appRef.replace('n/', 't/');

    const inputs: SpellInput[] = [
      // Input: zkUSD tokens to deposit
      {
        utxo: params.zkusdUtxo,
        charms: {
          '$01': Number(params.zkusdAmount),
        },
      },
    ];

    // If user has existing deposit, include it as input
    if (params.existingDeposit) {
      // Would include existing deposit UTXO
    }

    const newDepositAmount = params.existingDeposit
      ? params.existingDeposit.deposit + params.amount
      : params.amount;

    const outputs: SpellOutput[] = [
      // Output 1: Stability Pool deposit receipt
      {
        address: params.depositorAddress,
        charms: {
          '$00': {
            depositor: params.depositorAddress,
            deposit: Number(newDepositAmount),
            collateral_gain: params.existingDeposit
              ? Number(params.existingDeposit.collateralGain)
              : 0,
            snapshot_epoch: 0,
            snapshot_scale: 0,
            deposit_time: currentBlock,
          },
        },
      },
      // Output 2: Change (excess zkUSD if any)
      {
        address: params.depositorAddress,
        charms: {},
      },
    ];

    const spell: Spell = {
      version: 8,
      apps: {
        '$00': spAppRef,
        '$01': tokenAppRef,
      },
      ins: inputs,
      outs: outputs,
    };

    return spell;
  }

  /**
   * Build spell for withdrawing from stability pool
   */
  async buildWithdrawSpell(params: WithdrawParams & {
    depositUtxo: string;
    deposit: StabilityPoolDeposit;
    depositorAddress: string;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();
    const currentBlock = await this.client.getBlockHeight();

    const spAppRef = config.contracts.stabilityPool.appRef;
    const tokenAppRef = config.contracts.zkusdToken.appRef.replace('n/', 't/');

    // Calculate withdrawal amount (0 means withdraw all)
    const withdrawAmount = params.amount === 0n
      ? params.deposit.deposit
      : params.amount;

    const remainingDeposit = params.deposit.deposit - withdrawAmount;

    const inputs: SpellInput[] = [
      // Input: Existing deposit
      {
        utxo: params.depositUtxo,
        charms: {
          '$00': {
            depositor: params.deposit.depositor,
            deposit: Number(params.deposit.deposit),
            collateral_gain: Number(params.deposit.collateralGain),
            snapshot_epoch: params.deposit.snapshotEpoch,
            snapshot_scale: params.deposit.snapshotScale,
            deposit_time: params.deposit.depositTime,
          },
        },
      },
    ];

    const outputs: SpellOutput[] = [];

    // If partial withdrawal, create new deposit UTXO
    if (remainingDeposit > 0n) {
      outputs.push({
        address: params.depositorAddress,
        charms: {
          '$00': {
            depositor: params.deposit.depositor,
            deposit: Number(remainingDeposit),
            collateral_gain: 0, // Gains claimed on withdrawal
            snapshot_epoch: 0,
            snapshot_scale: 0,
            deposit_time: currentBlock,
          },
        },
      });
    }

    // Output: Withdrawn zkUSD tokens
    outputs.push({
      address: params.depositorAddress,
      charms: {
        '$01': Number(withdrawAmount),
      },
    });

    // Output: Collateral gains (BTC) if any
    if (params.deposit.collateralGain > 0n) {
      outputs.push({
        address: params.depositorAddress,
        charms: {},
        // Note: Actual BTC value would be set by the spell execution
      });
    }

    // Output: Change
    outputs.push({
      address: params.depositorAddress,
      charms: {},
    });

    const spell: Spell = {
      version: 8,
      apps: {
        '$00': spAppRef,
        '$01': tokenAppRef,
      },
      ins: inputs,
      outs: outputs,
    };

    return spell;
  }

  /**
   * Build spell for claiming collateral gains without withdrawing deposit
   */
  async buildClaimGainsSpell(params: {
    depositUtxo: string;
    deposit: StabilityPoolDeposit;
    depositorAddress: string;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();
    const currentBlock = await this.client.getBlockHeight();

    const spAppRef = config.contracts.stabilityPool.appRef;

    const inputs: SpellInput[] = [
      {
        utxo: params.depositUtxo,
        charms: {
          '$00': {
            depositor: params.deposit.depositor,
            deposit: Number(params.deposit.deposit),
            collateral_gain: Number(params.deposit.collateralGain),
            snapshot_epoch: params.deposit.snapshotEpoch,
            snapshot_scale: params.deposit.snapshotScale,
            deposit_time: params.deposit.depositTime,
          },
        },
      },
    ];

    const outputs: SpellOutput[] = [
      // Output 1: Updated deposit (gains zeroed)
      {
        address: params.depositorAddress,
        charms: {
          '$00': {
            depositor: params.deposit.depositor,
            deposit: Number(params.deposit.deposit),
            collateral_gain: 0,
            snapshot_epoch: 0,
            snapshot_scale: 0,
            deposit_time: currentBlock,
          },
        },
      },
      // Output 2: Collateral gains (BTC)
      {
        address: params.depositorAddress,
        charms: {},
      },
    ];

    const spell: Spell = {
      version: 8,
      apps: {
        '$00': spAppRef,
      },
      ins: inputs,
      outs: outputs,
    };

    return spell;
  }

  /**
   * Simulate a deposit
   */
  async simulateDeposit(params: DepositParams): Promise<{
    valid: boolean;
    newPoolShare: number;
    error?: string;
  }> {
    if (params.amount <= 0n) {
      return { valid: false, newPoolShare: 0, error: 'Deposit amount must be positive' };
    }

    const poolState = await this.getPoolState();
    const newTotal = poolState.totalDeposits + params.amount;
    const poolShare = Number(params.amount) / Number(newTotal) * 100;

    return { valid: true, newPoolShare: poolShare };
  }
}
