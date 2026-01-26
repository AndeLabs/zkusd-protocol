#!/bin/bash
# ============================================================================
# Prove and Broadcast zkUSD Minting Spell v3
# ============================================================================
set -e

echo "=== zkUSD Minting Spell v3 ==="
echo ""

# Configuration
SPELL_FILE="deployments/testnet4/pending/mint-zkusd-v5.yaml"
VM_WASM="apps/web/public/wasm/vault-manager-v2-app.wasm"
TOKEN_WASM="apps/web/public/wasm/zkusd-token-app-deployed.wasm"
FUNDING_UTXO="d8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9:5"
FUNDING_VALUE=1031503
CHANGE_ADDRESS="tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
FEE_RATE=10.0

# Transaction IDs for prev_txs
VM_TXID="d8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9"
COLL_TXID="fa1e910b896d1ebed8f3f13cc718f8e2aa5e21804157ba66b4fded21552cd1d3"
TOKEN_STATE_TXID="6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988"

# Fetch raw transactions
echo "Fetching raw transactions..."
VM_TX=$(curl -s "https://mempool.space/testnet4/api/tx/${VM_TXID}/hex")
COLL_TX=$(curl -s "https://mempool.space/testnet4/api/tx/${COLL_TXID}/hex")
TOKEN_STATE_TX=$(curl -s "https://mempool.space/testnet4/api/tx/${TOKEN_STATE_TXID}/hex")

if [ -z "$VM_TX" ] || [ -z "$COLL_TX" ] || [ -z "$TOKEN_STATE_TX" ]; then
    echo "ERROR: Failed to fetch raw transactions"
    exit 1
fi

echo "VM TX: ${#VM_TX} bytes"
echo "Collateral TX: ${#COLL_TX} bytes"
echo "Token State TX: ${#TOKEN_STATE_TX} bytes"

# Check if WASM files exist
if [ ! -f "$VM_WASM" ]; then
    echo "ERROR: VaultManager WASM not found: $VM_WASM"
    exit 1
fi
if [ ! -f "$TOKEN_WASM" ]; then
    echo "ERROR: Token WASM not found: $TOKEN_WASM"
    exit 1
fi

echo ""
echo "=== Proving Spell ==="
echo "Spell: $SPELL_FILE"
echo "VM WASM: $VM_WASM"
echo "Token WASM: $TOKEN_WASM"
echo "Funding: $FUNDING_UTXO ($FUNDING_VALUE sats)"
echo "Fee rate: $FEE_RATE sat/vB"
echo ""

# Run the prove command with 3 prev_txs and both WASM binaries
charms spell prove \
    --spell "$SPELL_FILE" \
    --prev-txs "$VM_TX,$COLL_TX,$TOKEN_STATE_TX" \
    --app-bins "$VM_WASM,$TOKEN_WASM" \
    --funding-utxo "$FUNDING_UTXO" \
    --funding-utxo-value $FUNDING_VALUE \
    --change-address "$CHANGE_ADDRESS" \
    --fee-rate $FEE_RATE

echo ""
echo "=== Done ==="
