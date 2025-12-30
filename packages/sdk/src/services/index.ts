// SDK Services exports

export { BitcoinApiService } from './bitcoin-api';
export type { Utxo, Transaction, BlockStatus, FeeEstimates } from './bitcoin-api';

export { ProverService, ProverError } from './prover';
export type {
  Spell,
  SpellApp,
  SpellInput,
  SpellOutput,
  ProveRequest,
  ProveResponse,
  ProverConfig,
  ProverErrorCode,
} from './prover';
