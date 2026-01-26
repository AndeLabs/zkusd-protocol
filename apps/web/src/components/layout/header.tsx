'use client';

import { Badge, DemoModeBanner } from '@/components/ui';
import { ConnectButton } from '@/components/wallet/connect-button';
import { usePrice } from '@/hooks/use-price';
import { formatUSD } from '@/lib/utils';
import { motion } from 'framer-motion';
import Link from 'next/link';

export function Header() {
  const { data: priceData, isLoading: priceLoading } = usePrice();

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md"
    >
      <DemoModeBanner />
      <nav aria-label="Main navigation" className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group" aria-label="zkUSD Home">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20"
            >
              <span className="text-white font-bold text-sm">zk</span>
            </motion.div>
            <span className="text-xl font-bold bg-gradient-to-r from-amber-200 to-orange-400 bg-clip-text text-transparent">
              zkUSD
            </span>
          </Link>

          {/* Center: Price + Nav */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/explorer"
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Explorer
            </Link>
            <div className="w-px h-4 bg-zinc-800" />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">BTC</span>
              {priceLoading ? (
                <span className="text-zinc-500 animate-pulse">Loading...</span>
              ) : priceData ? (
                <span className="font-mono text-white">{formatUSD(priceData.price)}</span>
              ) : (
                <span className="text-zinc-500">--</span>
              )}
            </div>
            <Badge variant="warning" size="sm">
              Testnet4
            </Badge>
          </div>

          {/* Right: Wallet */}
          <div className="flex items-center gap-3">
            {/* Mobile nav + price */}
            <Link
              href="/explorer"
              className="md:hidden text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Explorer
            </Link>
            <div className="md:hidden text-sm" aria-label="BTC Price">
              {priceData && (
                <span className="font-mono text-zinc-400" title={`BTC Price: ${formatUSD(priceData.price)}`}>
                  ${Math.round(priceData.price).toLocaleString()}
                </span>
              )}
            </div>

            <ConnectButton />
          </div>
        </div>
      </nav>
    </header>
  );
}
