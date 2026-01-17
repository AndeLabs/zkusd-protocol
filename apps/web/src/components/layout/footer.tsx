import Link from 'next/link';
import { PROTOCOL } from '@/lib/constants';

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 mt-auto">
      <div className="container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-3 gap-8">
          {/* Protocol Info */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">
              Protocol Parameters
            </h4>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-zinc-400">
                <dt>Min Collateral Ratio</dt>
                <dd className="font-mono">{PROTOCOL.MCR / 100}%</dd>
              </div>
              <div className="flex justify-between text-zinc-400">
                <dt>Critical Ratio</dt>
                <dd className="font-mono">{PROTOCOL.CCR / 100}%</dd>
              </div>
              <div className="flex justify-between text-zinc-400">
                <dt>Min Debt</dt>
                <dd className="font-mono">
                  {Number(PROTOCOL.MIN_DEBT) / 100_000_000} zkUSD
                </dd>
              </div>
              <div className="flex justify-between text-zinc-400">
                <dt>Liquidation Bonus</dt>
                <dd className="font-mono">{PROTOCOL.LIQUIDATION_BONUS_BPS / 100}%</dd>
              </div>
            </dl>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://github.com/AndeLabs/zkusd-protocol"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://charms.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  Charms Protocol
                </a>
              </li>
              <li>
                <a
                  href="https://mempool.space/testnet4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  Block Explorer
                </a>
              </li>
            </ul>
          </div>

          {/* About */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">
              About zkUSD
            </h4>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Bitcoin-native stablecoin protocol powered by zero-knowledge proofs.
              Mint zkUSD by depositing BTC as collateral, no bridges or custodians
              required.
            </p>
            <p className="text-xs text-zinc-500 mt-4">
              Built with Charms on Bitcoin
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-zinc-800 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-zinc-500">
            &copy; {new Date().getFullYear()} AndeLabs. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>Deployed on Bitcoin Testnet4</span>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
        </div>
      </div>
    </footer>
  );
}
