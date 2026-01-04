'use client';

import { useProtocol, useNetwork } from '@/lib';
import { formatBTC, formatZkUSD, formatUSD } from '@zkusd/utils';

export function ProtocolStats() {
  const { oracle, protocol, isLoading } = useProtocol();
  const { config } = useNetwork();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 animate-pulse">
            <div className="h-4 bg-zinc-800 rounded w-24 mb-3" />
            <div className="h-8 bg-zinc-800 rounded w-32" />
          </div>
        ))}
      </div>
    );
  }

  const btcPrice = oracle?.priceUsd ?? 0;
  const tvlBtc = protocol?.totalCollateral ?? 0n;
  const tvlUsd = Number(tvlBtc) / 100_000_000 * btcPrice;
  const totalDebt = protocol?.totalDebt ?? 0n;
  const systemCR = tvlBtc > 0n && totalDebt > 0n
    ? Number((tvlBtc * BigInt(btcPrice * 100)) / totalDebt) / 100
    : 0;

  const stats = [
    {
      label: 'BTC Price',
      value: formatUSD(btcPrice),
      subValue: oracle?.isStale ? 'Stale' : 'Live',
      subValueColor: oracle?.isStale ? 'text-red-400' : 'text-green-400',
    },
    {
      label: 'Total Value Locked',
      value: formatUSD(tvlUsd),
      subValue: formatBTC(tvlBtc),
      subValueColor: 'text-zinc-400',
    },
    {
      label: 'zkUSD Minted',
      value: formatZkUSD(totalDebt),
      subValue: `${protocol?.activeVaultCount ?? 0} active vaults`,
      subValueColor: 'text-zinc-400',
    },
    {
      label: 'System CR',
      value: systemCR > 0 ? `${systemCR.toFixed(0)}%` : '---',
      subValue: systemCR >= 150 ? 'Healthy' : systemCR > 0 ? 'At Risk' : 'No Debt',
      subValueColor: systemCR >= 150 ? 'text-green-400' : systemCR > 0 ? 'text-yellow-400' : 'text-zinc-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
          <div className="text-xs sm:text-sm text-zinc-400 mb-1">{stat.label}</div>
          <div className="text-xl sm:text-2xl font-bold break-words">{stat.value}</div>
          <div className={`text-xs sm:text-sm ${stat.subValueColor}`}>{stat.subValue}</div>
        </div>
      ))}
    </div>
  );
}

export function ContractStatus() {
  const { config } = useNetwork();

  const contracts = [
    { name: 'Price Oracle', ...config.contracts.priceOracle },
    { name: 'zkUSD Token', ...config.contracts.zkusdToken },
    { name: 'Vault Manager', ...config.contracts.vaultManager },
    { name: 'Stability Pool', ...config.contracts.stabilityPool },
  ];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h3 className="text-lg font-semibold mb-4">Contract Status</h3>
      <div className="space-y-3">
        {contracts.map((contract) => (
          <div key={contract.name} className="flex items-center justify-between">
            <div>
              <div className="font-medium">{contract.name}</div>
              <a
                href={`${config.explorerUrl}/tx/${contract.spellTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 font-mono hover:text-amber-400 transition-colors"
              >
                {contract.appId.slice(0, 8)}...{contract.appId.slice(-8)}
              </a>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded ${
                contract.status === 'confirmed'
                  ? 'bg-green-500/20 text-green-400'
                  : contract.status === 'in_mempool'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-zinc-700 text-zinc-400'
              }`}
            >
              {contract.status === 'confirmed' ? 'Confirmed' : contract.status === 'in_mempool' ? 'Pending' : 'Not Deployed'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
