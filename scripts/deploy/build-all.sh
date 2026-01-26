#!/usr/bin/env bash
# ============================================================================
# zkUSD Protocol - Build All Contracts
# ============================================================================
# Builds all zkUSD contracts for deployment with proper WASM targets.
#
# Usage:
#   ./scripts/deploy/build-all.sh [--verify] [--copy]
#
# Options:
#   --verify    Compute and display VKs after building
#   --copy      Copy WASMs to apps/web/public/wasm/
#
# Output:
#   - target/wasm32-wasip1/release/*.wasm
#   - build-manifest.json (if --verify)
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
TARGET="wasm32-wasip1"
PROFILE="release"
OUTPUT_DIR="$PROJECT_ROOT/target/$TARGET/$PROFILE"
WEB_WASM_DIR="$PROJECT_ROOT/apps/web/public/wasm"

# Parse arguments
VERIFY=false
COPY=false
for arg in "$@"; do
    case $arg in
        --verify) VERIFY=true ;;
        --copy) COPY=true ;;
        --help)
            echo "Usage: $0 [--verify] [--copy]"
            echo "  --verify    Compute and display VKs after building"
            echo "  --copy      Copy WASMs to apps/web/public/wasm/"
            exit 0
            ;;
    esac
done

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  zkUSD Protocol - Contract Builder${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

cd "$PROJECT_ROOT"

# Check for required tools
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}ERROR: cargo not found. Please install Rust.${NC}"
    exit 1
fi

if $VERIFY && ! command -v charms &> /dev/null; then
    echo -e "${YELLOW}WARNING: charms CLI not found. VK verification disabled.${NC}"
    VERIFY=false
fi

# Ensure target is installed
echo -e "${YELLOW}Checking $TARGET target...${NC}"
if ! rustup target list --installed | grep -q "$TARGET"; then
    echo -e "${YELLOW}Installing $TARGET target...${NC}"
    rustup target add "$TARGET"
fi

# Build manifest
BUILD_MANIFEST="$PROJECT_ROOT/build-manifest.json"
echo "{" > "$BUILD_MANIFEST"
echo '  "build_time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",' >> "$BUILD_MANIFEST"
echo '  "target": "'$TARGET'",' >> "$BUILD_MANIFEST"
echo '  "contracts": {' >> "$BUILD_MANIFEST"

BUILD_SUCCESS=true
FIRST_CONTRACT=true

# Function to build a contract
build_contract() {
    local package="$1"
    local binary="$2"
    local features="$3"

    echo ""
    echo -e "${BLUE}Building $package...${NC}"
    echo -e "  Binary: $binary"
    echo -e "  Features: $features"

    # Build command
    local BUILD_CMD="cargo build --release --target $TARGET -p $package --bin $binary"
    if [ -n "$features" ]; then
        BUILD_CMD="$BUILD_CMD --features $features"
    fi

    if $BUILD_CMD 2>&1; then
        local WASM_PATH="$OUTPUT_DIR/$binary.wasm"

        if [ -f "$WASM_PATH" ]; then
            local SIZE=$(ls -lh "$WASM_PATH" | awk '{print $5}')
            echo -e "${GREEN}  ✓ Built: $WASM_PATH ($SIZE)${NC}"

            # Compute VK if requested
            local VK=""
            if $VERIFY; then
                VK=$(charms app vk "$WASM_PATH" 2>/dev/null || echo "ERROR")
                if [ "$VK" != "ERROR" ]; then
                    echo -e "${GREEN}  ✓ VK: $VK${NC}"
                else
                    echo -e "${RED}  ✗ VK computation failed${NC}"
                    VK=""
                fi
            fi

            # Copy to web directory if requested
            if $COPY; then
                mkdir -p "$WEB_WASM_DIR"
                cp "$WASM_PATH" "$WEB_WASM_DIR/"
                echo -e "${GREEN}  ✓ Copied to $WEB_WASM_DIR/${NC}"
            fi

            # Add to manifest
            if ! $FIRST_CONTRACT; then
                echo "," >> "$BUILD_MANIFEST"
            fi
            FIRST_CONTRACT=false

            local SIZE_BYTES=$(stat -f%z "$WASM_PATH" 2>/dev/null || stat -c%s "$WASM_PATH" 2>/dev/null || echo "0")

            echo -n '    "'$package'": {' >> "$BUILD_MANIFEST"
            echo -n '"binary": "'$binary'",' >> "$BUILD_MANIFEST"
            echo -n '"wasm_path": "'$WASM_PATH'",' >> "$BUILD_MANIFEST"
            echo -n '"size_bytes": '$SIZE_BYTES',' >> "$BUILD_MANIFEST"
            if [ -n "$VK" ]; then
                echo -n '"vk": "'$VK'"' >> "$BUILD_MANIFEST"
            else
                echo -n '"vk": null' >> "$BUILD_MANIFEST"
            fi
            echo -n '}' >> "$BUILD_MANIFEST"

            return 0
        else
            echo -e "${RED}  ✗ WASM not found at expected path${NC}"
            return 1
        fi
    else
        echo -e "${RED}  ✗ Build failed${NC}"
        return 1
    fi
}

# Build each contract
build_contract "zkusd-price-oracle" "zkusd-price-oracle-app" "charms" || BUILD_SUCCESS=false
build_contract "zkusd-token" "zkusd-token-app" "charms" || BUILD_SUCCESS=false
build_contract "zkusd-stability-pool" "zkusd-stability-pool-app" "charms" || BUILD_SUCCESS=false
build_contract "zkusd-vault-manager" "zkusd-vault-manager-app" "charms" || BUILD_SUCCESS=false

# Close manifest
echo "" >> "$BUILD_MANIFEST"
echo "  }" >> "$BUILD_MANIFEST"
echo "}" >> "$BUILD_MANIFEST"

echo ""
echo -e "${BLUE}============================================${NC}"

if $BUILD_SUCCESS; then
    echo -e "${GREEN}All contracts built successfully!${NC}"
    echo ""
    echo "Build manifest: $BUILD_MANIFEST"

    if $VERIFY; then
        echo ""
        echo -e "${YELLOW}VK Summary:${NC}"
        grep '"vk":' "$BUILD_MANIFEST" | grep -v 'null' | sed 's/.*"vk": "/  /' | sed 's/".*//'
    fi

    exit 0
else
    echo -e "${RED}Some contracts failed to build.${NC}"
    exit 1
fi
