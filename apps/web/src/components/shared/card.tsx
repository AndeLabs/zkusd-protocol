'use client';

import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ children, title, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-xl ${className}`}>
      {title && (
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
      )}
      <div className={paddingMap[padding]}>
        {children}
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | ReactNode;
  subValue?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, subValue, icon }: StatCardProps) {
  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-zinc-400">{label}</div>
          <div className="text-xl font-bold mt-1">{value}</div>
          {subValue && (
            <div className="text-xs text-zinc-500 mt-1">{subValue}</div>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-zinc-700/50 flex items-center justify-center text-amber-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
