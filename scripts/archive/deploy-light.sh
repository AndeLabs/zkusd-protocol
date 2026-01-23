#!/bin/bash
# zkUSD Light Deployment Script
# Deploys using mempool.space API - NO Bitcoin Core required!

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
NETWORK="${NETWORK:-testnet4}"
MEMPOOL_API="https://mempool.space/testnet4/api"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD Light Deploy (No Node)  ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "Network: ${CYAN}$NETWORK${NC}"
echo -e "API: ${CYAN}$MEMPOOL_API${NC}"
echo ""

# Check dependencies
check_deps() {
    echo -e "${YELLOW}Checking dependencies...${NC}"

    if ! command -v charms &> /dev/null; then
        echo -e "${RED}Error: Charms CLI not installed${NC}"
        echo "Run: cargo install --locked charms"
        exit 1
    fi
    echo -e "${GREEN}✓ Charms CLI: $(charms --version)${NC}"

    if ! command -v curl &> /dev/null; then
        echo -e "${RED}Error: curl not installed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ curl installed${NC}"

    if ! command -v jq &> /dev/null; then
        echo -e "${YELLOW}⚠ jq not installed (optional but recommended)${NC}"
        echo "  Install: brew install jq"
    else
        echo -e "${GREEN}✓ jq installed${NC}"
    fi

    echo ""
}

# Get address balance and UTXOs from mempool.space
get_address_info() {
    local address=$1
    echo -e "${BLUE}Fetching address info from mempool.space...${NC}"

    local response=$(curl -s "$MEMPOOL_API/address/$address")
    local utxos=$(curl -s "$MEMPOOL_API/address/$address/utxo")

    if [ -z "$response" ] || [ "$response" = "[]" ]; then
        echo -e "${RED}Error fetching address info${NC}"
        return 1
    fi

    echo "$utxos"
}

# Get recommended fee rate
get_fee_rate() {
    local fees=$(curl -s "$MEMPOOL_API/v1/fees/recommended")
    echo "$fees" | grep -o '"halfHourFee":[0-9]*' | grep -o '[0-9]*'
}

# Broadcast transaction
broadcast_tx() {
    local tx_hex=$1
    echo -e "${BLUE}Broadcasting transaction...${NC}"

    local txid=$(curl -s -X POST "$MEMPOOL_API/tx" -d "$tx_hex")

    if [[ $txid =~ ^[a-f0-9]{64}$ ]]; then
        echo -e "${GREEN}✓ Transaction broadcast: $txid${NC}"
        echo "  View: https://mempool.space/testnet4/tx/$txid"
        echo "$txid"
    else
        echo -e "${RED}Error broadcasting: $txid${NC}"
        return 1
    fi
}

# Interactive wallet setup
setup_wallet() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  Wallet Setup                  ${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""

    # Check for existing wallet file
    local wallet_file="$PROJECT_ROOT/deployments/$NETWORK/wallet.json"
    mkdir -p "$PROJECT_ROOT/deployments/$NETWORK"

    if [ -f "$wallet_file" ]; then
        echo -e "${GREEN}✓ Existing wallet found${NC}"
        cat "$wallet_file" | head -5
        echo ""
        read -p "Use this wallet? (Y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            rm "$wallet_file"
        else
            return 0
        fi
    fi

    echo -e "${YELLOW}You need a Testnet4 wallet with tBTC${NC}"
    echo ""
    echo "Options:"
    echo "  1. Generate new address (you'll need to fund it)"
    echo "  2. Enter existing address"
    echo ""
    read -p "Choose (1/2): " choice

    case $choice in
        1)
            echo -e "${YELLOW}Generating new Testnet4 address...${NC}"
            # For now, we'll ask them to use an external wallet
            echo ""
            echo -e "${CYAN}Recommended wallets for Testnet4:${NC}"
            echo "  • Sparrow Wallet: https://sparrowwallet.com"
            echo "  • Electrum: https://electrum.org (with testnet4 server)"
            echo ""
            echo "After creating a wallet, come back with your address."
            read -p "Enter your Testnet4 address (tb1...): " address
            ;;
        2)
            read -p "Enter your Testnet4 address (tb1...): " address
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac

    # Validate address format
    if [[ ! $address =~ ^tb1 ]]; then
        echo -e "${RED}Invalid Testnet4 address (should start with tb1)${NC}"
        exit 1
    fi

    # Save wallet info
    cat > "$wallet_file" << EOF
{
    "network": "$NETWORK",
    "address": "$address",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo -e "${GREEN}✓ Wallet saved to $wallet_file${NC}"
    echo ""

    # Check balance
    echo -e "${BLUE}Checking balance...${NC}"
    local utxos=$(get_address_info "$address")
    local utxo_count=$(echo "$utxos" | grep -o '"txid"' | wc -l | tr -d ' ')

    if [ "$utxo_count" -eq 0 ]; then
        echo -e "${YELLOW}⚠ No UTXOs found. You need to fund this address.${NC}"
        echo ""
        echo -e "${CYAN}Get testnet BTC from:${NC}"
        echo "  → https://mempool.space/testnet4/faucet"
        echo "  → https://faucet.testnet4.dev/"
        echo ""
        echo "Send at least 0.001 BTC (100,000 sats) for deployment fees."
        echo ""
        read -p "Press Enter after funding your wallet..."

        # Re-check
        utxos=$(get_address_info "$address")
        utxo_count=$(echo "$utxos" | grep -o '"txid"' | wc -l | tr -d ' ')

        if [ "$utxo_count" -eq 0 ]; then
            echo -e "${RED}Still no UTXOs. Waiting for confirmation...${NC}"
            exit 1
        fi
    fi

    echo -e "${GREEN}✓ Found $utxo_count UTXO(s)${NC}"
    echo "$utxos" | head -20
}

# Deploy an app
deploy_app() {
    local app_name=$1
    local app_path=$2

    echo -e "${BLUE}Deploying $app_name...${NC}"

    cd "$PROJECT_ROOT/$app_path"

    # Build with charms
    charms app build

    # Get VK (mock mode for now since full proving requires more setup)
    echo -e "  ${YELLOW}Note: Full deployment requires SP1 proving setup${NC}"
    echo -e "  ${YELLOW}Using mock mode for demonstration${NC}"

    # Save build info
    local deploy_dir="$PROJECT_ROOT/deployments/$NETWORK"
    mkdir -p "$deploy_dir"

    echo "{
    \"app\": \"$app_name\",
    \"path\": \"$app_path\",
    \"wasm\": \"target/wasm32-wasip1/release/${app_name//-/_}.wasm\",
    \"deployed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"network\": \"$NETWORK\"
}" > "$deploy_dir/${app_name}.json"

    echo -e "${GREEN}✓ $app_name prepared${NC}"
}

# Main deployment flow
main() {
    check_deps
    setup_wallet

    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  Building Apps                 ${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""

    # Build all apps
    deploy_app "price-oracle" "contracts/price-oracle"
    deploy_app "zkusd-token" "contracts/zkusd-token"
    deploy_app "stability-pool" "contracts/stability-pool"
    deploy_app "vault-manager" "contracts/vault-manager"

    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}  Deployment Summary            ${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "Apps built and ready for deployment:"
    ls -la "$PROJECT_ROOT/deployments/$NETWORK/"*.json 2>/dev/null || echo "  (check deployments/$NETWORK/)"
    echo ""
    echo -e "${YELLOW}Next Steps for Full Deployment:${NC}"
    echo ""
    echo "1. Install SP1 proving system:"
    echo "   curl -L https://sp1.succinct.xyz | bash"
    echo "   sp1up"
    echo ""
    echo "2. Generate verification keys:"
    echo "   charms app vk"
    echo ""
    echo "3. Create and prove spells:"
    echo "   charms spell prove --funding-utxo <txid:vout> \\"
    echo "     --funding-utxo-value <sats> \\"
    echo "     --change-address <your_address>"
    echo ""
    echo -e "${CYAN}Mempool Explorer:${NC}"
    echo "  https://mempool.space/testnet4"
    echo ""
}

# Run
main "$@"
