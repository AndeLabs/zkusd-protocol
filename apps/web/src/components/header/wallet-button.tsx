'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronIcon, WalletIcon, CopyIcon, ExternalLinkIcon, DisconnectIcon } from './icons';
import { UnisatLogo, XverseLogo, UnisatLogoSmall, XverseLogoSmall } from './wallet-logos';
import { formatBTC, truncateAddress } from '@zkusd/utils';
import { isWalletAvailable } from '@/lib';
import type { WalletType } from '@/stores';

interface WalletButtonProps {
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  balance: number;
  walletType: WalletType | null;
  showMenu: boolean;
  onToggleMenu: () => void;
  onConnect: (type: WalletType) => void;
  onDisconnect: () => void;
  onCopyAddress: () => void;
  onViewExplorer: () => void;
  onOpenInUnisat: () => void;
  isMobile: boolean;
}

export function WalletButton({
  isConnected,
  isConnecting,
  address,
  balance,
  walletType,
  showMenu,
  onToggleMenu,
  onConnect,
  onDisconnect,
  onCopyAddress,
  onViewExplorer,
  onOpenInUnisat,
  isMobile,
}: WalletButtonProps) {
  if (isConnected && address) {
    return (
      <div className="relative">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onToggleMenu}
          className="flex items-center gap-3 bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700 rounded-xl px-3 py-2 transition-all"
        >
          {/* Balance - Hidden on mobile */}
          <div className="text-right hidden sm:block">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Balance</div>
            <div className="text-sm font-mono text-zinc-200">{formatBTC(BigInt(balance))}</div>
          </div>

          {/* Divider */}
          <div className="hidden sm:block w-px h-8 bg-zinc-700" />

          {/* Address */}
          <div className="flex items-center gap-2">
            {walletType === 'unisat' ? <UnisatLogoSmall /> : <XverseLogoSmall />}
            <span className="font-mono text-sm">{truncateAddress(address)}</span>
            <ChevronIcon className={`text-zinc-400 transition-transform ${showMenu ? 'rotate-180' : ''}`} />
          </div>
        </motion.button>

        {/* Account Menu */}
        <AnimatePresence>
          {showMenu && (
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
                  onClick={onCopyAddress}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-700 rounded-lg transition-colors text-sm"
                >
                  <CopyIcon />
                  Copy Address
                </button>
                <button
                  onClick={onViewExplorer}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-700 rounded-lg transition-colors text-sm"
                >
                  <ExternalLinkIcon />
                  View on Explorer
                </button>
                <div className="h-px bg-zinc-700 my-2" />
                <button
                  onClick={onDisconnect}
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
    );
  }

  // Not connected state
  return (
    <div className="relative">
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onToggleMenu}
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
        {showMenu && !isConnecting && (
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
                {isMobile ? 'Conecta tu wallet de Bitcoin' : 'Select a wallet to connect to zkUSD'}
              </p>
            </div>

            <div className="p-2">
              {/* Unisat - Show special mobile option if not available */}
              {isMobile && !isWalletAvailable('unisat').available ? (
                <motion.button
                  whileHover={{ x: 4 }}
                  onClick={onOpenInUnisat}
                  className="w-full px-4 py-3 text-left bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl transition-colors flex items-center gap-4 group"
                >
                  <UnisatLogo />
                  <div className="flex-1">
                    <div className="font-medium text-amber-400">Abrir en Unisat</div>
                    <div className="text-xs text-zinc-400">Necesario para móvil</div>
                  </div>
                  <ExternalLinkIcon />
                </motion.button>
              ) : (
                <motion.button
                  whileHover={{ x: 4 }}
                  onClick={() => onConnect('unisat')}
                  className="w-full px-4 py-3 text-left hover:bg-zinc-700/50 rounded-xl transition-colors flex items-center gap-4 group"
                >
                  <UnisatLogo />
                  <div className="flex-1">
                    <div className="font-medium group-hover:text-amber-400 transition-colors">Unisat</div>
                    <div className="text-xs text-zinc-400">{isMobile ? 'Wallet móvil' : 'Browser extension'}</div>
                  </div>
                  <ChevronIcon className="text-zinc-600 group-hover:text-zinc-400 -rotate-90" />
                </motion.button>
              )}

              <motion.button
                whileHover={{ x: 4 }}
                onClick={() => onConnect('xverse')}
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
  );
}
