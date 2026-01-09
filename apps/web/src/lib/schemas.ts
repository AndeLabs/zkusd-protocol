import { z } from 'zod';

// ============================================================================
// Bitcoin Schemas
// ============================================================================

export const btcAddressSchema = z.string()
  .min(26, 'Address too short')
  .max(90, 'Address too long')
  .regex(/^[a-zA-Z0-9]+$/, 'Invalid characters in address');

export const txidSchema = z.string()
  .length(64, 'TXID must be 64 characters')
  .regex(/^[a-fA-F0-9]+$/, 'TXID must be hexadecimal');

export const satoshiSchema = z.bigint()
  .nonnegative('Amount must be non-negative')
  .max(BigInt(21_000_000 * 100_000_000), 'Amount exceeds max supply');

export const btcAmountSchema = z.number()
  .nonnegative('Amount must be non-negative')
  .max(21_000_000, 'Amount exceeds max supply');

// ============================================================================
// Vault Schemas
// ============================================================================

export const openVaultSchema = z.object({
  collateralBtc: z.string()
    .refine(val => !isNaN(parseFloat(val)), 'Must be a valid number')
    .refine(val => parseFloat(val) > 0, 'Collateral must be greater than 0')
    .refine(val => parseFloat(val) <= 21_000_000, 'Exceeds max BTC supply'),

  debtZkusd: z.string()
    .refine(val => !isNaN(parseFloat(val)), 'Must be a valid number')
    .refine(val => parseFloat(val) >= 0, 'Debt must be non-negative'),
});

export const adjustVaultSchema = z.object({
  mode: z.enum(['collateral', 'debt']),
  direction: z.enum(['add', 'remove']),
  amount: z.string()
    .refine(val => !isNaN(parseFloat(val)), 'Must be a valid number')
    .refine(val => parseFloat(val) > 0, 'Amount must be greater than 0'),
});

// ============================================================================
// API Schemas
// ============================================================================

export const priceResponseSchema = z.object({
  price: z.number().positive(),
  source: z.string(),
  timestamp: z.number(),
});

// ============================================================================
// Form Validation Helpers
// ============================================================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: Record<string, string> };

export function validateForm<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  const issues = result.error.issues || [];
  issues.forEach((issue) => {
    const path = issue.path.join('.');
    errors[path] = issue.message;
  });

  return { success: false, errors };
}

// ============================================================================
// Sanitization Helpers
// ============================================================================

export function sanitizeNumber(value: string): string {
  // Remove all non-numeric characters except decimal point
  return value.replace(/[^0-9.]/g, '');
}

export function sanitizeHex(value: string): string {
  // Remove all non-hex characters
  return value.replace(/[^a-fA-F0-9]/g, '');
}

export function sanitizeAddress(value: string): string {
  // Remove whitespace and validate characters
  return value.trim().replace(/[^a-zA-Z0-9]/g, '');
}

// ============================================================================
// Validation Functions
// ============================================================================

export function isValidBtcAddress(address: string): boolean {
  return btcAddressSchema.safeParse(address).success;
}

export function isValidTxid(txid: string): boolean {
  return txidSchema.safeParse(txid).success;
}

export function isValidBtcAmount(amount: number): boolean {
  return btcAmountSchema.safeParse(amount).success;
}
