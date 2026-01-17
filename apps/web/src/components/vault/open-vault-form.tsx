'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useWallet } from '@/stores/wallet';
import { usePrice } from '@/hooks/use-price';
import { useVaultMetrics, useOpenVault } from '@/features/vault';
import { Button, Input, MaxButton, Card, ICRBadge } from '@/components/ui';
import { formatBTC, formatZkUSD, formatUSD } from '@/lib/utils';
import { PROTOCOL } from '@/lib/constants';

export function OpenVaultForm() {
  const { isConnected, balance, connect } = useWallet();
  const { data: priceData } = usePrice();
  const { openVault, isLoading: isSubmitting, status } = useOpenVault();

  // Form state
  const [collateralInput, setCollateralInput] = useState('');
  const [debtInput, setDebtInput] = useState('');

  // Parse inputs to bigint (in satoshis for collateral, in raw units for debt)
  const collateralSats = useMemo(() => {
    const parsed = parseFloat(collateralInput);
    if (isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * 1e8));
  }, [collateralInput]);

  const debtRaw = useMemo(() => {
    const parsed = parseFloat(debtInput);
    if (isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * 1e8));
  }, [debtInput]);

  // Get metrics
  const metrics = useVaultMetrics(collateralSats, debtRaw);

  // Set max collateral
  const handleMaxCollateral = useCallback(() => {
    // Leave some for fees (0.001 BTC buffer)
    const maxSats = Math.max(0, balance - 100_000);
    setCollateralInput((maxSats / 1e8).toString());
  }, [balance]);

  // Set max debt based on collateral (90% of max for safety margin)
  const handleMaxDebt = useCallback(() => {
    if (metrics.maxDebt > 0n) {
      const safeDebt = (metrics.maxDebt * 90n) / 100n;
      // Ensure at least minimum debt
      const finalDebt = safeDebt < PROTOCOL.MIN_DEBT ? PROTOCOL.MIN_DEBT : safeDebt;
      setDebtInput((Number(finalDebt) / 1e8).toFixed(2));
    }
  }, [metrics.maxDebt]);

  // Set minimum debt
  const handleSetMinDebt = useCallback(() => {
    setDebtInput((Number(PROTOCOL.MIN_DEBT) / 1e8).toString());
  }, []);

  // Check if max debt is below minimum (not enough collateral)
  const maxDebtBelowMin = metrics.maxDebt > 0n && metrics.maxDebt < PROTOCOL.MIN_DEBT;
  const minDebtValue = Number(PROTOCOL.MIN_DEBT) / 1e8;

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!isConnected) {
      connect();
      return;
    }

    if (!metrics.isValid) return;

    try {
      const result = await openVault({
        collateralSats,
        debtRaw,
      });

      // Clear form on success
      setCollateralInput('');
      setDebtInput('');
    } catch {
      // Error handled by hook
    }
  }, [metrics.isValid, isConnected, connect, openVault, collateralSats, debtRaw]);

  // Calculate USD values for display
  const collateralUSD = priceData
    ? (Number(collateralSats) / 1e8) * priceData.price
    : 0;

  return (
    <div className="space-y-6">
      {/* Collateral Input */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm text-zinc-400">Collateral (BTC)</label>
          {isConnected && (
            <span className="text-xs text-zinc-500">
              Balance: {formatBTC(balance)}
            </span>
          )}
        </div>
        <Input
          type="number"
          placeholder="0.00"
          min="0"
          step="any"
          value={collateralInput}
          onChange={(e) => setCollateralInput(e.target.value)}
          rightElement={
            <MaxButton onClick={handleMaxCollateral} disabled={!isConnected} />
          }
        />
        {collateralUSD > 0 && (
          <p className="text-xs text-zinc-500 mt-1">
            ≈ {formatUSD(collateralUSD)}
          </p>
        )}
      </div>

      {/* Debt Input */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm text-zinc-400">Borrow (zkUSD)</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              Min: {minDebtValue} | Max: {metrics.maxDebt > 0n ? (Number(metrics.maxDebt) / 1e8).toFixed(2) : '--'}
            </span>
          </div>
        </div>
        <Input
          type="number"
          placeholder={`Min ${minDebtValue} zkUSD`}
          min="0"
          step="any"
          value={debtInput}
          onChange={(e) => setDebtInput(e.target.value)}
          rightElement={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSetMinDebt}
                disabled={collateralSats === 0n}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-300 transition-colors disabled:opacity-50"
              >
                MIN
              </button>
              <span className="text-zinc-600">|</span>
              <MaxButton
                onClick={handleMaxDebt}
                disabled={metrics.maxDebt === 0n || maxDebtBelowMin}
              />
            </div>
          }
          error={metrics.validationError || undefined}
        />
        {maxDebtBelowMin && collateralSats > 0n && (
          <p className="text-xs text-amber-400 mt-1">
            Add more collateral to borrow minimum {minDebtValue} zkUSD
          </p>
        )}
      </div>

      {/* Metrics Display */}
      {(collateralSats > 0n || debtRaw > 0n) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-4 bg-zinc-800/50 rounded-xl space-y-3"
        >
          <div className="flex justify-between items-center">
            <span className="text-sm text-zinc-400">Collateral Ratio</span>
            <ICRBadge icr={metrics.icr} />
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-zinc-400">Liquidation Price</span>
            <span className="font-mono text-sm text-white">
              {metrics.liquidationPrice > 0
                ? formatUSD(metrics.liquidationPrice)
                : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-zinc-400">Opening Fee (1%)</span>
            <span className="font-mono text-sm text-white">
              {metrics.fee > 0n ? formatZkUSD(metrics.fee) : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-zinc-700">
            <span className="text-sm text-white font-medium">Total Debt</span>
            <span className="font-mono text-sm text-white">
              {metrics.totalDebt > 0n ? formatZkUSD(metrics.totalDebt) : '--'}
            </span>
          </div>
        </motion.div>
      )}

      {/* Protocol Info */}
      <div className="text-xs text-zinc-500 space-y-1">
        <p>• Minimum collateral ratio: {PROTOCOL.MCR / 100}%</p>
        <p>• Minimum debt: {Number(PROTOCOL.MIN_DEBT) / 1e8} zkUSD</p>
        <p>• Opening fee: 1% of borrowed amount</p>
      </div>

      {/* Submit Button */}
      <Button
        fullWidth
        size="lg"
        onClick={handleSubmit}
        loading={isSubmitting}
        disabled={isConnected && !metrics.isValid}
      >
        {!isConnected
          ? 'Connect Wallet'
          : isSubmitting
            ? getStatusText(status)
            : !metrics.isValid
              ? metrics.validationError || 'Enter Amounts'
              : 'Open Vault'}
      </Button>
    </div>
  );
}

// Helper to get human-readable status text
function getStatusText(status: string): string {
  switch (status) {
    case 'building_spell':
      return 'Building transaction...';
    case 'proving':
      return 'Generating ZK proof...';
    case 'signing':
      return 'Sign in wallet...';
    case 'broadcasting':
      return 'Broadcasting...';
    case 'confirming':
      return 'Confirming...';
    default:
      return 'Processing...';
  }
}
