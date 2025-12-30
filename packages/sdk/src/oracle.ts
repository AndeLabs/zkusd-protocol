// Oracle Service - Get BTC/USD price from zkUSD oracle

import type { OraclePrice } from '@zkusd/types';
import type { ZkUsdClient } from './client';

/**
 * Service for interacting with the price oracle
 */
export class OracleService {
  private cachedPrice: OraclePrice | null = null;
  private cacheExpiry = 0;
  private cacheDuration = 60_000; // 1 minute cache

  constructor(private client: ZkUsdClient) {}

  /**
   * Get current BTC/USD price from oracle
   * Fetches real-time price from external APIs with multiple fallbacks
   */
  async getPrice(): Promise<OraclePrice> {
    // Return cached price if valid
    if (this.cachedPrice && Date.now() < this.cacheExpiry) {
      return this.cachedPrice;
    }

    // Try to fetch real price from external APIs
    const priceData = await this.fetchExternalPrice();

    if (priceData) {
      const oraclePrice: OraclePrice = {
        price: priceData.price,
        timestamp: Math.floor(Date.now() / 1000),
        source: priceData.source,
      };

      this.cachedPrice = oraclePrice;
      this.cacheExpiry = Date.now() + this.cacheDuration;

      return oraclePrice;
    }

    // If all APIs fail but we have cached data, return it (marked stale)
    if (this.cachedPrice) {
      return this.cachedPrice;
    }

    // Last resort: throw error if no price available
    throw new Error('Unable to fetch BTC price from any source');
  }

  /**
   * Fetch real BTC price from external APIs
   */
  private async fetchExternalPrice(): Promise<{ price: bigint; source: 'coingecko' | 'coinbase' | 'kraken' } | null> {
    // Primary: CoinGecko API
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
      );

      if (response.ok) {
        const data = await response.json() as { bitcoin?: { usd?: number } };
        const priceUsd = data.bitcoin?.usd;

        if (typeof priceUsd === 'number' && priceUsd > 0) {
          const price = BigInt(Math.floor(priceUsd * 100_000_000));
          return { price, source: 'coingecko' };
        }
      }
    } catch {
      // Continue to fallback
    }

    // Fallback: Coinbase API
    try {
      const response = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');

      if (response.ok) {
        const data = await response.json() as { data?: { amount?: string } };
        const priceUsd = parseFloat(data.data?.amount ?? '');

        if (!isNaN(priceUsd) && priceUsd > 0) {
          const price = BigInt(Math.floor(priceUsd * 100_000_000));
          return { price, source: 'coinbase' };
        }
      }
    } catch {
      // Continue to fallback
    }

    // Second fallback: Kraken API
    try {
      const response = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');

      if (response.ok) {
        const data = await response.json() as { result?: { XXBTZUSD?: { c?: string[] } } };
        const priceStr = data.result?.XXBTZUSD?.c?.[0];
        const priceUsd = parseFloat(priceStr ?? '');

        if (!isNaN(priceUsd) && priceUsd > 0) {
          const price = BigInt(Math.floor(priceUsd * 100_000_000));
          return { price, source: 'kraken' };
        }
      }
    } catch {
      // All APIs failed
    }

    return null;
  }

  /**
   * Get price in USD (as number for display)
   */
  async getPriceUsd(): Promise<number> {
    const price = await this.getPrice();
    return Number(price.price) / 100_000_000;
  }

  /**
   * Check if price is stale (older than threshold)
   */
  async isPriceStale(maxAgeSeconds = 3600): Promise<boolean> {
    const price = await this.getPrice();
    const age = Math.floor(Date.now() / 1000) - price.timestamp;
    return age > maxAgeSeconds;
  }

  /**
   * Build spell to update oracle price (admin only)
   */
  async buildUpdatePriceSpell(newPrice: bigint): Promise<string> {
    // TODO: Generate YAML spell for price update
    throw new Error('Not implemented - build update price spell');
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.cachedPrice = null;
    this.cacheExpiry = 0;
  }
}
