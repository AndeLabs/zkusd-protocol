'use client';

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWallet } from '@/stores/wallet';
import { useVaultsStore } from '@/stores/vaults';
import { getClient } from '@/lib/sdk';

export interface OpenVaultParams {
  collateralSats: bigint;
  debtRaw: bigint;
}

export interface OpenVaultResult {
  commitTxId: string;
  spellTxId: string;
  vaultId: string;
}

type VaultStatus =
  | 'idle'
  | 'building_spell'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'success'
  | 'error';

export function useOpenVault() {
  const { address, publicKey, isConnected } = useWallet();
  const addVault = useVaultsStore((s) => s.addVault);
  const [status, setStatus] = useState<VaultStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const openVault = useCallback(
    async (params: OpenVaultParams): Promise<OpenVaultResult> => {
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

        // Get UTXOs for funding
        const utxos = await client.getAddressUtxos(address);
        if (utxos.length === 0) {
          throw new Error('No UTXOs available for funding');
        }

        // Find a suitable UTXO for funding (needs to cover collateral + fees)
        const requiredAmount = Number(params.collateralSats) + 50000; // Add buffer for fees
        const fundingUtxo = utxos
          .filter((u) => u.status.confirmed)
          .sort((a, b) => b.value - a.value)
          .find((u) => u.value >= requiredAmount);

        if (!fundingUtxo) {
          throw new Error(
            `No UTXO large enough. Need ${requiredAmount} sats, largest is ${Math.max(...utxos.map((u) => u.value))} sats`
          );
        }

        const fundingUtxoId = `${fundingUtxo.txid}:${fundingUtxo.vout}`;

        // Get current block height
        const currentBlock = await client.getBlockHeight();

        // Build the spell
        const spell = await client.vault.buildOpenVaultSpell({
          collateral: params.collateralSats,
          debt: params.debtRaw,
          owner: publicKey, // Owner is identified by public key
          fundingUtxo: fundingUtxoId,
          ownerAddress: address,
          ownerPubkey: publicKey,
          currentBlock,
        });

        setStatus('proving');
        toast.loading('Generating zero-knowledge proof...', { id: 'vault-tx' });

        // Get previous transaction hex for the funding UTXO
        const prevTxHex = await client.getRawTransaction(fundingUtxo.txid);

        // Get deployment config for app binaries
        const config = await client.getDeploymentConfig();

        // Get fee estimate
        const fees = await client.getFeeEstimates();

        // Execute the spell through the prover
        const proveResult = await client.executeSpell({
          spell,
          binaries: {
            [config.contracts.vaultManager.appId]: config.contracts.vaultManager.vk,
            [config.contracts.zkusdToken.appId]: config.contracts.zkusdToken.vk,
          },
          prevTxs: [prevTxHex],
          fundingUtxo: fundingUtxoId,
          fundingUtxoValue: fundingUtxo.value,
          changeAddress: address,
          feeRate: fees.halfHourFee,
        });

        setStatus('signing');
        toast.loading('Please sign the transaction in your wallet...', {
          id: 'vault-tx',
        });

        // Sign the commit transaction with Unisat
        let signedCommitTx: string;
        let signedSpellTx: string;

        try {
          // Sign as PSBT
          signedCommitTx = await window.unisat.signPsbt(proveResult.commitTx, {
            autoFinalized: true,
          });
          signedSpellTx = await window.unisat.signPsbt(proveResult.spellTx, {
            autoFinalized: true,
          });
        } catch {
          // If PSBT signing fails, the transactions might already be finalized
          signedCommitTx = proveResult.commitTx;
          signedSpellTx = proveResult.spellTx;
        }

        setStatus('broadcasting');
        toast.loading('Broadcasting transaction...', { id: 'vault-tx' });

        // Broadcast commit transaction
        const commitTxId = await client.bitcoin.broadcast(signedCommitTx);

        // Wait a moment for propagation
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Broadcast spell transaction
        const spellTxId = await client.bitcoin.broadcast(signedSpellTx);

        setStatus('success');
        toast.success('Vault opened successfully!', {
          id: 'vault-tx',
          description: `TX: ${spellTxId.slice(0, 8)}...${spellTxId.slice(-8)}`,
          action: {
            label: 'View',
            onClick: () => {
              window.open(client.getTxUrl(spellTxId), '_blank');
            },
          },
        });

        // Generate vault ID from funding UTXO
        const vaultId = generateVaultId(fundingUtxoId);

        // Store vault locally for tracking (until indexer is available)
        addVault({
          id: vaultId,
          utxo: `${spellTxId}:0`, // Vault NFT is at output 0
          owner: publicKey,
          collateral: params.collateralSats,
          debt: params.debtRaw,
          createdAt: currentBlock,
          lastUpdated: currentBlock,
          interestRateBps: 100, // 1% default
          accruedInterest: 0n,
          redistributedDebt: 0n,
          redistributedCollateral: 0n,
          insuranceBalance: 0n,
        });

        return {
          commitTxId,
          spellTxId,
          vaultId,
        };
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to open vault';
        setError(message);
        toast.error('Failed to open vault', {
          id: 'vault-tx',
          description: message,
        });
        throw err;
      }
    },
    [isConnected, address, publicKey, addVault]
  );

  const mutation = useMutation({
    mutationFn: openVault,
  });

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    mutation.reset();
  }, [mutation]);

  return {
    openVault: mutation.mutateAsync,
    status,
    error,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    data: mutation.data,
    reset,
  };
}

// Helper to generate deterministic vault ID
function generateVaultId(fundingUtxo: string): string {
  const input = `vault:${fundingUtxo}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hexPart = Math.abs(hash).toString(16).padStart(16, '0');
  return hexPart.repeat(4);
}
