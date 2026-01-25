#!/bin/bash
# ============================================================================
# Prove and Mint zkUSD - Full Spell Execution
# ============================================================================
# This script:
# 1. Waits for the previous TX to confirm
# 2. Runs the full spell with token minting
# 3. Signs and broadcasts the transaction
# ============================================================================

set -e

PREV_TX="d8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9"
SPELL_FILE="deployments/testnet4/pending/open-vault-full-v1.yaml"

echo "=== zkUSD Minting Script ==="
echo ""

# Step 1: Check if previous TX is confirmed
echo "Step 1: Checking if previous TX is confirmed..."
CONFIRMATIONS=$(bitcoin-cli -testnet4 gettransaction $PREV_TX 2>/dev/null | grep -o '"confirmations": [0-9]*' | grep -o '[0-9]*')

if [ "$CONFIRMATIONS" -lt 1 ]; then
    echo "  Previous TX not yet confirmed ($CONFIRMATIONS confirmations)"
    echo "  Waiting for at least 1 confirmation..."
    echo ""
    echo "  TX: $PREV_TX"
    echo "  Run this script again after confirmation."
    exit 1
fi

echo "  Previous TX confirmed with $CONFIRMATIONS confirmations!"
echo ""

# Step 2: Get prev_txs
echo "Step 2: Fetching previous transactions..."
TX1_HEX=$(bitcoin-cli -testnet4 gettransaction $PREV_TX | python3 -c "import sys,json; print(json.load(sys.stdin)['hex'])")
TX2_HEX=$(bitcoin-cli -testnet4 gettransaction 758a8f853d65d65bc728bbcf8ca134a8a5dd50dc74b8f0ddc3cb0c8d98ffb1c8 | python3 -c "import sys,json; print(json.load(sys.stdin)['hex'])")
TX3_HEX=$(bitcoin-cli -testnet4 gettransaction 6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988 | python3 -c "import sys,json; print(json.load(sys.stdin)['hex'])")

PREV_TXS="$TX1_HEX,$TX2_HEX,$TX3_HEX"
echo "  Fetched 3 previous transactions"
echo ""

# Step 3: Get fresh funding UTXO
echo "Step 3: Finding funding UTXO..."
FUNDING_UTXO=$(bitcoin-cli -testnet4 listunspent 1 999999 '[]' true '{"minimumAmount": 0.004}' | python3 -c "
import sys, json
utxos = json.load(sys.stdin)
# Skip UTXOs that are spell inputs
skip = ['d8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9', '758a8f853d65d65bc728bbcf8ca134a8a5dd50dc74b8f0ddc3cb0c8d98ffb1c8', '6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988']
for u in utxos:
    if u['txid'] not in skip:
        print(f\"{u['txid']}:{u['vout']}:{int(u['amount']*100000000)}\")
        break
")

if [ -z "$FUNDING_UTXO" ]; then
    echo "  ERROR: No suitable funding UTXO found"
    exit 1
fi

FUNDING_TXID=$(echo $FUNDING_UTXO | cut -d: -f1)
FUNDING_VOUT=$(echo $FUNDING_UTXO | cut -d: -f2)
FUNDING_VALUE=$(echo $FUNDING_UTXO | cut -d: -f3)

echo "  Funding UTXO: $FUNDING_TXID:$FUNDING_VOUT ($FUNDING_VALUE sats)"
echo ""

# Step 4: Run Charms prover
echo "Step 4: Running Charms prover (this may take a few minutes)..."
OUTPUT=$(charms spell prove \
  --spell "$SPELL_FILE" \
  --prev-txs "$PREV_TXS" \
  --app-bins apps/web/public/wasm/vault-manager-v2-app.wasm,apps/web/public/wasm/zkusd-token-app.wasm \
  --funding-utxo "$FUNDING_TXID:$FUNDING_VOUT" \
  --funding-utxo-value "$FUNDING_VALUE" \
  --change-address "tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq" \
  --fee-rate 2 \
  --chain bitcoin 2>&1)

echo "$OUTPUT"

# Check if proof succeeded
if echo "$OUTPUT" | grep -q "app contract satisfied"; then
    echo ""
    echo "  Proof succeeded!"
else
    echo ""
    echo "  ERROR: Proof failed"
    exit 1
fi

# Extract transaction hex
TX_HEX=$(echo "$OUTPUT" | grep -v "✅" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list) and len(data) > 0:
        print(data[0].get('bitcoin', data[0]))
except:
    pass
")

if [ -z "$TX_HEX" ]; then
    echo "  ERROR: Could not extract transaction hex"
    exit 1
fi

echo ""
echo "Step 5: Signing transaction..."
SIGNED=$(bitcoin-cli -testnet4 signrawtransactionwithwallet "$TX_HEX" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['hex'] if d.get('complete') else '')")

if [ -z "$SIGNED" ]; then
    echo "  ERROR: Transaction signing incomplete"
    exit 1
fi

echo "  Transaction signed!"
echo ""

echo "Step 6: Broadcasting transaction..."
TXID=$(bitcoin-cli -testnet4 sendrawtransaction "$SIGNED")

echo ""
echo "=== SUCCESS! ==="
echo "Transaction broadcast: $TXID"
echo ""
echo "zkUSD tokens minted! (~9.95 zkUSD after fee)"
echo ""
echo "View on explorer:"
echo "  https://mempool.space/testnet4/tx/$TXID"
