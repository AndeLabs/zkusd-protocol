'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';

import { ErrorBoundary, DemoIndicator, useDemoKeyboardShortcut } from '@/components/ui';

interface ProvidersProps {
  children: ReactNode;
}

function DemoKeyboardHandler() {
  useDemoKeyboardShortcut();
  return null;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
            retry: 2,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>{children}</ErrorBoundary>
      <DemoIndicator />
      <DemoKeyboardHandler />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#18181b',
            border: '1px solid #27272a',
            color: '#fafafa',
          },
        }}
        richColors
        closeButton
      />
    </QueryClientProvider>
  );
}
