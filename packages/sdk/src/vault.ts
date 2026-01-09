// Vault Service - Manage vaults in zkUSD protocol

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

/**
 * Generate vault ID from funding UTXO (deterministic)
 */
function generateVaultId(fundingUtxo: string): string {
  // Simple hash of UTXO - in production would use proper crypto
  // For now, use first 32 bytes of a deterministic string
  const input = `vault:${fundingUtxo}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Convert to hex string padded to 64 chars
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
   * Build spell for opening a new vault
   */
  async buildOpenVaultSpell(params: OpenVaultParams & {
    fundingUtxo: string;
    ownerAddress: string;
    ownerPubkey: string;
    currentBlock?: number;
    interestRateBps?: number;
  }): Promise<Spell> {
    const config = await this.client.getDeploymentConfig();
    const currentBlock = params.currentBlock ?? await this.client.getBlockHeight();
    const interestRateBps = params.interestRateBps ?? 100; // Default 1% APR

    // Generate deterministic vault ID from funding UTXO
    const vaultId = generateVaultId(params.fundingUtxo);

    // Calculate fee and total debt
    const state = await this.getProtocolState().catch(() => null);
    const baseRate = state?.protocol.baseRate ?? 50;
    const fee = this.calculateOpeningFee(params.debt, baseRate);
    const totalDebt = params.debt + fee;

    // Build the spell
    const vmAppRef = config.contracts.vaultManager.appRef;
    const tokenAppRef = config.contracts.zkusdToken.appRef.replace('n/', 't/'); // Use fungible token ref

    const spell: Spell = {
      version: 8,
      apps: {
        '$00': vmAppRef,
        '$01': tokenAppRef,
      },
      // Private inputs (witness data) for vault ID generation
      private_inputs: {
        '$00': params.fundingUtxo, // Used to generate deterministic vault ID
      },
      ins: [
        {
          utxo: params.fundingUtxo,
          charms: {},
        },
      ],
      outs: [
        // Output 1: New Vault NFT
        {
          address: params.ownerAddress,
          charms: {
            '$00': {
              id: vaultId,
              owner: params.ownerPubkey,
              collateral: Number(params.collateral),
              debt: Number(totalDebt),
              created_at: currentBlock,
              last_updated: currentBlock,
              status: 0, // Active
              interest_rate_bps: interestRateBps,
              accrued_interest: 0,
              redistributed_debt: 0,
              redistributed_collateral: 0,
              insurance_balance: 0,
            },
          },
        },
        // Output 2: Minted zkUSD tokens
        {
          address: params.ownerAddress,
          charms: {
            '$01': Number(params.debt), // Net debt (before fee)
          },
        },
        // Output 3: Change
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
    const inputs: SpellInput[] = [
      {
        utxo: params.vaultUtxo,
        charms: {
          '$00': {
            id: params.vaultState.id,
            owner: params.vaultState.owner,
            collateral: Number(params.vaultState.collateral),
            debt: Number(params.vaultState.debt),
            created_at: params.vaultState.createdAt,
            last_updated: params.vaultState.lastUpdated,
            status: 0,
            interest_rate_bps: params.vaultState.interestRateBps,
            accrued_interest: Number(params.vaultState.accruedInterest),
            redistributed_debt: Number(params.vaultState.redistributedDebt),
            redistributed_collateral: Number(params.vaultState.redistributedCollateral),
            insurance_balance: Number(params.vaultState.insuranceBalance),
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
          '$01': Number(params.zkusdAmount),
        },
      });
    }

    // Build outputs
    const outputs: SpellOutput[] = [
      // Output 1: Updated Vault NFT
      {
        address: params.ownerAddress,
        charms: {
          '$00': {
            id: params.vaultState.id,
            owner: params.vaultState.owner,
            collateral: Number(newCollateral),
            debt: Number(newDebt),
            created_at: params.vaultState.createdAt,
            last_updated: currentBlock,
            status: 0,
            interest_rate_bps: params.vaultState.interestRateBps,
            accrued_interest: Number(params.vaultState.accruedInterest),
            redistributed_debt: Number(params.vaultState.redistributedDebt),
            redistributed_collateral: Number(params.vaultState.redistributedCollateral),
            insurance_balance: Number(params.vaultState.insuranceBalance),
          },
        },
      },
    ];

    // Add zkUSD output if minting more debt
    if (params.isDebtIncrease && params.debtChange > 0n) {
      outputs.push({
        address: params.ownerAddress,
        charms: {
          '$01': Number(params.debtChange),
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
        {
          utxo: params.vaultUtxo,
          charms: {
            '$00': {
              id: params.vaultState.id,
              owner: params.vaultState.owner,
              collateral: Number(params.vaultState.collateral),
              debt: Number(params.vaultState.debt),
              created_at: params.vaultState.createdAt,
              last_updated: params.vaultState.lastUpdated,
              status: 0,
              interest_rate_bps: params.vaultState.interestRateBps,
              accrued_interest: Number(params.vaultState.accruedInterest),
              redistributed_debt: Number(params.vaultState.redistributedDebt),
              redistributed_collateral: Number(params.vaultState.redistributedCollateral),
              insurance_balance: Number(params.vaultState.insuranceBalance),
            },
          },
        },
        // Input 2: zkUSD to repay debt
        {
          utxo: params.zkusdUtxo,
          charms: {
            '$01': Number(params.zkusdAmount),
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
