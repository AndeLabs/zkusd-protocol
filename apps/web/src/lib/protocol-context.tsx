'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNetwork } from './network-context';
import { useZkUsd } from './zkusd-context';
import { REFRESH_INTERVALS, CACHE_TTL } from '@/config';

interface OraclePrice {
  price: bigint; // 8 decimals (satoshi-like precision)
  priceUsd: number;
  timestamp: number;
  isStale: boolean;
}

interface ProtocolState {
  totalCollateral: bigint;
  totalDebt: bigint;
  activeVaultCount: number;
  baseRate: number;
  isPaused: boolean;
}

interface ProtocolContextType {
  oracle: OraclePrice | null;
  protocol: ProtocolState | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProtocolContext = createContext<ProtocolContextType | null>(null);

export function ProtocolProvider({ children }: { children: ReactNode }) {
  const { config } = useNetwork();
  const { client } = useZkUsd();
  const [oracle, setOracle] = useState<OraclePrice | null>(null);
  const [protocol, setProtocol] = useState<ProtocolState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPriceTimestamp, setLastPriceTimestamp] = useState<number>(0);

  // Fetch real BTC price from our API route (server-side to avoid CORS)
  const fetchBtcPrice = useCallback(async (): Promise<{ price: bigint; priceUsd: number } | null> => {
    try {
      const response = await fetch('/api/price', { cache: 'no-store' });

      if (response.ok) {
        const data = await response.json();

        if (typeof data.price === 'number' && data.price > 0) {
          // Convert to 8 decimal precision (like satoshis)
          const price = BigInt(Math.floor(data.price * 100_000_000));
          return { price, priceUsd: data.price };
        }
      }
    } catch (err) {
      console.warn('Price API failed:', err);
    }

    return null;
  }, []);

  const fetchProtocolState = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch real BTC price from external APIs
      const priceData = await fetchBtcPrice();
      const now = Date.now();

      if (priceData) {
        const oraclePrice: OraclePrice = {
          price: priceData.price,
          priceUsd: priceData.priceUsd,
          timestamp: Math.floor(now / 1000),
          isStale: false,
        };
        setOracle(oraclePrice);
        setLastPriceTimestamp(now);
      } else if (oracle) {
        // Keep existing price but mark as potentially stale
        const isStale = now - lastPriceTimestamp > CACHE_TTL.ORACLE_STALENESS;
        setOracle({
          ...oracle,
          isStale,
        });
      } else {
        setError('Unable to fetch BTC price from any source');
      }

      // Protocol state from SDK (queries VaultManager state)
      if (client) {
        try {
          const vmState = await client.vault.getProtocolState();
          const protocolState: ProtocolState = {
            totalCollateral: vmState.protocol.totalCollateral,
            totalDebt: vmState.protocol.totalDebt,
            activeVaultCount: vmState.protocol.activeVaultCount,
            baseRate: vmState.protocol.baseRate,
            isPaused: vmState.protocol.isPaused,
          };
          setProtocol(protocolState);
        } catch (err) {
          console.warn('Failed to fetch protocol state from SDK:', err);
          // Fall back to default values
          setProtocol({
            totalCollateral: 0n,
            totalDebt: 0n,
            activeVaultCount: 0,
            baseRate: 50,
            isPaused: false,
          });
        }
      } else {
        // SDK not ready yet, use defaults
        setProtocol({
          totalCollateral: 0n,
          totalDebt: 0n,
          activeVaultCount: 0,
          baseRate: 50,
          isPaused: false,
        });
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch protocol state');
    } finally {
      setIsLoading(false);
    }
  }, [fetchBtcPrice, oracle, lastPriceTimestamp, client]);

  useEffect(() => {
    fetchProtocolState();
    const interval = setInterval(fetchProtocolState, REFRESH_INTERVALS.PROTOCOL_STATE);
    return () => clearInterval(interval);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ProtocolContext.Provider
      value={{
        oracle,
        protocol,
        isLoading,
        error,
        refresh: fetchProtocolState,
      }}
    >
      {children}
    </ProtocolContext.Provider>
  );
}

export function useProtocol() {
  const context = useContext(ProtocolContext);
  if (!context) {
    throw new Error('useProtocol must be used within ProtocolProvider');
  }
  return context;
}
