import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WalletType = 'unisat';

export interface WalletState {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  publicKey: string | null;
  walletType: WalletType | null;

  // Balance
  balance: number; // in satoshis
  isLoadingBalance: boolean;

  // Network
  network: 'livenet' | 'testnet' | 'testnet4';

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  setNetwork: (network: 'livenet' | 'testnet' | 'testnet4') => void;

  // Internal
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  error: string | null;
}

// Unisat wallet interface
declare global {
  interface Window {
    unisat?: {
      requestAccounts: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      getPublicKey: () => Promise<string>;
      getNetwork: () => Promise<string>;
      switchNetwork: (network: string) => Promise<void>;
      getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number }>;
      sendBitcoin: (to: string, amount: number) => Promise<string>;
      signMessage: (message: string) => Promise<string>;
      signPsbt: (psbtHex: string, options?: { autoFinalized?: boolean }) => Promise<string>;
      on: (event: string, handler: (data: unknown) => void) => void;
      removeListener: (event: string, handler: (data: unknown) => void) => void;
    };
  }
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      // Initial state
      isConnected: false,
      isConnecting: false,
      address: null,
      publicKey: null,
      walletType: null,
      balance: 0,
      isLoadingBalance: false,
      network: 'testnet4',
      error: null,

      setConnecting: (connecting) => set({ isConnecting: connecting }),
      setError: (error) => set({ error }),

      connect: async () => {
        const { setConnecting, setError, refreshBalance } = get();

        if (typeof window === 'undefined' || !window.unisat) {
          setError('Unisat wallet not found. Please install the extension.');
          return;
        }

        try {
          setConnecting(true);
          setError(null);

          // Request accounts
          const accounts = await window.unisat.requestAccounts();
          if (!accounts || accounts.length === 0) {
            throw new Error('No accounts returned');
          }

          // Get public key
          const publicKey = await window.unisat.getPublicKey();

          // Check network
          const network = await window.unisat.getNetwork();

          // Switch to testnet4 if not already
          if (network !== 'testnet4') {
            try {
              await window.unisat.switchNetwork('testnet4');
            } catch {
              // If switch fails, still allow connection but warn user
              setError(`Connected on ${network}. Please switch to testnet4 manually in Unisat.`);
            }
          }

          set({
            isConnected: true,
            address: accounts[0],
            publicKey,
            walletType: 'unisat',
            network: 'testnet4',
          });

          // Fetch balance
          await refreshBalance();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to connect wallet';
          setError(message);
          set({ isConnected: false, address: null, publicKey: null });
        } finally {
          setConnecting(false);
        }
      },

      disconnect: () => {
        set({
          isConnected: false,
          address: null,
          publicKey: null,
          walletType: null,
          balance: 0,
          error: null,
        });
      },

      refreshBalance: async () => {
        if (typeof window === 'undefined' || !window.unisat) return;

        const { isConnected } = get();
        if (!isConnected) return;

        try {
          set({ isLoadingBalance: true });
          const balance = await window.unisat.getBalance();
          set({ balance: balance.total });
        } catch (error) {
          console.error('Failed to fetch balance:', error);
        } finally {
          set({ isLoadingBalance: false });
        }
      },

      setNetwork: async (network) => {
        if (typeof window === 'undefined' || !window.unisat) return;

        const { setError, refreshBalance } = get();

        try {
          await window.unisat.switchNetwork(network);
          set({ network, error: null });
          // Refresh balance after network switch
          await refreshBalance();
        } catch {
          setError(`Failed to switch to ${network}. Please switch manually in Unisat.`);
        }
      },
    }),
    {
      name: 'zkusd-wallet',
      partialize: (state) => ({
        // Only persist these fields
        walletType: state.walletType,
        network: state.network,
      }),
    }
  )
);

// Hook for easy access
export function useWallet() {
  return useWalletStore();
}
