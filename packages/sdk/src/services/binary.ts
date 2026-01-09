// Binary Service - Load and manage app binaries for Charms prover
//
// The Charms prover requires app binaries to prove spells.
// Binaries are keyed by VK (verification key) and base64 encoded.

export interface BinaryConfig {
  /** VK (verification key) of the app */
  vk: string;
  /** URL to fetch the binary from */
  url: string;
  /** App name for logging */
  name: string;
}

export interface BinaryCache {
  [vk: string]: string; // VK -> base64 encoded binary
}

/**
 * Service for loading and caching app binaries
 */
export class BinaryService {
  private cache: BinaryCache = {};
  private loadingPromises: Map<string, Promise<string>> = new Map();

  /**
   * Load a binary from URL and cache it
   */
  async loadBinary(config: BinaryConfig): Promise<string> {
    // Return from cache if available
    if (this.cache[config.vk]) {
      console.log(`[BinaryService] Cache hit for ${config.name}`);
      return this.cache[config.vk];
    }

    // If already loading, wait for the existing promise
    const existingPromise = this.loadingPromises.get(config.vk);
    if (existingPromise) {
      console.log(`[BinaryService] Waiting for existing load of ${config.name}`);
      return existingPromise;
    }

    // Start loading
    console.log(`[BinaryService] Loading binary for ${config.name} from ${config.url}`);

    const loadPromise = this.fetchAndEncode(config);
    this.loadingPromises.set(config.vk, loadPromise);

    try {
      const base64 = await loadPromise;
      this.cache[config.vk] = base64;
      console.log(`[BinaryService] Loaded ${config.name}: ${base64.length} bytes (base64)`);
      return base64;
    } finally {
      this.loadingPromises.delete(config.vk);
    }
  }

  /**
   * Load multiple binaries in parallel
   */
  async loadBinaries(configs: BinaryConfig[]): Promise<BinaryCache> {
    await Promise.all(configs.map(config => this.loadBinary(config)));

    // Return only the requested binaries
    const result: BinaryCache = {};
    for (const config of configs) {
      if (this.cache[config.vk]) {
        result[config.vk] = this.cache[config.vk];
      }
    }
    return result;
  }

  /**
   * Get cached binary by VK
   */
  getCached(vk: string): string | undefined {
    return this.cache[vk];
  }

  /**
   * Check if binary is cached
   */
  isCached(vk: string): boolean {
    return vk in this.cache;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache = {};
  }

  /**
   * Fetch binary and encode as base64
   */
  private async fetchAndEncode(config: BinaryConfig): Promise<string> {
    try {
      const response = await fetch(config.url);

      if (!response.ok) {
        throw new Error(`Failed to fetch binary: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Convert to base64
      const base64 = this.uint8ArrayToBase64(bytes);

      return base64;
    } catch (error) {
      console.error(`[BinaryService] Failed to load ${config.name}:`, error);
      throw new Error(`Failed to load app binary for ${config.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    // Use btoa for browser, Buffer for Node.js
    if (typeof btoa !== 'undefined') {
      // Browser environment
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    } else if (typeof Buffer !== 'undefined') {
      // Node.js environment
      return Buffer.from(bytes).toString('base64');
    } else {
      throw new Error('No base64 encoding method available');
    }
  }
}

// Singleton instance
let binaryServiceInstance: BinaryService | null = null;

export function getBinaryService(): BinaryService {
  if (!binaryServiceInstance) {
    binaryServiceInstance = new BinaryService();
  }
  return binaryServiceInstance;
}
