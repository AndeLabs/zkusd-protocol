'use client';

import { Header } from '@/components/header';
import type { ReactNode } from 'react';

interface PageLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
}

export function PageLayout({ children, title, description }: PageLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {(title || description) && (
            <section className="text-center py-4">
              {title && (
                <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                  {title}
                </h1>
              )}
              {description && (
                <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                  {description}
                </p>
              )}
            </section>
          )}

          {children}
        </div>
      </main>

      <footer className="border-t border-zinc-800 py-6">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between text-sm text-zinc-500">
          <div>zkUSD Protocol - Built on Bitcoin with Charms</div>
          <div className="flex gap-4 mt-4 md:mt-0">
            <a href="https://github.com/zkusd" className="hover:text-white transition-colors">GitHub</a>
            <a href="https://charms.wiki" className="hover:text-white transition-colors">Charms</a>
            <a href="https://mempool.space/testnet4" className="hover:text-white transition-colors">Explorer</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
