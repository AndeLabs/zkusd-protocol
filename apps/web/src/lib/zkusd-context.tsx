'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { ZkUsdClient, type FeeEstimates, getBinaryService, type BinaryCache } from '@zkusd/sdk';
import { useNetwork } from './network-context';
import { useWallet } from './wallet-context';
import type { DeploymentConfig, OraclePrice } from '@zkusd/types';
import { REFRESH_INTERVALS, CACHE_TTL } from '@/config';

// ============================================================================
// Types
// ============================================================================

/** Apps that require binaries for prover */
type AppType = 'vaultManager' | 'zkusdToken' | 'priceOracle' | 'stabilityPool';

interface ZkUsdContextType {
  // Client
  client: ZkUsdClient | null;
  isReady: boolean;

  // Deployment config
  deploymentConfig: DeploymentConfig | null;
  isLoadingConfig: boolean;

  // Oracle
  btcPrice: bigint | null;
  priceTimestamp: number | null;
  isPriceStale: boolean;
  refreshPrice: () => Promise<void>;

  // Fees
  feeEstimates: FeeEstimates | null;
  refreshFees: () => Promise<void>;

  // Block
  blockHeight: number | null;
  refreshBlockHeight: () => Promise<void>;

  // Binaries
  loadBinaries: (apps: AppType[]) => Promise<BinaryCache>;
  binariesLoaded: Set<string>;
  isLoadingBinaries: boolean;

  // Error
  error: string | null;
}

// ============================================================================
// Context
// ============================================================================

const ZkUsdContext = createContext<ZkUsdContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function ZkUsdProvider({ children }: { children: ReactNode }) {
  const { networkId, config } = useNetwork();
  const { isConnected, address } = useWallet();

  // Client
  const [client, setClient] = useState<ZkUsdClient | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Deployment config
  const [deploymentConfig, setDeploymentConfig] = useState<DeploymentConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // Oracle
  const [btcPrice, setBtcPrice] = useState<bigint | null>(null);
  const [priceTimestamp, setPriceTimestamp] = useState<number | null>(null);

  // Fees
  const [feeEstimates, setFeeEstimates] = useState<FeeEstimates | null>(null);

  // Block
  const [blockHeight, setBlockHeight] = useState<number | null>(null);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Binaries
  const [binariesLoaded, setBinariesLoaded] = useState<Set<string>>(new Set());
  const [isLoadingBinaries, setIsLoadingBinaries] = useState(false);

  // ============================================================================
  // Initialize client when network changes
  // ============================================================================

  useEffect(() => {
    const network = networkId === 'mainnet' ? 'mainnet' : 'testnet4';
    const newClient = new ZkUsdClient({ network });
    setClient(newClient);
    setIsReady(false);
    setDeploymentConfig(null);
    setBtcPrice(null);
    setBlockHeight(null);
    setError(null);

    // Load deployment config
    setIsLoadingConfig(true);
    newClient.getDeploymentConfig()
      .then(config => {
        setDeploymentConfig(config);
        setIsReady(true);
      })
      .catch(err => {
        console.error('Failed to load deployment config:', err);
        setError('Failed to load protocol configuration');
      })
      .finally(() => {
        setIsLoadingConfig(false);
      });

    // Load initial data
    Promise.all([
      newClient.getBlockHeight().then(setBlockHeight),
      newClient.getFeeEstimates().then(setFeeEstimates),
    ]).catch(err => {
      console.error('Failed to load initial data:', err);
    });

  }, [networkId]);

  // ============================================================================
  // Refresh functions
  // ============================================================================

  const refreshPrice = useCallback(async () => {
    if (!client) return;

    try {
      // Fetch real BTC price from our API route (server-side to avoid CORS)
      const response = await fetch('/api/price', { cache: 'no-store' });

      if (!response.ok) {
        throw new Error('Failed to fetch BTC price');
      }

      const data = await response.json();

      if (typeof data.price === 'number' && data.price > 0) {
        // Convert to 8 decimals (same as satoshis)
        const priceScaled = BigInt(Math.floor(data.price * 100_000_000));
        setBtcPrice(priceScaled);
        setPriceTimestamp(Date.now());
      }
    } catch (err) {
      console.error('Failed to refresh price:', err);
    }
  }, [client]);

  const refreshFees = useCallback(async () => {
    if (!client) return;

    try {
      const fees = await client.getFeeEstimates();
      setFeeEstimates(fees);
    } catch (err) {
      console.error('Failed to refresh fees:', err);
    }
  }, [client]);

  const refreshBlockHeight = useCallback(async () => {
    if (!client) return;

    try {
      const height = await client.getBlockHeight();
      setBlockHeight(height);
    } catch (err) {
      console.error('Failed to refresh block height:', err);
    }
  }, [client]);

  // ============================================================================
  // Binary loading
  // ============================================================================

  /**
   * Load app binaries for the prover.
   * The prover requires WASM binaries for each app used in a spell.
   */
  const loadBinaries = useCallback(async (apps: AppType[]): Promise<BinaryCache> => {
    if (!deploymentConfig) {
      throw new Error('Deployment config not loaded');
    }

    setIsLoadingBinaries(true);

    try {
      const binaryService = getBinaryService();
      const configs = apps.map(app => {
        const contract = deploymentConfig.contracts[app];
        if (!contract) {
          throw new Error(`Unknown app: ${app}`);
        }

        // Get WASM path from config (falls back to convention if not set)
        const wasmPath = (contract as { wasmPath?: string }).wasmPath ||
          `/wasm/zkusd-${app.replace(/([A-Z])/g, '-$1').toLowerCase()}-app.wasm`;

        return {
          vk: contract.vk,
          url: wasmPath,
          name: app,
        };
      });

      const binaries = await binaryService.loadBinaries(configs);

      // Track which VKs are loaded
      setBinariesLoaded(prev => {
        const next = new Set(prev);
        for (const vk of Object.keys(binaries)) {
          next.add(vk);
        }
        return next;
      });

      console.log(`[ZkUsd] Loaded binaries for: ${apps.join(', ')}`);
      return binaries;
    } catch (err) {
      console.error('Failed to load binaries:', err);
      throw err;
    } finally {
      setIsLoadingBinaries(false);
    }
  }, [deploymentConfig]);

  // ============================================================================
  // Auto-refresh
  // ============================================================================

  useEffect(() => {
    if (!client) return;

    // Initial price fetch
    refreshPrice();

    const priceInterval = setInterval(refreshPrice, REFRESH_INTERVALS.PRICE);
    const blockInterval = setInterval(refreshBlockHeight, REFRESH_INTERVALS.BLOCK_HEIGHT);
    const feeInterval = setInterval(refreshFees, REFRESH_INTERVALS.FEE_ESTIMATES);

    return () => {
      clearInterval(priceInterval);
      clearInterval(blockInterval);
      clearInterval(feeInterval);
    };
  }, [client, refreshPrice, refreshBlockHeight, refreshFees]);

  // ============================================================================
  // Computed values
  // ============================================================================

  const isPriceStale = useMemo(() => {
    if (!priceTimestamp) return true;
    return Date.now() - priceTimestamp > CACHE_TTL.ORACLE_STALENESS;
  }, [priceTimestamp]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <ZkUsdContext.Provider
      value={{
        client,
        isReady,
        deploymentConfig,
        isLoadingConfig,
        btcPrice,
        priceTimestamp,
        isPriceStale,
        refreshPrice,
        feeEstimates,
        refreshFees,
        blockHeight,
        refreshBlockHeight,
        loadBinaries,
        binariesLoaded,
        isLoadingBinaries,
        error,
      }}
    >
      {children}
    </ZkUsdContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useZkUsd() {
  const context = useContext(ZkUsdContext);
  if (!context) {
    throw new Error('useZkUsd must be used within ZkUsdProvider');
  }
  return context;
}
