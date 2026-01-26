#!/bin/bash
# zkUSD - Wait for Wallet Funding
# Monitors the wallet and waits for incoming testnet BTC

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WALLET_FILE="$PROJECT_ROOT/deployments/testnet4/wallet.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get address
ADDRESS=$(grep '"address"' "$WALLET_FILE" | cut -d'"' -f4)

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Waiting for Wallet Funding    ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "Address: ${CYAN}$ADDRESS${NC}"
echo ""
echo -e "${YELLOW}Please fund this wallet from a faucet:${NC}"
echo ""
echo "  Option 1: https://faucet.testnet4.dev/"
echo "  Option 2: https://mempool.space/testnet4/faucet"
echo ""
echo "Copy address: $ADDRESS"
echo ""
echo -e "${BLUE}Monitoring for incoming funds...${NC}"
echo "(Press Ctrl+C to cancel)"
echo ""

# Monitor loop
INTERVAL=10
ATTEMPTS=0
MAX_ATTEMPTS=180  # 30 minutes max

while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    RESPONSE=$(curl -s "https://mempool.space/testnet4/api/address/$ADDRESS")

    # Check confirmed balance
    FUNDED=$(echo "$RESPONSE" | grep -o '"funded_txo_sum":[0-9]*' | head -1 | grep -o '[0-9]*')
    SPENT=$(echo "$RESPONSE" | grep -o '"spent_txo_sum":[0-9]*' | head -1 | grep -o '[0-9]*')

    if [ -z "$FUNDED" ]; then FUNDED=0; fi
    if [ -z "$SPENT" ]; then SPENT=0; fi

    BALANCE=$((FUNDED - SPENT))

    # Check mempool (unconfirmed)
    MEMPOOL_FUNDED=$(echo "$RESPONSE" | grep -o '"mempool_stats":{"funded_txo_count":[0-9]*,"funded_txo_sum":[0-9]*' | grep -o 'funded_txo_sum":[0-9]*' | grep -o '[0-9]*')
    if [ -z "$MEMPOOL_FUNDED" ]; then MEMPOOL_FUNDED=0; fi

    TOTAL=$((BALANCE + MEMPOOL_FUNDED))

    if [ $TOTAL -gt 0 ]; then
        echo ""
        echo -e "${GREEN}================================${NC}"
        echo -e "${GREEN}  Funds Received!               ${NC}"
        echo -e "${GREEN}================================${NC}"
        echo ""

        if [ $BALANCE -gt 0 ]; then
            BTC=$(echo "scale=8; $BALANCE / 100000000" | bc)
            echo -e "Confirmed: ${GREEN}$BALANCE sats${NC} ($BTC tBTC)"
        fi

        if [ $MEMPOOL_FUNDED -gt 0 ]; then
            MBTC=$(echo "scale=8; $MEMPOOL_FUNDED / 100000000" | bc)
            echo -e "Pending:   ${YELLOW}$MEMPOOL_FUNDED sats${NC} ($MBTC tBTC)"
        fi

        echo ""
        echo -e "View: ${CYAN}https://mempool.space/testnet4/address/$ADDRESS${NC}"
        echo ""

        # Get UTXOs
        UTXOS=$(curl -s "https://mempool.space/testnet4/api/address/$ADDRESS/utxo")
        if [ "$UTXOS" != "[]" ]; then
            echo -e "${GREEN}Available UTXOs:${NC}"
            echo "$UTXOS" | python3 -c "
import json, sys
utxos = json.load(sys.stdin)
for i, u in enumerate(utxos):
    status = 'confirmed' if u.get('status', {}).get('confirmed', False) else 'pending'
    print(f\"  {u['txid']}:{u['vout']} - {u['value']} sats ({status})\")
" 2>/dev/null || echo "$UTXOS"
        fi

        echo ""
        echo -e "${GREEN}Ready for deployment!${NC}"
        echo "Run: make deploy-light"
        echo ""
        exit 0
    fi

    # Show progress
    printf "\r  Checking... (attempt %d/%d, balance: %d sats)  " $((ATTEMPTS + 1)) $MAX_ATTEMPTS $TOTAL

    ATTEMPTS=$((ATTEMPTS + 1))
    sleep $INTERVAL
done

echo ""
echo -e "${YELLOW}Timeout: No funds received after 30 minutes.${NC}"
echo "Please try again or check the faucet status."
exit 1
