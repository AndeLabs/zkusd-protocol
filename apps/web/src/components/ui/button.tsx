'use client';

import { cn } from '@/lib/utils';
import { type HTMLMotionProps, motion } from 'framer-motion';
import { forwardRef } from 'react';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

const variantStyles = {
  primary: 'bg-amber-500 hover:bg-amber-600 text-black font-semibold shadow-lg shadow-amber-500/20',
  secondary: 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700',
  outline: 'bg-transparent hover:bg-zinc-800 text-white border border-zinc-700',
  ghost: 'bg-transparent hover:bg-zinc-800/50 text-zinc-400 hover:text-white',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30',
};

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-lg',
  lg: 'px-6 py-3 text-base rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        type={type}
        whileHover={isDisabled ? undefined : { scale: 1.02 }}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && 'w-full',
          isDisabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
