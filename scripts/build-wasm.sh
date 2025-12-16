#!/bin/bash
# zkUSD WASM Build Script
# Builds contracts for Charms deployment (WASM target)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

WASM_TARGET="wasm32-unknown-unknown"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD WASM Build Script       ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check Rust
    if ! command -v cargo &> /dev/null; then
        echo -e "${RED}Error: Rust/Cargo not installed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Rust: $(rustc --version)${NC}"

    # Check WASM target
    if ! rustup target list --installed | grep -q "$WASM_TARGET"; then
        echo -e "${YELLOW}Installing WASM target...${NC}"
        rustup target add $WASM_TARGET
    fi
    echo -e "${GREEN}✓ WASM target: $WASM_TARGET${NC}"

    # Check wasm-opt (optional but recommended)
    if command -v wasm-opt &> /dev/null; then
        echo -e "${GREEN}✓ wasm-opt: $(wasm-opt --version)${NC}"
        HAVE_WASM_OPT=true
    else
        echo -e "${YELLOW}⚠ wasm-opt not found (optional)${NC}"
        echo "  Install: cargo install wasm-opt"
        HAVE_WASM_OPT=false
    fi

    echo ""
}

# Build a single contract
build_contract() {
    local name=$1
    local path=$2

    echo -e "${BLUE}Building $name...${NC}"

    cd "$PROJECT_ROOT/$path"

    # Build with charms feature
    cargo build \
        --target $WASM_TARGET \
        --release \
        --features charms \
        2>&1 | while read line; do echo "  $line"; done

    # Find the WASM file
    local wasm_file="$PROJECT_ROOT/target/$WASM_TARGET/release/${name//-/_}.wasm"

    if [ -f "$wasm_file" ]; then
        local size_before=$(ls -lh "$wasm_file" | awk '{print $5}')
        echo -e "  Size (before optimization): ${CYAN}$size_before${NC}"

        # Optimize with wasm-opt if available
        if [ "$HAVE_WASM_OPT" = true ]; then
            echo -e "  Running wasm-opt..."
            wasm-opt -Oz "$wasm_file" -o "$wasm_file.opt"
            mv "$wasm_file.opt" "$wasm_file"
            local size_after=$(ls -lh "$wasm_file" | awk '{print $5}')
            echo -e "  Size (after optimization): ${CYAN}$size_after${NC}"
        fi

        echo -e "${GREEN}✓ $name built: $wasm_file${NC}"
    else
        echo -e "${RED}✗ Failed to build $name${NC}"
        return 1
    fi

    echo ""
}

# Copy WASM files to output directory
collect_wasm() {
    echo -e "${BLUE}Collecting WASM files...${NC}"

    local out_dir="$PROJECT_ROOT/target/wasm"
    mkdir -p "$out_dir"

    local contracts=("zkusd_token" "zkusd_vault_manager" "zkusd_stability_pool" "zkusd_price_oracle")

    for contract in "${contracts[@]}"; do
        local src="$PROJECT_ROOT/target/$WASM_TARGET/release/${contract}.wasm"
        if [ -f "$src" ]; then
            cp "$src" "$out_dir/"
            echo -e "  ${GREEN}✓${NC} $contract.wasm"
        fi
    done

    echo ""
    echo -e "${GREEN}WASM files collected in: $out_dir${NC}"

    # Print sizes
    echo ""
    echo -e "${BLUE}WASM File Sizes:${NC}"
    ls -lh "$out_dir"/*.wasm 2>/dev/null | awk '{print "  " $9 ": " $5}'
}

# Main
main() {
    check_prerequisites

    cd "$PROJECT_ROOT"

    echo -e "${YELLOW}Building all contracts for WASM...${NC}"
    echo ""

    # Build common library first (as dependency)
    echo -e "${BLUE}Building common library...${NC}"
    cargo build --target $WASM_TARGET --release -p zkusd-common
    echo -e "${GREEN}✓ Common library built${NC}"
    echo ""

    # Build each contract
    build_contract "zkusd-token" "contracts/zkusd-token"
    build_contract "zkusd-vault-manager" "contracts/vault-manager"
    build_contract "zkusd-stability-pool" "contracts/stability-pool"
    build_contract "zkusd-price-oracle" "contracts/price-oracle"

    # Collect all WASM files
    collect_wasm

    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}  WASM Build Complete!          ${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "  1. Review WASM files in target/wasm/"
    echo "  2. Deploy with: charms app build"
    echo "  3. Get verification keys: charms app vk"
}

main "$@"
