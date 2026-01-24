'use client';

import { cn } from '@/lib/utils';
import {
  isDemoMode,
  toggleDemoMode,
  disableDemoMode,
} from '@/lib/services/demo-service';
import { useEffect, useState } from 'react';

/**
 * Demo Mode Indicator
 *
 * Shows when demo mode is active and provides controls to toggle it.
 * Professional presentation-ready design.
 */
export function DemoIndicator() {
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDemo(isDemoMode());
  }, []);

  if (!mounted || !isDemo) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full',
          'bg-amber-500/20 border border-amber-500/30',
          'text-amber-400 text-xs font-medium',
          'backdrop-blur-sm shadow-lg'
        )}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span>Demo Mode</span>
        <button
          onClick={() => {
            disableDemoMode();
            setIsDemo(false);
            window.location.reload();
          }}
          className="ml-1 text-amber-300 hover:text-white transition-colors"
          title="Exit Demo Mode"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Demo Mode Banner - More prominent version for presentations
 */
export function DemoModeBanner() {
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDemo(isDemoMode());
  }, []);

  if (!mounted || !isDemo) return null;

  return (
    <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/20 to-amber-500/10 border-b border-amber-500/20">
      <div className="container mx-auto px-4 py-2 flex items-center justify-center gap-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span className="text-sm text-amber-300 font-medium">
          Demo Mode - Simulated transactions for presentation
        </span>
        <span className="text-xs text-amber-500/60">|</span>
        <span className="text-xs text-amber-500/80">
          Testnet4
        </span>
      </div>
    </div>
  );
}

/**
 * Demo Toggle Button - For manually entering demo mode
 */
export function DemoToggleButton({ className }: { className?: string }) {
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDemo(isDemoMode());
  }, []);

  if (!mounted) return null;

  return (
    <button
      onClick={() => {
        const newState = toggleDemoMode();
        setIsDemo(newState);
        window.location.reload();
      }}
      className={cn(
        'text-xs px-2 py-1 rounded',
        'transition-colors',
        isDemo
          ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300',
        className
      )}
      title={isDemo ? 'Exit Demo Mode' : 'Enter Demo Mode'}
    >
      {isDemo ? 'Exit Demo' : 'Demo Mode'}
    </button>
  );
}

/**
 * Keyboard shortcut to toggle demo mode (Ctrl+Shift+D)
 */
export function useDemoKeyboardShortcut() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        const newState = toggleDemoMode();
        console.log(`[Demo Mode] ${newState ? 'Enabled' : 'Disabled'}`);
        window.location.reload();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
