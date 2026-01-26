#!/bin/bash
# =============================================================================
# zkUSD Open Vault Test Script
# =============================================================================
# Tests the open-vault spell with mock prover
# Uses the production VKs (without debug output)
# =============================================================================

set -e
cd "$(dirname "$0")/.."

echo "=== zkUSD Open Vault Test ==="
echo ""
echo "Configuration:"
echo "  - Collateral: 2,500,000 sats (0.025 BTC)"
echo "  - User Debt: 1,800 zkUSD"
echo "  - Vault Debt: 2,000 zkUSD (with 200 zkUSD liquidation reserve)"
echo "  - BTC Price: \$104,000"
echo "  - ICR: ~130%"
echo ""

# Load prev_tx hex files
PREV1=$(cat /tmp/prev_tx1_modified.hex 2>/dev/null || cat /tmp/prev_tx1.hex 2>/dev/null || echo "")
VM=$(cat /tmp/vm_tx.hex 2>/dev/null || echo "")
ORACLE=$(cat /tmp/oracle_tx.hex 2>/dev/null || echo "")
TOKEN_STATE=$(cat /tmp/token_state_tx.hex 2>/dev/null || echo "")

# Build prev-txs string
PREV_TXS=""
if [ -n "$PREV1" ] && [ -n "$VM" ] && [ -n "$ORACLE" ] && [ -n "$TOKEN_STATE" ]; then
    PREV_TXS="$PREV1,$VM,$ORACLE,$TOKEN_STATE"
elif [ -n "$PREV1" ] && [ -n "$VM" ] && [ -n "$ORACLE" ]; then
    PREV_TXS="$PREV1,$VM,$ORACLE"
elif [ -n "$PREV1" ] && [ -n "$VM" ]; then
    PREV_TXS="$PREV1,$VM"
elif [ -n "$PREV1" ]; then
    PREV_TXS="$PREV1"
fi

if [ -z "$PREV_TXS" ]; then
    echo "ERROR: No prev_tx files found in /tmp/"
    echo "Required files:"
    echo "  - /tmp/prev_tx1.hex or /tmp/prev_tx1_modified.hex"
    echo "  - /tmp/vm_tx.hex"
    echo "  - /tmp/oracle_tx.hex"
    echo "  - /tmp/token_state_tx.hex"
    exit 1
fi

echo "Running spell prove with mock prover..."
echo ""

charms spell prove --mock \
  --spell spells/ops/open-vault-test.yaml \
  --prev-txs "$PREV_TXS" \
  --app-bins target/wasm32-wasip1/release/zkusd-vault-manager-app.wasm,target/wasm32-wasip1/release/zkusd-token-app.wasm,target/wasm32-wasip1/release/zkusd-price-oracle-app.wasm \
  --funding-utxo 4ec30b16e45b20341586e690f282314d24a5696dde50b80ef02905b1fae8713e:1 \
  --funding-utxo-value 3000000 \
  --change-address tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq

echo ""
echo "=== Test Complete ==="
