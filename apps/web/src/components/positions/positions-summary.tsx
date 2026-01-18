'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useWallet } from '@/stores/wallet';
import { useVaultsStore, type TrackedVault } from '@/stores/vaults';
import { useUserDeposit } from '@/features/stability-pool';
import { usePrice } from '@/hooks/use-price';
import { Button, Skeleton, ICRBadge } from '@/components/ui';
import { AdjustVaultModal, CloseVaultModal } from '@/components/vault';
import { formatBTC, formatZkUSD, calculateICR } from '@/lib/utils';

export function PositionsSummary() {
  const { isConnected, connect, address, publicKey } = useWallet();
  const allVaults = useVaultsStore((s) => s.vaults);
  const vaults = useMemo(
    () => allVaults.filter((v) => v.owner === (publicKey || '')),
    [allVaults, publicKey]
  );
  const { data: spDeposit, isLoading: spLoading } = useUserDeposit();
  const { data: priceData } = usePrice();

  // Modal state
  const [selectedVault, setSelectedVault] = useState<TrackedVault | null>(null);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);

  const handleManageVault = useCallback((vault: TrackedVault) => {
    setSelectedVault(vault);
    setIsAdjustModalOpen(true);
  }, []);

  const handleCloseVault = useCallback((vault: TrackedVault) => {
    setSelectedVault(vault);
    setIsCloseModalOpen(true);
  }, []);

  const handleSpAddMore = useCallback(() => {
    toast.info('Stability Pool deposits require zkUSD tokens', {
      description: 'This feature requires a Charms indexer to locate your zkUSD.',
    });
  }, []);

  const handleSpWithdraw = useCallback(() => {
    toast.info('Withdrawal requires deposit UTXO', {
      description: 'This feature requires a Charms indexer to locate your deposit.',
    });
  }, []);

  if (!isConnected) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">Your Positions</h3>
        <p className="text-zinc-400 text-sm mb-6">
          Connect your wallet to view and manage your vaults and deposits.
        </p>
        <Button onClick={connect}>Connect Wallet</Button>
      </div>
    );
  }

  const isLoading = spLoading;
  const hasVaults = vaults.length > 0;
  const hasSpDeposit = spDeposit && spDeposit.deposit > 0n;
  const hasPositions = hasVaults || hasSpDeposit;

  return (
    <>
      <div className="space-y-6">
        {/* Summary Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Your Positions</h3>
          <span className="text-xs text-zinc-500 font-mono">
            {address?.slice(0, 8)}...{address?.slice(-6)}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !hasPositions ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-8 px-4 bg-zinc-800/50 rounded-xl"
          >
            <p className="text-zinc-400 mb-2">No active positions</p>
            <p className="text-xs text-zinc-500">
              Open a vault to borrow zkUSD or deposit to the Stability Pool to start earning.
            </p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {/* Vaults Section */}
            {hasVaults && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-zinc-400">Vaults</h4>
                {vaults.map((vault, index) => {
                  const icr = priceData
                    ? calculateICR(vault.collateral, vault.debt, priceData.price)
                    : 0;

                  return (
                    <motion.div
                      key={vault.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="p-4 bg-zinc-800 rounded-xl border border-zinc-700"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-mono text-zinc-500">
                          Vault #{vault.id.slice(0, 8)}
                        </span>
                        <ICRBadge icr={icr} />
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-zinc-500">Collateral</span>
                          <p className="font-mono text-white">
                            {formatBTC(Number(vault.collateral))}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Debt</span>
                          <p className="font-mono text-white">
                            {formatZkUSD(vault.debt)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => handleManageVault(vault)}
                        >
                          Manage
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-1"
                          onClick={() => handleCloseVault(vault)}
                        >
                          Close
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Stability Pool Section */}
            {hasSpDeposit && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-zinc-400">Stability Pool</h4>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-4 bg-zinc-800 rounded-xl border border-zinc-700"
                >
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-zinc-500">Deposited</span>
                      <p className="font-mono text-white">
                        {formatZkUSD(spDeposit?.deposit ?? 0n)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">BTC Rewards</span>
                      <p className="font-mono text-amber-400">
                        {formatBTC(Number(spDeposit?.collateralGain ?? 0n))}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={handleSpAddMore}
                    >
                      Add More
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      onClick={handleSpWithdraw}
                    >
                      Withdraw
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        )}

        {/* Note about local tracking */}
        {hasVaults && (
          <div className="text-xs text-zinc-500 text-center">
            <p>
              Vaults are tracked locally in this browser. Full position tracking requires a Charms indexer.
            </p>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedVault && (
        <>
          <AdjustVaultModal
            isOpen={isAdjustModalOpen}
            onClose={() => {
              setIsAdjustModalOpen(false);
              setSelectedVault(null);
            }}
            vault={selectedVault}
          />
          <CloseVaultModal
            isOpen={isCloseModalOpen}
            onClose={() => {
              setIsCloseModalOpen(false);
              setSelectedVault(null);
            }}
            vault={selectedVault}
          />
        </>
      )}
    </>
  );
}
