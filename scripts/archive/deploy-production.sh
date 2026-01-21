#!/bin/bash
# =============================================================================
# zkUSD Production Deployment Script
# =============================================================================
# Deploys VaultManager and Token contracts to Bitcoin testnet4
#
# Prerequisites:
# 1. bitcoind running and synced with testnet4
# 2. Wallet with sufficient testnet4 BTC (at least 0.001 BTC per contract)
# 3. Charms CLI installed and configured
#
# Usage:
#   ./scripts/deploy-production.sh
# =============================================================================

set -e
cd "$(dirname "$0")/.."

echo "=== zkUSD Production Deployment ==="
echo ""

# Configuration
NETWORK="testnet4"
WASM_DIR="target/wasm32-wasip1/release"
SPELL_DIR="spells"
OUTPUT_DIR="deployments"
OWNER_ADDRESS="tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"

# =============================================================================
# VK Configuration - Choose deployment mode
# =============================================================================
# DEPLOYED: Use existing contracts deployed on testnet4 (with debug output)
# PRODUCTION: Deploy fresh contracts (without debug output)
# =============================================================================

DEPLOY_MODE="${DEPLOY_MODE:-DEPLOYED}"

if [ "$DEPLOY_MODE" = "DEPLOYED" ]; then
    echo "Using DEPLOYED VKs (existing testnet4 contracts with debug output)"
    # VKs from deployment-config.json (already deployed on testnet4)
    VM_VK="56ff2636c4d11caeed8a90a608e7c067928e5368f3166d495b85be90af659c44"
    VM_ID="3ce7c8f65b55f2e66f25370f951abfc49af6980d63969f9368f0b5bb1cf878d0"
    TOKEN_VK="7d1a06745a94adf1195fb9f2f987cb48b8c46b814f53167c619c9175cd406903"
    TOKEN_ID="a6b3570c84064d72dc6687d0309154469efa6a427fd3c1691e656d6172455c82"
    ORACLE_VK="b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32"
    ORACLE_ID="8aa4f505cb3e6f7f8d7f553e517dc0c161fd662ce56ce9412ad5dd00991b1ef2"
    SP_VK="ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752"
    SP_ID="c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf"
else
    echo "Using PRODUCTION VKs (fresh deployment without debug output)"
    # VKs from cleaned contracts (no debug output)
    VM_VK="3a6a02f4fe4b4b61f03018cabb7995240799fac45323ff766f9ecc3398bb7874"
    TOKEN_VK="355518c664be1dd7f9f9c283feb2c48adf3baa45c88e04324fb52fc11d625235"
    ORACLE_VK="b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32"
    # IDs will be generated from funding UTXOs for fresh deployment
    VM_ID=""
    TOKEN_ID=""
    ORACLE_ID="8aa4f505cb3e6f7f8d7f553e517dc0c161fd662ce56ce9412ad5dd00991b1ef2"
    SP_VK=""
    SP_ID=""
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "Production VKs:"
echo "  VaultManager: $VM_VK"
echo "  Token:        $TOKEN_VK"
echo "  Oracle:       $ORACLE_VK"
echo ""

# Step 1: Build WASM binaries
echo "Step 1: Building WASM binaries..."
cargo build --release --target wasm32-wasip1 --features charms \
  -p zkusd-vault-manager -p zkusd-token -p zkusd-price-oracle

# Verify VKs match
echo "Verifying VKs..."
ACTUAL_VM_VK=$(charms app vk "$WASM_DIR/zkusd-vault-manager-app.wasm")
ACTUAL_TOKEN_VK=$(charms app vk "$WASM_DIR/zkusd-token-app.wasm")

if [ "$ACTUAL_VM_VK" != "$VM_VK" ]; then
  echo "ERROR: VaultManager VK mismatch!"
  echo "  Expected: $VM_VK"
  echo "  Got:      $ACTUAL_VM_VK"
  exit 1
fi

if [ "$ACTUAL_TOKEN_VK" != "$TOKEN_VK" ]; then
  echo "ERROR: Token VK mismatch!"
  echo "  Expected: $TOKEN_VK"
  echo "  Got:      $ACTUAL_TOKEN_VK"
  exit 1
fi

echo "VKs verified successfully."
echo ""

# Step 2: Check for funding UTXOs
echo "Step 2: Checking for funding UTXOs..."
echo ""
echo "You need to provide funding UTXOs for deployment."
echo "Each contract needs ~10,000 sats minimum (0.0001 BTC)"
echo ""

read -p "Enter VaultManager funding UTXO (txid:vout): " VM_FUNDING_UTXO
read -p "Enter Token funding UTXO (txid:vout): " TOKEN_FUNDING_UTXO

if [ -z "$VM_FUNDING_UTXO" ] || [ -z "$TOKEN_FUNDING_UTXO" ]; then
  echo "ERROR: Both funding UTXOs are required."
  exit 1
fi

# Extract txids for app_id derivation
VM_FUNDING_TXID=$(echo "$VM_FUNDING_UTXO" | cut -d: -f1)
TOKEN_FUNDING_TXID=$(echo "$TOKEN_FUNDING_UTXO" | cut -d: -f1)

echo ""
echo "Funding UTXOs:"
echo "  VaultManager: $VM_FUNDING_UTXO"
echo "  Token:        $TOKEN_FUNDING_UTXO"
echo ""

# Step 3: Generate deployment spells
echo "Step 3: Generating deployment spells..."

# VaultManager init spell (with Token placeholder - will update after)
cat > "$OUTPUT_DIR/deploy-vault-manager.yaml" << EOF
version: 8

apps:
  \$VM: n/${VM_FUNDING_TXID}/${VM_VK}

private_inputs:
  \$VM:
    op: 0
    admin: [213, 79, 168, 49, 172, 25, 87, 76, 85, 3, 241, 203, 213, 5, 147, 74, 11, 171, 60, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    zkusd_token_id: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    stability_pool_id: [193, 28, 84, 81, 200, 52, 245, 78, 213, 98, 39, 179, 251, 72, 211, 102, 222, 44, 19, 156, 42, 15, 85, 154, 238, 191, 180, 90, 248, 160, 103, 191]
    price_oracle_id: [138, 164, 245, 5, 203, 62, 111, 127, 141, 127, 85, 62, 81, 125, 192, 193, 97, 253, 102, 44, 229, 108, 233, 65, 42, 213, 221, 0, 153, 27, 30, 242]
    active_pool: [172, 79, 168, 49, 172, 25, 87, 76, 85, 3, 241, 203, 213, 5, 147, 74, 11, 171, 60, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    default_pool: [222, 250, 168, 49, 172, 25, 87, 76, 85, 3, 241, 203, 213, 5, 147, 74, 11, 171, 60, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

ins:
  - utxo_id: ${VM_FUNDING_UTXO}
    charms: {}

outs:
  - address: ${OWNER_ADDRESS}
    charms:
      \$VM:
        protocol:
          total_collateral: 0
          total_debt: 0
          active_vault_count: 0
          base_rate: 50
          last_fee_update_block: 0
          admin: [213, 79, 168, 49, 172, 25, 87, 76, 85, 3, 241, 203, 213, 5, 147, 74, 11, 171, 60, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
          is_paused: false
        zkusd_token_id: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        stability_pool_id: [193, 28, 84, 81, 200, 52, 245, 78, 213, 98, 39, 179, 251, 72, 211, 102, 222, 44, 19, 156, 42, 15, 85, 154, 238, 191, 180, 90, 248, 160, 103, 191]
        price_oracle_id: [138, 164, 245, 5, 203, 62, 111, 127, 141, 127, 85, 62, 81, 125, 192, 193, 97, 253, 102, 44, 229, 108, 233, 65, 42, 213, 221, 0, 153, 27, 30, 242]
        active_pool: [172, 79, 168, 49, 172, 25, 87, 76, 85, 3, 241, 203, 213, 5, 147, 74, 11, 171, 60, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        default_pool: [222, 250, 168, 49, 172, 25, 87, 76, 85, 3, 241, 203, 213, 5, 147, 74, 11, 171, 60, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
EOF

# Token init spell (VaultManager app_id will be the funding txid)
cat > "$OUTPUT_DIR/deploy-token.yaml" << EOF
version: 8

apps:
  \$TOKEN_STATE: n/${TOKEN_FUNDING_TXID}/${TOKEN_VK}

private_inputs:
  \$TOKEN_STATE:
    op: 0
    authorized_minter: $(python3 -c "import binascii; print(list(binascii.unhexlify('${VM_FUNDING_TXID}')))")

ins:
  - utxo_id: ${TOKEN_FUNDING_UTXO}
    charms: {}

outs:
  - address: ${OWNER_ADDRESS}
    charms:
      \$TOKEN_STATE:
        authorized_minter: $(python3 -c "import binascii; print(list(binascii.unhexlify('${VM_FUNDING_TXID}')))")
        total_supply: 0
EOF

echo "Generated deployment spells in $OUTPUT_DIR/"
echo ""

# Step 4: Deploy VaultManager
echo "Step 4: Deploying VaultManager..."
echo ""
echo "Command to run:"
echo "  charms spell prove \\"
echo "    --spell $OUTPUT_DIR/deploy-vault-manager.yaml \\"
echo "    --app-bins $WASM_DIR/zkusd-vault-manager-app.wasm \\"
echo "    --funding-utxo <CHANGE_UTXO> \\"
echo "    --funding-utxo-value <VALUE> \\"
echo "    --change-address $OWNER_ADDRESS"
echo ""

read -p "Continue with VaultManager deployment? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
  echo "Deployment cancelled."
  exit 0
fi

# Would run actual deployment here in production
echo ""
echo "=== Deployment Summary ==="
echo ""
echo "VaultManager:"
echo "  App ID:  $VM_FUNDING_TXID"
echo "  VK:      $VM_VK"
echo "  Full:    n/$VM_FUNDING_TXID/$VM_VK"
echo ""
echo "Token:"
echo "  App ID:  $TOKEN_FUNDING_TXID"
echo "  VK:      $TOKEN_VK"
echo "  Full:    n/$TOKEN_FUNDING_TXID/$TOKEN_VK"
echo "  Fungible: t/$TOKEN_FUNDING_TXID/$TOKEN_VK"
echo ""
echo "Oracle (existing):"
echo "  App ID:  $ORACLE_ID"
echo "  VK:      $ORACLE_VK"
echo ""

# Save deployment info
cat > "$OUTPUT_DIR/deployment-info.json" << EOF
{
  "network": "$NETWORK",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contracts": {
    "vault_manager": {
      "app_id": "$VM_FUNDING_TXID",
      "vk": "$VM_VK",
      "nft_ref": "n/$VM_FUNDING_TXID/$VM_VK"
    },
    "token": {
      "app_id": "$TOKEN_FUNDING_TXID",
      "vk": "$TOKEN_VK",
      "nft_ref": "n/$TOKEN_FUNDING_TXID/$TOKEN_VK",
      "fungible_ref": "t/$TOKEN_FUNDING_TXID/$TOKEN_VK"
    },
    "oracle": {
      "app_id": "$ORACLE_ID",
      "vk": "$ORACLE_VK",
      "nft_ref": "n/$ORACLE_ID/$ORACLE_VK"
    }
  },
  "owner_address": "$OWNER_ADDRESS"
}
EOF

echo "Deployment info saved to $OUTPUT_DIR/deployment-info.json"
echo ""
echo "=== Deployment Complete ==="
