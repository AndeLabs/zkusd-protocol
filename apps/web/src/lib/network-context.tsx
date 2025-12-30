'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { getNetworkConfig, type NetworkId, type NetworkDeployment } from '@zkusd/config';

interface NetworkContextType {
  networkId: NetworkId;
  config: NetworkDeployment;
  setNetwork: (network: NetworkId) => void;
  isTestnet: boolean;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkId, setNetworkId] = useState<NetworkId>('testnet4');
  const config = getNetworkConfig(networkId);

  const setNetwork = useCallback((network: NetworkId) => {
    setNetworkId(network);
    // Persist preference
    if (typeof window !== 'undefined') {
      localStorage.setItem('zkusd-network', network);
    }
  }, []);

  return (
    <NetworkContext.Provider
      value={{
        networkId,
        config,
        setNetwork,
        isTestnet: networkId !== 'mainnet',
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within NetworkProvider');
  }
  return context;
}
