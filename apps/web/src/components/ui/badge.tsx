import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

const variants = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  success: 'bg-green-500/10 text-green-400 border-green-500/30',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  danger: 'bg-red-500/10 text-red-400 border-red-500/30',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

const sizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full border',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}

// ICR Badge - special badge for collateral ratio display
export interface ICRBadgeProps {
  icr: number; // in basis points (15000 = 150%)
  className?: string;
}

export function ICRBadge({ icr, className }: ICRBadgeProps) {
  const getVariant = (): BadgeProps['variant'] => {
    if (icr >= 15000) return 'success'; // >= 150%
    if (icr >= 11000) return 'warning'; // >= 110%
    return 'danger'; // < 110%
  };

  const getLabel = (): string => {
    if (icr >= 15000) return 'Safe';
    if (icr >= 11000) return 'At Risk';
    return 'Liquidatable';
  };

  return (
    <Badge variant={getVariant()} className={className}>
      <span className="mr-1.5 w-2 h-2 rounded-full bg-current" />
      {(icr / 100).toFixed(0)}% · {getLabel()}
    </Badge>
  );
}
