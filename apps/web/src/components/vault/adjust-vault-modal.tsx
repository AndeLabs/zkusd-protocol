'use client';

import { Button, ICRBadge, Input, MaxButton, Modal } from '@/components/ui';
import { useAdjustVault, useAdjustVaultDemo, useVaultMetrics } from '@/features/vault';
import { usePrice } from '@/hooks/use-price';
import { PROTOCOL } from '@/lib/constants';
import { isDemoMode } from '@/lib/services';
import { formatBTC, formatUSD, formatZkUSD } from '@/lib/utils';
import type { TrackedVault } from '@/stores/vaults';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface AdjustVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  vault: TrackedVault;
}

type AdjustMode = 'collateral' | 'debt';
type AdjustDirection = 'add' | 'remove';

export function AdjustVaultModal({ isOpen, onClose, vault }: AdjustVaultModalProps) {
  const { data: priceData } = usePrice();

  // Demo mode detection
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(isDemoMode());
  }, []);

  // Call both hooks (React requires unconditional hook calls)
  const realAdjust = useAdjustVault();
  const demoAdjust = useAdjustVaultDemo();

  // Select appropriate hook based on demo mode
  const { adjustVault, isLoading, status } = isDemo ? demoAdjust : realAdjust;

  const [mode, setMode] = useState<AdjustMode>('collateral');
  const [direction, setDirection] = useState<AdjustDirection>('add');
  const [amountInput, setAmountInput] = useState('');

  // Parse amount
  const amountRaw = useMemo(() => {
    const parsed = Number.parseFloat(amountInput);
    if (isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * 1e8));
  }, [amountInput]);

  // Calculate new values
  const newCollateral = useMemo(() => {
    if (mode !== 'collateral') return vault.collateral;
    return direction === 'add' ? vault.collateral + amountRaw : vault.collateral - amountRaw;
  }, [mode, direction, vault.collateral, amountRaw]);

  const newDebt = useMemo(() => {
    if (mode !== 'debt') return vault.debt;
    return direction === 'add' ? vault.debt + amountRaw : vault.debt - amountRaw;
  }, [mode, direction, vault.debt, amountRaw]);

  // Get metrics for new values
  const newMetrics = useVaultMetrics(newCollateral, newDebt);
  const currentMetrics = useVaultMetrics(vault.collateral, vault.debt);

  // Validation
  const validationError = useMemo(() => {
    if (amountRaw === 0n) return null;

    if (mode === 'collateral' && direction === 'remove') {
      if (amountRaw > vault.collateral) {
        return 'Cannot remove more collateral than deposited';
      }
      if (!newMetrics.isValid && newDebt > 0n) {
        return 'Would make vault undercollateralized';
      }
    }

    if (mode === 'debt') {
      if (direction === 'remove') {
        return 'Debt repayment requires zkUSD tokens (needs Charms indexer)';
      }
      if (direction === 'add' && !newMetrics.isValid) {
        return 'Would exceed maximum borrowing capacity';
      }
      if (direction === 'add' && newDebt < PROTOCOL.MIN_DEBT) {
        return `Minimum debt is ${Number(PROTOCOL.MIN_DEBT) / 1e8} zkUSD`;
      }
    }

    return null;
  }, [amountRaw, mode, direction, vault.collateral, newMetrics.isValid, newDebt]);

  const canSubmit = amountRaw > 0n && !validationError && !isLoading;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    try {
      await adjustVault({
        vault,
        collateralChange: mode === 'collateral' ? amountRaw : 0n,
        isCollateralIncrease: mode === 'collateral' && direction === 'add',
        debtChange: mode === 'debt' ? amountRaw : 0n,
        isDebtIncrease: mode === 'debt' && direction === 'add',
      });
      setAmountInput('');
      onClose();
    } catch {
      // Error handled by hook
    }
  }, [canSubmit, adjustVault, vault, mode, amountRaw, direction, onClose]);

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
      title="Adjust Vault"
      description={`Vault #${vault.id.slice(0, 8)}`}
      size="md"
    >
      <div className="px-6 pb-6 space-y-6">
        {/* Current State */}
        <div className="p-4 bg-zinc-800/50 rounded-xl space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Current Collateral</span>
            <span className="font-mono text-white">{formatBTC(Number(vault.collateral))}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Current Debt</span>
            <span className="font-mono text-white">{formatZkUSD(vault.debt)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Current ICR</span>
            <ICRBadge icr={currentMetrics.icr} />
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setMode('collateral');
              setDirection('add');
              setAmountInput('');
            }}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              mode === 'collateral'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Collateral
          </button>
          <button
            onClick={() => {
              setMode('debt');
              setDirection('add');
              setAmountInput('');
            }}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              mode === 'debt'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Debt
          </button>
        </div>

        {/* Direction Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setDirection('add')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              direction === 'add'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {mode === 'collateral' ? 'Add Collateral' : 'Borrow More'}
          </button>
          <button
            onClick={() => setDirection('remove')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              direction === 'remove'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {mode === 'collateral' ? 'Remove Collateral' : 'Repay Debt'}
          </button>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-zinc-400">
              {mode === 'collateral' ? 'Amount (BTC)' : 'Amount (zkUSD)'}
            </label>
            {mode === 'collateral' && direction === 'remove' && currentMetrics.maxWithdrawable > 0n && (
              <span className="text-xs text-zinc-500">
                Max: {formatBTC(Number(currentMetrics.maxWithdrawable))}
              </span>
            )}
            {mode === 'debt' && direction === 'add' && newMetrics.maxDebt > vault.debt && (
              <span className="text-xs text-zinc-500">
                Max additional: {formatZkUSD(newMetrics.maxDebt - vault.debt)}
              </span>
            )}
          </div>
          <Input
            type="number"
            placeholder="0.00"
            min="0"
            step="any"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            error={validationError || undefined}
            rightElement={
              mode === 'collateral' && direction === 'remove' && currentMetrics.maxWithdrawable > 0n ? (
                <MaxButton
                  onClick={() =>
                    setAmountInput((Number(currentMetrics.maxWithdrawable) / 1e8).toFixed(8))
                  }
                />
              ) : mode === 'debt' && direction === 'add' && currentMetrics.maxDebt > vault.debt ? (
                <MaxButton
                  onClick={() => {
                    const additionalDebt = currentMetrics.maxDebt - vault.debt;
                    // Use 90% of max for safety margin
                    const safeDebt = (additionalDebt * 90n) / 100n;
                    setAmountInput((Number(safeDebt) / 1e8).toFixed(2));
                  }}
                />
              ) : undefined
            }
          />
          {amountRaw > 0n && priceData && mode === 'collateral' && (
            <p className="text-xs text-zinc-500 mt-1">
              ≈ {formatUSD((Number(amountRaw) / 1e8) * priceData.price)}
            </p>
          )}
        </div>

        {/* New State Preview */}
        {amountRaw > 0n && !validationError && (
          <div className="p-4 bg-zinc-800/50 rounded-xl space-y-2 border border-zinc-700">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">After Adjustment</p>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">New Collateral</span>
              <span className="font-mono text-white">{formatBTC(Number(newCollateral))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">New Debt</span>
              <span className="font-mono text-white">{formatZkUSD(newDebt)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">New ICR</span>
              <ICRBadge icr={newMetrics.icr} />
            </div>
            {newMetrics.liquidationPrice > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Liquidation Price</span>
                <span className="font-mono text-white">
                  {formatUSD(newMetrics.liquidationPrice)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" fullWidth onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button fullWidth onClick={handleSubmit} loading={isLoading} disabled={!canSubmit}>
            {isLoading ? getStatusText(status) : 'Confirm Adjustment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
