/**
 * UTXO Service - Professional UTXO Management for zkUSD
 *
 * Responsibilities:
 * - Fetch and categorize UTXOs from the blockchain
 * - Track burned/reserved UTXOs in local cache
 * - Select optimal UTXO for vault operations
 * - Provide clear availability status with expiry times
 *
 * Key Principle: NO UTXO ROTATION
 * Once a UTXO is selected for a vault, it's committed. If the prover
 * fails, the user must wait for cache expiry or use different BTC.
 */

import { getClient } from '@/lib/sdk';
import { getSpellCache } from '@/lib/spell-cache';

// ============================================================================
// Types
// ============================================================================

export interface UtxoInfo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  /** UTXO identifier in format "txid:vout" */
  id: string;
}

export interface UtxoAvailability {
  status: 'available' | 'reserved' | 'burned';
  /** When this UTXO will become available again (timestamp) */
  availableAt?: number;
  /** Human-readable reason */
  reason?: string;
}

export interface UtxoSelectionResult {
  /** The selected UTXO, or null if none available */
  utxo: UtxoInfo | null;
  /** Status of the selection */
  status: 'ready' | 'insufficient_funds' | 'all_reserved' | 'no_utxos';
  /** Human-readable message */
  message: string;
  /** When the next UTXO will become available (for "all_reserved" status) */
  nextAvailableAt?: number;
  /** All available UTXOs (for debugging/display) */
  availableUtxos: UtxoInfo[];
  /** All reserved UTXOs (for display) */
  reservedUtxos: Array<UtxoInfo & { availableAt: number }>;
}

export interface UtxoPairResult {
  /** Selected collateral UTXO */
  collateralUtxo: UtxoInfo | null;
  /** Selected fee UTXO */
  feeUtxo: UtxoInfo | null;
  /** Overall status */
  status: 'ready' | 'need_split' | 'insufficient_funds' | 'all_reserved' | 'no_utxos';
  /** Human-readable message */
  message: string;
  /** When UTXOs will become available */
  nextAvailableAt?: number;
}

// Cache TTL matches prover cache (1 hour)
const PROVER_CACHE_TTL_MS = 60 * 60 * 1000;

// ============================================================================
// UTXO Service Class
// ============================================================================

class UtxoService {
  /**
   * Fetch all UTXOs for an address from the blockchain
   */
  async fetchUtxos(address: string): Promise<UtxoInfo[]> {
    const client = getClient();
    const rawUtxos = await client.getAddressUtxos(address);

    return rawUtxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      confirmed: u.status?.confirmed ?? false,
      id: `${u.txid}:${u.vout}`,
    }));
  }

  /**
   * Check if a specific UTXO is available for use
   */
  checkAvailability(utxoId: string): UtxoAvailability {
    const spellCache = getSpellCache();
    const availability = spellCache.checkUtxoAvailability(utxoId, {});

    if (availability.canUse) {
      return { status: 'available' };
    }

    // Get cache entry to determine expiry time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheEntry = (spellCache as any).memoryCache?.get(utxoId);
    const cachedAt = cacheEntry?.timestamp ?? Date.now();
    const availableAt = cachedAt + PROVER_CACHE_TTL_MS;

    const status = cacheEntry?.status === 'failed' ? 'burned' : 'reserved';

    return {
      status,
      availableAt,
      reason: availability.reason,
    };
  }

  /**
   * Get categorized UTXOs for an address
   */
  async getCategorizedUtxos(address: string): Promise<{
    available: UtxoInfo[];
    reserved: Array<UtxoInfo & { availableAt: number }>;
    total: number;
    totalAvailableValue: number;
  }> {
    const allUtxos = await this.fetchUtxos(address);
    const available: UtxoInfo[] = [];
    const reserved: Array<UtxoInfo & { availableAt: number }> = [];

    for (const utxo of allUtxos) {
      const availability = this.checkAvailability(utxo.id);

      if (availability.status === 'available') {
        available.push(utxo);
      } else {
        reserved.push({
          ...utxo,
          availableAt: availability.availableAt ?? Date.now() + PROVER_CACHE_TTL_MS,
        });
      }
    }

    // Sort available by value descending
    available.sort((a, b) => b.value - a.value);

    // Sort reserved by availableAt ascending (soonest first)
    reserved.sort((a, b) => a.availableAt - b.availableAt);

    return {
      available,
      reserved,
      total: allUtxos.length,
      totalAvailableValue: available.reduce((sum, u) => sum + u.value, 0),
    };
  }

  /**
   * Select the best single UTXO for a given amount
   */
  async selectUtxo(
    address: string,
    minValue: number
  ): Promise<UtxoSelectionResult> {
    const { available, reserved, total } = await this.getCategorizedUtxos(address);

    // No UTXOs at all
    if (total === 0) {
      return {
        utxo: null,
        status: 'no_utxos',
        message: 'No UTXOs found. Please fund your wallet first.',
        availableUtxos: [],
        reservedUtxos: reserved,
      };
    }

    // Filter available UTXOs by minimum value
    const eligible = available.filter((u) => u.value >= minValue);

    // Found a suitable UTXO
    if (eligible.length > 0) {
      // Prefer confirmed UTXOs, then by value (smallest that fits)
      const sorted = [...eligible].sort((a, b) => {
        // Prefer confirmed
        if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
        // Then prefer smallest that fits (minimize change)
        return a.value - b.value;
      });

      return {
        utxo: sorted[0],
        status: 'ready',
        message: `Selected UTXO with ${(sorted[0].value / 1e8).toFixed(6)} BTC`,
        availableUtxos: available,
        reservedUtxos: reserved,
      };
    }

    // Check if we have available UTXOs but they're too small
    if (available.length > 0) {
      const largestAvailable = available[0].value;
      return {
        utxo: null,
        status: 'insufficient_funds',
        message: `Largest available UTXO is ${(largestAvailable / 1e8).toFixed(6)} BTC, ` +
                 `but you need ${(minValue / 1e8).toFixed(6)} BTC.`,
        availableUtxos: available,
        reservedUtxos: reserved,
      };
    }

    // All UTXOs are reserved
    const nextAvailableAt = reserved.length > 0 ? reserved[0].availableAt : undefined;
    const waitTime = nextAvailableAt
      ? Math.ceil((nextAvailableAt - Date.now()) / 60000)
      : 60;

    return {
      utxo: null,
      status: 'all_reserved',
      message: `All your UTXOs are temporarily reserved. ` +
               `The first one will be available in ~${waitTime} minutes.`,
      nextAvailableAt,
      availableUtxos: [],
      reservedUtxos: reserved,
    };
  }

  /**
   * Select a pair of UTXOs for vault creation (collateral + fee)
   */
  async selectUtxoPair(
    address: string,
    collateralAmount: number,
    feeBuffer: number
  ): Promise<UtxoPairResult> {
    const { available, reserved, total } = await this.getCategorizedUtxos(address);

    // No UTXOs at all
    if (total === 0) {
      return {
        collateralUtxo: null,
        feeUtxo: null,
        status: 'no_utxos',
        message: 'No UTXOs found. Please fund your wallet first.',
      };
    }

    // All reserved
    if (available.length === 0) {
      const nextAvailableAt = reserved.length > 0 ? reserved[0].availableAt : undefined;
      const waitTime = nextAvailableAt
        ? Math.ceil((nextAvailableAt - Date.now()) / 60000)
        : 60;

      return {
        collateralUtxo: null,
        feeUtxo: null,
        status: 'all_reserved',
        message: `All UTXOs are reserved. Available in ~${waitTime} minutes.`,
        nextAvailableAt,
      };
    }

    // Try to find two separate UTXOs
    const sortedAvailable = [...available].sort((a, b) => b.value - a.value);

    // Find collateral UTXO (must cover collateral amount)
    const collateralUtxo = sortedAvailable.find((u) => u.value >= collateralAmount);

    // Find fee UTXO (different from collateral, must cover fees)
    const feeUtxo = sortedAvailable.find(
      (u) => u.value >= feeBuffer && u.id !== collateralUtxo?.id
    );

    // Have both - perfect
    if (collateralUtxo && feeUtxo) {
      return {
        collateralUtxo,
        feeUtxo,
        status: 'ready',
        message: 'UTXOs selected successfully.',
      };
    }

    // Check if a single large UTXO could cover both
    const totalRequired = collateralAmount + feeBuffer;
    const largeUtxo = sortedAvailable.find((u) => u.value >= totalRequired);

    if (largeUtxo && sortedAvailable.length === 1) {
      // Only have one UTXO that's large enough - need to split
      return {
        collateralUtxo: null,
        feeUtxo: null,
        status: 'need_split',
        message: `You have one large UTXO. Split it to have separate UTXOs for collateral and fees.`,
      };
    }

    if (largeUtxo && sortedAvailable.length >= 2) {
      // Have multiple UTXOs, use largest for collateral, second for fee
      const secondUtxo = sortedAvailable.find((u) => u.id !== largeUtxo.id);
      if (secondUtxo && secondUtxo.value >= feeBuffer) {
        return {
          collateralUtxo: largeUtxo,
          feeUtxo: secondUtxo,
          status: 'ready',
          message: 'UTXOs selected successfully.',
        };
      }
    }

    // Insufficient funds
    const totalAvailable = sortedAvailable.reduce((sum, u) => sum + u.value, 0);
    return {
      collateralUtxo: null,
      feeUtxo: null,
      status: 'insufficient_funds',
      message: `Insufficient funds. You have ${(totalAvailable / 1e8).toFixed(6)} BTC ` +
               `but need ${(totalRequired / 1e8).toFixed(6)} BTC.`,
    };
  }

  /**
   * Mark a UTXO as used/reserved in local cache
   * Called BEFORE sending to prover to prevent re-selection
   */
  reserveUtxo(utxoId: string, spell: unknown): void {
    const spellCache = getSpellCache();
    spellCache.registerSpellAttempt(utxoId, spell);
  }

  /**
   * Mark a UTXO operation as successful
   */
  markSuccess(utxoId: string): void {
    const spellCache = getSpellCache();
    spellCache.markSuccess(utxoId);
  }

  /**
   * Mark a UTXO as burned (prover rejected it)
   */
  markBurned(utxoId: string, error: string): void {
    const spellCache = getSpellCache();
    spellCache.markFailed(utxoId, error);
  }

  /**
   * Get time remaining until a UTXO becomes available
   */
  getTimeUntilAvailable(utxoId: string): number | null {
    const availability = this.checkAvailability(utxoId);
    if (availability.status === 'available') return 0;
    if (!availability.availableAt) return null;

    const remaining = availability.availableAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Format time remaining as human-readable string
   */
  formatTimeRemaining(ms: number): string {
    if (ms <= 0) return 'Available now';

    const minutes = Math.ceil(ms / 60000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
    return `${minutes}m`;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: UtxoService | null = null;

export function getUtxoService(): UtxoService {
  if (!instance) {
    instance = new UtxoService();
  }
  return instance;
}

// Export types for external use
export type { UtxoService };
