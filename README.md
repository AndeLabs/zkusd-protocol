<![CDATA[# zkUSD Protocol

[![Bitcoin](https://img.shields.io/badge/Bitcoin-Testnet4-orange)](https://mempool.space/testnet4)
[![Charms](https://img.shields.io/badge/Charms-v8-blue)](https://charms.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

**Bitcoin-native stablecoin protocol powered by zero-knowledge proofs via Charms**

> Built for the [Charms Hackathon](https://bitcoinos.build/) - demonstrating programmable assets on Bitcoin

---

## Overview

zkUSD is a **fully decentralized USD-pegged stablecoin** running natively on Bitcoin using the [Charms Protocol](https://charms.dev/). Users mint zkUSD by depositing BTC as collateral, creating Collateralized Debt Positions (CDPs) validated by zero-knowledge proofs.

### Key Features

- **Native to Bitcoin** - No bridges, no wrapped tokens, no custodians
- **UTXO-Based** - Each vault is an individual UTXO with its own state
- **ZK-Verified** - All state transitions proven with recursive zero-knowledge proofs
- **Client-Side Validation** - Inspired by RGB protocol, validated locally

---

## Live Deployment (Testnet4)

All contracts are **deployed and operational** on Bitcoin Testnet4:

| Contract | App ID | Status |
|----------|--------|--------|
| **Price Oracle** | `26186d7c27bb2874...` | ✅ Live |
| **zkUSD Token** | `7ff62ba48cbb4e84...` | ✅ Live |
| **Stability Pool** | `001537495ecc1bc1...` | ✅ Live |
| **Vault Manager** | `ca8ab2dc30c97b7b...` | ✅ Live |

**Explorer Links:**
- [Token TX](https://mempool.space/testnet4/tx/6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988)
- [Stability Pool TX](https://mempool.space/testnet4/tx/20d41c6e5b4df501f6394392a56a534730bc84794da1f8adabe5dc6084ee560c)
- [Vault Manager TX](https://mempool.space/testnet4/tx/aac009d17665311d94ec0accf48aad8db6a06c54cc383bb8933c28eb92b03f02)

---

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

### Environment Setup

Create `.env.local` in `apps/web/`:

```env
NEXT_PUBLIC_NETWORK=testnet4
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_PROVER_URL=https://v8.charms.dev/spells/prove
```

---

## Architecture

```
zkUSD Protocol
├── contracts/                    # Charms Apps (Rust → WASM)
│   ├── price-oracle/            # BTC/USD price feed
│   ├── zkusd-token/             # Fungible stablecoin
│   ├── vault-manager/           # CDP management
│   ├── stability-pool/          # Liquidation pool
│   └── common/                  # Shared types & logic
│
├── packages/
│   ├── sdk/                     # TypeScript SDK
│   ├── config/                  # Network configurations
│   ├── types/                   # Shared types
│   └── utils/                   # Utilities
│
└── apps/web/                    # Next.js Frontend
```

### How Charms Powers zkUSD

Each contract is a **Charms app** compiled to WASM and deployed on Bitcoin:

1. **App Reference**: `n/{app_id}/{vk}` (NFTs) or `t/{app_id}/{vk}` (Fungible)
2. **State Storage**: UTXO charm data validated by ZK proofs
3. **Cross-App Calls**: Contracts reference each other via `app_id`
4. **Atomicity**: All operations in a single Bitcoin transaction (spell)

### Cross-Contract Integration

```
Token.authorized_minter     → VaultManager.app_id
VaultManager.zkusd_token_id → Token.app_id
VaultManager.oracle_id      → PriceOracle.app_id
StabilityPool.vm_id         → VaultManager.app_id
```

---

## Core Features

### Collateralized Debt Positions (CDPs)

- Deposit BTC as collateral
- Mint zkUSD with 110% minimum collateral ratio
- Adjust position anytime

### Stability Pool

- Earn BTC rewards by providing zkUSD liquidity
- Automatic liquidation processing
- Fair distribution of liquidation gains

### Liquidations

- Underwater vaults (< 110% CR) can be liquidated
- Stability Pool absorbs bad debt
- Liquidators receive collateral bonus

### Redemptions

- Exchange zkUSD for BTC at face value
- 0.5% minimum fee
- Redeems from riskiest vaults first

---

## Protocol Parameters

| Parameter | Value |
|-----------|-------|
| Minimum Collateral Ratio | 110% |
| Critical Collateral Ratio | 150% |
| Minimum Debt | 10 zkUSD |
| Opening Fee | 0.5% + base rate |
| Liquidation Bonus | 0.5% |
| Redemption Fee Floor | 0.5% |

---

## Development

### Commands

```bash
# Development
pnpm dev              # Start web app
pnpm build            # Build all packages
pnpm typecheck        # Type checking
pnpm lint             # Linting
pnpm test             # Run tests

# Contracts (requires Rust + Charms CLI)
cd contracts/vault-manager
charms app build      # Build WASM (uses wasm32-wasip1)
charms app vk <wasm>  # Get verification key
```

### Building Contracts

> **CRITICAL**: Always use `charms app build` - it uses the correct `wasm32-wasip1` target.

```bash
# Correct way
cd contracts/stability-pool
charms app build

# NEVER use (causes runtime errors)
cargo build --target wasm32-unknown-unknown
```

See [contracts/BUILDING.md](./contracts/BUILDING.md) for details.

---

## Tech Stack

### Smart Contracts
- **Language**: Rust
- **Target**: WASM32-WASIP1 (Charms runtime)
- **SDK**: `charms-sdk` v0.10+
- **Serialization**: Borsh, Serde CBOR

### Frontend
- **Framework**: Next.js 15, React 19
- **Styling**: TailwindCSS
- **State**: Zustand
- **Wallet**: Unisat, Xverse integration

### Infrastructure
- **Monorepo**: Turborepo + pnpm
- **Testing**: Vitest
- **Prover**: Charms ZK Prover API

---

## UTXO-Native Innovations

### Flash Minting (No Callbacks)

Unlike Ethereum flash loans, zkUSD flash mints are atomically validated in a single UTXO transaction:

```rust
pub struct FlashMint {
    pub amount: u64,      // Amount to mint
    pub fee: u64,         // 0.05% fee
    pub purpose: Purpose, // SelfLiquidation, Arbitrage, etc.
}
```

### Atomic Vault Rescue

Third parties can rescue underwater vaults without owner permission:

```rust
pub struct Rescue {
    pub vault_id: VaultId,
    pub collateral_to_add: u64,
    pub debt_to_repay: u64,
    pub rescuer_discount: u64, // Max 5%
}
```

### Insurance Charms (Tradable NFTs)

Liquidation protection as transferable NFT charms:

```rust
pub struct Insurance {
    pub coverage_btc: u64,
    pub trigger_icr: u64,   // Auto-triggers below this
    pub expires_at: u64,
}
```

---

## Comparison

| Feature | MakerDAO | Liquity | **zkUSD** |
|---------|----------|---------|-----------|
| Native Bitcoin | ❌ | ❌ | ✅ |
| UTXO-based | ❌ | ❌ | ✅ |
| Flash mints | ✅ (callbacks) | ❌ | ✅ (atomic) |
| Atomic rescue | ❌ | ❌ | ✅ |
| Insurance NFTs | ❌ | ❌ | ✅ |
| No re-entrancy | ❌ | ❌ | ✅ |

---

## Project Structure

```
.
├── apps/
│   └── web/                 # Next.js frontend
├── contracts/
│   ├── common/              # Shared Rust code
│   ├── price-oracle/        # Oracle contract
│   ├── stability-pool/      # Pool contract
│   ├── vault-manager/       # Vault contract
│   └── zkusd-token/         # Token contract
├── packages/
│   ├── config/              # Network configs
│   ├── sdk/                 # TypeScript SDK
│   ├── types/               # Shared types
│   └── utils/               # Utilities
├── deployments/
│   └── testnet4/            # Deployment configs
├── scripts/                 # Deployment scripts
└── spells/                  # Spell templates
```

---

## Resources

### Charms Protocol
- [Charms Whitepaper](https://charms.dev/Charms-whitepaper.pdf)
- [BitcoinOS Docs](https://docs.bitcoinos.build/)
- [Charms GitHub](https://github.com/CharmsDev/charms)

### zkUSD Documentation
- [Deployment Status](./docs/DEPLOYMENT-STATUS.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Build Guide](./contracts/BUILDING.md)

---

## Roadmap

**Phase 1 (Complete)**
- ✅ Core CDP system
- ✅ Stability Pool
- ✅ Liquidations
- ✅ Testnet deployment
- ✅ Web UI

**Phase 2 (Next)**
- 🔄 Flash mint UI
- 🔄 Atomic rescue interface
- 🔄 Insurance marketplace
- 🔄 Redemption mechanism

**Phase 3 (Future)**
- 📊 Analytics dashboard
- 🤖 Liquidation bots
- 🌉 Cross-chain (Cardano, Dogecoin via Charms)
- 💱 AMM integration

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

---

## License

MIT - See [LICENSE](./LICENSE)

---

**Built with ❤️ for the Charms Ecosystem**

*Demonstrating that Bitcoin can be a foundation for sophisticated DeFi applications through programmable assets.*
]]>