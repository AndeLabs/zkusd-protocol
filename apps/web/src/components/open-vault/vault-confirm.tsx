'use client';

import { formatZkUSD } from '@zkusd/utils';
import { CCR } from '@/config';
import type { VaultCalculations } from './types';

interface VaultConfirmProps {
  collateralBtc: string;
  calculations: VaultCalculations;
  mcr: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function VaultConfirm({
  collateralBtc,
  calculations,
  mcr,
  onConfirm,
  onCancel,
}: VaultConfirmProps) {
  const { debtRaw, fee, totalDebt, icr } = calculations;

  const getIcrColor = () => {
    if (icr === 0) return 'text-zinc-500';
    if (icr < mcr) return 'text-red-400';
    if (icr < CCR) return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-bold mb-2">Confirm Vault Opening</h3>
        <p className="text-zinc-400 text-sm">Review your vault details before proceeding</p>
      </div>

      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
        <div className="flex justify-between">
          <span className="text-zinc-400">Collateral</span>
          <span className="font-mono">{collateralBtc} BTC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Borrow Amount</span>
          <span className="font-mono">{formatZkUSD(debtRaw)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Fee</span>
          <span className="font-mono">{formatZkUSD(fee)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Total Debt</span>
          <span className="font-mono font-bold">{formatZkUSD(totalDebt)}</span>
        </div>
        <div className="border-t border-zinc-700 pt-3">
          <div className="flex justify-between">
            <span className="text-zinc-400">Collateral Ratio</span>
            <span className={`font-mono font-bold ${getIcrColor()}`}>
              {(icr / 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-3 sm:py-4 rounded-lg transition-colors min-h-touch text-sm sm:text-base"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold py-3 sm:py-4 rounded-lg transition-colors min-h-touch text-sm sm:text-base"
        >
          Confirm & Sign
        </button>
      </div>
    </div>
  );
}
