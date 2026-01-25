// Charms Prover Service
// Based on: https://docs.charms.dev/guides/wallet-integration/transactions/prover-api/
//
// Features:
// - Multi-endpoint support with automatic fallback
// - Health checks for endpoint availability
// - Progressive retry with exponential backoff

import type { Network } from '@zkusd/types';
import { getProverEndpoints, type ProverEndpoint } from '@zkusd/config';

// ============================================================================
// Types
// ============================================================================

export interface Spell {
  version: number;
  apps: Record<string, SpellApp | string>;  // Allow string app refs (v8 format) or full SpellApp objects
  refs?: SpellInput[];  // Reference inputs (read but not spent) - for protocol state
  ins: SpellInput[];
  outs: SpellOutput[];
  public_inputs?: Record<string, unknown>;  // Public inputs (recorded on-chain, e.g., PriceData)
  private_inputs?: Record<string, unknown>;  // Witness data for spell execution (NOT recorded on-chain)
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
  /** Override the default prover endpoints */
  endpoints?: ProverEndpoint[];
  /** Single API URL (for backwards compatibility - will be converted to endpoint) */
  apiUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retries per endpoint */
  retries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

// Fallback URLs if config package doesn't provide endpoints
// v9 prover for Charms v0.11.1 (spell version 9)
const FALLBACK_PROVER_URLS: Record<Network, string[]> = {
  mainnet: ['https://v9.charms.dev/spells/prove', 'https://v8.charms.dev/spells/prove'],
  testnet4: ['https://v9.charms.dev/spells/prove', 'https://v8.charms.dev/spells/prove'],
  signet: ['https://v9.charms.dev/spells/prove'],
  regtest: ['http://localhost:17784/spells/prove'],
};

const DEFAULT_CONFIG = {
  timeout: 300_000,      // 5 minutes - proving can be slow
  retries: 3,
  retryDelayMs: 5_000,
  verbose: false,
};

// Retry delays for server errors (progressive backoff)
const RETRY_DELAYS = [3_000, 10_000, 15_000, 20_000, 25_000, 30_000];

// ============================================================================
// Prover Service
// ============================================================================

export class ProverService {
  private endpoints: ProverEndpoint[];
  private network: Network;
  private timeout: number;
  private retries: number;
  private retryDelayMs: number;
  private verbose: boolean;

  // Track endpoint health for smart routing
  private endpointHealth: Map<string, { failures: number; lastFailure?: Date }> = new Map();

  constructor(network: Network, config: ProverConfig = {}) {
    this.network = network;
    this.timeout = config.timeout ?? DEFAULT_CONFIG.timeout;
    this.retries = config.retries ?? DEFAULT_CONFIG.retries;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_CONFIG.retryDelayMs;
    this.verbose = config.verbose ?? DEFAULT_CONFIG.verbose;

    // Get endpoints from config or use provided overrides
    if (config.endpoints && config.endpoints.length > 0) {
      this.endpoints = config.endpoints;
    } else if (config.apiUrl) {
      // Backwards compatibility: convert single URL to endpoint
      this.endpoints = [{ url: config.apiUrl, priority: 1 }];
    } else {
      // Try to get from config package, fall back to hardcoded
      try {
        const networkId = network === 'mainnet' ? 'mainnet' : 'testnet4';
        this.endpoints = getProverEndpoints(networkId);
      } catch {
        // Config package not available, use fallback
        const urls = FALLBACK_PROVER_URLS[network] || FALLBACK_PROVER_URLS.testnet4;
        this.endpoints = urls.map((url, i) => ({ url, priority: i + 1 }));
      }
    }

    // Initialize endpoint health tracking
    for (const endpoint of this.endpoints) {
      this.endpointHealth.set(endpoint.url, { failures: 0 });
    }

    this.log(`Initialized for ${network} with ${this.endpoints.length} endpoint(s)`);
    if (this.verbose) {
      this.endpoints.forEach((e, i) => this.log(`  Endpoint ${i + 1}: ${e.url}`));
    }
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    console.log(`[ProverService] ${message}`);
  }

  /**
   * Get endpoints sorted by health (healthy endpoints first)
   */
  private getSortedEndpoints(): ProverEndpoint[] {
    return [...this.endpoints].sort((a, b) => {
      const healthA = this.endpointHealth.get(a.url) || { failures: 0 };
      const healthB = this.endpointHealth.get(b.url) || { failures: 0 };

      // Sort by failures first (less failures = better), then by priority
      if (healthA.failures !== healthB.failures) {
        return healthA.failures - healthB.failures;
      }
      return a.priority - b.priority;
    });
  }

  /**
   * Record endpoint failure for health tracking
   */
  private recordFailure(endpointUrl: string): void {
    const health = this.endpointHealth.get(endpointUrl) || { failures: 0 };
    health.failures++;
    health.lastFailure = new Date();
    this.endpointHealth.set(endpointUrl, health);
  }

  /**
   * Record endpoint success (reset failure count)
   */
  private recordSuccess(endpointUrl: string): void {
    this.endpointHealth.set(endpointUrl, { failures: 0 });
  }

  /**
   * Prove a spell and get signed commit/spell transactions
   * Tries multiple endpoints with automatic fallback
   */
  async prove(request: ProveRequest): Promise<ProveResponse> {
    this.validateRequest(request);

    // Build request body with chain parameter
    // Note: chain is 'bitcoin' for both mainnet and testnet4
    // prev_txs must be wrapped as { "bitcoin": "tx_hex" } objects
    const wrappedPrevTxs = request.prev_txs.map(txHex => ({ bitcoin: txHex }));

    // Transform spell inputs: 'utxo' -> 'utxo_id' (API format)
    // Also transform refs (reference inputs) the same way
    const transformedSpell = {
      ...request.spell,
      // Transform refs array if present (reference inputs for protocol state)
      refs: request.spell.refs?.map(ref => ({
        utxo_id: (ref as { utxo?: string; utxo_id?: string }).utxo ||
                 (ref as { utxo?: string; utxo_id?: string }).utxo_id,
        charms: ref.charms || {},
      })),
      ins: request.spell.ins.map(input => ({
        utxo_id: (input as { utxo?: string; utxo_id?: string }).utxo ||
                 (input as { utxo?: string; utxo_id?: string }).utxo_id,
        charms: input.charms || {},
      })),
    };

    const requestBody = {
      spell: transformedSpell,
      binaries: request.binaries,
      prev_txs: wrappedPrevTxs,
      funding_utxo: request.funding_utxo,
      funding_utxo_value: request.funding_utxo_value,
      change_address: request.change_address,
      fee_rate: request.fee_rate,
      chain: 'bitcoin', // Required by Charms API
    };

    this.log(`Network: ${this.network}`);
    this.log(`Funding UTXO: ${request.funding_utxo}`);
    this.log(`Change address: ${request.change_address}`);

    const body = JSON.stringify(requestBody);

    // Debug: Log the spell structure being sent
    console.log('[ProverService] Spell structure:', JSON.stringify(transformedSpell, null, 2));
    console.log('[ProverService] Has refs:', !!transformedSpell.refs, 'refs count:', transformedSpell.refs?.length ?? 0);
    console.log('[ProverService] Inputs count:', transformedSpell.ins?.length ?? 0);
    console.log('[ProverService] Outputs count:', transformedSpell.outs?.length ?? 0);

    const sortedEndpoints = this.getSortedEndpoints();

    let lastError: Error | null = null;

    // Try each endpoint
    for (const endpoint of sortedEndpoints) {
      this.log(`Trying endpoint: ${endpoint.url}`);

      let attempt = 0;
      while (attempt < this.retries) {
        try {
          const response = await this.fetchWithTimeout(endpoint.url, body);

          if (!response.ok) {
            const errorText = await response.text();

            // Don't retry on 4xx errors (client errors) - these are our fault
            if (response.status >= 400 && response.status < 500) {
              throw new ProverError(
                `Prover request failed: ${response.status} ${errorText}`,
                'CLIENT_ERROR',
                response.status
              );
            }

            // 5xx errors - retry or try next endpoint
            throw new ProverError(
              `Prover server error: ${response.status} ${errorText}`,
              'SERVER_ERROR',
              response.status
            );
          }

          const result = await response.json();
          const parsed = this.parseResponse(result);

          // Success! Record it and return
          this.recordSuccess(endpoint.url);
          return parsed;

        } catch (error) {
          lastError = error as Error;

          // Don't retry or try other endpoints on client errors
          if (error instanceof ProverError &&
              (error.code === 'CLIENT_ERROR' ||
               error.code === 'INVALID_RESPONSE' ||
               error.code === 'INVALID_REQUEST')) {
            throw error;
          }

          attempt++;
          if (attempt < this.retries) {
            const delay = RETRY_DELAYS[attempt - 1] || this.retryDelayMs;
            this.log(`Request failed, retrying in ${delay}ms (attempt ${attempt}/${this.retries})`);
            await this.sleep(delay);
          }
        }
      }

      // All retries failed for this endpoint
      this.recordFailure(endpoint.url);
      this.log(`Endpoint ${endpoint.url} failed after ${this.retries} attempts`);
    }

    // All endpoints failed
    const endpointCount = this.endpoints.length;
    throw new ProverError(
      `All ${endpointCount} prover endpoint(s) failed. Last error: ${lastError?.message}`,
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

  private async fetchWithTimeout(url: string, body: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
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
    // Response should be an array of two transactions
    if (!Array.isArray(result) || result.length !== 2) {
      throw new ProverError(
        `Invalid prover response format: expected array of 2 transactions, got ${JSON.stringify(result)}`,
        'INVALID_RESPONSE'
      );
    }

    const [commit, spell] = result;

    // Handle two possible formats:
    // 1. Wrapped objects: [{ bitcoin: "hex" }, { bitcoin: "hex" }]
    // 2. Raw strings: ["hex", "hex"]
    let commitTx: string;
    let spellTx: string;

    if (typeof commit === 'string') {
      // Format 2: Raw strings
      commitTx = commit;
      spellTx = spell as string;
    } else if (typeof commit === 'object' && commit !== null && 'bitcoin' in commit) {
      // Format 1: Wrapped objects (as shown in deploy-spell.sh)
      commitTx = (commit as { bitcoin: string }).bitcoin;
      spellTx = (spell as { bitcoin: string }).bitcoin;
    } else {
      throw new ProverError(
        `Invalid transaction format in prover response: ${JSON.stringify(commit)}`,
        'INVALID_RESPONSE'
      );
    }

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
