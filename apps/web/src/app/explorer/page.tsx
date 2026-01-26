import type { Metadata } from 'next';
import { ExplorerContent } from './explorer-content';

export const metadata: Metadata = {
  title: 'Explorer | zkUSD - Bitcoin-Native Stablecoin',
  description:
    'Explore zkUSD protocol state verified on Bitcoin Testnet4. View minted zkUSD, collateral, deployed contracts, and transaction history.',
};

export default function ExplorerPage() {
  return <ExplorerContent />;
}
