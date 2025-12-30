'use client';

import { motion } from 'framer-motion';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      className={`
        border-2 border-zinc-700 border-t-amber-500 rounded-full
        ${sizeMap[size]}
        ${className}
      `}
    />
  );
}

export function LoadingDots({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
          }}
          className="w-2 h-2 bg-amber-500 rounded-full"
        />
      ))}
    </div>
  );
}

export function LoadingOverlay({ message }: { message?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-4">
        <Spinner size="xl" />
        {message && (
          <p className="text-zinc-400 text-sm">{message}</p>
        )}
      </div>
    </motion.div>
  );
}

export function SkeletonLoader({
  className = '',
  variant = 'text',
}: {
  className?: string;
  variant?: 'text' | 'circle' | 'rect';
}) {
  const baseClass = 'animate-pulse bg-zinc-800 rounded';
  const variantClass = {
    text: 'h-4 rounded',
    circle: 'rounded-full',
    rect: 'rounded-lg',
  };

  return (
    <div className={`${baseClass} ${variantClass[variant]} ${className}`} />
  );
}
