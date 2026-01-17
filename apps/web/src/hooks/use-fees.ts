'use client';

import { useQuery } from '@tanstack/react-query';
import type { FeeEstimates } from '@zkusd/sdk';

async function fetchFeeEstimates(): Promise<FeeEstimates> {
  const response = await fetch('https://mempool.space/testnet4/api/v1/fees/recommended');
  if (!response.ok) {
    throw new Error('Failed to fetch fee estimates');
  }
  return response.json();
}

export function useFees() {
  return useQuery({
    queryKey: ['fee-estimates'],
    queryFn: fetchFeeEstimates,
    staleTime: 120_000, // 2 minutes
    refetchInterval: 120_000,
    retry: 2,
  });
}

/**
 * Get recommended fee for a specific priority
 */
export function useRecommendedFee(priority: 'fast' | 'medium' | 'slow' = 'medium') {
  const { data: fees, ...rest } = useFees();

  const fee = fees
    ? priority === 'fast'
      ? fees.fastestFee
      : priority === 'medium'
        ? fees.halfHourFee
        : fees.hourFee
    : null;

  return { fee, ...rest };
}
