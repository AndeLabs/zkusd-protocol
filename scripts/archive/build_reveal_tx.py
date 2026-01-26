#!/usr/bin/env python3
"""
Build the reveal transaction with new funding UTXO.

The commit transaction is already in mempool. We need to create a reveal tx that:
1. Spends a NEW funding UTXO (we sign this)
2. Spends the commit output (use existing witness - SIGHASH_ANYONECANPAY makes it valid)
3. Has the EXACT same outputs as the original (required by SIGHASH_ALL)
"""

import sys
import hashlib
import json
import subprocess

# Commit transaction details
COMMIT_TXID = "8339c04480269fdae4114a25f250af4279fb604aeedfd7a048ae6d7d18beca1a"
COMMIT_VALUE = 499778  # sats

# Original witness for commit output spend (SIGHASH_ALL | ANYONECANPAY)
COMMIT_WITNESS = [
    # Signature (65 bytes with sighash flag)
    "d2a409dd957cf4a8062246f8d4bdd28e0af3aec0ebdd814305edce76c013926799e6c77faa2cfc324fabc5b8e0519562d72f67a6e06b78c2066dbeaf786c226e81",
    # Spell script
    "0063057370656c6c4d080282a36776657273696f6e08627478a1646f75747381a100a5657072696365a46570726963651b000009184e72a0006f74696d657374616d705f626c6f636b0066736f75726365644d6f636b6a636f6e666964656e63651864686f70657261746f72982018d5184f18a8183118ac18191857184c18550318f118cb18d5051893184a0b18ab183c18ee0000000000000000000000006561646d696e982018d5184f18a8183118ac18191857184c18550318f118cb18d5051893184a0b18ab183c18ee0000000000000000000000006969735f616374697665f5706c6173745f76616c69645f70726963651b000009184e72a000716170705f7075626c69635f696e70757473a183616e98201860186f18b418c518450d185e18ac0718b3161866184d18281888189118c818281318a718e50418f518a418a81869051829188818f50418a9982018b4184d18b0187a18c1186918770418ea1871187018f418e8185718c50c1845184518f018de0018df18cc111883185d18c618ef18b018c2187c1832f699010418a41859184c18590618a218e818fb18f718c018fe18b1183a18f418c418d818f918fe1823184f1846185918c0185c1894189018b118fa183018da18731018e11898184906182d18ca188718d7184818ea18b5189318c80018ca18371718d71889188e1886182c18801825181f185104184e189a18890418290b18db18eb18d50418674d6601182318e61898186308186b18bb184418da17181d186418a9188b18da186818d318b2187a1831182018ab18801885187d04185418c11876189f18221854181d1418f9182518be18c818d918fb18c41823181e188218b418c51819189a1827188c18e6187c188b18fb187a181f187a18a518ba1856189518921822189b188c18ac182d18211870187d187a18f3186009188c0518ef185a18b718b218af18a2183d18a418b718f418cb18f20c0a18bc1852188c18e7181a18e609185118d018a518c1187118b11888183918f918c91888181f18e218ab182e18f4186c11070a18e918341894189a1828010b182110181c188e0718621821188e185318ca0118e5189318ea18d7182218ba18a918ac18a9183d1820181a18d518a0185018a518a4188918641835182318aa18680318c8187c18d7184c18e617186118b20518b1183b18eb1885189218e018c0182718d5188e0918d3183b189b18c0185218a30f18bf184918a21824682098e5298e257914893c03b53478aa43df025def11e6a6820a114427d0f9c2e5c5ac",
    # Control block
    "c098e5298e257914893c03b53478aa43df025def11e6a6820a114427d0f9c2e5c5"
]

# Required outputs (cannot change - SIGHASH_ALL)
OUTPUTS = [
    {"address": "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq", "value": 547},      # charm NFT
    {"address": "tb1qrk6da5g0592sx6lmgpchaf5qy2lgn8am7cuf3a", "value": 1434},     # protocol
    {"address": "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq", "value": 996853},   # change
]
TOTAL_OUTPUTS = sum(o["value"] for o in OUTPUTS)

# Our wallet
WALLET_ADDRESS = "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
WALLET_PRIVKEY_WIF = "cPcsryL9DZi2HjM1saec7aa8k25RTD2poe7SLph6yJDciCQZUPX7"
WALLET_PUBKEY = "035931eede5d66e1f329f9e9e1dbbb40c69b03071e4961418c6aa99383fcf2f283"
WALLET_SCRIPTHASH = "00141aa9f50635832ae98aa07e397aa0b2694175679d"


def reverse_txid(txid):
    """Reverse txid bytes for transaction serialization."""
    return bytes.fromhex(txid)[::-1].hex()


def encode_varint(n):
    """Encode an integer as a Bitcoin varint."""
    if n < 0xfd:
        return bytes([n])
    elif n <= 0xffff:
        return b'\xfd' + n.to_bytes(2, 'little')
    elif n <= 0xffffffff:
        return b'\xfe' + n.to_bytes(4, 'little')
    else:
        return b'\xff' + n.to_bytes(8, 'little')


def encode_witness_element(data_hex):
    """Encode a witness element with its length prefix."""
    data = bytes.fromhex(data_hex)
    return encode_varint(len(data)) + data


def build_transaction(funding_txid, funding_vout, funding_value, funding_witness_hex):
    """
    Build the reveal transaction.

    Args:
        funding_txid: TXID of the new funding UTXO
        funding_vout: Output index of the funding UTXO
        funding_value: Value in sats
        funding_witness_hex: Signed witness for the funding input
    """
    # Check funds
    total_in = funding_value + COMMIT_VALUE
    if total_in < TOTAL_OUTPUTS:
        raise ValueError(f"Insufficient funds: {total_in} < {TOTAL_OUTPUTS}")

    tx = bytearray()

    # Version (4 bytes, little-endian)
    tx.extend((2).to_bytes(4, 'little'))

    # Marker and flag for segwit
    tx.extend(b'\x00\x01')

    # Input count
    tx.extend(encode_varint(2))

    # Input 0: Funding UTXO
    tx.extend(bytes.fromhex(reverse_txid(funding_txid)))  # txid (reversed)
    tx.extend(funding_vout.to_bytes(4, 'little'))         # vout
    tx.extend(b'\x00')                                     # scriptSig length (0 for segwit)
    tx.extend(b'\xff\xff\xff\xff')                         # sequence

    # Input 1: Commit output
    tx.extend(bytes.fromhex(reverse_txid(COMMIT_TXID)))   # txid (reversed)
    tx.extend((0).to_bytes(4, 'little'))                   # vout
    tx.extend(b'\x00')                                     # scriptSig length (0 for segwit)
    tx.extend(b'\xff\xff\xff\xff')                         # sequence

    # Output count
    tx.extend(encode_varint(len(OUTPUTS)))

    # Outputs
    for out in OUTPUTS:
        tx.extend(out["value"].to_bytes(8, 'little'))     # value
        script = bytes.fromhex(address_to_scriptpubkey(out["address"]))
        tx.extend(encode_varint(len(script)))
        tx.extend(script)

    # Witness for input 0 (funding - P2WPKH)
    funding_witness = bytes.fromhex(funding_witness_hex)
    tx.extend(funding_witness)

    # Witness for input 1 (commit - taproot script path)
    tx.extend(encode_varint(3))  # 3 witness elements
    for elem in COMMIT_WITNESS:
        tx.extend(encode_witness_element(elem))

    # Locktime (4 bytes)
    tx.extend((0).to_bytes(4, 'little'))

    return tx.hex()


def address_to_scriptpubkey(address):
    """Convert a bech32 address to scriptPubKey hex."""
    # For tb1q... (P2WPKH)
    if address.startswith("tb1q"):
        # Use bitcoin-cli to decode
        result = subprocess.run(
            ["bitcoin-cli", "-testnet4", "validateaddress", address],
            capture_output=True, text=True
        )
        data = json.loads(result.stdout)
        return data.get("scriptPubKey", "")
    return ""


def sign_funding_input(funding_txid, funding_vout, funding_value):
    """Sign the funding input using bitcoin-cli."""
    # Create unsigned tx first
    tx_hex = subprocess.run(
        ["bitcoin-cli", "-testnet4", "createrawtransaction",
         json.dumps([
             {"txid": funding_txid, "vout": funding_vout},
             {"txid": COMMIT_TXID, "vout": 0}
         ]),
         json.dumps([
             {OUTPUTS[0]["address"]: OUTPUTS[0]["value"] / 100_000_000},
             {OUTPUTS[1]["address"]: OUTPUTS[1]["value"] / 100_000_000},
             {OUTPUTS[2]["address"]: OUTPUTS[2]["value"] / 100_000_000},
         ])],
        capture_output=True, text=True
    ).stdout.strip()

    print(f"Unsigned tx: {tx_hex}")

    # Sign with our key (only signs the funding input since commit is taproot)
    sign_result = subprocess.run(
        ["bitcoin-cli", "-testnet4", "signrawtransactionwithkey",
         tx_hex,
         json.dumps([WALLET_PRIVKEY_WIF]),
         json.dumps([{
             "txid": funding_txid,
             "vout": funding_vout,
             "scriptPubKey": WALLET_SCRIPTHASH,
             "amount": funding_value / 100_000_000
         }])],
        capture_output=True, text=True
    )

    result = json.loads(sign_result.stdout)
    return result.get("hex", ""), result.get("complete", False)


def main():
    if len(sys.argv) < 3:
        print("Usage: python build_reveal_tx.py <funding_txid:vout> <value_sats>")
        print("")
        print(f"The commit tx ({COMMIT_TXID}) is in mempool.")
        print(f"You need a new funding UTXO with at least {TOTAL_OUTPUTS - COMMIT_VALUE} sats.")
        print("")
        print("Get testnet4 coins from: https://faucet.testnet4.dev/")
        print(f"Address: {WALLET_ADDRESS}")
        sys.exit(1)

    # Parse arguments
    utxo = sys.argv[1]
    value = int(sys.argv[2])

    txid, vout = utxo.rsplit(":", 1)
    vout = int(vout)

    print(f"Funding UTXO: {txid}:{vout}")
    print(f"Funding value: {value} sats")
    print(f"Commit UTXO: {COMMIT_TXID}:0")
    print(f"Commit value: {COMMIT_VALUE} sats")
    print(f"Total inputs: {value + COMMIT_VALUE} sats")
    print(f"Total outputs: {TOTAL_OUTPUTS} sats")
    print(f"Fee: {value + COMMIT_VALUE - TOTAL_OUTPUTS} sats")
    print("")

    # Check funds
    if value + COMMIT_VALUE < TOTAL_OUTPUTS:
        print(f"ERROR: Insufficient funds!")
        print(f"Need at least {TOTAL_OUTPUTS - COMMIT_VALUE} more sats")
        sys.exit(1)

    # Sign the funding input
    print("Signing funding input...")
    signed_hex, complete = sign_funding_input(txid, vout, value)

    if not signed_hex:
        print("ERROR: Failed to sign transaction")
        sys.exit(1)

    print(f"Partial signed tx: {signed_hex[:100]}...")
    print("")

    # Now we need to add the commit witness
    # The signed tx has empty witness for input 1, we need to inject our witness
    print("Injecting commit witness...")

    # Decode the signed tx to get the structure
    decode_result = subprocess.run(
        ["bitcoin-cli", "-testnet4", "decoderawtransaction", signed_hex],
        capture_output=True, text=True
    )
    decoded = json.loads(decode_result.stdout)

    # Extract funding witness
    funding_witness = decoded["vin"][0].get("txinwitness", [])
    print(f"Funding witness elements: {len(funding_witness)}")

    # Build final tx with both witnesses
    # The structure is: version(4) + marker(1) + flag(1) + inputs + outputs + witness + locktime(4)

    # Parse signed tx to find witness location
    tx_bytes = bytes.fromhex(signed_hex)

    # We need to rebuild with correct witnesses
    # Simpler approach: manually construct the full tx

    final_tx = bytearray()

    # Version
    final_tx.extend(tx_bytes[0:4])

    # Marker + Flag
    final_tx.extend(b'\x00\x01')

    # Inputs (2)
    final_tx.extend(b'\x02')

    # Input 0: Funding
    final_tx.extend(bytes.fromhex(reverse_txid(txid)))
    final_tx.extend(vout.to_bytes(4, 'little'))
    final_tx.extend(b'\x00')  # empty scriptSig
    final_tx.extend(b'\xff\xff\xff\xff')  # sequence

    # Input 1: Commit
    final_tx.extend(bytes.fromhex(reverse_txid(COMMIT_TXID)))
    final_tx.extend((0).to_bytes(4, 'little'))
    final_tx.extend(b'\x00')
    final_tx.extend(b'\xff\xff\xff\xff')

    # Outputs (3)
    final_tx.extend(b'\x03')

    for out in OUTPUTS:
        final_tx.extend(out["value"].to_bytes(8, 'little'))
        # Get scriptPubKey
        if out["address"] == "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq":
            script = bytes.fromhex("00141aa9f50635832ae98aa07e397aa0b2694175679d")
        elif out["address"] == "tb1qrk6da5g0592sx6lmgpchaf5qy2lgn8am7cuf3a":
            script = bytes.fromhex("00141db4ded10fa155036bfb40717ea68022be899fbb")
        final_tx.extend(bytes([len(script)]))
        final_tx.extend(script)

    # Witness for input 0 (P2WPKH: 2 elements - sig + pubkey)
    final_tx.extend(b'\x02')  # 2 elements
    for w in funding_witness:
        w_bytes = bytes.fromhex(w)
        final_tx.extend(encode_varint(len(w_bytes)))
        final_tx.extend(w_bytes)

    # Witness for input 1 (Taproot script: 3 elements)
    final_tx.extend(b'\x03')  # 3 elements
    for elem in COMMIT_WITNESS:
        elem_bytes = bytes.fromhex(elem)
        final_tx.extend(encode_varint(len(elem_bytes)))
        final_tx.extend(elem_bytes)

    # Locktime
    final_tx.extend((0).to_bytes(4, 'little'))

    final_hex = final_tx.hex()
    print(f"\nFinal reveal transaction:")
    print(final_hex)
    print("")

    # Verify it decodes correctly
    print("Verifying transaction...")
    verify_result = subprocess.run(
        ["bitcoin-cli", "-testnet4", "decoderawtransaction", final_hex],
        capture_output=True, text=True
    )
    if verify_result.returncode == 0:
        verified = json.loads(verify_result.stdout)
        print(f"TX ID: {verified['txid']}")
        print(f"Size: {verified['size']} bytes, vsize: {verified['vsize']} vbytes")
        print(f"Inputs: {len(verified['vin'])}")
        print(f"Outputs: {len(verified['vout'])}")

        # Save to file
        with open("/tmp/reveal_tx_final.hex", "w") as f:
            f.write(final_hex)
        print("\nSaved to /tmp/reveal_tx_final.hex")

        print("\nTo broadcast:")
        print(f"  bitcoin-cli -testnet4 sendrawtransaction {final_hex}")
    else:
        print(f"ERROR: {verify_result.stderr}")


if __name__ == "__main__":
    main()
