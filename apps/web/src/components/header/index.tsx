'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNetwork, isMobileDevice, openInUnisatApp } from '@/lib';
import { useWalletStore, type WalletType } from '@/stores';
import { showToast } from '@/hooks';
import { getZkUsdClient } from '@/services';
import type { NetworkId } from '@zkusd/config';

import { ChevronIcon, MenuIcon, CloseIcon } from './icons';
import { DesktopNav } from './nav-links';
import { WalletButton } from './wallet-button';
import { MobileMenu } from './mobile-menu';
import { UnisatMobileInstructions } from '../unisat-mobile-instructions';

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
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showUnisatInstructions, setShowUnisatInstructions] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  // Detect if we're on mobile
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowWalletMenu(false);
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

  const handleOpenInUnisat = async () => {
    setShowWalletMenu(false);
    const result = await openInUnisatApp();
    setUrlCopied(result.copied);

    // Show instructions modal after attempting deep link
    result.showInstructions(() => {
      setShowUnisatInstructions(true);
    });
  };

  const handleDisconnect = () => {
    disconnect();
    setShowWalletMenu(false);
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

          {/* Desktop Navigation */}
          <DesktopNav />

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

            {/* Network Badge */}
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

            {/* Demo Mode Badge */}
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

            {/* Wallet Button */}
            <WalletButton
              isConnected={isConnected}
              isConnecting={isConnecting}
              address={address}
              balance={balance}
              walletType={walletType}
              showMenu={showWalletMenu}
              onToggleMenu={() => setShowWalletMenu(!showWalletMenu)}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onCopyAddress={handleCopyAddress}
              onViewExplorer={handleViewExplorer}
              onOpenInUnisat={handleOpenInUnisat}
              isMobile={isMobile}
            />

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
      <MobileMenu
        isOpen={showMobileMenu}
        onClose={() => setShowMobileMenu(false)}
        networkId={networkId}
        onNetworkChange={setNetwork}
        isTestnet={isTestnet}
        isDemoMode={isDemoMode}
      />

      {/* Unisat Mobile Instructions Modal */}
      <UnisatMobileInstructions
        isOpen={showUnisatInstructions}
        onClose={() => setShowUnisatInstructions(false)}
        currentUrl={typeof window !== 'undefined' ? window.location.href : ''}
        urlCopied={urlCopied}
      />
    </>
  );
}

// Re-export sub-components for external use
export * from './icons';
export * from './wallet-logos';
export * from './nav-links';
export * from './wallet-button';
export * from './mobile-menu';
