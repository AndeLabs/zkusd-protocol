#!/bin/bash
# zkUSD Deployment Script
# Deploys zkUSD protocol to Bitcoin Testnet4

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
NETWORK="${NETWORK:-testnet4}"
CHARMS_CLI="${CHARMS_CLI:-charms}"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD Protocol Deployment     ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "Network: ${CYAN}$NETWORK${NC}"
echo ""

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check charms CLI
    if ! command -v $CHARMS_CLI &> /dev/null; then
        echo -e "${RED}Error: Charms CLI not found${NC}"
        echo "Install: cargo install charms-sdk"
        echo "Or set CHARMS_CLI environment variable to the charms binary path"
        exit 1
    fi
    echo -e "${GREEN}✓ Charms CLI found: $($CHARMS_CLI --version 2>/dev/null || echo 'unknown version')${NC}"

    # Check if contracts are built
    if [ ! -d "$PROJECT_ROOT/target/release" ]; then
        echo -e "${RED}Error: Contracts not built. Run ./scripts/build.sh first${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Build artifacts found${NC}"

    echo ""
}

# Deploy a single contract
deploy_contract() {
    local contract_name=$1
    local contract_path=$2

    echo -e "${BLUE}Deploying $contract_name...${NC}"

    # Build the app with charms
    cd "$PROJECT_ROOT/$contract_path"
    $CHARMS_CLI app build

    # Get verification key
    local vk=$($CHARMS_CLI app vk)
    echo -e "  Verification Key: ${CYAN}${vk:0:20}...${NC}"

    # Store VK for later use
    echo "$vk" > "$PROJECT_ROOT/deployments/${NETWORK}/${contract_name}.vk"

    echo -e "${GREEN}✓ $contract_name deployed${NC}"
    echo ""
}

# Create deployment directory
setup_deployment_dir() {
    local deploy_dir="$PROJECT_ROOT/deployments/${NETWORK}"
    mkdir -p "$deploy_dir"
    echo -e "${GREEN}✓ Deployment directory: $deploy_dir${NC}"
    echo ""
}

# Main deployment sequence
main() {
    check_prerequisites
    setup_deployment_dir

    echo -e "${YELLOW}Starting deployment sequence...${NC}"
    echo ""

    # 1. Deploy Price Oracle (no dependencies)
    deploy_contract "price-oracle" "contracts/price-oracle"

    # 2. Deploy zkUSD Token
    deploy_contract "zkusd-token" "contracts/zkusd-token"

    # 3. Deploy Stability Pool
    deploy_contract "stability-pool" "contracts/stability-pool"

    # 4. Deploy Vault Manager (depends on all above)
    deploy_contract "vault-manager" "contracts/vault-manager"

    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}  Deployment Complete!          ${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "  1. Initialize the oracle with initial BTC price"
    echo "  2. Set protocol parameters"
    echo "  3. Run ./scripts/init-protocol.sh"
    echo ""
    echo -e "${CYAN}Deployment artifacts saved to:${NC}"
    echo "  $PROJECT_ROOT/deployments/${NETWORK}/"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --help)
            echo "Usage: ./deploy.sh [--network testnet4|signet|mainnet]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate network
case $NETWORK in
    testnet4|signet|mainnet)
        ;;
    *)
        echo -e "${RED}Error: Invalid network '$NETWORK'${NC}"
        echo "Valid networks: testnet4, signet, mainnet"
        exit 1
        ;;
esac

# Warning for mainnet
if [ "$NETWORK" == "mainnet" ]; then
    echo -e "${RED}WARNING: You are deploying to MAINNET!${NC}"
    echo -e "${RED}This will use REAL BTC for transactions.${NC}"
    read -p "Are you sure? (yes/NO) " -r
    if [[ ! $REPLY == "yes" ]]; then
        echo "Aborting."
        exit 1
    fi
fi

main
