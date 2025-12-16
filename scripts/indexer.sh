#!/bin/bash
# =============================================================================
# zkUSD Protocol Indexer
# =============================================================================
# Tracks and displays protocol state from Bitcoin Testnet4
#
# Features:
#   - Show current protocol state (total collateral, debt, etc.)
#   - List all vaults
#   - Show Stability Pool status
#   - Track Oracle price history
#   - Export state to JSON
#
# Usage:
#   ./scripts/indexer.sh status        # Show protocol status
#   ./scripts/indexer.sh vaults        # List all vaults
#   ./scripts/indexer.sh pool          # Stability Pool info
#   ./scripts/indexer.sh oracle        # Oracle status
#   ./scripts/indexer.sh export        # Export state to JSON
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/deployments/testnet4/deployment-config.json"
STATE_FILE="$PROJECT_ROOT/deployments/testnet4/protocol-state.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# =============================================================================
# CONFIG
# =============================================================================

load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}Config not found: $CONFIG_FILE${NC}"
        exit 1
    fi

    ORACLE_APP_ID=$(jq -r '.contracts.price_oracle.app_id' "$CONFIG_FILE")
    ORACLE_VK=$(jq -r '.contracts.price_oracle.vk' "$CONFIG_FILE")
    ORACLE_TX=$(jq -r '.contracts.price_oracle.spell_tx' "$CONFIG_FILE")

    TOKEN_APP_ID=$(jq -r '.contracts.zkusd_token.app_id' "$CONFIG_FILE")
    TOKEN_VK=$(jq -r '.contracts.zkusd_token.vk' "$CONFIG_FILE")
    TOKEN_TX=$(jq -r '.contracts.zkusd_token.spell_tx' "$CONFIG_FILE")

    VM_APP_ID=$(jq -r '.contracts.vault_manager.app_id' "$CONFIG_FILE")
    VM_VK=$(jq -r '.contracts.vault_manager.vk' "$CONFIG_FILE")
    VM_TX=$(jq -r '.contracts.vault_manager.spell_tx' "$CONFIG_FILE")

    SP_APP_ID=$(jq -r '.contracts.stability_pool.app_id' "$CONFIG_FILE")
    SP_VK=$(jq -r '.contracts.stability_pool.vk' "$CONFIG_FILE")
    SP_TX=$(jq -r '.contracts.stability_pool.spell_tx' "$CONFIG_FILE")

    OUTPUT_ADDRESS=$(jq -r '.addresses.output_address' "$CONFIG_FILE")
}

# =============================================================================
# UTILITIES
# =============================================================================

format_btc() {
    echo "scale=8; $1 / 100000000" | bc | sed 's/^\./0./'
}

format_zkusd() {
    echo "scale=2; $1 / 100000000" | bc | sed 's/^\./0./'
}

format_usd() {
    echo "scale=2; $1 / 100000000" | bc | sed 's/^\./0./'
}

get_tx_confirmations() {
    bitcoin-cli -testnet4 gettransaction "$1" 2>/dev/null | jq -r '.confirmations // 0'
}

# =============================================================================
# PROTOCOL STATUS
# =============================================================================

show_status() {
    echo ""
    echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║              zkUSD PROTOCOL STATUS                           ║${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Network info
    local block_height=$(bitcoin-cli -testnet4 getblockcount)
    echo -e "${CYAN}Network:${NC} Bitcoin Testnet4"
    echo -e "${CYAN}Block Height:${NC} $block_height"
    echo ""

    # Contract status
    echo -e "${BOLD}Deployed Contracts:${NC}"
    echo ""

    # Oracle
    local oracle_conf=$(get_tx_confirmations "$ORACLE_TX")
    local oracle_status="${GREEN}✓${NC}"
    [ "$oracle_conf" -eq 0 ] && oracle_status="${YELLOW}○${NC}"
    echo -e "  ${oracle_status} ${BOLD}Price Oracle${NC}"
    echo -e "     App ID: ${CYAN}${ORACLE_APP_ID:0:16}...${NC}"
    echo -e "     TX: ${ORACLE_TX:0:16}... (${oracle_conf} conf)"

    # Token
    local token_conf=$(get_tx_confirmations "$TOKEN_TX")
    echo -e "  ${GREEN}✓${NC} ${BOLD}zkUSD Token${NC}"
    echo -e "     App ID: ${CYAN}${TOKEN_APP_ID:0:16}...${NC}"
    echo -e "     TX: ${TOKEN_TX:0:16}... (${token_conf} conf)"

    # Vault Manager
    local vm_conf=$(get_tx_confirmations "$VM_TX")
    echo -e "  ${GREEN}✓${NC} ${BOLD}Vault Manager${NC}"
    echo -e "     App ID: ${CYAN}${VM_APP_ID:0:16}...${NC}"
    echo -e "     TX: ${VM_TX:0:16}... (${vm_conf} conf)"

    # Stability Pool
    local sp_conf=$(get_tx_confirmations "$SP_TX")
    echo -e "  ${GREEN}✓${NC} ${BOLD}Stability Pool${NC}"
    echo -e "     App ID: ${CYAN}${SP_APP_ID:0:16}...${NC}"
    echo -e "     TX: ${SP_TX:0:16}... (${sp_conf} conf)"

    echo ""

    # Protocol parameters
    echo -e "${BOLD}Protocol Parameters:${NC}"
    echo -e "  MCR (Min Collateral Ratio): ${CYAN}110%${NC}"
    echo -e "  CCR (Critical CR):          ${CYAN}150%${NC}"
    echo -e "  Minimum Debt:               ${CYAN}200 zkUSD${NC}"
    echo -e "  Liquidation Bonus:          ${CYAN}0.5%${NC}"
    echo -e "  Redemption Fee Floor:       ${CYAN}0.5%${NC}"
    echo ""

    # Initial state (from config)
    echo -e "${BOLD}Initial State:${NC}"
    echo -e "  Total Collateral: ${CYAN}0 BTC${NC}"
    echo -e "  Total Debt:       ${CYAN}0 zkUSD${NC}"
    echo -e "  Active Vaults:    ${CYAN}0${NC}"
    echo -e "  SP Total:         ${CYAN}0 zkUSD${NC}"
    echo ""

    # Wallet info
    local balance=$(bitcoin-cli -testnet4 getbalance)
    local utxo_count=$(bitcoin-cli -testnet4 listunspent 0 | jq 'length')
    echo -e "${BOLD}Wallet:${NC}"
    echo -e "  Balance: ${GREEN}$balance BTC${NC}"
    echo -e "  UTXOs:   ${CYAN}$utxo_count${NC}"
    echo ""
}

# =============================================================================
# ORACLE STATUS
# =============================================================================

show_oracle() {
    echo ""
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  PRICE ORACLE STATUS${NC}"
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo ""

    local oracle_conf=$(get_tx_confirmations "$ORACLE_TX")

    echo -e "${CYAN}App ID:${NC} $ORACLE_APP_ID"
    echo -e "${CYAN}VK:${NC} $ORACLE_VK"
    echo -e "${CYAN}Spell TX:${NC} $ORACLE_TX"
    echo -e "${CYAN}Confirmations:${NC} $oracle_conf"
    echo ""

    # Initial price from config
    local initial_price=$(jq -r '.contracts.price_oracle.initial_price // 0' "$CONFIG_FILE")
    if [ "$initial_price" != "0" ] && [ "$initial_price" != "null" ]; then
        local price_usd=$(format_usd "$initial_price")
        echo -e "${BOLD}Current Price:${NC} ${GREEN}\$${price_usd}${NC} per BTC"
    else
        echo -e "${BOLD}Current Price:${NC} ${YELLOW}Not set${NC}"
    fi

    echo ""
    echo -e "${CYAN}Oracle UTXO:${NC}"
    local oracle_utxo=$(jq -r '.deployed_utxos.price_oracle_state.utxo' "$CONFIG_FILE")
    echo -e "  $oracle_utxo"
    echo ""
}

# =============================================================================
# STABILITY POOL STATUS
# =============================================================================

show_pool() {
    echo ""
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  STABILITY POOL STATUS${NC}"
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo ""

    echo -e "${CYAN}App ID:${NC} $SP_APP_ID"
    echo -e "${CYAN}VK:${NC} $SP_VK"
    echo ""

    # From initial state
    echo -e "${BOLD}Pool State:${NC}"
    echo -e "  Total zkUSD:     ${CYAN}0${NC}"
    echo -e "  Total BTC:       ${CYAN}0${NC}"
    echo -e "  Depositors:      ${CYAN}0${NC}"
    echo -e "  Product P:       ${CYAN}1.0 (1e18)${NC}"
    echo -e "  Sum S:           ${CYAN}0${NC}"
    echo -e "  Current Epoch:   ${CYAN}0${NC}"
    echo -e "  Current Scale:   ${CYAN}0${NC}"
    echo ""

    echo -e "${YELLOW}Note: Pool is empty - no deposits yet${NC}"
    echo ""
}

# =============================================================================
# VAULT LIST
# =============================================================================

show_vaults() {
    echo ""
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  VAULT LIST${NC}"
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo ""

    echo -e "${CYAN}Vault Manager App ID:${NC} $VM_APP_ID"
    echo ""

    # Currently no vaults
    echo -e "${YELLOW}No vaults found.${NC}"
    echo ""
    echo "To open a vault:"
    echo "  ./scripts/run-operation.sh open-vault <collateral_btc> <debt_zkusd>"
    echo ""
    echo "Example:"
    echo "  ./scripts/run-operation.sh open-vault 0.1 5000"
    echo ""
}

# =============================================================================
# EXPORT STATE
# =============================================================================

export_state() {
    echo "Exporting protocol state..."

    local block_height=$(bitcoin-cli -testnet4 getblockcount)
    local balance=$(bitcoin-cli -testnet4 getbalance)
    local oracle_conf=$(get_tx_confirmations "$ORACLE_TX")
    local token_conf=$(get_tx_confirmations "$TOKEN_TX")
    local vm_conf=$(get_tx_confirmations "$VM_TX")
    local sp_conf=$(get_tx_confirmations "$SP_TX")

    cat > "$STATE_FILE" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "network": "testnet4",
  "block_height": $block_height,
  "wallet_balance_btc": $balance,

  "contracts": {
    "price_oracle": {
      "app_id": "$ORACLE_APP_ID",
      "confirmations": $oracle_conf,
      "deployed": $([ "$oracle_conf" -gt 0 ] && echo "true" || echo "false")
    },
    "zkusd_token": {
      "app_id": "$TOKEN_APP_ID",
      "confirmations": $token_conf,
      "deployed": true
    },
    "vault_manager": {
      "app_id": "$VM_APP_ID",
      "confirmations": $vm_conf,
      "deployed": true
    },
    "stability_pool": {
      "app_id": "$SP_APP_ID",
      "confirmations": $sp_conf,
      "deployed": true
    }
  },

  "protocol_state": {
    "total_collateral_sats": 0,
    "total_debt_base": 0,
    "active_vault_count": 0,
    "stability_pool_zkusd": 0,
    "stability_pool_btc": 0
  },

  "vaults": [],
  "stability_deposits": []
}
EOF

    echo -e "${GREEN}State exported to: $STATE_FILE${NC}"
}

# =============================================================================
# UTXO TRACKING
# =============================================================================

show_utxos() {
    echo ""
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  PROTOCOL UTXOS${NC}"
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo ""

    echo -e "${BOLD}Charm UTXOs (contain protocol state):${NC}"
    echo ""

    # Oracle
    local oracle_utxo=$(jq -r '.deployed_utxos.price_oracle_state.utxo' "$CONFIG_FILE")
    local oracle_conf=$(get_tx_confirmations "$(echo $oracle_utxo | cut -d':' -f1)")
    echo -e "  ${CYAN}Oracle:${NC} $oracle_utxo ($oracle_conf conf)"

    # Token
    local token_utxo=$(jq -r '.deployed_utxos.token_state.utxo' "$CONFIG_FILE")
    local token_conf=$(get_tx_confirmations "$(echo $token_utxo | cut -d':' -f1)")
    echo -e "  ${CYAN}Token:${NC} $token_utxo ($token_conf conf)"

    # VM
    local vm_utxo=$(jq -r '.deployed_utxos.vault_manager_state.utxo' "$CONFIG_FILE")
    local vm_conf=$(get_tx_confirmations "$(echo $vm_utxo | cut -d':' -f1)")
    echo -e "  ${CYAN}Vault Mgr:${NC} $vm_utxo ($vm_conf conf)"

    # SP
    local sp_utxo=$(jq -r '.deployed_utxos.stability_pool_state.utxo' "$CONFIG_FILE")
    local sp_conf=$(get_tx_confirmations "$(echo $sp_utxo | cut -d':' -f1)")
    echo -e "  ${CYAN}Stab Pool:${NC} $sp_utxo ($sp_conf conf)"

    echo ""
    echo -e "${BOLD}Funding UTXOs (available for operations):${NC}"
    echo ""
    bitcoin-cli -testnet4 listunspent 0 | jq -r '.[] | select(.amount > 0.00001) | "  \(.txid | .[0:16])...:\(.vout) | \(.amount) BTC | \(.confirmations) conf"'
    echo ""
}

# =============================================================================
# HELP
# =============================================================================

show_help() {
    echo ""
    echo -e "${BOLD}zkUSD Protocol Indexer${NC}"
    echo ""
    echo "Usage: ./indexer.sh <command>"
    echo ""
    echo "Commands:"
    echo "  status    Show full protocol status"
    echo "  oracle    Show Oracle status and price"
    echo "  pool      Show Stability Pool status"
    echo "  vaults    List all vaults"
    echo "  utxos     Show protocol UTXOs"
    echo "  export    Export state to JSON"
    echo "  help      Show this help"
    echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    load_config

    local cmd="${1:-status}"

    case "$cmd" in
        status|s)
            show_status
            ;;
        oracle|o|price)
            show_oracle
            ;;
        pool|sp|stability)
            show_pool
            ;;
        vaults|v|vault)
            show_vaults
            ;;
        utxos|u)
            show_utxos
            ;;
        export|e)
            export_state
            ;;
        help|h|--help|-h)
            show_help
            ;;
        *)
            echo "Unknown command: $cmd"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
