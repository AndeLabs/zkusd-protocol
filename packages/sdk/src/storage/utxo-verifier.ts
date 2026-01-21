/**
 * UTXO Verification Service
 *
 * Verifies that tracked vault UTXOs are still unspent on-chain.
 * This follows Charms' client-side validation approach where
 * users verify their own state without relying on indexers.
 *
 * @see https://docs.charms.dev/concepts/why/
 */

import type { ZkUsdClient } from '../client';
import type { TrackedVault } from './vault-storage';

export interface VerificationResult {
  /** Is the UTXO still unspent? */
  isValid: boolean;
  /** If spent, the transaction that spent it */
  spendingTxId?: string;
  /** Current block height */
  currentBlock: number;
  /** Error message if verification failed */
  error?: string;
}

export interface BatchVerificationResult {
  results: Map<string, VerificationResult>;
  validCount: number;
  invalidCount: number;
  errorCount: number;
}

/**
 * Service for verifying vault UTXO validity
 */
export class UtxoVerifier {
  constructor(private client: ZkUsdClient) {}

  /**
   * Verify a single vault UTXO
   */
  async verifyVault(vault: TrackedVault): Promise<VerificationResult> {
    try {
      const [txid, voutStr] = vault.utxo.split(':');
      const vout = parseInt(voutStr, 10);

      if (!txid || isNaN(vout)) {
        return {
          isValid: false,
          currentBlock: 0,
          error: `Invalid UTXO format: ${vault.utxo}`,
        };
      }

      const currentBlock = await this.client.getBlockHeight();

      // Check if UTXO exists and is unspent
      const utxo = await this.client.getUtxo(txid, vout);

      if (!utxo) {
        // UTXO not found - might be spent or invalid
        // Try to find spending transaction
        const spendingTxId = await this.findSpendingTransaction(txid, vout);

        return {
          isValid: false,
          spendingTxId,
          currentBlock,
          error: spendingTxId ? 'UTXO was spent' : 'UTXO not found',
        };
      }

      if (utxo.spent) {
        return {
          isValid: false,
          currentBlock,
          error: 'UTXO was spent',
        };
      }

      // UTXO is valid and unspent
      return {
        isValid: true,
        currentBlock,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        isValid: false,
        currentBlock: 0,
        error: `Verification failed: ${message}`,
      };
    }
  }

  /**
   * Verify multiple vaults in batch
   */
  async verifyVaults(vaults: TrackedVault[]): Promise<BatchVerificationResult> {
    const results = new Map<string, VerificationResult>();
    let validCount = 0;
    let invalidCount = 0;
    let errorCount = 0;

    // Verify in parallel with concurrency limit
    const CONCURRENCY = 5;
    const chunks = this.chunkArray(vaults, CONCURRENCY);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk.map((vault) => this.verifyVault(vault)));

      chunk.forEach((vault, index) => {
        const result = chunkResults[index];
        results.set(vault.id, result);

        if (result.error && !result.spendingTxId) {
          errorCount++;
        } else if (result.isValid) {
          validCount++;
        } else {
          invalidCount++;
        }
      });
    }

    return {
      results,
      validCount,
      invalidCount,
      errorCount,
    };
  }

  /**
   * Find the transaction that spent a UTXO
   */
  private async findSpendingTransaction(txid: string, vout: number): Promise<string | undefined> {
    try {
      // Get the original transaction to find its outputs
      const tx = await this.client.bitcoin.getTransaction(txid);
      if (!tx || !tx.vout || !tx.vout[vout]) {
        return undefined;
      }

      // Mempool.space API doesn't directly provide spend info in the transaction
      // We would need to use the outspend endpoint
      // For now, return undefined and let the caller handle it
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if a vault was updated (spent and recreated)
   * Returns the new UTXO if found
   */
  async findUpdatedVault(vault: TrackedVault): Promise<{ newUtxo: string; updates: Partial<TrackedVault> } | null> {
    const result = await this.verifyVault(vault);

    if (result.isValid) {
      // Vault is still at the same UTXO
      return null;
    }

    if (!result.spendingTxId) {
      // Can't find spending tx, vault might be lost
      return null;
    }

    try {
      // Get the spending transaction
      const spendingTx = await this.client.bitcoin.getTransaction(result.spendingTxId);
      if (!spendingTx || !spendingTx.vout) {
        return null;
      }

      // Look for output that belongs to the same owner
      // In Charms, the vault NFT would be in one of the outputs
      // For now, assume output 0 is the new vault UTXO
      // TODO: Parse Charms state to verify this is actually the vault

      const newUtxo = `${result.spendingTxId}:0`;

      // We can't know the new state without parsing Charms data
      // Return the new UTXO so the UI can prompt user to verify
      return {
        newUtxo,
        updates: {
          lastUpdated: result.currentBlock,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Split array into chunks for parallel processing
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Create UTXO verifier instance
 */
export function createUtxoVerifier(client: ZkUsdClient): UtxoVerifier {
  return new UtxoVerifier(client);
}
