'use client';

import { useVaultForm } from './use-vault-form';
import { VaultInputForm } from './vault-input-form';
import { VaultConfirm } from './vault-confirm';
import { VaultStatus } from './vault-status';
import { VaultSuccess, VaultError } from './vault-result';

export function OpenVaultForm() {
  const {
    collateralBtc,
    debtZkusd,
    formStep,
    txResult,
    errorMessage,
    balance,
    minDebt,
    mcr,
    isConnected,
    isReady,
    feeEstimates,
    explorerUrl,
    calculations,
    validation,
    actions,
    resetAll,
  } = useVaultForm();

  // Render based on form step
  switch (formStep) {
    case 'confirm':
      return (
        <VaultConfirm
          collateralBtc={collateralBtc}
          calculations={calculations}
          mcr={mcr}
          onConfirm={actions.handleConfirm}
          onCancel={actions.resetForm}
        />
      );

    case 'signing':
      return <VaultStatus step="signing" />;

    case 'broadcasting':
      return <VaultStatus step="broadcasting" />;

    case 'success':
      if (!txResult) return null;
      return (
        <VaultSuccess
          collateralBtc={collateralBtc}
          debtRaw={calculations.debtRaw}
          txResult={txResult}
          explorerUrl={explorerUrl}
          onReset={resetAll}
        />
      );

    case 'error':
      return (
        <VaultError
          errorMessage={errorMessage}
          onRetry={actions.resetForm}
        />
      );

    case 'input':
    default:
      return (
        <VaultInputForm
          collateralBtc={collateralBtc}
          debtZkusd={debtZkusd}
          calculations={calculations}
          validation={validation}
          actions={actions}
          balance={balance}
          minDebt={minDebt}
          mcr={mcr}
          isConnected={isConnected}
          isReady={isReady}
          feeEstimates={feeEstimates}
        />
      );
  }
}

// Re-export for external use
export * from './types';
export { useVaultForm } from './use-vault-form';
