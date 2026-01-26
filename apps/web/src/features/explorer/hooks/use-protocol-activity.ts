'use client';

import { useBlockHeight } from '@/hooks/use-block-height';
import { getClient } from '@/lib/sdk';
import { useVaultsStore } from '@/stores/vaults';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { PROTOCOL_TRANSACTIONS } from '../constants';
import type { ProtocolTransaction } from '../types';

interface TxToFetch {
  txid: string;
  type: 'deploy' | 'set-minter' | 'mint';
  label: string;
  source: 'protocol' | 'user';
  collateralSats?: number;
  zkusdMinted?: bigint;
  vaultId?: string;
}

export function useProtocolActivity() {
  const vaults = useVaultsStore((s) => s.vaults);
  const { data: currentBlock } = useBlockHeight();

  // Build list of TXIDs to fetch, merging protocol + user vaults
  const txsToFetch = useMemo<TxToFetch[]>(() => {
    const knownTxids = new Set(PROTOCOL_TRANSACTIONS.map((t) => t.txid));
    const list: TxToFetch[] = PROTOCOL_TRANSACTIONS.map((t) => ({
      ...t,
      source: 'protocol' as const,
    }));

    // Add user vault transactions (not already in known list)
    for (const vault of vaults) {
      const txid = vault.utxo.split(':')[0];
      if (!knownTxids.has(txid)) {
        knownTxids.add(txid);
        list.push({
          txid,
          type: 'mint',
          label: `Mint zkUSD (Vault #${vault.id.slice(0, 8)})`,
          source: 'user',
          collateralSats: Number(vault.collateral),
          zkusdMinted: vault.debt,
          vaultId: vault.id,
        });
      }
    }

    return list;
  }, [vaults]);

  // Stable query key based on TX IDs
  const txIds = useMemo(() => txsToFetch.map((t) => t.txid).sort(), [txsToFetch]);

  const {
    data: transactions = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['explorer', 'activity', txIds],
    queryFn: async (): Promise<ProtocolTransaction[]> => {
      const client = getClient();
      const results: ProtocolTransaction[] = [];

      // Fetch all transactions in parallel
      const txResults = await Promise.all(
        txsToFetch.map(async (entry) => {
          try {
            const tx = await client.bitcoin.getTransaction(entry.txid);
            return { entry, tx, error: null };
          } catch (err) {
            return { entry, tx: null, error: err };
          }
        })
      );

      for (const { entry, tx } of txResults) {
        const blockHeight = tx?.status.block_height;
        const confirmations = currentBlock && blockHeight ? currentBlock - blockHeight + 1 : 0;

        results.push({
          txid: entry.txid,
          type: entry.type,
          label: entry.label,
          confirmed: tx?.status.confirmed ?? false,
          blockHeight,
          blockTime: tx?.status.block_time,
          confirmations,
          fee: tx?.fee ?? 0,
          collateralSats: entry.collateralSats,
          zkusdMinted: entry.zkusdMinted,
          vaultId: entry.vaultId,
          source: entry.source,
        });
      }

      // Sort: newest first, unconfirmed at top
      results.sort((a, b) => {
        if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
        return (b.blockHeight ?? 0) - (a.blockHeight ?? 0);
      });

      return results;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
    enabled: txsToFetch.length > 0,
  });

  const mintCount = useMemo(
    () => transactions.filter((t) => t.type === 'mint').length,
    [transactions]
  );

  const totalMinted = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'mint' && t.zkusdMinted)
        .reduce((sum, t) => sum + (t.zkusdMinted ?? 0n), 0n),
    [transactions]
  );

  return {
    transactions,
    mintCount,
    totalMinted,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
