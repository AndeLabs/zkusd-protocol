'use client';

import { Badge, Skeleton } from '@/components/ui';
import { useProtocolActivity } from '@/features/explorer';
import type { ProtocolTransaction } from '@/features/explorer';
import { getTxUrl } from '@/lib/sdk';
import { cn, formatBTC, formatZkUSD, truncateTxId } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { MintDetails } from './mint-details';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0 },
};

const SKELETON_KEYS = ['skel-a', 'skel-b', 'skel-c', 'skel-d'];

function getTypeBadge(type: ProtocolTransaction['type']) {
  switch (type) {
    case 'deploy':
      return { label: 'Deploy', variant: 'info' as const };
    case 'set-minter':
      return { label: 'Config', variant: 'warning' as const };
    case 'mint':
      return { label: 'Mint', variant: 'success' as const };
  }
}

function formatBlockTime(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getDotClass(tx: ProtocolTransaction): string {
  if (tx.type === 'mint') return 'bg-amber-400 border-amber-500/50';
  if (tx.type === 'set-minter') return 'bg-yellow-400 border-yellow-500/50';
  return 'bg-zinc-600 border-zinc-500/50';
}

interface TransactionRowProps {
  tx: ProtocolTransaction;
  isExpanded: boolean;
  onToggle: () => void;
}

function TransactionRow({ tx, isExpanded, onToggle }: TransactionRowProps) {
  const typeBadge = getTypeBadge(tx.type);
  const isMint = tx.type === 'mint';
  const isClickable = isMint && (tx.collateralSats !== undefined || tx.zkusdMinted !== undefined);

  return (
    <div
      className={cn(
        'relative pl-6 py-3 rounded-lg transition-colors',
        isClickable && 'cursor-pointer hover:bg-zinc-900/50',
        isExpanded && 'bg-zinc-900/50'
      )}
      onClick={isClickable ? onToggle : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Timeline dot */}
      <div
        className={cn(
          'absolute left-0 top-[18px] w-[11px] h-[11px] rounded-full border-2 z-10',
          getDotClass(tx)
        )}
      />

      {/* Main row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={typeBadge.variant} size="sm">
              {typeBadge.label}
            </Badge>
            <span className="text-sm text-white font-medium truncate">{tx.label}</span>
            {tx.source === 'user' && (
              <Badge
                variant="warning"
                size="sm"
                className="border-amber-500/30 bg-amber-500/10 text-amber-400"
              >
                Your Mint
              </Badge>
            )}
          </div>

          {/* Mint amounts inline */}
          {isMint && tx.collateralSats !== undefined && tx.zkusdMinted !== undefined && (
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className="font-mono text-zinc-400">{formatBTC(tx.collateralSats)} BTC</span>
              <svg
                aria-hidden="true"
                className="w-3 h-3 text-zinc-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
              <span className="font-mono text-amber-400">{formatZkUSD(tx.zkusdMinted)} zkUSD</span>
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-600 flex-wrap">
            {tx.blockHeight && (
              <span className="font-mono">Block #{tx.blockHeight.toLocaleString()}</span>
            )}
            {tx.blockTime && (
              <>
                <span className="text-zinc-700">|</span>
                <span>{formatBlockTime(tx.blockTime)}</span>
              </>
            )}
            {tx.fee > 0 && (
              <>
                <span className="text-zinc-700">|</span>
                <span className="font-mono">{tx.fee.toLocaleString()} sats fee</span>
              </>
            )}
            <span className="text-zinc-700">|</span>
            <a
              href={getTxUrl(tx.txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-amber-400 transition-colors font-mono"
              onClick={(e) => e.stopPropagation()}
            >
              {truncateTxId(tx.txid, 6)}
            </a>
          </div>
        </div>

        {/* Confirmation status */}
        <div className="shrink-0">
          {tx.confirmed ? (
            <Badge variant="success" size="sm">
              {tx.confirmations.toLocaleString()} conf{tx.confirmations !== 1 ? 's' : ''}
            </Badge>
          ) : (
            <Badge variant="warning" size="sm">
              Pending
            </Badge>
          )}
        </div>
      </div>

      {/* Expandable details */}
      <AnimatePresence>{isExpanded && isMint && <MintDetails tx={tx} />}</AnimatePresence>

      {/* Expand indicator for mints */}
      {isClickable && (
        <div className="flex justify-center mt-1">
          <motion.svg
            aria-hidden="true"
            className="w-4 h-4 text-zinc-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </div>
      )}
    </div>
  );
}

export function ActivityFeed() {
  const { transactions, isLoading } = useProtocolActivity();
  const [expandedTx, setExpandedTx] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="flex gap-4">
            <Skeleton className="w-3 h-3 rounded-full shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-500">No protocol activity found.</p>
      </div>
    );
  }

  return (
    <motion.div className="relative" variants={container} initial="hidden" animate="show">
      {/* Timeline line */}
      <div className="absolute left-[5px] top-2 bottom-2 w-px bg-zinc-800" />

      <div className="space-y-1">
        {transactions.map((tx) => (
          <motion.div key={tx.txid} variants={item}>
            <TransactionRow
              tx={tx}
              isExpanded={expandedTx === tx.txid}
              onToggle={() => setExpandedTx(expandedTx === tx.txid ? null : tx.txid)}
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
