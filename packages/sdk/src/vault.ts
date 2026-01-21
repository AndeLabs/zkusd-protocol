/**
 * Vault Service - Manage vaults in zkUSD protocol
 *
 * Vaults are NFTs that hold BTC collateral and track zkUSD debt.
 * Based on Liquity V2's Trove model.
 *
 * @see https://docs.liquity.org/v2-faq/borrowing-and-liquidations
 */

import type {
  Vault,
  VaultPosition,
  OpenVaultParams,
  AdjustVaultParams,
  VaultManagerState
} from '@zkusd/types';
import {
  calculateICR,
  calculateLiquidationPrice,
  calculateMaxMintable,
  isVaultHealthy,
  isVaultAtRisk
} from '@zkusd/utils';
import type { ZkUsdClient } from './client';
import type { Spell, SpellInput, SpellOutput } from './services';

// ============================================================================
// Constants
// ============================================================================

/** Charms spell version */
const SPELL_VERSION = 8;

/** Default interest rate in basis points (1% = 100 bps) */
const DEFAULT_INTEREST_RATE_BPS = 100;

/** Default base rate for fee calculation (0.5% = 50 bps) */
const DEFAULT_BASE_RATE_BPS = 50;

/** Fee floor added to base rate (0.5% = 50 bps) */
const FEE_FLOOR_BPS = 50;

/** Vault status: Active (Rust enum serializes as string) */
const VAULT_STATUS_ACTIVE = 'Active';

/** Basis points denominator */
const BPS_DENOMINATOR = 10_000n;

/** Minimum collateral ratio (110% = 11000 bps) */
const MCR_BPS = 11_000;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert a hex string to a byte array.
 * Required because Charms/Rust expects [u8; 32] arrays, not hex strings.
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @param expectedLength - Expected byte length (default 32)
 * @returns Array of numbers (0-255)
 */
function hexToBytes(hex: string, expectedLength = 32): number[] {
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;

  // Pad or truncate to expected length
  const paddedHex = cleanHex.padStart(expectedLength * 2, '0').slice(0, expectedLength * 2);

  const bytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.slice(i, i + 2), 16));
  }

  return bytes;
}

/**
 * Safely convert bigint to number, throwing if precision would be lost.
 * JavaScript's Number.MAX_SAFE_INTEGER is 9,007,199,254,740,991 (2^53 - 1).
 */
function safeToNumber(value: bigint, fieldName: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `Value overflow in ${fieldName}: ${value} exceeds safe integer range. ` +
      `Maximum safe value is ${Number.MAX_SAFE_INTEGER}`
    );
  }
  if (value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(
      `Value underflow in ${fieldName}: ${value} is below safe integer range.`
    );
  }
  return Number(value);
}

/**
 * Generate vault ID from funding UTXO (deterministic).
 *
 * In production, this should use a proper cryptographic hash (SHA256).
 * For MVP, uses a simple deterministic hash.
 *
 * @param fundingUtxo - The UTXO used to create the vault (txid:vout)
 * @returns 64-character hex string (32 bytes)
 */
function generateVaultId(fundingUtxo: string): string {
  const input = `vault:${fundingUtxo}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hexPart = Math.abs(hash).toString(16).padStart(16, '0');
  return hexPart.repeat(4); // 64 chars = 32 bytes
}

/**
 * Service for managing vaults
 */
export class VaultService {
  constructor(private client: ZkUsdClient) {}

  /**
   * Get vault by UTXO ID
   *
   * Note: Full implementation requires parsing charm state from the UTXO.
   * This would decode the taproot commitment to extract vault data.
   */
  async getVault(utxoId: string): Promise<Vault | null> {
    // Parse UTXO ID
    const [txid, voutStr] = utxoId.split(':');
    const vout = parseInt(voutStr, 10);

    if (!txid || isNaN(vout)) {
      console.error(`[VaultService] Invalid UTXO ID: ${utxoId}`);
      return null;
    }

    // Get UTXO details
    const utxo = await this.client.getUtxo(txid, vout);
    if (!utxo || utxo.spent) {
      console.log(`[VaultService] UTXO ${utxoId} not found or spent`);
      return null;
    }

    // TODO: Parse charm state from UTXO script
    // For now, return null since we can't decode charm state without indexer
    console.log(`[VaultService] Found UTXO ${utxoId} but charm state parsing not implemented`);

    return null;
  }

  /**
   * Get vault position with calculated metrics
   */
  async getVaultPosition(utxoId: string): Promise<VaultPosition | null> {
    const vault = await this.getVault(utxoId);
    if (!vault) return null;

    const price = await this.client.oracle.getPrice();
    const icr = calculateICR(vault.collateral, vault.debt, price.price);
    const liquidationPrice = calculateLiquidationPrice(vault.collateral, vault.debt);
    const maxMintable = calculateMaxMintable(vault.collateral, price.price, vault.debt);

    return {
      vault,
      icr,
      healthFactor: icr / 11000, // normalized to 1.0 = at MCR
      liquidationPrice,
      maxWithdrawable: 0n, // TODO: Calculate
      maxMintable,
    };
  }

  /**
   * Get all vaults for an owner
   *
   * Note: Full implementation requires a Charms state indexer to scan
   * UTXOs with vault manager charm state. For MVP, this scans known
   * transactions or returns empty array.
   */
  async getVaultsByOwner(owner: string): Promise<Vault[]> {
    // TODO: Implement full vault discovery with Charms indexer
    // For now, we would need to:
    // 1. Get all UTXOs for the owner address
    // 2. Check each UTXO for taproot commitment with vault manager charm
    // 3. Parse the charm state to extract vault data

    // Current implementation: Return empty array
    // In production, this would query a Charms indexer service
    console.log(`[VaultService] Scanning for vaults owned by ${owner}`);

    // Get UTXOs for the address
    const utxos = await this.client.getAddressUtxos(owner);

    // For MVP: We don't have charm state parsing yet
    // Return empty array - vaults will appear once indexer is implemented
    const vaults: Vault[] = [];

    // Log for debugging
    console.log(`[VaultService] Found ${utxos.length} UTXOs, ${vaults.length} vaults`);

    return vaults;
  }

  /**
   * Get protocol state from VaultManager charm
   * Note: Currently returns default values. Full implementation requires
   * querying the VaultManager state UTXO with charm state scanning.
   */
  async getProtocolState(): Promise<VaultManagerState> {
    // TODO: Implement actual state querying from VaultManager UTXO
    // For now, return default protocol values from config
    const config = await this.client.getDeploymentConfig();

    // Default protocol state
    return {
      protocol: {
        totalCollateral: 0n,
        totalDebt: 0n,
        activeVaultCount: 0,
        baseRate: 50, // 0.5% base rate
        lastFeeUpdateBlock: 0,
        admin: config.addresses.admin,
        isPaused: false,
      },
      zkusdTokenId: config.contracts.zkusdToken.appId,
      stabilityPoolId: config.contracts.stabilityPool.appId,
      priceOracleId: config.contracts.priceOracle.appId,
      activePool: config.addresses.outputAddress,
      defaultPool: config.addresses.outputAddress,
    };
  }

  /**
   * Build spell for opening a new vault.
   *
   * Creates a Charms spell that:
   * 1. References the current VaultManagerState (for validation)
   * 2. Takes BTC from collateralUtxo as collateral (in spell inputs)
   * 3. Outputs updated VaultManagerState with incremented counters
   * 4. Mints a Vault NFT with the vault state
   * 5. Mints zkUSD tokens to the owner
   * 6. Returns change to the owner
   *
   * IMPORTANT: Charms requires:
   * - refs: Current VaultManagerState UTXO (read but not spent)
   * - collateralUtxo: Goes in spell's `ins` array (the UTXO being "enchanted")
   * - feeUtxo: Passed to prover as `funding_utxo` (MUST be different!)
   *
   * @param params - Vault parameters including collateral, debt, and owner info
   * @returns Spell object ready for proving
   */
  async buildOpenVaultSpell(params: OpenVaultParams & {
    collateralUtxo: string;  // UTXO with BTC for collateral (goes in spell ins)
    ownerAddress: string;
    ownerPubkey: string;
    currentBlock?: number;
    interestRateBps?: number;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();
    const currentBlock = params.currentBlock ?? await this.client.getBlockHeight();
    const interestRateBps = params.interestRateBps ?? DEFAULT_INTEREST_RATE_BPS;

    // Generate deterministic vault ID from collateral UTXO
    const vaultId = generateVaultId(params.collateralUtxo);

    // Calculate fee and total debt
    const state = await this.getProtocolState().catch(() => null);
    const baseRate = state?.protocol.baseRate ?? DEFAULT_BASE_RATE_BPS;
    const fee = this.calculateOpeningFee(params.debt, baseRate);
    const totalDebt = params.debt + fee;

    // Get app references from config
    const vmAppRef = config.contracts.vaultManager.appRef;
    const tokenAppRef = config.contracts.zkusdToken.appRef.replace('n/', 't/');

    // Get app ID bytes for cross-references (from deployment config)
    const tokenAppIdBytes = hexToBytes(config.contracts.zkusdToken.appId, 32);
    const spAppIdBytes = hexToBytes(config.contracts.stabilityPool.appId, 32);
    const oracleAppIdBytes = hexToBytes(config.contracts.priceOracle.appId, 32);
    const adminBytes = hexToBytes(config.addresses.admin, 32);
    // Active pool and default pool - using admin address padded
    const activePoolBytes = hexToBytes(config.addresses.admin.replace('0f', 'ac'), 32);
    const defaultPoolBytes = hexToBytes(config.addresses.admin.replace('0f', 'de'), 32);

    // Build current VaultManagerState (initial state from deployment)
    // This is the state that exists in the deployed UTXO
    // Convert bigints to numbers for serialization
    const currentVmState = {
      protocol: {
        total_collateral: Number(state?.protocol.totalCollateral ?? 0n),
        total_debt: Number(state?.protocol.totalDebt ?? 0n),
        active_vault_count: state?.protocol.activeVaultCount ?? 0,
        base_rate: baseRate,
        last_fee_update_block: state?.protocol.lastFeeUpdateBlock ?? 0,
        admin: adminBytes,
        is_paused: state?.protocol.isPaused ?? false,
      },
      zkusd_token_id: tokenAppIdBytes,
      stability_pool_id: spAppIdBytes,
      price_oracle_id: oracleAppIdBytes,
      active_pool: activePoolBytes,
      default_pool: defaultPoolBytes,
    };

    // Build updated VaultManagerState (with new vault added)
    // Convert bigints to numbers for protocol state
    const currentTotalCollateral = Number(state?.protocol.totalCollateral ?? 0n);
    const currentTotalDebt = Number(state?.protocol.totalDebt ?? 0n);
    const updatedVmState = {
      protocol: {
        total_collateral: currentTotalCollateral + safeToNumber(params.collateral, 'collateral'),
        total_debt: currentTotalDebt + safeToNumber(totalDebt, 'totalDebt'),
        active_vault_count: (state?.protocol.activeVaultCount ?? 0) + 1,
        base_rate: baseRate,
        last_fee_update_block: currentBlock,
        admin: adminBytes,
        is_paused: false,
      },
      zkusd_token_id: tokenAppIdBytes,
      stability_pool_id: spAppIdBytes,
      price_oracle_id: oracleAppIdBytes,
      active_pool: activePoolBytes,
      default_pool: defaultPoolBytes,
    };

    // Build vault state matching Rust struct format
    // CRITICAL: Rust expects [u8; 32] byte arrays, NOT hex strings!
    const vaultState = {
      id: hexToBytes(vaultId, 32),           // VaultId = [u8; 32]
      owner: hexToBytes(params.ownerPubkey, 32), // Address = [u8; 32]
      collateral: safeToNumber(params.collateral, 'collateral'),
      debt: safeToNumber(totalDebt, 'debt'),
      created_at: currentBlock,
      last_updated: currentBlock,
      status: VAULT_STATUS_ACTIVE,
      interest_rate_bps: interestRateBps,
      accrued_interest: 0,
      redistributed_debt: 0,
      redistributed_collateral: 0,
      insurance_balance: 0,
    };

    // Operation code for OpenVault
    const OPEN_VAULT_OP = 16; // 0x10

    // Get VaultManager state UTXO from deployment config
    const vmStateUtxo = config.contracts.vaultManager.stateUtxo;

    const spell: Spell = {
      version: SPELL_VERSION,
      apps: {
        '$00': vmAppRef,
        '$01': tokenAppRef,
      },
      // Private inputs with VaultWitness struct (ALL fields must be present for serde)
      private_inputs: {
        '$00': {
          op: OPEN_VAULT_OP,
          vault_id: null,  // Not needed for OpenVault
          collateral: safeToNumber(params.collateral, 'collateral'),
          debt: safeToNumber(params.debt, 'debt'),
          // Advanced operation fields (must be present as null)
          flash_purpose: null,
          rescuer_discount: null,
          coverage: null,
          premium: null,
          trigger_icr: null,
          insurance_id: null,
          new_owner: null,
        },
      },
      // Reference the current VaultManagerState UTXO (read but not spent)
      refs: vmStateUtxo ? [
        {
          utxo: vmStateUtxo,
          charms: { '$00': currentVmState },
        },
      ] : undefined,
      // Collateral UTXO goes in ins
      ins: [
        {
          utxo: params.collateralUtxo,
          charms: {},  // No existing charms (raw BTC)
        },
      ],
      outs: [
        // Output 1: Updated VaultManagerState
        {
          address: config.addresses.outputAddress,
          charms: { '$00': updatedVmState },
        },
        // Output 2: Vault NFT with state
        {
          address: params.ownerAddress,
          charms: { '$00': vaultState },
        },
        // Output 3: Minted zkUSD tokens
        {
          address: params.ownerAddress,
          charms: { '$01': safeToNumber(params.debt, 'debt') },
        },
        // Output 4: Change (remaining BTC after collateral)
        {
          address: params.ownerAddress,
          charms: {},
        },
      ],
    };

    return spell;
  }

  /**
   * Build spell for adjusting a vault
   */
  async buildAdjustVaultSpell(params: AdjustVaultParams & {
    vaultUtxo: string;
    vaultState: {
      id: string;
      owner: string;
      collateral: bigint;
      debt: bigint;
      createdAt: number;
      lastUpdated: number;
      interestRateBps: number;
      accruedInterest: bigint;
      redistributedDebt: bigint;
      redistributedCollateral: bigint;
      insuranceBalance: bigint;
    };
    ownerAddress: string;
    additionalBtcUtxo?: string;
    zkusdUtxo?: string;
    zkusdAmount?: bigint;
    currentBlock?: number;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();
    const currentBlock = params.currentBlock ?? await this.client.getBlockHeight();

    const vmAppRef = config.contracts.vaultManager.appRef;
    const tokenAppRef = config.contracts.zkusdToken.appRef.replace('n/', 't/');

    // Calculate new values based on change direction
    const collateralDelta = params.isCollateralIncrease
      ? params.collateralChange
      : -params.collateralChange;
    const debtDelta = params.isDebtIncrease
      ? params.debtChange
      : -params.debtChange;

    const newCollateral = params.vaultState.collateral + collateralDelta;
    const newDebt = params.vaultState.debt + debtDelta;

    // Build inputs
    // CRITICAL: Rust expects [u8; 32] byte arrays for id and owner
    const inputs: SpellInput[] = [
      {
        utxo: params.vaultUtxo,
        charms: {
          '$00': {
            id: hexToBytes(params.vaultState.id, 32),
            owner: hexToBytes(params.vaultState.owner, 32),
            collateral: safeToNumber(params.vaultState.collateral, 'vaultState.collateral'),
            debt: safeToNumber(params.vaultState.debt, 'vaultState.debt'),
            created_at: params.vaultState.createdAt,
            last_updated: params.vaultState.lastUpdated,
            status: 'Active',
            interest_rate_bps: params.vaultState.interestRateBps,
            accrued_interest: safeToNumber(params.vaultState.accruedInterest, 'accruedInterest'),
            redistributed_debt: safeToNumber(params.vaultState.redistributedDebt, 'redistributedDebt'),
            redistributed_collateral: safeToNumber(params.vaultState.redistributedCollateral, 'redistributedCollateral'),
            insurance_balance: safeToNumber(params.vaultState.insuranceBalance, 'insuranceBalance'),
          },
        },
      },
    ];

    // Add BTC input if adding collateral
    if (params.additionalBtcUtxo) {
      inputs.push({
        utxo: params.additionalBtcUtxo,
        charms: {},
      });
    }

    // Add zkUSD input if repaying debt
    if (params.zkusdUtxo && params.zkusdAmount) {
      inputs.push({
        utxo: params.zkusdUtxo,
        charms: {
          '$01': safeToNumber(params.zkusdAmount ?? 0n, 'zkusdAmount'),
        },
      });
    }

    // Build outputs
    // CRITICAL: Rust expects [u8; 32] byte arrays for id and owner
    const outputs: SpellOutput[] = [
      // Output 1: Updated Vault NFT
      {
        address: params.ownerAddress,
        charms: {
          '$00': {
            id: hexToBytes(params.vaultState.id, 32),
            owner: hexToBytes(params.vaultState.owner, 32),
            collateral: safeToNumber(newCollateral, 'newCollateral'),
            debt: safeToNumber(newDebt, 'newDebt'),
            created_at: params.vaultState.createdAt,
            last_updated: currentBlock,
            status: 'Active',
            interest_rate_bps: params.vaultState.interestRateBps,
            accrued_interest: safeToNumber(params.vaultState.accruedInterest, 'accruedInterest'),
            redistributed_debt: safeToNumber(params.vaultState.redistributedDebt, 'redistributedDebt'),
            redistributed_collateral: safeToNumber(params.vaultState.redistributedCollateral, 'redistributedCollateral'),
            insurance_balance: safeToNumber(params.vaultState.insuranceBalance, 'insuranceBalance'),
          },
        },
      },
    ];

    // Add zkUSD output if minting more debt
    if (params.isDebtIncrease && params.debtChange > 0n) {
      outputs.push({
        address: params.ownerAddress,
        charms: {
          '$01': safeToNumber(params.debtChange, 'debtChange'),
        },
      });
    }

    // Add change output
    outputs.push({
      address: params.ownerAddress,
      charms: {},
    });

    const spell: Spell = {
      version: 8,
      apps: {
        '$00': vmAppRef,
        '$01': tokenAppRef,
      },
      ins: inputs,
      outs: outputs,
    };

    return spell;
  }

  /**
   * Build spell for closing a vault
   */
  async buildCloseVaultSpell(params: {
    vaultUtxo: string;
    vaultState: {
      id: string;
      owner: string;
      collateral: bigint;
      debt: bigint;
      createdAt: number;
      lastUpdated: number;
      interestRateBps: number;
      accruedInterest: bigint;
      redistributedDebt: bigint;
      redistributedCollateral: bigint;
      insuranceBalance: bigint;
    };
    ownerAddress: string;
    zkusdUtxo: string;
    zkusdAmount: bigint;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();

    const vmAppRef = config.contracts.vaultManager.appRef;
    const tokenAppRef = config.contracts.zkusdToken.appRef.replace('n/', 't/');

    // Calculate total debt to repay
    const totalDebt = params.vaultState.debt +
      params.vaultState.accruedInterest +
      params.vaultState.redistributedDebt;

    // Calculate excess zkUSD
    const excessZkusd = params.zkusdAmount > totalDebt
      ? params.zkusdAmount - totalDebt
      : 0n;

    const spell: Spell = {
      version: 8,
      apps: {
        '$00': vmAppRef,
        '$01': tokenAppRef,
      },
      ins: [
        // Input 1: Vault NFT to close
        // CRITICAL: Rust expects [u8; 32] byte arrays for id and owner
        {
          utxo: params.vaultUtxo,
          charms: {
            '$00': {
              id: hexToBytes(params.vaultState.id, 32),
              owner: hexToBytes(params.vaultState.owner, 32),
              collateral: safeToNumber(params.vaultState.collateral, 'vaultState.collateral'),
              debt: safeToNumber(params.vaultState.debt, 'vaultState.debt'),
              created_at: params.vaultState.createdAt,
              last_updated: params.vaultState.lastUpdated,
              status: 'Active',
              interest_rate_bps: params.vaultState.interestRateBps,
              accrued_interest: safeToNumber(params.vaultState.accruedInterest, 'accruedInterest'),
              redistributed_debt: safeToNumber(params.vaultState.redistributedDebt, 'redistributedDebt'),
              redistributed_collateral: safeToNumber(params.vaultState.redistributedCollateral, 'redistributedCollateral'),
              insurance_balance: safeToNumber(params.vaultState.insuranceBalance, 'insuranceBalance'),
            },
          },
        },
        // Input 2: zkUSD to repay debt
        {
          utxo: params.zkusdUtxo,
          charms: {
            '$01': safeToNumber(params.zkusdAmount ?? 0n, 'zkusdAmount'),
          },
        },
      ],
      outs: [
        // Output 1: Recovered collateral (vault NFT is NOT included = burned)
        {
          address: params.ownerAddress,
          charms: {},
        },
        // Output 2: Excess zkUSD returned (if any)
        ...(excessZkusd > 0n ? [{
          address: params.ownerAddress,
          charms: {
            '$01': Number(excessZkusd),
          },
        }] : []),
      ],
    };

    return spell;
  }

  /**
   * Calculate opening fee for a given debt
   */
  calculateOpeningFee(debt: bigint, baseRate: number): bigint {
    // Fee = debt * (baseRate + 0.5%)
    const feeRate = BigInt(baseRate + 50); // base rate + 0.5% floor
    return (debt * feeRate) / 10000n;
  }

  /**
   * Simulate opening a vault
   */
  async simulateOpenVault(params: OpenVaultParams): Promise<{
    valid: boolean;
    icr: number;
    fee: bigint;
    totalDebt: bigint;
    error?: string;
  }> {
    const price = await this.client.oracle.getPrice();
    const state = await this.getProtocolState();

    if (!state) {
      return { valid: false, icr: 0, fee: 0n, totalDebt: 0n, error: 'Protocol not initialized' };
    }

    const fee = this.calculateOpeningFee(params.debt, state.protocol.baseRate);
    const totalDebt = params.debt + fee;
    const icr = calculateICR(params.collateral, totalDebt, price.price);

    if (!isVaultHealthy(icr)) {
      return { valid: false, icr, fee, totalDebt, error: 'ICR below minimum' };
    }

    return { valid: true, icr, fee, totalDebt };
  }
}
