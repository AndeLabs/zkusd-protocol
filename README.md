# zkUSD Protocol

**Bitcoin-native stablecoin protocol powered by zero-knowledge proofs via Charms**

> 🏆 Built for the [Charms Hackathon](https://bitcoinos.build/) - demonstrating programmable assets on Bitcoin

## Overview

zkUSD is a **fully decentralized USD-pegged stablecoin** running natively on Bitcoin using the [Charms Protocol](https://charms.dev/) from BitcoinOS. Users can mint zkUSD by depositing BTC as collateral, creating Collateralized Debt Positions (CDPs) validated by zero-knowledge proofs.

### Why zkUSD on Charms?

Unlike traditional stablecoins that require bridges or custodians, zkUSD leverages Charms to bring **true programmable logic directly to Bitcoin**:

- ✅ **Native to Bitcoin**: No bridges, no wrapped tokens, no custodians
- ✅ **UTXO-Based**: Each vault is an individual UTXO with its own state
- ✅ **ZK-Verified**: All state transitions proven with recursive zero-knowledge proofs
- ✅ **Client-Side Validation**: Inspired by RGB protocol, validated locally
- ✅ **No Re-entrancy**: Inherently secure by UTXO design

## 🚀 Innovations: UTXO-Native DeFi Primitives

zkUSD introduces **novel DeFi primitives** that are only possible on UTXO chains with Charms:

### 1. ⚡ Flash Minting (No Callbacks Required)

Unlike Ethereum's flash loans which require callbacks, zkUSD's flash mints are **atomically validated in a single UTXO transaction**:

```rust
// contracts/common/src/charms_ops.rs
pub struct SpellFlashMint {
    pub mint_amount: u64,       // Amount to flash mint
    pub fee: u64,               // 0.05% fee
    pub purpose: FlashMintPurpose, // SelfLiquidation, Arbitrage, etc.
}
```

**Use cases**: Self-liquidation, arbitrage, collateral swaps, leverage adjustments
- **Min**: 100 zkUSD
- **Max**: 10M zkUSD per transaction
- **Fee**: 0.05% (5 bps)

### 2. 🛟 Atomic Vault Rescue

Third parties can **rescue underwater vaults without owner permission** in a single atomic transaction:

```rust
// contracts/common/src/charms_ops.rs
pub struct SpellRescue {
    pub vault_id: VaultId,
    pub collateral_to_add: u64,
    pub debt_to_repay: u64,
    pub rescuer_discount: u64,  // Max 5% of added collateral
}
```

**How it works**:
1. Rescuer provides collateral + debt repayment
2. Vault ICR improves above MCR
3. Rescuer receives discount (up to 5%) as incentive
4. All in one UTXO transaction - no signatures needed from vault owner

### 3. 🛡️ Insurance Charms (Tradable NFTs)

Protection against liquidation as **tradable NFT charms**:

```rust
pub struct SpellInsurance {
    pub charm_id: [u8; 32],
    pub coverage_btc: u64,
    pub trigger_icr: u64,  // Auto-triggers when ICR falls below this
    pub expires_at: u64,
}
```

**Features**:
- Buy insurance coverage for your vault
- **Trade** insurance charms on secondary markets
- **Auto-trigger** when ICR drops below threshold
- Premium based on coverage amount, duration, and trigger level

## Core Features

- **Collateralized Debt Positions (CDPs)**: Deposit BTC, mint zkUSD with 110% minimum ratio
- **Stability Pool**: Earn BTC rewards by providing zkUSD liquidity for liquidations
- **Redemptions**: Exchange zkUSD for BTC at face value (0.75% fee)
- **Recovery Mode**: System-wide protection when Total CR < 150%
- **Batch Liquidations**: Liquidate multiple underwater vaults in one transaction

## 🏗️ Architecture: Charms SDK Integration

zkUSD demonstrates **complete Charms Protocol integration** with 4 interconnected charms:

```
zkUSD Protocol on Bitcoin (via Charms)
├── contracts/                  # Charms Apps (Rust → WASM → ZK Circuits)
│   ├── price-oracle/          # 📊 BTC/USD price feed (NFT state)
│   │   ├── src/lib.rs         # Core validation logic
│   │   └── src/charms.rs      # Charms SDK integration ⭐
│   │
│   ├── zkusd-token/           # 💵 Fungible token with controller NFT
│   │   ├── src/lib.rs         # Token operations (Transfer/Mint/Burn)
│   │   └── src/charms.rs      # Fungible + NFT state pattern ⭐
│   │
│   ├── vault-manager/         # 🏦 CDP management (NFT per vault)
│   │   ├── src/lib.rs         # Vault operations
│   │   └── src/charms.rs      # Multi-charm coordination ⭐
│   │
│   ├── stability-pool/        # 🛡️ Liquidation pool (NFT state)
│   │   ├── src/lib.rs         # Pool mechanics
│   │   └── src/charms.rs      # Deposit tracking ⭐
│   │
│   └── common/                # Shared logic & UTXO-native ops
│       ├── src/charms_ops.rs  # 🚀 Flash mints, Atomic rescue, Insurance
│       ├── src/types.rs       # Vault, Pool, Token state types
│       ├── src/math.rs        # ICR/TCR calculations
│       └── src/liquidation.rs # Advanced liquidation logic
│
├── packages/sdk/              # TypeScript SDK (Charms Client)
│   ├── src/client.ts          # Main Charms client
│   ├── src/spell-builder.ts   # YAML spell generator ⭐
│   ├── src/vault.ts           # Vault operations
│   └── src/services/
│       ├── prover.ts          # ZK proof generation
│       └── bitcoin-api.ts     # UTXO/transaction queries
│
└── apps/web/                  # Production-ready UI
    ├── src/app/               # Next.js 15 routes
    ├── src/components/        # Vault management, Stability pool
    └── src/hooks/             # Charms transaction hooks
```

### How Charms Powers zkUSD

Each contract is a **Charms app** compiled to WASM and deployed on Bitcoin:

1. **App Reference Format**: `n/{app_id}/{vk}` (NFTs) or `t/{app_id}/{vk}` (Fungible tokens)
2. **State Storage**: UTXO charm data (validated by ZK proofs)
3. **Cross-App Calls**: Contracts reference each other via `app_id`
4. **Atomicity**: All ops in a single Bitcoin transaction (spell)

#### Essential Code: Charms Integration

```rust
// contracts/vault-manager/src/charms.rs:210
pub fn validate_vault_operation(
    app: &App,
    tx: &Transaction,
    _x: &Data,
    w: &Data,
) -> bool {
    // 1. Parse operation from witness
    // 2. Extract vault state from UTXO charm data
    // 3. Validate state transition
    // 4. Verify cross-app references (Token, Oracle, SP)
    // 5. Return true/false for ZK circuit
}
```

## 🎯 Charms Hackathon Compliance

zkUSD fully meets all hackathon requirements:

### ✅ SDK First: Comprehensive Charms SDK Integration

- **4 Charms Apps**: Price Oracle, Token, Vault Manager, Stability Pool
- **WASM Compilation**: All contracts compile to WASM for Charms runtime
- **ZK Proofs**: Every state transition generates and verifies ZK proofs
- **Cross-App Calls**: Apps reference each other using Charms `app_id` system

**Proof**: See `contracts/*/src/charms.rs` for SDK integration

### ✅ Working UI: Functional Front-End

- **Live Demo**: Deployed on Vercel with full wallet integration
- **Working Features**: Open vault, adjust vault, deposit to stability pool, view stats
- **Wallet Support**: Unisat and Xverse integration
- **Mobile Responsive**: 2025 best practices, touch-friendly design

**Proof**: See `apps/web/` and [TRANSACTION_FLOW_ANALYSIS.md](./TRANSACTION_FLOW_ANALYSIS.md)

### ✅ Core Feature Complete: End-to-End Implementation

**Completed Features**:
1. ✅ Vault creation with BTC collateral
2. ✅ zkUSD minting and burning
3. ✅ Liquidation mechanism via Stability Pool
4. ✅ Price oracle integration
5. ✅ Cross-contract state validation

**Advanced Features** (expansion ready):
- ⚡ Flash minting (implemented, ready for UI)
- 🛟 Atomic rescue (implemented, ready for UI)
- 🛡️ Insurance charms (implemented, ready for UI)

### 🌟 What Makes zkUSD Innovative?

**Compared to existing stablecoins**:

| Feature | MakerDAI | Liquity | Mezo | **zkUSD** |
|---------|----------|---------|------|-----------|
| Native to Bitcoin | ❌ | ❌ | ✅ | ✅ |
| UTXO-based | ❌ | ❌ | ❌ | ✅ |
| Flash mints | ✅ (callbacks) | ❌ | ❌ | ✅ (atomic) |
| Atomic rescue | ❌ | ❌ | ❌ | ✅ **NEW** |
| Insurance NFTs | ❌ | ❌ | ❌ | ✅ **NEW** |
| Client-side validation | ❌ | ❌ | ❌ | ✅ |
| No re-entrancy risk | ❌ | ❌ | ❌ | ✅ |

**Key Innovations**:

1. **UTXO-Native Flash Mints**: No callbacks needed - atomicity guaranteed by Bitcoin's UTXO model
2. **Permission-less Rescue**: Anyone can save an underwater vault and earn a fee
3. **Tradable Insurance**: First DeFi insurance as transferable NFT charms
4. **Composable Spells**: Complex multi-op transactions in single Bitcoin TX

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- Rust (for contract development)

### Installation

```bash
# Clone the repository
git clone https://github.com/AndeLabs/zkusd-protocol.git
cd zkusd-protocol

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Environment Variables

Create `.env.local` in `apps/web/`:

```env
NEXT_PUBLIC_NETWORK=testnet4
NEXT_PUBLIC_PROVER_URL=http://localhost:17784/spells  # Optional: local prover
```

## 📡 Deployed Contracts (Bitcoin Testnet4)

All contracts are **live on Bitcoin Testnet4** and fully functional:

| Contract | App ID | Type | Status |
|----------|--------|------|---------|
| **Price Oracle** | `8aa4f505...991b1ef2` | NFT State | ✅ Confirmed (Block 113548) |
| **zkUSD Token** | `a6b3570c...72455c82` | Fungible + State NFT | ✅ Confirmed |
| **Vault Manager** | `3ce7c8f6...1cf878d0` | NFT per Vault | ✅ Confirmed |
| **Stability Pool** | `c11c5451...f8a067bf` | NFT State | ✅ Confirmed |

**Live Deployment Details**: See [DEPLOYMENT_STATUS.md](./spells/DEPLOYMENT_STATUS.md) for full transaction IDs and verification keys.

### Cross-Contract Integration

```rust
// contracts demonstrate full Charms cross-app pattern:
Token.authorized_minter = VaultManager.VK
VaultManager.zkusd_token_id = Token.VK
VaultManager.price_oracle_id = Oracle.VK
StabilityPool.vault_manager_id = VaultManager.VK
```

## Protocol Parameters

| Parameter | Value |
|-----------|-------|
| Minimum Collateral Ratio | 110% |
| Critical Collateral Ratio | 150% |
| Minimum Debt | 10 zkUSD |
| Opening Fee | 0.5% + base rate |
| Liquidation Bonus | 0.5% |

## Development

```bash
# Run web app
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## 🔧 Tech Stack

### Smart Contracts (Charms Apps)
- **Language**: Rust
- **Target**: WASM32-WASIP1 (Charms runtime)
- **SDK**: `charms-sdk`, `charms-data` from BitcoinOS
- **Serialization**: Borsh, Serde (CBOR)
- **Dependencies**: SHA-256 for vault IDs, safe math operations

### Frontend
- **Framework**: Next.js 15, React 19
- **Styling**: TailwindCSS with fluid typography
- **State**: Zustand (persistent)
- **Wallet Integration**: Unisat, Xverse providers
- **Build**: Turborepo monorepo

### SDK & Tooling
- **Language**: TypeScript
- **Charms Client**: Custom SDK for spell building
- **Bitcoin API**: UTXO queries, transaction broadcasting
- **Prover**: ZK proof generation service
- **Testing**: Vitest

## 🎓 How It Works: Technical Deep Dive

### 1. Vault Creation (Open Vault)

```
User deposits 0.1 BTC → Mints 5000 zkUSD (at 180% CR)

Bitcoin Transaction:
├─ IN:  [0.1 BTC UTXO from user]
├─ OUT: [Vault NFT Charm] ← Contains vault state
│       - collateral: 0.1 BTC
│       - debt: 5000 zkUSD
│       - ICR: 180%
├─ OUT: [5000 zkUSD Fungible Charm] → User receives
└─ OUT: [BTC change] → User's remaining BTC

ZK Proof validates:
✓ ICR >= 110% (MCR)
✓ Debt >= 10 zkUSD (min debt)
✓ Opening fee calculated correctly
✓ VaultManager authorized to mint
```

### 2. Charms State Model

Each contract uses Charms' **dual-tag system**:

- **NFT (`n/` tag)**: Singleton state (vault, pool state, oracle)
- **Fungible (`t/` tag)**: Token amounts (zkUSD balances)

```rust
// Vault NFT charm data structure
pub struct Vault {
    pub id: VaultId,              // Deterministic from UTXO
    pub owner: Address,           // Pubkey hash
    pub collateral: u64,          // Satoshis
    pub debt: u64,                // zkUSD base units
    pub status: VaultStatus,      // Active/Liquidating/Closed
    pub interest_rate_bps: u64,   // Fixed rate
    pub accrued_interest: u64,    // Accumulated interest
    // ... redistribution fields
}
```

### 3. Cross-Contract Validation

When opening a vault, multiple charms validate atomically:

```
TX validates across 4 apps:
1. VaultManager.charms.rs → Checks vault params
2. Token.charms.rs → Authorizes mint
3. Oracle.charms.rs → Provides BTC price (via refs)
4. StabilityPool.charms.rs → Updates total debt

All validated in ONE Bitcoin transaction!
```

### 4. UTXO-Native Advantages

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

## 📚 Learn More

### Charms Protocol Resources
- [Charms Whitepaper](https://charms.dev/Charms-whitepaper.pdf)
- [BitcoinOS Technical Docs](https://docs.bitcoinos.build/technical-documentation/grail-pro-charms-zkbtc)
- [Charms Announcement](https://blog.bitcoinos.build/blog/bos-unveils-charms-the-universal-token-standard-for-bitcoin-and-utxo-blockchains)

### zkUSD Documentation
- [Deployment Status](./spells/DEPLOYMENT_STATUS.md) - Live contracts and operations
- [Transaction Flow Analysis](./TRANSACTION_FLOW_ANALYSIS.md) - Complete UX flow
- [Responsive Design](./RESPONSIVE_DESIGN.md) - UI implementation

## 🚀 Future Roadmap

**Phase 1** (Current):
- ✅ Core CDP system
- ✅ Stability Pool
- ✅ Liquidations
- ✅ Basic UI

**Phase 2** (Next):
- 🔄 Flash mint UI integration
- 🔄 Atomic rescue interface
- 🔄 Insurance charm marketplace
- 🔄 Redemption mechanism

**Phase 3** (Future):
- 📊 Analytics dashboard
- 🤖 Liquidation bots
- 🌉 Cross-chain bridges (Cardano, Dogecoin via Charms)
- 💱 AMM integration

## 🤝 Contributing

zkUSD is open source and welcomes contributions!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT - See [LICENSE](./LICENSE) file for details

---

**Built with ❤️ for the Charms Ecosystem**

*Demonstrating that Bitcoin can be a foundation for sophisticated DeFi applications through programmable assets.*
