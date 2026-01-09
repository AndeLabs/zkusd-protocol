'use client';

import type { FormStep } from './types';

interface VaultStatusProps {
  step: 'signing' | 'broadcasting';
}

const STATUS_CONFIG = {
  signing: {
    title: 'Signing Transaction',
    description: 'Please approve the transaction in your wallet',
  },
  broadcasting: {
    title: 'Broadcasting Transaction',
    description: 'Your vault is being created on Bitcoin...',
  },
} as const;

export function VaultStatus({ step }: VaultStatusProps) {
  const config = STATUS_CONFIG[step];

  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <h3 className="text-xl font-bold mb-2">{config.title}</h3>
      <p className="text-zinc-400 text-sm">{config.description}</p>
    </div>
  );
}
