#!/usr/bin/env python3
"""
Prove Open Vault V8 spell using the Charms prover API
"""

import subprocess
import json
import base64
import yaml
import requests

# Configuration
PROVER_URL = "https://v9.charms.dev/spells/prove"
SPELL_FILE = "deployments/testnet4/pending/open-vault-v9-simple.yaml"
VM_WASM = "apps/web/public/wasm/vault-manager-v2-app.wasm"
TOKEN_WASM = "apps/web/public/wasm/zkusd-token-app.wasm"  # Not used in simple test

# UTXO IDs
FUNDING_UTXO = "5cff4e4ff471c0341bf6154ba869e52a143f68487b78587f2db5a57f213fc518:0"
FUNDING_UTXO_VALUE = 500000
CHANGE_ADDRESS = "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
FEE_RATE = 2

# Transaction IDs we need to fetch
TX_IDS = [
    "8a7cf69a3372e9811e7a71d60cc1a347a76dd6f6d5b3018011a9e423c633bbd8",  # VM state TX
    "c7f436f44d97a8c67713e9cfecbd0f63222f8c6f1b6dc8af74cac860bf54e907",  # Collateral TX
    "5cff4e4ff471c0341bf6154ba869e52a143f68487b78587f2db5a57f213fc518",  # Fee TX
]

def get_tx_hex(txid: str) -> str:
    """Get raw transaction hex from bitcoin-cli"""
    result = subprocess.run(
        ["bitcoin-cli", "-testnet4", "gettransaction", txid],
        capture_output=True,
        text=True,
        check=True
    )
    data = json.loads(result.stdout)
    return data["hex"]

def load_wasm_base64(path: str) -> str:
    """Load WASM file and encode to base64"""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")

def load_spell(path: str) -> dict:
    """Load spell from YAML file"""
    with open(path, "r") as f:
        return yaml.safe_load(f)

def load_spell_string(path: str) -> str:
    """Load spell as raw YAML string, stripped of comments"""
    with open(path, "r") as f:
        spell = yaml.safe_load(f)
    # Re-dump without comments
    return yaml.dump(spell, default_flow_style=False, sort_keys=False)

def main():
    print("=== Open Vault V8 Prover ===")

    # Load spell
    print(f"Loading spell from {SPELL_FILE}...")
    spell = load_spell(SPELL_FILE)
    spell_string = load_spell_string(SPELL_FILE)

    # Load WASM binaries
    print("Loading WASM binaries...")
    binaries = {
        "a2359b5a481117a9be19f8f3fa21e1d979bac5bfd16c94e0a46c2bc1326c837d": load_wasm_base64(VM_WASM),
        # "ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128": load_wasm_base64(TOKEN_WASM),  # Not needed for simple test
    }
    print(f"  VM WASM: {len(binaries['a2359b5a481117a9be19f8f3fa21e1d979bac5bfd16c94e0a46c2bc1326c837d'])} bytes")

    # Get previous transactions
    print("Fetching previous transactions...")
    prev_txs = []
    for txid in TX_IDS:
        print(f"  Getting {txid[:16]}...")
        tx_hex = get_tx_hex(txid)
        prev_txs.append({"bitcoin": tx_hex})

    # Build request - v9 prover expects spell as YAML string
    request_body = {
        "spell": spell_string,  # v9 expects YAML string, not JSON object
        "binaries": binaries,
        "prev_txs": prev_txs,
        "funding_utxo": FUNDING_UTXO,
        "funding_utxo_value": FUNDING_UTXO_VALUE,
        "change_address": CHANGE_ADDRESS,
        "fee_rate": FEE_RATE,
        "chain": "bitcoin",
    }

    # Call prover
    print(f"\nCalling prover at {PROVER_URL}...")
    print("(This may take a few minutes for ZK proof generation)")

    response = requests.post(
        PROVER_URL,
        json=request_body,
        headers={"Content-Type": "application/json"},
        timeout=300  # 5 minute timeout
    )

    print(f"Response status: {response.status_code}")

    if response.status_code != 200:
        print(f"Error: {response.text}")
        print(f"\nRequest body (first 5000 chars):")
        print(json.dumps(request_body, indent=2)[:5000])
        return 1

    result = response.json()

    # Parse response
    if isinstance(result, list) and len(result) == 2:
        if isinstance(result[0], dict):
            commit_tx = result[0].get("bitcoin", result[0])
            spell_tx = result[1].get("bitcoin", result[1])
        else:
            commit_tx = result[0]
            spell_tx = result[1]
    else:
        print(f"Unexpected response format: {result}")
        return 1

    print("\n=== SUCCESS! ===")
    print(f"\nCommit TX ({len(commit_tx)} chars):")
    print(commit_tx[:200] + "...")
    print(f"\nSpell TX ({len(spell_tx)} chars):")
    print(spell_tx[:200] + "...")

    # Save to files
    with open("/tmp/commit_tx.hex", "w") as f:
        f.write(commit_tx)
    with open("/tmp/spell_tx.hex", "w") as f:
        f.write(spell_tx)

    print("\nSaved to /tmp/commit_tx.hex and /tmp/spell_tx.hex")
    print("\nTo broadcast:")
    print("  bitcoin-cli -testnet4 sendrawtransaction $(cat /tmp/commit_tx.hex)")
    print("  # Wait a few seconds")
    print("  bitcoin-cli -testnet4 sendrawtransaction $(cat /tmp/spell_tx.hex)")

    return 0

if __name__ == "__main__":
    exit(main())
