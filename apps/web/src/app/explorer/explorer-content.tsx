'use client';

import { ActivityFeed, ContractHealth, ProtocolDashboard } from '@/components/explorer';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { Badge, Button } from '@/components/ui';
import { useContractVerification, useProtocolActivity } from '@/features/explorer';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useCallback, useState } from 'react';

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ExplorerContent() {
  const queryClient = useQueryClient();
  const { liveCount, lastChecked } = useContractVerification();
  const { mintCount } = useProtocolActivity();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['explorer'] });
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        {/* Page Header */}
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-3xl md:text-4xl font-bold mb-3 bg-gradient-to-r from-amber-200 to-orange-400 bg-clip-text text-transparent">
            zkUSD Explorer
          </h1>
          <p className="text-base text-zinc-400 max-w-xl mx-auto">
            On-chain protocol state verified against Bitcoin Testnet4
          </p>
          <div className="flex justify-center items-center gap-2 mt-4 flex-wrap">
            <Badge variant="success" size="sm">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 animate-pulse" />
              Live
            </Badge>
            <Badge variant="warning" size="sm">
              Testnet4
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-xs"
            >
              {isRefreshing ? (
                <span className="inline-flex items-center gap-1">
                  <svg
                    aria-hidden="true"
                    className="w-3 h-3 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Refreshing
                </span>
              ) : (
                'Refresh'
              )}
            </Button>
          </div>
          {lastChecked && (
            <p className="text-xs text-zinc-600 mt-2">
              Last updated: {formatRelativeTime(lastChecked)} &middot; Auto-refreshes every 2 min
            </p>
          )}
        </motion.div>

        {/* Protocol Dashboard */}
        <section aria-label="Protocol Statistics" className="mb-10">
          <ProtocolDashboard />
        </section>

        {/* Deployed Contracts */}
        <section aria-label="Smart Contract Status" className="mb-10">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            Deployed Contracts
            <Badge variant="default" size="sm">
              {liveCount}/4 Live
            </Badge>
          </h2>
          <ContractHealth />
        </section>

        {/* Protocol Activity */}
        <section aria-label="Transaction History" className="mb-10">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            Protocol Activity
            <Badge variant="default" size="sm">
              {mintCount} mint{mintCount !== 1 ? 's' : ''}
            </Badge>
          </h2>
          <ActivityFeed />
        </section>
      </main>

      <Footer />
    </div>
  );
}
