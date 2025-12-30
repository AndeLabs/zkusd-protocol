'use client';

import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { NetworkProvider, ProtocolProvider, WalletProvider, ZkUsdProvider } from '@/lib';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <WalletProvider>
        <ZkUsdProvider>
          <ProtocolProvider>
            {children}
            <Toaster
              position="bottom-right"
              theme="dark"
              toastOptions={{
                style: {
                  background: '#18181b',
                  border: '1px solid #27272a',
                  color: '#fafafa',
                },
                className: 'font-sans',
              }}
              richColors
              closeButton
            />
          </ProtocolProvider>
        </ZkUsdProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}
