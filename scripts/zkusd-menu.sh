#!/bin/bash
# =============================================================================
# zkUSD Interactive CLI Menu
# =============================================================================
# Full interactive menu for all protocol operations
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/deployments/testnet4/deployment-config.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Clear screen and show header
show_header() {
    clear
    echo -e "${BOLD}${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║              ███████╗██╗  ██╗██╗   ██╗███████╗██████╗       ║"
    echo "║              ╚══███╔╝██║ ██╔╝██║   ██║██╔════╝██╔══██╗      ║"
    echo "║                ███╔╝ █████╔╝ ██║   ██║███████╗██║  ██║      ║"
    echo "║               ███╔╝  ██╔═██╗ ██║   ██║╚════██║██║  ██║      ║"
    echo "║              ███████╗██║  ██╗╚██████╔╝███████║██████╔╝      ║"
    echo "║              ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═════╝       ║"
    echo "║                                                              ║"
    echo "║              Bitcoin-Native Stablecoin Protocol              ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Show network status
show_status() {
    local block=$(bitcoin-cli -testnet4 getblockcount 2>/dev/null || echo "?")
    local balance=$(bitcoin-cli -testnet4 getbalance 2>/dev/null || echo "?")
    
    echo -e "${CYAN}Network:${NC} Testnet4  ${CYAN}Block:${NC} $block  ${CYAN}Balance:${NC} ${GREEN}$balance BTC${NC}"
    echo ""
}

# Main menu
main_menu() {
    show_header
    show_status
    
    echo -e "${BOLD}Main Menu:${NC}"
    echo ""
    echo -e "  ${CYAN}1)${NC} 📊 Protocol Status"
    echo -e "  ${CYAN}2)${NC} 🏦 Vault Operations"
    echo -e "  ${CYAN}3)${NC} 💰 Token Operations"
    echo -e "  ${CYAN}4)${NC} 🏊 Stability Pool"
    echo -e "  ${CYAN}5)${NC} 📈 Oracle Management"
    echo -e "  ${CYAN}6)${NC} 🔧 Admin Tools"
    echo -e "  ${CYAN}7)${NC} 📋 View Logs"
    echo -e "  ${CYAN}8)${NC} 🧪 Run Tests"
    echo ""
    echo -e "  ${RED}q)${NC} Quit"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) status_menu ;;
        2) vault_menu ;;
        3) token_menu ;;
        4) pool_menu ;;
        5) oracle_menu ;;
        6) admin_menu ;;
        7) logs_menu ;;
        8) tests_menu ;;
        q|Q) exit 0 ;;
        *) main_menu ;;
    esac
}

# Status submenu
status_menu() {
    show_header
    echo -e "${BOLD}📊 Protocol Status${NC}"
    echo ""
    
    "$SCRIPT_DIR/indexer.sh" status 2>/dev/null || echo "Indexer not available"
    
    echo ""
    read -p "Press Enter to continue..." _
    main_menu
}

# Vault operations submenu
vault_menu() {
    show_header
    echo -e "${BOLD}🏦 Vault Operations${NC}"
    echo ""
    echo -e "  ${CYAN}1)${NC} Open New Vault"
    echo -e "  ${CYAN}2)${NC} Close Vault"
    echo -e "  ${CYAN}3)${NC} Add Collateral"
    echo -e "  ${CYAN}4)${NC} Withdraw Collateral"
    echo -e "  ${CYAN}5)${NC} Mint More Debt"
    echo -e "  ${CYAN}6)${NC} Repay Debt"
    echo -e "  ${CYAN}7)${NC} List My Vaults"
    echo ""
    echo -e "  ${YELLOW}b)${NC} Back to Main Menu"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) open_vault_wizard ;;
        2) close_vault_wizard ;;
        3) add_collateral_wizard ;;
        4) withdraw_collateral_wizard ;;
        5) mint_debt_wizard ;;
        6) repay_debt_wizard ;;
        7) list_vaults ;;
        b|B) main_menu ;;
        *) vault_menu ;;
    esac
}

# Open vault wizard
open_vault_wizard() {
    show_header
    echo -e "${BOLD}🏦 Open New Vault${NC}"
    echo ""
    
    # Show current price
    local price=$(jq -r '.contracts.price_oracle.initial_price // 0' "$CONFIG_FILE")
    local price_usd=$(echo "scale=2; $price / 100000000" | bc 2>/dev/null || echo "?")
    echo -e "${CYAN}Current BTC Price:${NC} \$${price_usd}"
    echo ""
    
    # Get collateral
    read -p "Collateral amount (BTC): " collateral_btc
    local collateral_sats=$(echo "$collateral_btc * 100000000" | bc | cut -d. -f1)
    
    # Calculate max debt at MCR
    local collateral_usd=$(echo "scale=2; $collateral_btc * $price_usd" | bc)
    local max_debt=$(echo "scale=2; $collateral_usd / 1.1" | bc)
    
    echo ""
    echo -e "${CYAN}Collateral Value:${NC} \$${collateral_usd}"
    echo -e "${CYAN}Max Debt (110% MCR):${NC} ${max_debt} zkUSD"
    echo -e "${YELLOW}Min Debt Required:${NC} 200 zkUSD"
    echo ""
    
    read -p "Debt amount (zkUSD): " debt_zkusd
    
    # Calculate ICR
    local icr=$(echo "scale=2; ($collateral_usd / $debt_zkusd) * 100" | bc 2>/dev/null || echo "?")
    
    echo ""
    echo -e "${BOLD}Summary:${NC}"
    echo -e "  Collateral: ${GREEN}$collateral_btc BTC${NC} ($collateral_sats sats)"
    echo -e "  Debt:       ${CYAN}$debt_zkusd zkUSD${NC}"
    echo -e "  ICR:        ${CYAN}${icr}%${NC}"
    echo ""
    
    if (( $(echo "$icr < 110" | bc -l) )); then
        echo -e "${RED}ERROR: ICR must be >= 110%${NC}"
        read -p "Press Enter to continue..." _
        vault_menu
        return
    fi
    
    if (( $(echo "$debt_zkusd < 200" | bc -l) )); then
        echo -e "${RED}ERROR: Minimum debt is 200 zkUSD${NC}"
        read -p "Press Enter to continue..." _
        vault_menu
        return
    fi
    
    read -p "Proceed? (y/n): " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        echo ""
        echo -e "${YELLOW}Generating spell...${NC}"
        "$SCRIPT_DIR/run-operation.sh" open-vault "$collateral_btc" "$debt_zkusd" 2>&1 || true
    fi
    
    echo ""
    read -p "Press Enter to continue..." _
    vault_menu
}

# Token operations submenu
token_menu() {
    show_header
    echo -e "${BOLD}💰 Token Operations${NC}"
    echo ""
    echo -e "  ${CYAN}1)${NC} Transfer zkUSD"
    echo -e "  ${CYAN}2)${NC} Check Balance"
    echo -e "  ${CYAN}3)${NC} View Total Supply"
    echo ""
    echo -e "  ${YELLOW}b)${NC} Back to Main Menu"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) transfer_wizard ;;
        2) check_balance ;;
        3) view_supply ;;
        b|B) main_menu ;;
        *) token_menu ;;
    esac
}

# Transfer wizard
transfer_wizard() {
    show_header
    echo -e "${BOLD}💰 Transfer zkUSD${NC}"
    echo ""
    
    read -p "Recipient address: " recipient
    read -p "Amount (zkUSD): " amount
    
    echo ""
    echo -e "${BOLD}Summary:${NC}"
    echo -e "  To:     ${CYAN}$recipient${NC}"
    echo -e "  Amount: ${GREEN}$amount zkUSD${NC}"
    echo ""
    
    read -p "Proceed? (y/n): " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        echo ""
        echo -e "${YELLOW}Generating spell...${NC}"
        "$SCRIPT_DIR/run-operation.sh" transfer "$recipient" "$amount" 2>&1 || true
    fi
    
    echo ""
    read -p "Press Enter to continue..." _
    token_menu
}

# Stability Pool submenu
pool_menu() {
    show_header
    echo -e "${BOLD}🏊 Stability Pool${NC}"
    echo ""
    echo -e "  ${CYAN}1)${NC} Deposit zkUSD"
    echo -e "  ${CYAN}2)${NC} Withdraw"
    echo -e "  ${CYAN}3)${NC} Claim BTC Gains"
    echo -e "  ${CYAN}4)${NC} View Pool Status"
    echo -e "  ${CYAN}5)${NC} View My Position"
    echo ""
    echo -e "  ${YELLOW}b)${NC} Back to Main Menu"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) deposit_sp_wizard ;;
        2) withdraw_sp_wizard ;;
        3) claim_gains_wizard ;;
        4) "$SCRIPT_DIR/indexer.sh" pool; read -p "Press Enter..." _; pool_menu ;;
        5) view_sp_position ;;
        b|B) main_menu ;;
        *) pool_menu ;;
    esac
}

# Deposit to SP wizard
deposit_sp_wizard() {
    show_header
    echo -e "${BOLD}🏊 Deposit to Stability Pool${NC}"
    echo ""
    
    read -p "Amount to deposit (zkUSD): " amount
    
    echo ""
    echo -e "${BOLD}Summary:${NC}"
    echo -e "  Deposit: ${GREEN}$amount zkUSD${NC}"
    echo ""
    echo -e "${CYAN}Benefits:${NC}"
    echo "  - Earn BTC from liquidations"
    echo "  - Help maintain protocol stability"
    echo ""
    
    read -p "Proceed? (y/n): " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        echo ""
        echo -e "${YELLOW}Generating spell...${NC}"
        "$SCRIPT_DIR/run-operation.sh" deposit-sp "$amount" 2>&1 || true
    fi
    
    echo ""
    read -p "Press Enter to continue..." _
    pool_menu
}

# Oracle submenu
oracle_menu() {
    show_header
    echo -e "${BOLD}📈 Oracle Management${NC}"
    echo ""
    
    "$SCRIPT_DIR/indexer.sh" oracle 2>/dev/null || echo "Oracle status unavailable"
    
    echo ""
    echo -e "  ${CYAN}1)${NC} Update Price (Admin)"
    echo -e "  ${CYAN}2)${NC} View Price History"
    echo ""
    echo -e "  ${YELLOW}b)${NC} Back to Main Menu"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) update_oracle_wizard ;;
        2) echo "Price history not implemented yet"; read -p "Press Enter..." _; oracle_menu ;;
        b|B) main_menu ;;
        *) oracle_menu ;;
    esac
}

# Update oracle wizard
update_oracle_wizard() {
    show_header
    echo -e "${BOLD}📈 Update Oracle Price${NC}"
    echo ""
    echo -e "${RED}⚠️  Admin only operation${NC}"
    echo ""
    
    read -p "New BTC price (USD): " price_usd
    
    echo ""
    echo -e "New price: ${GREEN}\$${price_usd}${NC}"
    echo ""
    
    read -p "Proceed? (y/n): " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        echo ""
        "$SCRIPT_DIR/run-operation.sh" update-oracle "$price_usd" 2>&1 || true
    fi
    
    echo ""
    read -p "Press Enter to continue..." _
    oracle_menu
}

# Admin tools submenu
admin_menu() {
    show_header
    echo -e "${BOLD}🔧 Admin Tools${NC}"
    echo ""
    echo -e "  ${CYAN}1)${NC} View UTXOs"
    echo -e "  ${CYAN}2)${NC} Generate New Address"
    echo -e "  ${CYAN}3)${NC} View Deployment Config"
    echo -e "  ${CYAN}4)${NC} Export Protocol State"
    echo -e "  ${CYAN}5)${NC} Monitor Transactions"
    echo ""
    echo -e "  ${YELLOW}b)${NC} Back to Main Menu"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) "$SCRIPT_DIR/indexer.sh" utxos; read -p "Press Enter..." _; admin_menu ;;
        2) bitcoin-cli -testnet4 getnewaddress; read -p "Press Enter..." _; admin_menu ;;
        3) cat "$CONFIG_FILE" | jq .; read -p "Press Enter..." _; admin_menu ;;
        4) "$SCRIPT_DIR/indexer.sh" export; read -p "Press Enter..." _; admin_menu ;;
        5) "$SCRIPT_DIR/monitor.sh" watch ;;
        b|B) main_menu ;;
        *) admin_menu ;;
    esac
}

# Tests submenu
tests_menu() {
    show_header
    echo -e "${BOLD}🧪 Run Tests${NC}"
    echo ""
    echo -e "  ${CYAN}1)${NC} Run All Tests"
    echo -e "  ${CYAN}2)${NC} Prerequisites Only"
    echo -e "  ${CYAN}3)${NC} Protocol State Tests"
    echo -e "  ${CYAN}4)${NC} WASM Binary Tests"
    echo -e "  ${CYAN}5)${NC} Spell Template Tests"
    echo ""
    echo -e "  ${YELLOW}b)${NC} Back to Main Menu"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) "$SCRIPT_DIR/test-e2e.sh" all; read -p "Press Enter..." _; tests_menu ;;
        2) "$SCRIPT_DIR/test-e2e.sh" prereq; read -p "Press Enter..." _; tests_menu ;;
        3) "$SCRIPT_DIR/test-e2e.sh" state; read -p "Press Enter..." _; tests_menu ;;
        4) "$SCRIPT_DIR/test-e2e.sh" wasm; read -p "Press Enter..." _; tests_menu ;;
        5) "$SCRIPT_DIR/test-e2e.sh" templates; read -p "Press Enter..." _; tests_menu ;;
        b|B) main_menu ;;
        *) tests_menu ;;
    esac
}

# Placeholder functions
close_vault_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; vault_menu; }
add_collateral_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; vault_menu; }
withdraw_collateral_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; vault_menu; }
mint_debt_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; vault_menu; }
repay_debt_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; vault_menu; }
list_vaults() { "$SCRIPT_DIR/indexer.sh" vaults; read -p "Press Enter..." _; vault_menu; }
check_balance() { echo "Balance check not implemented"; read -p "Press Enter..." _; token_menu; }
view_supply() { echo "Supply view not implemented"; read -p "Press Enter..." _; token_menu; }
withdraw_sp_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; pool_menu; }
claim_gains_wizard() { echo "Not implemented yet"; read -p "Press Enter..." _; pool_menu; }
view_sp_position() { echo "Not implemented yet"; read -p "Press Enter..." _; pool_menu; }
logs_menu() { echo "Logs not implemented"; read -p "Press Enter..." _; main_menu; }

# Start
main_menu
