#!/bin/bash
# ============================================================================
# zkUSD Protocol - Full Deployment
# ============================================================================
# Deploys all zkUSD contracts in the correct order with proper cross-references.
#
# Usage:
#   ./scripts/deploy/deploy-all.sh --network <network> [options]
#
# Required:
#   --network <network>      Network: testnet4, signet, mainnet
#
# Options:
#   --funding-address <addr> Address with funding UTXOs
#   --output-address <addr>  Output address for contract states
#   --admin-address <addr>   Admin address (hex, 32 bytes)
#   --fee-rate <rate>        Fee rate in sat/vB (default: 10)
#   --dry-run                Build and generate spells without broadcasting
#   --skip-build             Skip building contracts (use existing WASMs)
#   --phase <num>            Start from specific phase (1-5)
#
# Phases:
#   1. Build all contracts
#   2. Deploy PriceOracle (independent)
#   3. Deploy Token (with placeholder minter)
#   4. Deploy StabilityPool & VaultManager (with references)
#   5. Update Token authorized_minter
#
# Environment:
#   ZKUSD_NETWORK           Default network
#   ZKUSD_OUTPUT_ADDRESS    Default output address
#   ZKUSD_ADMIN_ADDRESS     Default admin address (hex)
#   ZKUSD_FEE_RATE          Default fee rate
#
# Example:
#   ./scripts/deploy/deploy-all.sh \
#     --network testnet4 \
#     --output-address tb1q... \
#     --admin-address "aeaee5e46e98ac5c1d4e460ef56fdcf9dd31e23f..." \
#     --fee-rate 10
#
# ============================================================================
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOYMENTS_DIR="$PROJECT_ROOT/deployments"

# Default values
NETWORK="${ZKUSD_NETWORK:-testnet4}"
OUTPUT_ADDRESS="${ZKUSD_OUTPUT_ADDRESS:-}"
ADMIN_ADDRESS="${ZKUSD_ADMIN_ADDRESS:-}"
FEE_RATE="${ZKUSD_FEE_RATE:-10}"
DRY_RUN=false
SKIP_BUILD=false
START_PHASE=1

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --network) NETWORK="$2"; shift 2 ;;
        --output-address) OUTPUT_ADDRESS="$2"; shift 2 ;;
        --admin-address) ADMIN_ADDRESS="$2"; shift 2 ;;
        --funding-address) FUNDING_ADDRESS="$2"; shift 2 ;;
        --fee-rate) FEE_RATE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        --phase) START_PHASE="$2"; shift 2 ;;
        --help)
            head -60 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Validate
if [ -z "$OUTPUT_ADDRESS" ]; then
    echo -e "${RED}ERROR: --output-address is required${NC}"
    exit 1
fi

if [ -z "$ADMIN_ADDRESS" ]; then
    echo -e "${RED}ERROR: --admin-address is required${NC}"
    exit 1
fi

# Setup
NETWORK_DIR="$DEPLOYMENTS_DIR/$NETWORK"
PENDING_DIR="$NETWORK_DIR/pending"
CONFIG_FILE="$NETWORK_DIR/deployment-config.json"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEPLOY_LOG="$NETWORK_DIR/deploy-$TIMESTAMP.log"

mkdir -p "$PENDING_DIR"

# Logging function
log() {
    echo -e "$1" | tee -a "$DEPLOY_LOG"
}

# Header
clear
log "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
log "${CYAN}║         zkUSD Protocol - Full Deployment                       ║${NC}"
log "${CYAN}╠════════════════════════════════════════════════════════════════╣${NC}"
log "${CYAN}║  Network:        ${GREEN}$NETWORK${CYAN}                                        ║${NC}"
log "${CYAN}║  Output Address: ${GREEN}${OUTPUT_ADDRESS:0:20}...${CYAN}                        ║${NC}"
log "${CYAN}║  Fee Rate:       ${GREEN}$FEE_RATE sat/vB${CYAN}                                 ║${NC}"
log "${CYAN}║  Dry Run:        ${GREEN}$DRY_RUN${CYAN}                                         ║${NC}"
log "${CYAN}║  Start Phase:    ${GREEN}$START_PHASE${CYAN}                                            ║${NC}"
log "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
log ""

cd "$PROJECT_ROOT"

# State tracking
declare -A DEPLOYED_APPS
declare -A DEPLOYED_VKS

# ============================================================================
# PHASE 1: Build All Contracts
# ============================================================================
if [ $START_PHASE -le 1 ]; then
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${BLUE}  PHASE 1: Building Contracts${NC}"
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""

    if $SKIP_BUILD; then
        log "${YELLOW}Skipping build (--skip-build)${NC}"
    else
        log "${YELLOW}Building all contracts...${NC}"

        if "$SCRIPT_DIR/build-all.sh" --verify; then
            log "${GREEN}✓ All contracts built successfully${NC}"

            # Extract VKs from build manifest
            if [ -f "$PROJECT_ROOT/build-manifest.json" ]; then
                DEPLOYED_VKS["token"]=$(cat "$PROJECT_ROOT/build-manifest.json" | grep -A5 '"zkusd-token"' | grep '"vk"' | sed 's/.*: "//;s/".*//')
                DEPLOYED_VKS["vault-manager"]=$(cat "$PROJECT_ROOT/build-manifest.json" | grep -A5 '"zkusd-vault-manager"' | grep '"vk"' | sed 's/.*: "//;s/".*//')
                DEPLOYED_VKS["stability-pool"]=$(cat "$PROJECT_ROOT/build-manifest.json" | grep -A5 '"zkusd-stability-pool"' | grep '"vk"' | sed 's/.*: "//;s/".*//')
                DEPLOYED_VKS["price-oracle"]=$(cat "$PROJECT_ROOT/build-manifest.json" | grep -A5 '"zkusd-price-oracle"' | grep '"vk"' | sed 's/.*: "//;s/".*//')

                log ""
                log "${GREEN}VKs computed:${NC}"
                log "  Token:         ${DEPLOYED_VKS["token"]}"
                log "  VaultManager:  ${DEPLOYED_VKS["vault-manager"]}"
                log "  StabilityPool: ${DEPLOYED_VKS["stability-pool"]}"
                log "  PriceOracle:   ${DEPLOYED_VKS["price-oracle"]}"
            fi
        else
            log "${RED}✗ Build failed${NC}"
            exit 1
        fi
    fi
fi

log ""

# ============================================================================
# PHASE 2: Deploy PriceOracle (Independent)
# ============================================================================
if [ $START_PHASE -le 2 ]; then
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${BLUE}  PHASE 2: Deploy PriceOracle${NC}"
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""

    log "${YELLOW}PriceOracle is independent - can be deployed first${NC}"

    if $DRY_RUN; then
        log "${YELLOW}DRY RUN: Would deploy PriceOracle${NC}"
        # Generate app_id placeholder
        DEPLOYED_APPS["price-oracle"]="PLACEHOLDER_ORACLE_APP_ID"
    else
        log ""
        log "${YELLOW}To deploy PriceOracle:${NC}"
        log "  1. Get a funding UTXO"
        log "  2. Run: ./scripts/deploy/deploy-contract.sh \\"
        log "       --contract price-oracle \\"
        log "       --network $NETWORK \\"
        log "       --funding-utxo <UTXO> \\"
        log "       --funding-value <SATS> \\"
        log "       --output-address $OUTPUT_ADDRESS"
        log ""
        log "${CYAN}Enter PriceOracle app_id after deployment (or 'skip'):${NC}"
        read -r ORACLE_APP_ID

        if [ "$ORACLE_APP_ID" != "skip" ]; then
            DEPLOYED_APPS["price-oracle"]="$ORACLE_APP_ID"
            log "${GREEN}✓ PriceOracle app_id: $ORACLE_APP_ID${NC}"
        fi
    fi
fi

log ""

# ============================================================================
# PHASE 3: Deploy Token (Placeholder Minter)
# ============================================================================
if [ $START_PHASE -le 3 ]; then
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${BLUE}  PHASE 3: Deploy Token${NC}"
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""

    log "${YELLOW}Token will be initialized with placeholder minter${NC}"
    log "${YELLOW}(Will be updated after VaultManager deployment)${NC}"

    if $DRY_RUN; then
        log "${YELLOW}DRY RUN: Would deploy Token${NC}"
        DEPLOYED_APPS["token"]="PLACEHOLDER_TOKEN_APP_ID"
    else
        log ""
        log "${YELLOW}To deploy Token:${NC}"
        log "  ./scripts/deploy/deploy-contract.sh \\"
        log "       --contract token \\"
        log "       --network $NETWORK \\"
        log "       --funding-utxo <UTXO> \\"
        log "       --funding-value <SATS> \\"
        log "       --output-address $OUTPUT_ADDRESS \\"
        log "       --init-params '{\"authorized_minter\": \"0000000000000000000000000000000000000000000000000000000000000000\"}'"
        log ""
        log "${CYAN}Enter Token app_id after deployment (or 'skip'):${NC}"
        read -r TOKEN_APP_ID

        if [ "$TOKEN_APP_ID" != "skip" ]; then
            DEPLOYED_APPS["token"]="$TOKEN_APP_ID"
            log "${GREEN}✓ Token app_id: $TOKEN_APP_ID${NC}"
        fi
    fi
fi

log ""

# ============================================================================
# PHASE 4: Deploy StabilityPool & VaultManager
# ============================================================================
if [ $START_PHASE -le 4 ]; then
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${BLUE}  PHASE 4: Deploy StabilityPool & VaultManager${NC}"
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""

    log "${YELLOW}These contracts need cross-references to Token and Oracle${NC}"

    if $DRY_RUN; then
        log "${YELLOW}DRY RUN: Would deploy StabilityPool and VaultManager${NC}"
        DEPLOYED_APPS["stability-pool"]="PLACEHOLDER_SP_APP_ID"
        DEPLOYED_APPS["vault-manager"]="PLACEHOLDER_VM_APP_ID"
    else
        # StabilityPool
        log ""
        log "${CYAN}Deploy StabilityPool:${NC}"
        log "  ./scripts/deploy/deploy-contract.sh \\"
        log "       --contract stability-pool \\"
        log "       --network $NETWORK \\"
        log "       --funding-utxo <UTXO> \\"
        log "       --funding-value <SATS> \\"
        log "       --output-address $OUTPUT_ADDRESS \\"
        log "       --init-params '{\"token_id\": \"${DEPLOYED_APPS["token"]}\", \"vault_manager_id\": \"WILL_UPDATE\"}'"
        log ""
        log "${CYAN}Enter StabilityPool app_id (or 'skip'):${NC}"
        read -r SP_APP_ID

        if [ "$SP_APP_ID" != "skip" ]; then
            DEPLOYED_APPS["stability-pool"]="$SP_APP_ID"
        fi

        # VaultManager
        log ""
        log "${CYAN}Deploy VaultManager:${NC}"
        log "  ./scripts/deploy/deploy-contract.sh \\"
        log "       --contract vault-manager \\"
        log "       --network $NETWORK \\"
        log "       --funding-utxo <UTXO> \\"
        log "       --funding-value <SATS> \\"
        log "       --output-address $OUTPUT_ADDRESS \\"
        log "       --init-params '{"
        log "         \"token_id\": \"${DEPLOYED_APPS["token"]}\","
        log "         \"stability_pool_id\": \"${DEPLOYED_APPS["stability-pool"]}\","
        log "         \"price_oracle_id\": \"${DEPLOYED_APPS["price-oracle"]}\","
        log "         \"admin\": \"$ADMIN_ADDRESS\""
        log "       }'"
        log ""
        log "${CYAN}Enter VaultManager app_id (or 'skip'):${NC}"
        read -r VM_APP_ID

        if [ "$VM_APP_ID" != "skip" ]; then
            DEPLOYED_APPS["vault-manager"]="$VM_APP_ID"
        fi
    fi
fi

log ""

# ============================================================================
# PHASE 5: Update Token Authorized Minter
# ============================================================================
if [ $START_PHASE -le 5 ]; then
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${BLUE}  PHASE 5: Update Token Authorized Minter${NC}"
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""

    log "${YELLOW}Now that VaultManager is deployed, update Token's authorized_minter${NC}"

    if $DRY_RUN; then
        log "${YELLOW}DRY RUN: Would update Token authorized_minter${NC}"
    else
        log ""
        log "${CYAN}Create a spell to update Token state:${NC}"
        log "  - Input: Current Token state UTXO"
        log "  - Output: Token state with authorized_minter = ${DEPLOYED_APPS["vault-manager"]}"
        log ""
        log "${YELLOW}This requires a custom spell. See documentation for format.${NC}"
    fi
fi

log ""

# ============================================================================
# Summary
# ============================================================================
log "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
log "${CYAN}║                    Deployment Summary                          ║${NC}"
log "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
log ""

log "Deployed Contracts:"
for contract in "${!DEPLOYED_APPS[@]}"; do
    log "  $contract: ${DEPLOYED_APPS[$contract]}"
done

log ""
log "Log file: $DEPLOY_LOG"
log ""

if $DRY_RUN; then
    log "${YELLOW}DRY RUN completed. No changes made.${NC}"
else
    log "${GREEN}Deployment steps completed. Verify on block explorer.${NC}"
    log ""
    log "Next steps:"
    log "  1. Update deployment-config.json with new app_ids"
    log "  2. Test with a sample vault opening"
    log "  3. Commit configuration changes"
fi
