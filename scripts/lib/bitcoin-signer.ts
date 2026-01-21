/**
 * Bitcoin Transaction Signing Utility
 *
 * Signs Bitcoin transactions using the wallet private key.
 * Supports P2WPKH (native SegWit) addresses.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

// Initialize ECC library
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// Testnet4 network (same as testnet3)
const TESTNET = bitcoin.networks.testnet;

export interface SignerConfig {
  privateKeyWif: string;
  network?: bitcoin.Network;
}

export interface PrevOutput {
  txid: string;
  vout: number;
  value: number;
  script?: Buffer;
}

/**
 * Bitcoin Transaction Signer
 */
export class BitcoinSigner {
  private keyPair: ReturnType<typeof ECPair.fromWIF>;
  private network: bitcoin.Network;
  private publicKey: Buffer;

  constructor(config: SignerConfig) {
    this.network = config.network || TESTNET;
    this.keyPair = ECPair.fromWIF(config.privateKeyWif, this.network);
    this.publicKey = Buffer.from(this.keyPair.publicKey);
  }

  /**
   * Get the P2WPKH address for this signer
   */
  getAddress(): string {
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: this.publicKey,
      network: this.network,
    });
    return address!;
  }

  /**
   * Get the public key as hex
   */
  getPublicKeyHex(): string {
    return this.publicKey.toString('hex');
  }

  /**
   * Sign a raw transaction hex
   *
   * @param txHex - The unsigned transaction hex
   * @param prevOutputs - Previous outputs being spent (for value and script)
   * @returns Signed transaction hex
   */
  signTransaction(txHex: string, prevOutputs: PrevOutput[]): string {
    const tx = bitcoin.Transaction.fromHex(txHex);
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Create the P2WPKH script for our address
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: this.publicKey,
      network: this.network,
    });

    // Add inputs from the transaction
    for (let i = 0; i < tx.ins.length; i++) {
      const input = tx.ins[i];
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const vout = input.index;

      // Find the previous output info
      const prevOutput = prevOutputs.find(
        (po) => po.txid === txid && po.vout === vout
      );

      if (prevOutput) {
        // This input belongs to us, add it with witness UTXO
        psbt.addInput({
          hash: txid,
          index: vout,
          sequence: input.sequence,
          witnessUtxo: {
            script: prevOutput.script || p2wpkh.output!,
            value: BigInt(prevOutput.value),
          },
        });
      } else {
        // Not our input, add it as non-witness (will be skipped during signing)
        psbt.addInput({
          hash: txid,
          index: vout,
          sequence: input.sequence,
          nonWitnessUtxo: Buffer.alloc(0), // Placeholder
        });
      }
    }

    // Add outputs from the transaction
    for (const output of tx.outs) {
      psbt.addOutput({
        script: output.script,
        value: BigInt(output.value),
      });
    }

    // Sign all inputs that belong to us
    for (let i = 0; i < tx.ins.length; i++) {
      const input = tx.ins[i];
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const vout = input.index;

      const prevOutput = prevOutputs.find(
        (po) => po.txid === txid && po.vout === vout
      );

      if (prevOutput) {
        try {
          psbt.signInput(i, this.keyPair);
        } catch (e) {
          console.warn(`Could not sign input ${i}: ${e}`);
        }
      }
    }

    // Finalize and extract
    try {
      psbt.finalizeAllInputs();
      return psbt.extractTransaction().toHex();
    } catch (e) {
      // If finalization fails, try to extract what we can
      console.warn(`Finalization warning: ${e}`);

      // Try to finalize each input individually
      for (let i = 0; i < tx.ins.length; i++) {
        try {
          psbt.finalizeInput(i);
        } catch {
          // Skip inputs we couldn't finalize
        }
      }

      return psbt.extractTransaction(true).toHex();
    }
  }

  /**
   * Sign a transaction with simple P2WPKH inputs
   *
   * This is a simpler method when all inputs are P2WPKH belonging to this signer.
   *
   * @param txHex - The unsigned transaction hex
   * @param inputValues - Array of input values in satoshis
   * @returns Signed transaction hex
   */
  signP2wpkhTransaction(txHex: string, inputValues: number[]): string {
    const tx = bitcoin.Transaction.fromHex(txHex);

    if (tx.ins.length !== inputValues.length) {
      throw new Error(
        `Input count mismatch: tx has ${tx.ins.length} inputs but ${inputValues.length} values provided`
      );
    }

    const psbt = new bitcoin.Psbt({ network: this.network });

    // Create the P2WPKH script for our address
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: this.publicKey,
      network: this.network,
    });

    // Add inputs
    for (let i = 0; i < tx.ins.length; i++) {
      const input = tx.ins[i];
      const txid = Buffer.from(input.hash).reverse().toString('hex');

      psbt.addInput({
        hash: txid,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: {
          script: p2wpkh.output!,
          value: BigInt(inputValues[i]),
        },
      });
    }

    // Add outputs
    for (const output of tx.outs) {
      psbt.addOutput({
        script: output.script,
        value: BigInt(output.value),
      });
    }

    // Sign all inputs
    psbt.signAllInputs(this.keyPair);

    // Finalize and extract
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }
}

/**
 * Helper function to decode a transaction and get input txids/vouts
 */
export function decodeTransaction(txHex: string): {
  txid: string;
  inputs: Array<{ txid: string; vout: number }>;
  outputs: Array<{ value: number; address?: string }>;
} {
  const tx = bitcoin.Transaction.fromHex(txHex);
  const txid = tx.getId();

  const inputs = tx.ins.map((input) => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
  }));

  const outputs = tx.outs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(output.script, TESTNET);
    } catch {
      // Not a standard address type
    }
    return {
      value: Number(output.value),
      address,
    };
  });

  return { txid, inputs, outputs };
}

// Export for direct usage
export { bitcoin, ECPair, TESTNET };
