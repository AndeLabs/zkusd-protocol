'use client';

import { formatZkUSD } from '@zkusd/utils';
import type { TxResult } from './types';

interface VaultSuccessProps {
  collateralBtc: string;
  debtRaw: bigint;
  txResult: TxResult;
  explorerUrl: string;
  onReset: () => void;
}

export function VaultSuccess({
  collateralBtc,
  debtRaw,
  txResult,
  explorerUrl,
  onReset,
}: VaultSuccessProps) {
  return (
    <div className="text-center py-8 space-y-4">
      <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-green-400">Vault Opened Successfully!</h3>
      <p className="text-zinc-400 text-sm">Your vault has been created and zkUSD has been minted</p>

      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-2 text-left">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Collateral</span>
          <span className="font-mono">{collateralBtc} BTC</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Minted</span>
          <span className="font-mono">{formatZkUSD(debtRaw)}</span>
        </div>
      </div>

      {txResult.spellTxId && (
        <a
          href={`${explorerUrl}/tx/${txResult.spellTxId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-amber-400 hover:underline text-sm"
        >
          View on Explorer →
        </a>
      )}

      <button
        onClick={onReset}
        className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-3 rounded-lg transition-colors mt-4"
      >
        Open Another Vault
      </button>
    </div>
  );
}

interface VaultErrorProps {
  errorMessage: string | null;
  onRetry: () => void;
}

export function VaultError({ errorMessage, onRetry }: VaultErrorProps) {
  return (
    <div className="text-center py-8 space-y-4">
      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-red-400">Transaction Failed</h3>
      <p className="text-zinc-400 text-sm">{errorMessage || 'Something went wrong'}</p>

      <button
        onClick={onRetry}
        className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-3 rounded-lg transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
