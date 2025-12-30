'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftElement,
      rightElement,
      className = '',
      ...props
    },
    ref
  ) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftElement && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              {leftElement}
            </div>
          )}
          <input
            ref={ref}
            className={`
              w-full bg-zinc-800/80 border rounded-xl px-4 py-3
              text-white placeholder:text-zinc-500
              focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500
              transition-all
              ${leftElement ? 'pl-10' : ''}
              ${rightElement ? 'pr-10' : ''}
              ${error ? 'border-red-500/50 focus:ring-red-500/50 focus:border-red-500' : 'border-zinc-700'}
              ${className}
            `}
            {...props}
          />
          {rightElement && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
              {rightElement}
            </div>
          )}
        </div>
        {(error || hint) && (
          <p className={`mt-1.5 text-xs ${error ? 'text-red-400' : 'text-zinc-500'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

interface InputWithMaxProps extends InputProps {
  onMax?: () => void;
  maxLabel?: string;
}

export const InputWithMax = forwardRef<HTMLInputElement, InputWithMaxProps>(
  ({ onMax, maxLabel = 'MAX', ...props }, ref) => {
    return (
      <Input
        ref={ref}
        rightElement={
          onMax && (
            <button
              type="button"
              onClick={onMax}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
            >
              {maxLabel}
            </button>
          )
        }
        {...props}
      />
    );
  }
);

InputWithMax.displayName = 'InputWithMax';
