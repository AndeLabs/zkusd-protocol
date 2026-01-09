import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useWalletStore } from '@/stores';
import { useNetwork } from '@/lib/network-context';

// ============================================================================
// Types
// ============================================================================

export interface TransactionOptions {
  onSuccess?: (txid: string) => void;
  onError?: (error: Error) => void;
  successMessage?: string;
  pendingMessage?: string;
  errorMessage?: string;
}

interface TransactionState {
  isPending: boolean;
  txid: string | null;
  error: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useTransaction() {
  const [state, setState] = useState<TransactionState>({
    isPending: false,
    txid: null,
    error: null,
  });

  const { config } = useNetwork();
  const signAndBroadcast = useWalletStore((s) => s.signAndBroadcast);
  const refreshBalance = useWalletStore((s) => s.refreshBalance);

  const execute = useCallback(
    async (psbtBase64: string, options: TransactionOptions = {}) => {
      const {
        onSuccess,
        onError,
        successMessage = 'Transaction confirmed',
        pendingMessage = 'Signing transaction...',
        errorMessage = 'Transaction failed',
      } = options;

      setState({ isPending: true, txid: null, error: null });

      const toastId = toast.loading(pendingMessage, {
        description: 'Please confirm in your wallet',
      });

      try {
        const txid = await signAndBroadcast(psbtBase64);

        setState({ isPending: false, txid, error: null });

        toast.success(successMessage, {
          id: toastId,
          description: (
            <a
              href={`${config.explorerUrl}/tx/${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:underline"
            >
              View transaction
            </a>
          ),
          duration: 5000,
        });

        // Refresh balance after successful tx
        await refreshBalance(config.explorerApiUrl);

        onSuccess?.(txid);
        return txid;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        const message = error.message || errorMessage;

        setState({ isPending: false, txid: null, error: message });

        toast.error(errorMessage, {
          id: toastId,
          description: message,
        });

        onError?.(error);
        throw error;
      }
    },
    [signAndBroadcast, refreshBalance, config]
  );

  const reset = useCallback(() => {
    setState({ isPending: false, txid: null, error: null });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}
