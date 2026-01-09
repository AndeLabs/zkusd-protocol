'use client';

import { ExternalLinkIcon } from './icons';

export const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/stability-pool', label: 'Stability Pool' },
] as const;

export function DesktopNav() {
  return (
    <nav className="hidden md:flex items-center gap-1">
      {NAV_ITEMS.map(({ href, label }) => (
        <a
          key={href}
          href={href}
          className="px-4 py-2 text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all"
        >
          {label}
        </a>
      ))}
      <a
        href="https://github.com/zkusd/protocol"
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 py-2 text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all flex items-center gap-1"
      >
        Docs
        <ExternalLinkIcon />
      </a>
    </nav>
  );
}
