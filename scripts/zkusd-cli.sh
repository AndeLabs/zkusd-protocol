#!/bin/bash
# zkUSD CLI - Command Line Interface
# Interact with the zkUSD protocol

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
CONFIG_DIR="$PROJECT_ROOT/deployments/${NETWORK}"

# Load configuration
load_config() {
    if [ ! -f "$CONFIG_DIR/protocol-config.json" ]; then
        echo -e "${RED}Error: Protocol not initialized${NC}"
        echo "Run ./scripts/init-protocol.sh first"
        exit 1
    fi
}

# Print usage
usage() {
    echo -e "${BLUE}zkUSD CLI - Command Line Interface${NC}"
    echo ""
    echo "Usage: ./zkusd-cli.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  ${CYAN}vault${NC}     Vault operations"
    echo "  ${CYAN}token${NC}     Token operations"
    echo "  ${CYAN}pool${NC}      Stability pool operations"
    echo "  ${CYAN}oracle${NC}    Oracle operations"
    echo "  ${CYAN}status${NC}    Protocol status"
    echo ""
    echo "Vault Commands:"
    echo "  vault open <collateral_btc> <debt_zkusd>  Open a new vault"
    echo "  vault close <vault_id>                    Close a vault"
    echo "  vault adjust <vault_id> <coll> <debt>     Adjust vault"
    echo "  vault list [address]                      List vaults"
    echo "  vault info <vault_id>                     Show vault details"
    echo ""
    echo "Token Commands:"
    echo "  token balance <address>                   Check balance"
    echo "  token transfer <to> <amount>              Transfer zkUSD"
    echo ""
    echo "Pool Commands:"
    echo "  pool deposit <amount>                     Deposit zkUSD"
    echo "  pool withdraw <amount>                    Withdraw zkUSD"
    echo "  pool claim                                Claim BTC rewards"
    echo "  pool info                                 Pool statistics"
    echo ""
    echo "Oracle Commands:"
    echo "  oracle price                              Get current BTC price"
    echo "  oracle update <price>                     Update price (admin only)"
    echo ""
    echo "Options:"
    echo "  --network <network>    Network (testnet4, signet, mainnet)"
    echo "  --help                 Show this help"
    echo ""
    echo "Examples:"
    echo "  ./zkusd-cli.sh vault open 1.0 30000       # Open vault: 1 BTC, 30k zkUSD"
    echo "  ./zkusd-cli.sh token balance tb1p...     # Check balance"
    echo "  ./zkusd-cli.sh pool deposit 10000        # Deposit 10k zkUSD to SP"
}

# Format BTC amount (satoshis to BTC)
format_btc() {
    echo "scale=8; $1 / 100000000" | bc
}

# Format zkUSD amount
format_zkusd() {
    echo "scale=2; $1 / 100000000" | bc
}

# Parse BTC input (accepts BTC or satoshis)
parse_btc() {
    local input=$1
    if [[ $input == *"."* ]]; then
        # BTC format, convert to satoshis
        echo "scale=0; $input * 100000000 / 1" | bc
    else
        # Already satoshis
        echo "$input"
    fi
}

# Parse zkUSD input
parse_zkusd() {
    local input=$1
    if [[ $input == *"."* ]]; then
        echo "scale=0; $input * 100000000 / 1" | bc
    else
        # Assume whole zkUSD units
        echo "scale=0; $input * 100000000" | bc
    fi
}

# Vault operations
cmd_vault() {
    local subcmd="${1:-help}"
    shift || true

    case $subcmd in
        open)
            local collateral=$(parse_btc "${1:-0}")
            local debt=$(parse_zkusd "${2:-0}")

            if [ "$collateral" == "0" ] || [ "$debt" == "0" ]; then
                echo -e "${RED}Error: Must specify collateral and debt${NC}"
                echo "Usage: vault open <collateral_btc> <debt_zkusd>"
                exit 1
            fi

            echo -e "${BLUE}Opening Vault...${NC}"
            echo -e "  Collateral: ${CYAN}$(format_btc $collateral) BTC${NC}"
            echo -e "  Debt:       ${CYAN}$(format_zkusd $debt) zkUSD${NC}"

            # Calculate ICR (assuming $100k BTC for display)
            local price=10000000000000
            local coll_value=$(echo "scale=0; $collateral * $price / 100000000" | bc)
            local icr=$(echo "scale=2; $coll_value * 100 / $debt" | bc)
            echo -e "  ICR:        ${CYAN}${icr}%${NC}"

            if (( $(echo "$icr < 110" | bc -l) )); then
                echo -e "${RED}Error: ICR below minimum (110%)${NC}"
                exit 1
            fi

            echo ""
            echo -e "${YELLOW}Transaction to submit:${NC}"
            cat << EOF
{
    "app": "vault-manager",
    "operation": "OpenVault",
    "inputs": {
        "collateral_utxo": "<your_btc_utxo>",
        "collateral_amount": $collateral
    },
    "outputs": {
        "vault_charm": {
            "collateral": $collateral,
            "debt": $debt,
            "owner": "<your_address>"
        },
        "zkusd_tokens": {
            "amount": $debt,
            "recipient": "<your_address>"
        }
    }
}
EOF
            ;;

        close)
            local vault_id="${1:-}"
            if [ -z "$vault_id" ]; then
                echo -e "${RED}Error: Must specify vault ID${NC}"
                exit 1
            fi
            echo -e "${BLUE}Closing Vault: $vault_id${NC}"
            echo "Repay all debt and withdraw collateral"
            ;;

        adjust)
            local vault_id="${1:-}"
            local coll_change="${2:-0}"
            local debt_change="${3:-0}"
            echo -e "${BLUE}Adjusting Vault: $vault_id${NC}"
            echo "  Collateral change: $coll_change"
            echo "  Debt change: $debt_change"
            ;;

        list)
            local address="${1:-all}"
            echo -e "${BLUE}Listing Vaults${NC}"
            echo "(Query mempool.space for vault charms)"
            ;;

        info)
            local vault_id="${1:-}"
            if [ -z "$vault_id" ]; then
                echo -e "${RED}Error: Must specify vault ID${NC}"
                exit 1
            fi
            echo -e "${BLUE}Vault Info: $vault_id${NC}"
            ;;

        help|*)
            echo "Vault Commands:"
            echo "  open <collateral> <debt>   Open new vault"
            echo "  close <vault_id>           Close vault"
            echo "  adjust <id> <coll> <debt>  Adjust vault"
            echo "  list [address]             List vaults"
            echo "  info <vault_id>            Show vault info"
            ;;
    esac
}

# Token operations
cmd_token() {
    local subcmd="${1:-help}"
    shift || true

    case $subcmd in
        balance)
            local address="${1:-}"
            if [ -z "$address" ]; then
                echo -e "${RED}Error: Must specify address${NC}"
                exit 1
            fi
            echo -e "${BLUE}Checking balance for: $address${NC}"
            echo "(Query mempool.space for zkUSD token UTXOs)"
            ;;

        transfer)
            local to="${1:-}"
            local amount=$(parse_zkusd "${2:-0}")
            echo -e "${BLUE}Transfer zkUSD${NC}"
            echo "  To:     $to"
            echo "  Amount: $(format_zkusd $amount) zkUSD"
            ;;

        help|*)
            echo "Token Commands:"
            echo "  balance <address>      Check zkUSD balance"
            echo "  transfer <to> <amount> Transfer zkUSD"
            ;;
    esac
}

# Stability Pool operations
cmd_pool() {
    local subcmd="${1:-help}"
    shift || true

    case $subcmd in
        deposit)
            local amount=$(parse_zkusd "${1:-0}")
            echo -e "${BLUE}Deposit to Stability Pool${NC}"
            echo "  Amount: $(format_zkusd $amount) zkUSD"
            ;;

        withdraw)
            local amount=$(parse_zkusd "${1:-0}")
            echo -e "${BLUE}Withdraw from Stability Pool${NC}"
            echo "  Amount: $(format_zkusd $amount) zkUSD"
            ;;

        claim)
            echo -e "${BLUE}Claim BTC Rewards${NC}"
            echo "Claiming liquidation rewards..."
            ;;

        info)
            echo -e "${BLUE}Stability Pool Info${NC}"
            echo "(Query for pool statistics)"
            ;;

        help|*)
            echo "Pool Commands:"
            echo "  deposit <amount>  Deposit zkUSD"
            echo "  withdraw <amount> Withdraw zkUSD"
            echo "  claim             Claim BTC rewards"
            echo "  info              Pool statistics"
            ;;
    esac
}

# Oracle operations
cmd_oracle() {
    local subcmd="${1:-help}"
    shift || true

    case $subcmd in
        price)
            echo -e "${BLUE}Current BTC Price${NC}"
            if [ -f "$CONFIG_DIR/oracle-init.json" ]; then
                local price=$(cat "$CONFIG_DIR/oracle-init.json" | grep -o '"price": [0-9]*' | grep -o '[0-9]*')
                echo -e "  Price: \$$(format_zkusd $price)"
            else
                echo "  (Not initialized)"
            fi
            ;;

        update)
            local price="${1:-}"
            if [ -z "$price" ]; then
                echo -e "${RED}Error: Must specify price${NC}"
                exit 1
            fi
            echo -e "${BLUE}Update Oracle Price${NC}"
            echo "  New Price: \$$price"
            echo -e "${YELLOW}(Admin operation - requires oracle operator key)${NC}"
            ;;

        help|*)
            echo "Oracle Commands:"
            echo "  price          Get current BTC price"
            echo "  update <price> Update price (admin only)"
            ;;
    esac
}

# Protocol status
cmd_status() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  zkUSD Protocol Status         ${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
    echo -e "Network: ${CYAN}$NETWORK${NC}"
    echo ""

    if [ -f "$CONFIG_DIR/protocol-config.json" ]; then
        echo -e "${GREEN}✓ Protocol initialized${NC}"
        echo ""
        echo "Parameters:"
        cat "$CONFIG_DIR/protocol-config.json" | grep -A 10 '"parameters"'
    else
        echo -e "${YELLOW}⚠ Protocol not initialized${NC}"
        echo "Run ./scripts/init-protocol.sh"
    fi
}

# Main
main() {
    # Parse global options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --network)
                NETWORK="$2"
                CONFIG_DIR="$PROJECT_ROOT/deployments/${NETWORK}"
                shift 2
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                break
                ;;
        esac
    done

    # Get command
    local cmd="${1:-help}"
    shift || true

    case $cmd in
        vault)
            cmd_vault "$@"
            ;;
        token)
            cmd_token "$@"
            ;;
        pool)
            cmd_pool "$@"
            ;;
        oracle)
            cmd_oracle "$@"
            ;;
        status)
            cmd_status
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            echo -e "${RED}Unknown command: $cmd${NC}"
            echo ""
            usage
            exit 1
            ;;
    esac
}

main "$@"
