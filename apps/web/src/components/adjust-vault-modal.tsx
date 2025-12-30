'use client';

import { useState, useEffect } from 'react';
import { useWallet, useProtocol, useZkUsd } from '@/lib';
import { formatBTC, formatZkUSD, calculateICR, calculateLiquidationPrice } from '@zkusd/utils';
import { ICRBadge, ICRBar } from '@/components/shared';

interface VaultState {
  id: string;
  utxo: string;
  collateral: bigint;
  debt: bigint;
  owner: string;
  createdAt: number;
  lastUpdated: number;
  interestRateBps: number;
  accruedInterest: bigint;
  redistributedDebt: bigint;
  redistributedCollateral: bigint;
  insuranceBalance: bigint;
}

interface AdjustVaultModalProps {
  vault: VaultState;
  onClose: () => void;
  onSuccess: () => void;
}

type AdjustMode = 'collateral' | 'debt';
type AdjustDirection = 'add' | 'remove';

export function AdjustVaultModal({ vault, onClose, onSuccess }: AdjustVaultModalProps) {
  const { address, signPsbt } = useWallet();
  const { oracle } = useProtocol();
  const { client, btcPrice } = useZkUsd();

  const [mode, setMode] = useState<AdjustMode>('collateral');
  const [direction, setDirection] = useState<AdjustDirection>('add');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const price = btcPrice ?? oracle?.price ?? 0n;

  // Calculate new values
  const amountSats = mode === 'collateral'
    ? BigInt(Math.floor(parseFloat(amount || '0') * 100_000_000))
    : 0n;
  const amountZkusd = mode === 'debt'
    ? BigInt(Math.floor(parseFloat(amount || '0') * 100_000_000))
    : 0n;

  const newCollateral = mode === 'collateral'
    ? (direction === 'add' ? vault.collateral + amountSats : vault.collateral - amountSats)
    : vault.collateral;

  const newDebt = mode === 'debt'
    ? (direction === 'add' ? vault.debt + amountZkusd : vault.debt - amountZkusd)
    : vault.debt;

  const currentICR = price > 0n ? calculateICR(vault.collateral, vault.debt, price) : 0;
  const newICR = price > 0n && newDebt > 0n ? calculateICR(newCollateral, newDebt, price) : 0;
  const newLiquidationPrice = newDebt > 0n ? calculateLiquidationPrice(newCollateral, newDebt) : 0n;

  const isValidAdjustment = () => {
    if (!amount || parseFloat(amount) <= 0) return false;
    if (newCollateral < 0n || newDebt < 0n) return false;
    if (newDebt > 0n && newICR < 11000) return false; // Below MCR
    if (mode === 'collateral' && direction === 'remove' && amountSats > vault.collateral) return false;
    if (mode === 'debt' && direction === 'remove' && amountZkusd > vault.debt) return false;
    return true;
  };

  const handleAdjust = async () => {
    if (!client || !address || !signPsbt) return;

    setIsProcessing(true);
    setError(null);
    setTxStatus('Building transaction...');

    try {
      // Get funding UTXO if adding collateral
      let additionalBtcUtxo: string | undefined;
      if (mode === 'collateral' && direction === 'add') {
        const utxos = await client.getAddressUtxos(address);
        const fundingUtxo = utxos.find(u => BigInt(u.value) >= amountSats + 10000n);
        if (!fundingUtxo) {
          throw new Error('Insufficient BTC balance for collateral addition');
        }
        additionalBtcUtxo = `${fundingUtxo.txid}:${fundingUtxo.vout}`;
      }

      // Get zkUSD UTXO if repaying debt
      let zkusdUtxo: string | undefined;
      let zkusdAmount: bigint | undefined;
      if (mode === 'debt' && direction === 'remove') {
        // In production, we'd find the zkUSD UTXO from user's holdings
        // For now, we'll use a placeholder - this would need charm state scanning
        zkusdUtxo = undefined; // Would be populated from zkUSD token UTXOs
        zkusdAmount = amountZkusd;
      }

      setTxStatus('Building spell...');

      const spell = await client.vault.buildAdjustVaultSpell({
        vaultId: vault.id,
        collateralChange: mode === 'collateral' ? amountSats : 0n,
        debtChange: mode === 'debt' ? amountZkusd : 0n,
        isCollateralIncrease: mode === 'collateral' && direction === 'add',
        isDebtIncrease: mode === 'debt' && direction === 'add',
        vaultUtxo: vault.utxo,
        vaultState: {
          id: vault.id,
          owner: vault.owner,
          collateral: vault.collateral,
          debt: vault.debt,
          createdAt: vault.createdAt,
          lastUpdated: vault.lastUpdated,
          interestRateBps: vault.interestRateBps,
          accruedInterest: vault.accruedInterest,
          redistributedDebt: vault.redistributedDebt,
          redistributedCollateral: vault.redistributedCollateral,
          insuranceBalance: vault.insuranceBalance,
        },
        ownerAddress: address,
        additionalBtcUtxo,
        zkusdUtxo,
        zkusdAmount,
      });

      setTxStatus('Creating PSBT...');

      // Create and sign PSBT
      const psbtResponse = await client.createPsbt(spell);

      setTxStatus('Waiting for signature...');

      const signedPsbt = await signPsbt(psbtResponse.psbt);

      setTxStatus('Broadcasting transaction...');

      const txid = await client.broadcastTransaction(signedPsbt);

      setTxStatus(`Success! TX: ${txid.slice(0, 8)}...`);

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);

    } catch (err) {
      console.error('Adjust vault failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to adjust vault');
      setTxStatus(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Adjust Vault</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Current State */}
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 mb-4">
          <div className="text-xs text-zinc-400 mb-2">Current Position</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div className="text-zinc-500">Collateral</div>
              <div className="font-mono">{formatBTC(vault.collateral)}</div>
            </div>
            <div>
              <div className="text-zinc-500">Debt</div>
              <div className="font-mono">{formatZkUSD(vault.debt)}</div>
            </div>
            <div>
              <div className="text-zinc-500">CR</div>
              <ICRBadge icr={currentICR} size="sm" />
            </div>
          </div>
        </div>

        {/* Mode Selection */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('collateral')}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              mode === 'collateral'
                ? 'bg-amber-500 text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            Collateral
          </button>
          <button
            onClick={() => setMode('debt')}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              mode === 'debt'
                ? 'bg-amber-500 text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            Debt
          </button>
        </div>

        {/* Direction Selection */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setDirection('add')}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              direction === 'add'
                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {mode === 'collateral' ? 'Add Collateral' : 'Borrow More'}
          </button>
          <button
            onClick={() => setDirection('remove')}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              direction === 'remove'
                ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {mode === 'collateral' ? 'Withdraw' : 'Repay Debt'}
          </button>
        </div>

        {/* Amount Input */}
        <div className="mb-4">
          <label className="block text-sm text-zinc-400 mb-2">
            Amount ({mode === 'collateral' ? 'BTC' : 'zkUSD'})
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step={mode === 'collateral' ? '0.00000001' : '0.01'}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* New Position Preview */}
        {amount && parseFloat(amount) > 0 && (
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 mb-4">
            <div className="text-xs text-zinc-400 mb-2">New Position</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-zinc-500">Collateral</div>
                <div className="font-mono">{formatBTC(newCollateral)}</div>
              </div>
              <div>
                <div className="text-zinc-500">Debt</div>
                <div className="font-mono">{formatZkUSD(newDebt)}</div>
              </div>
              <div>
                <div className="text-zinc-500">New CR</div>
                <ICRBadge icr={newICR} size="sm" />
              </div>
            </div>
            <div className="mt-2">
              <ICRBar icr={newICR} />
            </div>
          </div>
        )}

        {/* Warnings */}
        {newICR > 0 && newICR < 11000 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
            CR would fall below 110% minimum. This adjustment is not allowed.
          </div>
        )}

        {newICR >= 11000 && newICR < 15000 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4 text-sm text-yellow-400">
            Warning: CR would be below 150%. Your vault would be at risk of liquidation.
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Status */}
        {txStatus && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-sm text-amber-400">
            {txStatus}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-700/50 text-white py-3 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdjust}
            disabled={isProcessing || !isValidAdjustment()}
            className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-black font-semibold py-3 rounded-lg transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
