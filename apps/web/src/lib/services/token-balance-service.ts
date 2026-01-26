/**
 * Token Balance Service - Track zkUSD token balances locally
 *
 * Responsibilities:
 * - Record new token balances from mint/transfer operations
 * - Query balances by address
 * - Mark balances as spent (transfer/repay)
 *
 * Note: Full balance tracking requires a Charms indexer.
 * This service provides local tracking for operations performed
 * in this browser session.
 */

import type { TrackedTokenBalance } from '@zkusd/types';

// ============================================================================
// Types
// ============================================================================

export interface RecordMintParams {
  address: string;
  amount: bigint;
  txId: string;
  voutIndex: number;
}

// ============================================================================
// Service
// ============================================================================

class TokenBalanceService {
  private balances: Map<string, TrackedTokenBalance> = new Map();

  /**
   * Record a new token balance from a mint operation
   */
  recordMint(params: RecordMintParams): TrackedTokenBalance {
    const utxo = `${params.txId}:${params.voutIndex}`;
    const balance: TrackedTokenBalance = {
      address: params.address,
      amount: params.amount,
      utxo,
      sourceTxId: params.txId,
      sourceOperation: 'mint',
      updatedAt: Date.now(),
    };

    this.balances.set(utxo, balance);

    console.log('[TokenBalanceService] Recorded mint:', {
      address: `${params.address.slice(0, 8)}...`,
      amount: params.amount.toString(),
      utxo,
    });

    return balance;
  }

  /**
   * Get all balances for an address
   */
  getBalances(address: string): TrackedTokenBalance[] {
    return Array.from(this.balances.values()).filter((b) => b.address === address);
  }

  /**
   * Get total balance for an address
   */
  getTotalBalance(address: string): bigint {
    return this.getBalances(address).reduce((sum, b) => sum + b.amount, 0n);
  }

  /**
   * Mark a balance as spent (used in transfer/repay)
   */
  markSpent(utxo: string): void {
    if (this.balances.has(utxo)) {
      this.balances.delete(utxo);
      console.log('[TokenBalanceService] Marked spent:', utxo);
    }
  }

  /**
   * Load balances from persisted store (called on init)
   */
  loadFromStore(balances: TrackedTokenBalance[]): void {
    this.balances.clear();
    for (const balance of balances) {
      this.balances.set(balance.utxo, balance);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: TokenBalanceService | null = null;

export function getTokenBalanceService(): TokenBalanceService {
  if (!instance) {
    instance = new TokenBalanceService();
  }
  return instance;
}

export type { TokenBalanceService };
