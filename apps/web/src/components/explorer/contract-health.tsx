'use client';

import { Badge, Skeleton, Tooltip } from '@/components/ui';
import { useContractVerification } from '@/features/explorer';
import { getTxUrl } from '@/lib/sdk';
import { cn, truncateTxId } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useCallback, useState } from 'react';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5 text-green-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-400 hover:text-amber-400 transition-colors inline-flex items-center gap-1"
    >
      {children}
      <svg
        aria-hidden="true"
        className="w-3 h-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ContractHealth() {
  const { contracts, isLoading, lastChecked } = useContractVerification();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {['c-skel-a', 'c-skel-b', 'c-skel-c', 'c-skel-d'].map((key) => (
          <Skeleton key={key} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {lastChecked && (
        <p className="text-xs text-zinc-600 mb-3">
          Last verified: {formatRelativeTime(lastChecked.getTime())}
        </p>
      )}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {contracts.map((contract) => {
          const isLive = contract.verification?.isLive ?? false;
          const stateUtxoTxId = contract.stateUtxo.split(':')[0];

          return (
            <motion.div key={contract.appId} variants={item}>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'w-2.5 h-2.5 rounded-full',
                        isLive
                          ? 'bg-green-400 animate-pulse'
                          : contract.verification
                            ? 'bg-red-400'
                            : 'bg-zinc-600'
                      )}
                    />
                    <h3 className="text-sm font-semibold text-white">
                      {contract.name} {contract.version}
                    </h3>
                  </div>
                  <Badge
                    variant={isLive ? 'success' : contract.verification ? 'danger' : 'default'}
                    size="sm"
                  >
                    {isLive ? 'Live' : contract.verification ? 'Spent' : 'Unknown'}
                  </Badge>
                </div>

                {/* Description */}
                <p className="text-xs text-zinc-500 mb-3">{contract.description}</p>

                {/* Details */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">App ID</span>
                    <div className="flex items-center gap-1">
                      <Tooltip content={contract.appId}>
                        <span className="font-mono text-zinc-300">
                          {truncateTxId(contract.appId, 6)}
                        </span>
                      </Tooltip>
                      <CopyButton text={contract.appId} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">VK</span>
                    <div className="flex items-center gap-1">
                      <Tooltip content={contract.vk}>
                        <span className="font-mono text-zinc-300">
                          {truncateTxId(contract.vk, 6)}
                        </span>
                      </Tooltip>
                      <CopyButton text={contract.vk} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">State UTXO</span>
                    <div className="flex items-center gap-1">
                      <ExternalLink href={getTxUrl(stateUtxoTxId)}>
                        <span className="font-mono">{truncateTxId(contract.stateUtxo, 6)}</span>
                      </ExternalLink>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Deploy TX</span>
                    <div className="flex items-center gap-1">
                      <ExternalLink href={getTxUrl(contract.deployTxId)}>
                        <span className="font-mono">{truncateTxId(contract.deployTxId, 6)}</span>
                      </ExternalLink>
                    </div>
                  </div>

                  {contract.verification && (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Value</span>
                      <span className="font-mono text-zinc-300">
                        {contract.verification.value.toLocaleString()} sats
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                {contract.verification && (
                  <div className="mt-3 pt-3 border-t border-zinc-800">
                    <p className="text-xs text-zinc-600">
                      Verified {formatRelativeTime(contract.verification.checkedAt)}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
