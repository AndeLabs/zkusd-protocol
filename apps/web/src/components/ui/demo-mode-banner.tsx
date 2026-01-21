'use client';

import { useDemoMode } from '@/hooks/use-demo-mode';

/**
 * Banner displayed when the app is running in demo mode
 * Shows a warning that transactions are simulated
 */
export function DemoModeBanner() {
  const { isDemoMode } = useDemoMode();

  if (!isDemoMode) {
    return null;
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-amber-400 text-sm">
        <span className="font-medium">Demo Mode</span>
        <span className="text-amber-400/70">|</span>
        <span className="text-amber-400/70">
          Transactions are simulated - no real blockchain interaction
        </span>
      </div>
    </div>
  );
}
