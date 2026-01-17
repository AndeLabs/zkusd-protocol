'use client';

import { usePrice } from '@/hooks/use-price';
import { useBlockHeight } from '@/hooks/use-block-height';
import { useFees } from '@/hooks/use-fees';
import { formatUSD } from '@/lib/utils';
import { Skeleton } from '@/components/ui';

export function StatsBar() {
  const { data: priceData, isLoading: priceLoading } = usePrice();
  const { data: blockHeight, isLoading: blockLoading } = useBlockHeight();
  const { data: fees, isLoading: feesLoading } = useFees();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
      {/* BTC Price */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">BTC Price</p>
        {priceLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : priceData ? (
          <p className="font-mono text-lg text-white">{formatUSD(priceData.price)}</p>
        ) : (
          <p className="text-zinc-500">--</p>
        )}
      </div>

      {/* Block Height */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">Block Height</p>
        {blockLoading ? (
          <Skeleton className="h-6 w-20" />
        ) : blockHeight ? (
          <p className="font-mono text-lg text-white">{blockHeight.toLocaleString()}</p>
        ) : (
          <p className="text-zinc-500">--</p>
        )}
      </div>

      {/* Network Fee */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">Network Fee</p>
        {feesLoading ? (
          <Skeleton className="h-6 w-20" />
        ) : fees ? (
          <p className="font-mono text-lg text-white">{fees.halfHourFee} sat/vB</p>
        ) : (
          <p className="text-zinc-500">--</p>
        )}
      </div>

      {/* Network Status */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">Network</p>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <p className="text-lg text-white">Testnet4</p>
        </div>
      </div>
    </div>
  );
}
