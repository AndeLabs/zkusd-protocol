#!/usr/bin/env python3
"""
Sign and broadcast Charms transactions without Bitcoin Core
Uses the wallet private key to sign the commit transaction
"""

import json
import hashlib
import requests
from typing import Tuple, List

# Bitcoin transaction signing for SegWit v0 (P2WPKH)
def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()

def double_sha256(data: bytes) -> bytes:
    return sha256(sha256(data))

def decode_hex(hex_str: str) -> bytes:
    return bytes.fromhex(hex_str)

def encode_hex(data: bytes) -> str:
    return data.hex()

def decode_varint(data: bytes, offset: int = 0) -> Tuple[int, int]:
    """Decode a variable-length integer, return (value, bytes_consumed)"""
    first_byte = data[offset]
    if first_byte < 0xfd:
        return first_byte, 1
    elif first_byte == 0xfd:
        return int.from_bytes(data[offset+1:offset+3], 'little'), 3
    elif first_byte == 0xfe:
        return int.from_bytes(data[offset+1:offset+5], 'little'), 5
    else:
        return int.from_bytes(data[offset+1:offset+9], 'little'), 9

def encode_varint(n: int) -> bytes:
    if n < 0xfd:
        return bytes([n])
    elif n <= 0xffff:
        return bytes([0xfd]) + n.to_bytes(2, 'little')
    elif n <= 0xffffffff:
        return bytes([0xfe]) + n.to_bytes(4, 'little')
    else:
        return bytes([0xff]) + n.to_bytes(8, 'little')

def wif_to_privkey(wif: str) -> bytes:
    """Convert WIF to raw private key bytes"""
    # Base58 decode
    ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    num = 0
    for char in wif:
        num = num * 58 + ALPHABET.index(char)

    # Convert to bytes (typically 38 bytes for compressed WIF)
    all_bytes = num.to_bytes(38, 'big')

    # Remove leading zeros that were encoded as '1's
    leading_ones = len(wif) - len(wif.lstrip('1'))
    all_bytes = bytes(leading_ones) + all_bytes.lstrip(b'\x00')

    # Verify checksum
    payload = all_bytes[:-4]
    checksum = all_bytes[-4:]
    if double_sha256(payload)[:4] != checksum:
        raise ValueError("Invalid WIF checksum")

    # Extract private key (skip version byte, take 32 bytes)
    # For compressed WIF, there's also a 0x01 suffix
    privkey = payload[1:33]
    return privkey

def privkey_to_pubkey(privkey: bytes) -> bytes:
    """Convert private key to compressed public key using secp256k1"""
    try:
        from fastecdsa import keys, curve
        privkey_int = int.from_bytes(privkey, 'big')
        pubkey_point = keys.get_public_key(privkey_int, curve.secp256k1)
        prefix = b'\x02' if pubkey_point.y % 2 == 0 else b'\x03'
        return prefix + pubkey_point.x.to_bytes(32, 'big')
    except ImportError:
        # Fallback using bitcoin library
        import bitcoin
        return bytes.fromhex(bitcoin.privkey_to_pubkey(privkey.hex()))

def hash160(data: bytes) -> bytes:
    """RIPEMD160(SHA256(data))"""
    sha = hashlib.sha256(data).digest()
    ripemd = hashlib.new('ripemd160')
    ripemd.update(sha)
    return ripemd.digest()

def sign_segwit_input(
    tx_hex: str,
    input_index: int,
    prev_txid: str,
    prev_vout: int,
    prev_value: int,
    privkey_wif: str
) -> str:
    """
    Sign a SegWit v0 (P2WPKH) input in a transaction

    Returns the signed transaction hex
    """
    try:
        from fastecdsa import keys, curve
        from fastecdsa.ecdsa import sign
        HAS_FASTECDSA = True
    except ImportError:
        HAS_FASTECDSA = False
        import bitcoin

    # Decode private key
    privkey = wif_to_privkey(privkey_wif)
    pubkey = privkey_to_pubkey(privkey)
    pubkey_hash = hash160(pubkey)

    # Parse the transaction
    tx_bytes = decode_hex(tx_hex)

    # For BIP143 (SegWit signing), we need to construct the sighash
    # https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki

    # Parse transaction components
    version = tx_bytes[:4]

    # Check for marker and flag (SegWit)
    has_witness = tx_bytes[4:6] == b'\x00\x01'

    if has_witness:
        offset = 6
    else:
        offset = 4

    # Number of inputs
    num_inputs, varint_size = decode_varint(tx_bytes, offset)
    offset += varint_size

    # Parse inputs
    inputs = []
    for _ in range(num_inputs):
        txid = tx_bytes[offset:offset+32][::-1]  # Little endian
        offset += 32
        vout = int.from_bytes(tx_bytes[offset:offset+4], 'little')
        offset += 4
        script_len, varint_size = decode_varint(tx_bytes, offset)
        offset += varint_size
        script_sig = tx_bytes[offset:offset+script_len]
        offset += script_len
        sequence = tx_bytes[offset:offset+4]
        offset += 4
        inputs.append({
            'txid': txid,
            'vout': vout,
            'script_sig': script_sig,
            'sequence': sequence
        })

    # Number of outputs
    num_outputs, varint_size = decode_varint(tx_bytes, offset)
    offset += varint_size

    # Parse outputs
    outputs = []
    outputs_raw = b''
    for _ in range(num_outputs):
        value = tx_bytes[offset:offset+8]
        offset += 8
        script_len, varint_size = decode_varint(tx_bytes, offset)
        offset += varint_size
        script_pubkey = tx_bytes[offset:offset+script_len]
        offset += script_len
        outputs.append({
            'value': value,
            'script_pubkey': script_pubkey
        })
        outputs_raw += value + encode_varint(len(script_pubkey)) + script_pubkey

    # Skip witness data if present
    if has_witness:
        for _ in range(num_inputs):
            num_witness, varint_size = decode_varint(tx_bytes, offset)
            offset += varint_size
            for _ in range(num_witness):
                item_len, varint_size = decode_varint(tx_bytes, offset)
                offset += varint_size
                offset += item_len

    # Locktime
    locktime = tx_bytes[-4:]

    # BIP143 sighash preimage for P2WPKH
    # 1. nVersion
    preimage = version

    # 2. hashPrevouts (double SHA256 of all input outpoints)
    prevouts = b''
    for inp in inputs:
        prevouts += inp['txid'][::-1] + inp['vout'].to_bytes(4, 'little')
    hash_prevouts = double_sha256(prevouts)
    preimage += hash_prevouts

    # 3. hashSequence (double SHA256 of all input sequences)
    sequences = b''
    for inp in inputs:
        sequences += inp['sequence']
    hash_sequence = double_sha256(sequences)
    preimage += hash_sequence

    # 4. outpoint (txid + vout of the input being signed)
    preimage += decode_hex(prev_txid)[::-1] + prev_vout.to_bytes(4, 'little')

    # 5. scriptCode (for P2WPKH: 0x1976a914{20-byte-pubkey-hash}88ac)
    script_code = b'\x19\x76\xa9\x14' + pubkey_hash + b'\x88\xac'
    preimage += script_code

    # 6. value of the output being spent
    preimage += prev_value.to_bytes(8, 'little')

    # 7. nSequence of the input being signed
    preimage += inputs[input_index]['sequence']

    # 8. hashOutputs (double SHA256 of all outputs)
    hash_outputs = double_sha256(outputs_raw)
    preimage += hash_outputs

    # 9. nLockTime
    preimage += locktime

    # 10. sighash type (SIGHASH_ALL = 0x01000000)
    preimage += b'\x01\x00\x00\x00'

    # Compute sighash
    sighash = double_sha256(preimage)

    # Sign using bitcoin library (more reliable for Bitcoin transactions)
    import bitcoin as btc

    # Convert sighash to int for signing
    z = int.from_bytes(sighash, 'big')
    privkey_int = int.from_bytes(privkey, 'big')

    # secp256k1 parameters
    p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
    Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8

    # Use deterministic k (RFC 6979 simplified)
    import hmac
    k_bytes = hmac.new(privkey + sighash, sighash, 'sha256').digest()
    k = int.from_bytes(k_bytes, 'big') % n
    if k == 0:
        k = 1

    # Point multiplication (simplified - use library in production)
    def point_add(p1, p2, prime=p):
        if p1 is None:
            return p2
        if p2 is None:
            return p1
        x1, y1 = p1
        x2, y2 = p2
        if x1 == x2 and y1 != y2:
            return None
        if x1 == x2:
            m = (3 * x1 * x1) * pow(2 * y1, -1, prime) % prime
        else:
            m = (y2 - y1) * pow(x2 - x1, -1, prime) % prime
        x3 = (m * m - x1 - x2) % prime
        y3 = (m * (x1 - x3) - y1) % prime
        return (x3, y3)

    def scalar_mult(k, point, prime=p):
        result = None
        addend = point
        while k:
            if k & 1:
                result = point_add(result, addend, prime)
            addend = point_add(addend, addend, prime)
            k >>= 1
        return result

    # Calculate R = k * G
    G = (Gx, Gy)
    R = scalar_mult(k, G)
    r = R[0] % n

    # Calculate s = k^-1 * (z + r * privkey) mod n
    k_inv = pow(k, -1, n)
    s = (k_inv * (z + r * privkey_int)) % n

    # Ensure low S value (BIP62)
    if s > n // 2:
        s = n - s

    # DER encode signature
    def der_encode_int(x):
        x_bytes = x.to_bytes((x.bit_length() + 7) // 8, 'big')
        if x_bytes[0] & 0x80:
            x_bytes = b'\x00' + x_bytes
        return bytes([0x02, len(x_bytes)]) + x_bytes

    r_der = der_encode_int(r)
    s_der = der_encode_int(s)
    signature = bytes([0x30, len(r_der) + len(s_der)]) + r_der + s_der + b'\x01'  # SIGHASH_ALL

    # Reconstruct transaction with witness
    signed_tx = version
    signed_tx += b'\x00\x01'  # SegWit marker and flag

    # Inputs
    signed_tx += encode_varint(num_inputs)
    for i, inp in enumerate(inputs):
        signed_tx += inp['txid'][::-1]
        signed_tx += inp['vout'].to_bytes(4, 'little')
        signed_tx += b'\x00'  # Empty scriptSig for SegWit
        signed_tx += inp['sequence']

    # Outputs
    signed_tx += encode_varint(num_outputs)
    for out in outputs:
        signed_tx += out['value']
        signed_tx += encode_varint(len(out['script_pubkey']))
        signed_tx += out['script_pubkey']

    # Witness data
    for i in range(num_inputs):
        if i == input_index:
            # Our signed input
            signed_tx += b'\x02'  # 2 witness items
            signed_tx += encode_varint(len(signature))
            signed_tx += signature
            signed_tx += encode_varint(len(pubkey))
            signed_tx += pubkey
        else:
            # Empty witness for other inputs
            signed_tx += b'\x00'

    # Locktime
    signed_tx += locktime

    return encode_hex(signed_tx)

def broadcast_tx(tx_hex: str, network: str = "testnet4") -> str:
    """Broadcast transaction via mempool.space API"""
    url = f"https://mempool.space/{network}/api/tx"
    response = requests.post(url, data=tx_hex)
    return response.text

def main():
    import sys
    import os

    # Load wallet
    script_dir = os.path.dirname(os.path.abspath(__file__))
    wallet_path = os.path.join(script_dir, '..', 'deployments', 'testnet4', 'wallet.json')

    with open(wallet_path) as f:
        wallet = json.load(f)

    privkey_wif = wallet['private_key_wif']
    address = wallet['address']

    print("=" * 50)
    print("  Charms Transaction Signer")
    print("=" * 50)
    print(f"Wallet: {address}")
    print()

    # Read transactions from stdin or file
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            txs = json.load(f)
    else:
        print("Paste the JSON array of transactions from 'charms spell prove':")
        txs_json = input()
        txs = json.loads(txs_json)

    # Extract transaction hex
    commit_tx = txs[0]['bitcoin']
    reveal_tx = txs[1]['bitcoin']

    print(f"Commit TX: {commit_tx[:50]}...")
    print(f"Reveal TX: {reveal_tx[:50]}...")
    print()

    # Get UTXO info
    utxo = wallet.get('utxo', {})
    prev_txid = utxo.get('txid', '')
    prev_vout = utxo.get('vout', 1)
    prev_value = utxo.get('value', 150793)

    print(f"Signing with UTXO: {prev_txid}:{prev_vout} ({prev_value} sats)")
    print()

    # Sign commit transaction
    print("Signing commit transaction...")
    try:
        signed_commit = sign_segwit_input(
            commit_tx,
            0,  # input index
            prev_txid,
            prev_vout,
            prev_value,
            privkey_wif
        )
        print(f"Signed: {signed_commit[:50]}...")
    except Exception as e:
        print(f"Error signing: {e}")
        return

    print()
    print("Broadcasting commit transaction...")
    result = broadcast_tx(signed_commit)
    print(f"Result: {result}")

    if len(result) == 64:  # Valid txid
        print()
        print("Waiting for propagation...")
        import time
        time.sleep(3)

        print("Broadcasting reveal transaction...")
        result = broadcast_tx(reveal_tx)
        print(f"Result: {result}")

        if len(result) == 64:
            print()
            print("=" * 50)
            print("  SUCCESS! Charm deployed!")
            print("=" * 50)
            print(f"View: https://mempool.space/testnet4/tx/{result}")

if __name__ == "__main__":
    main()
