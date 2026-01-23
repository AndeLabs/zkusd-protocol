'use client';

/**
 * useOpenVault Hook - Open new vaults in zkUSD protocol
 *
 * Architecture: Modular services with state machine
 *
 * Key Changes from Previous Version:
 * 1. NO UTXO ROTATION - Once committed, that's the UTXO we use
 * 2. Clear state machine for predictable UX
 * 3. Separate services for UTXO, Spell, and State management
 * 4. Pre-flight validation before any prover calls
 */

import { getClient } from '@/lib/sdk';
import { getSpellCache, clearPendingSpell } from '@/lib/spell-cache';
import {
  getUtxoService,
  getSpellService,
  createInitialContext,
  transitionToSelecting,
  handleUtxoSelection,
  transitionToBuilding,
  handleSpellBuilt,
  transitionToSigning,
  transitionToBroadcasting,
  handleSuccess,
  handleError,
  reset as resetContext,
  parseErrorType,
  isLoading,
  type VaultStateContext,
  type SpellContext,
} from '@/lib/services';
import { useVaultsStore } from '@/stores/vaults';
import { useWallet } from '@/stores/wallet';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

export interface OpenVaultParams {
  collateralSats: bigint;
  debtRaw: bigint;
}

export interface OpenVaultResult {
  commitTxId: string;
  spellTxId: string;
  vaultId: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useOpenVault() {
  const { address, publicKey, isConnected } = useWallet();
  const addVault = useVaultsStore((s) => s.addVault);

  // State machine context
  const [ctx, setCtx] = useState<VaultStateContext>(createInitialContext());

  /**
   * Main function to open a vault
   * NO UTXO ROTATION - commits to a single UTXO path
   */
  const openVault = useCallback(
    async (params: OpenVaultParams): Promise<OpenVaultResult> => {
      if (!isConnected || !address || !publicKey) {
        throw new Error('Wallet not connected');
      }

      if (!window.unisat) {
        throw new Error('Unisat wallet not found');
      }

      const client = getClient();
      const utxoService = getUtxoService();
      const spellService = getSpellService();
      const spellCache = getSpellCache();

      try {
        // ============================================================
        // STEP 1: UTXO SELECTION (Pre-flight check)
        // ============================================================
        setCtx(transitionToSelecting);

        // Get fee estimate for buffer calculation
        const fees = await client.getFeeEstimates();
        const estimatedFee = Math.ceil(fees.halfHourFee * 2000);
        const feeBuffer = Math.max(estimatedFee, 50000);
        const collateralAmount = Number(params.collateralSats);

        // Select UTXO pair BEFORE attempting anything with the prover
        const utxoResult = await utxoService.selectUtxoPair(
          address,
          collateralAmount,
          feeBuffer
        );

        // Handle non-ready states
        if (utxoResult.status !== 'ready') {
          const newCtx = handleUtxoSelection(ctx, utxoResult);
          setCtx(newCtx);

          if (utxoResult.status === 'need_split') {
            throw new Error(`UTXO_SPLIT_REQUIRED:${collateralAmount}:${feeBuffer}`);
          }

          throw new Error(utxoResult.message);
        }

        // We have our UTXOs - commit to these
        const collateralUtxo = utxoResult.collateralUtxo!;
        const feeUtxo = utxoResult.feeUtxo!;

        setCtx(handleUtxoSelection(ctx, utxoResult));

        console.log('[OpenVault] Committed to UTXOs:', {
          collateral: collateralUtxo.id,
          fee: feeUtxo.id,
        });

        // ============================================================
        // STEP 2: BUILD SPELL WITH FROZEN VALUES
        // ============================================================
        setCtx(transitionToBuilding);
        toast.loading('Building transaction...', { id: 'vault-tx' });

        let spellContext: SpellContext;

        try {
          spellContext = await spellService.buildSpell(
            {
              collateral: params.collateralSats,
              debt: params.debtRaw,
              owner: publicKey,
              ownerAddress: address,
            },
            collateralUtxo,
            feeUtxo
          );
        } catch (buildError) {
          const errorMsg = buildError instanceof Error ? buildError.message : String(buildError);
          throw new Error(`Failed to build spell: ${errorMsg}`);
        }

        setCtx((prev) => handleSpellBuilt(prev, spellContext));

        // Register UTXOs in cache BEFORE sending to prover
        spellCache.registerSpellAttempt(collateralUtxo.id, spellContext.spell);
        spellCache.registerSpellAttempt(feeUtxo.id, spellContext.spell);

        // ============================================================
        // STEP 3: PROVE SPELL
        // ============================================================
        toast.loading('Loading app binaries...', { id: 'vault-tx' });

        const config = await client.getDeploymentConfig();

        // Get previous transactions for all referenced UTXOs
        const vmStateUtxo = config.contracts.vaultManager.stateUtxo;
        const vmStateTxid = vmStateUtxo?.split(':')[0];
        const oracleStateUtxo = config.contracts.priceOracle.stateUtxo;
        const oracleStateTxid = oracleStateUtxo?.split(':')[0];
        const tokenStateUtxo = config.contracts.zkusdToken.stateUtxo;
        const tokenStateTxid = tokenStateUtxo?.split(':')[0];

        const prevTxPromises: Promise<string>[] = [
          client.getRawTransaction(collateralUtxo.txid),
          client.getRawTransaction(feeUtxo.txid),
        ];

        if (vmStateTxid) prevTxPromises.push(client.getRawTransaction(vmStateTxid));
        if (oracleStateTxid) prevTxPromises.push(client.getRawTransaction(oracleStateTxid));
        if (tokenStateTxid) prevTxPromises.push(client.getRawTransaction(tokenStateTxid));

        const prevTxResults = await Promise.all(prevTxPromises);
        const [collateralPrevTx, feePrevTx, vmStatePrevTx, oracleStatePrevTx, tokenStatePrevTx] =
          prevTxResults;

        // Validate WASM paths
        if (
          !config.contracts.vaultManager.wasmPath ||
          !config.contracts.zkusdToken.wasmPath ||
          !config.contracts.priceOracle.wasmPath
        ) {
          throw new Error('WASM binary paths not configured');
        }

        // Load WASM binaries
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

        const [vmBinary, tokenBinary, oracleBinary] = await Promise.all([
          loadBinary(config.contracts.vaultManager.wasmPath),
          loadBinary(config.contracts.zkusdToken.wasmPath),
          loadBinary(config.contracts.priceOracle.wasmPath),
        ]);

        toast.loading('Generating zero-knowledge proof...', { id: 'vault-tx' });

        // Build prevTxs array
        const prevTxs = [collateralPrevTx, feePrevTx];
        if (vmStatePrevTx) prevTxs.push(vmStatePrevTx);
        if (oracleStatePrevTx) prevTxs.push(oracleStatePrevTx);
        if (tokenStatePrevTx) prevTxs.push(tokenStatePrevTx);

        let proveResult: { commitTx: string; spellTx: string };

        try {
          proveResult = await client.executeSpell({
            spell: spellContext.spell,
            binaries: {
              [config.contracts.vaultManager.vk]: vmBinary,
              [config.contracts.zkusdToken.vk]: tokenBinary,
              [config.contracts.priceOracle.vk]: oracleBinary,
            },
            prevTxs,
            fundingUtxo: feeUtxo.id,
            fundingUtxoValue: feeUtxo.value,
            changeAddress: address,
            feeRate: fees.halfHourFee,
          });
        } catch (proveError) {
          const errorMsg = proveError instanceof Error ? proveError.message : String(proveError);

          // Mark UTXOs as burned in local cache
          spellCache.markFailed(collateralUtxo.id, errorMsg);
          spellCache.markFailed(feeUtxo.id, errorMsg);

          // Calculate when UTXOs will be available again
          const nextAvailableAt = Date.now() + 60 * 60 * 1000; // 1 hour from now

          const errorType = parseErrorType(errorMsg);
          setCtx((prev) => handleError(prev, errorMsg, errorType, nextAvailableAt));

          throw new Error(errorMsg);
        }

        // ============================================================
        // STEP 4: SIGN AND BROADCAST
        // ============================================================
        setCtx(transitionToSigning);
        toast.loading('Please sign the transaction in your wallet...', { id: 'vault-tx' });

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
            setCtx((prev) => handleError(prev, 'Transaction signing was cancelled', 'user_rejected'));
            throw new Error('Transaction signing was cancelled');
          }
          // Try using unsigned transactions as fallback
          console.warn('[OpenVault] PSBT signing failed, using original:', errorMessage);
          signedCommitTx = proveResult.commitTx;
          signedSpellTx = proveResult.spellTx;
        }

        setCtx(transitionToBroadcasting);
        toast.loading('Broadcasting commit transaction...', { id: 'vault-tx' });

        const commitTxId = await client.bitcoin.broadcast(signedCommitTx);

        toast.loading('Waiting for network propagation...', { id: 'vault-tx' });
        await new Promise((resolve) => setTimeout(resolve, 5000));

        try {
          await client.bitcoin.getTransaction(commitTxId);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        toast.loading('Broadcasting spell transaction...', { id: 'vault-tx' });
        const spellTxId = await client.bitcoin.broadcast(signedSpellTx);

        // ============================================================
        // SUCCESS!
        // ============================================================
        const result = {
          commitTxId,
          spellTxId,
          vaultId: spellContext.vaultId,
        };

        setCtx((prev) => handleSuccess(prev, result));
        clearPendingSpell();
        spellCache.markSuccess(collateralUtxo.id);
        spellCache.markSuccess(feeUtxo.id);

        toast.success('Vault opened successfully!', {
          id: 'vault-tx',
          description: `TX: ${spellTxId.slice(0, 8)}...${spellTxId.slice(-8)}`,
          action: {
            label: 'View',
            onClick: () => window.open(client.getTxUrl(spellTxId), '_blank'),
          },
        });

        // Store vault locally
        addVault({
          id: spellContext.vaultId,
          utxo: `${spellTxId}:0`,
          owner: publicKey,
          collateral: params.collateralSats,
          debt: params.debtRaw,
          status: 'active',
          createdAt: spellContext.frozenValues.blockHeight,
          lastUpdated: spellContext.frozenValues.blockHeight,
          interestRateBps: 100,
          accruedInterest: 0n,
          redistributedDebt: 0n,
          redistributedCollateral: 0n,
          insuranceBalance: 0n,
          localUpdatedAt: Date.now(),
        });

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to open vault';
        const errorType = parseErrorType(message);

        // Calculate next available time for burned UTXOs
        const nextAvailableAt = errorType === 'utxo_burned' || errorType === 'all_reserved'
          ? Date.now() + 60 * 60 * 1000
          : undefined;

        setCtx((prev) => handleError(prev, message, errorType, nextAvailableAt));

        // Don't show toast for UTXO_SPLIT_REQUIRED
        if (!message.startsWith('UTXO_SPLIT_REQUIRED:')) {
          toast.error('Failed to open vault', {
            id: 'vault-tx',
            description: message,
          });
        }

        throw err;
      }
    },
    [isConnected, address, publicKey, addVault]
  );

  /**
   * Reset state machine
   */
  const reset = useCallback(() => {
    setCtx(resetContext());
  }, []);

  /**
   * Get formatted time until next UTXO available
   */
  const getTimeUntilAvailable = useCallback((): string | null => {
    if (!ctx.nextAvailableAt) return null;

    const remaining = ctx.nextAvailableAt - Date.now();
    if (remaining <= 0) return 'Available now';

    const minutes = Math.ceil(remaining / 60000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
    return `${minutes}m`;
  }, [ctx.nextAvailableAt]);

  return {
    openVault,
    status: ctx.state,
    error: ctx.error,
    errorType: ctx.errorType,
    isLoading: isLoading(ctx),
    isSuccess: ctx.state === 'success',
    isError: ctx.state === 'error',
    isWaiting: ctx.state === 'waiting',
    data: ctx.result,
    progress: ctx.progress,
    statusMessage: ctx.statusMessage,
    nextAvailableAt: ctx.nextAvailableAt,
    getTimeUntilAvailable,
    reset,
  };
}

// Re-export check needs split for wallet preparation
export async function checkNeedsSplit(
  address: string,
  collateralAmount: number,
  feeBuffer: number
): Promise<{ needsSplit: boolean; utxoCount: number; largestUtxo: number }> {
  const utxoService = getUtxoService();
  const result = await utxoService.selectUtxoPair(address, collateralAmount, feeBuffer);

  return {
    needsSplit: result.status === 'need_split',
    utxoCount: result.status === 'no_utxos' ? 0 : 1, // Simplified
    largestUtxo: result.collateralUtxo?.value ?? 0,
  };
}
