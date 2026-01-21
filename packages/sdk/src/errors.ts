// zkUSD SDK Error System
//
// Provides structured error types with:
// - Error codes for programmatic handling
// - User-friendly messages for display
// - Debugging context for troubleshooting

// ============================================================================
// Error Codes (match Rust contract error codes where applicable)
// ============================================================================

export type ZkUsdErrorCode =
  // Vault Errors (E001-E009)
  | 'VAULT_NOT_FOUND'
  | 'UNDERCOLLATERALIZED'
  | 'VAULT_ALREADY_EXISTS'
  | 'VAULT_NOT_ACTIVE'
  | 'VAULT_HAS_DEBT'
  // Amount Errors (E010-E019)
  | 'INVALID_AMOUNT'
  | 'INSUFFICIENT_BALANCE'
  | 'BELOW_MINIMUM'
  | 'EXCEEDS_MAXIMUM'
  | 'ZERO_AMOUNT'
  // Authorization Errors (E020-E029)
  | 'UNAUTHORIZED'
  | 'MISSING_SIGNATURE'
  | 'INVALID_SIGNATURE'
  | 'ADMIN_ONLY'
  // Oracle Errors (E030-E039)
  | 'ORACLE_STALE'
  | 'ORACLE_DEVIATION'
  | 'ORACLE_NOT_INITIALIZED'
  | 'INVALID_ORACLE_SOURCE'
  // Recovery Mode Errors (E040-E049)
  | 'RECOVERY_MODE_RESTRICTION'
  | 'WOULD_WORSEN_TCR'
  // Stability Pool Errors (E050-E059)
  | 'INSUFFICIENT_POOL_BALANCE'
  | 'DEPOSIT_NOT_FOUND'
  | 'NO_REWARDS'
  // Liquidation Errors (E060-E069)
  | 'NOT_LIQUIDATABLE'
  | 'NOTHING_TO_LIQUIDATE'
  | 'LIQUIDATION_DUST'
  // Token Errors (E070-E079)
  | 'TRANSFER_FAILED'
  | 'MINT_UNAUTHORIZED'
  | 'BURN_UNAUTHORIZED'
  | 'CONSERVATION_VIOLATED'
  // Math Errors (E080-E089)
  | 'OVERFLOW'
  | 'UNDERFLOW'
  | 'DIVISION_BY_ZERO'
  // Network Errors
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'PROVER_ERROR'
  | 'BROADCAST_FAILED'
  | 'UTXO_NOT_FOUND'
  | 'TX_NOT_FOUND'
  // Wallet Errors
  | 'WALLET_NOT_CONNECTED'
  | 'INSUFFICIENT_UTXOS'
  | 'SIGNING_REJECTED'
  | 'SIGNING_FAILED'
  // Configuration Errors
  | 'CONFIG_ERROR'
  | 'INVALID_NETWORK'
  | 'CONTRACT_NOT_DEPLOYED'
  // General Errors
  | 'UNKNOWN_ERROR'
  | 'VALIDATION_ERROR';

// ============================================================================
// Main Error Class
// ============================================================================

export interface ZkUsdErrorDetails {
  /** Additional context for debugging */
  context?: Record<string, unknown>;
  /** Original error that caused this error */
  cause?: Error;
  /** Whether this error is recoverable by the user */
  recoverable?: boolean;
  /** Suggested action for the user */
  suggestion?: string;
}

export class ZkUsdError extends Error {
  readonly code: ZkUsdErrorCode;
  readonly userMessage: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: Error;
  readonly recoverable: boolean;
  readonly suggestion?: string;
  readonly timestamp: Date;

  constructor(
    code: ZkUsdErrorCode,
    message: string,
    details?: ZkUsdErrorDetails
  ) {
    super(message);
    this.name = 'ZkUsdError';
    this.code = code;
    this.userMessage = getUserFriendlyMessage(code, details?.context);
    this.context = details?.context;
    this.cause = details?.cause;
    this.recoverable = details?.recoverable ?? isRecoverableError(code);
    this.suggestion = details?.suggestion ?? getSuggestion(code);
    this.timestamp = new Date();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZkUsdError);
    }
  }

  /**
   * Create a JSON-safe representation for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }

  /**
   * Log the error with full context
   */
  log(): void {
    console.error(`[ZkUsdError] ${this.code}: ${this.message}`, this.toJSON());
  }
}

// ============================================================================
// Error Factory Functions
// ============================================================================

export function createVaultError(
  code: 'VAULT_NOT_FOUND' | 'UNDERCOLLATERALIZED' | 'VAULT_ALREADY_EXISTS' | 'VAULT_NOT_ACTIVE' | 'VAULT_HAS_DEBT',
  context?: Record<string, unknown>
): ZkUsdError {
  const messages: Record<typeof code, string> = {
    VAULT_NOT_FOUND: 'Vault not found',
    UNDERCOLLATERALIZED: 'Vault would be undercollateralized',
    VAULT_ALREADY_EXISTS: 'A vault already exists for this address',
    VAULT_NOT_ACTIVE: 'Vault is not active',
    VAULT_HAS_DEBT: 'Cannot close vault with remaining debt',
  };

  return new ZkUsdError(code, messages[code], { context, recoverable: true });
}

export function createNetworkError(
  code: 'NETWORK_ERROR' | 'TIMEOUT' | 'PROVER_ERROR' | 'BROADCAST_FAILED',
  message: string,
  cause?: Error
): ZkUsdError {
  return new ZkUsdError(code, message, {
    cause,
    recoverable: true,
    suggestion: 'Please check your internet connection and try again.',
  });
}

export function createWalletError(
  code: 'WALLET_NOT_CONNECTED' | 'INSUFFICIENT_UTXOS' | 'SIGNING_REJECTED' | 'SIGNING_FAILED',
  context?: Record<string, unknown>
): ZkUsdError {
  return new ZkUsdError(code, getWalletErrorMessage(code), {
    context,
    recoverable: true,
  });
}

export function createAmountError(
  code: 'INVALID_AMOUNT' | 'INSUFFICIENT_BALANCE' | 'BELOW_MINIMUM' | 'EXCEEDS_MAXIMUM' | 'ZERO_AMOUNT',
  context?: Record<string, unknown>
): ZkUsdError {
  return new ZkUsdError(code, getAmountErrorMessage(code, context), {
    context,
    recoverable: true,
  });
}

// ============================================================================
// Error Wrapping Utilities
// ============================================================================

/**
 * Wrap any error as a ZkUsdError
 */
export function wrapError(error: unknown, fallbackCode: ZkUsdErrorCode = 'UNKNOWN_ERROR'): ZkUsdError {
  if (error instanceof ZkUsdError) {
    return error;
  }

  if (error instanceof Error) {
    // Try to detect specific error types
    const code = detectErrorCode(error);
    return new ZkUsdError(code || fallbackCode, error.message, { cause: error });
  }

  return new ZkUsdError(fallbackCode, String(error));
}

/**
 * Detect error code from error message
 */
function detectErrorCode(error: Error): ZkUsdErrorCode | null {
  const message = error.message.toLowerCase();

  if (message.includes('vk mismatch') || message.includes('verification key')) {
    return 'CONFIG_ERROR';
  }
  if (message.includes('undercollateralized')) {
    return 'UNDERCOLLATERALIZED';
  }
  if (message.includes('insufficient')) {
    if (message.includes('utxo')) return 'INSUFFICIENT_UTXOS';
    if (message.includes('balance')) return 'INSUFFICIENT_BALANCE';
    return 'INSUFFICIENT_BALANCE';
  }
  if (message.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'NETWORK_ERROR';
  }
  if (message.includes('rejected') || message.includes('declined')) {
    return 'SIGNING_REJECTED';
  }
  if (message.includes('not found')) {
    if (message.includes('vault')) return 'VAULT_NOT_FOUND';
    if (message.includes('utxo')) return 'UTXO_NOT_FOUND';
    if (message.includes('tx') || message.includes('transaction')) return 'TX_NOT_FOUND';
  }

  return null;
}

// ============================================================================
// User-Friendly Message Generators
// ============================================================================

function getUserFriendlyMessage(code: ZkUsdErrorCode, context?: Record<string, unknown>): string {
  const messages: Record<ZkUsdErrorCode, string | ((ctx?: Record<string, unknown>) => string)> = {
    // Vault errors
    VAULT_NOT_FOUND: 'Your vault could not be found. It may have been closed or doesn\'t exist.',
    UNDERCOLLATERALIZED: (ctx) => {
      const current = ctx?.currentRatio as number | undefined;
      const required = ctx?.requiredRatio as number | undefined;
      if (current && required) {
        return `Your vault would be undercollateralized (${current}% < ${required}% required).`;
      }
      return 'This action would make your vault undercollateralized.';
    },
    VAULT_ALREADY_EXISTS: 'You already have an active vault. You can manage it or close it first.',
    VAULT_NOT_ACTIVE: 'This vault is no longer active.',
    VAULT_HAS_DEBT: 'You must repay all debt before closing your vault.',

    // Amount errors
    INVALID_AMOUNT: 'The amount you entered is invalid.',
    INSUFFICIENT_BALANCE: (ctx) => {
      const available = ctx?.available as number | undefined;
      const requested = ctx?.requested as number | undefined;
      if (available !== undefined && requested !== undefined) {
        return `Insufficient balance. You have ${available} but need ${requested}.`;
      }
      return 'You don\'t have enough balance for this transaction.';
    },
    BELOW_MINIMUM: (ctx) => {
      const minimum = ctx?.minimum as number | undefined;
      return minimum
        ? `Amount is below the minimum of ${minimum}.`
        : 'Amount is below the required minimum.';
    },
    EXCEEDS_MAXIMUM: 'Amount exceeds the maximum allowed.',
    ZERO_AMOUNT: 'Amount cannot be zero.',

    // Authorization errors
    UNAUTHORIZED: 'You are not authorized to perform this action.',
    MISSING_SIGNATURE: 'Transaction signature is required.',
    INVALID_SIGNATURE: 'The transaction signature is invalid.',
    ADMIN_ONLY: 'Only the protocol administrator can perform this action.',

    // Oracle errors
    ORACLE_STALE: 'The price oracle data is stale. Please wait for an update.',
    ORACLE_DEVIATION: 'The price has changed significantly. Please refresh and try again.',
    ORACLE_NOT_INITIALIZED: 'The price oracle is not yet initialized.',
    INVALID_ORACLE_SOURCE: 'Invalid oracle price source.',

    // Recovery mode errors
    RECOVERY_MODE_RESTRICTION: 'This operation is restricted during Recovery Mode.',
    WOULD_WORSEN_TCR: 'This action would worsen the system\'s Total Collateral Ratio.',

    // Stability Pool errors
    INSUFFICIENT_POOL_BALANCE: 'The Stability Pool has insufficient balance.',
    DEPOSIT_NOT_FOUND: 'No deposit found for your address.',
    NO_REWARDS: 'You have no rewards to claim.',

    // Liquidation errors
    NOT_LIQUIDATABLE: 'This vault is not eligible for liquidation.',
    NOTHING_TO_LIQUIDATE: 'There is nothing to liquidate.',
    LIQUIDATION_DUST: 'Liquidation would leave a dust amount.',

    // Token errors
    TRANSFER_FAILED: 'Token transfer failed.',
    MINT_UNAUTHORIZED: 'Token minting is not authorized.',
    BURN_UNAUTHORIZED: 'Token burning is not authorized.',
    CONSERVATION_VIOLATED: 'Token conservation rule violated.',

    // Math errors
    OVERFLOW: 'Calculation overflow occurred.',
    UNDERFLOW: 'Calculation underflow occurred.',
    DIVISION_BY_ZERO: 'Division by zero error.',

    // Network errors
    NETWORK_ERROR: 'Network error. Please check your connection.',
    TIMEOUT: 'Request timed out. Please try again.',
    PROVER_ERROR: 'Error generating zero-knowledge proof. Please try again.',
    BROADCAST_FAILED: 'Failed to broadcast transaction. Please try again.',
    UTXO_NOT_FOUND: 'UTXO not found. It may have been spent.',
    TX_NOT_FOUND: 'Transaction not found.',

    // Wallet errors
    WALLET_NOT_CONNECTED: 'Please connect your wallet to continue.',
    INSUFFICIENT_UTXOS: 'You need more separate UTXOs. Please split your funds.',
    SIGNING_REJECTED: 'Transaction signing was cancelled.',
    SIGNING_FAILED: 'Failed to sign the transaction.',

    // Configuration errors
    CONFIG_ERROR: 'Configuration error. The contracts may need to be redeployed.',
    INVALID_NETWORK: 'Invalid network selected.',
    CONTRACT_NOT_DEPLOYED: 'The contract is not deployed on this network.',

    // General errors
    UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
    VALIDATION_ERROR: 'Input validation failed. Please check your inputs.',
  };

  const messageOrFn = messages[code];
  if (typeof messageOrFn === 'function') {
    return messageOrFn(context);
  }
  return messageOrFn;
}

function getWalletErrorMessage(code: 'WALLET_NOT_CONNECTED' | 'INSUFFICIENT_UTXOS' | 'SIGNING_REJECTED' | 'SIGNING_FAILED'): string {
  const messages: Record<typeof code, string> = {
    WALLET_NOT_CONNECTED: 'Wallet not connected',
    INSUFFICIENT_UTXOS: 'You need at least 2 UTXOs (one for collateral, one for fees)',
    SIGNING_REJECTED: 'Transaction signing was rejected',
    SIGNING_FAILED: 'Failed to sign transaction',
  };
  return messages[code];
}

function getAmountErrorMessage(
  code: 'INVALID_AMOUNT' | 'INSUFFICIENT_BALANCE' | 'BELOW_MINIMUM' | 'EXCEEDS_MAXIMUM' | 'ZERO_AMOUNT',
  context?: Record<string, unknown>
): string {
  switch (code) {
    case 'BELOW_MINIMUM':
      return context?.minimum
        ? `Amount is below minimum of ${context.minimum}`
        : 'Amount is below minimum';
    case 'EXCEEDS_MAXIMUM':
      return context?.maximum
        ? `Amount exceeds maximum of ${context.maximum}`
        : 'Amount exceeds maximum';
    case 'INSUFFICIENT_BALANCE':
      return context?.available
        ? `Insufficient balance: ${context.available} available`
        : 'Insufficient balance';
    default:
      return 'Invalid amount';
  }
}

function getSuggestion(code: ZkUsdErrorCode): string | undefined {
  const suggestions: Partial<Record<ZkUsdErrorCode, string>> = {
    UNDERCOLLATERALIZED: 'Add more collateral or borrow less.',
    INSUFFICIENT_BALANCE: 'Add funds to your wallet.',
    INSUFFICIENT_UTXOS: 'Split your UTXOs by sending a small amount to yourself.',
    WALLET_NOT_CONNECTED: 'Click "Connect Wallet" to get started.',
    ORACLE_STALE: 'Wait a few minutes for the oracle to update.',
    NETWORK_ERROR: 'Check your internet connection and try again.',
    TIMEOUT: 'The operation is taking too long. Try again later.',
    CONFIG_ERROR: 'The contract configuration may be outdated. Contact support.',
  };
  return suggestions[code];
}

function isRecoverableError(code: ZkUsdErrorCode): boolean {
  const nonRecoverable: ZkUsdErrorCode[] = [
    'UNAUTHORIZED',
    'ADMIN_ONLY',
    'CONSERVATION_VIOLATED',
    'OVERFLOW',
    'UNDERFLOW',
    'DIVISION_BY_ZERO',
    'CONFIG_ERROR',
    'CONTRACT_NOT_DEPLOYED',
  ];
  return !nonRecoverable.includes(code);
}

// ============================================================================
// Logging Utilities
// ============================================================================

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

export function createLogger(prefix: string, verbose = false): Logger {
  const formatMessage = (level: string, msg: string) =>
    `[${prefix}] [${level}] ${msg}`;

  return {
    debug(message, context) {
      if (verbose) {
        console.debug(formatMessage('DEBUG', message), context ?? '');
      }
    },
    info(message, context) {
      console.log(formatMessage('INFO', message), context ?? '');
    },
    warn(message, context) {
      console.warn(formatMessage('WARN', message), context ?? '');
    },
    error(message, error, context) {
      console.error(formatMessage('ERROR', message), {
        error: error instanceof ZkUsdError ? error.toJSON() : error?.message,
        ...context,
      });
    },
  };
}
