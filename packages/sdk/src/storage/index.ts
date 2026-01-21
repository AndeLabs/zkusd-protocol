/**
 * Storage Module
 *
 * Client-side state management following Charms best practices.
 * No traditional backend or indexer needed - users track their own state.
 */

export { VaultStorage, createVaultStorage } from './vault-storage';
export type { TrackedVault, VaultStorageData } from './vault-storage';

export { UtxoVerifier, createUtxoVerifier } from './utxo-verifier';
export type { VerificationResult, BatchVerificationResult } from './utxo-verifier';
