'use client';

import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/stores/wallet';
import { getClient } from '@/lib/sdk';

export function useUserVaults() {
  const { address, isConnected } = useWallet();
  const client = getClient();

  return useQuery({
    queryKey: ['user-vaults', address],
    queryFn: async () => {
      if (!address) return [];

      // Get vaults owned by user
      // Note: This requires a Charms indexer to scan for vault NFTs
      const vaults = await client.vault.getVaultsByOwner(address);
      return vaults;
    },
    enabled: isConnected && !!address,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
