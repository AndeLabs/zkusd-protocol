// zkUSD SDK - Main exports

export { ZkUsdClient, type ZkUsdClientConfig } from './client';
export { VaultService } from './vault';
export { OracleService } from './oracle';
export { StabilityPoolService } from './stability-pool';
export { SpellBuilder } from './spell-builder';

// Error handling
export {
  ZkUsdError,
  type ZkUsdErrorCode,
  type ZkUsdErrorDetails,
  createVaultError,
  createNetworkError,
  createWalletError,
  createAmountError,
  wrapError,
  createLogger,
  type Logger,
} from './errors';

// Services
export {
  BitcoinApiService,
  ProverService,
  ProverError,
  BinaryService,
  getBinaryService,
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
  BinaryConfig,
  BinaryCache,
} from './services';

// Re-export types for convenience
export * from '@zkusd/types';
