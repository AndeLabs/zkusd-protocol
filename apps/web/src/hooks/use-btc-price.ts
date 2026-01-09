'use client';

import { useState, useEffect, useCallback } from 'react';
import { CACHE_TTL, REFRESH_INTERVALS } from '@/config';

interface PriceData {
  price: bigint; // Price in satoshis per zkUSD (8 decimals)
  priceUsd: number; // Price in USD
  timestamp: number;
  source: 'oracle' | 'coingecko' | 'cached';
}

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
const CACHE_KEY = 'zkusd_btc_price';

/**
 * Hook for fetching and caching BTC price
 * Consolidates price fetching logic used across the app
 */
export function useBtcPrice() {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrice = useCallback(async () => {
    try {
      // Check cache first
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL.PRICE) {
          setPriceData({ ...data, source: 'cached' as const });
          setIsLoading(false);
          return data;
        }
      }

      // Fetch from CoinGecko
      const response = await fetch(COINGECKO_API);
      if (!response.ok) {
        throw new Error('Failed to fetch price');
      }

      const json = await response.json();
      const usdPrice = json.bitcoin?.usd;

      if (!usdPrice) {
        throw new Error('Invalid price response');
      }

      // Convert to protocol format (satoshis per zkUSD = 1 BTC in sats / price in USD)
      const priceInSats = BigInt(Math.round((100_000_000 / usdPrice) * 100_000_000));

      const data: PriceData = {
        price: priceInSats,
        priceUsd: usdPrice,
        timestamp: Date.now(),
        source: 'coingecko',
      };

      // Cache the result
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now(),
      }));

      setPriceData(data);
      setError(null);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch price';
      setError(message);
      console.error('[useBtcPrice]', message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchPrice();
  }, [fetchPrice]);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(fetchPrice, REFRESH_INTERVALS.PROTOCOL_STATE);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  return {
    price: priceData?.price ?? null,
    priceUsd: priceData?.priceUsd ?? null,
    timestamp: priceData?.timestamp ?? null,
    source: priceData?.source ?? null,
    isLoading,
    error,
    refresh: fetchPrice,
  };
}
