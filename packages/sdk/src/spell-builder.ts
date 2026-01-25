// Spell Builder - Generate YAML spells for zkUSD operations

import type { SpellOutput, CharmApp } from '@zkusd/types';
import { hexToBytes } from '@zkusd/utils';

interface SpellInputInternal {
  utxo: string;  // "txid:vout" format
  charms: Record<string, unknown>;
}

interface SpellConfig {
  version: number;
  apps: Record<string, string>;
  publicInputs: Record<string, Record<string, unknown>>;
  privateInputs: Record<string, Record<string, unknown>>;
  ins: SpellInputInternal[];
  outs: SpellOutput[];
}

/**
 * Builder for generating Charms spell YAML files
 */
export class SpellBuilder {
  private config: SpellConfig;

  constructor() {
    this.config = {
      version: 9, // Charms v0.11.1 requires version 9
      apps: {},
      publicInputs: {},
      privateInputs: {},
      ins: [],
      outs: [],
    };
  }

  /**
   * Set spell version
   */
  version(v: number): this {
    this.config.version = v;
    return this;
  }

  /**
   * Add an app reference
   */
  addApp(name: string, app: CharmApp): this {
    this.config.apps[name] = app.appRef;
    return this;
  }

  /**
   * Add public inputs for an app (recorded on-chain)
   */
  addPublicInput(appName: string, inputs: Record<string, unknown>): this {
    this.config.publicInputs[appName] = inputs;
    return this;
  }

  /**
   * Add private inputs for an app (witness data, NOT recorded on-chain)
   */
  addPrivateInput(appName: string, inputs: Record<string, unknown>): this {
    this.config.privateInputs[appName] = inputs;
    return this;
  }

  /**
   * Add an input UTXO
   */
  addInput(utxo: string, charms: Record<string, unknown> = {}): this {
    this.config.ins.push({ utxo, charms });
    return this;
  }

  /**
   * Add an output
   */
  addOutput(address: string, charms: Record<string, unknown> = {}): this {
    this.config.outs.push({ address, charms });
    return this;
  }

  /**
   * Build YAML string
   */
  build(): string {
    const lines: string[] = [];

    // Version
    lines.push(`version: ${this.config.version}`);
    lines.push('');

    // Apps
    if (Object.keys(this.config.apps).length > 0) {
      lines.push('apps:');
      for (const [name, ref] of Object.entries(this.config.apps)) {
        lines.push(`  ${name}: ${ref}`);
      }
      lines.push('');
    }

    // Public inputs (recorded on-chain)
    if (Object.keys(this.config.publicInputs).length > 0) {
      lines.push('public_inputs:');
      for (const [appName, inputs] of Object.entries(this.config.publicInputs)) {
        lines.push(`  ${appName}:`);
        for (const [key, value] of Object.entries(inputs)) {
          lines.push(`    ${key}: ${this.formatValue(value)}`);
        }
      }
      lines.push('');
    }

    // Private inputs (witness data, NOT recorded on-chain)
    if (Object.keys(this.config.privateInputs).length > 0) {
      lines.push('private_inputs:');
      for (const [appName, inputs] of Object.entries(this.config.privateInputs)) {
        lines.push(`  ${appName}:`);
        for (const [key, value] of Object.entries(inputs)) {
          lines.push(`    ${key}: ${this.formatValue(value)}`);
        }
      }
      lines.push('');
    }

    // Inputs
    if (this.config.ins.length > 0) {
      lines.push('ins:');
      for (const input of this.config.ins) {
        lines.push(`  - utxo_id: "${input.utxo}"`);
        lines.push(`    charms: ${this.formatCharms(input.charms)}`);
      }
      lines.push('');
    }

    // Outputs
    if (this.config.outs.length > 0) {
      lines.push('outs:');
      for (const output of this.config.outs) {
        lines.push(`  - address: ${output.address}`);
        if (Object.keys(output.charms).length > 0) {
          lines.push('    charms:');
          for (const [appName, state] of Object.entries(output.charms)) {
            lines.push(`      ${appName}:`);
            this.formatNestedObject(state as Record<string, unknown>, lines, 8);
          }
        } else {
          lines.push('    charms: {}');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a value for YAML
   */
  private formatValue(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.join(', ')}]`;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return String(value);
  }

  /**
   * Format charms object
   */
  private formatCharms(charms: Record<string, unknown>): string {
    if (Object.keys(charms).length === 0) {
      return '{}';
    }
    return JSON.stringify(charms);
  }

  /**
   * Format nested object with proper indentation
   */
  private formatNestedObject(
    obj: Record<string, unknown>,
    lines: string[],
    indent: number
  ): void {
    const prefix = ' '.repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`${prefix}${key}:`);
        this.formatNestedObject(value as Record<string, unknown>, lines, indent + 2);
      } else {
        lines.push(`${prefix}${key}: ${this.formatValue(value)}`);
      }
    }
  }

  /**
   * Create a new builder instance
   */
  static create(): SpellBuilder {
    return new SpellBuilder();
  }
}
