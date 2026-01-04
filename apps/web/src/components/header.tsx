'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNetwork } from '@/lib';
import { useWalletStore, type WalletType } from '@/stores';
import { showToast } from '@/hooks';
import { getZkUsdClient } from '@/services';
import { formatBTC, truncateAddress } from '@zkusd/utils';
import type { NetworkId } from '@zkusd/config';

// ============================================================================
// Icons
// ============================================================================

const ChevronIcon = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

const WalletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
    <path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5z" />
    <path d="M16 12a1 1 0 100 2 1 1 0 000-2z" fill="currentColor" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
  </svg>
);

const DisconnectIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
    <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

// ============================================================================
// Wallet Logo Components
// ============================================================================

const UnisatLogo = () => (
  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
    <span className="text-white font-bold text-sm">U</span>
  </div>
);

const XverseLogo = () => (
  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
    <span className="text-white font-bold text-sm">X</span>
  </div>
);

// ============================================================================
// Header Component
// ============================================================================

export function Header() {
  const { networkId, setNetwork, isTestnet, config } = useNetwork();
  const menuRef = useRef<HTMLDivElement>(null);

  // Check if we're in demo mode (testnet4 without a prover)
  const isDemoMode = useMemo(() => {
    const client = getZkUsdClient(networkId);
    return client.isDemoMode;
  }, [networkId]);

  // Zustand wallet store
  const {
    isConnected,
    isConnecting,
    address,
    balance,
    walletType,
    connect,
    disconnect,
    error,
    setError,
  } = useWalletStore();

  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowWalletMenu(false);
        setShowAccountMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (showMobileMenu) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showMobileMenu]);

  // Clear error after timeout
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [error, setError]);

  const handleConnect = async (type: WalletType) => {
    setShowWalletMenu(false);
    try {
      await connect(type, config.explorerApiUrl, isTestnet);
      showToast.walletConnected(type, useWalletStore.getState().address || '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      showToast.error('Connection failed', message);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setShowAccountMenu(false);
    showToast.walletDisconnected();
  };

  const handleCopyAddress = () => {
    if (address) {
      showToast.copyToClipboard(address, 'Address copied');
    }
  };

  const handleViewExplorer = () => {
    if (address) {
      window.open(`${config.explorerUrl}/address/${address}`, '_blank');
    }
  };

  return (
    <>
    <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 group flex-shrink-0">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20"
          >
            <span className="text-white font-bold text-sm">zk</span>
          </motion.div>
          <span className="text-lg sm:text-xl font-bold bg-gradient-to-r from-amber-200 to-orange-400 bg-clip-text text-transparent">
            zkUSD
          </span>
        </a>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {[
            { href: '/', label: 'Dashboard' },
            { href: '/vaults', label: 'Vaults' },
            { href: '/stability-pool', label: 'Stability Pool' },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="px-4 py-2 text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all"
            >
              {label}
            </a>
          ))}
          <a
            href="https://github.com/zkusd/protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all flex items-center gap-1"
          >
            Docs
            <ExternalLinkIcon />
          </a>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-3" ref={menuRef}>
          {/* Network Selector - Hidden on mobile */}
          <div className="relative hidden sm:block">
            <select
              value={networkId}
              onChange={(e) => setNetwork(e.target.value as NetworkId)}
              className="appearance-none bg-zinc-800/80 border border-zinc-700 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all cursor-pointer min-h-touch-sm"
            >
              <option value="testnet4">Testnet4</option>
              <option value="mainnet">Mainnet</option>
            </select>
            <ChevronIcon className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          </div>

          {/* Network Badge - Smaller on mobile */}
          <AnimatePresence>
            {isTestnet && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="hidden xs:inline-block text-xs bg-amber-500/20 text-amber-400 px-2 sm:px-2.5 py-1 rounded-full font-medium"
              >
                Testnet
              </motion.span>
            )}
          </AnimatePresence>

          {/* Demo Mode Badge - Hidden on small mobile */}
          <AnimatePresence>
            {isDemoMode && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="hidden sm:inline-block text-xs bg-purple-500/20 text-purple-400 px-2.5 py-1 rounded-full font-medium cursor-help"
                title="Demo mode: Transactions are simulated. Set NEXT_PUBLIC_PROVER_URL or run 'charms server' for real transactions."
              >
                Demo Mode
              </motion.span>
            )}
          </AnimatePresence>

          {/* Wallet */}
          {isConnected && address ? (
            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowAccountMenu(!showAccountMenu)}
                className="flex items-center gap-3 bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700 rounded-xl px-3 py-2 transition-all"
              >
                {/* Balance */}
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Balance</div>
                  <div className="text-sm font-mono text-zinc-200">{formatBTC(BigInt(balance))}</div>
                </div>

                {/* Divider */}
                <div className="hidden sm:block w-px h-8 bg-zinc-700" />

                {/* Address */}
                <div className="flex items-center gap-2">
                  {walletType === 'unisat' ? (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-[10px] font-bold text-white">U</div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white">X</div>
                  )}
                  <span className="font-mono text-sm">{truncateAddress(address)}</span>
                  <ChevronIcon className={`text-zinc-400 transition-transform ${showAccountMenu ? 'rotate-180' : ''}`} />
                </div>
              </motion.button>

              {/* Account Menu */}
              <AnimatePresence>
                {showAccountMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-64 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl overflow-hidden z-50"
                  >
                    {/* Header */}
                    <div className="px-4 py-3 bg-zinc-800/50 border-b border-zinc-700">
                      <div className="flex items-center gap-3">
                        {walletType === 'unisat' ? <UnisatLogo /> : <XverseLogo />}
                        <div>
                          <div className="font-medium capitalize">{walletType}</div>
                          <div className="text-xs text-zinc-400 font-mono">{truncateAddress(address, 10)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="px-4 py-3 border-b border-zinc-700">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Balance</div>
                      <div className="text-lg font-mono">{formatBTC(BigInt(balance))}</div>
                    </div>

                    {/* Actions */}
                    <div className="p-2">
                      <button
                        onClick={handleCopyAddress}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-700 rounded-lg transition-colors text-sm"
                      >
                        <CopyIcon />
                        Copy Address
                      </button>
                      <button
                        onClick={handleViewExplorer}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-700 rounded-lg transition-colors text-sm"
                      >
                        <ExternalLinkIcon />
                        View on Explorer
                      </button>
                      <div className="h-px bg-zinc-700 my-2" />
                      <button
                        onClick={handleDisconnect}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-red-500/10 text-red-400 rounded-lg transition-colors text-sm"
                      >
                        <DisconnectIcon />
                        Disconnect
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowWalletMenu(!showWalletMenu)}
                disabled={isConnecting}
                className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-semibold px-3 sm:px-4 py-2 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20 min-h-touch-sm text-sm sm:text-base"
              >
                {isConnecting ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full"
                    />
                    Connecting...
                  </>
                ) : (
                  <>
                    <WalletIcon />
                    <span className="hidden xs:inline">Connect</span>
                  </>
                )}
              </motion.button>

              {/* Wallet Selection Menu */}
              <AnimatePresence>
                {showWalletMenu && !isConnecting && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-72 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl overflow-hidden z-50"
                  >
                    <div className="p-4 border-b border-zinc-700">
                      <h3 className="font-semibold">Connect Wallet</h3>
                      <p className="text-xs text-zinc-400 mt-1">
                        Select a wallet to connect to zkUSD
                      </p>
                    </div>

                    <div className="p-2">
                      <motion.button
                        whileHover={{ x: 4 }}
                        onClick={() => handleConnect('unisat')}
                        className="w-full px-4 py-3 text-left hover:bg-zinc-700/50 rounded-xl transition-colors flex items-center gap-4 group"
                      >
                        <UnisatLogo />
                        <div className="flex-1">
                          <div className="font-medium group-hover:text-amber-400 transition-colors">Unisat</div>
                          <div className="text-xs text-zinc-400">Browser extension</div>
                        </div>
                        <ChevronIcon className="text-zinc-600 group-hover:text-zinc-400 -rotate-90" />
                      </motion.button>

                      <motion.button
                        whileHover={{ x: 4 }}
                        onClick={() => handleConnect('xverse')}
                        className="w-full px-4 py-3 text-left hover:bg-zinc-700/50 rounded-xl transition-colors flex items-center gap-4 group"
                      >
                        <XverseLogo />
                        <div className="flex-1">
                          <div className="font-medium group-hover:text-amber-400 transition-colors">Xverse</div>
                          <div className="text-xs text-zinc-400">Browser extension</div>
                        </div>
                        <ChevronIcon className="text-zinc-600 group-hover:text-zinc-400 -rotate-90" />
                      </motion.button>
                    </div>

                    <div className="px-4 py-3 bg-zinc-800/50 border-t border-zinc-700">
                      <p className="text-[10px] text-zinc-500 text-center">
                        By connecting, you agree to the Terms of Service
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Mobile Menu Button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
            aria-label="Toggle mobile menu"
          >
            {showMobileMenu ? <CloseIcon /> : <MenuIcon />}
          </motion.button>
        </div>
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-500/10 border-t border-red-500/20 px-4 py-2 text-center text-sm text-red-400"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </header>

    {/* Mobile Navigation Drawer */}
    <AnimatePresence>
      {showMobileMenu && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowMobileMenu(false)}
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
                onClick={() => setShowMobileMenu(false)}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Navigation Links */}
            <nav className="p-4 space-y-2">
              {[
                { href: '/', label: 'Dashboard' },
                { href: '/vaults', label: 'Vaults' },
                { href: '/stability-pool', label: 'Stability Pool' },
              ].map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setShowMobileMenu(false)}
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
                  onChange={(e) => setNetwork(e.target.value as NetworkId)}
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
    </>
  );
}
