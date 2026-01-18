import { ZkUsdClient } from '@zkusd/sdk';
import { NETWORKS, type NetworkId } from './constants';

// Singleton client instance per network
const clients = new Map<NetworkId, ZkUsdClient>();

// Demo mode - enable when WASM/VK mismatch prevents real transactions
// Set NEXT_PUBLIC_DEMO_MODE=true in environment to enable
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

/**
 * Get or create a ZkUsdClient for the specified network
 */
export function getClient(network: NetworkId = 'testnet4'): ZkUsdClient {
  let client = clients.get(network);

  if (!client) {
    const config = NETWORKS[network];
    client = new ZkUsdClient({
      network,
      charmsApiUrl: config.charmsProverUrl,
      demoMode: DEMO_MODE,
    });
    clients.set(network, client);

    if (DEMO_MODE) {
      console.warn('[zkUSD] Running in DEMO MODE - transactions are simulated');
    }
  }

  return client;
}

/**
 * Clear all cached clients (useful for network switching)
 */
export function clearClients(): void {
  clients.clear();
}

/**
 * Get explorer URL for a transaction
 */
export function getTxUrl(txid: string, network: NetworkId = 'testnet4'): string {
  return `${NETWORKS[network].explorerUrl}/tx/${txid}`;
}

/**
 * Get explorer URL for an address
 */
export function getAddressUrl(address: string, network: NetworkId = 'testnet4'): string {
  return `${NETWORKS[network].explorerUrl}/address/${address}`;
}
