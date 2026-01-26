# zkUSD Protocol - Deployment Guide

> **Version**: V8 (Token V5 with Admin/SetMinter pattern)
> **Network**: Bitcoin Testnet4
> **Date**: 2026-01-25

## Table of Contents

1. [Overview](#overview)
2. [Architecture Changes (V8)](#architecture-changes-v8)
3. [Prerequisites](#prerequisites)
4. [Step-by-Step Deployment](#step-by-step-deployment)
5. [Transaction Signing](#transaction-signing)
6. [Verification](#verification)

---

## Overview

This guide documents the complete process for deploying the zkUSD protocol on Bitcoin using the Charms framework.

### Contract Summary

| Contract | VK | Status |
|----------|---------|--------|
| PriceOracle | `372723f0...` | Existing (V1) |
| Token | `e15397ee6b00bd3a61d2243086441164c5615f114a7c92330996125215bb1873` | **NEW (V5)** |
| StabilityPool | `54f84ff2...` | Existing (V5) |
| VaultManager | `a2359b5a...` | Existing (V2) |

### Deployment Order

```
1. Token V5 (initialize with admin, pending minter)
       ↓
2. VaultManager V3 (with new Token app_id)
       ↓
3. Token SetMinter (configure VaultManager as minter)
       ↓
4. Test minting
```

---

## Architecture Changes (V8)

### Problem Solved

Previous versions had a **chicken-and-egg problem**:
- Token needs VaultManager's `app_id` to authorize minting
- VaultManager doesn't exist yet when Token is deployed

### Solution: Two-Phase Token Initialization

```
Phase 1: Deploy Token
  - Set admin address
  - Set authorized_minter = [0; 32] (pending)
  - Token cannot mint/burn yet

Phase 2: Configure Minter
  - Deploy VaultManager (get app_id)
  - Call SetMinter on Token
  - Set authorized_minter = VaultManager.app_id
  - Token is now fully operational
```

### New Token State Structure

```rust
pub struct ZkUsdTokenState {
    pub admin: Address,              // [u8; 32] - Can configure minter
    pub authorized_minter: AppId,    // [u8; 32] - VaultManager app_id
    pub total_supply: u64,
}
```

### New Token Operations

| Op Code | Operation | Description |
|---------|-----------|-------------|
| 0x00 | Initialize | Create token with admin (minter can be zero) |
| 0x01 | Transfer | Transfer tokens between addresses |
| 0x02 | Mint | Create new tokens (VaultManager only) |
| 0x03 | Burn | Destroy tokens (VaultManager only) |
| **0x04** | **SetMinter** | **Admin configures VaultManager (one-time)** |

---

## Prerequisites

### 1. Build Contracts

```bash
# Build all contracts with VK verification
./scripts/deploy/build-all.sh --verify

# Expected output:
# Token VK: e15397ee6b00bd3a61d2243086441164c5615f114a7c92330996125215bb1873
```

### 2. Check Wallet Balance

```bash
# Check UTXOs
curl -s "https://mempool.space/testnet4/api/address/tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq/utxo" | jq '.[0:5]'

# Need at least 500,000 sats for deployment
```

### 3. Prepare Wallet

You need your wallet private key in WIF format:
```bash
# From Bitcoin Core
bitcoin-cli -testnet4 dumpprivkey tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq

# Save securely
export WALLET_WIF="cXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

---

## Step-by-Step Deployment

### Step 1: Deploy Token V5

#### 1.1 Create Deployment Spell

The spell file is at: `deployments/testnet4/pending/deploy-token-v5.yaml`

Key fields:
```yaml
version: 9

apps:
  # New app (zeros for app_id, will be assigned)
  $00: n/0000...0000/e15397ee6b00bd3a61d2243086441164c5615f114a7c92330996125215bb1873

private_inputs:
  $00:
    op: 0  # Initialize
    admin: [15, 239, 114, ...]  # Your admin address bytes
    authorized_minter: [0, 0, 0, ...]  # Pending (zeros)

outs:
  - address: tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq
    charms:
      $00:
        admin: [15, 239, 114, ...]
        authorized_minter: [0, 0, 0, ...]
        total_supply: 0
```

#### 1.2 Generate ZK Proof

```bash
# Find a funding UTXO
FUNDING_UTXO="d8c6e9e8ce18a792d7584eb78550a52b09c6a774569753d124cfec27835d04f9:5"
FUNDING_VALUE=1031503

# Generate proof
charms spell prove \
  --spell deployments/testnet4/pending/deploy-token-v5.yaml \
  --app-bins target/wasm32-wasip1/release/zkusd-token-app.wasm \
  --funding-utxo $FUNDING_UTXO \
  --funding-utxo-value $FUNDING_VALUE \
  --change-address tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq \
  --fee-rate 2
```

Output:
```
✅  app contract satisfied: n/0000.../e15397ee...
[{"bitcoin":"0200000001..."}]
```

#### 1.3 Sign Transaction

The prover outputs an **unsigned** transaction. You must sign it:

```bash
# Method 1: Using our signing script
WALLET_WIF="cXXX..." npx ts-node scripts/sign-and-broadcast.ts \
  "0200000001..." \  # Transaction hex from prover
  1031503            # Input value in sats

# Method 2: Using Bitcoin Core
bitcoin-cli -testnet4 signrawtransactionwithkey \
  "0200000001..." \
  '["cXXXX..."]' \
  '[{"txid":"d8c6e9e8...","vout":5,"scriptPubKey":"...","amount":0.01031503}]'
```

#### 1.4 Broadcast Transaction

```bash
# Broadcast signed transaction
curl -X POST "https://mempool.space/testnet4/api/tx" \
  -H "Content-Type: text/plain" \
  -d "SIGNED_TX_HEX"

# Returns: transaction ID (txid)
```

#### 1.5 Extract Token App ID

Once confirmed, the new Token app_id is derived from the transaction:

```bash
# View the charm data
charms tx show-spell <TXID>

# The app_id is the first 32 bytes of the commitment
# Record it for VaultManager deployment
TOKEN_APP_ID="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

---

### Step 2: Deploy VaultManager V3

#### 2.1 Create Deployment Spell

Update `deployments/testnet4/pending/deploy-vault-manager-v3.yaml`:

```yaml
private_inputs:
  $00:
    op: 0  # Initialize
    admin: [15, 239, 114, ...]
    zkusd_token_id: [TOKEN_APP_ID_BYTES]  # From Step 1.5
    stability_pool_id: [185, 65, 44, ...]  # Existing SP app_id
    price_oracle_id: [38, 24, 109, ...]    # Existing Oracle app_id
    active_pool: [...]
    default_pool: [...]
```

#### 2.2 Generate and Sign

```bash
charms spell prove \
  --spell deployments/testnet4/pending/deploy-vault-manager-v3.yaml \
  --app-bins target/wasm32-wasip1/release/zkusd-vault-manager-app.wasm \
  --funding-utxo <NEW_UTXO> \
  --funding-utxo-value <VALUE> \
  --change-address tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq \
  --fee-rate 2

# Sign and broadcast as in Step 1.3-1.4
```

#### 2.3 Record VaultManager App ID

```bash
VAULT_MANAGER_APP_ID="YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY"
```

---

### Step 3: Configure Token Minter (SetMinter)

#### 3.1 Create SetMinter Spell

```yaml
# deployments/testnet4/pending/set-minter.yaml
version: 9

apps:
  $00: n/{TOKEN_APP_ID}/e15397ee6b00bd3a61d2243086441164c5615f114a7c92330996125215bb1873

private_inputs:
  $00:
    op: 4  # SetMinter
    new_minter: [VAULT_MANAGER_APP_ID_BYTES]

ins:
  - utxo: TOKEN_DEPLOY_TXID:0  # Token state UTXO from Step 1
    charms:
      $00:
        admin: [15, 239, 114, ...]
        authorized_minter: [0, 0, 0, ...]
        total_supply: 0

outs:
  - address: tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq
    charms:
      $00:
        admin: [15, 239, 114, ...]
        authorized_minter: [VAULT_MANAGER_APP_ID_BYTES]
        total_supply: 0
```

#### 3.2 Execute SetMinter

```bash
charms spell prove \
  --spell deployments/testnet4/pending/set-minter.yaml \
  --app-bins target/wasm32-wasip1/release/zkusd-token-app.wasm \
  --funding-utxo <UTXO> \
  --funding-utxo-value <VALUE> \
  --change-address tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq \
  --fee-rate 2

# Sign and broadcast
```

---

### Step 4: Test Minting

#### 4.1 Create Mint Spell

```yaml
# Open vault and mint zkUSD
version: 9

apps:
  $VM: n/{VAULT_MANAGER_APP_ID}/{VM_VK}
  $TK: n/{TOKEN_APP_ID}/{TOKEN_VK}

private_inputs:
  $VM:
    op: 16  # OPEN_VAULT
    collateral: 100000000  # 1 BTC in sats
    debt: 5000000000000    # 50,000 zkUSD

# ... (see existing mint spells for full structure)
```

---

## Transaction Signing

### Understanding the Process

1. **charms spell prove** generates an **unsigned** transaction with ZK proof
2. The transaction references your funding UTXO but has no signature
3. You must sign with the private key that controls the funding UTXO
4. Only then can the transaction be broadcast

### Signing Methods

#### A. Using bitcoinjs-lib (TypeScript)

```typescript
import { BitcoinSigner } from './scripts/lib/bitcoin-signer';

const signer = new BitcoinSigner({ privateKeyWif: 'cXXX...' });
const signedTx = signer.signP2wpkhTransaction(unsignedTxHex, [inputValue]);
```

#### B. Using Bitcoin Core

```bash
bitcoin-cli -testnet4 signrawtransactionwithkey \
  "UNSIGNED_TX_HEX" \
  '["PRIVATE_KEY_WIF"]' \
  '[{"txid":"...","vout":N,"scriptPubKey":"...","amount":X.XXXXXXXX}]'
```

#### C. Using a Hardware Wallet

Export PSBT, sign on device, then finalize:
```bash
bitcoin-cli -testnet4 converttopsbt "UNSIGNED_TX_HEX"
# Sign with hardware wallet
bitcoin-cli -testnet4 finalizepsbt "SIGNED_PSBT"
```

---

## Verification

### Check Deployment Status

```bash
# View charm data in transaction
charms tx show-spell <TXID>

# Check UTXO on chain
curl -s "https://mempool.space/testnet4/api/tx/<TXID>" | jq '.vout'
```

### Update deployment-config.json

After each deployment:
```json
{
  "contracts": {
    "zkusd_token": {
      "vk": "e15397ee6b00bd3a61d2243086441164c5615f114a7c92330996125215bb1873",
      "app_id": "NEW_APP_ID",
      "spell_tx": "DEPLOY_TXID",
      "state_utxo": "DEPLOY_TXID:0",
      "status": "confirmed",
      "note": "V5 - Admin/SetMinter pattern"
    }
  }
}
```

---

## Troubleshooting

### "Witness program hash mismatch"

**Cause**: Transaction not signed or signed with wrong key.

**Fix**: Ensure you're signing with the private key for the funding UTXO address.

### "app_contract assertion failed"

**Cause**: VK mismatch between deployed and current code.

**Fix**: Rebuild contracts and verify VKs match.

### "mempool reject - insufficient fee"

**Cause**: Fee rate too low.

**Fix**: Increase `--fee-rate` parameter.

---

## Quick Reference

### Admin Address (bytes)
```
[15, 239, 114, 232, 40, 108, 13, 216, 213, 221, 86, 158, 147, 4, 51, 195, 34, 51, 13, 51, 134, 80, 173, 193, 170, 10, 69, 2, 211, 90, 23, 72]
```

### Token V5 VK
```
e15397ee6b00bd3a61d2243086441164c5615f114a7c92330996125215bb1873
```

### Output Address
```
tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq
```

---

*Last Updated: 2026-01-25*
