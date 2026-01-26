#!/usr/bin/env python3
"""
Prove and broadcast zkUSD minting spell using remote prover
"""
import json
import base64
import requests
import yaml
import sys
from pathlib import Path

# Configuration
PROVER_URL = "https://v9.charms.dev/spells/prove"
BROADCAST_URL = "https://mempool.space/testnet4/api/tx"

SPELL_FILE = "deployments/testnet4/pending/mint-zkusd-v2.yaml"
WASM_FILE = "apps/web/public/wasm/vault-manager-v2-app.wasm"

# UTXOs
VM_UTXO = "d8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9"
COLL_UTXO = "fa1e910b896d1ebed8f3f13cc718f8e2aa5e21804157ba66b4fded21552cd1d3"
FUNDING_UTXO = f"{VM_UTXO}:5"
FUNDING_VALUE = 1031503
CHANGE_ADDRESS = "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
FEE_RATE = 10.0

def fetch_raw_tx(txid: str) -> str:
    """Fetch raw transaction hex from mempool.space"""
    url = f"https://mempool.space/testnet4/api/tx/{txid}/hex"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text

def load_wasm_binary(path: str) -> str:
    """Load WASM binary as base64"""
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')

def main():
    print("=== zkUSD Minting Spell Prover ===")
    print()

    # Load spell YAML
    print(f"Loading spell: {SPELL_FILE}")
    with open(SPELL_FILE, 'r') as f:
        spell = yaml.safe_load(f)
    print(f"  Version: {spell.get('version')}")
    print(f"  Apps: {list(spell.get('apps', {}).keys())}")
    print(f"  Inputs: {len(spell.get('ins', []))}")
    print(f"  Outputs: {len(spell.get('outs', []))}")
    print()

    # Fetch raw transactions
    print("Fetching raw transactions...")
    vm_tx = fetch_raw_tx(VM_UTXO)
    coll_tx = fetch_raw_tx(COLL_UTXO)
    print(f"  VM TX: {len(vm_tx)} chars")
    print(f"  Collateral TX: {len(coll_tx)} chars")
    print()

    # Load WASM binary
    print(f"Loading WASM: {WASM_FILE}")
    wasm_b64 = load_wasm_binary(WASM_FILE)
    print(f"  Size: {len(wasm_b64)} chars (base64)")
    print()

    # Get VK from spell apps
    vk = list(spell['apps'].keys())[0]  # VaultManager VK
    print(f"VaultManager VK: {vk}")

    # Build prover request
    # The prover expects binaries keyed by VK
    request = {
        "spell": spell,
        "binaries": {
            vk: wasm_b64
        },
        "prev_txs": [
            {"bitcoin": vm_tx},
            {"bitcoin": coll_tx}
        ],
        "funding_utxo": FUNDING_UTXO,
        "funding_utxo_value": FUNDING_VALUE,
        "change_address": CHANGE_ADDRESS,
        "fee_rate": FEE_RATE,
        "chain": "bitcoin"
    }

    print("=== Sending to Prover ===")
    print(f"URL: {PROVER_URL}")
    print(f"Funding: {FUNDING_UTXO} ({FUNDING_VALUE} sats)")
    print(f"Fee rate: {FEE_RATE} sat/vB")
    print()

    # Send to prover
    try:
        resp = requests.post(
            PROVER_URL,
            json=request,
            headers={"Content-Type": "application/json"},
            timeout=300  # 5 minute timeout
        )

        print(f"Response status: {resp.status_code}")

        if resp.status_code != 200:
            print(f"ERROR: {resp.text}")
            return 1

        result = resp.json()
        print()
        print("=== Prover Response ===")

        if isinstance(result, list) and len(result) == 2:
            commit_tx = result[0].get('bitcoin', result[0]) if isinstance(result[0], dict) else result[0]
            spell_tx = result[1].get('bitcoin', result[1]) if isinstance(result[1], dict) else result[1]

            print(f"Commit TX: {commit_tx[:64]}...")
            print(f"Spell TX: {spell_tx[:64]}...")

            # Save transactions
            with open("deployments/testnet4/pending/mint-commit-tx.hex", 'w') as f:
                f.write(commit_tx)
            with open("deployments/testnet4/pending/mint-spell-tx.hex", 'w') as f:
                f.write(spell_tx)
            print()
            print("Saved transactions to deployments/testnet4/pending/")

            # Ask to broadcast
            print()
            answer = input("Broadcast transactions? [y/N]: ")
            if answer.lower() == 'y':
                print()
                print("Broadcasting commit TX...")
                commit_resp = requests.post(BROADCAST_URL, data=commit_tx, timeout=30)
                if commit_resp.status_code == 200:
                    commit_txid = commit_resp.text
                    print(f"Commit TX broadcast: {commit_txid}")
                    print(f"Explorer: https://mempool.space/testnet4/tx/{commit_txid}")

                    print()
                    print("Broadcasting spell TX...")
                    spell_resp = requests.post(BROADCAST_URL, data=spell_tx, timeout=30)
                    if spell_resp.status_code == 200:
                        spell_txid = spell_resp.text
                        print(f"Spell TX broadcast: {spell_txid}")
                        print(f"Explorer: https://mempool.space/testnet4/tx/{spell_txid}")
                    else:
                        print(f"Spell TX broadcast failed: {spell_resp.text}")
                else:
                    print(f"Commit TX broadcast failed: {commit_resp.text}")
        else:
            print(f"Unexpected response format: {result}")
            return 1

    except requests.exceptions.Timeout:
        print("ERROR: Prover timeout (5 minutes)")
        return 1
    except Exception as e:
        print(f"ERROR: {e}")
        return 1

    print()
    print("=== Done ===")
    return 0

if __name__ == "__main__":
    sys.exit(main())
