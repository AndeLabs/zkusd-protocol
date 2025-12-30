'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageLayout, Card, StatCard } from '@/components/shared';
import { useWallet, useZkUsd } from '@/lib';
import { formatZkUSD, formatBTC } from '@zkusd/utils';
import type { StabilityPoolState, StabilityPoolDeposit } from '@zkusd/types';

export default function StabilityPoolPage() {
  const { isConnected, address, signPsbt } = useWallet();
  const { client } = useZkUsd();

  const [depositAmount, setDepositAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Pool state from SDK
  const [poolState, setPoolState] = useState<StabilityPoolState | null>(null);
  const [userDeposit, setUserDeposit] = useState<StabilityPoolDeposit | null>(null);

  // Fetch pool state and user deposit
  const fetchData = useCallback(async () => {
    if (!client) return;

    setIsFetching(true);
    try {
      const state = await client.stabilityPool.getPoolState();
      setPoolState(state);

      if (address) {
        const deposit = await client.stabilityPool.getDeposit(address);
        setUserDeposit(deposit);
      }
    } catch (err) {
      console.error('Failed to fetch stability pool data:', err);
    } finally {
      setIsFetching(false);
    }
  }, [client, address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate user's pool share
  const userPoolShare = poolState && userDeposit && poolState.totalDeposits > 0n
    ? (Number(userDeposit.deposit) / Number(poolState.totalDeposits)) * 100
    : 0;

  const handleDeposit = async () => {
    if (!client || !address || !signPsbt || !depositAmount) return;

    const amount = BigInt(Math.floor(parseFloat(depositAmount) * 100_000_000));
    if (amount <= 0n) {
      setError('Please enter a valid amount');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTxStatus('Building transaction...');

    try {
      // Find zkUSD UTXO - in production would scan for charm state
      const zkusdUtxo = 'placeholder:0'; // Would come from user's zkUSD holdings
      const zkusdAmount = amount;

      setTxStatus('Building spell...');

      const spell = await client.stabilityPool.buildDepositSpell({
        amount,
        zkusdUtxo,
        zkusdAmount,
        depositorAddress: address,
        existingDeposit: userDeposit ?? undefined,
      });

      setTxStatus('Creating PSBT...');

      const psbtResponse = await client.createPsbt(spell);

      setTxStatus('Waiting for signature...');

      const signedPsbt = await signPsbt(psbtResponse.psbt);

      setTxStatus('Broadcasting transaction...');

      const txid = await client.broadcastTransaction(signedPsbt);

      setTxStatus(`Success! TX: ${txid.slice(0, 8)}...`);
      setDepositAmount('');

      // Refresh data after success
      setTimeout(() => {
        fetchData();
        setTxStatus(null);
      }, 3000);

    } catch (err) {
      console.error('Deposit failed:', err);
      setError(err instanceof Error ? err.message : 'Deposit failed');
      setTxStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!client || !address || !signPsbt || !userDeposit) return;

    setIsLoading(true);
    setError(null);
    setTxStatus('Building withdrawal transaction...');

    try {
      const depositUtxo = 'placeholder:0'; // Would come from user's deposit UTXO

      setTxStatus('Building spell...');

      const spell = await client.stabilityPool.buildWithdrawSpell({
        amount: 0n, // 0 = withdraw all
        depositUtxo,
        deposit: userDeposit,
        depositorAddress: address,
      });

      setTxStatus('Creating PSBT...');

      const psbtResponse = await client.createPsbt(spell);

      setTxStatus('Waiting for signature...');

      const signedPsbt = await signPsbt(psbtResponse.psbt);

      setTxStatus('Broadcasting transaction...');

      const txid = await client.broadcastTransaction(signedPsbt);

      setTxStatus(`Success! TX: ${txid.slice(0, 8)}...`);

      // Refresh data after success
      setTimeout(() => {
        fetchData();
        setTxStatus(null);
      }, 3000);

    } catch (err) {
      console.error('Withdrawal failed:', err);
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
      setTxStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimGains = async () => {
    if (!client || !address || !signPsbt || !userDeposit || userDeposit.collateralGain === 0n) return;

    setIsLoading(true);
    setError(null);
    setTxStatus('Claiming collateral gains...');

    try {
      const depositUtxo = 'placeholder:0';

      const spell = await client.stabilityPool.buildClaimGainsSpell({
        depositUtxo,
        deposit: userDeposit,
        depositorAddress: address,
      });

      const psbtResponse = await client.createPsbt(spell);
      const signedPsbt = await signPsbt(psbtResponse.psbt);
      const txid = await client.broadcastTransaction(signedPsbt);

      setTxStatus(`Gains claimed! TX: ${txid.slice(0, 8)}...`);

      setTimeout(() => {
        fetchData();
        setTxStatus(null);
      }, 3000);

    } catch (err) {
      console.error('Claim failed:', err);
      setError(err instanceof Error ? err.message : 'Claim failed');
      setTxStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageLayout
      title="Stability Pool"
      description="Earn liquidation gains by depositing zkUSD to the stability pool"
    >
      {/* Pool Stats */}
      <div className="grid md:grid-cols-4 gap-4">
        <StatCard
          label="Total Deposits"
          value={formatZkUSD(poolState?.totalDeposits ?? 0n)}
          subValue="zkUSD deposited"
        />
        <StatCard
          label="Collateral Gains"
          value={formatBTC(poolState?.totalCollateralGains ?? 0n)}
          subValue="BTC from liquidations"
        />
        <StatCard
          label="Est. APR"
          value="--"
          subValue="Based on liquidations"
        />
        <StatCard
          label="Depositors"
          value={(poolState?.depositorCount ?? 0).toString()}
          subValue="Active participants"
        />
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Deposit Form */}
        <div className="lg:col-span-2">
          <Card title="Manage Position" padding="lg">
            {!isConnected ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
                  <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-zinc-300 mb-2">Connect Wallet</h3>
                <p className="text-zinc-500 text-sm">Connect your wallet to deposit to the stability pool</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Current Position */}
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                  <h4 className="text-sm text-zinc-400 mb-3">Your Position</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-zinc-500">Deposited</div>
                      <div className="font-mono">{formatZkUSD(userDeposit?.deposit ?? 0n)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500">Collateral Gain</div>
                      <div className="font-mono text-green-400">{formatBTC(userDeposit?.collateralGain ?? 0n)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500">Pool Share</div>
                      <div className="font-mono">{userPoolShare.toFixed(2)}%</div>
                    </div>
                  </div>

                  {/* Claim gains button */}
                  {userDeposit && userDeposit.collateralGain > 0n && (
                    <button
                      onClick={handleClaimGains}
                      disabled={isLoading}
                      className="mt-3 w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm py-2 rounded transition-colors border border-green-500/30"
                    >
                      Claim {formatBTC(userDeposit.collateralGain)} BTC
                    </button>
                  )}
                </div>

                {/* Deposit Input */}
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Deposit Amount (zkUSD)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={isLoading}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                    />
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-400 hover:text-amber-300"
                      onClick={() => setDepositAmount('0')} // Would use actual zkUSD balance
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                {/* Status */}
                {txStatus && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-400">
                    {txStatus}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={handleDeposit}
                    disabled={isLoading || !depositAmount || parseFloat(depositAmount) <= 0}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-black font-semibold py-3 rounded-lg transition-colors"
                  >
                    {isLoading ? 'Processing...' : 'Deposit'}
                  </button>
                  <button
                    onClick={handleWithdraw}
                    disabled={isLoading || !userDeposit || userDeposit.deposit === 0n}
                    className="flex-1 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-700/50 text-white font-semibold py-3 rounded-lg transition-colors"
                  >
                    Withdraw All
                  </button>
                </div>

                {/* Contract Info */}
                <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-4 text-center">
                  <p className="text-zinc-500 text-sm">
                    Contract deployed at block 113,513
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* How It Works */}
          <Card title="How It Works" padding="md">
            <ol className="space-y-3 text-sm text-zinc-400">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">1</span>
                <span>Deposit zkUSD to the stability pool</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">2</span>
                <span>Your zkUSD is used to liquidate unhealthy vaults</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">3</span>
                <span>Receive discounted BTC collateral as reward</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">4</span>
                <span>Withdraw zkUSD + BTC gains anytime</span>
              </li>
            </ol>
          </Card>

          {/* Benefits */}
          <Card title="Benefits" padding="md">
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Earn BTC at a discount during liquidations</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Help maintain protocol stability</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>No impermanent loss risk</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Withdraw anytime - no lock-up</span>
              </li>
            </ul>
          </Card>

          {/* Links */}
          <Card padding="md">
            <div className="space-y-2">
              <a
                href="/vaults"
                className="block w-full text-center bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2 rounded transition-colors"
              >
                Manage Vaults
              </a>
              <a
                href="/"
                className="block w-full text-center bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2 rounded transition-colors"
              >
                Back to Dashboard
              </a>
            </div>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
