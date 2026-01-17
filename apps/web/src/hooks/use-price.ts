'use client';

import { useQuery } from '@tanstack/react-query';

interface PriceData {
  price: number;
  change24h: number;
  timestamp: number;
}

async function fetchBTCPrice(): Promise<PriceData> {
  const response = await fetch('/api/price');
  if (!response.ok) {
    throw new Error('Failed to fetch price');
  }
  return response.json();
}

export function usePrice() {
  return useQuery({
    queryKey: ['btc-price'],
    queryFn: fetchBTCPrice,
    staleTime: 60_000, // 1 minute
    refetchInterval: 60_000, // Refetch every minute
    retry: 2,
  });
}
