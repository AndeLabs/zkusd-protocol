#!/bin/bash
# zkUSD Wallet Balance Checker
# Monitors the Testnet4 wallet for incoming funds

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WALLET_FILE="$PROJECT_ROOT/deployments/testnet4/wallet.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get address from wallet file
if [ ! -f "$WALLET_FILE" ]; then
    echo -e "${YELLOW}No wallet found. Run: python3 scripts/generate-wallet.py${NC}"
    exit 1
fi

ADDRESS=$(grep '"address"' "$WALLET_FILE" | cut -d'"' -f4)

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD Wallet Balance Checker  ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "Address: ${CYAN}$ADDRESS${NC}"
echo ""

# Check balance
echo -e "${BLUE}Fetching balance from mempool.space...${NC}"
RESPONSE=$(curl -s "https://mempool.space/testnet4/api/address/$ADDRESS")
UTXOS=$(curl -s "https://mempool.space/testnet4/api/address/$ADDRESS/utxo")

# Parse balance
FUNDED=$(echo "$RESPONSE" | grep -o '"funded_txo_sum":[0-9]*' | head -1 | grep -o '[0-9]*')
SPENT=$(echo "$RESPONSE" | grep -o '"spent_txo_sum":[0-9]*' | head -1 | grep -o '[0-9]*')
TX_COUNT=$(echo "$RESPONSE" | grep -o '"tx_count":[0-9]*' | head -1 | grep -o '[0-9]*')

# Calculate balance
if [ -z "$FUNDED" ]; then FUNDED=0; fi
if [ -z "$SPENT" ]; then SPENT=0; fi
BALANCE=$((FUNDED - SPENT))

# Convert to BTC
BTC=$(echo "scale=8; $BALANCE / 100000000" | bc)

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "  Balance: ${CYAN}$BALANCE sats${NC} (${BTC} tBTC)"
echo -e "  Transactions: ${CYAN}$TX_COUNT${NC}"
echo -e "${GREEN}================================${NC}"
echo ""

# Show UTXOs
if [ "$UTXOS" != "[]" ]; then
    echo -e "${GREEN}UTXOs available for spending:${NC}"
    echo "$UTXOS" | python3 -c "
import json, sys
utxos = json.load(sys.stdin)
for i, u in enumerate(utxos):
    print(f\"  {i+1}. {u['txid']}:{u['vout']} - {u['value']} sats\")
" 2>/dev/null || echo "$UTXOS"
    echo ""
else
    echo -e "${YELLOW}No UTXOs found. Wallet needs funding.${NC}"
    echo ""
    echo -e "${CYAN}Fund your wallet:${NC}"
    echo "  1. Go to: https://faucet.testnet4.dev/"
    echo "  2. Enter address: $ADDRESS"
    echo "  3. Complete CAPTCHA and submit"
    echo ""
    echo -e "${CYAN}Or use mempool.space faucet:${NC}"
    echo "  https://mempool.space/testnet4/faucet"
    echo ""
fi

echo -e "View on explorer: ${CYAN}https://mempool.space/testnet4/address/$ADDRESS${NC}"
echo ""
