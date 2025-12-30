'use client';

import { useState } from 'react';
import { useWallet, useProtocol, useZkUsd } from '@/lib';
import { formatBTC, formatZkUSD, formatUSD } from '@zkusd/utils';

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

interface CloseVaultModalProps {
  vault: VaultState;
  onClose: () => void;
  onSuccess: () => void;
}

export function CloseVaultModal({ vault, onClose, onSuccess }: CloseVaultModalProps) {
  const { address, signPsbt } = useWallet();
  const { oracle } = useProtocol();
  const { client } = useZkUsd();

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Calculate total debt to repay
  const totalDebt = vault.debt + vault.accruedInterest + vault.redistributedDebt;
  const collateralToReceive = vault.collateral + vault.redistributedCollateral;
  const priceUsd = oracle?.priceUsd ?? 0;
  const collateralValueUsd = Number(collateralToReceive) / 100_000_000 * priceUsd;

  const handleClose = async () => {
    if (!client || !address || !signPsbt) return;

    setIsProcessing(true);
    setError(null);
    setTxStatus('Building transaction...');

    try {
      // Find zkUSD UTXO to repay debt
      // In production, we'd scan for zkUSD charm UTXOs
      // For now, we'll need user to have sufficient zkUSD
      const zkusdUtxo = `placeholder:0`; // Would be populated from zkUSD token UTXOs
      const zkusdAmount = totalDebt;

      setTxStatus('Building spell...');

      const spell = await client.vault.buildCloseVaultSpell({
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
      console.error('Close vault failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to close vault');
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
          <h2 className="text-xl font-bold">Close Vault</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Warning */}
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="font-medium text-red-400 mb-1">This action is irreversible</h4>
              <p className="text-sm text-zinc-400">
                Closing your vault will repay all debt and return your collateral. The vault NFT will be burned.
              </p>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-4 mb-6">
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
            <h4 className="text-sm text-zinc-400 mb-3">You will repay</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-500">Principal Debt</span>
                <span className="font-mono">{formatZkUSD(vault.debt)}</span>
              </div>
              {vault.accruedInterest > 0n && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Accrued Interest</span>
                  <span className="font-mono">{formatZkUSD(vault.accruedInterest)}</span>
                </div>
              )}
              {vault.redistributedDebt > 0n && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Redistributed Debt</span>
                  <span className="font-mono">{formatZkUSD(vault.redistributedDebt)}</span>
                </div>
              )}
              <div className="border-t border-zinc-700 pt-2 flex justify-between font-medium">
                <span>Total to Repay</span>
                <span className="font-mono text-amber-400">{formatZkUSD(totalDebt)}</span>
              </div>
            </div>
          </div>

          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
            <h4 className="text-sm text-zinc-400 mb-3">You will receive</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-500">Collateral</span>
                <span className="font-mono">{formatBTC(vault.collateral)}</span>
              </div>
              {vault.redistributedCollateral > 0n && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Redistributed Collateral</span>
                  <span className="font-mono">{formatBTC(vault.redistributedCollateral)}</span>
                </div>
              )}
              <div className="border-t border-zinc-700 pt-2 flex justify-between font-medium">
                <span>Total to Receive</span>
                <span className="font-mono text-green-400">{formatBTC(collateralToReceive)}</span>
              </div>
              <div className="text-right text-xs text-zinc-500">
                {formatUSD(collateralValueUsd)}
              </div>
            </div>
          </div>
        </div>

        {/* Confirmation Checkbox */}
        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500"
          />
          <span className="text-sm text-zinc-400">
            I understand that closing this vault is permanent and I need {formatZkUSD(totalDebt)} zkUSD to complete this action.
          </span>
        </label>

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
            onClick={handleClose}
            disabled={isProcessing || !confirmed}
            className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Close Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}
