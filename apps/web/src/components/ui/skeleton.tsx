import { cn } from '@/lib/utils';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-zinc-800 rounded',
        className
      )}
    />
  );
}

// Preset skeleton variants
export function SkeletonText({ className }: SkeletonProps) {
  return <Skeleton className={cn('h-4 w-24', className)} />;
}

export function SkeletonHeading({ className }: SkeletonProps) {
  return <Skeleton className={cn('h-8 w-48', className)} />;
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

export function SkeletonButton({ className }: SkeletonProps) {
  return <Skeleton className={cn('h-10 w-full rounded-lg', className)} />;
}

// Loading overlay
export function LoadingOverlay({ message }: { message?: string }) {
  return (
    <div className="absolute inset-0 bg-zinc-900/80 backdrop-blur-sm flex items-center justify-center rounded-xl z-10">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="animate-spin h-8 w-8 text-amber-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
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
        {message && (
          <p className="text-sm text-zinc-400">{message}</p>
        )}
      </div>
    </div>
  );
}
