import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#f59e0b',
};

export const metadata: Metadata = {
  title: 'zkUSD - Bitcoin-Native Stablecoin',
  description:
    'Mint zkUSD stablecoins by depositing BTC as collateral. Powered by zero-knowledge proofs on Bitcoin via Charms.',
  keywords: ['zkUSD', 'Bitcoin', 'Stablecoin', 'DeFi', 'Charms', 'ZK Proofs'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} font-sans antialiased bg-zinc-950 text-zinc-100 min-h-screen`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
