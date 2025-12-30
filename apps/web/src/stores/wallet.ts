import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export type WalletType = 'unisat' | 'xverse';

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

interface WalletState {
  // Connection
  isConnected: boolean;
  walletType: WalletType | null;
  isConnecting: boolean;

  // Account
  address: string | null;
  publicKey: string | null;
  ordinalsAddress: string | null;
  paymentAddress: string | null;

  // Balance
  balance: number;
  utxos: Utxo[];

  // Status
  error: string | null;
  lastRefresh: number | null;
}

interface WalletActions {
  connect: (type: WalletType, explorerApiUrl: string, isTestnet: boolean) => Promise<void>;
  disconnect: () => void;
  refreshBalance: (explorerApiUrl: string) => Promise<void>;
  signPsbt: (psbtBase64: string, inputsToSign?: number[]) => Promise<string>;
  signAndBroadcast: (psbtBase64: string, inputsToSign?: number[]) => Promise<string>;
  setError: (error: string | null) => void;
  reset: () => void;
}

// ============================================================================
// Wallet Provider Types
// ============================================================================

interface UnisatProvider {
  requestAccounts: () => Promise<string[]>;
  getAccounts: () => Promise<string[]>;
  getPublicKey: () => Promise<string>;
  getNetwork: () => Promise<string>;
  switchNetwork: (network: string) => Promise<void>;
  signPsbt: (psbtHex: string, options?: { autoFinalized?: boolean }) => Promise<string>;
  pushPsbt: (psbtHex: string) => Promise<string>;
  getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number }>;
  on: (event: string, callback: (data: unknown) => void) => void;
  removeListener: (event: string, callback: (data: unknown) => void) => void;
}

interface XverseAddress {
  address: string;
  publicKey: string;
  purpose: 'payment' | 'ordinals' | 'stacks';
  addressType: 'p2tr' | 'p2wpkh' | 'p2sh' | 'stacks';
}

interface XverseResponse<T> {
  status: 'success' | 'error';
  result?: T;
  error?: { code: number; message: string };
}

interface XverseProvider {
  request: <T>(method: string, params?: unknown) => Promise<T>;
}

// ============================================================================
// Helpers
// ============================================================================

const getUnisat = (): UnisatProvider | null => {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { unisat?: UnisatProvider }).unisat || null;
};

const getXverse = (): XverseProvider | null => {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    XverseProviders?: { BitcoinProvider?: XverseProvider };
    BitcoinProvider?: XverseProvider;
  };
  return win.XverseProviders?.BitcoinProvider || win.BitcoinProvider || null;
};

const hexToBase64 = (hex: string): string => {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  return btoa(String.fromCharCode(...bytes));
};

const base64ToHex = (base64: string): string => {
  const binary = atob(base64);
  return Array.from(binary, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: WalletState = {
  isConnected: false,
  walletType: null,
  isConnecting: false,
  address: null,
  publicKey: null,
  ordinalsAddress: null,
  paymentAddress: null,
  balance: 0,
  utxos: [],
  error: null,
  lastRefresh: null,
};

// ============================================================================
// Store
// ============================================================================

export const useWalletStore = create<WalletState & WalletActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      connect: async (type: WalletType, explorerApiUrl: string, isTestnet: boolean) => {
        set({ isConnecting: true, error: null });

        try {
          if (type === 'unisat') {
            await connectUnisat(set, get, explorerApiUrl, isTestnet);
          } else if (type === 'xverse') {
            await connectXverse(set, get, explorerApiUrl);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to connect';
          set({ error: message, isConnecting: false, isConnected: false });
          throw err;
        }
      },

      disconnect: () => {
        set({ ...initialState });
      },

      refreshBalance: async (explorerApiUrl: string) => {
        const { address } = get();
        if (!address) return;

        try {
          const response = await fetch(`${explorerApiUrl}/address/${address}/utxo`);
          if (!response.ok) throw new Error('Failed to fetch UTXOs');

          const utxos: Utxo[] = await response.json();
          const balance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

          set({ utxos, balance, lastRefresh: Date.now() });
        } catch (err) {
          console.error('Failed to refresh balance:', err);
        }
      },

      signPsbt: async (psbtBase64: string, inputsToSign?: number[]) => {
        const { isConnected, walletType, address } = get();

        if (!isConnected || !address) {
          throw new Error('Wallet not connected');
        }

        if (walletType === 'unisat') {
          const unisat = getUnisat();
          if (!unisat) throw new Error('Unisat not available');

          const psbtHex = base64ToHex(psbtBase64);
          const signedHex = await unisat.signPsbt(psbtHex, { autoFinalized: true });
          return hexToBase64(signedHex);
        }

        if (walletType === 'xverse') {
          const xverse = getXverse();
          if (!xverse) throw new Error('Xverse not available');

          const signInputs: Record<string, number[]> = {};
          if (inputsToSign && address) {
            signInputs[address] = inputsToSign;
          }

          const response = await xverse.request<XverseResponse<{ psbt: string }>>('signPsbt', {
            psbt: psbtBase64,
            signInputs: Object.keys(signInputs).length > 0 ? signInputs : undefined,
            broadcast: false,
          });

          if (response.status !== 'success' || !response.result) {
            throw new Error(response.error?.message || 'Failed to sign PSBT');
          }

          return response.result.psbt;
        }

        throw new Error('Unknown wallet type');
      },

      signAndBroadcast: async (psbtBase64: string, inputsToSign?: number[]) => {
        const { isConnected, walletType, address } = get();

        if (!isConnected || !address) {
          throw new Error('Wallet not connected');
        }

        if (walletType === 'unisat') {
          const unisat = getUnisat();
          if (!unisat) throw new Error('Unisat not available');

          const psbtHex = base64ToHex(psbtBase64);
          const signedHex = await unisat.signPsbt(psbtHex, { autoFinalized: true });
          const txid = await unisat.pushPsbt(signedHex);
          return txid;
        }

        if (walletType === 'xverse') {
          const xverse = getXverse();
          if (!xverse) throw new Error('Xverse not available');

          const signInputs: Record<string, number[]> = {};
          if (inputsToSign && address) {
            signInputs[address] = inputsToSign;
          }

          const response = await xverse.request<XverseResponse<{ txid: string }>>('signPsbt', {
            psbt: psbtBase64,
            signInputs: Object.keys(signInputs).length > 0 ? signInputs : undefined,
            broadcast: true,
          });

          if (response.status !== 'success' || !response.result?.txid) {
            throw new Error(response.error?.message || 'Failed to broadcast');
          }

          return response.result.txid;
        }

        throw new Error('Unknown wallet type');
      },

      setError: (error: string | null) => set({ error }),

      reset: () => set({ ...initialState }),
    }),
    {
      name: 'zkusd-wallet',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        walletType: state.walletType,
        address: state.address,
      }),
    }
  )
);

// ============================================================================
// Connection Helpers
// ============================================================================

async function connectUnisat(
  set: (state: Partial<WalletState>) => void,
  get: () => WalletState & WalletActions,
  explorerApiUrl: string,
  isTestnet: boolean
) {
  const unisat = getUnisat();
  if (!unisat) {
    throw new Error('Unisat wallet not found. Please install from unisat.io');
  }

  const accounts = await unisat.requestAccounts();
  if (!accounts.length) {
    throw new Error('No accounts found');
  }

  const pubKey = await unisat.getPublicKey();
  const network = await unisat.getNetwork();
  const expectedNetwork = isTestnet ? 'testnet' : 'livenet';

  if (network !== expectedNetwork) {
    try {
      await unisat.switchNetwork(expectedNetwork);
    } catch {
      throw new Error(`Please switch to ${expectedNetwork} network in Unisat`);
    }
  }

  const mainAddress = accounts[0];

  set({
    isConnected: true,
    isConnecting: false,
    walletType: 'unisat',
    address: mainAddress,
    publicKey: pubKey,
    paymentAddress: mainAddress,
    ordinalsAddress: mainAddress,
  });

  // Fetch balance
  await get().refreshBalance(explorerApiUrl);
}

async function connectXverse(
  set: (state: Partial<WalletState>) => void,
  get: () => WalletState & WalletActions,
  explorerApiUrl: string
) {
  const xverse = getXverse();
  if (!xverse) {
    throw new Error('Xverse wallet not found. Please install from xverse.app');
  }

  const response = await xverse.request<XverseResponse<{ addresses: XverseAddress[] }>>('wallet_connect', {
    addresses: [{ purpose: 'payment' }, { purpose: 'ordinals' }],
    message: 'Connect to zkUSD Protocol',
  });

  if (response.status !== 'success' || !response.result) {
    throw new Error(response.error?.message || 'Failed to connect');
  }

  const addresses = response.result.addresses;
  const payment = addresses.find(a => a.purpose === 'payment');
  const ordinals = addresses.find(a => a.purpose === 'ordinals');

  if (!payment) {
    throw new Error('No payment address found');
  }

  set({
    isConnected: true,
    isConnecting: false,
    walletType: 'xverse',
    address: payment.address,
    publicKey: payment.publicKey,
    paymentAddress: payment.address,
    ordinalsAddress: ordinals?.address || payment.address,
  });

  await get().refreshBalance(explorerApiUrl);
}

// ============================================================================
// Selectors (for optimized re-renders)
// ============================================================================

export const selectIsConnected = (state: WalletState) => state.isConnected;
export const selectAddress = (state: WalletState) => state.address;
export const selectBalance = (state: WalletState) => state.balance;
export const selectWalletType = (state: WalletState) => state.walletType;
export const selectIsConnecting = (state: WalletState) => state.isConnecting;
