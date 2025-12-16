# zkUSD - Bitcoin-Native Stablecoin

<div align="center">

**The first overcollateralized stablecoin on Bitcoin L1**

Built with [Charms Protocol](https://charms.dev) | Powered by Zero-Knowledge Proofs

[![Testnet](https://img.shields.io/badge/Testnet4-Deployed-green)](https://mempool.space/testnet4)
[![Charms](https://img.shields.io/badge/Charms-v0.10-blue)](https://docs.charms.dev)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[Documentation](./docs/) | [Architecture](./ARCHITECTURE.md) | [Vision](./VISION.md)

</div>

---

## What is zkUSD?

zkUSD lets you **borrow stablecoins against your Bitcoin** without selling it. Deposit BTC as collateral, mint zkUSD, and keep exposure to Bitcoin's upside.

```
┌─────────────────────────────────────────────────────────────┐
│                    HOW IT WORKS                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   You have: 0.05 BTC ($5,000)                               │
│                                                              │
│   1. Deposit BTC as collateral                              │
│   2. Mint up to ~$4,000 zkUSD (at 125% ratio)              │
│   3. Use zkUSD for payments, DeFi, trading                  │
│   4. Repay zkUSD + fee to reclaim your BTC                  │
│                                                              │
│   Result: You got liquidity WITHOUT selling your Bitcoin    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why Bitcoin-Native?

| Traditional Approach | zkUSD Approach |
|---------------------|----------------|
| Bridge BTC to Ethereum | Stay on Bitcoin |
| Trust custodians (WBTC) | Trustless (ZK proofs) |
| Smart contract risks | UTXO atomicity |
| Bridge hacks ($2B+ lost) | No bridges needed |

---

## Current Status: Testnet4 Deployed

**All core contracts are live on Bitcoin Testnet4:**

| Contract | UTXO | Confirmations |
|----------|------|---------------|
| Price Oracle | `e4aeedcc...02b977:0` | 150+ |
| zkUSD Token | `4ec30b16...e8713e:0` | 170+ |
| Vault Manager | `a6dfdfaa...55a7a9:0` | 185+ |
| Stability Pool | `ea78d29a...7194c:0` | 185+ |

**Verification Keys:**
```
Token:          7d1a06745a94adf1195fb9f2f987cb48b8c46b814f53167c619c9175cd406903
Vault Manager:  56ff2636c4d11caeed8a90a608e7c067928e5368f3166d495b85be90af659c44
Stability Pool: ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752
Price Oracle:   b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32
```

---

## Key Features

### Core Protocol

| Feature | Description | Status |
|---------|-------------|--------|
| **Vault Management** | Open, modify, close CDPs with BTC collateral | Deployed |
| **zkUSD Token** | Mintable stablecoin with conservation validation | Deployed |
| **Stability Pool** | First line of defense for liquidations | Deployed |
| **Price Oracle** | BTC/USD price feed with staleness protection | Deployed |
| **Redemptions** | Exchange zkUSD for BTC at face value | Implemented |
| **Recovery Mode** | Protocol-wide protection at 150% TCR | Implemented |

### L1 Optimizations (Proto-Rollup)

These features bring rollup-like benefits while staying on Bitcoin L1:

| Feature | Benefit | Implementation |
|---------|---------|----------------|
| **Batch Operations** | 60% fee reduction | `process_batch_liquidations()` |
| **Reference Inputs** | Parallel validation | Oracle/Pool as read-only refs |
| **Soft Liquidation** | 50-80% loss reduction | LLAMMA-style bands |
| **Vault Sharding** | Parallel processing | Split large vaults |
| **Flash Minting** | Atomic loans | No callbacks needed |
| **Atomic Rescue** | Third-party saves | Permissionless collateral addition |

### UTXO-Native Innovations

Unique to Bitcoin's UTXO model:

| Innovation | Description |
|------------|-------------|
| **No Reentrancy** | UTXO atomicity makes reentrancy attacks impossible |
| **Parallel Liquidations** | Independent UTXOs process simultaneously |
| **Client-Side Validation** | ZK proofs verified locally, not by miners |
| **Atomic Transactions** | All operations succeed or fail together |

---

## Protocol Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `MCR` | 110% | Minimum Collateralization Ratio |
| `CCR` | 150% | Critical Collateralization (Recovery Mode) |
| `MIN_DEBT` | 2,000 zkUSD | Minimum debt per vault |
| `LIQUIDATION_RESERVE` | 200 zkUSD | Gas compensation |
| `BORROWING_FEE` | 0.5% - 5% | One-time fee on borrowed zkUSD |
| `FLASH_FEE` | 0.05% | Fee for flash minting |

### Why MIN_DEBT is $2,000

On Bitcoin L1, transaction costs make small positions uneconomical:

```
Transaction costs: ~$5-10 per operation
Liquidation bonus: 5% of debt
At $100 debt: bonus = $5 (barely covers gas)
At $2,000 debt: bonus = $100 (profitable for liquidators)
```

Target users: BTC holders with $3,000+ positions who want liquidity without selling.

---

## Quick Start

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Charms CLI
cargo install charms --version=0.10.0

# Install Bitcoin Core (testnet4)
brew install bitcoin  # macOS
```

### Build

```bash
# Clone repository
git clone https://github.com/zkusd/zkusd.git
cd zkusd

# Build all contracts
cargo build --release

# Run tests (275 tests)
cargo test --release
```

### Deploy

```bash
# Start Bitcoin node
bitcoind -testnet4 -daemon

# Deploy using scripts
./scripts/deploy-oracle.sh <funding_utxo> <amount_sats>
```

See [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) for complete instructions.

---

## Project Structure

```
zkUSD/
├── contracts/
│   ├── common/              # Shared library (20,000+ lines)
│   │   └── src/
│   │       ├── constants.rs    # Protocol parameters
│   │       ├── types.rs        # Core data structures
│   │       ├── math.rs         # ICR, fee calculations
│   │       ├── advanced_ops.rs # Batch, sharding, soft liq
│   │       ├── flash.rs        # Flash mint validation
│   │       ├── liquidation.rs  # Liquidation logic
│   │       └── ...
│   │
│   ├── zkusd-token/         # Token validation
│   ├── vault-manager/       # CDP validation
│   ├── stability-pool/      # Pool validation
│   └── price-oracle/        # Oracle validation
│
├── scripts/                 # Deployment scripts
├── spells/                  # YAML spell templates
├── deployments/testnet4/    # Deployment config
│
├── ARCHITECTURE.md          # Technical architecture
├── VISION.md               # Roadmap & philosophy
└── docs/                   # Documentation
```

---

## Technology Stack

| Technology | Purpose |
|------------|---------|
| [Charms Protocol](https://charms.dev) | Programmable tokens on Bitcoin |
| [SP1 zkVM](https://succinct.xyz) | Zero-knowledge proofs |
| Bitcoin Testnet4 | Test network |
| Rust | Smart contract language |

### Inspired By

| Protocol | What We Learned |
|----------|-----------------|
| [Liquity](https://liquity.org) | CDP mechanics, Stability Pool |
| [MakerDAO](https://makerdao.com) | Multi-collateral design |
| [crvUSD](https://curve.fi) | Soft liquidations (LLAMMA) |

---

## Hackathon

zkUSD is being developed for **BitcoinOS "Enchanting UTXO" Hackathon**:

- **Organizers**: Encode Club + BitcoinOS
- **Start**: December 8, 2025
- **Duration**: 4-7 weeks

### What We're Demonstrating

1. **Complex Charms Integration** - 4 interacting apps
2. **UTXO-Native Design** - Features impossible on Ethereum
3. **Production-Ready Protocol** - 275 passing tests
4. **Clear Use Case** - Stablecoins are proven DeFi primitive

---

## Roadmap

### Now: Hackathon MVP

- [x] Core protocol deployed
- [x] Batch operations
- [x] Soft liquidation
- [ ] Frontend UI
- [ ] Demo video

### Q1 2026: L1 Optimization

- [ ] Transaction batching service
- [ ] Multi-oracle support
- [ ] Insurance charms

### Q2-Q3 2026: Ecosystem

- [ ] DEX integrations
- [ ] Cross-chain beaming
- [ ] Lightning integration

### Q4 2026: Mainnet

- [ ] Security audits
- [ ] Production deployment

### Future Research: L2 Rollup

> See [VISION.md](./VISION.md) for discussion on potential L2 development. This is exploratory research, not a committed roadmap.

---

## Honest Assessment

### What zkUSD IS:

- First Bitcoin-native CDP stablecoin
- Trustless, permissionless protocol
- Production-ready for $2,000+ positions
- Unique UTXO-native features

### What zkUSD is NOT (yet):

- Cheap for small positions (<$500)
- As fast as centralized alternatives
- An L2 rollup (that's future research)

### Who Should Use zkUSD:

```
✅ BTC holders with >$3,000 who want liquidity
✅ Traders looking for Bitcoin-native leverage
✅ Protocols needing treasury management
✅ Anyone who values trustless over cheap

❌ Users with <$500 (too expensive on L1)
❌ Users who need instant finality
❌ Users who prioritize cost over security
```

---

## Contributing

Contributions welcome! Areas we need help:

- [ ] Frontend development (React/Next.js)
- [ ] TypeScript SDK
- [ ] Security auditing
- [ ] Documentation improvements

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [VISION.md](./VISION.md) before contributing.

---

## Security

- All arithmetic uses checked operations
- Client-side validation with ZK proofs
- No trusted third parties
- Atomic UTXO semantics (no reentrancy)

**Audit Status**: Not yet audited. Testnet only.

---

## Links

| Resource | URL |
|----------|-----|
| Charms Docs | [docs.charms.dev](https://docs.charms.dev) |
| BitcoinOS | [bitcoinos.build](https://bitcoinos.build) |
| Mempool Explorer | [mempool.space/testnet4](https://mempool.space/testnet4) |

---

## License

MIT License - see [LICENSE](./LICENSE)

---

<div align="center">

**Built on Bitcoin. For Bitcoin holders.**

*The first stablecoin that doesn't require leaving Bitcoin.*

</div>
