'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CloseIcon, ExternalLinkIcon, ChevronIcon } from './icons';
import { NAV_ITEMS } from './nav-links';
import type { NetworkId } from '@zkusd/config';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  networkId: NetworkId;
  onNetworkChange: (network: NetworkId) => void;
  isTestnet: boolean;
  isDemoMode: boolean;
}

export function MobileMenu({
  isOpen,
  onClose,
  networkId,
  onNetworkChange,
  isTestnet,
  isDemoMode,
}: MobileMenuProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3 }}
            className="fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-zinc-900 border-l border-zinc-800 z-50 md:hidden overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <span className="text-lg font-bold bg-gradient-to-r from-amber-200 to-orange-400 bg-clip-text text-transparent">
                Menu
              </span>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Navigation Links */}
            <nav className="p-4 space-y-2">
              {NAV_ITEMS.map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  onClick={onClose}
                  className="flex items-center px-4 py-3 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-all min-h-touch"
                >
                  {label}
                </a>
              ))}
              <a
                href="https://github.com/zkusd/protocol"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-4 py-3 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-all min-h-touch"
              >
                <span>Docs</span>
                <ExternalLinkIcon />
              </a>
            </nav>

            {/* Divider */}
            <div className="h-px bg-zinc-800 mx-4" />

            {/* Network Selector Mobile */}
            <div className="p-4 space-y-3">
              <label className="text-xs text-zinc-400 uppercase tracking-wider">Network</label>
              <div className="relative">
                <select
                  value={networkId}
                  onChange={(e) => onNetworkChange(e.target.value as NetworkId)}
                  className="w-full appearance-none bg-zinc-800 border border-zinc-700 rounded-lg pl-3 pr-8 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all cursor-pointer min-h-touch"
                >
                  <option value="testnet4">Testnet4</option>
                  <option value="mainnet">Mainnet</option>
                </select>
                <ChevronIcon className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              </div>
            </div>

            {/* Status Badges Mobile */}
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              {isTestnet && (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full font-medium">
                  Testnet
                </span>
              )}
              {isDemoMode && (
                <span className="text-xs bg-purple-500/20 text-purple-400 px-2.5 py-1 rounded-full font-medium">
                  Demo Mode
                </span>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
