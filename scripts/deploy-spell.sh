#!/bin/bash
# ============================================================================
# Charms Spell Deployment Script - zkUSD
# ============================================================================
# This script helps deploy spells while preventing the common UTXO conflict error.
#
# Usage:
#   ./scripts/deploy-spell.sh <spell_file> <app_wasm> <ins_utxo> <funding_utxo> <funding_value>
#
# Example:
#   ./scripts/deploy-spell.sh \
#     spells/deploy-oracle-v2.yaml \
#     target/wasm32-wasip1/release/zkusd-price-oracle-app.wasm \
#     "abc123:0" \
#     "def456:1" \
#     240000
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=============================================="
echo "    zkUSD Charms Spell Deployment Script"
echo "=============================================="
echo ""

# Check arguments
if [ "$#" -lt 5 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo ""
    echo "Usage: $0 <spell_file> <app_wasm> <ins_utxo> <funding_utxo> <funding_value>"
    echo ""
    echo "Arguments:"
    echo "  spell_file    - Path to spell YAML file"
    echo "  app_wasm      - Path to app WASM binary"
    echo "  ins_utxo      - UTXO for 'ins:' in spell (txid:vout)"
    echo "  funding_utxo  - UTXO for funding fees (txid:vout) - MUST BE DIFFERENT!"
    echo "  funding_value - Value of funding UTXO in sats"
    exit 1
fi

SPELL_FILE="$1"
APP_WASM="$2"
INS_UTXO="$3"
FUNDING_UTXO="$4"
FUNDING_VALUE="$5"

# Validate files exist
if [ ! -f "$SPELL_FILE" ]; then
    echo -e "${RED}Error: Spell file not found: $SPELL_FILE${NC}"
    exit 1
fi

if [ ! -f "$APP_WASM" ]; then
    echo -e "${RED}Error: WASM file not found: $APP_WASM${NC}"
    exit 1
fi

# ============================================================================
# CRITICAL CHECK: Ensure UTXOs are different
# ============================================================================
echo -e "${YELLOW}⚠️  Checking UTXO separation rule...${NC}"

if [ "$INS_UTXO" == "$FUNDING_UTXO" ]; then
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  CRITICAL ERROR: ins UTXO and funding UTXO are the SAME!  ║${NC}"
    echo -e "${RED}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  This will cause 'conflict-in-package' error!             ║${NC}"
    echo -e "${RED}║                                                           ║${NC}"
    echo -e "${RED}║  ins UTXO:     $INS_UTXO${NC}"
    echo -e "${RED}║  funding UTXO: $FUNDING_UTXO${NC}"
    echo -e "${RED}║                                                           ║${NC}"
    echo -e "${RED}║  Please use TWO DIFFERENT UTXOs!                          ║${NC}"
    echo -e "${RED}║  See: docs/CHARMS_DEPLOYMENT_FIX.md                        ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ UTXOs are different - safe to proceed${NC}"
echo ""

# Get change address
CHANGE_ADDRESS=$(bitcoin-cli -testnet4 getnewaddress "charms_change")
echo "Change address: $CHANGE_ADDRESS"

# Extract txids for prev-txs
INS_TXID=$(echo "$INS_UTXO" | cut -d':' -f1)
FUNDING_TXID=$(echo "$FUNDING_UTXO" | cut -d':' -f1)

echo ""
echo "Fetching raw transactions..."
INS_RAW=$(bitcoin-cli -testnet4 getrawtransaction "$INS_TXID")
FUNDING_RAW=$(bitcoin-cli -testnet4 getrawtransaction "$FUNDING_TXID")

echo ""
echo "Running charms spell prove..."
echo "  Spell: $SPELL_FILE"
echo "  App WASM: $APP_WASM"
echo "  ins UTXO: $INS_UTXO"
echo "  funding UTXO: $FUNDING_UTXO"
echo "  funding value: $FUNDING_VALUE sats"
echo ""

# Run prove
PROVE_OUTPUT=$(charms spell prove \
    --spell "$SPELL_FILE" \
    --prev-txs "$INS_RAW,$FUNDING_RAW" \
    --app-bins "$APP_WASM" \
    --funding-utxo "$FUNDING_UTXO" \
    --funding-utxo-value "$FUNDING_VALUE" \
    --change-address "$CHANGE_ADDRESS" \
    --fee-rate 10.0 \
    --mock 2>&1)

# Check for success
if echo "$PROVE_OUTPUT" | grep -q "app contract satisfied"; then
    echo -e "${GREEN}✓ Spell prove successful${NC}"
else
    echo -e "${RED}✗ Spell prove failed${NC}"
    echo "$PROVE_OUTPUT"
    exit 1
fi

# Extract transaction hexes (last line should be JSON array)
TXS_JSON=$(echo "$PROVE_OUTPUT" | tail -1)

echo ""
echo "Extracting and signing transactions..."

# Save for processing
echo "$TXS_JSON" > /tmp/spell_txs.json

# Extract commit and spell tx hexes
COMMIT_HEX=$(echo "$TXS_JSON" | jq -r '.[0].bitcoin')
SPELL_HEX=$(echo "$TXS_JSON" | jq -r '.[1].bitcoin')

# Sign transactions
echo "Signing commit transaction..."
SIGNED_COMMIT=$(bitcoin-cli -testnet4 signrawtransactionwithwallet "$COMMIT_HEX" | jq -r '.hex')

echo "Signing spell transaction..."
SIGNED_SPELL=$(bitcoin-cli -testnet4 signrawtransactionwithwallet "$SPELL_HEX" | jq -r '.hex')

echo ""
echo "Submitting package to mempool..."
SUBMIT_RESULT=$(bitcoin-cli -testnet4 submitpackage "[\"$SIGNED_COMMIT\", \"$SIGNED_SPELL\"]" 2>&1)

if echo "$SUBMIT_RESULT" | grep -q '"package_msg": "success"'; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           DEPLOYMENT SUCCESSFUL!                          ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    COMMIT_TXID=$(echo "$SUBMIT_RESULT" | jq -r '.["tx-results"] | to_entries[0].value.txid')
    SPELL_TXID=$(echo "$SUBMIT_RESULT" | jq -r '.["tx-results"] | to_entries[1].value.txid')

    echo "Commit TX: $COMMIT_TXID"
    echo "Spell TX:  $SPELL_TXID"
    echo ""
    echo "Wait for confirmations, then verify with:"
    echo "  charms tx show-spell --tx \$(bitcoin-cli -testnet4 getrawtransaction $SPELL_TXID)"
else
    echo -e "${RED}✗ Package submission failed${NC}"
    echo "$SUBMIT_RESULT"
    exit 1
fi
