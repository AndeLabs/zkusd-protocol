import { toast } from 'sonner';
import { REFRESH_INTERVALS } from '@/config';

// ============================================================================
// Error Types
// ============================================================================

export type ErrorType =
  | 'WALLET_ERROR'
  | 'TRANSACTION_ERROR'
  | 'NETWORK_ERROR'
  | 'VALIDATION_ERROR'
  | 'API_ERROR'
  | 'UNKNOWN_ERROR';

export interface AppError {
  type: ErrorType;
  message: string;
  details?: string;
  retryable: boolean;
  originalError?: unknown;
}

// ============================================================================
// Error Classification
// ============================================================================

const WALLET_ERROR_PATTERNS = [
  'wallet not connected',
  'user rejected',
  'user denied',
  'no accounts',
  'unisat not available',
  'xverse not available',
];

const NETWORK_ERROR_PATTERNS = [
  'network error',
  'failed to fetch',
  'timeout',
  'econnrefused',
  'network request failed',
];

const TRANSACTION_ERROR_PATTERNS = [
  'insufficient funds',
  'insufficient balance',
  'failed to sign',
  'failed to broadcast',
  'transaction failed',
  'psbt',
];

export function classifyError(error: unknown): AppError {
  const message = getErrorMessage(error).toLowerCase();

  if (WALLET_ERROR_PATTERNS.some(p => message.includes(p))) {
    return {
      type: 'WALLET_ERROR',
      message: getErrorMessage(error),
      retryable: false,
      originalError: error,
    };
  }

  if (NETWORK_ERROR_PATTERNS.some(p => message.includes(p))) {
    return {
      type: 'NETWORK_ERROR',
      message: 'Network error. Please check your connection.',
      details: getErrorMessage(error),
      retryable: true,
      originalError: error,
    };
  }

  if (TRANSACTION_ERROR_PATTERNS.some(p => message.includes(p))) {
    return {
      type: 'TRANSACTION_ERROR',
      message: getErrorMessage(error),
      retryable: false,
      originalError: error,
    };
  }

  return {
    type: 'UNKNOWN_ERROR',
    message: getErrorMessage(error),
    retryable: false,
    originalError: error,
  };
}

// ============================================================================
// Error Message Extraction
// ============================================================================

export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if ('error' in error && typeof error.error === 'string') {
      return error.error;
    }
  }

  return 'An unexpected error occurred';
}

// ============================================================================
// Toast Notifications
// ============================================================================

export const showToast = {
  // Success toasts
  success: (title: string, description?: string) => {
    toast.success(title, { description });
  },

  // Error toasts
  error: (title: string, description?: string) => {
    toast.error(title, { description });
  },

  // Warning toasts
  warning: (title: string, description?: string) => {
    toast.warning(title, { description });
  },

  // Info toasts
  info: (title: string, description?: string) => {
    toast.info(title, { description });
  },

  // Loading toast that returns a dismiss function
  loading: (title: string, description?: string) => {
    return toast.loading(title, { description });
  },

  // Wallet-specific toasts
  walletConnected: (walletType: string, address: string) => {
    toast.success('Wallet Connected', {
      description: `${walletType} wallet connected: ${address.slice(0, 8)}...${address.slice(-6)}`,
    });
  },

  walletDisconnected: () => {
    toast.info('Wallet Disconnected');
  },

  // Transaction toasts
  transactionSubmitted: (txId: string) => {
    toast.success('Transaction Submitted', {
      description: `TX: ${txId.slice(0, 8)}...${txId.slice(-8)}`,
    });
  },

  transactionConfirmed: (txId: string) => {
    toast.success('Transaction Confirmed', {
      description: `TX: ${txId.slice(0, 8)}...${txId.slice(-8)}`,
    });
  },

  transactionFailed: (error: string) => {
    toast.error('Transaction Failed', { description: error });
  },

  // Copy to clipboard
  copyToClipboard: async (text: string, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label, { description: text.slice(0, 20) + '...' });
    } catch {
      toast.error('Failed to copy');
    }
  },

  // Network error with retry
  networkError: (retryFn?: () => void) => {
    toast.error('Network Error', {
      description: 'Please check your connection and try again.',
      action: retryFn ? {
        label: 'Retry',
        onClick: retryFn,
      } : undefined,
    });
  },
};

// ============================================================================
// Retry Logic
// ============================================================================

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = REFRESH_INTERVALS.ERROR_RETRY,
    backoff = true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const appError = classifyError(error);

      // Don't retry non-retryable errors
      if (!appError.retryable || attempt === maxAttempts) {
        throw error;
      }

      // Calculate delay with optional backoff
      const delay = backoff ? delayMs * attempt : delayMs;

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, error);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// Error Logging
// ============================================================================

export function logError(context: string, error: unknown): void {
  const appError = classifyError(error);

  console.error(`[${context}]`, {
    type: appError.type,
    message: appError.message,
    details: appError.details,
    originalError: appError.originalError,
  });

  // In production, you might want to send this to a logging service
  // if (process.env.NODE_ENV === 'production') {
  //   sendToLoggingService(context, appError);
  // }
}

// ============================================================================
// Handle Error with Toast
// ============================================================================

export function handleError(
  context: string,
  error: unknown,
  options: { showToast?: boolean; logError?: boolean } = {}
): AppError {
  const { showToast: shouldShowToast = true, logError: shouldLogError = true } = options;

  const appError = classifyError(error);

  if (shouldLogError) {
    logError(context, error);
  }

  if (shouldShowToast) {
    showToast.error(
      appError.type === 'NETWORK_ERROR' ? 'Network Error' : 'Error',
      appError.message
    );
  }

  return appError;
}
