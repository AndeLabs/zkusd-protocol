// Charms Prover Service
// Based on: https://docs.charms.dev/guides/wallet-integration/transactions/prover-api/

import type { Network } from '@zkusd/types';

// ============================================================================
// Types
// ============================================================================

export interface Spell {
  version: number;
  apps: Record<string, SpellApp | string>;  // Allow string app refs (v8 format) or full SpellApp objects
  ins: SpellInput[];
  outs: SpellOutput[];
}

export interface SpellApp {
  id: string;        // App ID (32 bytes hex)
  vk: string;        // Verification key (32 bytes hex)
  public_inputs?: unknown[];
  private_inputs?: unknown[];
}

export interface SpellInput {
  utxo: string;      // "txid:vout"
  charms?: Record<string, unknown>;
}

export interface SpellOutput {
  address?: string;
  charms?: Record<string, unknown>;
}

export interface ProveRequest {
  spell: Spell;
  binaries: Record<string, string>;  // VK -> base64 ELF binary
  prev_txs: string[];                 // Raw tx hex array
  funding_utxo: string;               // "txid:vout"
  funding_utxo_value: number;         // satoshis
  change_address: string;
  fee_rate: number;                   // sat/vbyte
}

export interface ProveResponse {
  commitTx: string;   // Hex encoded commit transaction
  spellTx: string;    // Hex encoded spell transaction
}

export interface ProverConfig {
  apiUrl?: string;
  timeout?: number;
  retries?: number;
  retryDelayMs?: number;
  demoMode?: boolean; // Enable demo mode (simulated responses, no actual proving)
}

// ============================================================================
// Constants
// ============================================================================

const PROVER_URLS: Record<Network, string> = {
  mainnet: 'https://v8.charms.dev/spells/prove',
  testnet4: 'https://v8.charms.dev/spells/prove',
  signet: 'https://v8.charms.dev/spells/prove',
  regtest: 'http://localhost:17784/spells/prove',
};

const DEFAULT_CONFIG: Required<ProverConfig> = {
  apiUrl: PROVER_URLS.testnet4,
  timeout: 300_000,      // 5 minutes - proving can be slow
  retries: 3,
  retryDelayMs: 5_000,
  demoMode: false,
};

// Retry delays for server errors (progressive backoff)
const RETRY_DELAYS = [3_000, 10_000, 15_000, 20_000, 25_000, 30_000];

// ============================================================================
// Prover Service
// ============================================================================

export class ProverService {
  private config: Required<ProverConfig>;
  private network: Network;
  private isDemoMode: boolean;

  constructor(network: Network, config: ProverConfig = {}) {
    this.network = network;
    // Demo mode only enabled explicitly via config
    // The public Charms prover supports both mainnet and testnet4
    this.isDemoMode = config.demoMode ?? false;

    this.config = {
      ...DEFAULT_CONFIG,
      apiUrl: config.apiUrl || PROVER_URLS[network],
      demoMode: this.isDemoMode,
      ...config,
    };

    if (this.isDemoMode) {
      console.warn(`[ProverService] Running in DEMO MODE for ${network}. Transactions will be simulated.`);
    }
  }

  /**
   * Check if running in demo mode
   */
  isDemo(): boolean {
    return this.isDemoMode;
  }

  /**
   * Prove a spell and get signed commit/spell transactions
   */
  async prove(request: ProveRequest): Promise<ProveResponse> {
    // In demo mode, return simulated transactions
    if (this.isDemoMode) {
      return this.simulateProve(request);
    }

    this.validateRequest(request);

    // Build request body with chain parameter
    // Note: chain is 'bitcoin' for both mainnet and testnet4
    const requestBody = {
      spell: request.spell,
      binaries: request.binaries,
      prev_txs: request.prev_txs,
      funding_utxo: request.funding_utxo,
      funding_utxo_value: request.funding_utxo_value,
      change_address: request.change_address,
      fee_rate: request.fee_rate,
      chain: 'bitcoin', // Required by Charms API
    };

    console.log('[ProverService] Sending request to:', this.config.apiUrl);
    console.log('[ProverService] Network:', this.network);
    console.log('[ProverService] Funding UTXO:', request.funding_utxo);
    console.log('[ProverService] Change address:', request.change_address);

    const body = JSON.stringify(requestBody);

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.config.retries) {
      try {
        const response = await this.fetchWithTimeout(body);

        if (!response.ok) {
          const errorText = await response.text();

          // Don't retry on 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw new ProverError(
              `Prover request failed: ${response.status} ${errorText}`,
              'CLIENT_ERROR',
              response.status
            );
          }

          // Retry on 5xx errors
          throw new ProverError(
            `Prover server error: ${response.status} ${errorText}`,
            'SERVER_ERROR',
            response.status
          );
        }

        const result = await response.json();
        return this.parseResponse(result);

      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors or invalid responses
        if (error instanceof ProverError &&
            (error.code === 'CLIENT_ERROR' ||
             error.code === 'INVALID_RESPONSE' ||
             error.code === 'INVALID_REQUEST')) {
          throw error;
        }

        attempt++;
        if (attempt < this.config.retries) {
          const delay = RETRY_DELAYS[attempt - 1] || this.config.retryDelayMs;
          console.log(`Prover request failed, retrying in ${delay}ms (attempt ${attempt}/${this.config.retries})`);
          await this.sleep(delay);
        }
      }
    }

    throw new ProverError(
      `Prover request failed after ${this.config.retries} attempts: ${lastError?.message}`,
      'MAX_RETRIES_EXCEEDED'
    );
  }

  /**
   * Build a simple token transfer spell
   */
  buildTransferSpell(params: {
    tokenAppId: string;
    tokenVk: string;
    inputUtxo: string;
    inputCharms: Record<string, unknown>;
    outputAddress: string;
    outputCharms: Record<string, unknown>;
    changeAddress?: string;
    changeCharms?: Record<string, unknown>;
  }): Spell {
    const outputs: SpellOutput[] = [
      {
        address: params.outputAddress,
        charms: params.outputCharms,
      },
    ];

    // Add change output if specified
    if (params.changeAddress && params.changeCharms) {
      outputs.push({
        address: params.changeAddress,
        charms: params.changeCharms,
      });
    }

    return {
      version: 1,
      apps: {
        [`n/${params.tokenAppId}/${params.tokenVk}`]: {
          id: params.tokenAppId,
          vk: params.tokenVk,
        },
      },
      ins: [
        {
          utxo: params.inputUtxo,
          charms: params.inputCharms,
        },
      ],
      outs: outputs,
    };
  }

  /**
   * Build a vault operation spell (open, close, adjust)
   */
  buildVaultSpell(params: {
    operation: 'open' | 'close' | 'adjust' | 'liquidate';
    vmAppId: string;
    vmVk: string;
    tokenAppId: string;
    tokenVk: string;
    oracleAppId: string;
    oracleVk: string;
    inputs: SpellInput[];
    outputs: SpellOutput[];
    publicInputs?: unknown[];
    privateInputs?: unknown[];
  }): Spell {
    const vmAppRef = `n/${params.vmAppId}/${params.vmVk}`;
    const tokenAppRef = `n/${params.tokenAppId}/${params.tokenVk}`;
    const oracleAppRef = `n/${params.oracleAppId}/${params.oracleVk}`;

    return {
      version: 1,
      apps: {
        [vmAppRef]: {
          id: params.vmAppId,
          vk: params.vmVk,
          public_inputs: params.publicInputs,
          private_inputs: params.privateInputs,
        },
        [tokenAppRef]: {
          id: params.tokenAppId,
          vk: params.tokenVk,
        },
        [oracleAppRef]: {
          id: params.oracleAppId,
          vk: params.oracleVk,
        },
      },
      ins: params.inputs,
      outs: params.outputs,
    };
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private async fetchWithTimeout(body: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      return await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateRequest(request: ProveRequest): void {
    if (!request.spell) {
      throw new ProverError('Missing spell in request', 'INVALID_REQUEST');
    }

    if (!request.funding_utxo || !request.funding_utxo.includes(':')) {
      throw new ProverError('Invalid funding_utxo format (expected txid:vout)', 'INVALID_REQUEST');
    }

    if (!request.funding_utxo_value || request.funding_utxo_value <= 0) {
      throw new ProverError('Invalid funding_utxo_value', 'INVALID_REQUEST');
    }

    if (!request.change_address) {
      throw new ProverError('Missing change_address', 'INVALID_REQUEST');
    }

    if (!request.fee_rate || request.fee_rate <= 0) {
      throw new ProverError('Invalid fee_rate', 'INVALID_REQUEST');
    }

    if (!request.prev_txs || request.prev_txs.length === 0) {
      throw new ProverError('Missing prev_txs', 'INVALID_REQUEST');
    }
  }

  private parseResponse(result: unknown): ProveResponse {
    // Response should be an array of two hex strings
    if (!Array.isArray(result) || result.length !== 2) {
      throw new ProverError(
        `Invalid prover response format: expected array of 2 transactions, got ${JSON.stringify(result)}`,
        'INVALID_RESPONSE'
      );
    }

    const [commitTx, spellTx] = result;

    if (typeof commitTx !== 'string' || typeof spellTx !== 'string') {
      throw new ProverError('Invalid transaction format in prover response', 'INVALID_RESPONSE');
    }

    // Validate hex format
    if (!/^[0-9a-fA-F]+$/.test(commitTx) || !/^[0-9a-fA-F]+$/.test(spellTx)) {
      throw new ProverError('Invalid hex format in prover response', 'INVALID_RESPONSE');
    }

    return { commitTx, spellTx };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Simulate a prove response for demo mode
   * Creates deterministic fake transaction hex based on the request
   */
  private simulateProve(request: ProveRequest): ProveResponse {
    // Create deterministic hashes based on request content
    const seed = JSON.stringify(request.spell) + request.funding_utxo;
    const hash1 = this.simpleHash(seed);
    const hash2 = this.simpleHash(seed + 'spell');

    // Generate fake transaction hex (looks realistic but is clearly demo)
    // Format: version (4 bytes) + marker + flag + inputs + outputs + witness + locktime
    const commitTxId = hash1.toString(16).padStart(64, '0');
    const spellTxId = hash2.toString(16).padStart(64, '0');

    // Build minimal valid-looking transaction hex
    // 02000000 = version 2
    // 0001 = segwit marker + flag
    // 01 = 1 input
    // [txid] = 32 bytes reversed
    // 00000000 = vout
    // 00 = empty scriptsig
    // ffffffff = sequence
    // 01 = 1 output
    // [value] = 8 bytes little endian
    // [scriptpubkey]
    // 00 = empty witness
    // 00000000 = locktime
    const commitTx = `0200000001${commitTxId}00000000ffffffff0100000000000000000000000000`;
    const spellTx = `0200000001${spellTxId}00000000ffffffff0100000000000000000000000000`;

    console.warn('[ProverService DEMO] Simulated transactions generated');
    console.warn('[ProverService DEMO] Commit TX:', commitTxId.slice(0, 16) + '...');
    console.warn('[ProverService DEMO] Spell TX:', spellTxId.slice(0, 16) + '...');

    return {
      commitTx,
      spellTx,
    };
  }

  /**
   * Simple hash function for deterministic ID generation
   */
  private simpleHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

// ============================================================================
// Error class
// ============================================================================

export type ProverErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'CLIENT_ERROR'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'MAX_RETRIES_EXCEEDED'
  | 'NETWORK_ERROR';

export class ProverError extends Error {
  readonly code: ProverErrorCode;
  readonly statusCode?: number;

  constructor(message: string, code: ProverErrorCode, statusCode?: number) {
    super(message);
    this.name = 'ProverError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
