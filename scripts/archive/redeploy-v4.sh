#!/bin/bash
# zkUSD V4 Redeployment Script
# Deploys vault-manager, stability-pool, and token with btc_inputs fix

set -e

WALLET_FILE="deployments/testnet4/wallet.json"
WASM_DIR="apps/web/public/wasm"
OUTPUT_DIR="deployments/testnet4"
PROVER_URL="https://v8.charms.dev/spells/prove"
MEMPOOL_API="https://mempool.space/testnet4/api"

# Read wallet
ADDRESS=$(jq -r '.address' "$WALLET_FILE")
PUBKEY=$(jq -r '.public_key' "$WALLET_FILE")
PRIVKEY=$(jq -r '.private_key_wif' "$WALLET_FILE")

echo "=== zkUSD V4 Redeployment ==="
echo "Wallet: $ADDRESS"
echo ""

# Get VKs
echo "Getting VKs from WASMs..."
VM_VK=$(charms app vk "$WASM_DIR/zkusd-vault-manager-app.wasm")
SP_VK=$(charms app vk "$WASM_DIR/zkusd-stability-pool-app.wasm")
TOKEN_VK=$(charms app vk "$WASM_DIR/zkusd-token-app.wasm")
ORACLE_VK=$(charms app vk "$WASM_DIR/zkusd-price-oracle-app.wasm")

echo "Vault Manager VK: $VM_VK"
echo "Stability Pool VK: $SP_VK"
echo "Token VK: $TOKEN_VK"
echo "Oracle VK: $ORACLE_VK"
echo ""

# Get confirmed UTXOs
echo "Fetching UTXOs..."
UTXOS=$(curl -s "$MEMPOOL_API/address/$ADDRESS/utxo" | jq '[.[] | select(.status.confirmed == true) | select(.value > 40000)] | sort_by(-.value)')
UTXO_COUNT=$(echo "$UTXOS" | jq 'length')

echo "Found $UTXO_COUNT confirmed UTXOs > 40k sats"

if [ "$UTXO_COUNT" -lt 6 ]; then
    echo "ERROR: Need at least 6 UTXOs for 3 deployments"
    echo "Please fund the wallet with more UTXOs"
    exit 1
fi

# Extract UTXOs for deployments
get_utxo() {
    local idx=$1
    echo "$UTXOS" | jq -r ".[$idx] | \"\(.txid):\(.vout):\(.value)\""
}

# Helper to broadcast tx
broadcast_tx() {
    local tx_hex=$1
    local result=$(curl -s -X POST "$MEMPOOL_API/tx" -H "Content-Type: text/plain" -d "$tx_hex")
    if [[ "$result" =~ ^[a-f0-9]{64}$ ]]; then
        echo "$result"
    else
        echo "ERROR: $result" >&2
        return 1
    fi
}

# Helper to get raw tx
get_raw_tx() {
    local txid=$1
    curl -s "$MEMPOOL_API/tx/$txid/hex"
}

# Keep existing oracle (unchanged)
ORACLE_APPID="26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5"
ORACLE_STATE_UTXO="03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4:0"

echo ""
echo "=== Using existing Oracle ==="
echo "Oracle App ID: $ORACLE_APPID"
echo "Oracle State UTXO: $ORACLE_STATE_UTXO"

echo ""
echo "=== Starting deployment ==="

# Deploy Stability Pool first (no critical dependencies)
echo ""
echo "=== Deploying Stability Pool ==="

SP_COLL=$(get_utxo 0)
SP_FEE=$(get_utxo 1)
SP_COLL_TXID=$(echo "$SP_COLL" | cut -d: -f1)
SP_COLL_VOUT=$(echo "$SP_COLL" | cut -d: -f2)
SP_COLL_VALUE=$(echo "$SP_COLL" | cut -d: -f3)
SP_FEE_TXID=$(echo "$SP_FEE" | cut -d: -f1)
SP_FEE_VOUT=$(echo "$SP_FEE" | cut -d: -f2)
SP_FEE_VALUE=$(echo "$SP_FEE" | cut -d: -f3)

echo "Collateral UTXO: $SP_COLL_TXID:$SP_COLL_VOUT ($SP_COLL_VALUE sats)"
echo "Fee UTXO: $SP_FEE_TXID:$SP_FEE_VOUT ($SP_FEE_VALUE sats)"

# Build stability pool spell
SP_SPELL=$(cat <<EOF
{
  "version": 8,
  "apps": {
    "n/new/$SP_VK": "n/new/$SP_VK"
  },
  "ins": [
    { "utxo_id": "$SP_COLL_TXID:$SP_COLL_VOUT", "charms": {} }
  ],
  "outs": [
    {
      "address": "$ADDRESS",
      "charms": {
        "n/new/$SP_VK": {
          "total_zkusd": 0,
          "total_btc": 0,
          "product_p": "1000000000000000000",
          "epoch_sum_s": [],
          "depositor_count": 0
        }
      }
    }
  ]
}
EOF
)

# Get prev txs
SP_COLL_PREVTX=$(get_raw_tx "$SP_COLL_TXID")
SP_FEE_PREVTX=$(get_raw_tx "$SP_FEE_TXID")

# Load WASM
SP_WASM_B64=$(base64 -i "$WASM_DIR/zkusd-stability-pool-app.wasm")

# Build prover request
SP_REQUEST=$(cat <<EOF
{
  "spell": $SP_SPELL,
  "binaries": {
    "$SP_VK": "$SP_WASM_B64"
  },
  "prev_txs": [
    {"bitcoin": "$SP_COLL_PREVTX"},
    {"bitcoin": "$SP_FEE_PREVTX"}
  ],
  "funding_utxo": "$SP_FEE_TXID:$SP_FEE_VOUT",
  "funding_utxo_value": $SP_FEE_VALUE,
  "change_address": "$ADDRESS",
  "fee_rate": 5,
  "chain": "bitcoin"
}
EOF
)

echo "Sending to prover (this may take a few minutes)..."
SP_RESULT=$(curl -s -X POST "$PROVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$SP_REQUEST")

# Check for error
if echo "$SP_RESULT" | jq -e 'type == "string"' > /dev/null 2>&1; then
    echo "ERROR: $SP_RESULT"
    exit 1
fi

SP_COMMIT_TX=$(echo "$SP_RESULT" | jq -r '.[0].bitcoin // .[0]')
SP_SPELL_TX=$(echo "$SP_RESULT" | jq -r '.[1].bitcoin // .[1]')

echo "Commit TX ready (${#SP_COMMIT_TX} chars)"
echo "Spell TX ready (${#SP_SPELL_TX} chars)"

echo "Broadcasting commit TX..."
SP_COMMIT_TXID=$(broadcast_tx "$SP_COMMIT_TX")
echo "Commit TXID: $SP_COMMIT_TXID"

echo "Waiting 10s for propagation..."
sleep 10

echo "Broadcasting spell TX..."
SP_SPELL_TXID=$(broadcast_tx "$SP_SPELL_TX")
echo "Spell TXID: $SP_SPELL_TXID"

# Get app_id from spell output
SP_APPID=$(echo -n "$SP_SPELL_TXID:0" | sha256sum | cut -d' ' -f1)
echo ""
echo "Stability Pool deployed!"
echo "App ID: $SP_APPID"
echo "State UTXO: $SP_SPELL_TXID:0"

# Wait before next deployment
echo ""
echo "Waiting 15s before next deployment..."
sleep 15

# Refresh UTXOs
echo "Refreshing UTXOs..."
UTXOS=$(curl -s "$MEMPOOL_API/address/$ADDRESS/utxo" | jq '[.[] | select(.status.confirmed == true) | select(.value > 40000)] | sort_by(-.value)')

echo ""
echo "=== Deploying Vault Manager ==="

VM_COLL=$(get_utxo 0)
VM_FEE=$(get_utxo 1)
VM_COLL_TXID=$(echo "$VM_COLL" | cut -d: -f1)
VM_COLL_VOUT=$(echo "$VM_COLL" | cut -d: -f2)
VM_COLL_VALUE=$(echo "$VM_COLL" | cut -d: -f3)
VM_FEE_TXID=$(echo "$VM_FEE" | cut -d: -f1)
VM_FEE_VOUT=$(echo "$VM_FEE" | cut -d: -f2)
VM_FEE_VALUE=$(echo "$VM_FEE" | cut -d: -f3)

echo "Collateral UTXO: $VM_COLL_TXID:$VM_COLL_VOUT ($VM_COLL_VALUE sats)"
echo "Fee UTXO: $VM_FEE_TXID:$VM_FEE_VOUT ($VM_FEE_VALUE sats)"

# Convert app IDs to byte arrays
# Token app_id will be placeholder (all zeros) - we'll deploy token next
TOKEN_PLACEHOLDER="[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]"

# Convert hex to byte array helper
hex_to_bytes() {
    local hex=$1
    local bytes="["
    for ((i=0; i<64; i+=2)); do
        if [ $i -gt 0 ]; then bytes="$bytes,"; fi
        bytes="$bytes$((16#${hex:$i:2}))"
    done
    bytes="$bytes]"
    echo "$bytes"
}

ORACLE_BYTES=$(hex_to_bytes "$ORACLE_APPID")
SP_BYTES=$(hex_to_bytes "$SP_APPID")
ADMIN_BYTES=$(hex_to_bytes "0fef72e8286c0dd8d5dd569e930433c322330d338650adc1aa0a4502d35a1748")

# Build vault manager spell
VM_SPELL=$(cat <<EOF
{
  "version": 8,
  "apps": {
    "n/new/$VM_VK": "n/new/$VM_VK"
  },
  "ins": [
    { "utxo_id": "$VM_COLL_TXID:$VM_COLL_VOUT", "charms": {} }
  ],
  "outs": [
    {
      "address": "$ADDRESS",
      "charms": {
        "n/new/$VM_VK": {
          "protocol": {
            "total_collateral": 0,
            "total_debt": 0,
            "active_vault_count": 0,
            "base_rate": 50,
            "last_fee_update_block": 0,
            "admin": $ADMIN_BYTES,
            "is_paused": false
          },
          "zkusd_token_id": $TOKEN_PLACEHOLDER,
          "stability_pool_id": $SP_BYTES,
          "price_oracle_id": $ORACLE_BYTES,
          "active_pool": $ADMIN_BYTES,
          "default_pool": $ADMIN_BYTES
        }
      }
    }
  ]
}
EOF
)

# Get prev txs
VM_COLL_PREVTX=$(get_raw_tx "$VM_COLL_TXID")
VM_FEE_PREVTX=$(get_raw_tx "$VM_FEE_TXID")

# Load WASM
VM_WASM_B64=$(base64 -i "$WASM_DIR/zkusd-vault-manager-app.wasm")

# Build prover request
VM_REQUEST=$(cat <<EOF
{
  "spell": $VM_SPELL,
  "binaries": {
    "$VM_VK": "$VM_WASM_B64"
  },
  "prev_txs": [
    {"bitcoin": "$VM_COLL_PREVTX"},
    {"bitcoin": "$VM_FEE_PREVTX"}
  ],
  "funding_utxo": "$VM_FEE_TXID:$VM_FEE_VOUT",
  "funding_utxo_value": $VM_FEE_VALUE,
  "change_address": "$ADDRESS",
  "fee_rate": 5,
  "chain": "bitcoin"
}
EOF
)

echo "Sending to prover..."
VM_RESULT=$(curl -s -X POST "$PROVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$VM_REQUEST")

if echo "$VM_RESULT" | jq -e 'type == "string"' > /dev/null 2>&1; then
    echo "ERROR: $VM_RESULT"
    exit 1
fi

VM_COMMIT_TX=$(echo "$VM_RESULT" | jq -r '.[0].bitcoin // .[0]')
VM_SPELL_TX=$(echo "$VM_RESULT" | jq -r '.[1].bitcoin // .[1]')

echo "Commit TX ready"
echo "Spell TX ready"

echo "Broadcasting commit TX..."
VM_COMMIT_TXID=$(broadcast_tx "$VM_COMMIT_TX")
echo "Commit TXID: $VM_COMMIT_TXID"

sleep 10

echo "Broadcasting spell TX..."
VM_SPELL_TXID=$(broadcast_tx "$VM_SPELL_TX")
echo "Spell TXID: $VM_SPELL_TXID"

VM_APPID=$(echo -n "$VM_SPELL_TXID:0" | sha256sum | cut -d' ' -f1)
echo ""
echo "Vault Manager deployed!"
echo "App ID: $VM_APPID"
echo "State UTXO: $VM_SPELL_TXID:0"

# Wait before token deployment
echo ""
echo "Waiting 15s before token deployment..."
sleep 15

# Refresh UTXOs
UTXOS=$(curl -s "$MEMPOOL_API/address/$ADDRESS/utxo" | jq '[.[] | select(.status.confirmed == true) | select(.value > 40000)] | sort_by(-.value)')

echo ""
echo "=== Deploying zkUSD Token ==="

TOKEN_COLL=$(get_utxo 0)
TOKEN_FEE=$(get_utxo 1)
TOKEN_COLL_TXID=$(echo "$TOKEN_COLL" | cut -d: -f1)
TOKEN_COLL_VOUT=$(echo "$TOKEN_COLL" | cut -d: -f2)
TOKEN_COLL_VALUE=$(echo "$TOKEN_COLL" | cut -d: -f3)
TOKEN_FEE_TXID=$(echo "$TOKEN_FEE" | cut -d: -f1)
TOKEN_FEE_VOUT=$(echo "$TOKEN_FEE" | cut -d: -f2)
TOKEN_FEE_VALUE=$(echo "$TOKEN_FEE" | cut -d: -f3)

echo "Collateral UTXO: $TOKEN_COLL_TXID:$TOKEN_COLL_VOUT ($TOKEN_COLL_VALUE sats)"
echo "Fee UTXO: $TOKEN_FEE_TXID:$TOKEN_FEE_VOUT ($TOKEN_FEE_VALUE sats)"

# Convert vault manager app_id to bytes for authorized_minter
VM_BYTES=$(hex_to_bytes "$VM_APPID")

# Build token spell
TOKEN_SPELL=$(cat <<EOF
{
  "version": 8,
  "apps": {
    "n/new/$TOKEN_VK": "n/new/$TOKEN_VK"
  },
  "ins": [
    { "utxo_id": "$TOKEN_COLL_TXID:$TOKEN_COLL_VOUT", "charms": {} }
  ],
  "outs": [
    {
      "address": "$ADDRESS",
      "charms": {
        "n/new/$TOKEN_VK": {
          "authorized_minter": $VM_BYTES,
          "total_supply": 0
        }
      }
    }
  ]
}
EOF
)

# Get prev txs
TOKEN_COLL_PREVTX=$(get_raw_tx "$TOKEN_COLL_TXID")
TOKEN_FEE_PREVTX=$(get_raw_tx "$TOKEN_FEE_TXID")

# Load WASM
TOKEN_WASM_B64=$(base64 -i "$WASM_DIR/zkusd-token-app.wasm")

# Build prover request
TOKEN_REQUEST=$(cat <<EOF
{
  "spell": $TOKEN_SPELL,
  "binaries": {
    "$TOKEN_VK": "$TOKEN_WASM_B64"
  },
  "prev_txs": [
    {"bitcoin": "$TOKEN_COLL_PREVTX"},
    {"bitcoin": "$TOKEN_FEE_PREVTX"}
  ],
  "funding_utxo": "$TOKEN_FEE_TXID:$TOKEN_FEE_VOUT",
  "funding_utxo_value": $TOKEN_FEE_VALUE,
  "change_address": "$ADDRESS",
  "fee_rate": 5,
  "chain": "bitcoin"
}
EOF
)

echo "Sending to prover..."
TOKEN_RESULT=$(curl -s -X POST "$PROVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$TOKEN_REQUEST")

if echo "$TOKEN_RESULT" | jq -e 'type == "string"' > /dev/null 2>&1; then
    echo "ERROR: $TOKEN_RESULT"
    exit 1
fi

TOKEN_COMMIT_TX=$(echo "$TOKEN_RESULT" | jq -r '.[0].bitcoin // .[0]')
TOKEN_SPELL_TX=$(echo "$TOKEN_RESULT" | jq -r '.[1].bitcoin // .[1]')

echo "Commit TX ready"
echo "Spell TX ready"

echo "Broadcasting commit TX..."
TOKEN_COMMIT_TXID=$(broadcast_tx "$TOKEN_COMMIT_TX")
echo "Commit TXID: $TOKEN_COMMIT_TXID"

sleep 10

echo "Broadcasting spell TX..."
TOKEN_SPELL_TXID=$(broadcast_tx "$TOKEN_SPELL_TX")
echo "Spell TXID: $TOKEN_SPELL_TXID"

TOKEN_APPID=$(echo -n "$TOKEN_SPELL_TXID:0" | sha256sum | cut -d' ' -f1)
echo ""
echo "zkUSD Token deployed!"
echo "App ID: $TOKEN_APPID"
echo "State UTXO: $TOKEN_SPELL_TXID:0"

# Print summary
echo ""
echo "========================================"
echo "       V4 DEPLOYMENT COMPLETE"
echo "========================================"
echo ""
echo "Oracle (existing):"
echo "  VK: $ORACLE_VK"
echo "  App ID: $ORACLE_APPID"
echo "  State UTXO: $ORACLE_STATE_UTXO"
echo ""
echo "Stability Pool (new):"
echo "  VK: $SP_VK"
echo "  App ID: $SP_APPID"
echo "  State UTXO: $SP_SPELL_TXID:0"
echo ""
echo "Vault Manager (new):"
echo "  VK: $VM_VK"
echo "  App ID: $VM_APPID"
echo "  State UTXO: $VM_SPELL_TXID:0"
echo ""
echo "zkUSD Token (new):"
echo "  VK: $TOKEN_VK"
echo "  App ID: $TOKEN_APPID"
echo "  State UTXO: $TOKEN_SPELL_TXID:0"
echo ""
echo "NOTE: Update packages/config/src/testnet4.ts with these values!"
echo ""
