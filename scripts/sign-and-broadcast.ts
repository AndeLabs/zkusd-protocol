#!/usr/bin/env npx ts-node
/**
 * Sign and Broadcast a Charms Spell Transaction
 *
 * Usage:
 *   WALLET_WIF="cXXXX..." npx ts-node scripts/sign-and-broadcast.ts <tx-hex> <input-value>
 *
 * Example:
 *   WALLET_WIF="cXXXX" npx ts-node scripts/sign-and-broadcast.ts "0200000001..." 1031503
 */

import { BitcoinSigner } from './lib/bitcoin-signer';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: WALLET_WIF="..." npx ts-node scripts/sign-and-broadcast.ts <tx-hex> <input-value>');
    console.error('');
    console.error('Arguments:');
    console.error('  tx-hex       - The unsigned transaction hex from charms spell prove');
    console.error('  input-value  - The value of the funding UTXO in satoshis');
    console.error('');
    console.error('Environment:');
    console.error('  WALLET_WIF   - Your wallet private key in WIF format');
    process.exit(1);
  }

  const txHex = args[0];
  const inputValue = parseInt(args[1], 10);

  const walletWif = process.env.WALLET_WIF;
  if (!walletWif) {
    console.error('ERROR: WALLET_WIF environment variable not set');
    console.error('');
    console.error('Set your wallet private key:');
    console.error('  export WALLET_WIF="cXXXXXXX..."');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('  zkUSD - Transaction Signer & Broadcaster');
  console.log('='.repeat(60));
  console.log('');

  // Create signer
  const signer = new BitcoinSigner({ privateKeyWif: walletWif });
  const address = signer.getAddress();

  console.log(`Signing address: ${address}`);
  console.log(`Input value: ${inputValue} sats`);
  console.log('');

  // Sign the transaction
  console.log('Signing transaction...');
  const signedTxHex = signer.signP2wpkhTransaction(txHex, [inputValue]);

  console.log('');
  console.log('Signed transaction hex:');
  console.log(signedTxHex);
  console.log('');

  // Broadcast to mempool.space testnet4
  console.log('Broadcasting to testnet4...');

  const response = await fetch('https://mempool.space/testnet4/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: signedTxHex,
  });

  if (response.ok) {
    const txid = await response.text();
    console.log('');
    console.log('='.repeat(60));
    console.log('  SUCCESS!');
    console.log('='.repeat(60));
    console.log('');
    console.log(`Transaction ID: ${txid}`);
    console.log(`Explorer: https://mempool.space/testnet4/tx/${txid}`);
    console.log('');
  } else {
    const error = await response.text();
    console.error('');
    console.error('='.repeat(60));
    console.error('  BROADCAST FAILED');
    console.error('='.repeat(60));
    console.error('');
    console.error(`Error: ${error}`);
    console.error('');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
