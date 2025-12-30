'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useNetwork } from './network-context';

// ============================================================================
// Types
// ============================================================================

export interface Utxo {
  txid: string;
  vout: number;
  value: number; // satoshis
  status: { confirmed: boolean };
}

export type WalletType = 'unisat' | 'xverse';

export interface WalletAccount {
  address: string;
  publicKey: string;
  purpose: 'payment' | 'ordinals';
  addressType: 'p2tr' | 'p2wpkh' | 'p2sh';
}

interface WalletContextType {
  // Connection state
  isConnected: boolean;
  walletType: WalletType | null;

  // Account info
  address: string | null;
  publicKey: string | null;
  ordinalsAddress: string | null;
  paymentAddress: string | null;

  // Balance
  balance: number; // satoshis
  utxos: Utxo[];

  // Actions
  connect: (walletType: WalletType) => Promise<void>;
  disconnect: () => void;
  signPsbt: (psbtBase64: string, inputsToSign?: number[]) => Promise<string>;
  signAndBroadcast: (psbtBase64: string, inputsToSign?: number[]) => Promise<string>;
  refreshBalance: () => Promise<void>;

  // Status
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// Unisat Types
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

// ============================================================================
// Xverse Types (Sats Connect)
// ============================================================================

interface XverseAddress {
  address: string;
  publicKey: string;
  purpose: 'payment' | 'ordinals' | 'stacks';
  addressType: 'p2tr' | 'p2wpkh' | 'p2sh' | 'stacks';
  network?: string;
}

interface XverseConnectResponse {
  status: 'success' | 'error';
  result?: {
    addresses: XverseAddress[];
    walletType?: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface XverseSignPsbtResponse {
  status: 'success' | 'error';
  result?: {
    psbt: string;
    txid?: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface XverseProvider {
  request: <T>(method: string, params?: unknown) => Promise<T>;
}

// ============================================================================
// Context
// ============================================================================

const WalletContext = createContext<WalletContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function WalletProvider({ children }: { children: ReactNode }) {
  const { config, isTestnet } = useNetwork();

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [walletType, setWalletType] = useState<WalletType | null>(null);

  // Account info
  const [address, setAddress] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [ordinalsAddress, setOrdinalsAddress] = useState<string | null>(null);
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null);

  // Balance
  const [balance, setBalance] = useState(0);
  const [utxos, setUtxos] = useState<Utxo[]>([]);

  // Status
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ============================================================================
  // Helpers
  // ============================================================================

  const getUnisat = (): UnisatProvider | null => {
    return (window as unknown as { unisat?: UnisatProvider }).unisat || null;
  };

  const getXverse = (): XverseProvider | null => {
    // Try to get from XverseProviders or BitcoinProvider
    const win = window as unknown as {
      XverseProviders?: { BitcoinProvider?: XverseProvider };
      BitcoinProvider?: XverseProvider;
    };
    return win.XverseProviders?.BitcoinProvider || win.BitcoinProvider || null;
  };

  const fetchUtxos = useCallback(async (addr: string) => {
    try {
      const response = await fetch(`${config.explorerApiUrl}/address/${addr}/utxo`);
      if (!response.ok) throw new Error('Failed to fetch UTXOs');
      const data = await response.json();
      setUtxos(data);
      const total = data.reduce((sum: number, utxo: Utxo) => sum + utxo.value, 0);
      setBalance(total);
    } catch (err) {
      console.error('Failed to fetch UTXOs:', err);
    }
  }, [config]);

  // ============================================================================
  // Unisat Connection
  // ============================================================================

  const connectUnisat = useCallback(async () => {
    const unisat = getUnisat();

    if (!unisat) {
      throw new Error('Unisat wallet not found. Please install the extension from unisat.io');
    }

    // Request accounts
    const accounts = await unisat.requestAccounts();
    if (!accounts.length) {
      throw new Error('No accounts found');
    }

    // Get public key
    const pubKey = await unisat.getPublicKey();

    // Check network
    const network = await unisat.getNetwork();
    const expectedNetwork = isTestnet ? 'testnet' : 'livenet';

    if (network !== expectedNetwork) {
      try {
        await unisat.switchNetwork(expectedNetwork);
      } catch {
        throw new Error(`Please switch to ${expectedNetwork} network in Unisat`);
      }
    }

    // Set state
    const mainAddress = accounts[0];
    setAddress(mainAddress);
    setPublicKey(pubKey);
    setPaymentAddress(mainAddress);
    setOrdinalsAddress(mainAddress); // Unisat uses same address
    setWalletType('unisat');
    setIsConnected(true);

    // Fetch UTXOs
    await fetchUtxos(mainAddress);
  }, [isTestnet, fetchUtxos]);

  // ============================================================================
  // Xverse Connection
  // ============================================================================

  const connectXverse = useCallback(async () => {
    const xverse = getXverse();

    if (!xverse) {
      throw new Error('Xverse wallet not found. Please install the extension from xverse.app');
    }

    try {
      // Use sats-connect pattern
      const response = await xverse.request<XverseConnectResponse>('wallet_connect', {
        addresses: [
          { purpose: 'payment' },
          { purpose: 'ordinals' },
        ],
        message: 'Connect to zkUSD Protocol',
      });

      if (response.status !== 'success' || !response.result) {
        throw new Error(response.error?.message || 'Failed to connect to Xverse');
      }

      const addresses = response.result.addresses;

      // Find payment and ordinals addresses
      const payment = addresses.find(a => a.purpose === 'payment');
      const ordinals = addresses.find(a => a.purpose === 'ordinals');

      if (!payment) {
        throw new Error('No payment address found');
      }

      // Set state - use payment address as primary
      setAddress(payment.address);
      setPublicKey(payment.publicKey);
      setPaymentAddress(payment.address);
      setOrdinalsAddress(ordinals?.address || payment.address);
      setWalletType('xverse');
      setIsConnected(true);

      // Fetch UTXOs
      await fetchUtxos(payment.address);

    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('Failed to connect to Xverse wallet');
    }
  }, [fetchUtxos]);

  // ============================================================================
  // Main Connect
  // ============================================================================

  const connect = useCallback(async (type: WalletType) => {
    setIsLoading(true);
    setError(null);

    try {
      if (type === 'unisat') {
        await connectUnisat();
      } else if (type === 'xverse') {
        await connectXverse();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      setIsConnected(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [connectUnisat, connectXverse]);

  // ============================================================================
  // Disconnect
  // ============================================================================

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setWalletType(null);
    setAddress(null);
    setPublicKey(null);
    setOrdinalsAddress(null);
    setPaymentAddress(null);
    setBalance(0);
    setUtxos([]);
    setError(null);
  }, []);

  // ============================================================================
  // Sign PSBT
  // ============================================================================

  const signPsbt = useCallback(async (psbtBase64: string, inputsToSign?: number[]): Promise<string> => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    if (walletType === 'unisat') {
      const unisat = getUnisat();
      if (!unisat) throw new Error('Unisat not available');

      // Unisat expects hex, convert from base64
      const psbtHex = Buffer.from(psbtBase64, 'base64').toString('hex');
      const signedHex = await unisat.signPsbt(psbtHex, { autoFinalized: true });

      // Convert back to base64
      return Buffer.from(signedHex, 'hex').toString('base64');
    }

    if (walletType === 'xverse') {
      const xverse = getXverse();
      if (!xverse) throw new Error('Xverse not available');

      // Build signInputs map
      const signInputs: Record<string, number[]> = {};
      if (inputsToSign && address) {
        signInputs[address] = inputsToSign;
      }

      const response = await xverse.request<XverseSignPsbtResponse>('signPsbt', {
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
  }, [isConnected, address, walletType]);

  // ============================================================================
  // Sign and Broadcast
  // ============================================================================

  const signAndBroadcast = useCallback(async (psbtBase64: string, inputsToSign?: number[]): Promise<string> => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    if (walletType === 'unisat') {
      const unisat = getUnisat();
      if (!unisat) throw new Error('Unisat not available');

      // Sign first
      const psbtHex = Buffer.from(psbtBase64, 'base64').toString('hex');
      const signedHex = await unisat.signPsbt(psbtHex, { autoFinalized: true });

      // Broadcast
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

      const response = await xverse.request<XverseSignPsbtResponse>('signPsbt', {
        psbt: psbtBase64,
        signInputs: Object.keys(signInputs).length > 0 ? signInputs : undefined,
        broadcast: true, // Broadcast after signing
      });

      if (response.status !== 'success' || !response.result?.txid) {
        throw new Error(response.error?.message || 'Failed to sign and broadcast');
      }

      return response.result.txid;
    }

    throw new Error('Unknown wallet type');
  }, [isConnected, address, walletType]);

  // ============================================================================
  // Refresh Balance
  // ============================================================================

  const refreshBalance = useCallback(async () => {
    if (address) {
      await fetchUtxos(address);
    }
  }, [address, fetchUtxos]);

  // ============================================================================
  // Auto-reconnect on page load
  // ============================================================================

  useEffect(() => {
    // Check if we have a saved wallet connection
    const savedWallet = localStorage.getItem('zkusd_wallet_type');
    if (savedWallet === 'unisat' || savedWallet === 'xverse') {
      // Attempt silent reconnect
      connect(savedWallet).catch(() => {
        localStorage.removeItem('zkusd_wallet_type');
      });
    }
  }, [connect]);

  // Save wallet type on connect
  useEffect(() => {
    if (isConnected && walletType) {
      localStorage.setItem('zkusd_wallet_type', walletType);
    } else if (!isConnected) {
      localStorage.removeItem('zkusd_wallet_type');
    }
  }, [isConnected, walletType]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        walletType,
        address,
        publicKey,
        ordinalsAddress,
        paymentAddress,
        balance,
        utxos,
        connect,
        disconnect,
        signPsbt,
        signAndBroadcast,
        refreshBalance,
        isLoading,
        error,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}
