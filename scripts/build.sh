#!/bin/bash
# zkUSD Build Script
# Builds all contracts for the zkUSD protocol

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  zkUSD Protocol Build Script   ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Check Rust is installed
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Error: Rust/Cargo is not installed${NC}"
    echo "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

echo -e "${GREEN}✓ Rust installed: $(rustc --version)${NC}"

# Change to project root
cd "$PROJECT_ROOT"

# Build mode
BUILD_MODE="${1:-release}"

if [ "$BUILD_MODE" == "release" ]; then
    BUILD_FLAGS="--release"
    echo -e "${YELLOW}Building in RELEASE mode...${NC}"
elif [ "$BUILD_MODE" == "debug" ]; then
    BUILD_FLAGS=""
    echo -e "${YELLOW}Building in DEBUG mode...${NC}"
else
    echo -e "${RED}Unknown build mode: $BUILD_MODE${NC}"
    echo "Usage: ./build.sh [release|debug]"
    exit 1
fi

echo ""

# Build all contracts
echo -e "${BLUE}[1/5] Building common library...${NC}"
cargo build $BUILD_FLAGS -p zkusd-common
echo -e "${GREEN}✓ Common library built${NC}"

echo ""
echo -e "${BLUE}[2/5] Building zkUSD Token contract...${NC}"
cargo build $BUILD_FLAGS -p zkusd-token
echo -e "${GREEN}✓ zkUSD Token built${NC}"

echo ""
echo -e "${BLUE}[3/5] Building Vault Manager contract...${NC}"
cargo build $BUILD_FLAGS -p zkusd-vault-manager
echo -e "${GREEN}✓ Vault Manager built${NC}"

echo ""
echo -e "${BLUE}[4/5] Building Stability Pool contract...${NC}"
cargo build $BUILD_FLAGS -p zkusd-stability-pool
echo -e "${GREEN}✓ Stability Pool built${NC}"

echo ""
echo -e "${BLUE}[5/5] Building Price Oracle contract...${NC}"
cargo build $BUILD_FLAGS -p zkusd-price-oracle
echo -e "${GREEN}✓ Price Oracle built${NC}"

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  All contracts built successfully!${NC}"
echo -e "${GREEN}================================${NC}"

# Show binary locations
if [ "$BUILD_MODE" == "release" ]; then
    echo ""
    echo -e "${YELLOW}Build artifacts location:${NC}"
    echo "  target/release/"
fi

# Run tests
echo ""
read -p "Run tests? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Running tests...${NC}"
    cargo test $BUILD_FLAGS
    echo -e "${GREEN}✓ All tests passed!${NC}"
fi
