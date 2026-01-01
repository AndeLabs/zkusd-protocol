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

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
          {(title || description) && (
            <section className="text-center py-2 sm:py-4">
              {title && (
                <h1 className="text-fluid-2xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent px-4">
                  {title}
                </h1>
              )}
              {description && (
                <p className="text-fluid-base sm:text-lg text-zinc-400 max-w-2xl mx-auto px-4">
                  {description}
                </p>
              )}
            </section>
          )}

          {children}
        </div>
      </main>

      <footer className="border-t border-zinc-800 py-6 mt-auto">
        <div className="container mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <div className="text-center md:text-left">zkUSD Protocol - Built on Bitcoin with Charms</div>
          <div className="flex flex-wrap gap-4 justify-center">
            <a href="https://github.com/zkusd" className="hover:text-white transition-colors min-h-touch-sm flex items-center">GitHub</a>
            <a href="https://charms.wiki" className="hover:text-white transition-colors min-h-touch-sm flex items-center">Charms</a>
            <a href="https://mempool.space/testnet4" className="hover:text-white transition-colors min-h-touch-sm flex items-center">Explorer</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
