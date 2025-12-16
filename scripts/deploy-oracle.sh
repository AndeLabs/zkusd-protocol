#!/bin/bash
# Deploy zkUSD Oracle Charm to Testnet4
# Usage: ./scripts/deploy-oracle.sh <funding_txid:vout> <value_sats>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SPELL_TEMPLATE="$PROJECT_DIR/spells/deploy-oracle-minimal.yaml"
SPELL_FILE="$PROJECT_DIR/spells/deploy-oracle-live.yaml"
WALLET_ADDRESS="tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
APP_WASM="$PROJECT_DIR/target/wasm32-wasip1/release/zkusd-price-oracle-app.wasm"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   zkUSD Oracle Deployment to Testnet4  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

if [ -z "$1" ] || [ -z "$2" ]; then
    echo -e "${YELLOW}Usage: $0 <funding_txid:vout> <value_sats>${NC}"
    echo ""
    echo "To find your UTXO: bitcoin-cli -testnet4 listunspent"
    echo "Get coins from: https://faucet.testnet4.dev/"
    echo "Address: $WALLET_ADDRESS"
    exit 1
fi

FUNDING_UTXO="$1"
FUNDING_VALUE="$2"
FUNDING_TXID=$(echo "$FUNDING_UTXO" | cut -d: -f1)

echo "Funding UTXO: $FUNDING_UTXO ($FUNDING_VALUE sats)"

# Get prev tx
PREV_TX=$(bitcoin-cli -testnet4 getrawtransaction "$FUNDING_TXID" 2>/dev/null)
if [ -z "$PREV_TX" ]; then
    echo -e "${RED}ERROR: Could not fetch tx $FUNDING_TXID${NC}"
    exit 1
fi

# Create spell
sed "s/FUNDING_TXID:FUNDING_VOUT/$FUNDING_UTXO/" "$SPELL_TEMPLATE" > "$SPELL_FILE"
echo -e "${GREEN}✓${NC} Spell created"

# Generate proof
echo -e "${YELLOW}Generating ZK proof...${NC}"
RESULT=$(charms spell prove \
    --spell "$SPELL_FILE" \
    --funding-utxo "$FUNDING_UTXO" \
    --funding-utxo-value "$FUNDING_VALUE" \
    --change-address "$WALLET_ADDRESS" \
    --fee-rate 2.0 \
    --app-bins "$APP_WASM" \
    --prev-txs "$PREV_TX" 2>&1)

TX_JSON=$(echo "$RESULT" | grep -E '^\[' | tail -1)
COMMIT_TX=$(echo "$TX_JSON" | jq -r '.[0].bitcoin')
REVEAL_TX=$(echo "$TX_JSON" | jq -r '.[1].bitcoin')

if [ -z "$COMMIT_TX" ] || [ "$COMMIT_TX" == "null" ]; then
    echo -e "${RED}ERROR:${NC}"
    echo "$RESULT"
    exit 1
fi

COMMIT_TXID=$(bitcoin-cli -testnet4 decoderawtransaction "$COMMIT_TX" | jq -r '.txid')
REVEAL_TXID=$(bitcoin-cli -testnet4 decoderawtransaction "$REVEAL_TX" | jq -r '.txid')

echo -e "${GREEN}✓${NC} Proof generated"
echo "Commit TXID: $COMMIT_TXID"
echo "Reveal TXID: $REVEAL_TXID"

# Save
mkdir -p "$PROJECT_DIR/deployments/testnet4"
echo "$COMMIT_TX" > "$PROJECT_DIR/deployments/testnet4/commit.hex"
echo "$REVEAL_TX" > "$PROJECT_DIR/deployments/testnet4/reveal.hex"

# Broadcast
echo -e "${YELLOW}Broadcasting...${NC}"
bitcoin-cli -testnet4 sendrawtransaction "$COMMIT_TX" && echo -e "${GREEN}✓${NC} Commit sent"
sleep 1
bitcoin-cli -testnet4 sendrawtransaction "$REVEAL_TX" 2>&1 && echo -e "${GREEN}✓${NC} Reveal sent" || echo "Reveal pending (commit may need confirmation)"

echo ""
echo -e "${GREEN}Done!${NC}"
echo "https://mempool.space/testnet4/tx/$COMMIT_TXID"
