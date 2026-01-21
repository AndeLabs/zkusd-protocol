'use client';

import { getClient } from '@/lib/sdk';
import { useMemo } from 'react';

/**
 * Hook to check if the app is running in demo mode
 * Demo mode simulates transactions without actual blockchain interaction
 */
export function useDemoMode() {
  const isDemoMode = useMemo(() => {
    // Check environment variable first
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      return true;
    }

    // Check client demo mode status
    try {
      const client = getClient();
      return client.isDemoMode();
    } catch {
      return false;
    }
  }, []);

  return {
    isDemoMode,
  };
}
