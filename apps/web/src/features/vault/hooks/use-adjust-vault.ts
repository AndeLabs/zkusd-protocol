'use client';

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWallet } from '@/stores/wallet';
import { useVaultsStore, type TrackedVault } from '@/stores/vaults';
import { getClient } from '@/lib/sdk';

export interface AdjustVaultParams {
  vault: TrackedVault;
  collateralChange: bigint;
  isCollateralIncrease: boolean;
  debtChange: bigint;
  isDebtIncrease: boolean;
}

export interface AdjustVaultResult {
  txId: string;
  newCollateral: bigint;
  newDebt: bigint;
}

type AdjustStatus =
  | 'idle'
  | 'building_spell'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'success'
  | 'error';

export function useAdjustVault() {
  const { address, publicKey, isConnected } = useWallet();
  const updateVault = useVaultsStore((s) => s.updateVault);
  const [status, setStatus] = useState<AdjustStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const adjustVault = useCallback(
    async (params: AdjustVaultParams): Promise<AdjustVaultResult> => {
      if (!isConnected || !address || !publicKey) {
        throw new Error('Wallet not connected');
      }

      if (!window.unisat) {
        throw new Error('Unisat wallet not found');
      }

      const client = getClient();

      try {
        setStatus('building_spell');
        setError(null);

        // Calculate new values
        const collateralDelta = params.isCollateralIncrease
          ? params.collateralChange
          : -params.collateralChange;
        const debtDelta = params.isDebtIncrease
          ? params.debtChange
          : -params.debtChange;

        const newCollateral = params.vault.collateral + collateralDelta;
        const newDebt = params.vault.debt + debtDelta;

        // Get current block height
        const currentBlock = await client.getBlockHeight();

        // Find additional BTC UTXO if adding collateral
        let additionalBtcUtxo: string | undefined;
        let fundingUtxoValue = Number(params.vault.collateral); // Default to vault collateral

        if (params.isCollateralIncrease && params.collateralChange > 0n) {
          const utxos = await client.getAddressUtxos(address);
          // Get fee estimate for dynamic buffer calculation
          const feeEstimate = await client.getFeeEstimates();
          const estimatedFee = Math.ceil(feeEstimate.halfHourFee * 1500); // ~1500 vbytes for adjust
          const feeBuffer = Math.max(estimatedFee, 10000); // At least 10k sats buffer

          const requiredAmount = Number(params.collateralChange) + feeBuffer;
          const fundingUtxo = utxos
            .filter((u) => u.status?.confirmed && `${u.txid}:${u.vout}` !== params.vault.utxo)
            .sort((a, b) => b.value - a.value)
            .find((u) => u.value >= requiredAmount);

          if (!fundingUtxo) {
            throw new Error(`No UTXO available for adding collateral. Need ${requiredAmount} sats (including ~${feeBuffer} sats for fees)`);
          }
          additionalBtcUtxo = `${fundingUtxo.txid}:${fundingUtxo.vout}`;
          fundingUtxoValue = fundingUtxo.value;
        }

        // Note: For debt repayment, we'd need zkUSD UTXO from indexer
        // For now, only support adding collateral and borrowing more
        if (!params.isDebtIncrease && params.debtChange > 0n) {
          throw new Error('Debt repayment requires zkUSD tokens. First open a vault to mint zkUSD.');
        }

        // Build the adjust spell
        const spell = await client.vault.buildAdjustVaultSpell({
          vaultId: params.vault.id,
          vaultUtxo: params.vault.utxo,
          vaultState: {
            id: params.vault.id,
            owner: params.vault.owner,
            collateral: params.vault.collateral,
            debt: params.vault.debt,
            createdAt: params.vault.createdAt,
            lastUpdated: params.vault.lastUpdated,
            interestRateBps: params.vault.interestRateBps,
            accruedInterest: params.vault.accruedInterest,
            redistributedDebt: params.vault.redistributedDebt,
            redistributedCollateral: params.vault.redistributedCollateral,
            insuranceBalance: params.vault.insuranceBalance,
          },
          ownerAddress: address,
          collateralChange: params.collateralChange,
          isCollateralIncrease: params.isCollateralIncrease,
          debtChange: params.debtChange,
          isDebtIncrease: params.isDebtIncrease,
          additionalBtcUtxo,
          currentBlock,
        });

        setStatus('proving');
        toast.loading('Loading app binaries...', { id: 'adjust-tx' });

        // Get previous transactions
        const prevTxs: string[] = [];
        const vaultTxId = params.vault.utxo.split(':')[0];
        prevTxs.push(await client.getRawTransaction(vaultTxId));

        if (additionalBtcUtxo) {
          const btcTxId = additionalBtcUtxo.split(':')[0];
          prevTxs.push(await client.getRawTransaction(btcTxId));
        }

        // Get deployment config
        const config = await client.getDeploymentConfig();

        // Validate WASM paths exist
        if (!config.contracts.vaultManager.wasmPath || !config.contracts.zkusdToken.wasmPath) {
          throw new Error('WASM binary paths not configured for this network');
        }

        // Load WASM binaries and encode as base64
        const loadBinary = async (path: string): Promise<string> => {
          const response = await fetch(path);
          if (!response.ok) throw new Error(`Failed to load binary: ${path}`);
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return btoa(binary);
        };

        const [vmBinary, tokenBinary] = await Promise.all([
          loadBinary(config.contracts.vaultManager.wasmPath),
          loadBinary(config.contracts.zkusdToken.wasmPath),
        ]);

        toast.loading('Generating zero-knowledge proof...', { id: 'adjust-tx' });

        // Get fee estimate
        const fees = await client.getFeeEstimates();

        // Execute the spell through the prover
        const proveResult = await client.executeSpell({
          spell,
          binaries: {
            [config.contracts.vaultManager.vk]: vmBinary,
            [config.contracts.zkusdToken.vk]: tokenBinary,
          },
          prevTxs,
          fundingUtxo: additionalBtcUtxo || params.vault.utxo,
          fundingUtxoValue,
          changeAddress: address,
          feeRate: fees.halfHourFee,
        });

        setStatus('signing');
        toast.loading('Please sign the transaction in your wallet...', {
          id: 'adjust-tx',
        });

        // Sign transactions
        let signedCommitTx: string;
        let signedSpellTx: string;

        try {
          signedCommitTx = await window.unisat.signPsbt(proveResult.commitTx, {
            autoFinalized: true,
          });
          signedSpellTx = await window.unisat.signPsbt(proveResult.spellTx, {
            autoFinalized: true,
          });
        } catch (signError) {
          const errorMessage = signError instanceof Error ? signError.message : String(signError);
          if (errorMessage.toLowerCase().includes('user rejected') ||
              errorMessage.toLowerCase().includes('cancelled') ||
              errorMessage.toLowerCase().includes('denied')) {
            throw new Error('Transaction signing was cancelled');
          }
          console.warn('[AdjustVault] PSBT signing failed, using original transactions:', errorMessage);
          signedCommitTx = proveResult.commitTx;
          signedSpellTx = proveResult.spellTx;
        }

        setStatus('broadcasting');
        toast.loading('Broadcasting commit transaction...', { id: 'adjust-tx' });

        // Broadcast commit transaction first
        const commitTxId = await client.bitcoin.broadcast(signedCommitTx);

        // Wait for mempool propagation
        toast.loading('Waiting for network propagation...', { id: 'adjust-tx' });
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Verify commit TX is in mempool before broadcasting spell
        try {
          await client.bitcoin.getTransaction(commitTxId);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        toast.loading('Broadcasting spell transaction...', { id: 'adjust-tx' });
        const spellTxId = await client.bitcoin.broadcast(signedSpellTx);

        // Update local vault state
        updateVault(params.vault.id, {
          utxo: `${spellTxId}:0`, // New vault UTXO
          collateral: newCollateral,
          debt: newDebt,
          lastUpdated: currentBlock,
        });

        setStatus('success');
        toast.success('Vault adjusted successfully!', {
          id: 'adjust-tx',
          description: `TX: ${spellTxId.slice(0, 8)}...${spellTxId.slice(-8)}`,
          action: {
            label: 'View',
            onClick: () => {
              window.open(client.getTxUrl(spellTxId), '_blank');
            },
          },
        });

        return {
          txId: spellTxId,
          newCollateral,
          newDebt,
        };
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to adjust vault';
        setError(message);
        toast.error('Failed to adjust vault', {
          id: 'adjust-tx',
          description: message,
        });
        throw err;
      }
    },
    [isConnected, address, publicKey, updateVault]
  );

  const mutation = useMutation({
    mutationFn: adjustVault,
  });

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    mutation.reset();
  }, [mutation]);

  return {
    adjustVault: mutation.mutateAsync,
    status,
    error,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    data: mutation.data,
    reset,
  };
}
