import { ZkUsdClient } from '@zkusd/sdk';
import { NETWORKS, type NetworkId } from './constants';

// Singleton client instance per network
const clients = new Map<NetworkId, ZkUsdClient>();

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
    });
    clients.set(network, client);
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
