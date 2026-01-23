/**
 * Vault State Machine - Manage vault operation lifecycle
 *
 * Provides clear, predictable state transitions for vault operations
 * with explicit handling of all edge cases.
 *
 * States:
 * - idle: Ready to start a new operation
 * - selecting: Checking UTXO availability
 * - ready: UTXO selected, waiting for user confirmation
 * - building: Building the spell
 * - proving: Generating ZK proof via prover
 * - signing: Waiting for wallet signature
 * - broadcasting: Broadcasting transactions
 * - success: Operation completed successfully
 * - waiting: Waiting for UTXO availability (cache expiry)
 * - error: Operation failed
 */

import type { UtxoInfo, UtxoPairResult } from './utxo-service';
import type { SpellContext } from './spell-service';

// ============================================================================
// Types
// ============================================================================

export type VaultState =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'building'
  | 'proving'
  | 'signing'
  | 'broadcasting'
  | 'success'
  | 'waiting'
  | 'error';

export interface VaultStateContext {
  /** Current state */
  state: VaultState;
  /** Selected collateral UTXO */
  collateralUtxo: UtxoInfo | null;
  /** Selected fee UTXO */
  feeUtxo: UtxoInfo | null;
  /** Built spell context */
  spellContext: SpellContext | null;
  /** Error message if in error state */
  error: string | null;
  /** Error type for specific handling */
  errorType: ErrorType | null;
  /** When the next UTXO will be available (for waiting state) */
  nextAvailableAt: number | null;
  /** Transaction IDs after success */
  result: VaultResult | null;
  /** Progress percentage (0-100) */
  progress: number;
  /** Human-readable status message */
  statusMessage: string;
}

export interface VaultResult {
  commitTxId: string;
  spellTxId: string;
  vaultId: string;
}

export type ErrorType =
  | 'utxo_burned'         // UTXO rejected by prover cache
  | 'insufficient_funds'  // Not enough BTC
  | 'need_split'          // Need to split UTXO
  | 'no_utxos'           // No UTXOs available
  | 'all_reserved'       // All UTXOs temporarily reserved
  | 'network_error'      // Network/prover unreachable
  | 'user_rejected'      // User rejected signing
  | 'broadcast_failed'   // Transaction broadcast failed
  | 'validation_error'   // Invalid parameters
  | 'unknown';           // Unknown error

// ============================================================================
// State Machine Logic
// ============================================================================

export function createInitialContext(): VaultStateContext {
  return {
    state: 'idle',
    collateralUtxo: null,
    feeUtxo: null,
    spellContext: null,
    error: null,
    errorType: null,
    nextAvailableAt: null,
    result: null,
    progress: 0,
    statusMessage: 'Ready',
  };
}

/**
 * Transition to selecting state
 */
export function transitionToSelecting(ctx: VaultStateContext): VaultStateContext {
  return {
    ...ctx,
    state: 'selecting',
    error: null,
    errorType: null,
    progress: 10,
    statusMessage: 'Checking UTXO availability...',
  };
}

/**
 * Handle UTXO selection result
 */
export function handleUtxoSelection(
  ctx: VaultStateContext,
  result: UtxoPairResult
): VaultStateContext {
  switch (result.status) {
    case 'ready':
      return {
        ...ctx,
        state: 'ready',
        collateralUtxo: result.collateralUtxo!,
        feeUtxo: result.feeUtxo!,
        progress: 20,
        statusMessage: 'UTXOs selected. Ready to open vault.',
      };

    case 'need_split':
      return {
        ...ctx,
        state: 'error',
        error: result.message,
        errorType: 'need_split',
        progress: 0,
        statusMessage: 'UTXO split required',
      };

    case 'insufficient_funds':
      return {
        ...ctx,
        state: 'error',
        error: result.message,
        errorType: 'insufficient_funds',
        progress: 0,
        statusMessage: 'Insufficient funds',
      };

    case 'all_reserved':
      return {
        ...ctx,
        state: 'waiting',
        nextAvailableAt: result.nextAvailableAt ?? null,
        error: result.message,
        errorType: 'all_reserved',
        progress: 0,
        statusMessage: 'Waiting for UTXO availability',
      };

    case 'no_utxos':
      return {
        ...ctx,
        state: 'error',
        error: result.message,
        errorType: 'no_utxos',
        progress: 0,
        statusMessage: 'No UTXOs available',
      };

    default:
      return ctx;
  }
}

/**
 * Transition to building state
 */
export function transitionToBuilding(ctx: VaultStateContext): VaultStateContext {
  if (ctx.state !== 'ready') {
    console.warn('[StateMachine] Invalid transition to building from', ctx.state);
    return ctx;
  }

  return {
    ...ctx,
    state: 'building',
    progress: 30,
    statusMessage: 'Building transaction...',
  };
}

/**
 * Handle spell built successfully
 */
export function handleSpellBuilt(
  ctx: VaultStateContext,
  spellContext: SpellContext
): VaultStateContext {
  return {
    ...ctx,
    state: 'proving',
    spellContext,
    progress: 40,
    statusMessage: 'Generating zero-knowledge proof...',
  };
}

/**
 * Update proving progress
 */
export function updateProvingProgress(
  ctx: VaultStateContext,
  message: string
): VaultStateContext {
  return {
    ...ctx,
    progress: 50,
    statusMessage: message,
  };
}

/**
 * Transition to signing state
 */
export function transitionToSigning(ctx: VaultStateContext): VaultStateContext {
  return {
    ...ctx,
    state: 'signing',
    progress: 70,
    statusMessage: 'Please sign in your wallet...',
  };
}

/**
 * Transition to broadcasting state
 */
export function transitionToBroadcasting(ctx: VaultStateContext): VaultStateContext {
  return {
    ...ctx,
    state: 'broadcasting',
    progress: 85,
    statusMessage: 'Broadcasting transactions...',
  };
}

/**
 * Handle success
 */
export function handleSuccess(
  ctx: VaultStateContext,
  result: VaultResult
): VaultStateContext {
  return {
    ...ctx,
    state: 'success',
    result,
    progress: 100,
    statusMessage: 'Vault opened successfully!',
  };
}

/**
 * Handle error
 */
export function handleError(
  ctx: VaultStateContext,
  error: string,
  errorType: ErrorType = 'unknown',
  nextAvailableAt?: number
): VaultStateContext {
  // Determine if we should go to waiting state
  const shouldWait = errorType === 'utxo_burned' || errorType === 'all_reserved';

  return {
    ...ctx,
    state: shouldWait ? 'waiting' : 'error',
    error,
    errorType,
    nextAvailableAt: nextAvailableAt ?? null,
    progress: 0,
    statusMessage: getErrorStatusMessage(errorType),
  };
}

/**
 * Reset to idle state
 */
export function reset(): VaultStateContext {
  return createInitialContext();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get human-readable status message for error type
 */
function getErrorStatusMessage(errorType: ErrorType): string {
  switch (errorType) {
    case 'utxo_burned':
      return 'UTXO reserved by prover';
    case 'insufficient_funds':
      return 'Insufficient funds';
    case 'need_split':
      return 'UTXO split required';
    case 'no_utxos':
      return 'No UTXOs available';
    case 'all_reserved':
      return 'Waiting for UTXO availability';
    case 'network_error':
      return 'Network error';
    case 'user_rejected':
      return 'Transaction rejected';
    case 'broadcast_failed':
      return 'Broadcast failed';
    case 'validation_error':
      return 'Invalid parameters';
    default:
      return 'Error occurred';
  }
}

/**
 * Parse error message to determine error type
 */
export function parseErrorType(error: string): ErrorType {
  const lowerError = error.toLowerCase();

  if (
    lowerError.includes('duplicate funding utxo') ||
    lowerError.includes('already been used') ||
    lowerError.includes('utxo spent') ||
    lowerError.includes('unexecutable')
  ) {
    return 'utxo_burned';
  }

  if (
    lowerError.includes('insufficient') ||
    lowerError.includes('not enough')
  ) {
    return 'insufficient_funds';
  }

  if (lowerError.includes('split')) {
    return 'need_split';
  }

  if (
    lowerError.includes('user rejected') ||
    lowerError.includes('cancelled') ||
    lowerError.includes('denied')
  ) {
    return 'user_rejected';
  }

  if (
    lowerError.includes('network') ||
    lowerError.includes('timeout') ||
    lowerError.includes('fetch')
  ) {
    return 'network_error';
  }

  if (lowerError.includes('broadcast')) {
    return 'broadcast_failed';
  }

  return 'unknown';
}

/**
 * Check if the current state allows starting a new operation
 */
export function canStartOperation(ctx: VaultStateContext): boolean {
  return ctx.state === 'idle' || ctx.state === 'error' || ctx.state === 'waiting';
}

/**
 * Check if the current state allows proceeding with confirmation
 */
export function canConfirm(ctx: VaultStateContext): boolean {
  return ctx.state === 'ready';
}

/**
 * Get action button text based on state
 */
export function getActionButtonText(ctx: VaultStateContext): string {
  switch (ctx.state) {
    case 'idle':
      return 'Open Vault';
    case 'selecting':
      return 'Checking UTXOs...';
    case 'ready':
      return 'Confirm & Open Vault';
    case 'building':
      return 'Building...';
    case 'proving':
      return 'Generating Proof...';
    case 'signing':
      return 'Sign in Wallet';
    case 'broadcasting':
      return 'Broadcasting...';
    case 'success':
      return 'Done!';
    case 'waiting':
      return 'Waiting...';
    case 'error':
      return 'Try Again';
    default:
      return 'Open Vault';
  }
}

/**
 * Check if button should be disabled
 */
export function isButtonDisabled(ctx: VaultStateContext): boolean {
  return (
    ctx.state === 'selecting' ||
    ctx.state === 'building' ||
    ctx.state === 'proving' ||
    ctx.state === 'signing' ||
    ctx.state === 'broadcasting'
  );
}

/**
 * Check if we're in a loading state
 */
export function isLoading(ctx: VaultStateContext): boolean {
  return (
    ctx.state === 'selecting' ||
    ctx.state === 'building' ||
    ctx.state === 'proving' ||
    ctx.state === 'signing' ||
    ctx.state === 'broadcasting'
  );
}
