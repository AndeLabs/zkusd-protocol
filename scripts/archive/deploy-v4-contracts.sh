#!/bin/bash
# zkUSD V4 Contract Deployment
# Deploys contracts with btc_inputs fix

set -e

# Configuration
WALLET_ADDRESS="tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
ADMIN_HEX="0fef72e8286c0dd8d5dd569e930433c322330d338650adc1aa0a4502d35a1748"
WASM_DIR="/Users/munay/dev/zkUSD/apps/web/public/wasm"

# VKs from new WASMs (with btc_inputs fix)
SP_VK="2f0af64737460a261a550a542d203bc97b1a0a2cdf155c39f0c65f5a3abad9c3"
VM_VK="3b981bfd64228b2020484d271b0a15c03dec9717c9f0edde3a44155296b303b0"
TOKEN_VK="ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128"
ORACLE_VK="98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d"

# Existing Oracle (keep using this)
ORACLE_APP_ID="26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5"
ORACLE_STATE_UTXO="03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4:0"

# UTXOs to use for deployment (these define the app IDs)
SP_UTXO="458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423:2"
VM_UTXO="aac009d17665311d94ec0accf48aad8db6a06c54cc383bb8933c28eb92b03f02:2"
TOKEN_UTXO="20d41c6e5b4df501f6394392a56a534730bc84794da1f8adabe5dc6084ee560c:2"

# Fee UTXOs
FEE_UTXO_1="b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3:2"
FEE_UTXO_2="c7f436f44d97a8c67713e9cfecbd0f63222f8c6f1b6dc8af74cac860bf54e907:0"
FEE_UTXO_3="6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988:2"
FEE_VALUE_1=105423
FEE_VALUE_2=500000
FEE_VALUE_3=45564

echo "=== zkUSD V4 Deployment ==="
echo "Wallet: $WALLET_ADDRESS"
echo

# Calculate App IDs from UTXOs
echo "Calculating App IDs..."
SP_APP_ID=$(echo -n "$SP_UTXO" | sha256sum | cut -d' ' -f1)
VM_APP_ID=$(echo -n "$VM_UTXO" | sha256sum | cut -d' ' -f1)
TOKEN_APP_ID=$(echo -n "$TOKEN_UTXO" | sha256sum | cut -d' ' -f1)

echo "Stability Pool App ID: $SP_APP_ID"
echo "Vault Manager App ID: $VM_APP_ID"
echo "Token App ID: $TOKEN_APP_ID"
echo "Oracle App ID: $ORACLE_APP_ID (existing)"
echo

# Helper function: Convert hex string to YAML byte array
hex_to_yaml_bytes() {
    local hex="$1"
    local result="["
    for ((i=0; i<${#hex}; i+=2)); do
        local byte=$((16#${hex:i:2}))
        if [ $i -gt 0 ]; then
            result+=", "
        fi
        result+="$byte"
    done
    result+="]"
    echo "$result"
}

# Convert all IDs to byte arrays for YAML
ADMIN_BYTES=$(hex_to_yaml_bytes "$ADMIN_HEX")
SP_APP_ID_BYTES=$(hex_to_yaml_bytes "$SP_APP_ID")
VM_APP_ID_BYTES=$(hex_to_yaml_bytes "$VM_APP_ID")
TOKEN_APP_ID_BYTES=$(hex_to_yaml_bytes "$TOKEN_APP_ID")
ORACLE_APP_ID_BYTES=$(hex_to_yaml_bytes "$ORACLE_APP_ID")

echo "App IDs as byte arrays:"
echo "Admin: $ADMIN_BYTES"
echo "SP: $SP_APP_ID_BYTES"
echo "VM: $VM_APP_ID_BYTES"
echo "Token: $TOKEN_APP_ID_BYTES"
echo

# Verify WASMs exist
echo "Verifying WASM binaries..."
for wasm in zkusd-stability-pool-app zkusd-vault-manager-app zkusd-token-app; do
    if [ ! -f "$WASM_DIR/$wasm.wasm" ]; then
        echo "ERROR: Missing WASM: $WASM_DIR/$wasm.wasm"
        exit 1
    fi
done
echo "All WASMs found."
echo

# Get prevtx for Oracle state UTXO
ORACLE_PREVTX_ID=$(echo "$ORACLE_STATE_UTXO" | cut -d: -f1)
echo "Fetching Oracle prevtx: $ORACLE_PREVTX_ID"
ORACLE_PREVTX=$(curl -s "https://mempool.space/testnet4/api/tx/$ORACLE_PREVTX_ID/hex")
if [ -z "$ORACLE_PREVTX" ]; then
    echo "ERROR: Failed to fetch Oracle prevtx"
    exit 1
fi
echo "Oracle prevtx fetched (${#ORACLE_PREVTX} chars)"
echo

# =============================================================================
# DEPLOY STABILITY POOL
# =============================================================================
echo "=== Deploying Stability Pool ==="

SP_SPELL_FILE="/tmp/deploy-sp-v4.yaml"
cat > "$SP_SPELL_FILE" << 'EOFSP'
version: 8

apps:
  $sp: n/SP_APP_ID_PLACEHOLDER/SP_VK_PLACEHOLDER

private_inputs:
  $sp:
    op: 0
    zkusd_token_id: TOKEN_APP_ID_BYTES_PLACEHOLDER
    vault_manager_id: VM_APP_ID_BYTES_PLACEHOLDER
    admin: ADMIN_BYTES_PLACEHOLDER

ins:
  - utxo_id: SP_UTXO_PLACEHOLDER
    charms: {}

outs:
  - address: WALLET_ADDRESS_PLACEHOLDER
    charms:
      $sp:
        config:
          zkusd_token_id: TOKEN_APP_ID_BYTES_PLACEHOLDER
          vault_manager_id: VM_APP_ID_BYTES_PLACEHOLDER
          admin: ADMIN_BYTES_PLACEHOLDER
        state:
          total_zkusd: 0
          total_btc: 0
          product_p: "1000000000000000000"
          sum_s: 0
          current_epoch: 0
          current_scale: 0
          depositor_count: 0
EOFSP

# Replace placeholders
sed -i '' \
    -e "s|SP_APP_ID_PLACEHOLDER|$SP_APP_ID|g" \
    -e "s|SP_VK_PLACEHOLDER|$SP_VK|g" \
    -e "s|TOKEN_APP_ID_BYTES_PLACEHOLDER|$TOKEN_APP_ID_BYTES|g" \
    -e "s|VM_APP_ID_BYTES_PLACEHOLDER|$VM_APP_ID_BYTES|g" \
    -e "s|ADMIN_BYTES_PLACEHOLDER|$ADMIN_BYTES|g" \
    -e "s|SP_UTXO_PLACEHOLDER|$SP_UTXO|g" \
    -e "s|WALLET_ADDRESS_PLACEHOLDER|$WALLET_ADDRESS|g" \
    "$SP_SPELL_FILE"

echo "Stability Pool spell created: $SP_SPELL_FILE"
cat "$SP_SPELL_FILE"
echo
echo

# Get SP prevtx
SP_PREVTX_ID=$(echo "$SP_UTXO" | cut -d: -f1)
echo "Fetching SP collateral prevtx: $SP_PREVTX_ID"
SP_PREVTX=$(curl -s "https://mempool.space/testnet4/api/tx/$SP_PREVTX_ID/hex")
if [ -z "$SP_PREVTX" ]; then
    echo "ERROR: Failed to fetch SP prevtx"
    exit 1
fi
echo "SP prevtx fetched (${#SP_PREVTX} chars)"

# Get fee prevtx
FEE_PREVTX_ID=$(echo "$FEE_UTXO_1" | cut -d: -f1)
echo "Fetching fee prevtx: $FEE_PREVTX_ID"
FEE_PREVTX=$(curl -s "https://mempool.space/testnet4/api/tx/$FEE_PREVTX_ID/hex")
if [ -z "$FEE_PREVTX" ]; then
    echo "ERROR: Failed to fetch fee prevtx"
    exit 1
fi
echo "Fee prevtx fetched (${#FEE_PREVTX} chars)"
echo

echo "Running charms spell prove for Stability Pool..."
echo "Command: charms spell prove \\"
echo "  --spell $SP_SPELL_FILE \\"
echo "  --prev-txs <sp_prevtx>,<fee_prevtx> \\"
echo "  --app-bins $WASM_DIR/zkusd-stability-pool-app.wasm \\"
echo "  --funding-utxo $FEE_UTXO_1 \\"
echo "  --funding-utxo-value $FEE_VALUE_1 \\"
echo "  --change-address $WALLET_ADDRESS \\"
echo "  --fee-rate 2.0"
echo

# Run the prove command
SP_RESULT=$(charms spell prove \
    --spell "$SP_SPELL_FILE" \
    --prev-txs "$SP_PREVTX,$FEE_PREVTX" \
    --app-bins "$WASM_DIR/zkusd-stability-pool-app.wasm" \
    --funding-utxo "$FEE_UTXO_1" \
    --funding-utxo-value "$FEE_VALUE_1" \
    --change-address "$WALLET_ADDRESS" \
    --fee-rate 2.0 2>&1)

echo "Stability Pool prove result:"
echo "$SP_RESULT"
echo

if echo "$SP_RESULT" | grep -q "error\|Error\|ERROR"; then
    echo "ERROR: Stability Pool deployment failed"
    exit 1
fi

echo "=== Stability Pool deployed successfully ==="
echo
echo "New App IDs for config update:"
echo "  stabilityPool.appId: $SP_APP_ID"
echo "  stabilityPool.vk: $SP_VK"
echo

echo "=== V4 Deployment Complete ==="
echo
echo "To complete full deployment:"
echo "1. Update packages/config/src/testnet4.ts with new App IDs and VKs"
echo "2. Run VM deployment with the same pattern"
echo "3. Run Token deployment with authorized_minter = $VM_APP_ID"
