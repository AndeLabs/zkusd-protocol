#!/bin/bash
# zkUSD Contract Deployment
#
# Unified deployment script - wrapper for scripts/deploy.ts
# Uses mempool.space API (no Bitcoin Core required)
#
# Usage:
#   ./scripts/deploy.sh vault-manager
#   ./scripts/deploy.sh vault-manager --dry-run
#   ./scripts/deploy.sh --list

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     zkUSD Contract Deployment        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"

# Check dependencies
if ! command -v npx &> /dev/null; then
    echo "Error: npx not found. Install Node.js first."
    exit 1
fi

if ! command -v charms &> /dev/null; then
    echo "Error: charms CLI not found."
    echo "Install: cargo install --locked charms"
    exit 1
fi

# Forward to TypeScript
if [ "$#" -eq 0 ] || [[ "$1" == "--list" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    npx ts-node scripts/deploy.ts --list
else
    CONTRACT="$1"
    shift
    npx ts-node scripts/deploy.ts --contract "$CONTRACT" "$@"
fi
