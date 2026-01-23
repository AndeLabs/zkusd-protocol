/**
 * Spell Service - Build and manage Charms spells for zkUSD
 *
 * Responsibilities:
 * - Build spells with frozen dynamic values
 * - Manage spell lifecycle (pending, proving, complete)
 * - Ensure deterministic spell hashes for prover cache compatibility
 *
 * Key Principle: FREEZE VALUES ONCE
 * Dynamic values (btcPrice, blockHeight) are frozen at spell creation
 * and never change during the spell's lifecycle.
 */

import { getClient } from '@/lib/sdk';
import {
  savePendingSpell,
  getPendingSpell,
  clearPendingSpell,
  generateSpellHash,
} from '@/lib/spell-cache';
import type { Spell } from '@zkusd/sdk';
import type { UtxoInfo } from './utxo-service';

// ============================================================================
// Types
// ============================================================================

export interface FrozenValues {
  btcPrice: number;
  blockHeight: number;
  /** Timestamp when values were frozen */
  frozenAt: number;
}

export interface SpellParams {
  collateral: bigint;
  debt: bigint;
  owner: string;
  ownerAddress: string;
}

export interface SpellContext {
  /** The spell object ready for proving */
  spell: Spell;
  /** Unique hash of this spell */
  spellHash: string;
  /** The collateral UTXO committed to this spell */
  collateralUtxo: UtxoInfo;
  /** The fee UTXO for this spell */
  feeUtxo: UtxoInfo;
  /** Frozen dynamic values */
  frozenValues: FrozenValues;
  /** Original parameters */
  params: SpellParams;
  /** Generated vault ID (deterministic from collateral UTXO) */
  vaultId: string;
}

export interface PendingSpellInfo {
  exists: boolean;
  spellContext?: SpellContext;
  /** Time remaining until pending spell expires (ms) */
  expiresIn?: number;
  /** Whether the pending spell matches current params */
  matchesParams: boolean;
}

// ============================================================================
// Spell Service Class
// ============================================================================

class SpellService {
  /**
   * Fetch current dynamic values from the blockchain
   */
  async fetchCurrentValues(): Promise<FrozenValues> {
    const client = getClient();

    const [blockHeight, priceData] = await Promise.all([
      client.getBlockHeight(),
      client.oracle.getPrice(),
    ]);

    return {
      btcPrice: Number(priceData.price),
      blockHeight,
      frozenAt: Date.now(),
    };
  }

  /**
   * Check if there's a pending spell that can be reused
   */
  checkPendingSpell(currentParams: SpellParams): PendingSpellInfo {
    const pending = getPendingSpell(
      {
        collateral: currentParams.collateral.toString(),
        debt: currentParams.debt.toString(),
        owner: currentParams.owner,
      },
      false // Non-strict: allow same spell if owner matches
    );

    if (!pending) {
      return { exists: false, matchesParams: false };
    }

    // Check if params match exactly
    const matchesParams =
      pending.params.collateral === currentParams.collateral.toString() &&
      pending.params.debt === currentParams.debt.toString() &&
      pending.params.owner === currentParams.owner;

    // Calculate time until expiry (30 min TTL)
    const PENDING_SPELL_TTL = 30 * 60 * 1000;
    const expiresIn = Math.max(0, PENDING_SPELL_TTL - (Date.now() - pending.timestamp));

    return {
      exists: true,
      spellContext: {
        spell: pending.spell as Spell,
        spellHash: generateSpellHash(pending.spell),
        collateralUtxo: {
          txid: pending.collateralUtxoId.split(':')[0],
          vout: parseInt(pending.collateralUtxoId.split(':')[1], 10),
          value: 0, // We don't store this, will be refetched if needed
          confirmed: true,
          id: pending.collateralUtxoId,
        },
        feeUtxo: {
          txid: pending.feeUtxoId.split(':')[0],
          vout: parseInt(pending.feeUtxoId.split(':')[1], 10),
          value: 0,
          confirmed: true,
          id: pending.feeUtxoId,
        },
        frozenValues: {
          ...pending.frozenValues,
          frozenAt: pending.timestamp,
        },
        params: {
          collateral: BigInt(pending.params.collateral),
          debt: BigInt(pending.params.debt),
          owner: pending.params.owner,
          ownerAddress: '', // Not stored in pending
        },
        vaultId: this.generateVaultId(pending.collateralUtxoId),
      },
      expiresIn,
      matchesParams,
    };
  }

  /**
   * Build a new spell with frozen values
   * This commits the UTXO to this specific spell
   */
  async buildSpell(
    params: SpellParams,
    collateralUtxo: UtxoInfo,
    feeUtxo: UtxoInfo,
    frozenValues?: FrozenValues
  ): Promise<SpellContext> {
    const client = getClient();

    // Get frozen values (use provided or fetch new)
    const values = frozenValues ?? await this.fetchCurrentValues();

    console.log('[SpellService] Building spell with frozen values:', {
      btcPrice: values.btcPrice,
      blockHeight: values.blockHeight,
      collateralUtxo: collateralUtxo.id,
      feeUtxo: feeUtxo.id,
    });

    // Build the spell through SDK
    const spell = await client.vault.buildOpenVaultSpell({
      collateral: params.collateral,
      debt: params.debt,
      owner: params.owner,
      collateralUtxo: collateralUtxo.id,
      ownerAddress: params.ownerAddress,
      ownerPubkey: params.owner,
      currentBlock: values.blockHeight,
      btcPrice: values.btcPrice,
    });

    const spellHash = generateSpellHash(spell);
    const vaultId = this.generateVaultId(collateralUtxo.id);

    // Save as pending spell for potential retry
    savePendingSpell(
      spell,
      collateralUtxo.id,
      feeUtxo.id,
      {
        collateral: params.collateral.toString(),
        debt: params.debt.toString(),
        owner: params.owner,
      },
      { btcPrice: values.btcPrice, blockHeight: values.blockHeight }
    );

    console.log('[SpellService] Spell built successfully:', {
      spellHash,
      vaultId,
    });

    return {
      spell,
      spellHash,
      collateralUtxo,
      feeUtxo,
      frozenValues: values,
      params,
      vaultId,
    };
  }

  /**
   * Get or create a spell context
   * Reuses pending spell if valid, otherwise builds new
   */
  async getOrCreateSpell(
    params: SpellParams,
    collateralUtxo: UtxoInfo,
    feeUtxo: UtxoInfo
  ): Promise<SpellContext> {
    // Check for pending spell
    const pending = this.checkPendingSpell(params);

    if (pending.exists && pending.matchesParams && pending.spellContext) {
      // Verify the UTXOs match
      if (
        pending.spellContext.collateralUtxo.id === collateralUtxo.id &&
        pending.spellContext.feeUtxo.id === feeUtxo.id
      ) {
        console.log('[SpellService] Reusing pending spell');
        return {
          ...pending.spellContext,
          collateralUtxo,
          feeUtxo,
          params,
        };
      }
    }

    // Build new spell
    return this.buildSpell(params, collateralUtxo, feeUtxo);
  }

  /**
   * Clear pending spell (after success or user cancels)
   */
  clearPending(): void {
    clearPendingSpell();
  }

  /**
   * Generate deterministic vault ID from UTXO
   * Must match SDK implementation exactly
   */
  generateVaultId(fundingUtxo: string): string {
    const input = `vault:${fundingUtxo}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const hexPart = Math.abs(hash).toString(16).padStart(16, '0');
    return hexPart.repeat(4);
  }

  /**
   * Validate spell parameters before building
   */
  validateParams(params: SpellParams): { valid: boolean; error?: string } {
    // Check collateral is positive
    if (params.collateral <= 0n) {
      return { valid: false, error: 'Collateral must be positive' };
    }

    // Check debt is positive
    if (params.debt <= 0n) {
      return { valid: false, error: 'Debt must be positive' };
    }

    // Check owner is valid
    if (!params.owner || params.owner.length < 32) {
      return { valid: false, error: 'Invalid owner public key' };
    }

    return { valid: true };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: SpellService | null = null;

export function getSpellService(): SpellService {
  if (!instance) {
    instance = new SpellService();
  }
  return instance;
}

export type { SpellService };
