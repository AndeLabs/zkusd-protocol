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
  // CRITICAL: Charms requires TWO SEPARATE UTXOs:
  // 1. collateralUtxo - goes into spell.ins (becomes the vault)
  // 2. feeUtxo - used as funding_utxo for transaction fees
  const validation: VaultValidation = useMemo(() => {
    const hasEnoughBalance = calculations.collateralSats <= BigInt(balance);

    // Sort UTXOs by value (largest first) for optimal selection
    const confirmedUtxos = utxos
      .filter(u => u.status.confirmed)
      .sort((a, b) => b.value - a.value);

    // Find collateral UTXO: must cover the collateral amount
    const collateralUtxo = confirmedUtxos.find(u =>
      u.value >= Number(calculations.collateralSats)
    );

    // Find fee UTXO: must be DIFFERENT from collateral UTXO and cover fees
    const feeUtxo = confirmedUtxos.find(u =>
      u.value >= FEE_BUFFER_SATS &&
      (!collateralUtxo || u.txid !== collateralUtxo.txid || u.vout !== collateralUtxo.vout)
    );

    const hasEnoughUtxos = collateralUtxo !== undefined && feeUtxo !== undefined;

    const isValid =
      isConnected &&
      calculations.collateralSats > 0n &&
      calculations.debtRaw >= minDebt &&
      calculations.icr >= mcr &&
      hasEnoughBalance &&
      hasEnoughUtxos;

    return {
      isValid,
      hasEnoughBalance,
      hasEnoughUtxos,
      collateralUtxo,
      feeUtxo,
      fundingUtxo: collateralUtxo, // Deprecated, kept for compatibility
    };
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
    // CRITICAL: We need TWO SEPARATE UTXOs for Charms protocol
    if (!client || !deploymentConfig || !validation.collateralUtxo || !validation.feeUtxo || !address) return;

    setErrorMessage(null);

    try {
      setFormStep('signing');

      // collateralUtxo goes into spell.ins (becomes the vault)
      const collateralUtxoId = `${validation.collateralUtxo.txid}:${validation.collateralUtxo.vout}`;
      // feeUtxo is the funding_utxo for transaction fees (MUST BE DIFFERENT)
      const feeUtxoId = `${validation.feeUtxo.txid}:${validation.feeUtxo.vout}`;

      console.log('[OpenVault] Collateral UTXO:', collateralUtxoId);
      console.log('[OpenVault] Fee UTXO:', feeUtxoId);

      const spell = await client.vault.buildOpenVaultSpell({
        collateral: calculations.collateralSats,
        debt: calculations.debtRaw,
        owner: address,
        fundingUtxo: collateralUtxoId, // This goes into spell.ins
        ownerAddress: address,
        ownerPubkey: address,
      });

      // Get raw transactions for BOTH UTXOs
      const [collateralTxHex, feeTxHex] = await Promise.all([
        client.getRawTransaction(validation.collateralUtxo.txid),
        validation.feeUtxo.txid !== validation.collateralUtxo.txid
          ? client.getRawTransaction(validation.feeUtxo.txid)
          : Promise.resolve(''), // Same tx, no need to fetch twice
      ]);

      // prev_txs needs both transactions (deduplicated)
      const prevTxs = feeTxHex ? [collateralTxHex, feeTxHex] : [collateralTxHex];

      setFormStep('broadcasting');

      const result = await client.executeAndBroadcast({
        spell,
        binaries: {},
        prevTxs,
        fundingUtxo: feeUtxoId, // DIFFERENT from spell.ins UTXO!
        fundingUtxoValue: validation.feeUtxo.value,
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
  }, [client, deploymentConfig, validation.collateralUtxo, validation.feeUtxo, address, calculations, signPsbt, refreshBalance]);

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
