'use client';

import { getClient } from '@/lib/sdk';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { EXPLORER_CONTRACTS } from '../constants';
import type { VerifiedContract } from '../types';

async function verifyContracts(): Promise<VerifiedContract[]> {
  const client = getClient();
  const results: VerifiedContract[] = [];

  for (const contract of EXPLORER_CONTRACTS) {
    try {
      const [txid, voutStr] = contract.stateUtxo.split(':');
      const vout = Number.parseInt(voutStr, 10);

      // Fetch transaction and outspend data in parallel
      const [tx, outspends] = await Promise.all([
        client.bitcoin.getTransaction(txid),
        client.bitcoin.getOutspends(txid),
      ]);

      const outspend = outspends[vout];
      const output = tx.vout[vout];

      results.push({
        name: contract.name,
        version: contract.version,
        description: contract.description,
        appId: contract.appId,
        vk: contract.vk,
        stateUtxo: contract.stateUtxo,
        deployTxId: contract.deployTxId,
        verification: {
          utxoId: contract.stateUtxo,
          isLive: !outspend?.spent,
          value: output?.value ?? 0,
          spentBy: outspend?.spent ? outspend.txid : undefined,
          checkedAt: Date.now(),
        },
        deployConfirmed: tx.status.confirmed,
        deployBlock: tx.status.block_height,
        deployTime: tx.status.block_time,
      });
    } catch (_error) {
      // If verification fails, include contract with null verification
      results.push({
        name: contract.name,
        version: contract.version,
        description: contract.description,
        appId: contract.appId,
        vk: contract.vk,
        stateUtxo: contract.stateUtxo,
        deployTxId: contract.deployTxId,
        verification: null,
        deployConfirmed: false,
      });
    }
  }

  return results;
}

export function useContractVerification() {
  const {
    data: contracts = [],
    isLoading,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['explorer', 'contracts'],
    queryFn: verifyContracts,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
  });

  const liveCount = useMemo(
    () => contracts.filter((c) => c.verification?.isLive).length,
    [contracts]
  );

  const lastChecked = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    [dataUpdatedAt]
  );

  return {
    contracts,
    allLive: liveCount === EXPLORER_CONTRACTS.length,
    liveCount,
    isLoading,
    error: error as Error | null,
    lastChecked,
    refetch,
  };
}
