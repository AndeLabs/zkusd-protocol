/**
 * Sign Oracle V2 Deployment Transaction
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const TESTNET = bitcoin.networks.testnet;

const privateKeyWif = 'cPcsryL9DZi2HjM1saec7aa8k25RTD2poe7SLph6yJDciCQZUPX7';
const txHex = '0200000001c8b1ff988d0ccbc3ddf0b874dc50dda5a834a18ccfbb28c75bd6653d858f8a750300000000ffffffff0423020000000000001600141aa9f50635832ae98aa07e397aa0b2694175679dc1060000000000001600141db4ded10fa155036bfb40717ea68022be899fbb0000000000000000fd6e036a057370656c6c4d640382a36776657273696f6e09627478a1646f75747381a100a5657072696365a46570726963651b000009184e72a0006f74696d657374616d705f626c6f636b0066736f75726365644d6f636b6a636f6e666964656e63651864686f70657261746f7298200f18ef187218e81828186c0d18d818d518dd1856189e189304183318c3182218330d18331886185018ad18c118aa0a18450218d3185a1718486561646d696e98200f18ef187218e81828186c0d18d818d518dd1856189e189304183318c3182218330d18331886185018ad18c118aa0a18450218d3185a1718486969735f616374697665f5706c6173745f76616c69645f70726963651b000009184e72a000716170705f7075626c69635f696e70757473a183616e98200000000000000000000000000000000000000000000000000000000000000000982018371827182318f0182018b5030a185318f218f40a185f18eb189c189618c818f80f18ad181918ed0a187818b01859181e183618300117185ff699010418a41859184c185913186d18930a18541855187a184b18ab183618f11837183f18fc18de1873185418860a18a9181f18a51855187f184718a805184f1870188e1861189818250c1871187c187418c31848188a1877184518c9184418b31890186e18fa18f218260b18481869185b181b18b218601839182017185618db18c3188d161880184018a418fe1835185b18981318a7187a1835184418cc189e18a00518b70c1848183718c8187b188a185018ba183a18b518b60a181a18b31318bd18a9187318c718d910188218dc18e51718a518ff1824185018f6187418c518c718230f1819187d18611827186718a61881188b18aa18ca1861061880188e1897182e18b618f9183c18a118b518be18ba18bc18ba18e218491838182018fb18eb18ab184b18d21853182a18c10c0e186a18bf187718b11819091841181c186818a518731840185f183018e60e18e918ee186e185c18ad183418c8188718551832182f01184a187c0d18b918a118c6186b1836182218c518c5189718dc18a01832187d181918a201187818410c185c18ce18af18ef18c8182c185118d418db184318f718a218f8061718221831186f18201844186c18df18c418aa18d5182118ba183418fa1876181c18871868184818ce189318db18df18f70318ec18f818ea18fc18d00018a418c018d718d778460800000000001600141aa9f50635832ae98aa07e397aa0b2694175679d00000000';
const inputValue = 546727;

async function main() {
  const keyPair = ECPair.fromWIF(privateKeyWif, TESTNET);
  const publicKey = Buffer.from(keyPair.publicKey);

  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: publicKey,
    network: TESTNET,
  });

  console.log('Signing address:', p2wpkh.address);

  const tx = bitcoin.Transaction.fromHex(txHex);
  const psbt = new bitcoin.Psbt({ network: TESTNET });

  // Add input
  const input = tx.ins[0];
  const txid = Buffer.from(input.hash).reverse().toString('hex');
  psbt.addInput({
    hash: txid,
    index: input.index,
    sequence: input.sequence,
    witnessUtxo: {
      script: p2wpkh.output!,
      value: BigInt(inputValue),
    },
  });

  // Add outputs
  for (const output of tx.outs) {
    psbt.addOutput({
      script: output.script,
      value: BigInt(output.value),
    });
  }

  // Sign
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const signedTx = psbt.extractTransaction();
  console.log('');
  console.log('='.repeat(60));
  console.log('Signed TXID:', signedTx.getId());
  console.log('='.repeat(60));
  console.log('');

  // Broadcast
  console.log('Broadcasting to testnet4...');
  const response = await fetch('https://mempool.space/testnet4/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: signedTx.toHex(),
  });

  if (response.ok) {
    const txid = await response.text();
    console.log('');
    console.log('='.repeat(60));
    console.log('SUCCESS!');
    console.log('='.repeat(60));
    console.log('TXID:', txid);
    console.log('Explorer:', `https://mempool.space/testnet4/tx/${txid}`);
  } else {
    const error = await response.text();
    console.error('Broadcast failed:', error);
  }
}

main().catch(console.error);
