/**
 * Sign Token V5 Deployment Transaction
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const TESTNET = bitcoin.networks.testnet;

const privateKeyWif = 'cPcsryL9DZi2HjM1saec7aa8k25RTD2poe7SLph6yJDciCQZUPX7';
const txHex = '0200000001f9045d8327eccf24d153975674a7c6092ba55085b74e58d792a718cee8e9c6d80500000000ffffffff0423020000000000001600141aa9f50635832ae98aa07e397aa0b2694175679db7060000000000001600141db4ded10fa155036bfb40717ea68022be899fbb0000000000000000fd06036a057370656c6c4dfc0282a36776657273696f6e09627478a1646f75747381a100a36561646d696e98200f18ef187218e81828186c0d18d818d518dd1856189e189304183318c3182218330d18331886185018ad18c118aa0a18450218d3185a17184871617574686f72697a65645f6d696e746572982000000000000000000000000000000000000000000000000000000000000000006c746f74616c5f737570706c7900716170705f7075626c69635f696e70757473a183616e98200000000000000000000000000000000000000000000000000000000000000000982018e11853189718ee186b0018bd183a186118d2182418301886184411186418c51861185f11184a187c189218330918961218521518bb18181873f699010418a41859184c18590a185818ea18b418d51824189018221837189f186f187b187a08189518ff03187e185718bd182018e7188d1308186b187e1824184818ae187304182a18c4182a18d518e41840183d18820f189d1826185b183a184518ee187718bc1849183e184c184b185d184d186b18a6185f18c818cc184018c21837188d182c18a518de1828182918291856182818ec184018f418af18511818182718fd1890185f0f18e018de183218d1189918a11838189118bd185c189618e518c4171833187e18da18d018f918ce18de18af187718f018f2183d18da187018a3185318270a18921418be1847182c1865182318d0189a18cd0518f518e60a18f518e41818185b0018da18a1183c10188e04185118aa189e1897186018d3187c08185e121897187918991834181c18fc18af18b718cd188910188118bc18b3183618f91884186718a918e118eb185a18d318fe18ce18d018c418c718c1183a121856187c18eb185a186118f7184618e0182818ed18a41218c51819188a183e18aa1867184718c51834181f188618fa18781823183b18c71830183e18b418d518ec1833185917188f184a0b18a1186509187a0618261898183d18981304181a18c8187418e4184b183718e314187d1859189f186b0018f618cd182a184c18180818201874184318c715185efaac0f00000000001600141aa9f50635832ae98aa07e397aa0b2694175679d00000000';
const inputValue = 1031503;

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
  console.log('Signed TX hex:');
  console.log(signedTx.toHex());
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
