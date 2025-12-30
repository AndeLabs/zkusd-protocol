// zkUSD SDK - Main exports

export { ZkUsdClient, type ZkUsdClientConfig } from './client';
export { VaultService } from './vault';
export { OracleService } from './oracle';
export { StabilityPoolService } from './stability-pool';
export { SpellBuilder } from './spell-builder';

// Services
export {
  BitcoinApiService,
  ProverService,
  ProverError,
} from './services';

export type {
  Utxo,
  Transaction,
  BlockStatus,
  FeeEstimates,
  Spell,
  SpellApp,
  SpellInput,
  SpellOutput,
  ProveRequest,
  ProveResponse,
  ProverConfig,
  ProverErrorCode,
} from './services';

// Re-export types for convenience
export * from '@zkusd/types';
