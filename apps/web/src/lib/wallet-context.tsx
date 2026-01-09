'use client';

import { type ReactNode, useEffect } from 'react';
import { useNetwork } from './network-context';
import { useWalletStore, useWalletEventListeners, useWallet as useWalletFromStore } from '@/stores/wallet';

// ============================================================================
// Re-export types and hooks from the centralized store
// ============================================================================

export type { Utxo, WalletType } from '@/stores/wallet';
export { useWallet } from '@/stores/wallet';

// ============================================================================
// WalletProvider Component
// ============================================================================

/**
 * WalletProvider initializes wallet event listeners and handles auto-reconnection.
 * All wallet state is managed by the Zustand store (useWalletStore).
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { config, isTestnet } = useNetwork();

  // Set up event listeners for account/network changes
  useWalletEventListeners();

  // Auto-reconnect on page load
  useAutoReconnect(config.explorerApiUrl, isTestnet);

  return <>{children}</>;
}

// ============================================================================
// Auto-Reconnect Hook
// ============================================================================

function useAutoReconnect(explorerApiUrl: string, isTestnet: boolean) {
  const { connect, isConnected, walletType, address } = useWalletStore();

  useEffect(() => {
    // Only attempt reconnect if we have persisted wallet info but not connected
    const state = useWalletStore.getState();

    if (!state.isConnected && state.walletType && state.address) {
      // We have persisted data, attempt to reconnect
      console.log('[Wallet] Attempting auto-reconnect...');
      connect(state.walletType, explorerApiUrl, isTestnet).catch((err) => {
        console.log('[Wallet] Auto-reconnect failed:', err.message);
        // Clear persisted data on failure
        useWalletStore.getState().reset();
      });
    }
  }, [connect, explorerApiUrl, isTestnet]);

  // Refresh balance when reconnected
  useEffect(() => {
    if (isConnected && address) {
      useWalletStore.getState().refreshBalance(explorerApiUrl);
    }
  }, [isConnected, address, explorerApiUrl]);
}
