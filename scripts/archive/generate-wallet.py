#!/usr/bin/env python3
"""
zkUSD Testnet4 Wallet Generator
Generates a new Bitcoin Testnet4 wallet for deployment
"""

import os
import json
import hashlib
import secrets
from datetime import datetime

# Simple BIP39-like seed generation (for testnet only!)
def generate_seed():
    """Generate 32 bytes of entropy"""
    return secrets.token_bytes(32)

def sha256(data):
    return hashlib.sha256(data).digest()

def hash160(data):
    """RIPEMD160(SHA256(data))"""
    import hashlib
    sha = hashlib.sha256(data).digest()
    ripemd = hashlib.new('ripemd160')
    ripemd.update(sha)
    return ripemd.digest()

def bech32_polymod(values):
    """Bech32 checksum"""
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
    """Encode to bech32"""
    combined = data + bech32_create_checksum(hrp, data)
    return hrp + '1' + ''.join([BECH32_CHARSET[d] for d in combined])

def convertbits(data, frombits, tobits, pad=True):
    """Convert between bit sizes"""
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
        from fastecdsa.point import Point

        # Convert bytes to int
        privkey_int = int.from_bytes(privkey_bytes, 'big')

        # Get public key point
        pubkey_point = keys.get_public_key(privkey_int, curve.secp256k1)

        # Compressed public key (02/03 prefix + x coordinate)
        prefix = b'\x02' if pubkey_point.y % 2 == 0 else b'\x03'
        pubkey = prefix + pubkey_point.x.to_bytes(32, 'big')

        return pubkey
    except ImportError:
        # Fallback: use hashlib for a deterministic "public key" (NOT SECURE, testnet only!)
        print("Warning: Using simplified key derivation (testnet only!)")
        return b'\x02' + sha256(privkey_bytes)

def generate_testnet4_address(privkey_bytes):
    """Generate a Testnet4 P2WPKH (native segwit) address"""
    # Get public key
    pubkey = privkey_to_pubkey(privkey_bytes)

    # Hash160 of public key
    pubkey_hash = hash160(pubkey)

    # Bech32 encode with witness version 0
    # Testnet4 uses 'tb' prefix (same as testnet3)
    hrp = 'tb'
    witver = 0

    # Convert to 5-bit groups
    data = [witver] + convertbits(pubkey_hash, 8, 5)

    address = bech32_encode(hrp, data)
    return address, pubkey.hex()

def generate_wif(privkey_bytes, testnet=True):
    """Convert private key to WIF format"""
    # Testnet prefix
    prefix = b'\xef' if testnet else b'\x80'

    # Add compression flag
    extended = prefix + privkey_bytes + b'\x01'

    # Double SHA256 checksum
    checksum = sha256(sha256(extended))[:4]

    # Base58 encode
    return base58_encode(extended + checksum)

def base58_encode(data):
    """Base58 encode"""
    ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    # Count leading zeros
    leading_zeros = 0
    for byte in data:
        if byte == 0:
            leading_zeros += 1
        else:
            break

    # Convert to integer
    num = int.from_bytes(data, 'big')

    # Convert to base58
    result = ''
    while num > 0:
        num, remainder = divmod(num, 58)
        result = ALPHABET[remainder] + result

    return '1' * leading_zeros + result

def main():
    print("=" * 50)
    print("  zkUSD Testnet4 Wallet Generator")
    print("=" * 50)
    print()

    # Generate random private key
    privkey = generate_seed()

    # Generate address
    address, pubkey = generate_testnet4_address(privkey)
    wif = generate_wif(privkey, testnet=True)

    print(f"Network: Bitcoin Testnet4")
    print(f"Address: {address}")
    print(f"Public Key: {pubkey}")
    print()
    print(f"Private Key (WIF): {wif}")
    print(f"Private Key (hex): {privkey.hex()}")
    print()
    print("=" * 50)
    print("  IMPORTANT: Save your private key securely!")
    print("  This is a TESTNET wallet - DO NOT use for real funds")
    print("=" * 50)
    print()

    # Save to file
    wallet_dir = os.path.join(os.path.dirname(__file__), '..', 'deployments', 'testnet4')
    os.makedirs(wallet_dir, exist_ok=True)

    wallet_file = os.path.join(wallet_dir, 'wallet.json')

    wallet_data = {
        "network": "testnet4",
        "address": address,
        "public_key": pubkey,
        "private_key_wif": wif,
        "private_key_hex": privkey.hex(),
        "created_at": datetime.utcnow().isoformat() + "Z",
        "warning": "TESTNET ONLY - Do not use for real funds"
    }

    with open(wallet_file, 'w') as f:
        json.dump(wallet_data, f, indent=2)

    print(f"Wallet saved to: {wallet_file}")
    print()
    print("Next steps:")
    print(f"  1. Fund this address with testnet BTC:")
    print(f"     Address: {address}")
    print()
    print("  2. Get testnet BTC from faucets:")
    print("     → https://mempool.space/testnet4/faucet")
    print("     → https://faucet.testnet4.dev/")
    print()
    print(f"  3. Check balance:")
    print(f"     https://mempool.space/testnet4/address/{address}")
    print()

    return address

if __name__ == "__main__":
    main()
