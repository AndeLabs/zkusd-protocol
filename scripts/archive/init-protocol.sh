#!/bin/bash
# zkUSD Protocol Initialization Script
# Initializes the protocol after deployment

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

# Protocol Parameters (can be overridden via environment)
INITIAL_BTC_PRICE="${INITIAL_BTC_PRICE:-10000000000000}"  # $100,000 with 8 decimals
MCR="${MCR:-11000}"                                        # 110% in basis points
CCR="${CCR:-15000}"                                        # 150% in basis points
MIN_DEBT="${MIN_DEBT:-200000000000}"                       # 2,000 zkUSD minimum
BORROWING_FEE="${BORROWING_FEE:-50}"                       # 0.5% in basis points

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD Protocol Initialization ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "Network: ${CYAN}$NETWORK${NC}"
echo ""

# Check deployment exists
check_deployment() {
    local deploy_dir="$PROJECT_ROOT/deployments/${NETWORK}"

    if [ ! -d "$deploy_dir" ]; then
        echo -e "${RED}Error: No deployment found for network '$NETWORK'${NC}"
        echo "Run ./scripts/deploy.sh first"
        exit 1
    fi

    # Check all required VK files exist
    local contracts=("price-oracle" "zkusd-token" "stability-pool" "vault-manager")
    for contract in "${contracts[@]}"; do
        if [ ! -f "$deploy_dir/${contract}.vk" ]; then
            echo -e "${RED}Error: Missing deployment for $contract${NC}"
            exit 1
        fi
    done

    echo -e "${GREEN}✓ All deployments found${NC}"
}

# Initialize oracle with price
init_oracle() {
    echo -e "${BLUE}[1/4] Initializing Price Oracle...${NC}"

    local oracle_vk=$(cat "$PROJECT_ROOT/deployments/${NETWORK}/price-oracle.vk")

    echo -e "  Initial BTC Price: \$$(echo "scale=2; $INITIAL_BTC_PRICE / 100000000" | bc)"

    # In production, this would create the actual transaction
    # For now, we document the required steps
    cat > "$PROJECT_ROOT/deployments/${NETWORK}/oracle-init.json" << EOF
{
    "operation": "UpdatePrice",
    "app_vk": "$oracle_vk",
    "params": {
        "price": $INITIAL_BTC_PRICE,
        "timestamp": $(date +%s)
    }
}
EOF

    echo -e "${GREEN}✓ Oracle initialization prepared${NC}"
    echo "  Config: $PROJECT_ROOT/deployments/${NETWORK}/oracle-init.json"
    echo ""
}

# Configure protocol parameters
configure_protocol() {
    echo -e "${BLUE}[2/4] Configuring Protocol Parameters...${NC}"

    cat > "$PROJECT_ROOT/deployments/${NETWORK}/protocol-config.json" << EOF
{
    "network": "$NETWORK",
    "parameters": {
        "mcr_bps": $MCR,
        "ccr_bps": $CCR,
        "min_debt": $MIN_DEBT,
        "borrowing_fee_bps": $BORROWING_FEE,
        "redemption_fee_bps": 50,
        "liquidation_bonus_bps": 50
    },
    "contracts": {
        "price_oracle": "$(cat $PROJECT_ROOT/deployments/${NETWORK}/price-oracle.vk)",
        "zkusd_token": "$(cat $PROJECT_ROOT/deployments/${NETWORK}/zkusd-token.vk)",
        "stability_pool": "$(cat $PROJECT_ROOT/deployments/${NETWORK}/stability-pool.vk)",
        "vault_manager": "$(cat $PROJECT_ROOT/deployments/${NETWORK}/vault-manager.vk)"
    },
    "initialized_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo -e "${GREEN}✓ Protocol configuration saved${NC}"
    echo "  Config: $PROJECT_ROOT/deployments/${NETWORK}/protocol-config.json"
    echo ""
}

# Setup admin roles
setup_roles() {
    echo -e "${BLUE}[3/4] Setting up Admin Roles...${NC}"

    # Prompt for admin address
    echo -e "${YELLOW}Enter the admin public key (hex, 32 bytes):${NC}"
    read -r ADMIN_PUBKEY

    if [ -z "$ADMIN_PUBKEY" ]; then
        ADMIN_PUBKEY="0000000000000000000000000000000000000000000000000000000000000001"
        echo -e "${YELLOW}Using placeholder admin key${NC}"
    fi

    cat > "$PROJECT_ROOT/deployments/${NETWORK}/roles.json" << EOF
{
    "super_admin": "$ADMIN_PUBKEY",
    "oracle_operator": "$ADMIN_PUBKEY",
    "emergency_operator": "$ADMIN_PUBKEY",
    "guardian": null,
    "fee_collector": "$ADMIN_PUBKEY"
}
EOF

    echo -e "${GREEN}✓ Roles configured${NC}"
    echo ""
}

# Generate deployment summary
generate_summary() {
    echo -e "${BLUE}[4/4] Generating Deployment Summary...${NC}"

    cat > "$PROJECT_ROOT/deployments/${NETWORK}/README.md" << EOF
# zkUSD Deployment - $NETWORK

## Deployment Information

- **Network**: $NETWORK
- **Deployed**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- **Initial BTC Price**: \$$(echo "scale=2; $INITIAL_BTC_PRICE / 100000000" | bc)

## Contract Verification Keys

| Contract | VK |
|----------|-----|
| Price Oracle | \`$(cat $PROJECT_ROOT/deployments/${NETWORK}/price-oracle.vk | head -c 32)...\` |
| zkUSD Token | \`$(cat $PROJECT_ROOT/deployments/${NETWORK}/zkusd-token.vk | head -c 32)...\` |
| Stability Pool | \`$(cat $PROJECT_ROOT/deployments/${NETWORK}/stability-pool.vk | head -c 32)...\` |
| Vault Manager | \`$(cat $PROJECT_ROOT/deployments/${NETWORK}/vault-manager.vk | head -c 32)...\` |

## Protocol Parameters

- **MCR**: ${MCR} bps ($(echo "scale=1; $MCR / 100" | bc)%)
- **CCR**: ${CCR} bps ($(echo "scale=1; $CCR / 100" | bc)%)
- **Min Debt**: $(echo "scale=0; $MIN_DEBT / 100000000" | bc) zkUSD
- **Borrowing Fee**: ${BORROWING_FEE} bps ($(echo "scale=2; $BORROWING_FEE / 100" | bc)%)

## Files

- \`protocol-config.json\` - Full protocol configuration
- \`oracle-init.json\` - Oracle initialization parameters
- \`roles.json\` - Admin role assignments
- \`*.vk\` - Contract verification keys

## Usage

### Update Oracle Price
\`\`\`bash
charms spell cast --app price-oracle --data '{"op":"UpdatePrice","price":...}'
\`\`\`

### Open a Vault
\`\`\`bash
charms spell cast --app vault-manager --data '{"op":"OpenVault","collateral":...,"debt":...}'
\`\`\`

EOF

    echo -e "${GREEN}✓ Summary generated${NC}"
    echo "  File: $PROJECT_ROOT/deployments/${NETWORK}/README.md"
    echo ""
}

# Main
main() {
    check_deployment
    echo ""
    init_oracle
    configure_protocol
    setup_roles
    generate_summary

    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}  Initialization Complete!      ${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "${YELLOW}Important:${NC}"
    echo "  1. Review the configuration files in deployments/${NETWORK}/"
    echo "  2. Update admin addresses before going live"
    echo "  3. Fund the oracle operator address with tBTC for updates"
    echo ""
    echo -e "${CYAN}To interact with the protocol:${NC}"
    echo "  ./scripts/zkusd-cli.sh --help"
}

main
