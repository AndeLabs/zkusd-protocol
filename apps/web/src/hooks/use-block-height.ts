'use client';

import { useQuery } from '@tanstack/react-query';

async function fetchBlockHeight(): Promise<number> {
  const response = await fetch('https://mempool.space/testnet4/api/blocks/tip/height');
  if (!response.ok) {
    throw new Error('Failed to fetch block height');
  }
  const text = await response.text();
  return Number.parseInt(text, 10);
}

export function useBlockHeight() {
  return useQuery({
    queryKey: ['block-height'],
    queryFn: fetchBlockHeight,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 30_000, // Refetch every 30 seconds
    retry: 2,
  });
}
