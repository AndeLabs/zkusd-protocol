'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useWallet } from '@/stores/wallet';
import {
  useStabilityPoolState,
  useUserDeposit,
  useStabilityPoolDeposit,
  useStabilityPoolWithdraw,
} from '@/features/stability-pool';
import { Button, Input, MaxButton, Skeleton } from '@/components/ui';
import { formatZkUSD, formatBTC } from '@/lib/utils';

export function StabilityPoolForm() {
  const { isConnected, connect } = useWallet();
  const { data: poolState, isLoading: poolLoading } = useStabilityPoolState();
  const { data: userDeposit, isLoading: depositLoading } = useUserDeposit();
  const { deposit, isLoading: depositingLoading } = useStabilityPoolDeposit();
  const { withdraw, isLoading: withdrawingLoading } = useStabilityPoolWithdraw();

  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amountInput, setAmountInput] = useState('');

  const amountRaw = useMemo(() => {
    const parsed = parseFloat(amountInput);
    if (isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * 1e8));
  }, [amountInput]);

  const handleSubmit = useCallback(async () => {
    if (!isConnected) {
      connect();
      return;
    }

    if (amountRaw === 0n) return;

    try {
      if (mode === 'deposit') {
        await deposit(amountRaw);
      } else {
        await withdraw(amountRaw);
      }
      setAmountInput('');
    } catch (error) {
      // Error handled in hooks
    }
  }, [isConnected, connect, mode, amountRaw, deposit, withdraw]);

  const handleMaxWithdraw = useCallback(() => {
    if (userDeposit?.deposit) {
      setAmountInput((Number(userDeposit.deposit) / 1e8).toString());
    }
  }, [userDeposit]);

  const isLoading = depositingLoading || withdrawingLoading;

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex rounded-lg bg-zinc-800 p-1">
        <button
          onClick={() => setMode('deposit')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            mode === 'deposit'
              ? 'bg-amber-500 text-black'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Deposit
        </button>
        <button
          onClick={() => setMode('withdraw')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            mode === 'withdraw'
              ? 'bg-amber-500 text-black'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Withdraw
        </button>
      </div>

      {/* Pool Stats */}
      <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-800/50 rounded-xl">
        <div>
          <p className="text-xs text-zinc-500 mb-1">Total Pool Deposits</p>
          {poolLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : (
            <p className="font-mono text-white">
              {formatZkUSD(poolState?.totalDeposits ?? 0n)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Liquidation Rewards</p>
          {poolLoading ? (
            <Skeleton className="h-5 w-20" />
          ) : (
            <p className="font-mono text-white">
              {formatBTC(Number(poolState?.totalCollateralGains ?? 0n))}
            </p>
          )}
        </div>
      </div>

      {/* User Position */}
      {isConnected && (
        <div className="p-4 bg-zinc-800/50 rounded-xl">
          <p className="text-xs text-zinc-500 mb-2">Your Position</p>
          {depositLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : userDeposit ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-400">Deposited</span>
                <span className="font-mono text-white">
                  {formatZkUSD(userDeposit.deposit)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">BTC Rewards</span>
                <span className="font-mono text-amber-400">
                  {formatBTC(Number(userDeposit.collateralGain))}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-zinc-400 text-sm">No active deposit</p>
          )}
        </div>
      )}

      {/* Amount Input */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm text-zinc-400">
            {mode === 'deposit' ? 'Deposit Amount (zkUSD)' : 'Withdraw Amount (zkUSD)'}
          </label>
          {mode === 'withdraw' && userDeposit && (
            <span className="text-xs text-zinc-500">
              Available: {formatZkUSD(userDeposit.deposit)}
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
          rightElement={
            mode === 'withdraw' && userDeposit ? (
              <MaxButton onClick={handleMaxWithdraw} />
            ) : undefined
          }
        />
      </div>

      {/* Info */}
      <div className="text-xs text-zinc-500 space-y-1">
        <p>• Earn BTC from liquidated vaults proportionally to your deposit</p>
        <p>• Deposits may be used to absorb debt during liquidations</p>
        <p>• Withdraw anytime with accumulated rewards</p>
      </div>

      {/* Submit Button */}
      <Button
        fullWidth
        size="lg"
        onClick={handleSubmit}
        loading={isLoading}
        disabled={isConnected && amountRaw === 0n}
      >
        {!isConnected
          ? 'Connect Wallet'
          : isLoading
            ? 'Processing...'
            : mode === 'deposit'
              ? 'Deposit zkUSD'
              : 'Withdraw zkUSD'}
      </Button>

      {/* Note about zkUSD requirement */}
      {isConnected && mode === 'deposit' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg"
        >
          <p className="text-xs text-amber-400">
            To deposit, you need zkUSD tokens. Open a vault first to mint zkUSD against your BTC collateral.
          </p>
        </motion.div>
      )}
    </div>
  );
}
