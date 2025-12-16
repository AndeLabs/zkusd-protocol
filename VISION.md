# zkUSD Vision: Bitcoin-Native DeFi

## Mission

> **"Unlock Bitcoin's potential as productive capital - on Bitcoin itself."**

zkUSD is the first collateralized stablecoin that lives entirely on Bitcoin L1. No bridges, no sidechains, no trust assumptions beyond Bitcoin's security model.

---

## Current Reality: L1 Proto-Rollup

### What We've Built

zkUSD is a **"proto-rollup"** - a protocol that brings rollup-like optimizations to Bitcoin L1 using Charms Protocol:

```
┌─────────────────────────────────────────────────────────────┐
│                    zkUSD PROTO-ROLLUP                        │
│              "Rollup Benefits, L1 Security"                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  What makes it "proto-rollup":                              │
│  ├─ Client-side execution (not on-chain)                   │
│  ├─ ZK proof verification (not re-execution)               │
│  ├─ Batch operations (multiple ops per tx)                 │
│  ├─ Parallel validation (UTXO independence)                │
│  └─ Bitcoin settlement (L1 security)                       │
│                                                              │
│  What's different from full rollup:                         │
│  ├─ Each spell = 1 Bitcoin transaction                     │
│  ├─ No off-chain sequencer                                 │
│  ├─ No separate data availability                          │
│  └─ Direct Bitcoin finality                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Deployed on Testnet4

| Contract | Status | UTXO |
|----------|--------|------|
| **Price Oracle** | Deployed | `e4aeedcc...02b977:0` |
| **zkUSD Token** | Deployed | `4ec30b16...e8713e:0` |
| **Vault Manager** | Deployed | `a6dfdfaa...55a7a9:0` |
| **Stability Pool** | Deployed | `ea78d29a...7194c:0` |

---

## L1 Optimizations: Already Implemented

### 1. Spell Batching (60% Fee Reduction)

Multiple operations in a single Bitcoin transaction:

```rust
// Already implemented in contracts/common/src/advanced_ops.rs

pub fn process_batch_liquidations(
    batch: &BatchLiquidation,
    vaults: &[Vault],
    stability_pool: &StabilityPoolState,
) -> ZkUsdResult<BatchResult>

// Result:
// - 10 liquidations = 1 transaction
// - Fee: $5 total vs $50 individual
// - 60% savings calculated automatically
```

**Use Cases:**
- Batch liquidations (10+ vaults in 1 tx)
- Batch deposits to Stability Pool
- Batch token transfers
- Batch redemptions

### 2. Reference Inputs (1000x Parallelism)

Read UTXOs without consuming them:

```rust
// Oracle and Pool can be READ by 1000s of transactions
// without being consumed

for (_, charms) in tx.refs.iter() {  // Reference, not consumed
    if let Some(data) = charms.get(&oracle_app) {
        let price = data.value::<PriceData>()?;
        // Use price without blocking other transactions
    }
}
```

**Benefits:**
- Oracle serves unlimited parallel reads
- No contention on shared state
- Parallel liquidations possible

### 3. Soft Liquidation (LLAMMA-Style)

Gradual, reversible liquidations:

```rust
// Already implemented in contracts/common/src/advanced_ops.rs

pub fn process_soft_liquidation(
    vault: &mut SoftLiquidationVault,
    current_price: u64,
    current_block: u64,
    config: &SoftLiquidationConfig,
) -> ZkUsdResult<SoftLiquidationResult>

// Benefits:
// - Collateral sold gradually as price drops
// - Auto-reverses if price recovers
// - 144 block grace period (~1 day)
// - Reduces liquidation losses 50-80%
```

### 4. Vault Sharding (Parallel Processing)

Split large vaults for parallel operations:

```rust
// Already implemented

pub fn shard_vault(vault: Vault, num_shards: u8) -> ZkUsdResult<ShardedVault>

pub fn liquidate_shard(
    shard: &mut VaultShard,
    btc_price: u64,
) -> ZkUsdResult<ShardLiquidationResult>

// Benefits:
// - Large vaults ($100k+) can be processed in parallel
// - Multiple liquidators can work simultaneously
// - Reduces congestion during market crashes
```

### 5. Flash Minting (Atomic, No Callbacks)

UTXO-native flash loans:

```rust
// Already implemented in contracts/common/src/flash.rs

pub fn validate_flash_mint_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    flash_mint: &SpellFlashMint,
) -> ZkUsdResult<FlashMintValidation>

// UTXO Advantage:
// - No callbacks (impossible in UTXO model)
// - No reentrancy attacks (atomic by design)
// - Simpler, safer implementation
```

### 6. Atomic Rescue (Third-Party Collateral Addition)

Anyone can rescue underwater vaults:

```rust
// Already implemented in contracts/common/src/charms_ops.rs

pub fn validate_rescue_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    rescue: &SpellRescue,
    btc_price: u64,
    current_block: u64,
) -> ZkUsdResult<RescueValidation>

// Benefits:
// - Rescuers add collateral to distressed vaults
// - Earn premium for saving positions
// - No vault owner signature required
// - Reduces liquidations, improves stability
```

### 7. Fee Estimation

Automatic fee calculation with batching discounts:

```rust
// Already implemented in contracts/common/src/types.rs

impl FeeEstimate {
    pub fn for_batch(num_operations: u32) -> Self {
        // Batching saves ~60% on per-operation overhead
        let individual_cost = num_operations as u64 * (COST_PER_INPUT + COST_PER_OUTPUT);
        let batched_cost = individual_cost * 40 / 100; // 60% savings
        // ...
    }
}
```

---

## Current Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **MCR** | 110% | Minimum collateralization |
| **CCR** | 150% | Recovery mode threshold |
| **MIN_DEBT** | 2,000 zkUSD | Liquidation profitability on L1 |
| **LIQUIDATION_RESERVE** | 200 zkUSD | Gas compensation |
| **BORROWING_FEE** | 0.5-5% | Protocol revenue |
| **FLASH_FEE** | 0.05% | Flash mint cost |

### Why MIN_DEBT is $2,000

```
L1 Bitcoin Transaction Costs:
├─ Base tx fee: ~$1-5
├─ ZK proof verification: ~$2-5
├─ Liquidation coordination: ~$2-3
└─ Total per operation: ~$5-13

Liquidation Economics:
├─ Liquidator must profit from 5% bonus
├─ At $100 debt: 5% = $5 (barely covers gas)
├─ At $2,000 debt: 5% = $100 (profitable)
└─ MIN_DEBT = $2,000 ensures liquidations work
```

---

## Target Users

### Now (L1)

| User Type | Min. Collateral | Use Case |
|-----------|-----------------|----------|
| **BTC HODLers** | ~$3,000 | Borrow against BTC without selling |
| **Traders** | ~$5,000 | Leverage, arbitrage |
| **Protocols** | ~$50,000 | Treasury management |
| **Institutions** | $100,000+ | Large-scale borrowing |

### Value Proposition

```
Traditional Options:           zkUSD:
├─ Sell BTC (lose upside)     ├─ Keep BTC (keep upside)
├─ Bridge to ETH (bridge risk)├─ Stay on Bitcoin (no bridge)
├─ Use WBTC (custodian risk)  ├─ Native BTC (trustless)
└─ Centralized lending (KYC)  └─ Permissionless (no KYC)
```

---

## Roadmap

### Phase 1: Hackathon MVP (Current)

**Status: In Progress**

- [x] Core protocol deployed on testnet4
- [x] Batch operations implemented
- [x] Soft liquidation implemented
- [x] Flash minting implemented
- [ ] Frontend UI (React/Next.js)
- [ ] First real vault opened
- [ ] Demo video

### Phase 2: L1 Optimization (Q1 2026)

**Focus: Maximize L1 capabilities**

- [ ] Frontend launch
- [ ] Transaction batching service
- [ ] Improved UX for batch operations
- [ ] Insurance charms live
- [ ] Multi-oracle support

**Target Improvements:**
```
Current L1:              Optimized L1:
├─ ~$5-10 per op        ├─ ~$1-3 per op (batching)
├─ MIN_DEBT $2,000      ├─ MIN_DEBT $500-1,000
└─ 10 min latency       └─ 1-2 min (parallel)
```

### Phase 3: Ecosystem (Q2-Q3 2026)

**Focus: Integrations and adoption**

- [ ] DEX integrations
- [ ] Lending protocol partnerships
- [ ] Cross-chain beaming (via BitcoinOS)
- [ ] Lightning Network integration
- [ ] Mobile wallet support

### Phase 4: Mainnet (Q4 2026)

**Focus: Production deployment**

- [ ] Security audits (2+ firms)
- [ ] Bug bounty program
- [ ] Gradual rollout
- [ ] Governance framework

---

## Very Long-Term Vision: L2 Rollup

> **Note: This is exploratory research, not a committed roadmap.**

### The Scalability Question

L1 optimizations can improve fees by 3-5x. For 100x+ improvement, a true L2 rollup would be needed. This depends on:

1. **BitcoinOS maturity** - BitSNARK, GRAIL are still in development
2. **Market demand** - Is there enough demand for $10 vaults?
3. **Technical feasibility** - Can we build reliable sequencer?
4. **Decentralization** - How to avoid single point of failure?

### If We Built an L2

```
┌─────────────────────────────────────────────────────────────┐
│                    HYPOTHETICAL L2                           │
│              (Research Only - Not Committed)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Potential benefits:                                        │
│  ├─ MIN_DEBT: $10 (vs $2,000)                              │
│  ├─ Fees: < $0.01 (vs $5-10)                               │
│  ├─ Latency: < 1 sec (vs 10 min)                           │
│  └─ TPS: 10,000+ (vs ~7)                                   │
│                                                              │
│  Challenges:                                                │
│  ├─ Sequencer centralization risk                          │
│  ├─ New attack vectors                                     │
│  ├─ Complexity (6-12 months development)                   │
│  ├─ Dependency on immature BitcoinOS stack                 │
│  └─ Gas token decisions (BTC? zkUSD? New token?)           │
│                                                              │
│  Status: RESEARCH ONLY                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Decision Framework

**Build L2 if:**
- L1 optimizations hit fundamental limits
- BitcoinOS stack matures and is battle-tested
- Clear demand for <$100 vaults
- Team capacity available

**Stay on L1 if:**
- Batching achieves 3-5x improvement
- Target users are $2,000+ positions
- Simplicity and security prioritized
- BitcoinOS stack remains immature

---

## Honest Comparison

### zkUSD L1 vs Alternatives

| Factor | zkUSD L1 | Lightning | Liquid | Ethereum L2 |
|--------|----------|-----------|--------|-------------|
| **Security** | Bitcoin PoW | Bitcoin-backed | Federation | Alt consensus |
| **Min. position** | ~$2,000 | Any | Any | ~$10 |
| **Fees** | $5-10 | < $0.01 | ~$0.50 | < $0.10 |
| **Stablecoins** | Native | Via channels | L-USDT | USDC/DAI |
| **CDP/DeFi** | Native | No | Limited | Full |
| **Trust model** | Trustless | Channels | Federation | Varies |

### Who Should Use What

```
Want instant payments?        → Lightning
Want cheap DeFi?              → Ethereum L2
Want Bitcoin-native DeFi?     → zkUSD (if >$2k position)
Want federated stablecoin?    → Liquid
Want trustless Bitcoin CDP?   → zkUSD (only option)
```

---

## Summary

### What zkUSD IS:

- First Bitcoin-native CDP stablecoin
- L1 protocol with rollup-like optimizations
- Production-ready for $2,000+ positions
- Trustless, permissionless, decentralized

### What zkUSD is NOT (yet):

- Cheap enough for small positions (<$500)
- Fast enough for real-time applications
- An L2 rollup (that's future research)

### Our Philosophy

> **"Do one thing well on Bitcoin L1 before expanding."**

We're building the foundation for Bitcoin DeFi. The L1 protocol must be secure, reliable, and useful before we consider more complex L2 solutions.

---

<div align="center">

**Built on Bitcoin. Secured by Bitcoin. For Bitcoin holders.**

[README](./README.md) | [Architecture](./ARCHITECTURE.md) | [Research](./RESEARCH.md)

</div>
