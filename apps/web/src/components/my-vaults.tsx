'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useProtocol, useNetwork, useZkUsd } from '@/lib';
import { formatBTC, formatZkUSD, formatUSD, calculateICR, calculateLiquidationPrice } from '@zkusd/utils';
import { ICRBadge } from '@/components/shared';
import { AdjustVaultModal } from './adjust-vault-modal';
import { CloseVaultModal } from './close-vault-modal';

interface VaultData {
  id: string;
  utxo: string;
  collateral: bigint;
  debt: bigint;
  icr: number;
  liquidationPrice: bigint;
  // Extended state for modals
  owner: string;
  createdAt: number;
  lastUpdated: number;
  interestRateBps: number;
  accruedInterest: bigint;
  redistributedDebt: bigint;
  redistributedCollateral: bigint;
  insuranceBalance: bigint;
}

export function MyVaults() {
  const { isConnected, address } = useWallet();
  const { oracle } = useProtocol();
  const { config } = useNetwork();
  const { client, btcPrice } = useZkUsd();

  const [vaults, setVaults] = useState<VaultData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVault, setSelectedVault] = useState<VaultData | null>(null);
  const [modalType, setModalType] = useState<'adjust' | 'close' | null>(null);

  // Fetch vaults when address changes
  const fetchVaults = useCallback(async () => {
    if (!client || !address) return;

    setIsLoading(true);
    setError(null);

    try {
      // Use SDK to fetch vaults for the connected address
      const userVaults = await client.vault.getVaultsByOwner(address);

      // Transform to VaultData format with calculations
      const price = btcPrice ?? oracle?.price ?? 0n;
      const vaultData: VaultData[] = userVaults.map(v => ({
        id: v.id,
        utxo: `${v.id}:0`, // Simplified - would need actual UTXO reference
        collateral: v.collateral,
        debt: v.debt,
        icr: price > 0n ? calculateICR(v.collateral, v.debt, price) : 0,
        liquidationPrice: calculateLiquidationPrice(v.collateral, v.debt),
        // Extended state - defaults for now, would come from charm state
        owner: address,
        createdAt: v.createdAt ?? 0,
        lastUpdated: v.lastUpdated ?? 0,
        interestRateBps: v.interestRateBps ?? 100,
        accruedInterest: v.accruedInterest ?? 0n,
        redistributedDebt: v.redistributedDebt ?? 0n,
        redistributedCollateral: v.redistributedCollateral ?? 0n,
        insuranceBalance: v.insuranceBalance ?? 0n,
      }));

      setVaults(vaultData);
    } catch (err) {
      console.error('Failed to fetch vaults:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch vaults');
    } finally {
      setIsLoading(false);
    }
  }, [client, address, btcPrice, oracle?.price]);

  useEffect(() => {
    if (isConnected && address) {
      fetchVaults();
    } else {
      setVaults([]);
    }
  }, [isConnected, address, fetchVaults]);

  if (!isConnected) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-zinc-300 mb-2">Wallet Not Connected</h3>
        <p className="text-zinc-500 text-sm">Connect your wallet to view your vaults</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 animate-pulse">
            <div className="h-5 bg-zinc-700 rounded w-32 mb-3" />
            <div className="h-4 bg-zinc-700 rounded w-48" />
          </div>
        ))}
      </div>
    );
  }

  if (vaults.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-zinc-300 mb-2">No Vaults Found</h3>
        <p className="text-zinc-500 text-sm mb-4">You don't have any active vaults yet</p>
        <p className="text-zinc-600 text-xs">
          Open a new vault to mint zkUSD using BTC as collateral
        </p>
      </div>
    );
  }

  const btcPriceUsd = oracle?.priceUsd ?? 0;

  return (
    <div className="space-y-4">
      {vaults.map((vault) => {
        const collateralUsd = Number(vault.collateral) / 100_000_000 * btcPriceUsd;

        return (
          <div key={vault.id} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-medium">Vault #{vault.id.slice(0, 8)}</h4>
                <a
                  href={`${config.explorerUrl}/tx/${vault.utxo.split(':')[0]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-amber-400 font-mono"
                >
                  {vault.utxo}
                </a>
              </div>
              <ICRBadge icr={vault.icr} />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-zinc-500">Collateral</div>
                <div className="font-mono">{formatBTC(vault.collateral)}</div>
                <div className="text-xs text-zinc-500">{formatUSD(collateralUsd)}</div>
              </div>
              <div>
                <div className="text-zinc-500">Debt</div>
                <div className="font-mono">{formatZkUSD(vault.debt)}</div>
              </div>
              <div>
                <div className="text-zinc-500">Liquidation Price</div>
                <div className="font-mono">{formatUSD(Number(vault.liquidationPrice) / 100_000_000)}</div>
              </div>
              <div>
                <div className="text-zinc-500">Current Price</div>
                <div className="font-mono">{formatUSD(btcPriceUsd)}</div>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setSelectedVault(vault);
                  setModalType('adjust');
                }}
                className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm py-2 rounded transition-colors"
              >
                Adjust
              </button>
              <button
                onClick={() => {
                  setSelectedVault(vault);
                  setModalType('close');
                }}
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm py-2 rounded transition-colors border border-red-500/30"
              >
                Close
              </button>
            </div>
          </div>
        );
      })}

      {/* Adjust Vault Modal */}
      {selectedVault && modalType === 'adjust' && (
        <AdjustVaultModal
          vault={selectedVault}
          onClose={() => {
            setSelectedVault(null);
            setModalType(null);
          }}
          onSuccess={() => {
            fetchVaults();
          }}
        />
      )}

      {/* Close Vault Modal */}
      {selectedVault && modalType === 'close' && (
        <CloseVaultModal
          vault={selectedVault}
          onClose={() => {
            setSelectedVault(null);
            setModalType(null);
          }}
          onSuccess={() => {
            fetchVaults();
          }}
        />
      )}
    </div>
  );
}
