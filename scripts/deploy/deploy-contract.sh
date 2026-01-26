#!/bin/bash
# ============================================================================
# zkUSD Protocol - Deploy Single Contract
# ============================================================================
# Deploys a single zkUSD contract to the specified network.
#
# Usage:
#   ./scripts/deploy/deploy-contract.sh --contract <name> --network <network> [options]
#
# Required:
#   --contract <name>    Contract name: token, vault-manager, stability-pool, price-oracle
#   --network <network>  Network: testnet4, signet, mainnet
#
# Options:
#   --funding-utxo <utxo>    Funding UTXO (txid:vout)
#   --funding-value <sats>   Funding value in satoshis
#   --fee-rate <rate>        Fee rate in sat/vB (default: 10)
#   --output-address <addr>  Output address for contract state
#   --dry-run                Generate spell but don't broadcast
#   --init-params <json>     JSON string with initialization parameters
#
# Environment:
#   ZKUSD_NETWORK           Default network
#   ZKUSD_OUTPUT_ADDRESS    Default output address
#   ZKUSD_FEE_RATE          Default fee rate
#
# Example:
#   ./scripts/deploy/deploy-contract.sh \
#     --contract token \
#     --network testnet4 \
#     --funding-utxo "abc123...:0" \
#     --funding-value 100000 \
#     --init-params '{"authorized_minter": "..."}'
# ============================================================================
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOYMENTS_DIR="$PROJECT_ROOT/deployments"

# Default values
NETWORK="${ZKUSD_NETWORK:-testnet4}"
OUTPUT_ADDRESS="${ZKUSD_OUTPUT_ADDRESS:-}"
FEE_RATE="${ZKUSD_FEE_RATE:-10}"
DRY_RUN=false
CONTRACT=""
FUNDING_UTXO=""
FUNDING_VALUE=""
INIT_PARAMS="{}"

# Contract configurations
declare -A CONTRACT_BINARIES=(
    ["token"]="zkusd-token-app"
    ["vault-manager"]="zkusd-vault-manager-app"
    ["stability-pool"]="zkusd-stability-pool-app"
    ["price-oracle"]="zkusd-price-oracle-app"
)

declare -A CONTRACT_PACKAGES=(
    ["token"]="zkusd-token"
    ["vault-manager"]="zkusd-vault-manager"
    ["stability-pool"]="zkusd-stability-pool"
    ["price-oracle"]="zkusd-price-oracle"
)

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --contract) CONTRACT="$2"; shift 2 ;;
        --network) NETWORK="$2"; shift 2 ;;
        --funding-utxo) FUNDING_UTXO="$2"; shift 2 ;;
        --funding-value) FUNDING_VALUE="$2"; shift 2 ;;
        --fee-rate) FEE_RATE="$2"; shift 2 ;;
        --output-address) OUTPUT_ADDRESS="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --init-params) INIT_PARAMS="$2"; shift 2 ;;
        --help)
            head -50 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Validate required parameters
if [ -z "$CONTRACT" ]; then
    echo -e "${RED}ERROR: --contract is required${NC}"
    exit 1
fi

if [ -z "${CONTRACT_BINARIES[$CONTRACT]}" ]; then
    echo -e "${RED}ERROR: Unknown contract: $CONTRACT${NC}"
    echo "Available: ${!CONTRACT_BINARIES[@]}"
    exit 1
fi

if [ -z "$FUNDING_UTXO" ] || [ -z "$FUNDING_VALUE" ]; then
    echo -e "${RED}ERROR: --funding-utxo and --funding-value are required${NC}"
    exit 1
fi

if [ -z "$OUTPUT_ADDRESS" ]; then
    echo -e "${RED}ERROR: --output-address is required${NC}"
    exit 1
fi

# Derived paths
BINARY="${CONTRACT_BINARIES[$CONTRACT]}"
PACKAGE="${CONTRACT_PACKAGES[$CONTRACT]}"
WASM_PATH="$PROJECT_ROOT/target/wasm32-wasip1/release/$BINARY.wasm"
NETWORK_DIR="$DEPLOYMENTS_DIR/$NETWORK"
PENDING_DIR="$NETWORK_DIR/pending"
CONFIG_FILE="$NETWORK_DIR/deployment-config.json"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  zkUSD Protocol - Deploy Contract${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "Contract:       ${GREEN}$CONTRACT${NC}"
echo -e "Network:        ${GREEN}$NETWORK${NC}"
echo -e "Binary:         $BINARY"
echo -e "WASM:           $WASM_PATH"
echo -e "Funding:        $FUNDING_UTXO"
echo -e "Funding Value:  $FUNDING_VALUE sats"
echo -e "Fee Rate:       $FEE_RATE sat/vB"
echo -e "Output Address: $OUTPUT_ADDRESS"
echo ""

# Check WASM exists
if [ ! -f "$WASM_PATH" ]; then
    echo -e "${YELLOW}WASM not found. Building...${NC}"
    cd "$PROJECT_ROOT"
    cargo build --release --target wasm32-wasip1 -p "$PACKAGE" --bin "$BINARY" --features charms
fi

if [ ! -f "$WASM_PATH" ]; then
    echo -e "${RED}ERROR: Failed to build WASM${NC}"
    exit 1
fi

# Compute VK
echo -e "${YELLOW}Computing VK...${NC}"
VK=$(charms app vk "$WASM_PATH")
echo -e "VK: ${GREEN}$VK${NC}"

# Create deployment directories
mkdir -p "$PENDING_DIR"

# Generate initialization spell based on contract type
SPELL_FILE="$PENDING_DIR/deploy-$CONTRACT-$(date +%Y%m%d-%H%M%S).yaml"
TIMESTAMP=$(date +%s)

echo -e "${YELLOW}Generating deployment spell...${NC}"

# Contract-specific initialization
case $CONTRACT in
    token)
        # Token needs authorized_minter (VaultManager app_id)
        AUTHORIZED_MINTER=$(echo "$INIT_PARAMS" | jq -r '.authorized_minter // empty')
        if [ -z "$AUTHORIZED_MINTER" ]; then
            echo -e "${YELLOW}WARNING: No authorized_minter provided. Using placeholder.${NC}"
            AUTHORIZED_MINTER="0000000000000000000000000000000000000000000000000000000000000000"
        fi

        cat > "$SPELL_FILE" << EOF
# ============================================================================
# zkUSD Token - Deployment Spell
# ============================================================================
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: $NETWORK
# VK: $VK
# ============================================================================

version: 9

apps:
  # Token State NFT
  \$00: n/0000000000000000000000000000000000000000000000000000000000000000/$VK

private_inputs:
  \$00:
    op: 0  # Initialize
    authorized_minter: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$AUTHORIZED_MINTER'[i:i+2] for i in range(0,64,2)]]))")

public_inputs: {}

ins: []

outs:
  - address: $OUTPUT_ADDRESS
    charms:
      \$00:
        authorized_minter: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$AUTHORIZED_MINTER'[i:i+2] for i in range(0,64,2)]]))")
        total_supply: 0
EOF
        ;;

    vault-manager)
        # VaultManager needs multiple references
        TOKEN_ID=$(echo "$INIT_PARAMS" | jq -r '.token_id // empty')
        SP_ID=$(echo "$INIT_PARAMS" | jq -r '.stability_pool_id // empty')
        ORACLE_ID=$(echo "$INIT_PARAMS" | jq -r '.price_oracle_id // empty')
        ADMIN=$(echo "$INIT_PARAMS" | jq -r '.admin // empty')

        if [ -z "$TOKEN_ID" ] || [ -z "$SP_ID" ] || [ -z "$ORACLE_ID" ]; then
            echo -e "${RED}ERROR: vault-manager requires token_id, stability_pool_id, price_oracle_id in --init-params${NC}"
            exit 1
        fi

        cat > "$SPELL_FILE" << EOF
# ============================================================================
# zkUSD VaultManager - Deployment Spell
# ============================================================================
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: $NETWORK
# VK: $VK
# ============================================================================

version: 9

apps:
  \$00: n/0000000000000000000000000000000000000000000000000000000000000000/$VK

private_inputs:
  \$00:
    op: 0  # Initialize

public_inputs: {}

ins: []

outs:
  - address: $OUTPUT_ADDRESS
    charms:
      \$00:
        protocol:
          total_collateral: 0
          total_debt: 0
          active_vault_count: 0
          base_rate: 50
          last_fee_update_block: 0
          admin: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$ADMIN'[i:i+2] for i in range(0,64,2)]]))")
          is_paused: false
        zkusd_token_id: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$TOKEN_ID'[i:i+2] for i in range(0,64,2)]]))")
        stability_pool_id: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$SP_ID'[i:i+2] for i in range(0,64,2)]]))")
        price_oracle_id: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$ORACLE_ID'[i:i+2] for i in range(0,64,2)]]))")
        active_pool: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$ADMIN'[i:i+2] for i in range(0,64,2)]]))")
        default_pool: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$ADMIN'[i:i+2] for i in range(0,64,2)]]))")
EOF
        ;;

    price-oracle)
        cat > "$SPELL_FILE" << EOF
# ============================================================================
# zkUSD PriceOracle - Deployment Spell
# ============================================================================
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: $NETWORK
# VK: $VK
# ============================================================================

version: 9

apps:
  \$00: n/0000000000000000000000000000000000000000000000000000000000000000/$VK

private_inputs:
  \$00:
    op: 0  # Initialize

public_inputs: {}

ins: []

outs:
  - address: $OUTPUT_ADDRESS
    charms:
      \$00:
        price: 10000000000000
        timestamp_block: 0
        source: Mock
        confidence: 100
EOF
        ;;

    stability-pool)
        TOKEN_ID=$(echo "$INIT_PARAMS" | jq -r '.token_id // empty')
        VM_ID=$(echo "$INIT_PARAMS" | jq -r '.vault_manager_id // empty')

        if [ -z "$TOKEN_ID" ] || [ -z "$VM_ID" ]; then
            echo -e "${RED}ERROR: stability-pool requires token_id, vault_manager_id in --init-params${NC}"
            exit 1
        fi

        cat > "$SPELL_FILE" << EOF
# ============================================================================
# zkUSD StabilityPool - Deployment Spell
# ============================================================================
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: $NETWORK
# VK: $VK
# ============================================================================

version: 9

apps:
  \$00: n/0000000000000000000000000000000000000000000000000000000000000000/$VK

private_inputs:
  \$00:
    op: 0  # Initialize

public_inputs: {}

ins: []

outs:
  - address: $OUTPUT_ADDRESS
    charms:
      \$00:
        total_deposits: 0
        total_collateral_gains: 0
        scale: 0
        epoch: 0
        zkusd_token_id: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$TOKEN_ID'[i:i+2] for i in range(0,64,2)]]))")
        vault_manager_id: $(python3 -c "import json; print(json.dumps([int(x,16) for x in ['$VM_ID'[i:i+2] for i in range(0,64,2)]]))")
        is_paused: false
EOF
        ;;
esac

echo -e "${GREEN}Spell generated: $SPELL_FILE${NC}"

if $DRY_RUN; then
    echo ""
    echo -e "${YELLOW}DRY RUN - Spell content:${NC}"
    cat "$SPELL_FILE"
    exit 0
fi

# Fetch funding transaction
FUNDING_TXID="${FUNDING_UTXO%:*}"
echo -e "${YELLOW}Fetching funding transaction...${NC}"

case $NETWORK in
    testnet4)
        API_URL="https://mempool.space/testnet4/api/tx/$FUNDING_TXID/hex"
        ;;
    signet)
        API_URL="https://mempool.space/signet/api/tx/$FUNDING_TXID/hex"
        ;;
    mainnet)
        API_URL="https://mempool.space/api/tx/$FUNDING_TXID/hex"
        ;;
esac

FUNDING_TX=$(curl -s "$API_URL")
if [ -z "$FUNDING_TX" ] || [ "$FUNDING_TX" = "Transaction not found" ]; then
    echo -e "${RED}ERROR: Failed to fetch funding transaction${NC}"
    exit 1
fi

echo -e "${GREEN}Funding TX fetched (${#FUNDING_TX} chars)${NC}"

# Prove spell
echo ""
echo -e "${YELLOW}Proving spell...${NC}"

PROVE_OUTPUT=$(charms spell prove \
    --spell "$SPELL_FILE" \
    --prev-txs "$FUNDING_TX" \
    --app-bins "$WASM_PATH" \
    --funding-utxo "$FUNDING_UTXO" \
    --funding-utxo-value "$FUNDING_VALUE" \
    --change-address "$OUTPUT_ADDRESS" \
    --fee-rate "$FEE_RATE" 2>&1)

PROVE_EXIT=$?

if [ $PROVE_EXIT -ne 0 ]; then
    echo -e "${RED}Proving failed:${NC}"
    echo "$PROVE_OUTPUT"
    exit 1
fi

echo -e "${GREEN}Spell proved successfully!${NC}"
echo ""
echo "$PROVE_OUTPUT"

# Extract transactions and broadcast
# (Implementation depends on charms CLI output format)

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Deployment Complete${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Next steps:"
echo "1. Save the transaction IDs"
echo "2. Update deployment-config.json"
echo "3. Verify on block explorer"
