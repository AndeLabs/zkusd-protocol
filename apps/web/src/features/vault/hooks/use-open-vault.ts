'use client';

import { getClient } from '@/lib/sdk';
import { useVaultsStore } from '@/stores/vaults';
import { useWallet } from '@/stores/wallet';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

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

/**
 * Check if user needs to split their UTXOs before opening a vault
 */
export async function checkNeedsSplit(
  address: string,
  collateralAmount: number,
  feeBuffer: number
): Promise<{ needsSplit: boolean; utxoCount: number; largestUtxo: number }> {
  const client = getClient();
  const utxos = await client.getAddressUtxos(address);
  const confirmedUtxos = utxos.filter((u) => u.status?.confirmed);

  // Use all UTXOs (including mempool) if no confirmed ones available
  const availableUtxos = confirmedUtxos.length > 0 ? confirmedUtxos : utxos;

  if (availableUtxos.length === 0) {
    return { needsSplit: false, utxoCount: 0, largestUtxo: 0 };
  }

  const sortedUtxos = [...availableUtxos].sort((a, b) => b.value - a.value);
  const largestUtxo = sortedUtxos[0].value;

  // Check if we can find two separate UTXOs
  const collateralUtxo = sortedUtxos.find((u) => u.value >= collateralAmount);
  const feeUtxo = sortedUtxos.find((u) => u.value >= feeBuffer && u !== collateralUtxo);

  return {
    needsSplit: !collateralUtxo || !feeUtxo,
    utxoCount: availableUtxos.length,
    largestUtxo,
  };
}

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
        const confirmedUtxos = utxos.filter((u) => u.status?.confirmed);

        // Also consider mempool (unconfirmed) UTXOs if no confirmed ones available
        // Mempool UTXOs are riskier but acceptable for testnet
        const availableUtxos = confirmedUtxos.length > 0 ? confirmedUtxos : utxos;

        if (availableUtxos.length === 0) {
          throw new Error('No UTXOs available. Please fund your wallet first.');
        }

        if (confirmedUtxos.length === 0 && utxos.length > 0) {
          console.log('[OpenVault] Using unconfirmed (mempool) UTXOs');
          toast.info('Using unconfirmed UTXOs from mempool', { id: 'utxo-warning' });
        }

        // Get fee estimate for dynamic buffer calculation
        const fees = await client.getFeeEstimates();
        // Estimate ~2000 vbytes for vault open transaction, multiply by fee rate
        const estimatedFee = Math.ceil(fees.halfHourFee * 2000);
        const feeBuffer = Math.max(estimatedFee, 50000); // At least 50k sats buffer

        // CRITICAL: Charms requires TWO SEPARATE UTXOs
        // 1. collateralUtxo: Goes in spell's `ins` array (the UTXO being "enchanted")
        // 2. feeUtxo: Passed to prover as `funding_utxo` (MUST be different!)
        //
        // Using the same UTXO for both causes "conflict-in-package" error

        const collateralAmount = Number(params.collateralSats);

        // Sort UTXOs by value descending
        const sortedUtxos = [...availableUtxos].sort((a, b) => b.value - a.value);

        // Strategy: Find two UTXOs that together cover collateral + fees
        // - Collateral UTXO: Should have at least collateral amount
        // - Fee UTXO: Should have at least fee amount

        let collateralUtxo = sortedUtxos.find((u) => u.value >= collateralAmount);
        let feeUtxo = sortedUtxos.find((u) => u.value >= feeBuffer && u !== collateralUtxo);

        // If we can't find separate UTXOs, check if we have one large enough for everything
        // In this case, we need to split - but that's not possible in one tx
        if (!collateralUtxo || !feeUtxo) {
          // Fallback: Check if there's a single UTXO large enough for everything
          // This is a UX compromise - ideally user should have 2 UTXOs
          const totalRequired = collateralAmount + feeBuffer;
          const largeUtxo = sortedUtxos.find((u) => u.value >= totalRequired);

          if (largeUtxo && sortedUtxos.length >= 2) {
            // Use the large one for collateral, find any other for fees
            collateralUtxo = largeUtxo;
            feeUtxo = sortedUtxos.find((u) => u !== largeUtxo);
          } else if (largeUtxo) {
            // Signal that we need a UTXO split (handled by WalletPreparation component)
            throw new Error(`UTXO_SPLIT_REQUIRED:${collateralAmount}:${feeBuffer}`);
          } else {
            const largestValue = sortedUtxos.length > 0 ? sortedUtxos[0].value : 0;
            const neededBTC = ((collateralAmount + feeBuffer) / 1e8).toFixed(6);
            const haveBTC = (largestValue / 1e8).toFixed(6);
            throw new Error(
              `Insufficient funds. You need at least ${neededBTC} BTC but only have ${haveBTC} BTC available.`
            );
          }
        }

        if (!collateralUtxo || !feeUtxo) {
          throw new Error('Could not find suitable UTXOs for vault creation');
        }

        const collateralUtxoId = `${collateralUtxo.txid}:${collateralUtxo.vout}`;
        const feeUtxoId = `${feeUtxo.txid}:${feeUtxo.vout}`;

        console.log(
          '[OpenVault] Collateral UTXO:',
          collateralUtxoId,
          'value:',
          collateralUtxo.value
        );
        console.log('[OpenVault] Fee UTXO:', feeUtxoId, 'value:', feeUtxo.value);

        // Get current block height
        const currentBlock = await client.getBlockHeight();

        // Build the spell with collateral UTXO in ins
        const spell = await client.vault.buildOpenVaultSpell({
          collateral: params.collateralSats,
          debt: params.debtRaw,
          owner: publicKey,
          collateralUtxo: collateralUtxoId, // Goes in spell's ins array
          ownerAddress: address,
          ownerPubkey: publicKey,
          currentBlock,
        });

        setStatus('proving');
        toast.loading('Loading app binaries...', { id: 'vault-tx' });

        // Get deployment config for app binaries (needed for stateUtxo and WASM paths)
        const config = await client.getDeploymentConfig();

        // Get previous transaction hex for ALL UTXOs referenced in the spell
        // The prover needs raw tx for: collateral, fee, AND VaultManagerState (refs)
        const vmStateUtxo = config.contracts.vaultManager.stateUtxo;
        const vmStateTxid = vmStateUtxo?.split(':')[0];

        const prevTxPromises: Promise<string>[] = [
          client.getRawTransaction(collateralUtxo.txid),
          client.getRawTransaction(feeUtxo.txid),
        ];

        // Add vmState prevTx if available (required for OpenVault spell refs)
        if (vmStateTxid) {
          prevTxPromises.push(client.getRawTransaction(vmStateTxid));
        }

        const prevTxResults = await Promise.all(prevTxPromises);
        const [collateralPrevTx, feePrevTx, vmStatePrevTx] = prevTxResults;

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

        toast.loading('Generating zero-knowledge proof...', { id: 'vault-tx' });

        // Check if running in demo mode
        const isDemoMode = client.isDemoMode();

        // Execute the spell through the prover
        // - prev_txs: Include ALL UTXOs: collateral, fee, AND VaultManagerState (refs)
        // - funding_utxo: The FEE UTXO (DIFFERENT from collateral UTXO!)
        const prevTxs = [collateralPrevTx, feePrevTx];
        if (vmStatePrevTx) {
          prevTxs.push(vmStatePrevTx);
        }

        const proveResult = await client.executeSpell({
          spell,
          binaries: {
            [config.contracts.vaultManager.vk]: vmBinary,
            [config.contracts.zkusdToken.vk]: tokenBinary,
          },
          prevTxs, // All raw txs including VaultManagerState ref
          fundingUtxo: feeUtxoId, // Fee UTXO (DIFFERENT from collateral!)
          fundingUtxoValue: feeUtxo.value,
          changeAddress: address,
          feeRate: fees.halfHourFee,
        });

        let commitTxId: string;
        let spellTxId: string;

        if (isDemoMode) {
          // Demo mode: skip signing and broadcasting, generate fake txids
          setStatus('broadcasting');
          toast.loading('Simulating transaction (demo mode)...', { id: 'vault-tx' });

          // Simulate network delay for realistic UX
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Generate deterministic demo txids based on collateral UTXO
          commitTxId = generateDemoTxId(collateralUtxoId + ':commit');
          spellTxId = generateDemoTxId(collateralUtxoId + ':spell');

          console.log('[OpenVault DEMO] Simulated commit TX:', commitTxId);
          console.log('[OpenVault DEMO] Simulated spell TX:', spellTxId);
        } else {
          // Real mode: sign with wallet and broadcast
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
          } catch (signError) {
            // Check if user rejected the signing request
            const errorMessage = signError instanceof Error ? signError.message : String(signError);
            if (
              errorMessage.toLowerCase().includes('user rejected') ||
              errorMessage.toLowerCase().includes('cancelled') ||
              errorMessage.toLowerCase().includes('denied')
            ) {
              throw new Error('Transaction signing was cancelled');
            }
            // For other errors (e.g., already finalized), try using original transactions
            console.warn(
              '[OpenVault] PSBT signing failed, using original transactions:',
              errorMessage
            );
            signedCommitTx = proveResult.commitTx;
            signedSpellTx = proveResult.spellTx;
          }

          setStatus('broadcasting');
          toast.loading('Broadcasting commit transaction...', { id: 'vault-tx' });

          // Broadcast commit transaction first
          commitTxId = await client.bitcoin.broadcast(signedCommitTx);

          // Wait for mempool propagation (5 seconds for better reliability)
          toast.loading('Waiting for network propagation...', { id: 'vault-tx' });
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // Verify commit TX is in mempool before broadcasting spell
          try {
            await client.bitcoin.getTransaction(commitTxId);
          } catch {
            // If we can't find commit TX, wait a bit more and retry
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }

          toast.loading('Broadcasting spell transaction...', { id: 'vault-tx' });
          // Broadcast spell transaction
          spellTxId = await client.bitcoin.broadcast(signedSpellTx);
        }

        setStatus('success');

        if (isDemoMode) {
          toast.success('Vault opened (demo mode)', {
            id: 'vault-tx',
            description: 'This is a simulated transaction for testing',
          });
        } else {
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
        }

        // Generate vault ID from collateral UTXO (matches SDK)
        const vaultId = generateVaultId(collateralUtxoId);

        // Store vault locally for tracking (until indexer is available)
        addVault({
          id: vaultId,
          utxo: `${spellTxId}:0`, // Vault NFT is at output 0
          owner: publicKey,
          collateral: params.collateralSats,
          debt: params.debtRaw,
          status: 'active',
          createdAt: currentBlock,
          lastUpdated: currentBlock,
          interestRateBps: 100, // 1% default
          accruedInterest: 0n,
          redistributedDebt: 0n,
          redistributedCollateral: 0n,
          insuranceBalance: 0n,
          localUpdatedAt: Date.now(),
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

        // Don't show toast for UTXO_SPLIT_REQUIRED - it's handled by WalletPreparation UI
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
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const hexPart = Math.abs(hash).toString(16).padStart(16, '0');
  return hexPart.repeat(4);
}

// Helper to generate deterministic demo transaction ID (looks like a real Bitcoin txid)
function generateDemoTxId(seed: string): string {
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash1 = (hash1 << 5) - hash1 + char;
    hash1 = hash1 & hash1;
    hash2 = (hash2 << 7) - hash2 + char;
    hash2 = hash2 & hash2;
  }
  // Create a 64-character hex string that looks like a Bitcoin txid
  const part1 = Math.abs(hash1).toString(16).padStart(16, '0');
  const part2 = Math.abs(hash2).toString(16).padStart(16, '0');
  const part3 = Math.abs(hash1 ^ hash2).toString(16).padStart(16, '0');
  const part4 = Math.abs(hash1 + hash2).toString(16).padStart(16, '0');
  return (part1 + part2 + part3 + part4).slice(0, 64);
}
