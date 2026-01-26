'use client';

import { Tooltip } from '@/components/ui';
import type { ProtocolTransaction } from '@/features/explorer';
import { usePrice } from '@/hooks/use-price';
import { getTxUrl } from '@/lib/sdk';
import { formatBTC, formatUSD, formatZkUSD, truncateTxId } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useCallback, useState } from 'react';

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

interface MintDetailsProps {
  tx: ProtocolTransaction;
}

export function MintDetails({ tx }: MintDetailsProps) {
  const { data: priceData } = usePrice();

  const collateralBtc = tx.collateralSats ? tx.collateralSats / 1e8 : 0;
  const collateralUsd = priceData && tx.collateralSats ? collateralBtc * priceData.price : 0;

  const blockTime = tx.blockTime
    ? new Date(tx.blockTime * 1000).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : undefined;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="bg-zinc-800/50 rounded-lg p-4 mt-2 space-y-2 text-xs">
        {tx.collateralSats !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Collateral</span>
            <span className="font-mono text-zinc-300">
              {formatBTC(tx.collateralSats)} BTC
              {collateralUsd > 0 && (
                <span className="text-zinc-500 ml-1">({formatUSD(collateralUsd)})</span>
              )}
            </span>
          </div>
        )}

        {tx.zkusdMinted !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Minted</span>
            <span className="font-mono text-amber-400">{formatZkUSD(tx.zkusdMinted)} zkUSD</span>
          </div>
        )}

        {tx.vaultId && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Vault ID</span>
            <div className="flex items-center gap-1">
              <Tooltip content={tx.vaultId}>
                <span className="font-mono text-zinc-300">{truncateTxId(tx.vaultId, 6)}</span>
              </Tooltip>
              <CopyButton text={tx.vaultId} />
            </div>
          </div>
        )}

        {tx.blockHeight && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Block</span>
            <span className="font-mono text-zinc-300">#{tx.blockHeight.toLocaleString()}</span>
          </div>
        )}

        {blockTime && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Timestamp</span>
            <span className="text-zinc-300">{blockTime}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Fee</span>
          <span className="font-mono text-zinc-300">{tx.fee.toLocaleString()} sats</span>
        </div>

        <div className="pt-2 border-t border-zinc-700">
          <a
            href={getTxUrl(tx.txid)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400/80 hover:text-amber-400 transition-colors inline-flex items-center gap-1"
          >
            View on mempool.space
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
        </div>
      </div>
    </motion.div>
  );
}
