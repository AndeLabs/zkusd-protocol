// Stability Pool Service - Manage stability pool deposits in zkUSD protocol

import type {
  StabilityPoolState,
  StabilityPoolDeposit,
  DepositParams,
  WithdrawParams,
} from '@zkusd/types';
import type { ZkUsdClient } from './client';
import type { Spell, SpellInput, SpellOutput } from './services';

/** Charms spell version (v9 for Charms v0.11.1) */
const SPELL_VERSION = 9;

// Operation codes for Stability Pool
const SP_OP_DEPOSIT = 1;    // 0x01
const SP_OP_WITHDRAW = 2;   // 0x02
const SP_OP_CLAIM = 3;      // 0x03

/**
 * Convert a hex string or address to a byte array.
 * Required because Charms/Rust expects [u8; 32] arrays, not hex strings.
 *
 * @param input - Hex string (with or without 0x prefix) or address
 * @param expectedLength - Expected byte length (default 32)
 * @returns Array of numbers (0-255)
 */
function toBytes(input: string, expectedLength = 32): number[] {
  // Remove 0x prefix if present
  let cleanHex = input.startsWith('0x') ? input.slice(2) : input;

  // If it looks like a bech32 address, hash it to get bytes
  // For MVP, we just pad/hash the address string to 32 bytes
  if (input.startsWith('tb1') || input.startsWith('bc1')) {
    // Simple deterministic conversion: SHA256-like hash
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const hexPart = Math.abs(hash).toString(16).padStart(16, '0');
    cleanHex = hexPart.repeat(4); // 64 chars = 32 bytes
  }

  // Pad or truncate to expected length
  const paddedHex = cleanHex.padStart(expectedLength * 2, '0').slice(0, expectedLength * 2);

  const bytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.slice(i, i + 2), 16));
  }

  return bytes;
}

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

    // Convert depositor address to bytes (Rust expects [u8; 32])
    const depositorBytes = toBytes(params.depositorAddress, 32);

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
            depositor: depositorBytes,  // FIXED: Byte array instead of string
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
      version: SPELL_VERSION,
      apps: {
        '$00': spAppRef,
        '$01': tokenAppRef,
      },
      // Private inputs with witness data
      private_inputs: {
        '$00': {
          op: SP_OP_DEPOSIT,
          depositor: depositorBytes,
          amount: Number(params.amount),
        },
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

    // Convert depositor address to bytes (Rust expects [u8; 32])
    const depositorBytes = toBytes(params.deposit.depositor, 32);

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
            depositor: depositorBytes,  // FIXED: Byte array instead of string
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
            depositor: depositorBytes,  // FIXED: Byte array instead of string
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
      version: SPELL_VERSION,
      apps: {
        '$00': spAppRef,
        '$01': tokenAppRef,
      },
      // Private inputs with witness data
      private_inputs: {
        '$00': {
          op: SP_OP_WITHDRAW,
          depositor: depositorBytes,
          amount: Number(withdrawAmount),
        },
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

    // Convert depositor address to bytes (Rust expects [u8; 32])
    const depositorBytes = toBytes(params.deposit.depositor, 32);

    const inputs: SpellInput[] = [
      {
        utxo: params.depositUtxo,
        charms: {
          '$00': {
            depositor: depositorBytes,  // FIXED: Byte array instead of string
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
            depositor: depositorBytes,  // FIXED: Byte array instead of string
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
      version: SPELL_VERSION,
      apps: {
        '$00': spAppRef,
      },
      // Private inputs with witness data
      private_inputs: {
        '$00': {
          op: SP_OP_CLAIM,
          depositor: depositorBytes,
          amount: Number(params.deposit.collateralGain),
        },
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
