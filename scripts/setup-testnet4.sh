#!/bin/bash
# zkUSD Testnet4 Setup Script
# Configures environment for Bitcoin Testnet4 development

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

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Bitcoin Testnet4 Setup        ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Testnet4 Configuration
TESTNET4_MAGIC="1c163f28"
TESTNET4_PORT="48333"
TESTNET4_RPC_PORT="48332"

# Faucets
FAUCETS=(
    "https://mempool.space/testnet4/faucet"
    "https://faucet.testnet4.dev/"
    "https://coinfaucet.eu/en/btc-testnet4/"
)

# Check Bitcoin Core
check_bitcoin_core() {
    echo -e "${YELLOW}Checking Bitcoin Core...${NC}"

    if command -v bitcoind &> /dev/null; then
        local version=$(bitcoind --version 2>/dev/null | head -1)
        echo -e "${GREEN}✓ Bitcoin Core installed: $version${NC}"

        # Check version supports testnet4 (v28+)
        if [[ $version == *"v28"* ]] || [[ $version == *"v29"* ]] || [[ $version == *"v30"* ]]; then
            echo -e "${GREEN}✓ Version supports Testnet4${NC}"
        else
            echo -e "${YELLOW}⚠ Bitcoin Core v28+ recommended for Testnet4${NC}"
            echo "  Current version may not support -testnet4 flag"
        fi
    else
        echo -e "${YELLOW}⚠ Bitcoin Core not found${NC}"
        echo "  Download from: https://bitcoincore.org/en/download/"
    fi
    echo ""
}

# Check Charms CLI
check_charms() {
    echo -e "${YELLOW}Checking Charms CLI...${NC}"

    if command -v charms &> /dev/null; then
        local version=$(charms --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✓ Charms CLI installed: $version${NC}"
    else
        echo -e "${YELLOW}⚠ Charms CLI not found${NC}"
        echo "  Install: cargo install charms-sdk"
        echo "  Or download from: https://github.com/CharmsDev/charms"
    fi
    echo ""
}

# Generate bitcoin.conf for testnet4
generate_bitcoin_conf() {
    echo -e "${YELLOW}Generating bitcoin.conf for Testnet4...${NC}"

    local conf_dir="$HOME/.bitcoin"
    local conf_file="$conf_dir/bitcoin.conf"

    mkdir -p "$conf_dir"

    # Backup existing config
    if [ -f "$conf_file" ]; then
        cp "$conf_file" "$conf_file.backup.$(date +%s)"
        echo -e "  Backed up existing config"
    fi

    cat > "$conf_file" << EOF
# Bitcoin Testnet4 Configuration for zkUSD Development
# Generated: $(date)

# Network
testnet4=1

# RPC Settings
server=1
rpcuser=zkusd
rpcpassword=$(openssl rand -hex 16)
rpcallowip=127.0.0.1
rpcport=$TESTNET4_RPC_PORT

# Performance
dbcache=450
maxmempool=300

# Wallet
disablewallet=0

# Index (needed for Charms)
txindex=1

# Logging
debug=0
printtoconsole=0
EOF

    echo -e "${GREEN}✓ bitcoin.conf generated at $conf_file${NC}"
    echo ""
}

# Create environment file
create_env_file() {
    echo -e "${YELLOW}Creating environment file...${NC}"

    cat > "$PROJECT_ROOT/.env.testnet4" << EOF
# zkUSD Testnet4 Environment Configuration
# Source this file: source .env.testnet4

export NETWORK=testnet4
export BITCOIN_NETWORK=testnet4
export BITCOIN_RPC_URL=http://127.0.0.1:$TESTNET4_RPC_PORT
export BITCOIN_RPC_USER=zkusd
export BITCOIN_RPC_PASS=$(grep rpcpassword ~/.bitcoin/bitcoin.conf 2>/dev/null | cut -d= -f2 || echo "changeme")

# Charms Configuration
export CHARMS_NETWORK=testnet4
export CHARMS_CLI=charms

# zkUSD Configuration
export ZKUSD_MIN_COLLATERAL_RATIO=110
export ZKUSD_CRITICAL_RATIO=150

# Mempool API for testnet4
export MEMPOOL_API=https://mempool.space/testnet4/api
EOF

    echo -e "${GREEN}✓ Environment file created: .env.testnet4${NC}"
    echo "  Run: source .env.testnet4"
    echo ""
}

# Print faucet info
print_faucets() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  Testnet4 Faucets              ${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
    echo "Get test BTC from these faucets:"
    echo ""
    for faucet in "${FAUCETS[@]}"; do
        echo -e "  ${CYAN}→ $faucet${NC}"
    done
    echo ""
}

# Print next steps
print_next_steps() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  Next Steps                    ${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
    echo "1. Start Bitcoin Core in Testnet4 mode:"
    echo -e "   ${CYAN}bitcoind -testnet4 -daemon${NC}"
    echo ""
    echo "2. Wait for sync (check with):"
    echo -e "   ${CYAN}bitcoin-cli -testnet4 getblockchaininfo${NC}"
    echo ""
    echo "3. Create a wallet:"
    echo -e "   ${CYAN}bitcoin-cli -testnet4 createwallet \"zkusd\"${NC}"
    echo ""
    echo "4. Get a receiving address:"
    echo -e "   ${CYAN}bitcoin-cli -testnet4 getnewaddress \"\" bech32m${NC}"
    echo ""
    echo "5. Get test BTC from faucets (see above)"
    echo ""
    echo "6. Source environment and build zkUSD:"
    echo -e "   ${CYAN}source .env.testnet4${NC}"
    echo -e "   ${CYAN}./scripts/build.sh${NC}"
    echo ""
    echo "7. Deploy to testnet4:"
    echo -e "   ${CYAN}./scripts/deploy.sh --network testnet4${NC}"
}

# Main
main() {
    check_bitcoin_core
    check_charms
    generate_bitcoin_conf
    create_env_file
    print_faucets
    print_next_steps
}

main
