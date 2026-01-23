/**
 * Services Index - Export all services for zkUSD
 */

// UTXO Service
export {
  getUtxoService,
  type UtxoService,
  type UtxoInfo,
  type UtxoAvailability,
  type UtxoSelectionResult,
  type UtxoPairResult,
} from './utxo-service';

// Spell Service
export {
  getSpellService,
  type SpellService,
  type FrozenValues,
  type SpellParams,
  type SpellContext,
  type PendingSpellInfo,
} from './spell-service';

// Vault State Machine
export {
  createInitialContext,
  transitionToSelecting,
  handleUtxoSelection,
  transitionToBuilding,
  handleSpellBuilt,
  updateProvingProgress,
  transitionToSigning,
  transitionToBroadcasting,
  handleSuccess,
  handleError,
  reset,
  parseErrorType,
  canStartOperation,
  canConfirm,
  getActionButtonText,
  isButtonDisabled,
  isLoading,
  type VaultState,
  type VaultStateContext,
  type VaultResult,
  type ErrorType,
} from './vault-state-machine';
