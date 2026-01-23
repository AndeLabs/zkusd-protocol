/**
 * Spell Cache - Professional UTXO Management for Charms Protocol
 *
 * Problem: The Charms prover caches UTXO → Spell associations.
 * Once a UTXO is used with a spell, it cannot be used with a different spell.
 *
 * Solution: Track spell hashes locally to ensure retry consistency.
 *
 * Key Principles:
 * 1. Same parameters → Same spell hash → Can retry with same UTXO
 * 2. Different parameters → Different spell → Must use different UTXO
 * 3. Pre-validate before sending to prover when possible
 */

// ============================================================================
// Types
// ============================================================================

export interface SpellCacheEntry {
  /** The UTXO ID used for this spell */
  utxoId: string;
  /** Hash of the spell content */
  spellHash: string;
  /** The original spell object (for retries) */
  spell: unknown;
  /** Timestamp when cached */
  timestamp: number;
  /** Status of the prover request */
  status: 'pending' | 'success' | 'failed';
  /** Error message if failed */
  error?: string;
  /** Number of retry attempts */
  retryCount: number;
}

export interface SpellCacheConfig {
  /** How long to keep cache entries (ms). Default: 1 hour */
  ttl: number;
  /** Maximum retry attempts before marking UTXO as "burned" */
  maxRetries: number;
  /** Storage key prefix */
  storagePrefix: string;
}

// ============================================================================
// Spell Hash Generation
// ============================================================================

/**
 * Generate a deterministic hash for a spell.
 * This ensures identical spells produce identical hashes.
 */
export function generateSpellHash(spell: unknown): string {
  // Sort keys and stringify deterministically
  const normalized = JSON.stringify(spell, Object.keys(spell as object).sort());

  // Use simple hash for browser compatibility
  // This is sufficient for local caching purposes
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash1 = ((hash1 << 5) - hash1) + char;
    hash1 = hash1 & hash1;
    hash2 = ((hash2 << 7) - hash2) + char;
    hash2 = hash2 & hash2;
  }
  // Combine two hashes for better distribution
  const part1 = Math.abs(hash1).toString(16).padStart(8, '0');
  const part2 = Math.abs(hash2).toString(16).padStart(8, '0');
  return part1 + part2;
}

// ============================================================================
// Spell Cache Manager
// ============================================================================

const DEFAULT_CONFIG: SpellCacheConfig = {
  ttl: 60 * 60 * 1000, // 1 hour
  maxRetries: 3,
  storagePrefix: 'zkusd_spell_cache_',
};

class SpellCacheManager {
  private config: SpellCacheConfig;
  private memoryCache: Map<string, SpellCacheEntry> = new Map();

  constructor(config: Partial<SpellCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromStorage();
  }

  /**
   * Get the storage key for a UTXO
   */
  private getStorageKey(utxoId: string): string {
    return `${this.config.storagePrefix}${utxoId}`;
  }

  /**
   * Load cache from localStorage (browser) or memory
   */
  private loadFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith(this.config.storagePrefix)
      );

      for (const key of keys) {
        const data = localStorage.getItem(key);
        if (data) {
          const entry: SpellCacheEntry = JSON.parse(data);
          // Check if entry is still valid (not expired)
          if (Date.now() - entry.timestamp < this.config.ttl) {
            this.memoryCache.set(entry.utxoId, entry);
          } else {
            localStorage.removeItem(key);
          }
        }
      }
    } catch (e) {
      console.warn('[SpellCache] Failed to load from storage:', e);
    }
  }

  /**
   * Save entry to storage
   */
  private saveToStorage(entry: SpellCacheEntry): void {
    this.memoryCache.set(entry.utxoId, entry);

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(
          this.getStorageKey(entry.utxoId),
          JSON.stringify(entry)
        );
      } catch (e) {
        console.warn('[SpellCache] Failed to save to storage:', e);
      }
    }
  }

  /**
   * Check if a UTXO can be used with a given spell.
   *
   * Returns:
   * - { canUse: true, cachedSpell: spell } if UTXO was used with same spell (can retry)
   * - { canUse: true } if UTXO is fresh (never used)
   * - { canUse: false, reason: string } if UTXO was used with different spell
   */
  checkUtxoAvailability(utxoId: string, newSpell: unknown): {
    canUse: boolean;
    cachedSpell?: unknown;
    reason?: string;
  } {
    const entry = this.memoryCache.get(utxoId);

    if (!entry) {
      // UTXO never used - it's available
      return { canUse: true };
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.clearEntry(utxoId);
      return { canUse: true };
    }

    // Check if UTXO was explicitly marked as failed/burned
    if (entry.status === 'failed') {
      return {
        canUse: false,
        reason: `UTXO is burned in prover cache. Use a different UTXO.`
      };
    }

    // Check if same spell
    const newHash = generateSpellHash(newSpell);
    if (entry.spellHash === newHash) {
      // Same spell - can retry
      return { canUse: true, cachedSpell: entry.spell };
    }

    // Different spell - cannot use this UTXO
    return {
      canUse: false,
      reason: `UTXO was previously used with a different spell. ` +
              `Use a different UTXO or wait ${Math.ceil((this.config.ttl - (Date.now() - entry.timestamp)) / 60000)} minutes.`
    };
  }

  /**
   * Register a spell attempt with a UTXO
   */
  registerSpellAttempt(utxoId: string, spell: unknown): SpellCacheEntry {
    const existing = this.memoryCache.get(utxoId);

    const entry: SpellCacheEntry = {
      utxoId,
      spellHash: generateSpellHash(spell),
      spell,
      timestamp: existing?.timestamp ?? Date.now(),
      status: 'pending',
      retryCount: (existing?.retryCount ?? 0) + 1,
    };

    this.saveToStorage(entry);
    return entry;
  }

  /**
   * Mark a spell attempt as successful
   */
  markSuccess(utxoId: string): void {
    const entry = this.memoryCache.get(utxoId);
    if (entry) {
      entry.status = 'success';
      this.saveToStorage(entry);
    }
  }

  /**
   * Mark a spell attempt as failed
   */
  markFailed(utxoId: string, error: string): void {
    const entry = this.memoryCache.get(utxoId);
    if (entry) {
      entry.status = 'failed';
      entry.error = error;
      this.saveToStorage(entry);
    }
  }

  /**
   * Get all UTXOs that are "burned" (used with a spell but failed)
   */
  getBurnedUtxos(): string[] {
    const burned: string[] = [];

    for (const [utxoId, entry] of this.memoryCache) {
      if (entry.status === 'failed' &&
          Date.now() - entry.timestamp < this.config.ttl) {
        burned.push(utxoId);
      }
    }

    return burned;
  }

  /**
   * Clear a specific entry
   */
  clearEntry(utxoId: string): void {
    this.memoryCache.delete(utxoId);

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.getStorageKey(utxoId));
    }
  }

  /**
   * Clear all expired entries
   */
  cleanup(): void {
    const now = Date.now();

    for (const [utxoId, entry] of this.memoryCache) {
      if (now - entry.timestamp > this.config.ttl) {
        this.clearEntry(utxoId);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    total: number;
    pending: number;
    success: number;
    failed: number;
    burnedUtxos: string[];
  } {
    let pending = 0, success = 0, failed = 0;
    const burnedUtxos: string[] = [];

    for (const entry of this.memoryCache.values()) {
      if (entry.status === 'pending') pending++;
      else if (entry.status === 'success') success++;
      else if (entry.status === 'failed') {
        failed++;
        burnedUtxos.push(entry.utxoId);
      }
    }

    return {
      total: this.memoryCache.size,
      pending,
      success,
      failed,
      burnedUtxos,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: SpellCacheManager | null = null;

export function getSpellCache(config?: Partial<SpellCacheConfig>): SpellCacheManager {
  if (!instance) {
    instance = new SpellCacheManager(config);
  }
  return instance;
}

// ============================================================================
// Pending Spell Cache (for retry with identical spell)
// ============================================================================

interface PendingSpell {
  spell: unknown;
  collateralUtxoId: string;
  feeUtxoId: string;
  params: {
    collateral: string;
    debt: string;
    owner: string;
  };
  /** Frozen dynamic values - these MUST stay the same on retry */
  frozenValues: {
    btcPrice: number;
    blockHeight: number;
  };
  timestamp: number;
}

const PENDING_SPELL_KEY = 'zkusd_pending_spell';
const PENDING_SPELL_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Save a pending spell for potential retry.
 * This allows users to retry with the EXACT same spell,
 * which the prover will accept even for a "burned" UTXO.
 *
 * CRITICAL: We freeze the dynamic values (price, block) so retries
 * produce identical spell hashes even if time has passed.
 */
export function savePendingSpell(
  spell: unknown,
  collateralUtxoId: string,
  feeUtxoId: string,
  params: { collateral: string; debt: string; owner: string },
  frozenValues: { btcPrice: number; blockHeight: number }
): void {
  const pending: PendingSpell = {
    spell,
    collateralUtxoId,
    feeUtxoId,
    params,
    frozenValues,
    timestamp: Date.now(),
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(PENDING_SPELL_KEY, JSON.stringify(pending));
  }

  console.log('[SpellCache] Saved pending spell with frozen values:', {
    utxo: collateralUtxoId,
    price: frozenValues.btcPrice,
    block: frozenValues.blockHeight,
  });
}

/**
 * Get a pending spell for retry.
 *
 * IMPORTANT: We return the cached spell even if current params differ slightly,
 * because the user might not have changed anything - the UI might have
 * recalculated debt based on new price. The key is using the FROZEN values.
 *
 * @param params - Current params to check similarity
 * @param strict - If true, only return if params match exactly
 */
export function getPendingSpell(
  params?: { collateral: string; debt: string; owner: string },
  strict: boolean = false
): PendingSpell | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const data = localStorage.getItem(PENDING_SPELL_KEY);
    if (!data) return null;

    const pending: PendingSpell = JSON.parse(data);

    // Check if expired (30 min TTL)
    if (Date.now() - pending.timestamp > PENDING_SPELL_TTL) {
      localStorage.removeItem(PENDING_SPELL_KEY);
      console.log('[SpellCache] Pending spell expired, cleared');
      return null;
    }

    // In strict mode, check exact params match
    if (strict && params) {
      if (
        pending.params.collateral !== params.collateral ||
        pending.params.debt !== params.debt ||
        pending.params.owner !== params.owner
      ) {
        console.log('[SpellCache] Params changed, clearing pending spell');
        localStorage.removeItem(PENDING_SPELL_KEY);
        return null;
      }
    }

    // Check if owner matches (different wallet = clear)
    if (params && pending.params.owner !== params.owner) {
      console.log('[SpellCache] Different owner, clearing pending spell');
      localStorage.removeItem(PENDING_SPELL_KEY);
      return null;
    }

    console.log('[SpellCache] Found pending spell:', {
      utxo: pending.collateralUtxoId,
      frozenPrice: pending.frozenValues?.btcPrice,
      frozenBlock: pending.frozenValues?.blockHeight,
      age: Math.round((Date.now() - pending.timestamp) / 1000) + 's',
    });

    return pending;
  } catch (e) {
    console.error('[SpellCache] Error reading pending spell:', e);
    return null;
  }
}

/**
 * Clear pending spell (after success or user cancels)
 */
export function clearPendingSpell(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.removeItem(PENDING_SPELL_KEY);
  }
}

// ============================================================================
// Helper Functions for UTXO Selection
// ============================================================================

export interface UtxoInfo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
}

/**
 * Select the best available UTXO for a new spell.
 *
 * Priority:
 * 1. Unconfirmed UTXOs (freshest, least likely to be in prover cache)
 * 2. UTXOs not in our local cache
 * 3. UTXOs with matching spell hash (can retry)
 * 4. Largest value first
 */
export function selectBestUtxo(
  availableUtxos: UtxoInfo[],
  spell: unknown,
  minValue: number
): { utxo: UtxoInfo; reason: string } | { utxo: null; reason: string } {
  const cache = getSpellCache();
  const spellHash = generateSpellHash(spell);

  // Filter by minimum value
  const eligible = availableUtxos.filter(u => u.value >= minValue);

  if (eligible.length === 0) {
    return {
      utxo: null,
      reason: `No UTXOs with sufficient value (need ${minValue} sats)`
    };
  }

  // Categorize UTXOs
  const categories = {
    fresh: [] as UtxoInfo[],           // Not in cache at all
    sameSpell: [] as UtxoInfo[],       // In cache with same spell (can retry)
    burned: [] as UtxoInfo[],          // In cache with different spell
    unconfirmed: [] as UtxoInfo[],     // Unconfirmed (prefer these)
  };

  for (const utxo of eligible) {
    const utxoId = `${utxo.txid}:${utxo.vout}`;
    const availability = cache.checkUtxoAvailability(utxoId, spell);

    if (!utxo.confirmed) {
      categories.unconfirmed.push(utxo);
    }

    if (availability.canUse) {
      if (availability.cachedSpell) {
        categories.sameSpell.push(utxo);
      } else {
        categories.fresh.push(utxo);
      }
    } else {
      categories.burned.push(utxo);
    }
  }

  // Sort each category by value (descending)
  const sortByValue = (a: UtxoInfo, b: UtxoInfo) => b.value - a.value;
  categories.unconfirmed.sort(sortByValue);
  categories.fresh.sort(sortByValue);
  categories.sameSpell.sort(sortByValue);

  // Priority selection
  if (categories.unconfirmed.length > 0) {
    // Check if unconfirmed is also fresh
    const freshUnconfirmed = categories.unconfirmed.find(u =>
      categories.fresh.some(f => f.txid === u.txid && f.vout === u.vout)
    );
    if (freshUnconfirmed) {
      return {
        utxo: freshUnconfirmed,
        reason: 'Fresh unconfirmed UTXO (best choice)'
      };
    }
  }

  if (categories.fresh.length > 0) {
    return {
      utxo: categories.fresh[0],
      reason: 'Fresh UTXO not in prover cache'
    };
  }

  if (categories.sameSpell.length > 0) {
    return {
      utxo: categories.sameSpell[0],
      reason: 'UTXO with matching spell (retry)'
    };
  }

  // All UTXOs are burned
  return {
    utxo: null,
    reason: `All ${eligible.length} eligible UTXOs are reserved for different spells. ` +
            `Get new BTC or wait for cache to expire.`
  };
}
