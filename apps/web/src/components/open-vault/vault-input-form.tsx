'use client';

import { formatBTC, formatZkUSD, formatUSD } from '@zkusd/utils';
import { CCR } from '@/config';
import type { VaultCalculations, VaultValidation, VaultFormActions } from './types';
import type { FeeEstimates } from '@zkusd/sdk';

interface VaultInputFormProps {
  collateralBtc: string;
  debtZkusd: string;
  calculations: VaultCalculations;
  validation: VaultValidation;
  actions: VaultFormActions;
  balance: number;
  minDebt: bigint;
  mcr: number;
  isConnected: boolean;
  isReady: boolean;
  feeEstimates: FeeEstimates | null;
}

export function VaultInputForm({
  collateralBtc,
  debtZkusd,
  calculations,
  validation,
  actions,
  balance,
  minDebt,
  mcr,
  isConnected,
  isReady,
  feeEstimates,
}: VaultInputFormProps) {
  const { icr, fee, totalDebt, liquidationPrice, maxMintable, collateralUsd, feeRate, collateralSats, debtRaw } = calculations;
  const { isValid, hasEnoughBalance, hasEnoughUtxos, collateralUtxo, feeUtxo } = validation;

  const getIcrColor = () => {
    if (icr === 0) return 'text-zinc-500';
    if (icr < mcr) return 'text-red-400';
    if (icr < CCR) return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <form onSubmit={actions.handleSubmit} className="space-y-6">
      {/* Protocol Status */}
      {!isReady && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
          Loading protocol configuration...
        </div>
      )}

      {/* Collateral Input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-fluid-sm font-medium text-zinc-300">Collateral (BTC)</label>
          {isConnected && (
            <button
              type="button"
              onClick={actions.handleSetMax}
              className="text-xs sm:text-sm text-amber-400 hover:text-amber-300 px-2 py-1 min-h-touch-sm"
            >
              Max: {formatBTC(BigInt(balance))}
            </button>
          )}
        </div>
        <div className="relative">
          <input
            type="number"
            step="0.00000001"
            min="0"
            value={collateralBtc}
            onChange={(e) => actions.setCollateralBtc(e.target.value)}
            placeholder="0.00000000"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 sm:py-4 text-base sm:text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent min-h-touch"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 text-sm sm:text-base">
            BTC
          </div>
        </div>
        <div className="text-xs sm:text-sm text-zinc-500 mt-1">{formatUSD(collateralUsd)}</div>
      </div>

      {/* Debt Input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-fluid-sm font-medium text-zinc-300">Borrow (zkUSD)</label>
          {collateralSats > 0n && (
            <button
              type="button"
              onClick={actions.handleSetMaxDebt}
              className="text-xs sm:text-sm text-amber-400 hover:text-amber-300 px-2 py-1 min-h-touch-sm"
            >
              Max (~90%): {formatZkUSD(maxMintable * 9n / 10n)}
            </button>
          )}
        </div>
        <div className="relative">
          <input
            type="number"
            step="0.01"
            min="0"
            value={debtZkusd}
            onChange={(e) => actions.setDebtZkusd(e.target.value)}
            placeholder="0.00"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 sm:py-4 text-base sm:text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent min-h-touch"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 text-sm sm:text-base">
            zkUSD
          </div>
        </div>
        <div className="text-xs sm:text-sm text-zinc-500 mt-1">
          Min: {formatZkUSD(minDebt)}
        </div>
      </div>

      {/* Vault Summary */}
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-zinc-400">Collateral Ratio</span>
          <span className={`font-mono font-bold text-lg ${getIcrColor()}`}>
            {icr > 0 ? `${(icr / 100).toFixed(1)}%` : '---'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-400">Liquidation Price</span>
          <span className="font-mono">
            {liquidationPrice > 0n
              ? formatUSD(Number(liquidationPrice) / 100_000_000)
              : '---'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-400">Opening Fee ({(feeRate / 100).toFixed(1)}%)</span>
          <span className="font-mono">
            {fee > 0n ? formatZkUSD(fee) : '---'}
          </span>
        </div>
        <div className="border-t border-zinc-700 pt-3 flex justify-between items-center">
          <span className="text-zinc-300 font-medium">Total Debt</span>
          <span className="font-mono font-bold">
            {totalDebt > 0n ? formatZkUSD(totalDebt) : '---'}
          </span>
        </div>
        {feeEstimates && (
          <div className="flex justify-between items-center text-xs text-zinc-500">
            <span>Est. Network Fee</span>
            <span>{feeEstimates.halfHourFee} sat/vB</span>
          </div>
        )}
      </div>

      {/* Warnings */}
      <VaultWarnings
        icr={icr}
        mcr={mcr}
        debtRaw={debtRaw}
        minDebt={minDebt}
        hasEnoughBalance={hasEnoughBalance}
        hasEnoughUtxos={hasEnoughUtxos}
        collateralSats={collateralSats}
        balance={balance}
        isConnected={isConnected}
        collateralUtxo={collateralUtxo}
        feeUtxo={feeUtxo}
      />

      {/* Submit Button */}
      {!isConnected ? (
        <div className="text-center py-4 text-zinc-400 text-fluid-sm">
          Connect your wallet to open a vault
        </div>
      ) : (
        <button
          type="submit"
          disabled={!isValid || !isReady}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-bold py-3 sm:py-4 rounded-lg transition-colors disabled:cursor-not-allowed min-h-touch-lg text-base sm:text-lg"
        >
          Open Vault
        </button>
      )}
    </form>
  );
}

// Warnings sub-component
interface VaultWarningsProps {
  icr: number;
  mcr: number;
  debtRaw: bigint;
  minDebt: bigint;
  hasEnoughBalance: boolean;
  hasEnoughUtxos: boolean;
  collateralSats: bigint;
  balance: number;
  isConnected: boolean;
  collateralUtxo: unknown;
  feeUtxo: unknown;
}

function VaultWarnings({
  icr,
  mcr,
  debtRaw,
  minDebt,
  hasEnoughBalance,
  hasEnoughUtxos,
  collateralSats,
  balance,
  isConnected,
  collateralUtxo,
  feeUtxo,
}: VaultWarningsProps) {
  return (
    <>
      {icr > 0 && icr < mcr && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          Collateral ratio must be at least {mcr / 100}%. Add more collateral or reduce debt.
        </div>
      )}

      {debtRaw > 0n && debtRaw < minDebt && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
          Minimum debt is {formatZkUSD(minDebt)}.
        </div>
      )}

      {!hasEnoughBalance && collateralSats > 0n && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          Insufficient balance. You have {formatBTC(BigInt(balance))}.
        </div>
      )}

      {isConnected && collateralSats > 0n && !collateralUtxo && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
          No confirmed UTXO large enough for collateral. Wait for confirmation or add more BTC.
        </div>
      )}

      {isConnected && collateralSats > 0n && collateralUtxo && !feeUtxo && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
          <strong>Two separate UTXOs required.</strong> You need a second UTXO to pay transaction fees.
          Send a small amount of BTC (0.0001+) to create an additional UTXO.
        </div>
      )}
    </>
  );
}
