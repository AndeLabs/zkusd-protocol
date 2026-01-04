# zkUSD Protocol - BOS Hackathon Final Submission

## 📋 Quick Reference

**GitHub Repository**: https://github.com/AndeLabs/zkusd-protocol

**Live Demo**: [PENDING - Add your Vercel URL]

**Demo Video**: [PENDING - Add your video URL]

**Presentation**: [OPTIONAL - Add if you have one]

---

## 🎯 Project Overview

**zkUSD** is a fully decentralized, Bitcoin-native stablecoin protocol built entirely with Charms. Users deposit BTC as collateral and mint USD-pegged stablecoins through Collateralized Debt Positions (CDPs) - all without bridges, custodians, or leaving Bitcoin's security model.

### What Makes zkUSD Special

Unlike traditional stablecoins that require bridges or wrapped tokens, zkUSD leverages Charms Protocol to bring true programmable logic directly to Bitcoin L1, enabling DeFi innovations that are impossible on other chains.

---

## ✅ Hackathon Requirements Met

### 1. SDK First: Comprehensive Charms Integration ✅

We've built **4 fully deployed Charms apps** on Bitcoin Testnet4, all live and functional:

- **Price Oracle** (App ID: `8aa4f505...991b1ef2`) - BTC/USD price feed with ZK validation
- **zkUSD Token** (App ID: `a6b3570c...72455c82`) - Fungible token with controller NFT state
- **Vault Manager** (App ID: `3ce7c8f6...1cf878d0`) - CDP management with NFT per vault
- **Stability Pool** (App ID: `c11c5451...f8a067bf`) - Liquidation pool with NFT state

**Proof**: All contracts deployed on Bitcoin Testnet4 Block 113548+ (see `spells/DEPLOYMENT_STATUS.md`)

**Integration Details**:
- Each contract compiled to WASM for Charms runtime
- Full cross-app validation using Charms `app_id` system
- ZK proofs generated and verified for every state transition
- Client-side validation with TypeScript SDK
- Spell-based transaction composition (YAML files in `spells/`)

**Code**: Every contract has a dedicated `src/charms.rs` file showing SDK integration:
- `contracts/price-oracle/src/charms.rs`
- `contracts/zkusd-token/src/charms.rs`
- `contracts/vault-manager/src/charms.rs`
- `contracts/stability-pool/src/charms.rs`

### 2. Working UI: Functional Front-End ✅

Production-ready web application with full wallet integration:

**Features**:
- ✅ Open vault with BTC collateral
- ✅ Adjust collateral and debt
- ✅ Deposit to stability pool
- ✅ Real-time vault statistics (ICR, TCR, debt)
- ✅ Wallet integration (Unisat, Xverse)
- ✅ Mobile responsive design (2025 best practices)
- ✅ Transaction flow with ZK proof generation

**Tech Stack**:
- Next.js 15 + React 19
- TailwindCSS with fluid typography
- Zustand for state management
- Custom Charms SDK client

**Location**: `apps/web/` directory

### 3. Core Feature Complete: End-to-End Implementation ✅

**Completed Features**:
1. ✅ Vault creation with BTC collateral (110% minimum ratio)
2. ✅ zkUSD minting and burning
3. ✅ Liquidation mechanism via Stability Pool
4. ✅ Price oracle integration with staleness checks
5. ✅ Cross-contract atomic validation
6. ✅ Recovery mode when Total CR < 150%

**Advanced Features** (implemented, ready for UI integration):
- ⚡ **Flash Minting** - UTXO-native flash loans without callbacks
- 🛟 **Atomic Vault Rescue** - Permission-less rescue of underwater vaults
- 🛡️ **Insurance Charms** - Tradable NFT liquidation protection

---

## 🚀 Innovations: Why zkUSD Stands Out

### 1. ⚡ Flash Minting (No Callbacks Required)

Unlike Ethereum's flash loans, zkUSD's flash mints are **atomically validated in a single UTXO transaction**:

```rust
// contracts/common/src/charms_ops.rs
pub struct SpellFlashMint {
    pub mint_amount: u64,       // 100 - 10M zkUSD
    pub fee: u64,               // 0.05% (5 bps)
    pub purpose: FlashMintPurpose,
}
```

**Use Cases**: Self-liquidation, arbitrage, collateral swaps, leverage adjustments

**Why It's Novel**: UTXO atomicity eliminates callback complexity - all validation happens in one Bitcoin transaction.

### 2. 🛟 Atomic Vault Rescue

Third parties can **rescue underwater vaults without owner permission** in a single atomic transaction:

```rust
pub struct SpellRescue {
    pub vault_id: VaultId,
    pub collateral_to_add: u64,
    pub debt_to_repay: u64,
    pub rescuer_discount: u64,  // Up to 5% incentive
}
```

**How It Works**:
1. Rescuer provides collateral + debt repayment
2. Vault ICR improves above MCR
3. Rescuer receives up to 5% discount
4. All in one UTXO transaction - no vault owner signature needed

**Why It's Novel**: Only possible with UTXO model - permission-less intervention that benefits both parties.

### 3. 🛡️ Insurance Charms (Tradable NFTs)

First-ever **tradable liquidation protection** as NFT charms:

```rust
pub struct SpellInsurance {
    pub charm_id: [u8; 32],
    pub coverage_btc: u64,
    pub trigger_icr: u64,      // Auto-trigger threshold
    pub expires_at: u64,
}
```

**Features**:
- Buy coverage for your vault
- Trade insurance on secondary markets
- Auto-trigger when ICR drops below threshold
- Premium based on coverage, duration, trigger level

**Why It's Novel**: First DeFi insurance as transferable NFT charms.

### Comparison vs Existing Solutions

| Feature | MakerDAI | Liquity | Mezo | **zkUSD** |
|---------|----------|---------|------|-----------|
| Native to Bitcoin | ❌ | ❌ | ✅ | ✅ |
| UTXO-based | ❌ | ❌ | ❌ | ✅ |
| Flash mints | ✅ (callbacks) | ❌ | ❌ | ✅ (atomic) |
| Atomic rescue | ❌ | ❌ | ❌ | ✅ **NEW** |
| Insurance NFTs | ❌ | ❌ | ❌ | ✅ **NEW** |
| No re-entrancy risk | ❌ | ❌ | ❌ | ✅ |

---

## 🏗️ Technical Architecture

### Charms SDK Integration Pattern

```
zkUSD Protocol on Bitcoin (via Charms)
├── contracts/                  # Charms Apps (Rust → WASM → ZK)
│   ├── price-oracle/          # BTC/USD price feed (NFT state)
│   │   └── src/charms.rs      # ⭐ Charms SDK integration
│   ├── zkusd-token/           # Fungible + controller NFT
│   │   └── src/charms.rs      # ⭐ Dual-tag pattern
│   ├── vault-manager/         # CDP management (NFT per vault)
│   │   └── src/charms.rs      # ⭐ Multi-charm coordination
│   ├── stability-pool/        # Liquidation pool (NFT state)
│   │   └── src/charms.rs      # ⭐ Deposit tracking
│   └── common/                # UTXO-native operations
│       ├── src/charms_ops.rs  # 🚀 Flash mints, Rescue, Insurance
│       └── src/math.rs        # Safe math, ICR/TCR calculations
│
├── packages/sdk/              # TypeScript Charms Client
│   ├── src/spell-builder.ts   # ⭐ YAML spell generator
│   └── src/services/
│       └── prover.ts          # ZK proof generation
│
└── apps/web/                  # Production UI
    ├── src/components/        # Vault management, Pool UI
    └── src/hooks/             # Charms transaction hooks
```

### Cross-Contract Validation

All 4 contracts validate atomically in a single Bitcoin transaction:

```rust
// Vault operation flow
TX validates across 4 apps:
1. VaultManager.charms.rs → Validates vault parameters
2. Token.charms.rs → Authorizes zkUSD mint
3. Oracle.charms.rs → Provides BTC/USD price
4. StabilityPool.charms.rs → Updates total system debt

All in ONE Bitcoin transaction with ZK proof!
```

### UTXO-Native Advantages

**No Global State**:
- Each vault = independent UTXO
- Parallel processing possible
- No state contention

**Atomic Operations**:
- All or nothing by design
- No partial state corruption
- No re-entrancy attacks

**Client-Side Validation**:
- Users verify their own state
- No need to trust indexers
- Privacy-preserving

---

## 🌍 Ecosystem Contribution

zkUSD is positioned to **contribute battle-tested primitives to the Charms ecosystem**, similar to how OpenZeppelin standardized Ethereum development.

**Current State**:
- ✅ Official Charms SDK exists
- ❌ No DeFi primitives library (gap we can fill)
- ❌ No standardized CDP/lending patterns

**Our Contribution** (`charms-std/` directory):

```
charms-std/
├── primitives/
│   └── flash_mint.rs         ✅ UTXO-native flash mints
├── defi/
│   ├── cdp/                  ✅ From zkUSD VaultManager
│   ├── lending/              ✅ From StabilityPool
│   └── advanced/
│       ├── atomic_rescue.rs  🚀 Novel: Permission-less rescue
│       └── insurance_nft.rs  🚀 Novel: Tradable insurance
└── README.md                 ✅ Vision and roadmap
```

**Next Steps**:
1. Submit CHIP (Charms Improvement Proposal) to CharmsDev/charms
2. Extract and generalize zkUSD patterns
3. Collaborate with Charms team on standardization
4. Position zkUSD as reference DeFi implementation

This would make zkUSD the **first production DeFi protocol** to contribute reusable patterns to Charms.

---

## 📊 Live Deployment Evidence

**All contracts deployed on Bitcoin Testnet4**:

| Contract | App ID | Deployment Block | Status |
|----------|--------|------------------|---------|
| Price Oracle | `8aa4f505...991b1ef2` | 113548 | ✅ Live |
| zkUSD Token | `a6b3570c...72455c82` | 113548+ | ✅ Live |
| Vault Manager | `3ce7c8f6...1cf878d0` | 113548+ | ✅ Live |
| Stability Pool | `c11c5451...f8a067bf` | 113548+ | ✅ Live |

**Full Details**: See `spells/DEPLOYMENT_STATUS.md` for complete transaction IDs and verification keys.

---

## 🎓 Use Case: Solving Real Problems

**Target Users**: BTC holders who want liquidity without selling or trusting intermediaries

**Problem Solved**:
1. ❌ **Old Way**: Sell BTC → Lose upside exposure, taxable event
2. ❌ **Bridge Solutions**: Trust custodians, wrapped BTC risk
3. ✅ **zkUSD**: Native Bitcoin, keep your BTC, mint stablecoins

**Real-World Scenarios**:
- **Hodler Liquidity**: Access cash flow without selling BTC
- **DeFi Leverage**: Use flash mints for position management
- **Risk Management**: Buy insurance charms for peace of mind
- **Yield Farming**: Earn BTC rewards via Stability Pool

---

## 💡 What's Next

**Immediate** (Post-Hackathon):
- UI integration for flash mints, atomic rescue, insurance charms
- Redemption mechanism (exchange zkUSD for BTC at face value)
- Submit CHIP to contribute primitives to Charms ecosystem

**Future Vision**:
- Analytics dashboard with vault health monitoring
- Liquidation bot infrastructure
- Cross-chain expansion (Cardano, Dogecoin via Charms)
- AMM integration for zkUSD liquidity
- Become maintainers of Charms DeFi primitives

---

## 🔧 Tech Stack

**Smart Contracts**:
- Rust → WASM32-WASIP1 (Charms runtime)
- charms-sdk, charms-data from BitcoinOS
- Borsh/Serde for serialization

**Frontend**:
- Next.js 15 + React 19
- TailwindCSS
- Zustand (persistent state)
- Wallet: Unisat, Xverse

**SDK & Tooling**:
- TypeScript
- Custom Charms client for spell building
- ZK proof generation service
- Vitest for testing

---

## 📚 Documentation

- **Main README**: Comprehensive project overview
- **DEPLOYMENT_STATUS.md**: Live contract details
- **TRANSACTION_FLOW_ANALYSIS.md**: Complete UX flow
- **charms-std/**: Ecosystem contribution strategy
- **Code Comments**: Extensive inline documentation

---

## 🏆 Why zkUSD Should Win

1. **Complete Implementation**: 4 deployed contracts, working UI, full feature set
2. **Novel Innovations**: Flash mints, atomic rescue, insurance NFTs - all new to UTXO DeFi
3. **Ecosystem Impact**: First to propose DeFi standards library for Charms
4. **Production Ready**: Battle-tested patterns, comprehensive docs, real deployment
5. **Real Use Case**: Solves genuine problem for BTC holders
6. **Technical Excellence**: Deep Charms integration, ZK proofs, cross-app validation

zkUSD isn't just a hackathon project - it's the **foundation for DeFi on Bitcoin** via Charms.

---

## 👥 Team

**Ande** (Leader) - Full-stack development, Charms integration, architecture

---

## 📄 License

MIT - Open source for the ecosystem

---

**Built with ❤️ for the Charms Ecosystem**

*Demonstrating that Bitcoin can be the foundation for sophisticated DeFi applications through programmable assets.*
