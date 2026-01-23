/**
 * Error Diagnostics Service
 *
 * Provides detailed, actionable error messages for common issues.
 * Parses prover errors and translates them to user-friendly messages.
 */

// ============================================================================
// Error Categories
// ============================================================================

export type ErrorCategory =
  | 'VK_MISMATCH'
  | 'UTXO_SPENT'
  | 'UTXO_NOT_FOUND'
  | 'CONTRACT_VALIDATION'
  | 'INSUFFICIENT_FUNDS'
  | 'NETWORK_ERROR'
  | 'PROVER_TIMEOUT'
  | 'UNKNOWN';

export interface DiagnosedError {
  category: ErrorCategory;
  title: string;
  description: string;
  suggestion: string;
  technical?: string;
  recoverable: boolean;
}

// ============================================================================
// Error Patterns
// ============================================================================

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  category: ErrorCategory;
  diagnose: (match: RegExpMatchArray, raw: string) => DiagnosedError;
}> = [
  {
    pattern: /unexecutable|verification.*fail/i,
    category: 'VK_MISMATCH',
    diagnose: (_, raw) => ({
      category: 'VK_MISMATCH',
      title: 'Contract Verification Failed',
      description: 'The spell references a contract version that differs from what is deployed on-chain.',
      suggestion: 'Run deployment verification to check VK consistency. May need to redeploy contracts.',
      technical: `Prover error: ${raw.slice(0, 200)}`,
      recoverable: false,
    }),
  },
  {
    pattern: /utxo.*spent|already.*spent/i,
    category: 'UTXO_SPENT',
    diagnose: (_, raw) => ({
      category: 'UTXO_SPENT',
      title: 'UTXO Already Spent',
      description: 'The input UTXO has already been used in another transaction.',
      suggestion: 'Wait for cache expiry (~1 hour) or select a different UTXO.',
      technical: raw.slice(0, 200),
      recoverable: true,
    }),
  },
  {
    pattern: /utxo.*not.*found|no.*such.*utxo/i,
    category: 'UTXO_NOT_FOUND',
    diagnose: (_, raw) => ({
      category: 'UTXO_NOT_FOUND',
      title: 'UTXO Not Found',
      description: 'The referenced UTXO does not exist or has not been confirmed yet.',
      suggestion: 'Verify the UTXO exists on-chain. If recently created, wait for confirmation.',
      technical: raw.slice(0, 200),
      recoverable: true,
    }),
  },
  {
    pattern: /insufficient|not.*enough|balance/i,
    category: 'INSUFFICIENT_FUNDS',
    diagnose: (_, raw) => ({
      category: 'INSUFFICIENT_FUNDS',
      title: 'Insufficient Funds',
      description: 'Not enough BTC or zkUSD to complete this operation.',
      suggestion: 'Check your balance and try with a smaller amount.',
      technical: raw.slice(0, 200),
      recoverable: true,
    }),
  },
  {
    pattern: /undercollateralized|icr.*below|ratio/i,
    category: 'CONTRACT_VALIDATION',
    diagnose: (_, raw) => ({
      category: 'CONTRACT_VALIDATION',
      title: 'Undercollateralized Position',
      description: 'The vault would be below minimum collateral ratio after this operation.',
      suggestion: 'Add more collateral or reduce the debt amount.',
      technical: raw.slice(0, 200),
      recoverable: true,
    }),
  },
  {
    pattern: /timeout|timed.*out/i,
    category: 'PROVER_TIMEOUT',
    diagnose: (_, raw) => ({
      category: 'PROVER_TIMEOUT',
      title: 'Prover Timeout',
      description: 'The proof generation took too long.',
      suggestion: 'Try again. If this persists, the prover may be overloaded.',
      technical: raw.slice(0, 200),
      recoverable: true,
    }),
  },
  {
    pattern: /network|connection|fetch/i,
    category: 'NETWORK_ERROR',
    diagnose: (_, raw) => ({
      category: 'NETWORK_ERROR',
      title: 'Network Error',
      description: 'Could not connect to the prover or blockchain API.',
      suggestion: 'Check your internet connection and try again.',
      technical: raw.slice(0, 200),
      recoverable: true,
    }),
  },
];

// ============================================================================
// Diagnostics Function
// ============================================================================

/**
 * Diagnose an error and return a user-friendly explanation
 */
export function diagnoseError(error: Error | string): DiagnosedError {
  const errorMessage = typeof error === 'string' ? error : error.message;

  // Try each pattern
  for (const { pattern, diagnose } of ERROR_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match) {
      return diagnose(match, errorMessage);
    }
  }

  // Unknown error
  return {
    category: 'UNKNOWN',
    title: 'Unexpected Error',
    description: 'An unexpected error occurred.',
    suggestion: 'Please try again. If the issue persists, contact support.',
    technical: errorMessage.slice(0, 500),
    recoverable: true,
  };
}

/**
 * Check if an error indicates a VK mismatch (needs redeployment)
 */
export function isVkMismatchError(error: Error | string): boolean {
  const diagnosed = diagnoseError(error);
  return diagnosed.category === 'VK_MISMATCH';
}

/**
 * Check if an error is recoverable (user can retry)
 */
export function isRecoverableError(error: Error | string): boolean {
  const diagnosed = diagnoseError(error);
  return diagnosed.recoverable;
}

/**
 * Format error for display in UI
 */
export function formatErrorForUI(error: Error | string): string {
  const diagnosed = diagnoseError(error);
  return `${diagnosed.title}\n\n${diagnosed.description}\n\n💡 ${diagnosed.suggestion}`;
}

// ============================================================================
// Pre-flight Checks
// ============================================================================

export interface PreflightResult {
  ready: boolean;
  issues: string[];
  warnings: string[];
}

/**
 * Perform pre-flight checks before proving
 * Catches common issues early with clear messages
 */
export async function preflightCheck(params: {
  configVk: string;
  stateUtxo: string;
  explorerApiUrl: string;
}): Promise<PreflightResult> {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check state UTXO exists and is not spent
  try {
    const [txid, voutStr] = params.stateUtxo.split(':');
    const vout = parseInt(voutStr, 10);

    const response = await fetch(
      `${params.explorerApiUrl}/tx/${txid}/outspend/${vout}`
    );

    if (response.ok) {
      const data = await response.json();
      if (data.spent) {
        issues.push(
          `State UTXO ${txid.slice(0, 8)}...:${vout} has been spent. ` +
          `Contract needs redeployment.`
        );
      }
    } else {
      warnings.push(`Could not verify state UTXO status`);
    }
  } catch {
    warnings.push(`Network error checking state UTXO`);
  }

  return {
    ready: issues.length === 0,
    issues,
    warnings,
  };
}
