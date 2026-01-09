'use client';

import { useState, useMemo, useCallback } from 'react';
import { useProtocol, useWallet, useNetwork, useZkUsd } from '@/lib';
import { btcToSats, calculateICR, calculateLiquidationPrice, calculateMaxMintable } from '@zkusd/utils';
import { FEE_BUFFER_SATS } from '@/config';
import type { FormStep, TxResult, VaultCalculations, VaultValidation, VaultFormActions } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Satoshis per BTC */
const SATS_PER_BTC = 100_000_000;

/** Base fee rate added to protocol base rate (basis points) */
const BASE_FEE_FLOOR_BPS = 50;

/** Basis points denominator */
const BPS_DENOMINATOR = 10_000n;

/** Safety margin for max debt (90% of theoretical max) */
const MAX_DEBT_SAFETY_MARGIN = 0.9;

// ============================================================================
// Hook
// ============================================================================

export function useVaultForm() {
  // External state
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

  // Derived protocol values
  const btcPrice = oracle?.priceUsd ?? (zkusdBtcPrice ? Number(zkusdBtcPrice) / SATS_PER_BTC : 0);
  const priceScaled = oracle?.price ?? zkusdBtcPrice ?? 0n;
  const minDebt = config.protocolParams.minDebt;
  const mcr = config.protocolParams.mcr;

  // ============================================================================
  // Calculations
  // ============================================================================

  const calculations: VaultCalculations = useMemo(() => {
    const collateralSats = btcToSats(parseFloat(collateralBtc) || 0);
    const debtRaw = BigInt(Math.floor((parseFloat(debtZkusd) || 0) * SATS_PER_BTC));

    // Calculate opening fee
    const feeRate = (protocol?.baseRate ?? BASE_FEE_FLOOR_BPS) + BASE_FEE_FLOOR_BPS;
    const fee = debtRaw > 0n ? (debtRaw * BigInt(feeRate)) / BPS_DENOMINATOR : 0n;
    const totalDebt = debtRaw + fee;

    // Calculate collateral ratio
    const icr = collateralSats === 0n || totalDebt === 0n || priceScaled === 0n
      ? 0
      : calculateICR(collateralSats, totalDebt, priceScaled);

    // Calculate liquidation price
    const liquidationPrice = collateralSats === 0n || totalDebt === 0n
      ? 0n
      : calculateLiquidationPrice(collateralSats, totalDebt);

    // Calculate max mintable
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

  // ============================================================================
  // Validation
  // ============================================================================

  const validation: VaultValidation = useMemo(() => {
    const hasEnoughBalance = calculations.collateralSats <= BigInt(balance);

    // Find best UTXO: confirmed, large enough for collateral + fees
    const fundingUtxo = utxos
      .filter(u => u.status.confirmed)
      .sort((a, b) => b.value - a.value) // Largest first
      .find(u => u.value >= Number(calculations.collateralSats) + FEE_BUFFER_SATS);

    const hasEnoughUtxos = fundingUtxo !== undefined;

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
      fundingUtxo,
    };
  }, [calculations, balance, utxos, isConnected, minDebt, mcr]);

  // ============================================================================
  // Actions
  // ============================================================================

  const handleSetMax = useCallback(() => {
    const maxBtc = Math.max(0, (Number(balance) - FEE_BUFFER_SATS)) / SATS_PER_BTC;
    setCollateralBtc(maxBtc.toFixed(8));
  }, [balance]);

  const handleSetMaxDebt = useCallback(() => {
    if (calculations.maxMintable > 0n) {
      const maxZkusd = Number(calculations.maxMintable) / SATS_PER_BTC;
      setDebtZkusd((maxZkusd * MAX_DEBT_SAFETY_MARGIN).toFixed(2));
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
    if (!validation.isValid || !client || !deploymentConfig || !validation.fundingUtxo || !address) {
      return;
    }
    setFormStep('confirm');
  }, [validation.isValid, client, deploymentConfig, validation.fundingUtxo, address]);

  const handleConfirm = useCallback(async () => {
    if (!client || !deploymentConfig || !validation.fundingUtxo || !address) {
      return;
    }

    setErrorMessage(null);

    try {
      setFormStep('signing');

      const fundingUtxoId = `${validation.fundingUtxo.txid}:${validation.fundingUtxo.vout}`;

      // Build the spell
      const spell = await client.vault.buildOpenVaultSpell({
        collateral: calculations.collateralSats,
        debt: calculations.debtRaw,
        owner: address,
        fundingUtxo: fundingUtxoId,
        ownerAddress: address,
        ownerPubkey: address,
      });

      // Get raw transaction for UTXO verification
      const prevTxHex = await client.getRawTransaction(validation.fundingUtxo.txid);

      setFormStep('broadcasting');

      // Execute and broadcast
      const result = await client.executeAndBroadcast({
        spell,
        binaries: {},
        prevTxs: [prevTxHex],
        fundingUtxo: fundingUtxoId,
        fundingUtxoValue: validation.fundingUtxo.value,
        changeAddress: address,
        signTransaction: signPsbt,
      });

      setTxResult({
        commitTxId: result.commitTxId,
        spellTxId: result.spellTxId,
      });
      setFormStep('success');

      // Refresh wallet balance
      await refreshBalance();
    } catch (error) {
      console.error('[OpenVault] Transaction failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Transaction failed');
      setFormStep('error');
    }
  }, [client, deploymentConfig, validation.fundingUtxo, address, calculations, signPsbt, refreshBalance]);

  // ============================================================================
  // Return
  // ============================================================================

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

    // Protocol values
    btcPrice,
    priceScaled,
    minDebt,
    mcr,
    balance,
    isConnected,
    isReady,
    feeEstimates,
    explorerUrl: config.explorerUrl,

    // Computed
    calculations,
    validation,

    // Actions
    actions,
    resetAll,
  };
}
