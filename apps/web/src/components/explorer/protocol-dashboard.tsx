'use client';

import { Badge, Skeleton, StatCard } from '@/components/ui';
import { useProtocolStats } from '@/features/explorer';
import { formatBTC, formatUSD, formatZkUSD } from '@/lib/utils';
import { motion } from 'framer-motion';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function getHealthVariant(cr: number): 'success' | 'warning' | 'danger' {
  if (cr >= 150) return 'success';
  if (cr >= 110) return 'warning';
  return 'danger';
}

function getHealthLabel(cr: number): string {
  if (cr >= 200) return 'Strong';
  if (cr >= 150) return 'Healthy';
  if (cr >= 110) return 'At Risk';
  return 'Critical';
}

export function ProtocolDashboard() {
  const { stats, collateralValueUsd, systemCR } = useProtocolStats();

  if (!stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['stat-a', 'stat-b', 'stat-c', 'stat-d'].map((key) => (
          <Skeleton key={key} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <motion.div
      className="grid grid-cols-2 md:grid-cols-4 gap-4"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item}>
        <StatCard
          label="Total zkUSD Supply"
          value={`${formatZkUSD(stats.totalSupply)}`}
          subValue={`${stats.activeVaults} vault${stats.activeVaults !== 1 ? 's' : ''} active`}
        />
      </motion.div>

      <motion.div variants={item}>
        <StatCard
          label="Total Collateral"
          value={formatBTC(stats.totalCollateral)}
          subValue={collateralValueUsd > 0 ? formatUSD(collateralValueUsd) : undefined}
        />
      </motion.div>

      <motion.div variants={item}>
        <StatCard
          label="Contracts Deployed"
          value={String(stats.contractsDeployed)}
          subValue="Charms v0.11.1"
        />
      </motion.div>

      <motion.div variants={item}>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-sm text-zinc-400 mb-1">System Health</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-white font-mono">
              {systemCR > 0 ? `${Math.round(systemCR)}%` : '--'}
            </p>
            {systemCR > 0 && (
              <Badge variant={getHealthVariant(systemCR)} size="sm">
                {getHealthLabel(systemCR)}
              </Badge>
            )}
          </div>
          <p className="text-sm text-zinc-500 mt-1">
            Base rate: {(stats.baseRateBps / 100).toFixed(1)}%
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
