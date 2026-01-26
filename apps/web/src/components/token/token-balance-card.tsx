'use client';

import { getClient } from '@/lib/sdk';
import { formatZkUSD } from '@/lib/utils';
import type { TrackedTokenBalance } from '@zkusd/types';
import { motion } from 'framer-motion';

interface TokenBalanceCardProps {
  balances: TrackedTokenBalance[];
  totalBalance: bigint;
}

export function TokenBalanceCard({ balances, totalBalance }: TokenBalanceCardProps) {
  const client = getClient();

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="p-4 bg-zinc-800 rounded-xl border border-zinc-700"
    >
      {/* Total Balance */}
      <div className="mb-3">
        <span className="text-zinc-500 text-sm">Total Balance</span>
        <p className="font-mono text-xl text-amber-400">{formatZkUSD(totalBalance)} zkUSD</p>
      </div>

      {/* Individual Balances */}
      {balances.length > 1 && (
        <div className="space-y-2 mb-3 border-t border-zinc-700 pt-3">
          {balances.map((balance, _index) => (
            <div key={balance.utxo} className="flex items-center justify-between text-sm">
              <span className="text-zinc-500 font-mono">
                {balance.sourceOperation === 'mint' ? 'Minted' : balance.sourceOperation}
              </span>
              <span className="font-mono text-white">{formatZkUSD(balance.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Source Transaction Link */}
      {balances.length > 0 && (
        <div className="text-xs text-zinc-500">
          {balances.length === 1 ? (
            <a
              href={client.getTxUrl(balances[0].sourceTxId)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 transition-colors"
            >
              TX: {balances[0].sourceTxId.slice(0, 8)}...{balances[0].sourceTxId.slice(-8)}
            </a>
          ) : (
            <span>{balances.length} token UTXOs tracked locally</span>
          )}
        </div>
      )}
    </motion.div>
  );
}
