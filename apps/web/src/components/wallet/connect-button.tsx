'use client';

import { Button } from '@/components/ui';
import { formatBTC } from '@/lib/utils';
import { useWallet } from '@/stores/wallet';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function ConnectButton() {
  const {
    isConnected,
    isConnecting,
    address,
    balance,
    isLoadingBalance,
    connect,
    disconnect,
    error,
  } = useWallet();

  const [showMenu, setShowMenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu]);

  if (!mounted) {
    return (
      <Button variant="primary" size="sm" disabled>
        Connect
      </Button>
    );
  }

  if (isConnected && address) {
    const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

    return (
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          {/* Balance */}
          <span className="text-sm font-mono text-amber-400">
            {isLoadingBalance ? '...' : formatBTC(balance)}
          </span>

          {/* Divider */}
          <span className="w-px h-4 bg-zinc-600" />

          {/* Address */}
          <span className="text-sm text-zinc-300">{shortAddress}</span>

          {/* Dropdown indicator */}
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${showMenu ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown menu */}
        <AnimatePresence>
          {showMenu && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-48 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl overflow-hidden z-50"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-3 border-b border-zinc-700">
                <p className="text-xs text-zinc-400 mb-1">Connected</p>
                <p className="text-sm font-mono text-zinc-200 truncate">{address}</p>
              </div>

              <div className="p-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(address);
                    toast.success('Address copied to clipboard');
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 rounded-md transition-colors"
                >
                  Copy Address
                </button>
                <a
                  href={`https://mempool.space/testnet4/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 rounded-md transition-colors"
                  onClick={() => setShowMenu(false)}
                >
                  View on Explorer
                </a>
                <button
                  onClick={() => {
                    disconnect();
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-700 rounded-md transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="relative">
      <Button variant="primary" size="sm" onClick={connect} loading={isConnecting}>
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </Button>

      {/* Error tooltip */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute right-0 top-full mt-2 w-64 p-3 rounded-lg bg-red-900/90 border border-red-700 text-sm text-red-200"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
