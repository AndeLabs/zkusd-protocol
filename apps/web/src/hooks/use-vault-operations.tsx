import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useNetwork } from '@/lib/network-context';
import { useWalletStore } from '@/stores';
import { useVaultStore } from '@/stores';
import { getZkUsdClient } from '@/services';
import type { Vault } from '@/stores/vault';

// ============================================================================
// Types
// ============================================================================

interface OpenVaultParams {
  collateralSats: number;
  debtZkusd: number;
}

interface AdjustVaultParams {
  vaultId: string;
  collateralDelta: number;
  debtDelta: number;
}

interface OperationState {
  isLoading: boolean;
  error: string | null;
  txid: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useVaultOperations() {
  const { networkId, config } = useNetwork();
  const wallet = useWalletStore();
  const vaultStore = useVaultStore();

  const [state, setState] = useState<OperationState>({
    isLoading: false,
    error: null,
    txid: null,
  });

  /**
   * Open a new vault
   */
  const openVault = useCallback(
    async (params: OpenVaultParams) => {
      if (!wallet.isConnected || !wallet.address || !wallet.publicKey) {
        toast.error('Wallet not connected');
        throw new Error('Wallet not connected');
      }

      setState({ isLoading: true, error: null, txid: null });
      const toastId = toast.loading('Opening vault...', {
        description: 'Building transaction...',
      });

      try {
        const client = getZkUsdClient(networkId);

        // Get a funding UTXO from the wallet
        const fundingUtxo = wallet.utxos.find(
          (u) => u.value >= params.collateralSats + 5000 // collateral + fee buffer
        );

        if (!fundingUtxo) {
          throw new Error('Insufficient BTC. Please add more funds.');
        }

        const fundingUtxoId = `${fundingUtxo.txid}:${fundingUtxo.vout}`;

        // Build the spell
        toast.loading('Building vault transaction...', { id: toastId });
        const spell = await client.buildOpenVaultSpell({
          collateralSats: params.collateralSats,
          debtZkusd: params.debtZkusd,
          ownerAddress: wallet.address,
          ownerPubkey: wallet.publicKey,
          fundingUtxo: fundingUtxoId,
          fundingValue: fundingUtxo.value,
        });

        if (!spell.psbt) {
          throw new Error('Failed to build transaction');
        }

        // Sign the transaction
        toast.loading('Please sign in your wallet...', { id: toastId });
        const signedPsbt = await wallet.signPsbt(spell.psbt);

        // Broadcast
        toast.loading('Broadcasting transaction...', { id: toastId });
        const txid = await wallet.signAndBroadcast(signedPsbt);

        // Add vault to local state
        const newVault: Vault = {
          id: `vault_${Date.now()}`,
          txid,
          vout: 0,
          collateralSats: params.collateralSats,
          debtZkusd: params.debtZkusd,
          collateralRatio: 0, // Will be calculated
          liquidationPrice: 0, // Will be calculated
          status: 'active',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
        };

        vaultStore.addVault(newVault);

        // Add pending operation
        vaultStore.addPendingOperation({
          type: 'open',
          txid,
          status: 'pending',
          timestamp: Date.now(),
          details: {
            collateralChange: params.collateralSats,
            debtChange: params.debtZkusd,
          },
        });

        setState({ isLoading: false, error: null, txid });

        toast.success('Vault opened successfully!', {
          id: toastId,
          description: (
            <a
              href={client.getTxUrl(txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              View transaction
            </a>
          ),
        });

        // Refresh wallet balance
        await wallet.refreshBalance(config.explorerApiUrl);

        return txid;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to open vault';
        setState({ isLoading: false, error: message, txid: null });
        toast.error('Failed to open vault', { id: toastId, description: message });
        throw err;
      }
    },
    [wallet, networkId, config, vaultStore]
  );

  /**
   * Adjust an existing vault
   */
  const adjustVault = useCallback(
    async (params: AdjustVaultParams) => {
      if (!wallet.isConnected || !wallet.address) {
        toast.error('Wallet not connected');
        throw new Error('Wallet not connected');
      }

      const vault = vaultStore.vaults.find((v) => v.id === params.vaultId);
      if (!vault) {
        throw new Error('Vault not found');
      }

      setState({ isLoading: true, error: null, txid: null });
      const toastId = toast.loading('Adjusting vault...', {
        description: 'Building transaction...',
      });

      try {
        const client = getZkUsdClient(networkId);

        // Build the spell
        const spell = await client.buildAdjustVaultSpell({
          vaultUtxo: `${vault.txid}:${vault.vout}`,
          currentCollateral: vault.collateralSats,
          currentDebt: vault.debtZkusd,
          collateralDelta: params.collateralDelta,
          debtDelta: params.debtDelta,
          ownerAddress: wallet.address,
        });

        if (!spell.psbt) {
          throw new Error('Failed to build transaction');
        }

        // Sign and broadcast
        toast.loading('Please sign in your wallet...', { id: toastId });
        const signedPsbt = await wallet.signPsbt(spell.psbt);
        const txid = await wallet.signAndBroadcast(signedPsbt);

        // Update vault in store
        vaultStore.updateVault(params.vaultId, {
          collateralSats: vault.collateralSats + params.collateralDelta,
          debtZkusd: vault.debtZkusd + params.debtDelta,
          txid,
        });

        // Add pending operation
        vaultStore.addPendingOperation({
          type: 'adjust',
          txid,
          status: 'pending',
          timestamp: Date.now(),
          details: {
            collateralChange: params.collateralDelta,
            debtChange: params.debtDelta,
          },
        });

        setState({ isLoading: false, error: null, txid });

        toast.success('Vault adjusted successfully!', {
          id: toastId,
          description: (
            <a
              href={client.getTxUrl(txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              View transaction
            </a>
          ),
        });

        await wallet.refreshBalance(config.explorerApiUrl);

        return txid;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to adjust vault';
        setState({ isLoading: false, error: message, txid: null });
        toast.error('Failed to adjust vault', { id: toastId, description: message });
        throw err;
      }
    },
    [wallet, networkId, config, vaultStore]
  );

  /**
   * Close a vault
   */
  const closeVault = useCallback(
    async (vaultId: string) => {
      if (!wallet.isConnected || !wallet.address) {
        toast.error('Wallet not connected');
        throw new Error('Wallet not connected');
      }

      const vault = vaultStore.vaults.find((v) => v.id === vaultId);
      if (!vault) {
        throw new Error('Vault not found');
      }

      setState({ isLoading: true, error: null, txid: null });
      const toastId = toast.loading('Closing vault...', {
        description: 'Building transaction...',
      });

      try {
        const client = getZkUsdClient(networkId);

        // Find zkUSD UTXO for repayment
        // In production, this would scan for zkUSD token UTXOs
        const zkusdUtxo = 'placeholder:0'; // TODO: Find actual zkUSD UTXO

        // Build the spell
        const spell = await client.buildCloseVaultSpell({
          vaultUtxo: `${vault.txid}:${vault.vout}`,
          currentCollateral: vault.collateralSats,
          currentDebt: vault.debtZkusd,
          ownerAddress: wallet.address,
          zkusdUtxo,
        });

        if (!spell.psbt) {
          throw new Error('Failed to build transaction');
        }

        // Sign and broadcast
        toast.loading('Please sign in your wallet...', { id: toastId });
        const signedPsbt = await wallet.signPsbt(spell.psbt);
        const txid = await wallet.signAndBroadcast(signedPsbt);

        // Remove vault from store
        vaultStore.removeVault(vaultId);

        // Add pending operation
        vaultStore.addPendingOperation({
          type: 'close',
          txid,
          status: 'pending',
          timestamp: Date.now(),
          details: {
            collateralChange: -vault.collateralSats,
            debtChange: -vault.debtZkusd,
          },
        });

        setState({ isLoading: false, error: null, txid });

        toast.success('Vault closed successfully!', {
          id: toastId,
          description: (
            <a
              href={client.getTxUrl(txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              View transaction
            </a>
          ),
        });

        await wallet.refreshBalance(config.explorerApiUrl);

        return txid;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to close vault';
        setState({ isLoading: false, error: message, txid: null });
        toast.error('Failed to close vault', { id: toastId, description: message });
        throw err;
      }
    },
    [wallet, networkId, config, vaultStore]
  );

  /**
   * Reset operation state
   */
  const reset = useCallback(() => {
    setState({ isLoading: false, error: null, txid: null });
  }, []);

  return {
    ...state,
    openVault,
    adjustVault,
    closeVault,
    reset,
  };
}
