#!/bin/bash
# =============================================================================
# zkUSD Transaction Monitor
# =============================================================================
# Monitors pending transactions and alerts when confirmed
#
# Usage:
#   ./scripts/monitor.sh                    # Monitor all pending
#   ./scripts/monitor.sh <txid>             # Monitor specific TX
#   ./scripts/monitor.sh --watch            # Continuous watch mode
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
BOLD='\033[1m'
NC='\033[0m'

# Sound alert (macOS)
alert() {
    if command -v afplay &> /dev/null; then
        afplay /System/Library/Sounds/Glass.aiff 2>/dev/null &
    fi
    echo -e "${GREEN}${BOLD}🔔 CONFIRMADO!${NC} $1"
}

# Get TX confirmations
get_confirmations() {
    bitcoin-cli -testnet4 gettransaction "$1" 2>/dev/null | jq -r '.confirmations // 0'
}

# Check single TX
check_tx() {
    local txid="$1"
    local name="${2:-TX}"
    local confs=$(get_confirmations "$txid")
    
    if [ "$confs" -gt 0 ]; then
        echo -e "${GREEN}✓${NC} ${name}: ${CYAN}${txid:0:16}...${NC} (${GREEN}${confs} conf${NC})"
        return 0
    else
        echo -e "${YELLOW}○${NC} ${name}: ${CYAN}${txid:0:16}...${NC} (${YELLOW}pending${NC})"
        return 1
    fi
}

# Monitor all protocol TXs
monitor_protocol() {
    echo ""
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  zkUSD Transaction Monitor${NC}"
    echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}"
    echo ""
    
    local block=$(bitcoin-cli -testnet4 getblockcount)
    echo -e "${CYAN}Block Height:${NC} $block"
    echo -e "${CYAN}Time:${NC} $(date '+%H:%M:%S')"
    echo ""
    
    # Load TXs from config
    local oracle_tx=$(jq -r '.contracts.price_oracle.spell_tx' "$CONFIG_FILE")
    local token_tx=$(jq -r '.contracts.zkusd_token.spell_tx' "$CONFIG_FILE")
    local vm_tx=$(jq -r '.contracts.vault_manager.spell_tx' "$CONFIG_FILE")
    local sp_tx=$(jq -r '.contracts.stability_pool.spell_tx' "$CONFIG_FILE")
    
    echo -e "${BOLD}Contract Deployments:${NC}"
    check_tx "$oracle_tx" "Oracle"
    check_tx "$token_tx" "Token"
    check_tx "$vm_tx" "Vault Manager"
    check_tx "$sp_tx" "Stability Pool"
    echo ""
}

# Watch mode - continuous monitoring
watch_mode() {
    local target_tx="$1"
    local check_interval=10
    
    echo -e "${BOLD}Watching for confirmations...${NC}"
    echo -e "Press Ctrl+C to stop"
    echo ""
    
    while true; do
        clear
        monitor_protocol
        
        # Check if target TX confirmed
        if [ -n "$target_tx" ]; then
            local confs=$(get_confirmations "$target_tx")
            if [ "$confs" -gt 0 ]; then
                alert "Target TX confirmed with $confs confirmations!"
                break
            fi
        fi
        
        # Check Oracle specifically
        local oracle_tx=$(jq -r '.contracts.price_oracle.spell_tx' "$CONFIG_FILE")
        local oracle_confs=$(get_confirmations "$oracle_tx")
        if [ "$oracle_confs" -gt 0 ] && [ "$oracle_confs" -lt 3 ]; then
            alert "Oracle TX just confirmed!"
        fi
        
        echo -e "${CYAN}Next check in ${check_interval}s...${NC}"
        sleep $check_interval
    done
}

# Wait for specific TX
wait_for_tx() {
    local txid="$1"
    local timeout="${2:-600}"  # 10 min default
    local waited=0
    
    echo -e "Waiting for TX: ${CYAN}${txid:0:16}...${NC}"
    
    while [ $waited -lt $timeout ]; do
        local confs=$(get_confirmations "$txid")
        if [ "$confs" -gt 0 ]; then
            alert "TX confirmed! ($confs confirmations)"
            return 0
        fi
        
        echo -n "."
        sleep 10
        waited=$((waited + 10))
    done
    
    echo ""
    echo -e "${RED}Timeout waiting for confirmation${NC}"
    return 1
}

# Main
main() {
    case "${1:-status}" in
        status|s)
            monitor_protocol
            ;;
        watch|w|--watch)
            watch_mode "$2"
            ;;
        wait)
            wait_for_tx "$2" "$3"
            ;;
        *)
            # Assume it's a txid
            if [[ "$1" =~ ^[a-f0-9]{64}$ ]]; then
                check_tx "$1" "TX"
            else
                echo "Usage: $0 [status|watch|wait <txid>]"
                exit 1
            fi
            ;;
    esac
}

main "$@"
