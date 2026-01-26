#!/bin/bash
# =============================================================================
# zkUSD Operation Runner
# =============================================================================
# Modular script for executing zkUSD protocol operations
#
# Usage:
#   ./scripts/run-operation.sh <operation> [params...]
#
# Operations:
#   open-vault <collateral_btc> <debt_zkusd>
#   deposit-sp <amount_zkusd>
#   liquidate <vault_utxo>
#   transfer <recipient> <amount>
#   update-oracle <price>
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SPELLS_DIR="$PROJECT_ROOT/spells/ops"
CONFIG_FILE="$PROJECT_ROOT/deployments/testnet4/deployment-config.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load deployment config
load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}Error: deployment-config.json not found${NC}"
        echo "Path: $CONFIG_FILE"
        exit 1
    fi

    # Load contract values
    TOKEN_VK=$(jq -r '.contracts.zkusd_token.vk' "$CONFIG_FILE")
    TOKEN_APP_ID=$(jq -r '.contracts.zkusd_token.app_id' "$CONFIG_FILE")
    VM_VK=$(jq -r '.contracts.vault_manager.vk' "$CONFIG_FILE")
    VM_APP_ID=$(jq -r '.contracts.vault_manager.app_id' "$CONFIG_FILE")
    SP_VK=$(jq -r '.contracts.stability_pool.vk' "$CONFIG_FILE")
    SP_APP_ID=$(jq -r '.contracts.stability_pool.app_id' "$CONFIG_FILE")
    ORACLE_VK=$(jq -r '.contracts.price_oracle.vk' "$CONFIG_FILE")

    OUTPUT_ADDRESS=$(jq -r '.addresses.output_address' "$CONFIG_FILE")
}

# Print header
header() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  zkUSD Protocol - $1${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

# Get available UTXOs
list_utxos() {
    echo -e "${CYAN}Available UTXOs:${NC}"
    bitcoin-cli -testnet4 listunspent 0 | jq -r '.[] | "\(.txid):\(.vout) - \(.amount) BTC (\(.confirmations) conf)"'
}

# Convert BTC to satoshis
btc_to_sats() {
    echo "scale=0; $1 * 100000000 / 1" | bc
}

# Convert zkUSD to base units (8 decimals)
zkusd_to_base() {
    echo "scale=0; $1 * 100000000 / 1" | bc
}

# Generate vault ID from UTXO
generate_vault_id() {
    echo -n "$1" | sha256sum | cut -d' ' -f1
}

# Get current block height
get_block_height() {
    bitcoin-cli -testnet4 getblockcount
}

# =============================================================================
# OPERATION: Open Vault
# =============================================================================
op_open_vault() {
    header "Open Vault"

    local collateral_btc="${1:-}"
    local debt_zkusd="${2:-}"

    if [ -z "$collateral_btc" ] || [ -z "$debt_zkusd" ]; then
        echo -e "${RED}Usage: open-vault <collateral_btc> <debt_zkusd>${NC}"
        echo ""
        echo "Example: ./run-operation.sh open-vault 0.5 25000"
        echo "         (0.5 BTC collateral, 25,000 zkUSD debt)"
        exit 1
    fi

    local collateral_sats=$(btc_to_sats "$collateral_btc")
    local debt_base=$(zkusd_to_base "$debt_zkusd")

    echo -e "Collateral: ${GREEN}$collateral_btc BTC${NC} ($collateral_sats sats)"
    echo -e "Debt:       ${GREEN}$debt_zkusd zkUSD${NC} ($debt_base base units)"
    echo ""

    # List UTXOs for selection
    list_utxos
    echo ""

    read -p "Enter collateral UTXO (txid:vout): " COLLATERAL_UTXO
    read -p "Enter funding UTXO (different from above): " FUNDING_UTXO
    read -p "Enter owner Bitcoin address: " OWNER_ADDRESS

    # Validate UTXOs are different
    if [ "$COLLATERAL_UTXO" == "$FUNDING_UTXO" ]; then
        echo -e "${RED}Error: Collateral and funding UTXOs must be different!${NC}"
        exit 1
    fi

    local vault_id=$(generate_vault_id "$COLLATERAL_UTXO")
    local block_height=$(get_block_height)

    echo ""
    echo -e "${CYAN}Generated Values:${NC}"
    echo "  Vault ID:     $vault_id"
    echo "  Block Height: $block_height"
    echo ""

    # Generate spell from template
    local spell_file="/tmp/open-vault-$$.yaml"
    cat > "$spell_file" << EOF
# Generated Open Vault Spell
version: 8

apps:
  \$VM: n/$VM_APP_ID/$VM_VK
  \$TOKEN: t/$TOKEN_APP_ID/$TOKEN_VK

private_inputs:
  \$VM:
    op: 16
    collateral: $collateral_sats
    debt: $debt_base

ins:
  - utxo_id: $COLLATERAL_UTXO
    charms: {}

outs:
  - address: $OWNER_ADDRESS
    charms:
      \$VM:
        id: [$(echo "$vault_id" | sed 's/../0x&, /g' | sed 's/, $//' | head -c 160)]
        owner: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        collateral: $collateral_sats
        debt: $debt_base
        created_at: $block_height
        last_updated: $block_height
        status: 0
        interest_rate_bps: 50
        accrued_interest: 0
        redistributed_debt: 0
        redistributed_collateral: 0
        insurance_balance: 0

  - address: $OWNER_ADDRESS
    charms:
      \$TOKEN: $debt_base

  - address: $OWNER_ADDRESS
    charms: {}
EOF

    echo -e "${GREEN}Spell generated: $spell_file${NC}"
    echo ""
    echo "Review the spell and run:"
    echo ""
    echo -e "${YELLOW}./scripts/deploy-spell.sh $spell_file \\"
    echo "    target/wasm32-wasip1/release/zkusd-vault-manager-app.wasm \\"
    echo "    \"$COLLATERAL_UTXO\" \\"
    echo "    \"$FUNDING_UTXO\" \\"
    echo "    <funding_value_sats>${NC}"
}

# =============================================================================
# OPERATION: Deposit to Stability Pool
# =============================================================================
op_deposit_sp() {
    header "Deposit to Stability Pool"

    local amount_zkusd="${1:-}"

    if [ -z "$amount_zkusd" ]; then
        echo -e "${RED}Usage: deposit-sp <amount_zkusd>${NC}"
        exit 1
    fi

    local amount_base=$(zkusd_to_base "$amount_zkusd")
    echo -e "Deposit: ${GREEN}$amount_zkusd zkUSD${NC} ($amount_base base units)"
    echo ""

    list_utxos
    echo ""
    echo -e "${YELLOW}Note: You need a UTXO containing zkUSD tokens${NC}"
    echo ""

    read -p "Enter zkUSD UTXO (txid:vout): " ZKUSD_UTXO
    read -p "Enter funding UTXO: " FUNDING_UTXO
    read -p "Enter SP state UTXO (from deployment): " SP_STATE_UTXO
    read -p "Enter your address: " DEPOSITOR_ADDRESS

    echo ""
    echo -e "${CYAN}Deposit to Stability Pool${NC}"
    echo "Amount: $amount_zkusd zkUSD"
    echo "Depositor: $DEPOSITOR_ADDRESS"
    echo ""
    echo "Template: $SPELLS_DIR/stability-deposit-template.yaml"
}

# =============================================================================
# OPERATION: Liquidate Vault
# =============================================================================
op_liquidate() {
    header "Liquidate Vault"

    local vault_utxo="${1:-}"

    if [ -z "$vault_utxo" ]; then
        echo -e "${RED}Usage: liquidate <vault_utxo>${NC}"
        echo ""
        echo "Find undercollateralized vaults using the explorer."
        exit 1
    fi

    echo -e "Target Vault: ${GREEN}$vault_utxo${NC}"
    echo ""

    list_utxos
    echo ""

    read -p "Enter funding UTXO: " FUNDING_UTXO
    read -p "Enter SP state UTXO: " SP_STATE_UTXO
    read -p "Enter liquidator address (for bonus): " LIQUIDATOR_ADDRESS

    echo ""
    echo -e "${CYAN}Liquidation Details${NC}"
    echo "Vault UTXO: $vault_utxo"
    echo "Liquidator: $LIQUIDATOR_ADDRESS"
    echo ""
    echo "Template: $SPELLS_DIR/liquidate-template.yaml"
}

# =============================================================================
# OPERATION: Transfer zkUSD
# =============================================================================
op_transfer() {
    header "Transfer zkUSD"

    local recipient="${1:-}"
    local amount="${2:-}"

    if [ -z "$recipient" ] || [ -z "$amount" ]; then
        echo -e "${RED}Usage: transfer <recipient_address> <amount_zkusd>${NC}"
        exit 1
    fi

    local amount_base=$(zkusd_to_base "$amount")
    echo -e "Transfer: ${GREEN}$amount zkUSD${NC} to $recipient"
    echo ""

    list_utxos
    echo ""

    read -p "Enter zkUSD UTXO (txid:vout): " ZKUSD_UTXO
    read -p "Current balance in UTXO: " CURRENT_BALANCE
    read -p "Enter funding UTXO: " FUNDING_UTXO
    read -p "Enter your address (for change): " SENDER_ADDRESS

    local current_base=$(zkusd_to_base "$CURRENT_BALANCE")
    local change_base=$((current_base - amount_base))

    echo ""
    echo -e "${CYAN}Transfer Summary${NC}"
    echo "From UTXO: $ZKUSD_UTXO"
    echo "Balance:   $CURRENT_BALANCE zkUSD"
    echo "Send:      $amount zkUSD -> $recipient"
    echo "Change:    $(echo "scale=8; $change_base / 100000000" | bc) zkUSD -> $SENDER_ADDRESS"
}

# =============================================================================
# OPERATION: Update Oracle
# =============================================================================
op_update_oracle() {
    header "Update Price Oracle"

    local price="${1:-}"

    if [ -z "$price" ]; then
        echo -e "${RED}Usage: update-oracle <price_usd>${NC}"
        echo ""
        echo "Example: ./run-operation.sh update-oracle 104500"
        echo "         (Sets BTC price to \$104,500)"
        exit 1
    fi

    local price_base=$(zkusd_to_base "$price")
    echo -e "New Price: ${GREEN}\$$price${NC} ($price_base base units)"
    echo ""

    list_utxos
    echo ""

    read -p "Enter current Oracle UTXO: " ORACLE_UTXO
    read -p "Enter funding UTXO: " FUNDING_UTXO
    read -p "Enter Oracle address: " ORACLE_ADDRESS

    local timestamp=$(date +%s)

    echo ""
    echo -e "${CYAN}Oracle Update${NC}"
    echo "Price: \$$price"
    echo "Timestamp: $timestamp"
    echo "Template: $SPELLS_DIR/update-oracle-template.yaml"
}

# =============================================================================
# HELP
# =============================================================================
show_help() {
    echo -e "${BLUE}zkUSD Protocol Operation Runner${NC}"
    echo ""
    echo "Usage: ./run-operation.sh <operation> [params...]"
    echo ""
    echo "Operations:"
    echo -e "  ${GREEN}open-vault${NC} <collateral_btc> <debt_zkusd>"
    echo "      Open a new vault with BTC collateral"
    echo ""
    echo -e "  ${GREEN}deposit-sp${NC} <amount_zkusd>"
    echo "      Deposit zkUSD to Stability Pool"
    echo ""
    echo -e "  ${GREEN}liquidate${NC} <vault_utxo>"
    echo "      Liquidate undercollateralized vault"
    echo ""
    echo -e "  ${GREEN}transfer${NC} <recipient> <amount>"
    echo "      Transfer zkUSD tokens"
    echo ""
    echo -e "  ${GREEN}update-oracle${NC} <price_usd>"
    echo "      Update BTC price (admin only)"
    echo ""
    echo "Examples:"
    echo "  ./run-operation.sh open-vault 1.0 50000"
    echo "  ./run-operation.sh deposit-sp 10000"
    echo "  ./run-operation.sh transfer tb1q... 500"
}

# =============================================================================
# MAIN
# =============================================================================
main() {
    load_config

    local operation="${1:-help}"
    shift || true

    case "$operation" in
        open-vault|open)
            op_open_vault "$@"
            ;;
        deposit-sp|deposit)
            op_deposit_sp "$@"
            ;;
        liquidate|liq)
            op_liquidate "$@"
            ;;
        transfer|send)
            op_transfer "$@"
            ;;
        update-oracle|oracle)
            op_update_oracle "$@"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}Unknown operation: $operation${NC}"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
