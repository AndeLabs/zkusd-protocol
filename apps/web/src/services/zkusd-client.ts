// zkUSD Client Service for Web App
// Wraps the SDK client for use in React components
//
// IMPORTANT: Charms Prover Availability
// - Public prover (v8.charms.dev) only supports MAINNET ("bitcoin" chain)
// - For testnet4, you need to run a local Charms server: `charms server`
// - Demo mode simulates transactions without actual proving
//

import { getNetworkConfig, type NetworkId } from '@zkusd/config';

export interface VaultParams {
  collateralSats: number;
  debtZkusd: number;
  ownerAddress: string;
  ownerPubkey: string;
}

export interface SpellResult {
  commitTxHex: string;
  spellTxHex: string;
  psbt?: string;
  fee: number;
}

// Charms API request format (discovered through testing)
interface CharmsProveRequest {
  spell: CharmsSpell;
  binaries: Record<string, string>; // app_id -> wasm binary (base64 or hex)
  prev_txs: string[]; // Previous transactions (hex)
  funding_utxo: string; // Format: "txid:vout" (64 hex chars : number)
  funding_utxo_value: number; // Value in satoshis
  change_address: string; // Bitcoin address for change
  fee_rate: number; // Satoshis per vbyte
  chain: 'bitcoin' | 'cardano'; // Only mainnet supported by public prover
}

interface CharmsSpell {
  version: number; // Must match prover version (8 for v8.charms.dev)
  apps: Record<string, string>; // $00 -> "n/app_id/vk" or "t/app_id/vk"
  private_inputs?: Record<string, unknown>;
  ins: CharmsInput[];
  outs: CharmsOutput[];
}

interface CharmsInput {
  utxo_id: string;
  charms: Record<string, unknown>;
}

interface CharmsOutput {
  address: string;
  charms: Record<string, unknown>;
}

interface CharmsProveResponse {
  commit_tx: string;
  spell_tx: string;
}

/**
 * Create a zkUSD client for the web app
 * This is a lightweight wrapper that communicates with the prover API
 */
export function createZkUsdClient(networkId: NetworkId) {
  const config = getNetworkConfig(networkId);

  // Determine if we're in demo mode (testnet4 without local prover)
  const isDemoMode = networkId === 'testnet4' && !process.env.NEXT_PUBLIC_PROVER_URL;

  return {
    networkId,
    config,
    isDemoMode,

    /**
     * Get API base URL for the prover service
     * - Mainnet: Uses public Charms prover (v8.charms.dev)
     * - Testnet4: Requires local prover or demo mode
     */
    getProverUrl(): string {
      // Allow override via environment variable
      if (process.env.NEXT_PUBLIC_PROVER_URL) {
        return process.env.NEXT_PUBLIC_PROVER_URL;
      }

      // Public Charms prover (only supports mainnet)
      // Same as BRO Token uses: https://v8.charms.dev/spells/prove
      if (networkId === 'mainnet') {
        return 'https://v8.charms.dev/spells';
      }

      // For testnet4, default to local prover
      // Run `charms server` to start local prover on port 17784
      return 'http://localhost:17784/spells';
    },

    /**
     * Get the chain parameter for the Charms API
     */
    getChainParam(): 'bitcoin' | 'cardano' {
      // Public prover only supports bitcoin mainnet
      // For testnet4, we use the same chain param but need local prover
      return 'bitcoin';
    },

    /**
     * Build an Open Vault spell
     */
    async buildOpenVaultSpell(params: VaultParams & {
      fundingUtxo: string;
      fundingValue: number;
    }): Promise<SpellResult> {
      const spell = buildOpenVaultSpell({
        vaultManagerAppId: config.contracts.vaultManager.appId,
        vaultManagerVk: config.contracts.vaultManager.vk,
        zkusdAppId: config.contracts.zkusdToken.appId,
        zkusdVk: config.contracts.zkusdToken.vk,
        fundingUtxo: params.fundingUtxo,
        ownerAddress: params.ownerAddress,
        ownerPubkey: params.ownerPubkey,
        collateralSats: params.collateralSats,
        debtAmount: params.debtZkusd,
      });

      // If in demo mode, return simulated result
      if (isDemoMode) {
        return this.simulateSpellResult(spell, params.fundingUtxo);
      }

      // Otherwise, submit to prover
      return this.proveSpell(spell, {
        fundingUtxo: params.fundingUtxo,
        fundingValue: params.fundingValue,
        changeAddress: params.ownerAddress,
      });
    },

    /**
     * Build an Adjust Vault spell
     */
    async buildAdjustVaultSpell(params: {
      vaultUtxo: string;
      currentCollateral: number;
      currentDebt: number;
      collateralDelta: number;
      debtDelta: number;
      ownerAddress: string;
    }): Promise<SpellResult> {
      const spell = buildAdjustVaultSpell({
        vaultManagerAppId: config.contracts.vaultManager.appId,
        vaultManagerVk: config.contracts.vaultManager.vk,
        zkusdAppId: config.contracts.zkusdToken.appId,
        zkusdVk: config.contracts.zkusdToken.vk,
        vaultUtxo: params.vaultUtxo,
        oldCollateral: params.currentCollateral,
        oldDebt: params.currentDebt,
        newCollateral: params.currentCollateral + params.collateralDelta,
        newDebt: params.currentDebt + params.debtDelta,
        ownerAddress: params.ownerAddress,
      });

      if (isDemoMode) {
        return this.simulateSpellResult(spell, params.vaultUtxo);
      }

      return this.proveSpell(spell, {
        fundingUtxo: params.vaultUtxo,
        fundingValue: params.currentCollateral + 10000, // Buffer for fees
        changeAddress: params.ownerAddress,
      });
    },

    /**
     * Build a Close Vault spell
     */
    async buildCloseVaultSpell(params: {
      vaultUtxo: string;
      currentCollateral: number;
      currentDebt: number;
      ownerAddress: string;
      zkusdUtxo: string;
    }): Promise<SpellResult> {
      const spell = buildCloseVaultSpell({
        vaultManagerAppId: config.contracts.vaultManager.appId,
        vaultManagerVk: config.contracts.vaultManager.vk,
        zkusdAppId: config.contracts.zkusdToken.appId,
        zkusdVk: config.contracts.zkusdToken.vk,
        vaultUtxo: params.vaultUtxo,
        collateral: params.currentCollateral,
        debt: params.currentDebt,
        ownerAddress: params.ownerAddress,
        zkusdUtxo: params.zkusdUtxo,
      });

      if (isDemoMode) {
        return this.simulateSpellResult(spell, params.vaultUtxo);
      }

      return this.proveSpell(spell, {
        fundingUtxo: params.vaultUtxo,
        fundingValue: params.currentCollateral,
        changeAddress: params.ownerAddress,
      });
    },

    /**
     * Submit a spell to the prover and get signed transactions
     * Uses the Charms v8 API format
     */
    async proveSpell(
      spell: CharmsSpell,
      options: {
        fundingUtxo: string;
        fundingValue: number;
        changeAddress: string;
        feeRate?: number;
      }
    ): Promise<SpellResult> {
      const proverUrl = this.getProverUrl();

      const request: CharmsProveRequest = {
        spell,
        binaries: {}, // Binaries are registered on-chain, not needed for proving
        prev_txs: [], // Previous transactions if needed for verification
        funding_utxo: options.fundingUtxo,
        funding_utxo_value: options.fundingValue,
        change_address: options.changeAddress,
        fee_rate: options.feeRate || 10,
        chain: this.getChainParam(),
      };

      const response = await fetch(`${proverUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Prover error: ${error}`);
      }

      const result: CharmsProveResponse = await response.json();

      return {
        commitTxHex: result.commit_tx,
        spellTxHex: result.spell_tx,
        fee: this.estimateFee(options.feeRate || 10),
      };
    },

    /**
     * Simulate a spell result for demo mode
     * Creates fake transaction IDs that look realistic
     */
    simulateSpellResult(spell: CharmsSpell, seedUtxo: string): SpellResult {
      // Generate deterministic fake txids based on spell content
      const spellHash = simpleHash(JSON.stringify(spell) + seedUtxo);
      const commitTxId = spellHash.toString(16).padStart(64, '0');
      const spellTxId = simpleHash(commitTxId).toString(16).padStart(64, '0');

      console.warn('[DEMO MODE] Simulating spell result - not real transactions');

      return {
        commitTxHex: `0200000001${commitTxId.slice(0, 32)}...demo...`,
        spellTxHex: `0200000001${spellTxId.slice(0, 32)}...demo...`,
        psbt: btoa(JSON.stringify(spell)),
        fee: 500,
      };
    },

    /**
     * Estimate transaction fee
     */
    estimateFee(feeRate: number): number {
      // Typical Charms spell tx is ~250 vbytes
      const estimatedVbytes = 250;
      return estimatedVbytes * feeRate;
    },

    /**
     * Broadcast a transaction to the network
     */
    async broadcast(txHex: string): Promise<string> {
      // Don't broadcast demo transactions
      if (txHex.includes('...demo...')) {
        console.warn('[DEMO MODE] Skipping broadcast - not a real transaction');
        // Return a fake txid
        return simpleHash(txHex).toString(16).padStart(64, '0');
      }

      const response = await fetch(`${config.explorerApiUrl}/tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: txHex,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Broadcast error: ${error}`);
      }

      const txid = await response.text();
      return txid;
    },

    /**
     * Get transaction URL
     */
    getTxUrl(txid: string): string {
      return `${config.explorerUrl}/tx/${txid}`;
    },
  };
}

// ============================================================================
// Spell Builders - Create CharmsSpell objects
// ============================================================================

function buildOpenVaultSpell(params: {
  vaultManagerAppId: string;
  vaultManagerVk: string;
  zkusdAppId: string;
  zkusdVk: string;
  fundingUtxo: string;
  ownerAddress: string;
  ownerPubkey: string;
  collateralSats: number;
  debtAmount: number;
}): CharmsSpell {
  const vaultId = generateVaultId(params.fundingUtxo);

  return {
    version: 8,
    apps: {
      $00: `n/${params.vaultManagerAppId}/${params.vaultManagerVk}`,
      $01: `t/${params.zkusdAppId}/${params.zkusdVk}`,
    },
    private_inputs: {
      $00: params.fundingUtxo,
    },
    ins: [
      {
        utxo_id: params.fundingUtxo,
        charms: {},
      },
    ],
    outs: [
      {
        address: params.ownerAddress,
        charms: {
          $00: {
            id: vaultId,
            owner: params.ownerPubkey,
            collateral: params.collateralSats,
            debt: params.debtAmount,
            created_at: 0,
            last_updated: 0,
            status: 0,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
          },
        },
      },
      {
        address: params.ownerAddress,
        charms: {
          $01: params.debtAmount,
        },
      },
      {
        address: params.ownerAddress,
        charms: {},
      },
    ],
  };
}

function buildAdjustVaultSpell(params: {
  vaultManagerAppId: string;
  vaultManagerVk: string;
  zkusdAppId: string;
  zkusdVk: string;
  vaultUtxo: string;
  oldCollateral: number;
  oldDebt: number;
  newCollateral: number;
  newDebt: number;
  ownerAddress: string;
}): CharmsSpell {
  return {
    version: 8,
    apps: {
      $00: `n/${params.vaultManagerAppId}/${params.vaultManagerVk}`,
      $01: `t/${params.zkusdAppId}/${params.zkusdVk}`,
    },
    ins: [
      {
        utxo_id: params.vaultUtxo,
        charms: {
          $00: {
            collateral: params.oldCollateral,
            debt: params.oldDebt,
          },
        },
      },
    ],
    outs: [
      {
        address: params.ownerAddress,
        charms: {
          $00: {
            collateral: params.newCollateral,
            debt: params.newDebt,
          },
        },
      },
      {
        address: params.ownerAddress,
        charms: {},
      },
    ],
  };
}

function buildCloseVaultSpell(params: {
  vaultManagerAppId: string;
  vaultManagerVk: string;
  zkusdAppId: string;
  zkusdVk: string;
  vaultUtxo: string;
  collateral: number;
  debt: number;
  ownerAddress: string;
  zkusdUtxo: string;
}): CharmsSpell {
  return {
    version: 8,
    apps: {
      $00: `n/${params.vaultManagerAppId}/${params.vaultManagerVk}`,
      $01: `t/${params.zkusdAppId}/${params.zkusdVk}`,
    },
    ins: [
      {
        utxo_id: params.vaultUtxo,
        charms: {
          $00: {
            collateral: params.collateral,
            debt: params.debt,
          },
        },
      },
      {
        utxo_id: params.zkusdUtxo,
        charms: {
          $01: params.debt,
        },
      },
    ],
    outs: [
      {
        address: params.ownerAddress,
        charms: {},
      },
    ],
  };
}

/**
 * Generate a deterministic vault ID from the funding UTXO
 */
function generateVaultId(fundingUtxo: string): string {
  const hash = simpleHash(`vault:${fundingUtxo}`);
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * Simple hash function for deterministic ID generation
 */
function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// ============================================================================
// Singleton instance
// ============================================================================

let clientInstance: ReturnType<typeof createZkUsdClient> | null = null;

export function getZkUsdClient(networkId: NetworkId = 'testnet4') {
  if (!clientInstance || clientInstance.networkId !== networkId) {
    clientInstance = createZkUsdClient(networkId);
  }
  return clientInstance;
}

// ============================================================================
// Type exports for external use
// ============================================================================

export type { CharmsSpell, CharmsInput, CharmsOutput, CharmsProveRequest };
