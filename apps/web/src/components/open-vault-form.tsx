'use client';

import { useState, useMemo, useCallback } from 'react';
import { useProtocol, useWallet, useNetwork, useZkUsd } from '@/lib';
import { formatBTC, formatZkUSD, formatUSD, btcToSats, calculateICR, calculateLiquidationPrice, calculateMaxMintable } from '@zkusd/utils';

type FormStep = 'input' | 'confirm' | 'signing' | 'broadcasting' | 'success' | 'error';

export function OpenVaultForm() {
  const { oracle, protocol } = useProtocol();
  const { isConnected, address, balance, utxos, signPsbt, refreshBalance } = useWallet();
  const { config } = useNetwork();
  const { client, btcPrice: zkusdBtcPrice, feeEstimates, deploymentConfig, isReady } = useZkUsd();

  const [collateralBtc, setCollateralBtc] = useState('');
  const [debtZkusd, setDebtZkusd] = useState('');
  const [formStep, setFormStep] = useState<FormStep>('input');
  const [txResult, setTxResult] = useState<{ commitTxId?: string; spellTxId?: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Use price from zkUsd context if available, fallback to protocol context
  const btcPrice = oracle?.priceUsd ?? (zkusdBtcPrice ? Number(zkusdBtcPrice) / 100_000_000 : 0);
  const priceScaled = oracle?.price ?? zkusdBtcPrice ?? 0n;
  const minDebt = config.protocolParams.minDebt;
  const mcr = config.protocolParams.mcr;

  const collateralSats = useMemo(() => {
    const btc = parseFloat(collateralBtc) || 0;
    return btcToSats(btc);
  }, [collateralBtc]);

  const debtRaw = useMemo(() => {
    const zkusd = parseFloat(debtZkusd) || 0;
    return BigInt(Math.floor(zkusd * 100_000_000));
  }, [debtZkusd]);

  // Calculate fee (base rate + 0.5%)
  const feeRate = (protocol?.baseRate ?? 50) + 50; // basis points
  const fee = debtRaw > 0n ? (debtRaw * BigInt(feeRate)) / 10000n : 0n;
  const totalDebt = debtRaw + fee;

  const icr = useMemo(() => {
    if (collateralSats === 0n || totalDebt === 0n || priceScaled === 0n) return 0;
    return calculateICR(collateralSats, totalDebt, priceScaled);
  }, [collateralSats, totalDebt, priceScaled]);

  const liquidationPrice = useMemo(() => {
    if (collateralSats === 0n || totalDebt === 0n) return 0n;
    return calculateLiquidationPrice(collateralSats, totalDebt);
  }, [collateralSats, totalDebt]);

  const maxMintable = useMemo(() => {
    if (collateralSats === 0n || priceScaled === 0n) return 0n;
    return calculateMaxMintable(collateralSats, priceScaled, 0n);
  }, [collateralSats, priceScaled]);

  const collateralUsd = (parseFloat(collateralBtc) || 0) * btcPrice;
  const hasEnoughBalance = collateralSats <= BigInt(balance);

  // Find suitable UTXO for funding
  const fundingUtxo = useMemo(() => {
    // Need enough for collateral + estimated fees (10000 sats for now)
    const requiredSats = Number(collateralSats) + 10000;
    return utxos.find(u => u.value >= requiredSats && u.status.confirmed);
  }, [utxos, collateralSats]);

  const isValid = useMemo(() => {
    return (
      isConnected &&
      collateralSats > 0n &&
      debtRaw >= minDebt &&
      icr >= mcr &&
      hasEnoughBalance &&
      fundingUtxo !== undefined
    );
  }, [isConnected, collateralSats, debtRaw, icr, minDebt, mcr, hasEnoughBalance, fundingUtxo]);

  const getIcrColor = () => {
    if (icr === 0) return 'text-zinc-500';
    if (icr < mcr) return 'text-red-400';
    if (icr < 15000) return 'text-yellow-400';
    return 'text-green-400';
  };

  const handleSetMax = () => {
    // Leave some sats for fees
    const maxBtc = Math.max(0, (Number(balance) - 10000)) / 100_000_000;
    setCollateralBtc(maxBtc.toFixed(8));
  };

  const handleSetMaxDebt = () => {
    if (maxMintable > 0n) {
      const maxZkusd = Number(maxMintable) / 100_000_000;
      // Set to 90% of max to account for fees
      setDebtZkusd((maxZkusd * 0.9).toFixed(2));
    }
  };

  const resetForm = useCallback(() => {
    setFormStep('input');
    setTxResult(null);
    setErrorMessage(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !client || !deploymentConfig || !fundingUtxo || !address) return;

    setFormStep('confirm');
  };

  const handleConfirm = async () => {
    if (!client || !deploymentConfig || !fundingUtxo || !address) return;

    setErrorMessage(null);

    try {
      setFormStep('signing');

      // Build the spell using SDK's VaultService
      const spell = await client.vault.buildOpenVaultSpell({
        collateral: collateralSats,
        debt: debtRaw,
        owner: address,
        fundingUtxo: `${fundingUtxo.txid}:${fundingUtxo.vout}`,
        ownerAddress: address,
        ownerPubkey: address, // In production, would get actual pubkey from wallet
      });

      // Get previous transactions
      const prevTxHex = await client.getRawTransaction(fundingUtxo.txid);

      setFormStep('broadcasting');

      // Execute the spell
      const result = await client.executeAndBroadcast({
        spell,
        binaries: {}, // Would need actual binaries in production
        prevTxs: [prevTxHex],
        fundingUtxo: `${fundingUtxo.txid}:${fundingUtxo.vout}`,
        fundingUtxoValue: fundingUtxo.value,
        changeAddress: address,
        signTransaction: signPsbt,
      });

      setTxResult({
        commitTxId: result.commitTxId,
        spellTxId: result.spellTxId,
      });
      setFormStep('success');

      // Refresh balance
      await refreshBalance();

    } catch (error) {
      console.error('Failed to open vault:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to open vault');
      setFormStep('error');
    }
  };

  // Render based on form step
  if (formStep === 'confirm') {
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
            onClick={resetForm}
            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-3 sm:py-4 rounded-lg transition-colors min-h-touch text-sm sm:text-base"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold py-3 sm:py-4 rounded-lg transition-colors min-h-touch text-sm sm:text-base"
          >
            Confirm & Sign
          </button>
        </div>
      </div>
    );
  }

  if (formStep === 'signing') {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <h3 className="text-xl font-bold mb-2">Signing Transaction</h3>
        <p className="text-zinc-400 text-sm">Please approve the transaction in your wallet</p>
      </div>
    );
  }

  if (formStep === 'broadcasting') {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <h3 className="text-xl font-bold mb-2">Broadcasting Transaction</h3>
        <p className="text-zinc-400 text-sm">Your vault is being created on Bitcoin...</p>
      </div>
    );
  }

  if (formStep === 'success' && txResult) {
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
            href={`${config.explorerUrl}/tx/${txResult.spellTxId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-amber-400 hover:underline text-sm"
          >
            View on Explorer →
          </a>
        )}

        <button
          onClick={() => {
            resetForm();
            setCollateralBtc('');
            setDebtZkusd('');
          }}
          className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-3 rounded-lg transition-colors mt-4"
        >
          Open Another Vault
        </button>
      </div>
    );
  }

  if (formStep === 'error') {
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
          onClick={resetForm}
          className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-3 rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Default: input form
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
              onClick={handleSetMax}
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
            onChange={(e) => setCollateralBtc(e.target.value)}
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
              onClick={handleSetMaxDebt}
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
            onChange={(e) => setDebtZkusd(e.target.value)}
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

      {isConnected && collateralSats > 0n && !fundingUtxo && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
          No confirmed UTXO large enough found. Wait for confirmation or add more BTC.
        </div>
      )}

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
