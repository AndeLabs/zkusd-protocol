/**
 * Deployment Verifier Service
 *
 * Validates that local config matches on-chain deployment state.
 * Catches VK mismatches, spent UTXOs, and sync issues BEFORE proving.
 *
 * Usage:
 *   const verifier = new DeploymentVerifier(network);
 *   const result = await verifier.verifyAll();
 *   if (!result.valid) {
 *     console.error('Deployment issues:', result.issues);
 *   }
 */

import type { Network } from '@zkusd/types';

// ============================================================================
// Types
// ============================================================================

export interface ContractVerification {
  name: string;
  appId: string;
  configVk: string;
  deployedVk?: string;
  stateUtxo: string;
  utxoStatus: 'confirmed' | 'unconfirmed' | 'spent' | 'not_found' | 'error';
  vkMatch: boolean;
  issues: string[];
}

export interface DeploymentVerification {
  network: Network;
  timestamp: Date;
  valid: boolean;
  contracts: ContractVerification[];
  issues: string[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    vkMismatches: number;
    utxoIssues: number;
  };
}

export interface VerifierConfig {
  explorerApiUrl: string;
  contracts: Record<string, {
    appId: string;
    vk: string;
    stateUtxo: string;
  }>;
}

// ============================================================================
// Deployment Verifier
// ============================================================================

export class DeploymentVerifier {
  private network: Network;
  private config: VerifierConfig;

  constructor(network: Network, config: VerifierConfig) {
    this.network = network;
    this.config = config;
  }

  /**
   * Verify all contracts in the deployment
   */
  async verifyAll(): Promise<DeploymentVerification> {
    const contracts: ContractVerification[] = [];
    const issues: string[] = [];

    for (const [name, contract] of Object.entries(this.config.contracts)) {
      const verification = await this.verifyContract(name, contract);
      contracts.push(verification);

      if (verification.issues.length > 0) {
        issues.push(...verification.issues.map(i => `[${name}] ${i}`));
      }
    }

    const summary = {
      total: contracts.length,
      valid: contracts.filter(c => c.issues.length === 0).length,
      invalid: contracts.filter(c => c.issues.length > 0).length,
      vkMismatches: contracts.filter(c => !c.vkMatch).length,
      utxoIssues: contracts.filter(c =>
        c.utxoStatus !== 'confirmed'
      ).length,
    };

    return {
      network: this.network,
      timestamp: new Date(),
      valid: issues.length === 0,
      contracts,
      issues,
      summary,
    };
  }

  /**
   * Verify a single contract
   */
  async verifyContract(
    name: string,
    contract: { appId: string; vk: string; stateUtxo: string }
  ): Promise<ContractVerification> {
    const issues: string[] = [];

    // Parse UTXO ID
    const [txid, voutStr] = contract.stateUtxo.split(':');
    const vout = parseInt(voutStr, 10);

    // Check UTXO status on chain
    let utxoStatus: ContractVerification['utxoStatus'] = 'error';
    let deployedVk: string | undefined;

    try {
      const txInfo = await this.fetchTransaction(txid);

      if (!txInfo) {
        utxoStatus = 'not_found';
        issues.push(`State UTXO transaction not found: ${txid}`);
      } else if (!txInfo.status?.confirmed) {
        utxoStatus = 'unconfirmed';
        issues.push(`State UTXO not confirmed yet`);
      } else {
        // Check if UTXO is spent
        const utxoInfo = await this.fetchUtxo(txid, vout);
        if (utxoInfo?.spent) {
          utxoStatus = 'spent';
          issues.push(`State UTXO has been spent! Tx: ${utxoInfo.spentBy}`);
        } else {
          utxoStatus = 'confirmed';
        }

        // Extract deployed VK from transaction witness
        deployedVk = this.extractVkFromTx(txInfo, vout);
      }
    } catch (error) {
      issues.push(`Error checking UTXO: ${error}`);
    }

    // Compare VKs
    const vkMatch = deployedVk === contract.vk;
    if (deployedVk && !vkMatch) {
      issues.push(
        `VK MISMATCH!\n` +
        `  Config VK:   ${contract.vk}\n` +
        `  Deployed VK: ${deployedVk}\n` +
        `  Action: Update config or redeploy contract`
      );
    }

    return {
      name,
      appId: contract.appId,
      configVk: contract.vk,
      deployedVk,
      stateUtxo: contract.stateUtxo,
      utxoStatus,
      vkMatch,
      issues,
    };
  }

  /**
   * Quick check - just verify VKs match without full validation
   */
  async quickCheck(): Promise<{ valid: boolean; mismatches: string[] }> {
    const mismatches: string[] = [];

    for (const [name, contract] of Object.entries(this.config.contracts)) {
      const [txid, voutStr] = contract.stateUtxo.split(':');
      const vout = parseInt(voutStr, 10);

      try {
        const txInfo = await this.fetchTransaction(txid);
        if (txInfo) {
          const deployedVk = this.extractVkFromTx(txInfo, vout);
          if (deployedVk && deployedVk !== contract.vk) {
            mismatches.push(
              `${name}: config=${contract.vk.slice(0, 8)}... deployed=${deployedVk.slice(0, 8)}...`
            );
          }
        }
      } catch {
        // Ignore errors in quick check
      }
    }

    return {
      valid: mismatches.length === 0,
      mismatches,
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async fetchTransaction(txid: string): Promise<TransactionInfo | null> {
    try {
      const response = await fetch(
        `${this.config.explorerApiUrl}/tx/${txid}`
      );
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  private async fetchUtxo(txid: string, vout: number): Promise<UtxoInfo | null> {
    try {
      const response = await fetch(
        `${this.config.explorerApiUrl}/tx/${txid}/outspend/${vout}`
      );
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Extract VK from transaction witness data
   *
   * Charms spells encode the VK in the witness script.
   * Format: OP_0 OP_IF "spell" <cbor_data> OP_ENDIF <vk> OP_CHECKSIG
   */
  private extractVkFromTx(tx: TransactionInfo, vout: number): string | undefined {
    // Look for taproot input with spell witness
    for (const vin of tx.vin) {
      if (vin.witness && vin.witness.length >= 2) {
        // The VK is typically the last 32-byte value before OP_CHECKSIG
        // In the control block or as the internal key
        const lastWitness = vin.witness[vin.witness.length - 1];
        if (lastWitness && lastWitness.length === 64) {
          // This might be the internal key (contains VK info)
          return lastWitness;
        }

        // Also check the script itself for VK
        const script = vin.inner_witnessscript_asm;
        if (script) {
          // VK appears after OP_ENDIF as 32-byte push
          const match = script.match(/OP_ENDIF OP_PUSHBYTES_32 ([a-f0-9]{64})/);
          if (match) {
            return match[1];
          }
        }
      }
    }
    return undefined;
  }
}

// ============================================================================
// Helper Types
// ============================================================================

interface TransactionInfo {
  txid: string;
  status?: {
    confirmed: boolean;
    block_height?: number;
  };
  vin: Array<{
    witness?: string[];
    inner_witnessscript_asm?: string;
  }>;
  vout: Array<{
    value: number;
    scriptpubkey: string;
  }>;
}

interface UtxoInfo {
  spent: boolean;
  spentBy?: string;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a deployment verifier from network config
 */
export function createVerifier(
  network: Network,
  explorerApiUrl: string,
  contracts: Record<string, { appId: string; vk: string; stateUtxo: string }>
): DeploymentVerifier {
  return new DeploymentVerifier(network, {
    explorerApiUrl,
    contracts,
  });
}
