'use client';

import { Button, ICRBadge, Modal } from '@/components/ui';
import { useCloseVault, useCloseVaultDemo, useVaultMetrics } from '@/features/vault';
import { isDemoMode } from '@/lib/services';
import { formatBTC, formatZkUSD } from '@/lib/utils';
import type { TrackedVault } from '@/stores/vaults';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface CloseVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  vault: TrackedVault;
}

export function CloseVaultModal({ isOpen, onClose, vault }: CloseVaultModalProps) {
  // Demo mode detection
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(isDemoMode());
  }, []);

  // Call both hooks (React requires unconditional hook calls)
  const realClose = useCloseVault();
  const demoClose = useCloseVaultDemo();

  // Select appropriate hook based on demo mode
  const { closeVault, isLoading, status } = isDemo ? demoClose : realClose;
  const metrics = useVaultMetrics(vault.collateral, vault.debt);

  // Calculate total debt including interest
  const totalDebt = useMemo(() => {
    return vault.debt + vault.accruedInterest + vault.redistributedDebt;
  }, [vault.debt, vault.accruedInterest, vault.redistributedDebt]);

  const hasDebt = totalDebt > 0n;

  const handleClose = useCallback(async () => {
    try {
      await closeVault({ vault });
      onClose();
    } catch {
      // Error handled by hook
    }
  }, [closeVault, vault, onClose]);

  const getStatusText = (s: string): string => {
    switch (s) {
      case 'building_spell':
        return 'Building transaction...';
      case 'proving':
        return 'Generating ZK proof...';
      case 'signing':
        return 'Sign in wallet...';
      case 'broadcasting':
        return 'Broadcasting...';
      default:
        return 'Processing...';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Close Vault"
      description={`Vault #${vault.id.slice(0, 8)}`}
      size="md"
    >
      <div className="px-6 pb-6 space-y-6">
        {/* Vault Summary */}
        <div className="p-4 bg-zinc-800/50 rounded-xl space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-zinc-400">Collateral</span>
            <span className="font-mono text-white">{formatBTC(Number(vault.collateral))}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-zinc-400">Debt</span>
            <span className="font-mono text-white">{formatZkUSD(vault.debt)}</span>
          </div>
          {vault.accruedInterest > 0n && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-zinc-400">Accrued Interest</span>
              <span className="font-mono text-amber-400">{formatZkUSD(vault.accruedInterest)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-zinc-700">
            <span className="text-sm text-zinc-400">Total Debt</span>
            <span className="font-mono text-white font-medium">{formatZkUSD(totalDebt)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-zinc-400">Collateral Ratio</span>
            <ICRBadge icr={metrics.icr} />
          </div>
        </div>

        {/* Warning for vaults with debt */}
        {hasDebt ? (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <p className="text-red-400 font-medium">Cannot close vault with debt</p>
                <p className="text-sm text-zinc-400 mt-1">
                  You need to repay {formatZkUSD(totalDebt)} to close this vault. Debt repayment
                  requires a Charms indexer to locate your zkUSD tokens.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-green-400 font-medium">Ready to close</p>
                <p className="text-sm text-zinc-400 mt-1">
                  This vault has no debt. You will recover {formatBTC(Number(vault.collateral))}{' '}
                  BTC.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recovery Summary */}
        {!hasDebt && (
          <div className="p-4 bg-zinc-800 rounded-xl border border-zinc-700">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">You Will Receive</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <span className="text-amber-400 text-lg">₿</span>
                </div>
                <div>
                  <p className="font-mono text-white text-lg">
                    {formatBTC(Number(vault.collateral))}
                  </p>
                  <p className="text-xs text-zinc-500">Collateral</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" fullWidth onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant={hasDebt ? 'primary' : 'danger'}
            fullWidth
            onClick={handleClose}
            loading={isLoading}
            disabled={hasDebt || isLoading}
          >
            {isLoading ? getStatusText(status) : hasDebt ? 'Repay Debt First' : 'Close Vault'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
