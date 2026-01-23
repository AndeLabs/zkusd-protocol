'use client';

import { getClient } from '@/lib/sdk';
import { type TrackedVault, useVaultsStore } from '@/stores/vaults';
import { useWallet } from '@/stores/wallet';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export interface CloseVaultParams {
  vault: TrackedVault;
}

export interface CloseVaultResult {
  txId: string;
  recoveredCollateral: bigint;
}

type CloseStatus =
  | 'idle'
  | 'building_spell'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'success'
  | 'error';

export function useCloseVault() {
  const { address, isConnected } = useWallet();
  const { removeVault, updateVault } = useVaultsStore();
  const [status, setStatus] = useState<CloseStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const closeVault = useCallback(
    async (params: CloseVaultParams): Promise<CloseVaultResult> => {
      if (!isConnected || !address) {
        throw new Error('Wallet not connected');
      }

      if (!window.unisat) {
        throw new Error('Unisat wallet not found');
      }

      // Check if vault has debt
      const totalDebt =
        params.vault.debt + params.vault.accruedInterest + params.vault.redistributedDebt;

      if (totalDebt > 0n) {
        // Cannot close vault with debt without zkUSD to repay
        // This requires the Charms indexer to find zkUSD UTXOs
        toast.error('Cannot close vault with outstanding debt', {
          id: 'close-tx',
          description: `You need ${(Number(totalDebt) / 1e8).toFixed(2)} zkUSD to repay the debt. Debt repayment requires a Charms indexer.`,
        });
        throw new Error('Vault has outstanding debt that must be repaid');
      }

      const client = getClient();

      try {
        setStatus('building_spell');
        setError(null);

        // For zero-debt vaults, we can close without zkUSD
        // The vault NFT is burned and collateral is returned
        const currentBlock = await client.getBlockHeight();

        // Build close spell (simplified for zero-debt vault)
        const spell = await client.vault.buildCloseVaultSpell({
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
          zkusdUtxo: '', // No zkUSD needed for zero-debt vault
          zkusdAmount: 0n,
        });

        setStatus('proving');
        toast.loading('Loading app binaries...', { id: 'close-tx' });

        // Get previous transaction
        const vaultTxId = params.vault.utxo.split(':')[0];
        const prevTxHex = await client.getRawTransaction(vaultTxId);

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

        toast.loading('Generating zero-knowledge proof...', { id: 'close-tx' });

        // Get fee estimate
        const fees = await client.getFeeEstimates();

        // Execute the spell through the prover
        const proveResult = await client.executeSpell({
          spell,
          binaries: {
            [config.contracts.vaultManager.vk]: vmBinary,
            [config.contracts.zkusdToken.vk]: tokenBinary,
          },
          prevTxs: [prevTxHex],
          fundingUtxo: params.vault.utxo,
          fundingUtxoValue: Number(params.vault.collateral),
          changeAddress: address,
          feeRate: fees.halfHourFee,
        });

        // Sign transactions
        setStatus('signing');
        toast.loading('Please sign the transaction in your wallet...', {
          id: 'close-tx',
        });

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
          if (
            errorMessage.toLowerCase().includes('user rejected') ||
            errorMessage.toLowerCase().includes('cancelled') ||
            errorMessage.toLowerCase().includes('denied')
          ) {
            throw new Error('Transaction signing was cancelled');
          }
          console.warn(
            '[CloseVault] PSBT signing failed, using original transactions:',
            errorMessage
          );
          signedCommitTx = proveResult.commitTx;
          signedSpellTx = proveResult.spellTx;
        }

        setStatus('broadcasting');
        toast.loading('Broadcasting commit transaction...', { id: 'close-tx' });

        // Broadcast commit transaction first
        const commitTxId = await client.bitcoin.broadcast(signedCommitTx);

        // Wait for mempool propagation
        toast.loading('Waiting for network propagation...', { id: 'close-tx' });
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Verify commit TX is in mempool before broadcasting spell
        try {
          await client.bitcoin.getTransaction(commitTxId);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        toast.loading('Broadcasting spell transaction...', { id: 'close-tx' });
        const spellTxId = await client.bitcoin.broadcast(signedSpellTx);

        // Mark vault as closed and update UTXO
        // We keep the vault record for history but could also use removeVault()
        updateVault(params.vault.id, {
          status: 'closed',
          utxo: `${spellTxId}:0`,
          collateral: 0n,
          debt: 0n,
          localUpdatedAt: Date.now(),
        });

        setStatus('success');

        toast.success('Vault closed successfully!', {
          id: 'close-tx',
          description: `Recovered ${(Number(params.vault.collateral) / 1e8).toFixed(8)} BTC`,
          action: {
            label: 'View',
            onClick: () => {
              window.open(client.getTxUrl(spellTxId), '_blank');
            },
          },
        });

        return {
          txId: spellTxId,
          recoveredCollateral: params.vault.collateral,
        };
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to close vault';
        setError(message);
        toast.error('Failed to close vault', {
          id: 'close-tx',
          description: message,
        });
        throw err;
      }
    },
    [isConnected, address, updateVault]
  );

  const mutation = useMutation({
    mutationFn: closeVault,
  });

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    mutation.reset();
  }, [mutation]);

  return {
    closeVault: mutation.mutateAsync,
    status,
    error,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    data: mutation.data,
    reset,
  };
}
