# zkUSD: UTXO-Native Design Patterns

This documentation and implementation follows Bitcoin-native UTXO patterns, NOT Ethereum smart contract patterns.

## Core Philosophy

zkUSD is built on **Bitcoin using Charms protocol**, which means we must think in terms of:
- **UTXOs** (Unspent Transaction Outputs), not accounts
- **Spells** (atomic state transitions), not function calls
- **Client-side validation**, not global consensus
- **Single-use seals**, not mutable state

## Key Differences: Bitcoin UTXO vs Ethereum Smart Contracts

| Aspect | Ethereum Smart Contracts | Bitcoin UTXO (Charms) |
|--------|--------------------------|----------------------|
| **State Model** | Global mutable state | Immutable UTXOs consumed/created |
| **Atomicity** | Requires callbacks/reentrancy guards | Inherently atomic by design |
| **Validation** | On-chain execution | Client-side with ZK proofs |
| **Concurrency** | Sequential execution | Parallel UTXO processing |
| **Flash Loans** | Callback pattern | Spell input/output balance |
| **Token Transfers** | `transfer(to, amount)` | Consume input UTXO, create output UTXO |

## Feature Implementation Patterns

### 1. Flash Minting (UTXO-Native)

**Ethereum Pattern (DON'T DO THIS):**
```solidity
// Ethereum: Requires callback
function flashLoan(uint amount, address callback) {
    mint(msg.sender, amount);
    ICallback(callback).execute();  // CALLBACK!
    require(balanceOf(msg.sender) >= amount + fee);
    burn(msg.sender, amount + fee);
}
```

**Bitcoin/Charms Pattern (CORRECT):**
```yaml
# Spell defines ENTIRE operation atomically
version: 8
apps:
  $00: n/${zkusd_app}/${vk}

ins:
  - utxo_id: ${funding_utxo}
    charms:
      $00: { balance: 0 }  # Start with 0

outs:
  - address: ${fee_collector}
    charms:
      $00: { balance: 5_00000000 }  # Fee: 5 zkUSD
  # All operations happen WITHIN the spell
  # No callbacks - spell is atomic
```

**Rust Validation:**
```rust
// In charms_ops.rs
pub fn validate_flash_mint_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    flash_mint: &SpellFlashMint,
) -> ZkUsdResult<FlashMintValidation> {
    // UTXO model: just verify output >= input + fee
    // The spell itself is atomic - no callbacks needed!
    let required_fee = calculate_flash_fee(flash_mint.mint_amount);

    // Validation is simple: check balances
    // Atomicity is GUARANTEED by UTXO model
    Ok(FlashMintValidation { ... })
}
```

### 2. Atomic Rescue (UTXO-Native)

**Ethereum Pattern (DON'T DO THIS):**
```solidity
// Ethereum: Multiple transactions or complex state
function createRescueOffer(uint vaultId, uint collateral) { ... }
function acceptRescue(uint offerId) { ... }
function executeRescue(uint offerId) { ... }  // 3 TXs!
```

**Bitcoin/Charms Pattern (CORRECT):**
```yaml
# Single spell: vault owner + rescuer both sign
version: 8
ins:
  - utxo_id: ${distressed_vault_utxo}
    charms:
      $00: { collateral: 1_00000000, debt: 95000_00000000 }
  - utxo_id: ${rescuer_btc_utxo}
    charms: {}  # Plain BTC from rescuer

outs:
  - address: ${vault_owner}
    charms:
      $00: { collateral: 1_10000000, debt: 95000_00000000 }  # +0.1 BTC
  # Rescue happens in ONE atomic spell
```

**Rust Validation:**
```rust
// Single validation function - no state machine
pub fn validate_rescue_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    rescue: &SpellRescue,
    btc_price: u64,
    current_block: u64,
) -> ZkUsdResult<RescueValidation> {
    // Verify collateral added + debt repaid in outputs
    // Both parties signed the spell = consent
    // ATOMIC by design
}
```

### 3. Insurance Charms (UTXO-Native)

**Ethereum Pattern (DON'T DO THIS):**
```solidity
// Ethereum: NFT with mutable state
contract InsuranceNFT is ERC721 {
    mapping(uint => InsuranceData) public policies;
    function trigger(uint tokenId) external {
        policies[tokenId].triggered = true;  // Mutates state!
    }
}
```

**Bitcoin/Charms Pattern (CORRECT):**
```yaml
# Insurance is a CHARM (like NFT) attached to UTXO
# Trigger = consume the charm in a spell

# Spell to trigger insurance:
ins:
  - utxo_id: ${vault_utxo}
    charms:
      $00: { collateral: 1_00000000, debt: 95000_00000000 }
  - utxo_id: ${insurance_charm_utxo}
    charms:
      $01: { coverage: 0_10000000, trigger_icr: 110 }  # Insurance charm

outs:
  - address: ${vault_owner}
    charms:
      $00: { collateral: 1_10000000, debt: 95000_00000000 }  # Collateral added!
  # Insurance charm is CONSUMED (not in outputs)
```

## Why UTXO Model is Superior for DeFi

### 1. No Re-entrancy Attacks
```
Ethereum: A calls B, B calls A again (re-entrancy)
Bitcoin:  Spell validates inputs → outputs (single pass)
```

### 2. Predictable Fees
```
Ethereum: Gas depends on execution path
Bitcoin:  Fee = f(inputs, outputs, proof_size) - known upfront
```

### 3. Parallel Processing
```
Ethereum: Sequential transaction execution
Bitcoin:  Independent UTXOs can be processed in parallel
```

### 4. Client-Side Validation
```
Ethereum: Everyone validates everything
Bitcoin:  Only validate what you care about (with ZK proofs)
```

## Implementation Guidelines

### DO:
- Think in terms of **consuming inputs** and **creating outputs**
- Design spells as **atomic state transitions**
- Use **recursive ZK proofs** for state validity
- Keep validation **stateless** - just check inputs vs outputs

### DON'T:
- Don't use callbacks or assume re-entry
- Don't rely on global mutable state
- Don't copy Ethereum patterns blindly
- Don't assume account-based balance tracking

## Code Organization

```
contracts/common/src/
├── charms_ops.rs      # UTXO-native spell validation
├── flash.rs           # Flash operations (both patterns for reference)
├── advanced_ops.rs    # Advanced UTXO operations
├── types.rs           # Core types (UTXO-friendly)
└── ...
```

## Testing Philosophy

Tests should verify:
1. **Input/Output balance** - UTXOs consumed = UTXOs created (value-wise)
2. **State transitions** - Valid charm state changes
3. **Atomicity** - All-or-nothing execution
4. **Edge cases** - Expired offers, insufficient collateral, etc.

```rust
#[test]
fn test_flash_mint_utxo_native() {
    // Create input state (what UTXOs exist before spell)
    let input = create_test_state(0, ONE_BTC, vec![]);

    // Create output state (what UTXOs exist after spell)
    let output = create_test_state(5 * ONE_ZKUSD, ONE_BTC, vec![]);

    // Validate the state transition
    let result = validate_flash_mint_spell(&input, &output, &flash_mint);
    assert!(result.is_ok());
}
```

## References

- [Charms Protocol Whitepaper](https://charms.dev)
- [RGB Protocol](https://rgb-org.github.io/)
- [Client-Side Validation - Bitcoin Optech](https://bitcoinops.org/en/topics/client-side-validation/)
- [Taproot Assets](https://docs.lightning.engineering/the-lightning-network/taproot-assets)

---

*This document follows Bitcoin-native UTXO patterns rather than Ethereum smart contract patterns.*
