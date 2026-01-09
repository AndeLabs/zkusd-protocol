'use client';

import { useState, useMemo, useCallback } from 'react';
import { useProtocol, useWallet, useNetwork, useZkUsd } from '@/lib';
import { btcToSats, calculateICR, calculateLiquidationPrice, calculateMaxMintable } from '@zkusd/utils';
import { FEE_BUFFER_SATS } from '@/config';
import type { FormStep, TxResult, VaultCalculations, VaultValidation, VaultFormActions } from './types';

export function useVaultForm() {
  const { oracle, protocol } = useProtocol();
  const { isConnected, address, balance, utxos, signPsbt, refreshBalance } = useWallet();
  const { config } = useNetwork();
  const { client, btcPrice: zkusdBtcPrice, feeEstimates, deploymentConfig, isReady } = useZkUsd();

  // Form state
  const [collateralBtc, setCollateralBtc] = useState('');
  const [debtZkusd, setDebtZkusd] = useState('');
  const [formStep, setFormStep] = useState<FormStep>('input');
  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derived values
  const btcPrice = oracle?.priceUsd ?? (zkusdBtcPrice ? Number(zkusdBtcPrice) / 100_000_000 : 0);
  const priceScaled = oracle?.price ?? zkusdBtcPrice ?? 0n;
  const minDebt = config.protocolParams.minDebt;
  const mcr = config.protocolParams.mcr;

  // Calculations
  const calculations: VaultCalculations = useMemo(() => {
    const collateralSats = btcToSats(parseFloat(collateralBtc) || 0);
    const debtRaw = BigInt(Math.floor((parseFloat(debtZkusd) || 0) * 100_000_000));

    const feeRate = (protocol?.baseRate ?? 50) + 50;
    const fee = debtRaw > 0n ? (debtRaw * BigInt(feeRate)) / 10000n : 0n;
    const totalDebt = debtRaw + fee;

    const icr = collateralSats === 0n || totalDebt === 0n || priceScaled === 0n
      ? 0
      : calculateICR(collateralSats, totalDebt, priceScaled);

    const liquidationPrice = collateralSats === 0n || totalDebt === 0n
      ? 0n
      : calculateLiquidationPrice(collateralSats, totalDebt);

    const maxMintable = collateralSats === 0n || priceScaled === 0n
      ? 0n
      : calculateMaxMintable(collateralSats, priceScaled, 0n);

    const collateralUsd = (parseFloat(collateralBtc) || 0) * btcPrice;

    return {
      collateralSats,
      debtRaw,
      fee,
      totalDebt,
      icr,
      liquidationPrice,
      maxMintable,
      collateralUsd,
      feeRate,
    };
  }, [collateralBtc, debtZkusd, protocol?.baseRate, priceScaled, btcPrice]);

  // Validation
  const validation: VaultValidation = useMemo(() => {
    const hasEnoughBalance = calculations.collateralSats <= BigInt(balance);

    const fundingUtxo = utxos.find(u =>
      u.value >= Number(calculations.collateralSats) + FEE_BUFFER_SATS && u.status.confirmed
    );

    const isValid =
      isConnected &&
      calculations.collateralSats > 0n &&
      calculations.debtRaw >= minDebt &&
      calculations.icr >= mcr &&
      hasEnoughBalance &&
      fundingUtxo !== undefined;

    return { isValid, hasEnoughBalance, fundingUtxo };
  }, [calculations, balance, utxos, isConnected, minDebt, mcr]);

  // Actions
  const handleSetMax = useCallback(() => {
    const maxBtc = Math.max(0, (Number(balance) - FEE_BUFFER_SATS)) / 100_000_000;
    setCollateralBtc(maxBtc.toFixed(8));
  }, [balance]);

  const handleSetMaxDebt = useCallback(() => {
    if (calculations.maxMintable > 0n) {
      const maxZkusd = Number(calculations.maxMintable) / 100_000_000;
      setDebtZkusd((maxZkusd * 0.9).toFixed(2));
    }
  }, [calculations.maxMintable]);

  const resetForm = useCallback(() => {
    setFormStep('input');
    setTxResult(null);
    setErrorMessage(null);
  }, []);

  const resetAll = useCallback(() => {
    resetForm();
    setCollateralBtc('');
    setDebtZkusd('');
  }, [resetForm]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.isValid || !client || !deploymentConfig || !validation.fundingUtxo || !address) return;
    setFormStep('confirm');
  }, [validation.isValid, client, deploymentConfig, validation.fundingUtxo, address]);

  const handleConfirm = useCallback(async () => {
    if (!client || !deploymentConfig || !validation.fundingUtxo || !address) return;

    setErrorMessage(null);

    try {
      setFormStep('signing');

      const spell = await client.vault.buildOpenVaultSpell({
        collateral: calculations.collateralSats,
        debt: calculations.debtRaw,
        owner: address,
        fundingUtxo: `${validation.fundingUtxo.txid}:${validation.fundingUtxo.vout}`,
        ownerAddress: address,
        ownerPubkey: address,
      });

      const prevTxHex = await client.getRawTransaction(validation.fundingUtxo.txid);

      setFormStep('broadcasting');

      const result = await client.executeAndBroadcast({
        spell,
        binaries: {},
        prevTxs: [prevTxHex],
        fundingUtxo: `${validation.fundingUtxo.txid}:${validation.fundingUtxo.vout}`,
        fundingUtxoValue: validation.fundingUtxo.value,
        changeAddress: address,
        signTransaction: signPsbt,
      });

      setTxResult({
        commitTxId: result.commitTxId,
        spellTxId: result.spellTxId,
      });
      setFormStep('success');

      await refreshBalance();
    } catch (error) {
      console.error('Failed to open vault:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to open vault');
      setFormStep('error');
    }
  }, [client, deploymentConfig, validation.fundingUtxo, address, calculations, signPsbt, refreshBalance]);

  const actions: VaultFormActions = {
    setCollateralBtc,
    setDebtZkusd,
    handleSetMax,
    handleSetMaxDebt,
    handleSubmit,
    handleConfirm,
    resetForm,
  };

  return {
    // State
    collateralBtc,
    debtZkusd,
    formStep,
    txResult,
    errorMessage,

    // Derived
    btcPrice,
    priceScaled,
    minDebt,
    mcr,
    balance,
    isConnected,
    isReady,
    feeEstimates,
    explorerUrl: config.explorerUrl,

    // Calculations & Validation
    calculations,
    validation,

    // Actions
    actions,
    resetAll,
  };
}
