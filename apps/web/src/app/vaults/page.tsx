'use client';

import { PageLayout } from '@/components/shared';
import { VaultDashboard } from '@/components/vault-dashboard';
import { ProtocolStats } from '@/components/protocol-stats';
import { useWallet } from '@/lib';

export default function VaultsPage() {
  const { isConnected } = useWallet();

  return (
    <PageLayout
      title="Vault Management"
      description="Open, manage, and close your zkUSD vaults"
    >
      {/* Quick Stats */}
      <ProtocolStats />

      {/* Main Vault Interface */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <VaultDashboard />
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* Vault Requirements */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-lg font-semibold mb-4">Vault Requirements</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Minimum CR</dt>
                <dd className="font-mono text-amber-400">110%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Recommended CR</dt>
                <dd className="font-mono text-green-400">150%+</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Minimum Debt</dt>
                <dd className="font-mono">10 zkUSD</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Opening Fee</dt>
                <dd className="font-mono">0.5% + base rate</dd>
              </div>
            </dl>
          </div>

          {/* Risk Levels */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-lg font-semibold mb-4">Risk Levels</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-zinc-400">Safe:</span>
                <span className="font-mono">CR &gt; 150%</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-zinc-400">At Risk:</span>
                <span className="font-mono">110% &lt; CR &lt; 150%</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-zinc-400">Liquidatable:</span>
                <span className="font-mono">CR &lt; 110%</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          {isConnected && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <a
                  href="/"
                  className="block w-full text-center bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2 rounded transition-colors"
                >
                  Back to Dashboard
                </a>
                <a
                  href="/stability-pool"
                  className="block w-full text-center bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2 rounded transition-colors"
                >
                  Deposit to Stability Pool
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
