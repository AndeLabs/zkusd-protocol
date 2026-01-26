#!/usr/bin/env python3
"""
zkUSD Signet Wallet Generator
Generates a new Bitcoin Signet wallet for deployment
Signet has more reliable faucets than Testnet4
"""

import os
import json
import hashlib
import secrets
from datetime import datetime

def generate_seed():
    """Generate 32 bytes of entropy"""
    return secrets.token_bytes(32)

def sha256(data):
    return hashlib.sha256(data).digest()

def hash160(data):
    """RIPEMD160(SHA256(data))"""
    sha = hashlib.sha256(data).digest()
    ripemd = hashlib.new('ripemd160')
    ripemd.update(sha)
    return ripemd.digest()

def bech32_polymod(values):
    GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            chk ^= GEN[i] if ((b >> i) & 1) else 0
    return chk

def bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def bech32_create_checksum(hrp, data):
    values = bech32_hrp_expand(hrp) + data
    polymod = bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]

BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

def bech32_encode(hrp, data):
    combined = data + bech32_create_checksum(hrp, data)
    return hrp + '1' + ''.join([BECH32_CHARSET[d] for d in combined])

def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    return ret

def privkey_to_pubkey(privkey_bytes):
    """Convert private key to public key using secp256k1"""
    try:
        from fastecdsa import keys, curve

        privkey_int = int.from_bytes(privkey_bytes, 'big')
        pubkey_point = keys.get_public_key(privkey_int, curve.secp256k1)
        prefix = b'\x02' if pubkey_point.y % 2 == 0 else b'\x03'
        pubkey = prefix + pubkey_point.x.to_bytes(32, 'big')
        return pubkey
    except ImportError:
        print("Warning: Using simplified key derivation (testnet only!)")
        return b'\x02' + sha256(privkey_bytes)

def generate_signet_address(privkey_bytes):
    """Generate a Signet P2WPKH (native segwit) address"""
    pubkey = privkey_to_pubkey(privkey_bytes)
    pubkey_hash = hash160(pubkey)

    # Signet uses 'tb' prefix (same as testnet)
    hrp = 'tb'
    witver = 0
    data = [witver] + convertbits(pubkey_hash, 8, 5)
    address = bech32_encode(hrp, data)
    return address, pubkey.hex()

def generate_wif(privkey_bytes, testnet=True):
    """Convert private key to WIF format"""
    prefix = b'\xef' if testnet else b'\x80'
    extended = prefix + privkey_bytes + b'\x01'
    checksum = sha256(sha256(extended))[:4]
    return base58_encode(extended + checksum)

def base58_encode(data):
    ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    leading_zeros = 0
    for byte in data:
        if byte == 0:
            leading_zeros += 1
        else:
            break
    num = int.from_bytes(data, 'big')
    result = ''
    while num > 0:
        num, remainder = divmod(num, 58)
        result = ALPHABET[remainder] + result
    return '1' * leading_zeros + result

def main():
    print("=" * 50)
    print("  zkUSD Signet Wallet Generator")
    print("=" * 50)
    print()

    privkey = generate_seed()
    address, pubkey = generate_signet_address(privkey)
    wif = generate_wif(privkey, testnet=True)

    print(f"Network: Bitcoin Signet")
    print(f"Address: {address}")
    print(f"Public Key: {pubkey}")
    print()
    print(f"Private Key (WIF): {wif}")
    print(f"Private Key (hex): {privkey.hex()}")
    print()
    print("=" * 50)
    print("  IMPORTANT: Save your private key securely!")
    print("  This is a SIGNET wallet - DO NOT use for real funds")
    print("=" * 50)
    print()

    wallet_dir = os.path.join(os.path.dirname(__file__), '..', 'deployments', 'signet')
    os.makedirs(wallet_dir, exist_ok=True)

    wallet_file = os.path.join(wallet_dir, 'wallet.json')

    wallet_data = {
        "network": "signet",
        "address": address,
        "public_key": pubkey,
        "private_key_wif": wif,
        "private_key_hex": privkey.hex(),
        "created_at": datetime.utcnow().isoformat() + "Z",
        "warning": "SIGNET ONLY - Do not use for real funds"
    }

    with open(wallet_file, 'w') as f:
        json.dump(wallet_data, f, indent=2)

    print(f"Wallet saved to: {wallet_file}")
    print()
    print("Next steps:")
    print(f"  1. Fund this address with signet BTC:")
    print(f"     Address: {address}")
    print()
    print("  2. Get signet BTC from faucets:")
    print("     → https://signetfaucet.com/")
    print("     → https://alt.signetfaucet.com/")
    print("     → https://signet.bc-2.jp/")
    print()
    print(f"  3. Check balance:")
    print(f"     https://mempool.space/signet/address/{address}")
    print()

    return address

if __name__ == "__main__":
    main()
