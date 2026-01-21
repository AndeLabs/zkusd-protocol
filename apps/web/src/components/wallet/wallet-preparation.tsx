'use client';

import { Button } from '@/components/ui';
import { getClient } from '@/lib/sdk';
import { formatBTC } from '@/lib/utils';
import { useWallet } from '@/stores/wallet';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

export interface WalletStatus {
  isReady: boolean;
  utxoCount: number;
  totalBalance: number;
  largestUtxo: number;
  needsPreparation: boolean;
  reason?: string;
}

interface WalletPreparationProps {
  requiredCollateral: number; // in satoshis
  onReady: () => void;
  onSkip?: () => void;
}

/**
 * Elegant wallet preparation component
 * Guides users through UTXO setup for Charms protocol
 */
export function WalletPreparation({ requiredCollateral, onReady, onSkip }: WalletPreparationProps) {
  const { address, isConnected } = useWallet();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparationTxId, setPreparationTxId] = useState<string | null>(null);

  // Minimum fee buffer (50k sats for transaction fees)
  const FEE_BUFFER = 50_000;

  // Check wallet status
  const checkWalletStatus = useCallback(async () => {
    if (!address || !isConnected) return;

    setIsChecking(true);
    try {
      const client = getClient();
      const utxos = await client.getAddressUtxos(address);
      const confirmed = utxos.filter((u) => u.status?.confirmed);

      if (confirmed.length === 0) {
        setStatus({
          isReady: false,
          utxoCount: 0,
          totalBalance: 0,
          largestUtxo: 0,
          needsPreparation: false,
          reason: 'No confirmed UTXOs found. Please fund your wallet.',
        });
        return;
      }

      const sorted = [...confirmed].sort((a, b) => b.value - a.value);
      const totalBalance = confirmed.reduce((sum, u) => sum + u.value, 0);
      const largestUtxo = sorted[0].value;

      // Check if we have two suitable UTXOs
      const collateralUtxo = sorted.find((u) => u.value >= requiredCollateral);
      const feeUtxo = sorted.find((u) => u.value >= FEE_BUFFER && u !== collateralUtxo);

      if (collateralUtxo && feeUtxo) {
        setStatus({
          isReady: true,
          utxoCount: confirmed.length,
          totalBalance,
          largestUtxo,
          needsPreparation: false,
        });
        return;
      }

      // Check if we can prepare (have enough in one UTXO)
      const totalRequired = requiredCollateral + FEE_BUFFER + 10_000; // extra for split tx fee
      const canPrepare = largestUtxo >= totalRequired;

      setStatus({
        isReady: false,
        utxoCount: confirmed.length,
        totalBalance,
        largestUtxo,
        needsPreparation: canPrepare,
        reason: canPrepare
          ? `Your wallet has ${confirmed.length} UTXO${confirmed.length > 1 ? 's' : ''}. Charms protocol requires 2 separate UTXOs for vault creation.`
          : `Insufficient funds. Need at least ${formatBTC(totalRequired)} BTC in a single UTXO.`,
      });
    } catch (error) {
      console.error('[WalletPreparation] Check failed:', error);
      setStatus({
        isReady: false,
        utxoCount: 0,
        totalBalance: 0,
        largestUtxo: 0,
        needsPreparation: false,
        reason: 'Failed to check wallet status',
      });
    } finally {
      setIsChecking(false);
    }
  }, [address, isConnected, requiredCollateral]);

  // Check on mount and when address changes
  useEffect(() => {
    checkWalletStatus();
  }, [checkWalletStatus]);

  // Prepare wallet (split UTXO)
  const prepareWallet = useCallback(async () => {
    if (!address || !window.unisat) return;

    setIsPreparing(true);
    try {
      toast.loading('Preparing your wallet...', { id: 'wallet-prep' });

      // Send collateral amount to ourselves, creating two UTXOs
      const txId = await window.unisat.sendBitcoin(address, requiredCollateral);

      setPreparationTxId(txId);
      toast.loading('Waiting for transaction to propagate...', { id: 'wallet-prep' });

      // Wait for mempool propagation (longer wait for reliability)
      await new Promise((resolve) => setTimeout(resolve, 8000));

      toast.success('Wallet prepared successfully!', {
        id: 'wallet-prep',
        description: 'Your vault creation will now continue.',
      });

      // Always call onReady after successful preparation
      // The new UTXOs will be available in the mempool
      onReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preparation failed';

      // Check if user rejected
      if (
        message.toLowerCase().includes('user rejected') ||
        message.toLowerCase().includes('cancelled') ||
        message.toLowerCase().includes('denied')
      ) {
        toast.error('Wallet preparation cancelled', { id: 'wallet-prep' });
      } else {
        toast.error('Failed to prepare wallet', {
          id: 'wallet-prep',
          description: message,
        });
      }
    } finally {
      setIsPreparing(false);
    }
  }, [address, requiredCollateral, onReady]);

  // Loading state
  if (isChecking) {
    return (
      <div className="p-6 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full" />
          <span className="text-zinc-400">Checking wallet status...</span>
        </div>
      </div>
    );
  }

  // Wallet is ready
  if (status?.isReady) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 bg-green-950/30 rounded-xl border border-green-700/50"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-600/20 rounded-lg">
            <svg
              className="w-5 h-5 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-label="Check mark"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <p className="text-green-200 font-medium">Wallet Ready</p>
            <p className="text-xs text-green-200/70">
              {status.utxoCount} UTXO{status.utxoCount > 1 ? 's' : ''} available (
              {formatBTC(status.totalBalance)})
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Needs preparation
  if (status?.needsPreparation) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-6 bg-zinc-900/50 rounded-xl border border-zinc-800"
      >
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-600/10 rounded-xl">
            <svg
              className="w-6 h-6 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-label="Wallet preparation"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-2">Prepare Your Wallet</h3>
            <p className="text-sm text-zinc-400 mb-4">{status.reason}</p>

            <div className="bg-zinc-800/50 rounded-lg p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Current Balance</span>
                <span className="text-white font-mono">{formatBTC(status.totalBalance)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">UTXOs</span>
                <span className="text-white">{status.utxoCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Required for Vault</span>
                <span className="text-amber-400 font-mono">2 UTXOs</span>
              </div>
            </div>

            <div className="bg-zinc-800/30 rounded-lg p-3 mb-4">
              <p className="text-xs text-zinc-500 leading-relaxed">
                <span className="text-amber-400 font-medium">Why is this needed?</span>
                <br />
                Charms protocol uses Bitcoin&apos;s Taproot to create secure vaults. This requires
                two transactions (commit + spell) that must use separate UTXOs to avoid conflicts.
              </p>
            </div>

            <div className="flex gap-3">
              {onSkip && (
                <Button variant="ghost" onClick={onSkip} disabled={isPreparing}>
                  Cancel
                </Button>
              )}
              <Button onClick={prepareWallet} loading={isPreparing} className="flex-1">
                {isPreparing ? 'Preparing...' : 'Prepare Wallet'}
              </Button>
            </div>

            {preparationTxId && (
              <p className="text-xs text-zinc-500 mt-3">
                Preparation TX: {preparationTxId.slice(0, 8)}...{preparationTxId.slice(-8)}
              </p>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Cannot proceed (insufficient funds)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-6 bg-red-950/20 rounded-xl border border-red-700/30"
    >
      <div className="flex items-start gap-4">
        <div className="p-3 bg-red-600/10 rounded-xl">
          <svg
            className="w-6 h-6 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-label="Insufficient funds warning"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-red-200 mb-2">Insufficient Funds</h3>
          <p className="text-sm text-red-200/70 mb-4">{status?.reason}</p>

          <div className="bg-zinc-900/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Your Balance</span>
              <span className="text-white font-mono">{formatBTC(status?.totalBalance || 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Required</span>
              <span className="text-red-400 font-mono">
                {formatBTC(requiredCollateral + FEE_BUFFER + 10_000)}
              </span>
            </div>
          </div>

          <Button variant="outline" className="mt-4" onClick={checkWalletStatus}>
            Refresh Balance
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Hook to check if wallet needs preparation
 */
export function useWalletPreparation(requiredCollateral: number) {
  const { address, isConnected } = useWallet();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const FEE_BUFFER = 50_000;

  const check = useCallback(async () => {
    if (!address || !isConnected) {
      setStatus(null);
      return;
    }

    setIsLoading(true);
    try {
      const client = getClient();
      const utxos = await client.getAddressUtxos(address);
      const confirmed = utxos.filter((u) => u.status?.confirmed);

      if (confirmed.length === 0) {
        setStatus({
          isReady: false,
          utxoCount: 0,
          totalBalance: 0,
          largestUtxo: 0,
          needsPreparation: false,
          reason: 'No confirmed UTXOs',
        });
        return;
      }

      const sorted = [...confirmed].sort((a, b) => b.value - a.value);
      const totalBalance = confirmed.reduce((sum, u) => sum + u.value, 0);
      const largestUtxo = sorted[0].value;

      const collateralUtxo = sorted.find((u) => u.value >= requiredCollateral);
      const feeUtxo = sorted.find((u) => u.value >= FEE_BUFFER && u !== collateralUtxo);

      const isReady = !!(collateralUtxo && feeUtxo);
      const totalRequired = requiredCollateral + FEE_BUFFER + 10_000;

      setStatus({
        isReady,
        utxoCount: confirmed.length,
        totalBalance,
        largestUtxo,
        needsPreparation: !isReady && largestUtxo >= totalRequired,
      });
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, requiredCollateral]);

  useEffect(() => {
    check();
  }, [check]);

  return { status, isLoading, refresh: check };
}
