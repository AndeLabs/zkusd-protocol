# zkUSD Protocol Deployment Guide

> **Last Updated**: 2026-01-25
> **Status**: Active Development - Testnet4
> **Current Phase**: Contract Synchronization & Redeployment

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Contract Dependency Graph](#contract-dependency-graph)
3. [Deployment Order](#deployment-order)
4. [Current Deployment Status](#current-deployment-status)
5. [Known Issues](#known-issues)
6. [Deployment Scripts](#deployment-scripts)
7. [Verification Checklist](#verification-checklist)
8. [Developer Notes](#developer-notes)

---

## Architecture Overview

zkUSD is a Bitcoin-native stablecoin protocol built on **Charms** (Bitcoin L1 smart contracts using ZK proofs).

### Core Contracts

| Contract | Purpose | Tag | Description |
|----------|---------|-----|-------------|
| `zkusd-token` | Stablecoin Token | `t/` (fungible), `n/` (state) | ERC20-like token with mint/burn controlled by VaultManager |
| `zkusd-vault-manager` | Vault Operations | `n/` (NFT) | Creates vaults, manages collateral, mints/burns tokens |
| `zkusd-stability-pool` | Liquidation Buffer | `n/` (NFT) | Absorbs liquidated debt, distributes collateral |
| `zkusd-price-oracle` | Price Feed | `n/` (NFT) | Provides BTC/USD price for collateral calculations |

### Charms Concepts

- **App ID** (`identity`): Unique identifier derived from first deployment transaction
- **VK** (Verification Key): Hash of compiled WASM, changes when code changes
- **App Reference**: `{tag}/{app_id}/{vk}` - Full reference to a deployed contract
- **Spell**: Transaction that invokes contract logic with ZK proof

---

## Contract Dependency Graph

```
                    ┌─────────────────┐
                    │  Price Oracle   │
                    │  (independent)  │
                    └────────┬────────┘
                             │ price_oracle_id
                             ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   zkUSD Token   │◄───│  VaultManager   │───►│ Stability Pool  │
│  (fungible +    │    │   (central)     │    │  (liquidations) │
│   state NFT)    │    └─────────────────┘    └─────────────────┘
└─────────────────┘           │
        ▲                     │ authorized_minter
        └─────────────────────┘

Legend:
  ──► = references (stores app_id)
  ◄── = authorizes (minter/burner)
```

### Cross-Contract References

| Source Contract | Field | Target Contract | Notes |
|-----------------|-------|-----------------|-------|
| VaultManager | `zkusd_token_id` | Token | For minting zkUSD |
| VaultManager | `stability_pool_id` | StabilityPool | For liquidations |
| VaultManager | `price_oracle_id` | PriceOracle | For price validation |
| Token | `authorized_minter` | VaultManager | Only VM can mint/burn |
| StabilityPool | `zkusd_token_id` | Token | For deposit tracking |
| StabilityPool | `vault_manager_id` | VaultManager | For liquidation calls |

---

## Deployment Order

**CRITICAL**: Contracts must be deployed in this exact order due to circular references.

### Phase 1: Independent Contracts
```
1. PriceOracle    - No dependencies
2. Token (init)   - Initialize with placeholder minter (will update)
```

### Phase 2: Core Protocol
```
3. StabilityPool  - References: token_id
4. VaultManager   - References: token_id, stability_pool_id, price_oracle_id
```

### Phase 3: Finalization
```
5. Token (update) - Update authorized_minter to VaultManager app_id
```

### Deployment Script Execution
```bash
# Full fresh deployment
./scripts/deploy/deploy-all.sh --network testnet4

# Individual contract deployment
./scripts/deploy/deploy-contract.sh --contract token --network testnet4

# Update cross-references only
./scripts/deploy/update-refs.sh --network testnet4
```

---

## Current Deployment Status

### Testnet4 - Phase V7 (2026-01-25)

| Contract | Version | Status | Issue |
|----------|---------|--------|-------|
| PriceOracle | V1 | ✅ Deployed | Working |
| Token | V3 | ⚠️ Out of Sync | VK mismatch with source |
| StabilityPool | V5 | ✅ Deployed | Working (minor issues) |
| VaultManager | V2 | ✅ Deployed | Working |

### VK Tracking (Updated 2026-01-25)

| Contract | Deployed VK | Current Source VK | Sync Status |
|----------|-------------|-------------------|-------------|
| PriceOracle | `98b2eeeb37501c9f...` | `372723f020b5030a...` | ❌ OUT OF SYNC |
| Token | `ff936fc6c59a5997...` | `9d9f07fc1ce53fc2...` | ❌ OUT OF SYNC |
| StabilityPool | `54f84ff2ed2892b5...` | `54f84ff2ed2892b5...` | ✅ IN SYNC |
| VaultManager | `a2359b5a481117a9...` | `a2359b5a481117a9...` | ✅ IN SYNC |

### Action Required

**PriceOracle and Token contracts have changed since deployment.**

Recommended deployment strategy:

1. **Phase A - Redeployment** (if starting fresh):
   - Deploy PriceOracle V2 (VK: `372723f0...`)
   - Deploy Token V4 (VK: `9d9f07fc...`)
   - Redeploy StabilityPool with new token_id
   - Redeploy VaultManager with new token_id and oracle_id

2. **Phase B - Targeted Fix** (minimal changes):
   - Option: Redeploy only Token V4
   - Then redeploy VaultManager V3 with new token_id
   - Keep existing PriceOracle and StabilityPool

Current working contracts (can use immediately):
- **VaultManager V2**: ✅ Working (validated 2026-01-25)
- **StabilityPool V5**: ✅ Working

---

## Known Issues

### Issue #1: Token VK Mismatch
- **Symptom**: `app_contract` assertion fails when minting zkUSD
- **Cause**: Token source code added `validate_fungible_with_state()` after deployment
- **Fix**: Redeploy token contract
- **Tracked**: 2026-01-25

### Issue #2: StabilityPool coin_ins Check
- **Symptom**: Validation may fail on some operations
- **Cause**: `coin_ins` field handling differs from Charms v0.11.1 spec
- **Fix**: Update contract validation logic
- **Tracked**: 2026-01-24

### Issue #3: PriceOracle Block Height
- **Symptom**: Block height returns 0 in some contexts
- **Cause**: Charms SDK `block_height()` implementation
- **Workaround**: Use timestamp_block from public_inputs
- **Tracked**: 2026-01-24

---

## Deployment Scripts

### Directory Structure
```
scripts/
├── deploy/
│   ├── deploy-all.sh           # Full protocol deployment
│   ├── deploy-contract.sh      # Single contract deployment
│   ├── update-refs.sh          # Update cross-references
│   ├── build-all.sh            # Build all WASMs
│   └── verify-deployment.sh    # Verify deployment state
├── spells/
│   ├── create-spell.py         # Generate spell YAML
│   ├── prove-spell.py          # Prove and optionally broadcast
│   └── templates/              # Spell templates
└── utils/
    ├── fetch-utxos.sh          # Fetch UTXOs for address
    ├── compute-vk.sh           # Compute VK from WASM
    └── decode-charms.py        # Decode charm data from TX
```

### Building Contracts
```bash
# Build all contracts (recommended)
./scripts/deploy/build-all.sh

# Build specific contract
cd contracts/zkusd-token
cargo build --release --target wasm32-wasip1 --features charms --bin zkusd-token-app

# Verify VK
charms app vk target/wasm32-wasip1/release/zkusd-token-app.wasm
```

### Deployment Configuration
All deployment state is tracked in `deployments/{network}/deployment-config.json`:
```json
{
  "network": "testnet4",
  "charms_version": 9,
  "contracts": {
    "zkusd_token": {
      "vk": "...",
      "app_id": "...",
      "state_utxo": "...",
      "status": "deployed"
    }
  }
}
```

---

## Verification Checklist

### Pre-Deployment
- [ ] All contracts compile without errors
- [ ] VKs computed and recorded
- [ ] Funding UTXOs available
- [ ] Network connectivity verified

### Post-Deployment
- [ ] All state UTXOs confirmed on-chain
- [ ] Cross-references verified (app_ids match)
- [ ] deployment-config.json updated
- [ ] Test transactions successful

### Integration Test
- [ ] Open vault with collateral
- [ ] Mint zkUSD tokens
- [ ] Transfer zkUSD
- [ ] Close vault and burn tokens

---

## Developer Notes

### Working on This Codebase

1. **Before making contract changes**:
   - Check current VK: `charms app vk <wasm_path>`
   - Document in commit message if VK will change

2. **After contract changes**:
   - Rebuild WASM: `./scripts/deploy/build-all.sh`
   - Compare VKs with deployed versions
   - If VK changed, deployment is required

3. **Creating spells**:
   - Use `scripts/spells/create-spell.py` for consistency
   - Always include `private_inputs` for contract operations
   - Test with `charms spell prove` before broadcasting

### Common Pitfalls

1. **Wrong WASM target**: Use `wasm32-wasip1`, NOT `wasm32-unknown-unknown`
2. **Missing features**: Token requires `--features charms`
3. **Stale UTXOs**: Always verify UTXO exists before creating spell
4. **VK mismatch**: Contract source ≠ deployed → validation fails

### Getting Help

- Charms Documentation: https://docs.charms.dev
- Project Issues: [GitHub Issues]
- Discord: [zkUSD Discord]

---

## Changelog

### 2026-01-25
- Identified token VK mismatch issue
- VaultManager V2 deployment verified working
- Created deployment documentation

### 2026-01-24
- Deployed StabilityPool V5
- Deployed VaultManager V2
- First vault created on testnet4

### 2026-01-21
- Initial protocol deployment
- PriceOracle, Token V3, StabilityPool V4
