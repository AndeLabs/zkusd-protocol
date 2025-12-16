# zkUSD Architecture on Charms Protocol

## Overview

zkUSD is a **collateralized stablecoin protocol** built on Bitcoin using the [Charms Protocol](https://charms.dev). Unlike traditional smart contract platforms, Charms uses a **client-side validation model** where:

- Assets (charms) live inside Bitcoin UTXOs
- Transactions include **spells** (transformation descriptions + ZK proofs)
- Each client validates proofs independently - no indexers required
- State is carried in UTXOs, not in a global state machine

## Key Concepts

### Charms vs Smart Contracts

| Aspect | Smart Contracts (ETH) | Charms (BTC) |
|--------|----------------------|--------------|
| State | Global, mutable | Per-UTXO, immutable |
| Execution | On-chain by validators | Client-side by users |
| Calls | Contract-to-contract | UTXO transformation |
| Verification | Re-execute code | Verify ZK proof |
| Trust | Trust validators | Trustless (cryptographic) |

### The Spell Model

A **spell** is attached to a Bitcoin transaction and contains:

```
spell = {
    apps: [app1, app2, ...],     // Which apps are involved
    inputs: [(utxo, charms)...], // UTXOs being consumed
    outputs: [charms...],        // Charms being created
    proof: zk_proof              // Cryptographic proof of validity
}
```

### Apps as Validation Functions

Each Charms app is a **pure validation function**:

```rust
fn app_contract(
    app: &App,           // App identity and verification key
    tx: &Transaction,    // Full transaction context
    x: &Data,            // Public inputs
    w: &Data,            // Witness (private inputs for prover)
) -> bool
```

The function returns `true` if the transformation is valid, `false` otherwise.

## zkUSD Protocol Design

### Charm Types

1. **zkUSD Token Charms** (tag: `t`)
   - Represent zkUSD balances
   - Data: `{ owner: Address, amount: u64 }`
   - Conserved in transfers, created by minting, destroyed by burning

2. **Vault Charms** (tag: `n` - NFT-like)
   - Represent individual CDP positions
   - Data: `{ owner, collateral, debt, status, ... }`
   - Unique per vault, mutable through operations

3. **Protocol State Charm** (tag: `n`)
   - Global protocol parameters
   - Data: `{ total_collateral, total_debt, base_rate, ... }`
   - Referenced in transactions, updated atomically

4. **Price Oracle Charm** (tag: `n`)
   - Current BTC/USD price
   - Data: `{ price, timestamp_block, source }`
   - Updated by authorized operator

### Transaction Flows

#### Open Vault

```
INPUTS:                          OUTPUTS:
├─ BTC collateral               ├─ Vault charm (new)
└─ Protocol state charm ───────►├─ Protocol state charm (updated)
                                ├─ zkUSD token charm (minted)
                                └─ Change (if any)
```

#### Transfer zkUSD

```
INPUTS:                          OUTPUTS:
└─ zkUSD charm (sender) ───────►├─ zkUSD charm (recipient)
                                └─ zkUSD charm (change to sender)

Conservation: sum(inputs) == sum(outputs)
```

#### Liquidate Vault

```
INPUTS:                          OUTPUTS:
├─ Vault charm (underwater)     ├─ Vault charm (liquidated status)
├─ Stability Pool charm ───────►├─ Stability Pool charm (updated)
├─ Price Oracle charm (ref)     ├─ BTC to liquidator
└─ Protocol state charm         └─ Protocol state charm (updated)
```

### Validation Rules

Each app validates specific invariants:

**zkusd-token:**
- Transfers: `sum(inputs) == sum(outputs)` (conservation)
- Mint: Only VaultManager app can create new tokens
- Burn: Only VaultManager app can destroy tokens

**vault-manager:**
- Open: `ICR >= MCR`, `debt >= MIN_DEBT`
- Withdraw: `new_ICR >= MCR`, not in Recovery Mode restrictions
- Liquidate: `ICR < MCR` (or `ICR < CCR` in Recovery Mode)
- Redeem: Proportional redemption from lowest ICR vaults

**stability-pool:**
- Deposit: Transfers zkUSD into pool, updates depositor snapshot
- Withdraw: Computes compounded value, returns zkUSD + BTC gains
- Offset: Only callable during liquidation, absorbs debt

**price-oracle:**
- Update: Only operator can update, deviation limits apply
- Staleness: Price expires after MAX_PRICE_AGE_BLOCKS

## Implementation Structure

```
contracts/
├── common/              # Shared types, math, errors
│   └── src/
│       ├── constants.rs # Protocol parameters
│       ├── types.rs     # Core data structures
│       ├── math.rs      # Safe arithmetic, ICR calculations
│       ├── errors.rs    # Typed error handling
│       └── events.rs    # Event definitions (for indexing)
│
├── zkusd-token/         # Token validation app
│   └── src/
│       ├── lib.rs       # Core validation logic
│       ├── charms.rs    # Charms SDK integration
│       └── main.rs      # App entry point
│
├── vault-manager/       # CDP validation app
├── stability-pool/      # Stability pool app
└── price-oracle/        # Oracle app
```

## Building and Testing

```bash
# Build all contracts (library mode)
cargo build --release

# Build with Charms integration
cargo build --release --features charms

# Run tests
cargo test --release

# Build specific app for deployment
cargo build --release -p zkusd-token --features charms
```

## Charms Integration Patterns

This section documents patterns we've developed for Charms integration that may help other developers.

### Pattern 1: Operation Witness Structure

Each app uses a witness structure to encode operations in the transaction:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppWitness {
    pub op: u8,           // Operation code (unique per app)
    pub field1: Option<T>, // Operation-specific fields
    pub field2: Option<U>,
}

// Operation codes are namespaced to avoid collisions
pub mod op {
    pub const TOKEN_TRANSFER: u8 = 0x01;
    pub const VAULT_OPEN: u8 = 0x10;
    pub const POOL_DEPOSIT: u8 = 0x20;
    pub const ORACLE_UPDATE: u8 = 0x30;
}
```

### Pattern 2: Reference vs Consumed Inputs

Charms distinguishes between:
- **`tx.ins`**: Consumed UTXOs (spent in this transaction)
- **`tx.refs`**: Reference UTXOs (read-only, not spent)

```rust
// Oracle is typically referenced, not consumed
for (_, charms) in tx.refs.iter() {
    if let Some(data) = charms.get(&oracle_app) {
        let price = data.value::<PriceData>().ok()?;
        // Use price for validation without consuming oracle UTXO
    }
}

// Vault is consumed and recreated
let input_vault = tx.ins.iter()
    .find_map(|(_, charms)| charms.get(&app).and_then(|d| d.value().ok()));
let output_vault = tx.outs.iter()
    .find_map(|charms| charms.get(&app).and_then(|d| d.value().ok()));
```

### Pattern 3: Cross-App Authorization

Apps authorize each other through transaction context:

```rust
// StabilityPool checks if VaultManager is calling offset()
fn extract_caller_app(tx: &Transaction) -> Option<[u8; 32]> {
    for (app, _) in tx.app_public_inputs.iter() {
        return Some(app.identity.0);
    }
    None
}

// Validation
if caller != ctx.config.vault_manager_id {
    return Err(ZkUsdError::Unauthorized { ... });
}
```

### Pattern 4: Feature-Flagged SDK Integration

SDK dependencies are optional to allow library usage without WASM:

```toml
[features]
default = []
charms = ["charms-sdk", "charms-data"]

[dependencies]
charms-sdk = { version = "0.10", optional = true }
charms-data = { version = "0.10", optional = true }
```

```rust
// In lib.rs
#[cfg(feature = "charms")]
pub mod charms;
```

### Pattern 5: Validation Context Pattern

Separate context building from validation logic:

```rust
pub struct ValidationContext {
    pub state: AppState,
    pub new_state: AppState,
    pub inputs: Vec<Input>,
    pub outputs: Vec<Output>,
    pub signer: Address,
    pub events: EventLog,
}

// Context is built from Charms Transaction
fn build_context(tx: &Transaction, ...) -> Option<ValidationContext> { ... }

// Core logic is SDK-agnostic
fn validate(ctx: &mut ValidationContext, action: &Action) -> Result<()> { ... }
```

### Pattern 6: BTC and Token Flow Calculation

Track asset flows for conservation validation:

```rust
fn calculate_btc_flows(tx: &Transaction) -> (u64, u64) {
    let inputs = tx.coin_ins
        .as_ref()
        .map(|ins| ins.iter().map(|o| o.amount).sum())
        .unwrap_or(0);
    let outputs = tx.coin_outs
        .as_ref()
        .map(|outs| outs.iter().map(|o| o.amount).sum())
        .unwrap_or(0);
    (inputs, outputs)
}

fn calculate_token_flows(tx: &Transaction, token_app: &App) -> (u64, u64) {
    // Sum from ins and outs using token_app as key
}
```

## Design Principles

### 1. NOT Smart Contracts

The most critical mindset shift: **Apps are validation functions, not smart contracts**.

- No global state machine
- No "storage" that persists between calls
- Each UTXO carries its own state
- Validation = "Is this transformation legal?"

### 2. User Sovereignty

Each user validates their own transactions:
- No indexer required for balance queries
- Users own their vault/deposit charms directly
- Proofs are cryptographic, not trust-based

### 3. Atomic Composition

Multiple apps can validate the same transaction:
- VaultManager + zkUSD Token in mint operation
- VaultManager + StabilityPool + Oracle in liquidation
- All validations must pass, or entire transaction fails

### 4. Minimal State Charms

Keep per-operation state minimal:
- Vault charm: owner, collateral, debt, status
- Token charm: owner, amount
- Pool state: total, product_p, sum_s (aggregates only)

Individual user positions (deposits, vaults) are separate UTXOs.

## Security Considerations

1. **ZK Proof Verification**: All state transitions are cryptographically proven
2. **Client-Side Validation**: No trust in third parties
3. **UTXO Atomicity**: All changes in a transaction succeed or fail together
4. **Overflow Protection**: All arithmetic uses checked operations
5. **Access Control**: Mint/burn restricted to VaultManager app
6. **Stale Price Prevention**: Oracle returns error on stale price
7. **Cross-App Security**: Apps verify caller identity for sensitive operations

## Testing with Charms Feature

```bash
# Build with Charms integration
cargo build --release -p zkusd-vault-manager --features charms
cargo build --release -p zkusd-stability-pool --features charms
cargo build --release -p zkusd-price-oracle --features charms
cargo build --release -p zkusd-token --features charms

# Run all tests (library mode, no SDK)
cargo test --release

# Run tests with Charms types
cargo test --release --features charms
```

## L1 Optimizations (Proto-Rollup)

zkUSD brings rollup-like benefits to Bitcoin L1 through several optimizations:

### Batch Operations

Multiple operations in a single spell/transaction:

```rust
// Already implemented in contracts/common/src/advanced_ops.rs

pub fn process_batch_liquidations(
    batch: &BatchLiquidation,
    vaults: &[Vault],
    stability_pool: &StabilityPoolState,
) -> ZkUsdResult<BatchResult>

// 10 liquidations = 1 transaction
// 60% fee savings via FeeEstimate::for_batch()
```

### Reference Inputs

Read shared state without consuming UTXOs:

```rust
// Oracle and Pool serve unlimited parallel reads
for (_, charms) in tx.refs.iter() {  // Reference, not consumed
    if let Some(data) = charms.get(&oracle_app) {
        let price = data.value::<PriceData>()?;
    }
}
```

### Soft Liquidation

LLAMMA-style gradual liquidations with 144-block grace period.

### Vault Sharding

Split large vaults for parallel processing by multiple liquidators.

### Flash Minting

Atomic mint-use-repay without callbacks (UTXO advantage: no reentrancy possible).

---

## Future Research: L2 Rollup

> **Note**: This is exploratory research, not a committed roadmap.

For significant scalability improvements beyond L1 batching, a true L2 rollup would require:

- BitcoinOS stack maturity (BitSNARK, GRAIL)
- Sequencer infrastructure
- Data availability solution
- Escape hatch mechanisms

See [VISION.md](./VISION.md) for detailed discussion of L2 tradeoffs.

---

## References

- [Charms Protocol](https://charms.dev)
- [Charms Whitepaper](https://docs.charms.dev/Charms-whitepaper.pdf)
- [BitcoinOS](https://bitcoinos.build)
- [Liquity Protocol](https://liquity.org) (inspiration for CDP mechanics)
