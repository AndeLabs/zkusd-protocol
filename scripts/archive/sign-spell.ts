import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import * as fs from 'fs';

bitcoin.initEccLib(ecc);

const TESTNET4: bitcoin.Network = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'tb',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

const wallet = JSON.parse(fs.readFileSync('/Users/munay/dev/zkUSD/deployments/testnet4/wallet.json', 'utf-8'));
const MEMPOOL = 'https://mempool.space/testnet4/api';

async function main() {
  const spellTxHex = fs.readFileSync('/tmp/zkusd-zkUSD Token-spell-unsigned.hex', 'utf-8').trim();
  const originalTx = bitcoin.Transaction.fromHex(spellTxHex);

  console.log('Original spell TX has', originalTx.ins.length, 'inputs');
  console.log('Input 0 witness length:', originalTx.ins[0].witness.length);
  console.log('Input 1 witness length:', originalTx.ins[1].witness.length);

  if (originalTx.ins[1].witness.length > 0) {
    console.log('Input 1 witness items:', originalTx.ins[1].witness.map(w => w.length + ' bytes'));
  }

  // Get input 0 details (the P2WPKH genesis UTXO that we need to sign)
  const input0Txid = Buffer.from(originalTx.ins[0].hash).reverse().toString('hex');
  const input0Vout = originalTx.ins[0].index;
  console.log(`\nInput 0: ${input0Txid}:${input0Vout}`);

  // Fetch prev tx for input 0
  const resp0 = await fetch(`${MEMPOOL}/tx/${input0Txid}/hex`);
  const prevTx0Hex = await resp0.text();
  const prevTx0 = bitcoin.Transaction.fromHex(prevTx0Hex);
  const prevOutput0 = prevTx0.outs[input0Vout];
  console.log(`Input 0 prev output value: ${prevOutput0.value} sats`);

  // Get input 1 details (the Taproot commit output)
  const input1Txid = Buffer.from(originalTx.ins[1].hash).reverse().toString('hex');
  const input1Vout = originalTx.ins[1].index;
  console.log(`Input 1: ${input1Txid}:${input1Vout}`);

  const resp1 = await fetch(`${MEMPOOL}/tx/${input1Txid}/hex`);
  const prevTx1Hex = await resp1.text();
  const prevTx1 = bitcoin.Transaction.fromHex(prevTx1Hex);
  const prevOutput1 = prevTx1.outs[input1Vout];
  console.log(`Input 1 prev output value: ${prevOutput1.value} sats`);

  // Create PSBT with ALL inputs (for correct sighash calculation)
  const psbt = new bitcoin.Psbt({ network: TESTNET4 });

  // Add input 0 (P2WPKH - we'll sign this)
  psbt.addInput({
    hash: originalTx.ins[0].hash,
    index: originalTx.ins[0].index,
    sequence: originalTx.ins[0].sequence,
    witnessUtxo: {
      script: prevOutput0.script,
      value: BigInt(prevOutput0.value),
    },
  });

  // Add input 1 (Taproot - we won't sign, just for sighash)
  psbt.addInput({
    hash: originalTx.ins[1].hash,
    index: originalTx.ins[1].index,
    sequence: originalTx.ins[1].sequence,
    witnessUtxo: {
      script: prevOutput1.script,
      value: BigInt(prevOutput1.value),
    },
  });

  // Add ALL outputs from original tx (needed for correct sighash calculation)
  for (const output of originalTx.outs) {
    psbt.addOutput({
      script: output.script,
      value: BigInt(output.value),
    });
  }

  // Sign input 0
  const privateKey = Buffer.from(wallet.private_key_hex, 'hex');
  const keyPair = {
    publicKey: Buffer.from(wallet.public_key, 'hex'),
    privateKey,
    sign: (hash: Buffer): Buffer => {
      const sig = ecc.sign(hash, privateKey);
      return Buffer.from(sig);
    },
  };

  psbt.signInput(0, keyPair);
  console.log('Signed input 0');

  // Get the signature from the PSBT
  const partialSig = psbt.data.inputs[0].partialSig;
  if (!partialSig || partialSig.length === 0) {
    throw new Error('No partial signature found');
  }
  const signature = partialSig[0].signature;
  const pubkey = partialSig[0].pubkey;
  console.log('Signature length:', signature.length);
  console.log('Pubkey length:', pubkey.length);

  // Now construct the final transaction with:
  // - Input 0 witness: [signature, pubkey]
  // - Input 1 witness: preserved from original
  const finalTx = originalTx.clone();

  // Set witness for input 0 (P2WPKH: [sig, pubkey])
  finalTx.ins[0].witness = [signature, pubkey];

  // Keep witness for input 1 as-is (Taproot with Charms proof)
  // It should already have the witness data from the prover

  const finalHex = finalTx.toHex();
  console.log('\nFinal TX size:', finalHex.length / 2, 'bytes');
  console.log('Final TX ID:', finalTx.getId());

  fs.writeFileSync('/tmp/zkusd-token-spell-signed.hex', finalHex);
  console.log('Saved to /tmp/zkusd-token-spell-signed.hex');

  // Broadcast
  console.log('\nBroadcasting...');
  const broadcastResp = await fetch(`${MEMPOOL}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: finalHex,
  });

  if (broadcastResp.ok) {
    const txid = await broadcastResp.text();
    console.log('SUCCESS! TXID:', txid);
    console.log('Explorer: https://mempool.space/testnet4/tx/' + txid);
  } else {
    const error = await broadcastResp.text();
    console.log('FAILED:', error);
  }
}

main().catch(console.error);
