import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({
  children,
  className,
  title,
  description,
  padding = 'md',
  hover = false,
}: CardProps) {
  return (
    <div
      className={cn(
        'bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden',
        hover && 'hover:border-zinc-700 transition-colors',
        paddingClasses[padding],
        className
      )}
    >
      {(title || description) && (
        <div className={cn('mb-4', padding === 'none' && 'px-5 pt-5')}>
          {title && (
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          )}
          {description && (
            <p className="text-sm text-zinc-400 mt-1">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

// Stat Card variant
export interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  change?: {
    value: string;
    positive: boolean;
  };
  className?: string;
}

export function StatCard({
  label,
  value,
  subValue,
  change,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-zinc-900 border border-zinc-800 rounded-xl p-4',
        className
      )}
    >
      <p className="text-sm text-zinc-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white font-mono">{value}</p>
      {subValue && <p className="text-sm text-zinc-500 mt-1">{subValue}</p>}
      {change && (
        <p
          className={cn(
            'text-sm mt-1',
            change.positive ? 'text-green-400' : 'text-red-400'
          )}
        >
          {change.positive ? '+' : ''}
          {change.value}
        </p>
      )}
    </div>
  );
}
