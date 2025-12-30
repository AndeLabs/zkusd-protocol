'use client';

import { useState } from 'react';
import { OpenVaultForm } from './open-vault-form';
import { MyVaults } from './my-vaults';
import { useWallet } from '@/lib';

type Tab = 'open' | 'manage';

export function VaultDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('open');
  const { isConnected } = useWallet();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('open')}
          className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
            activeTab === 'open'
              ? 'text-amber-400 bg-zinc-800/50 border-b-2 border-amber-400'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/30'
          }`}
        >
          Open New Vault
        </button>
        <button
          onClick={() => setActiveTab('manage')}
          className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
            activeTab === 'manage'
              ? 'text-amber-400 bg-zinc-800/50 border-b-2 border-amber-400'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/30'
          }`}
        >
          My Vaults
        </button>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'open' ? (
          <OpenVaultForm />
        ) : (
          <MyVaults />
        )}
      </div>
    </div>
  );
}
