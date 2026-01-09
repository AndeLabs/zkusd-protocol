'use client';

import {
  MCR,
  CCR,
  MAX_DISPLAY_ICR,
  getIcrColorClass,
  getIcrBgClass,
  getIcrProgress,
  getIcrProgressClass,
} from '@/config';

interface ICRBadgeProps {
  icr: number; // ICR in basis points (e.g., 15000 = 150%)
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Get ICR color based on health
 * - Red: Below MCR (110%) - liquidation zone
 * - Yellow: Below CCR (150%) - at risk
 * - Green: Above CCR (150%) - healthy
 */
export function getICRColor(icr: number): string {
  return getIcrColorClass(icr);
}

export function getICRBgColor(icr: number): string {
  return getIcrBgClass(icr);
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
  const normalized = getIcrProgress(icr);
  const colorClass = getIcrProgressClass(icr);

  return (
    <div className={`h-2 bg-zinc-700 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full ${colorClass} transition-all duration-300`}
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}
