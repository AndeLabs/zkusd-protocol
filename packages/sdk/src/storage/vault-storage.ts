/**
 * Vault Storage Service
 *
 * Following Charms best practices: client-side state management
 * with on-chain UTXOs as source of truth.
 *
 * @see https://docs.charms.dev/concepts/why/
 */

// Storage keys
const STORAGE_KEY = 'zkusd:vaults';
const STORAGE_VERSION = 1;

/**
 * Tracked vault with UTXO reference
 */
export interface TrackedVault {
  /** Unique vault ID (deterministic from genesis UTXO) */
  id: string;
  /** Vault owner address */
  owner: string;
  /** Current UTXO holding the vault (txid:vout) */
  utxo: string;
  /** Collateral in satoshis */
  collateral: bigint;
  /** Debt in zkUSD (8 decimals) */
  debt: bigint;
  /** Vault status */
  status: 'active' | 'closed' | 'liquidated';
  /** Block when created */
  createdAt: number;
  /** Block when last updated on-chain */
  lastUpdated: number;
  /** Interest rate in basis points */
  interestRateBps: number;
  /** Accrued interest */
  accruedInterest: bigint;
  /** Redistributed debt from liquidations */
  redistributedDebt: bigint;
  /** Redistributed collateral from liquidations */
  redistributedCollateral: bigint;
  /** Insurance balance */
  insuranceBalance: bigint;
  /** Block height when last verified */
  lastVerifiedBlock?: number;
  /** Pending transaction ID (if vault is being updated) */
  pendingTxId?: string;
  /** Timestamp of last local update */
  localUpdatedAt: number;
}

export interface VaultStorageData {
  version: number;
  vaults: Record<string, TrackedVault>;
  lastSyncBlock: number;
}

// Fields that need bigint conversion
const BIGINT_FIELDS: (keyof TrackedVault)[] = [
  'collateral',
  'debt',
  'accruedInterest',
  'redistributedDebt',
  'redistributedCollateral',
  'insuranceBalance',
];

/**
 * Check if running in browser
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/**
 * Vault storage using localStorage with future IndexedDB migration path
 */
export class VaultStorage {
  private data: VaultStorageData;
  private ownerAddress: string;

  constructor(ownerAddress: string) {
    this.ownerAddress = ownerAddress;
    this.data = this.load();
  }

  /**
   * Load vaults from storage
   */
  private load(): VaultStorageData {
    if (!isBrowser()) {
      return this.createEmpty();
    }

    try {
      const key = `${STORAGE_KEY}:${this.ownerAddress}`;
      const raw = localStorage.getItem(key);

      if (!raw) {
        return this.createEmpty();
      }

      const parsed = JSON.parse(raw) as VaultStorageData;

      // Version migration if needed
      if (parsed.version !== STORAGE_VERSION) {
        return this.migrate(parsed);
      }

      // Convert bigint fields from strings
      for (const vault of Object.values(parsed.vaults)) {
        for (const field of BIGINT_FIELDS) {
          const value = vault[field];
          if (typeof value === 'string' || typeof value === 'number') {
            // Use type assertion through unknown for safe conversion
            (vault as unknown as Record<string, unknown>)[field] = BigInt(value);
          }
        }
      }

      return parsed;
    } catch (error) {
      console.error('[VaultStorage] Failed to load:', error);
      return this.createEmpty();
    }
  }

  /**
   * Save vaults to storage
   */
  private save(): void {
    if (!isBrowser()) return;

    try {
      const key = `${STORAGE_KEY}:${this.ownerAddress}`;

      // Convert bigints to strings for JSON serialization
      const serializedVaults: Record<string, unknown> = {};
      for (const [id, vault] of Object.entries(this.data.vaults)) {
        const serializedVault: Record<string, unknown> = { ...vault };
        for (const field of BIGINT_FIELDS) {
          const value = vault[field];
          if (typeof value === 'bigint') {
            serializedVault[field] = value.toString();
          }
        }
        serializedVaults[id] = serializedVault;
      }

      const serializable = {
        version: this.data.version,
        vaults: serializedVaults,
        lastSyncBlock: this.data.lastSyncBlock,
      };

      localStorage.setItem(key, JSON.stringify(serializable));
    } catch (error) {
      console.error('[VaultStorage] Failed to save:', error);
    }
  }

  /**
   * Create empty storage structure
   */
  private createEmpty(): VaultStorageData {
    return {
      version: STORAGE_VERSION,
      vaults: {},
      lastSyncBlock: 0,
    };
  }

  /**
   * Migrate from older storage version
   */
  private migrate(old: VaultStorageData): VaultStorageData {
    console.log(`[VaultStorage] Migrating from version ${old.version} to ${STORAGE_VERSION}`);
    // Future migrations would go here
    return {
      ...old,
      version: STORAGE_VERSION,
    };
  }

  /**
   * Get all tracked vaults
   */
  getAllVaults(): TrackedVault[] {
    return Object.values(this.data.vaults);
  }

  /**
   * Get vault by ID
   */
  getVault(id: string): TrackedVault | null {
    return this.data.vaults[id] || null;
  }

  /**
   * Get vault by UTXO
   */
  getVaultByUtxo(utxo: string): TrackedVault | null {
    return Object.values(this.data.vaults).find((v) => v.utxo === utxo) || null;
  }

  /**
   * Save or update a vault
   */
  saveVault(vault: TrackedVault): void {
    this.data.vaults[vault.id] = {
      ...vault,
      localUpdatedAt: Date.now(),
    };
    this.save();
  }

  /**
   * Update vault UTXO after transaction
   */
  updateVaultUtxo(id: string, newUtxo: string, updates?: Partial<TrackedVault>): void {
    const vault = this.data.vaults[id];
    if (!vault) {
      console.warn(`[VaultStorage] Vault ${id} not found`);
      return;
    }

    this.data.vaults[id] = {
      ...vault,
      ...updates,
      utxo: newUtxo,
      pendingTxId: undefined, // Clear pending
      localUpdatedAt: Date.now(),
    };
    this.save();
  }

  /**
   * Mark vault as having pending transaction
   */
  markPending(id: string, txId: string): void {
    const vault = this.data.vaults[id];
    if (vault) {
      vault.pendingTxId = txId;
      vault.localUpdatedAt = Date.now();
      this.save();
    }
  }

  /**
   * Remove vault (after closing)
   */
  removeVault(id: string): void {
    delete this.data.vaults[id];
    this.save();
  }

  /**
   * Update last sync block
   */
  setLastSyncBlock(block: number): void {
    this.data.lastSyncBlock = block;
    this.save();
  }

  /**
   * Get last sync block
   */
  getLastSyncBlock(): number {
    return this.data.lastSyncBlock;
  }

  /**
   * Clear all vaults (for testing/reset)
   */
  clear(): void {
    this.data = this.createEmpty();
    this.save();
  }

  /**
   * Export vaults for backup
   */
  export(): string {
    return JSON.stringify(this.data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  }

  /**
   * Import vaults from backup
   */
  import(json: string): void {
    try {
      const imported = JSON.parse(json) as VaultStorageData;
      this.data = this.migrate(imported);
      this.save();
    } catch (error) {
      throw new Error(`Failed to import vault data: ${error}`);
    }
  }
}

/**
 * Create vault storage instance for an owner
 */
export function createVaultStorage(ownerAddress: string): VaultStorage {
  return new VaultStorage(ownerAddress);
}
