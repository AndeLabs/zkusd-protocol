#!/bin/bash
# zkUSD Charm Deployment Script
# Uses Bitcoin Core for proper transaction package submission

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

BITCOIN_CLI="/opt/homebrew/opt/bitcoin/bin/bitcoin-cli -testnet4"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD Charm Deployment        ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Check Bitcoin Core is running and synced
check_bitcoin_core() {
    echo -e "${BLUE}Checking Bitcoin Core...${NC}"

    if ! $BITCOIN_CLI getblockchaininfo &>/dev/null; then
        echo -e "${RED}Error: Bitcoin Core not running${NC}"
        echo "Start it with: /opt/homebrew/opt/bitcoin/bin/bitcoind -daemon -testnet4"
        exit 1
    fi

    local blocks=$($BITCOIN_CLI getblockchaininfo | grep '"blocks"' | grep -o '[0-9]*')
    local headers=$($BITCOIN_CLI getblockchaininfo | grep '"headers"' | grep -o '[0-9]*')
    local ibd=$($BITCOIN_CLI getblockchaininfo | grep '"initialblockdownload"' | grep -o 'true\|false')

    echo -e "  Blocks: ${CYAN}$blocks / $headers${NC}"

    if [ "$ibd" = "true" ]; then
        local pct=$((blocks * 100 / headers))
        echo -e "${YELLOW}⚠ Initial block download in progress ($pct%)${NC}"
        echo "  Waiting for sync to complete..."

        while [ "$ibd" = "true" ]; do
            sleep 30
            blocks=$($BITCOIN_CLI getblockchaininfo | grep '"blocks"' | grep -o '[0-9]*')
            headers=$($BITCOIN_CLI getblockchaininfo | grep '"headers"' | grep -o '[0-9]*')
            ibd=$($BITCOIN_CLI getblockchaininfo | grep '"initialblockdownload"' | grep -o 'true\|false')
            pct=$((blocks * 100 / headers))
            echo -ne "\r  Syncing: $blocks / $headers ($pct%)    "
        done
        echo ""
    fi

    echo -e "${GREEN}✓ Bitcoin Core synced${NC}"
}

# Load wallet info
load_wallet() {
    WALLET_FILE="$PROJECT_ROOT/deployments/testnet4/wallet.json"

    if [ ! -f "$WALLET_FILE" ]; then
        echo -e "${RED}Error: Wallet not found${NC}"
        exit 1
    fi

    ADDRESS=$(python3 -c "import json; print(json.load(open('$WALLET_FILE'))['address'])")
    UTXO_TXID=$(python3 -c "import json; print(json.load(open('$WALLET_FILE'))['utxo']['txid'])")
    UTXO_VOUT=$(python3 -c "import json; print(json.load(open('$WALLET_FILE'))['utxo']['vout'])")
    UTXO_VALUE=$(python3 -c "import json; print(json.load(open('$WALLET_FILE'))['utxo']['value'])")

    echo -e "Wallet: ${CYAN}$ADDRESS${NC}"
    echo -e "UTXO: ${CYAN}${UTXO_TXID}:${UTXO_VOUT}${NC} (${UTXO_VALUE} sats)"
}

# Generate and submit charm
deploy_charm() {
    echo ""
    echo -e "${BLUE}Generating charm transactions...${NC}"

    cd /tmp/charms-test/test-oracle

    # Set up environment
    export app_vk=$(charms app vk 2>/dev/null | tail -1)
    export funding_utxo="${UTXO_TXID}:${UTXO_VOUT}"
    export app_id=$(echo -n "$funding_utxo" | shasum -a 256 | cut -d' ' -f1)
    export in_utxo_0="$funding_utxo"
    export addr_0="$ADDRESS"

    echo -e "  App VK: ${CYAN}${app_vk:0:16}...${NC}"
    echo -e "  App ID: ${CYAN}${app_id:0:16}...${NC}"

    # Get previous transaction from Bitcoin Core
    echo -e "${BLUE}Fetching previous transaction...${NC}"
    local prev_tx=$($BITCOIN_CLI getrawtransaction "$UTXO_TXID" 2>/dev/null)

    if [ -z "$prev_tx" ]; then
        echo -e "${YELLOW}Transaction not in local node, fetching from mempool.space...${NC}"
        prev_tx=$(curl -s "https://mempool.space/testnet4/api/tx/${UTXO_TXID}/hex")
    fi

    # Build app
    local app_bins=$(charms app build 2>&1 | tail -1)

    # Generate spell transactions
    echo -e "${BLUE}Proving spell (ZK proof generation)...${NC}"

    local output=$(cat ./spells/mint-nft.yaml | envsubst '$app_id $app_vk $in_utxo_0 $addr_0' | \
        charms spell prove \
            --prev-txs="$prev_tx" \
            --app-bins="$app_bins" \
            --funding-utxo="$funding_utxo" \
            --funding-utxo-value="$UTXO_VALUE" \
            --change-address="$ADDRESS" \
            --fee-rate=2 \
            2>&1)

    # Extract JSON
    local json_line=$(echo "$output" | grep '^\[{')

    if [ -z "$json_line" ]; then
        echo -e "${RED}Error generating transactions:${NC}"
        echo "$output"
        exit 1
    fi

    echo -e "${GREEN}✓ ZK proof generated${NC}"

    # Parse transactions
    local commit_tx=$(echo "$json_line" | python3 -c "import json,sys; txs=json.load(sys.stdin); print(txs[0]['bitcoin'])")
    local reveal_tx=$(echo "$json_line" | python3 -c "import json,sys; txs=json.load(sys.stdin); print(txs[1]['bitcoin'])")

    # Submit as package
    echo -e "${BLUE}Submitting transaction package...${NC}"

    local result=$($BITCOIN_CLI submitpackage "[\"$commit_tx\", \"$reveal_tx\"]" 2>&1)

    echo "$result"

    # Check for success
    if echo "$result" | grep -q '"package_msg": "success"'; then
        echo ""
        echo -e "${GREEN}================================${NC}"
        echo -e "${GREEN}  Charm Deployed Successfully!  ${NC}"
        echo -e "${GREEN}================================${NC}"

        # Extract txids
        local reveal_txid=$(echo "$result" | python3 -c "import json,sys; r=json.load(sys.stdin); print(list(r['tx-results'].keys())[-1])" 2>/dev/null || echo "")

        if [ -n "$reveal_txid" ]; then
            echo ""
            echo -e "View: ${CYAN}https://mempool.space/testnet4/tx/$reveal_txid${NC}"
        fi
    else
        echo -e "${RED}Package submission failed${NC}"
        echo "$result"
    fi
}

# Main
check_bitcoin_core
load_wallet
deploy_charm
