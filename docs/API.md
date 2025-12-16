# zkUSD Protocol API Reference

## Overview

zkUSD is a Bitcoin-native stablecoin protocol built on Charms. This document describes the operations available and how to interact with the protocol.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     zkUSD Protocol                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Price Oracle │  │  zkUSD Token │  │   Stability Pool     │  │
│  │              │  │              │  │                      │  │
│  │ - BTC/USD    │  │ - Mint       │  │ - Deposit zkUSD      │  │
│  │ - Update     │  │ - Burn       │  │ - Withdraw           │  │
│  │              │  │ - Transfer   │  │ - Claim BTC gains    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └────────────┬────┴──────────────────────┘              │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ Vault Manager │                                  │
│              │               │                                  │
│              │ - Open Vault  │                                  │
│              │ - Close Vault │                                  │
│              │ - Adjust      │                                  │
│              │ - Liquidate   │                                  │
│              │ - Redeem      │                                  │
│              └───────────────┘                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Contract Addresses (Testnet4)

| Contract | App ID | VK |
|----------|--------|-----|
| Price Oracle | `8aa4f505cb3e6f7f8d7f553e517dc0c161fd662ce56ce9412ad5dd00991b1ef2` | `b44db07a...` |
| zkUSD Token | `a6b3570c84064d72dc6687d0309154469efa6a427fd3c1691e656d6172455c82` | `7d1a0674...` |
| Vault Manager | `3ce7c8f65b55f2e66f25370f951abfc49af6980d63969f9368f0b5bb1cf878d0` | `56ff2636...` |
| Stability Pool | `c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf` | `ace28945...` |

---

## Operations

### 1. Open Vault

Create a new vault with BTC collateral and mint zkUSD.

**Operation Code:** `0x10` (16)

**Inputs:**
- BTC collateral UTXO

**Outputs:**
- Vault NFT charm (contains vault state)
- zkUSD tokens (minted debt)
- BTC change

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| collateral | u64 | BTC amount in satoshis |
| debt | u64 | zkUSD amount (8 decimals) |

**Constraints:**
- ICR >= MCR (110%)
- debt >= MIN_DEBT (200 zkUSD)

**Example:**
```bash
./scripts/run-operation.sh open-vault 0.5 25000
# 0.5 BTC collateral, 25,000 zkUSD debt
# ICR = (0.5 * $104,000) / $25,000 = 208%
```

---

### 2. Close Vault

Repay all debt and recover collateral.

**Operation Code:** `0x11` (17)

**Inputs:**
- Vault NFT charm
- zkUSD to repay (debt + accrued interest)

**Outputs:**
- Recovered BTC collateral
- Excess zkUSD change (if any)

**Note:** Vault NFT is burned (not in outputs)

---

### 3. Add Collateral

Add BTC collateral to existing vault.

**Operation Code:** `0x12` (18)

**Inputs:**
- Vault NFT charm
- Additional BTC UTXO

**Outputs:**
- Updated Vault NFT (increased collateral)

---

### 4. Withdraw Collateral

Remove BTC collateral from vault.

**Operation Code:** `0x13` (19)

**Inputs:**
- Vault NFT charm

**Outputs:**
- Updated Vault NFT (decreased collateral)
- Withdrawn BTC

**Constraints:**
- ICR must remain >= MCR after withdrawal

---

### 5. Mint Debt

Mint additional zkUSD against existing collateral.

**Operation Code:** `0x14` (20)

**Inputs:**
- Vault NFT charm

**Outputs:**
- Updated Vault NFT (increased debt)
- Minted zkUSD tokens

**Constraints:**
- ICR must remain >= MCR after minting

---

### 6. Repay Debt

Repay part of vault debt.

**Operation Code:** `0x15` (21)

**Inputs:**
- Vault NFT charm
- zkUSD to repay

**Outputs:**
- Updated Vault NFT (decreased debt)
- zkUSD change (if any)

---

### 7. Liquidate

Liquidate an undercollateralized vault.

**Operation Code:** `0x16` (22)

**Inputs:**
- Underwater Vault NFT (ICR < MCR)
- Stability Pool state

**Outputs:**
- Liquidated Vault NFT (status=3, zeroed)
- Updated Stability Pool state
- Liquidator bonus (0.5% of collateral)
- Gas compensation (200 zkUSD)

**Permission:** Permissionless - anyone can liquidate

---

### 8. Redeem

Redeem zkUSD for BTC from lowest-interest vaults.

**Operation Code:** `0x17` (23)

**Inputs:**
- zkUSD to redeem
- Target vaults (ordered by interest rate)

**Outputs:**
- BTC to redeemer (minus fee)
- Updated vaults (reduced debt/collateral)
- Fee to treasury

---

### 9. Stability Pool Deposit

Deposit zkUSD to Stability Pool.

**Operation Code:** `0x20` (32)

**Inputs:**
- zkUSD tokens
- Stability Pool state

**Outputs:**
- Updated Stability Pool state
- Depositor position NFT
- zkUSD change

---

### 10. Stability Pool Withdraw

Withdraw zkUSD and claim BTC gains.

**Operation Code:** `0x21` (33)

**Inputs:**
- Depositor position NFT
- Stability Pool state

**Outputs:**
- Updated Stability Pool state
- zkUSD to depositor (compounded)
- BTC gains to depositor
- Updated/burned position NFT

---

### 11. Update Oracle Price

Update BTC/USD price (admin only).

**Operation Code:** `0x01` (1)

**Inputs:**
- Oracle state UTXO

**Outputs:**
- Updated Oracle state

**Permission:** Admin/Operator only

---

## Data Types

### Vault State
```rust
struct Vault {
    id: [u8; 32],              // Unique vault ID
    owner: [u8; 32],           // Owner pubkey
    collateral: u64,           // BTC in satoshis
    debt: u64,                 // zkUSD (8 decimals)
    created_at: u64,           // Block height
    last_updated: u64,         // Block height
    status: u8,                // 0=Active, 2=Closed, 3=Liquidated
    interest_rate_bps: u16,    // Annual rate in basis points
    accrued_interest: u64,     // Accumulated interest
    redistributed_debt: u64,   // From liquidations
    redistributed_collateral: u64,
    insurance_balance: u64,
}
```

### Stability Pool State
```rust
struct StabilityPoolState {
    total_zkusd: u64,          // Total deposited
    total_btc: u64,            // BTC from liquidations
    product_p: u128,           // Loss multiplier (1e18 scale)
    sum_s: u128,               // BTC rewards accumulator
    current_epoch: u64,        // Resets when P drops below threshold
    current_scale: u64,        // Scale factor
    depositor_count: u64,
}
```

### Price Data
```rust
struct PriceData {
    price: u64,                // USD with 8 decimals
    timestamp_block: u64,      // Block height
    source: String,            // "Mock", "Chainlink", etc.
    confidence: u8,            // 0-100
}
```

---

## Charms App References

Format: `{type}/{app_id}/{vk}`

| Type | Description |
|------|-------------|
| `n/` | NFT (singleton state) |
| `t/` | Fungible token |

**Examples:**
```yaml
# Vault Manager NFT
$VM: n/3ce7c8f65b55f2e66f25370f951abfc49af6980d63969f9368f0b5bb1cf878d0/56ff2636c4d11caeed8a90a608e7c067928e5368f3166d495b85be90af659c44

# zkUSD Token (fungible)
$TOKEN: t/a6b3570c84064d72dc6687d0309154469efa6a427fd3c1691e656d6172455c82/7d1a06745a94adf1195fb9f2f987cb48b8c46b814f53167c619c9175cd406903
```

---

## CLI Commands

```bash
# Protocol status
./scripts/indexer.sh status

# Operations
./scripts/run-operation.sh open-vault <btc> <zkusd>
./scripts/run-operation.sh deposit-sp <zkusd>
./scripts/run-operation.sh transfer <recipient> <amount>
./scripts/run-operation.sh liquidate <vault_utxo>
./scripts/run-operation.sh update-oracle <price_usd>

# Generate spells
./scripts/generate-spell.sh open-vault /tmp/spell.yaml --collateral=... --debt=...

# Run tests
./scripts/test-e2e.sh all
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `E001` | ICR below MCR |
| `E002` | Debt below minimum |
| `E003` | Vault not found |
| `E004` | Not vault owner |
| `E005` | Vault not liquidatable |
| `E006` | Insufficient SP balance |
| `E007` | Oracle stale |
| `E008` | Unauthorized |

---

## Fee Structure

| Fee | Amount | Description |
|-----|--------|-------------|
| Liquidation Bonus | 0.5% | Paid to liquidator from collateral |
| Gas Compensation | 200 zkUSD | Paid to liquidator |
| Redemption Fee | 0.5% + dynamic | Based on base rate |
| Borrowing Fee | Variable | Based on interest rate |

---

## Security Considerations

1. **UTXO Separation**: Always use different UTXOs for `ins:` and `--funding-utxo`
2. **ICR Monitoring**: Keep ICR well above MCR to avoid liquidation
3. **Oracle Freshness**: Check oracle timestamp before operations
4. **Signature Verification**: All operations require valid signatures

---

## Resources

- [Deployment Status](../spells/DEPLOYMENT_STATUS.md)
- [Next Steps](../NEXT_STEPS.md)
- [Charms Documentation](https://docs.charms.xyz)
- [Liquity V2 Reference](https://docs.liquity.org)
