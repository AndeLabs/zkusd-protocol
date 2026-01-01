import { PageLayout } from '@/components/shared';
import { ProtocolStats, ContractStatus } from '@/components/protocol-stats';
import { VaultDashboard } from '@/components/vault-dashboard';

export default function HomePage() {
  return (
    <PageLayout
      title="Bitcoin-Native Stablecoin"
      description="Mint zkUSD by depositing BTC as collateral. Powered by zero-knowledge proofs on Bitcoin via Charms."
    >

      {/* Protocol Stats */}
      <ProtocolStats />

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Vault Dashboard - 2 cols */}
        <div className="lg:col-span-2">
          <VaultDashboard />
        </div>

        {/* Sidebar - 1 col */}
        <div className="space-y-4 sm:space-y-6">
          <ContractStatus />

          {/* How It Works */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
            <h3 className="text-fluid-lg font-semibold mb-4">How It Works</h3>
            <ol className="space-y-3 text-fluid-sm text-zinc-400">
              <li className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">1</span>
                <span className="pt-0.5">Connect your Bitcoin wallet (Unisat, Xverse)</span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">2</span>
                <span className="pt-0.5">Deposit BTC as collateral (min 110% CR)</span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">3</span>
                <span className="pt-0.5">Mint zkUSD stablecoins (1:1 with USD)</span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">4</span>
                <span className="pt-0.5">Repay debt + fee to withdraw collateral</span>
              </li>
            </ol>
          </div>

          {/* Parameters */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
            <h3 className="text-fluid-lg font-semibold mb-4">Protocol Parameters</h3>
            <dl className="space-y-2 text-fluid-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Min Collateral Ratio</dt>
                <dd className="font-mono">110%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Critical CR</dt>
                <dd className="font-mono">150%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Min Debt</dt>
                <dd className="font-mono">10 zkUSD</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Opening Fee</dt>
                <dd className="font-mono">0.5% + base</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Liquidation Bonus</dt>
                <dd className="font-mono">0.5%</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
