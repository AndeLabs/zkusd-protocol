import { ActionCard } from '@/components/action-card';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { StatsBar } from '@/components/protocol';
import { DemoToggleButton } from '@/components/ui';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-3 bg-gradient-to-r from-amber-200 to-orange-400 bg-clip-text text-transparent">
            Bitcoin-Native Stablecoin
          </h1>
          <p className="text-base text-zinc-400 max-w-xl mx-auto">
            Mint zkUSD by depositing BTC as collateral. Powered by zero-knowledge proofs on Bitcoin
            via Charms Protocol.
          </p>
          <div className="flex justify-center items-center gap-3 mt-3">
            <Link
              href="/explorer"
              className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
            >
              Explorer
            </Link>
            <span className="text-zinc-700">&middot;</span>
            <DemoToggleButton />
          </div>
        </div>

        {/* Protocol Stats */}
        <div className="max-w-3xl mx-auto mb-8">
          <StatsBar />
        </div>

        {/* Main Action Card */}
        <div className="max-w-lg mx-auto">
          <ActionCard />
        </div>

        {/* How It Works */}
        <div className="max-w-3xl mx-auto mt-16">
          <h3 className="text-xl font-semibold text-center mb-8">How It Works</h3>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              {
                step: 1,
                title: 'Connect',
                desc: 'Link your Unisat wallet to Bitcoin Testnet4',
              },
              {
                step: 2,
                title: 'Deposit',
                desc: 'Add BTC as collateral (min 110% ratio)',
              },
              {
                step: 3,
                title: 'Mint',
                desc: 'Borrow zkUSD stablecoins against your BTC',
              },
              {
                step: 4,
                title: 'Repay',
                desc: 'Return zkUSD + fee to unlock collateral',
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  {step}
                </div>
                <h4 className="font-semibold text-white mb-1">{title}</h4>
                <p className="text-sm text-zinc-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
