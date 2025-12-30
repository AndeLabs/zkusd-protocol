'use client';

interface ICRBadgeProps {
  icr: number; // ICR in basis points (e.g., 15000 = 150%)
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Get ICR color based on health
 * - Red: Below 110% (liquidation zone)
 * - Yellow: Below 150% (at risk)
 * - Green: Above 150% (healthy)
 */
export function getICRColor(icr: number): string {
  if (icr < 11000) return 'text-red-400';
  if (icr < 15000) return 'text-yellow-400';
  return 'text-green-400';
}

export function getICRBgColor(icr: number): string {
  if (icr < 11000) return 'bg-red-400/10';
  if (icr < 15000) return 'bg-yellow-400/10';
  return 'bg-green-400/10';
}

const sizeMap = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
  lg: 'text-base px-3 py-1.5',
};

export function ICRBadge({ icr, showLabel = true, size = 'md' }: ICRBadgeProps) {
  const colorClass = getICRColor(icr);
  const bgClass = getICRBgColor(icr);
  const percentage = (icr / 100).toFixed(1);

  return (
    <span className={`inline-flex items-center font-bold rounded ${bgClass} ${colorClass} ${sizeMap[size]}`}>
      {percentage}%{showLabel && ' CR'}
    </span>
  );
}

export function ICRBar({ icr, className = '' }: { icr: number; className?: string }) {
  // Normalize ICR to 0-100% bar (110% = 0%, 250% = 100%)
  const normalized = Math.min(100, Math.max(0, ((icr - 11000) / 14000) * 100));
  const colorClass = icr < 11000 ? 'bg-red-500' : icr < 15000 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className={`h-2 bg-zinc-700 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full ${colorClass} transition-all duration-300`}
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}
