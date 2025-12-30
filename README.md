# zkUSD Protocol

Bitcoin-native stablecoin protocol powered by zero-knowledge proofs via Charms.

## Overview

zkUSD enables users to mint USD-pegged stablecoins by depositing BTC as collateral. The protocol uses ZK proofs to verify all state transitions on Bitcoin, ensuring trustless and decentralized operation.

## Features

- **Collateralized Debt Positions (CDPs)**: Deposit BTC, mint zkUSD
- **Minimum Collateral Ratio**: 110% (liquidation threshold)
- **Critical Collateral Ratio**: 150% (recovery mode threshold)
- **Stability Pool**: Earn liquidation rewards by depositing zkUSD
- **Redemptions**: Exchange zkUSD for BTC at face value

## Architecture

```
zkUSD Protocol
├── contracts/           # Charms smart contracts (Rust/WASM)
│   ├── price-oracle/    # BTC/USD price feed
│   ├── vault-manager/   # CDP management
│   ├── zkusd-token/     # Stablecoin token
│   └── stability-pool/  # Liquidation pool
├── packages/
│   ├── config/          # Network configuration
│   ├── sdk/             # TypeScript SDK
│   ├── types/           # Shared types
│   └── utils/           # Utility functions
└── apps/
    └── web/             # Next.js web application
```

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

## Deployed Contracts (Testnet4)

| Contract | App ID |
|----------|--------|
| Price Oracle | `26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5` |
| zkUSD Token | `eb6bae049ef366de081886f4f712be6e3eb991c92729aae4d9fab680a29ad540` |
| Vault Manager | `c1c47ab32a707f9fad3f57aa09c58020d0c5ce43f24ee5fd0c22be41114cd490` |
| Stability Pool | `c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf` |

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

## Tech Stack

- **Contracts**: Rust, WASM, Charms Protocol
- **Frontend**: Next.js 15, React 19, TailwindCSS
- **State**: Zustand
- **Build**: Turborepo, pnpm workspaces

## License

MIT
