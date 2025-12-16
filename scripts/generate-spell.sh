#!/bin/bash
# =============================================================================
# zkUSD Spell Generator
# =============================================================================
# Generates executable spells from templates with actual values
#
# Usage:
#   ./scripts/generate-spell.sh <operation> <output_file> [--param=value ...]
#
# Example:
#   ./scripts/generate-spell.sh open-vault /tmp/my-vault.yaml \
#     --collateral=100000000 \
#     --debt=5000000000000 \
#     --collateral-utxo="abc123:0" \
#     --owner-address="tb1q..."
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEMPLATES_DIR="$PROJECT_ROOT/spells/ops"
CONFIG_FILE="$PROJECT_ROOT/deployments/testnet4/deployment-config.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load config values
load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}Error: Config file not found: $CONFIG_FILE${NC}"
        exit 1
    fi

    # Export all contract values as environment variables
    export TOKEN_VK=$(jq -r '.contracts.zkusd_token.vk' "$CONFIG_FILE")
    export TOKEN_APP_ID=$(jq -r '.contracts.zkusd_token.app_id' "$CONFIG_FILE")
    export VM_VK=$(jq -r '.contracts.vault_manager.vk' "$CONFIG_FILE")
    export VM_APP_ID=$(jq -r '.contracts.vault_manager.app_id' "$CONFIG_FILE")
    export SP_VK=$(jq -r '.contracts.stability_pool.vk' "$CONFIG_FILE")
    export SP_APP_ID=$(jq -r '.contracts.stability_pool.app_id' "$CONFIG_FILE")
    export ORACLE_VK=$(jq -r '.contracts.price_oracle.vk' "$CONFIG_FILE")
    export OUTPUT_ADDRESS=$(jq -r '.addresses.output_address' "$CONFIG_FILE")
}

# Template mapping
get_template() {
    case "$1" in
        open-vault|open)
            echo "$TEMPLATES_DIR/open-vault-template.yaml"
            ;;
        close-vault|close)
            echo "$TEMPLATES_DIR/close-vault-template.yaml"
            ;;
        adjust-vault|adjust)
            echo "$TEMPLATES_DIR/adjust-vault-template.yaml"
            ;;
        deposit-sp|deposit)
            echo "$TEMPLATES_DIR/stability-deposit-template.yaml"
            ;;
        withdraw-sp|withdraw)
            echo "$TEMPLATES_DIR/withdraw-sp-template.yaml"
            ;;
        liquidate|liq)
            echo "$TEMPLATES_DIR/liquidate-template.yaml"
            ;;
        transfer)
            echo "$TEMPLATES_DIR/transfer-zkusd-template.yaml"
            ;;
        redeem)
            echo "$TEMPLATES_DIR/redeem-template.yaml"
            ;;
        update-oracle|oracle)
            echo "$TEMPLATES_DIR/update-oracle-template.yaml"
            ;;
        *)
            echo ""
            ;;
    esac
}

# Generate vault ID from UTXO
generate_vault_id() {
    echo -n "$1" | sha256sum | cut -d' ' -f1
}

# Convert hex string to YAML array
hex_to_yaml_array() {
    local hex="$1"
    local result="["
    for ((i=0; i<${#hex}; i+=2)); do
        if [ $i -gt 0 ]; then
            result+=", "
        fi
        result+="$((16#${hex:$i:2}))"
    done
    result+="]"
    echo "$result"
}

# Get current block height
get_block_height() {
    bitcoin-cli -testnet4 getblockcount 2>/dev/null || echo "0"
}

# Generate open-vault spell
gen_open_vault() {
    local output_file="$1"
    shift

    # Parse arguments
    local collateral=""
    local debt=""
    local collateral_utxo=""
    local owner_address=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --collateral=*)
                collateral="${1#*=}"
                ;;
            --debt=*)
                debt="${1#*=}"
                ;;
            --collateral-utxo=*)
                collateral_utxo="${1#*=}"
                ;;
            --owner-address=*)
                owner_address="${1#*=}"
                ;;
        esac
        shift
    done

    # Validate required params
    if [ -z "$collateral" ] || [ -z "$debt" ] || [ -z "$collateral_utxo" ] || [ -z "$owner_address" ]; then
        echo -e "${RED}Missing required parameters for open-vault${NC}"
        echo "Required: --collateral, --debt, --collateral-utxo, --owner-address"
        exit 1
    fi

    local vault_id=$(generate_vault_id "$collateral_utxo")
    local vault_id_array=$(hex_to_yaml_array "$vault_id")
    local block_height=$(get_block_height)

    cat > "$output_file" << EOF
# Generated Open Vault Spell
# Generated: $(date)
# Collateral: $collateral sats
# Debt: $debt base units
version: 8

apps:
  \$VM: n/$VM_APP_ID/$VM_VK
  \$TOKEN: t/$TOKEN_APP_ID/$TOKEN_VK

private_inputs:
  \$VM:
    op: 16
    collateral: $collateral
    debt: $debt

ins:
  - utxo_id: $collateral_utxo
    charms: {}

outs:
  - address: $owner_address
    charms:
      \$VM:
        id: $vault_id_array
        owner: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        collateral: $collateral
        debt: $debt
        created_at: $block_height
        last_updated: $block_height
        status: 0
        interest_rate_bps: 50
        accrued_interest: 0
        redistributed_debt: 0
        redistributed_collateral: 0
        insurance_balance: 0

  - address: $owner_address
    charms:
      \$TOKEN: $debt

  - address: $owner_address
    charms: {}
EOF

    echo -e "${GREEN}Generated: $output_file${NC}"
    echo "Vault ID: $vault_id"
}

# Generate transfer spell
gen_transfer() {
    local output_file="$1"
    shift

    local zkusd_utxo=""
    local input_balance=""
    local transfer_amount=""
    local recipient_address=""
    local sender_address=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --zkusd-utxo=*)
                zkusd_utxo="${1#*=}"
                ;;
            --input-balance=*)
                input_balance="${1#*=}"
                ;;
            --amount=*)
                transfer_amount="${1#*=}"
                ;;
            --recipient=*)
                recipient_address="${1#*=}"
                ;;
            --sender=*)
                sender_address="${1#*=}"
                ;;
        esac
        shift
    done

    if [ -z "$zkusd_utxo" ] || [ -z "$input_balance" ] || [ -z "$transfer_amount" ] || [ -z "$recipient_address" ] || [ -z "$sender_address" ]; then
        echo -e "${RED}Missing required parameters for transfer${NC}"
        echo "Required: --zkusd-utxo, --input-balance, --amount, --recipient, --sender"
        exit 1
    fi

    local change_amount=$((input_balance - transfer_amount))

    cat > "$output_file" << EOF
# Generated Transfer Spell
# Generated: $(date)
# Transfer: $transfer_amount to $recipient_address
version: 8

apps:
  \$TOKEN: t/$TOKEN_APP_ID/$TOKEN_VK

private_inputs:
  \$TOKEN:
    op: 1
    amount: $transfer_amount

ins:
  - utxo_id: $zkusd_utxo
    charms:
      \$TOKEN: $input_balance

outs:
  - address: $recipient_address
    charms:
      \$TOKEN: $transfer_amount

  - address: $sender_address
    charms:
      \$TOKEN: $change_amount
EOF

    echo -e "${GREEN}Generated: $output_file${NC}"
}

# Print usage
usage() {
    echo -e "${CYAN}zkUSD Spell Generator${NC}"
    echo ""
    echo "Usage: $0 <operation> <output_file> [--param=value ...]"
    echo ""
    echo "Operations:"
    echo "  open-vault    Generate vault opening spell"
    echo "  close-vault   Generate vault closing spell"
    echo "  adjust-vault  Generate vault adjustment spell"
    echo "  deposit-sp    Generate SP deposit spell"
    echo "  withdraw-sp   Generate SP withdrawal spell"
    echo "  liquidate     Generate liquidation spell"
    echo "  transfer      Generate transfer spell"
    echo "  redeem        Generate redemption spell"
    echo ""
    echo "Examples:"
    echo "  $0 open-vault /tmp/vault.yaml \\"
    echo "    --collateral=100000000 \\"
    echo "    --debt=5000000000000 \\"
    echo "    --collateral-utxo='abc123:0' \\"
    echo "    --owner-address='tb1q...'"
    echo ""
    echo "  $0 transfer /tmp/transfer.yaml \\"
    echo "    --zkusd-utxo='def456:1' \\"
    echo "    --input-balance=100000000000 \\"
    echo "    --amount=50000000000 \\"
    echo "    --recipient='tb1q...' \\"
    echo "    --sender='tb1q...'"
}

# Main
main() {
    if [ "$#" -lt 2 ]; then
        usage
        exit 1
    fi

    load_config

    local operation="$1"
    local output_file="$2"
    shift 2

    case "$operation" in
        open-vault|open)
            gen_open_vault "$output_file" "$@"
            ;;
        transfer)
            gen_transfer "$output_file" "$@"
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            local template=$(get_template "$operation")
            if [ -n "$template" ] && [ -f "$template" ]; then
                echo -e "${YELLOW}Template available: $template${NC}"
                echo "Manual parameter substitution required for: $operation"
                echo ""
                echo "Copy and edit:"
                echo "  cp $template $output_file"
            else
                echo -e "${RED}Unknown operation: $operation${NC}"
                usage
                exit 1
            fi
            ;;
    esac
}

main "$@"
