# zkUSD Research & Technology Investigation

This document contains our research findings on the technologies enabling zkUSD on Bitcoin L1, the hackathon context, and the broader Bitcoin DeFi landscape.

> **Note**: zkUSD is focused on Bitcoin L1 with proto-rollup optimizations. L2 rollup is future research only.

---

## Table of Contents

1. [BitcoinOS Ecosystem](#bitcoinos-ecosystem)
2. [Charms Protocol](#charms-protocol)
3. [Zero-Knowledge Technologies](#zero-knowledge-technologies)
4. [Hackathon Details](#hackathon-details)
5. [Competitive Landscape](#competitive-landscape)
6. [Open Questions](#open-questions)

---

## BitcoinOS Ecosystem

### Overview

[BitcoinOS](https://bitcoinos.build) is a comprehensive infrastructure layer for Bitcoin that enables:

- **Programmability**: Smart contracts on Bitcoin without soft forks
- **Scalability**: L2 rollups with Bitcoin-level security
- **Interoperability**: Cross-chain communication via ZK proofs

### Core Components

#### 1. BitSNARK (ZK Verification on Bitcoin)

BitSNARK enables verifying any computation on Bitcoin's scripting language:

```
┌─────────────────────────────────────────────────────────────┐
│                       BitSNARK                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Traditional Bitcoin:                                        │
│  - Limited Script opcodes                                   │
│  - No loops, limited arithmetic                             │
│  - Cannot verify complex computations                       │
│                                                              │
│  With BitSNARK:                                             │
│  - Verify ANY computation                                   │
│  - Zero-knowledge proofs                                    │
│  - No Bitcoin changes required                              │
│                                                              │
│  How it works:                                              │
│  1. Computation happens off-chain                           │
│  2. ZK proof generated                                      │
│  3. Proof split into Bitcoin-sized chunks                   │
│  4. Verified across multiple Bitcoin transactions           │
│  5. Final result committed on-chain                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implications for zkUSD:**
- L2 state transitions can be verified on Bitcoin
- Trustless rollup without Bitcoin soft fork
- Same security model as Bitcoin L1

#### 2. GRAIL Bridge (Trustless BTC Transfers)

GRAIL enables moving BTC between L1 and L2/other chains without trusted parties:

```
┌─────────────────────────────────────────────────────────────┐
│                       GRAIL Bridge                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Traditional Bridges:                                        │
│  - Federated multisig (trusted parties)                     │
│  - Single point of failure                                  │
│  - $2B+ lost in bridge hacks                                │
│                                                              │
│  GRAIL:                                                     │
│  - Cryptographic verification                               │
│  - Challenge/dispute mechanism                              │
│  - No trusted federation                                    │
│  - Escape hatch to L1                                       │
│                                                              │
│  Flow:                                                      │
│  ┌────────┐    ┌────────────┐    ┌────────┐                │
│  │   L1   │───▶│   GRAIL    │───▶│   L2   │                │
│  │  Lock  │    │   Verify   │    │  Mint  │                │
│  └────────┘    └────────────┘    └────────┘                │
│                                                              │
│  Withdrawal:                                                │
│  ┌────────┐    ┌────────────┐    ┌────────┐                │
│  │   L2   │───▶│ Challenge  │───▶│   L1   │                │
│  │  Burn  │    │  Period    │    │ Unlock │                │
│  └────────┘    └────────────┘    └────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implications for zkUSD:**
- Users can deposit BTC to L2 trustlessly
- Withdraw to L1 with cryptographic guarantee
- No custodian risk

#### 3. MerkleMesh (Cross-Chain Aggregation)

MerkleMesh enables communication between multiple chains/rollups:

```
┌─────────────────────────────────────────────────────────────┐
│                      MerkleMesh                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│           ┌──────────┐                                      │
│           │ Bitcoin  │                                      │
│           │  (Root)  │                                      │
│           └────┬─────┘                                      │
│                │                                             │
│     ┌──────────┼──────────┐                                 │
│     │          │          │                                 │
│  ┌──▼──┐   ┌───▼───┐  ┌───▼───┐                            │
│  │ ETH │   │zkUSD  │  │Other  │                            │
│  │Rollup│   │Rollup │  │Rollups│                            │
│  └──────┘   └───────┘  └───────┘                            │
│                                                              │
│  Features:                                                  │
│  - Aggregate proofs from multiple chains                   │
│  - Single Bitcoin commitment for all                       │
│  - Cross-rollup messaging                                  │
│  - Unified security model                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implications for zkUSD:**
- zkUSD can be "beamed" to other chains
- Cross-chain liquidity without bridges
- Ethereum, Cardano, Solana interoperability

---

## Charms Protocol

### Overview

[Charms Protocol](https://charms.dev) is the programmable token layer for Bitcoin:

- **Version**: 0.10.0 (current)
- **Language**: Rust
- **zkVM**: SP1 from Succinct Labs (v4.0.1)

### Key Concepts

#### 1. Charms (Programmable Tokens)

```rust
// A charm is data attached to a Bitcoin UTXO
struct Charm {
    app: App,           // Which app validates this charm
    tag: CharmTag,      // Token type (t=fungible, n=NFT)
    data: CharmData,    // App-specific state
}

// Tags
enum CharmTag {
    Token,      // Fungible tokens (t)
    NFT,        // Non-fungible (n)
    // More tags available
}
```

#### 2. Spells (Transaction Transformations)

```yaml
# Example spell (YAML format)
version: 2
apps:
  - name: $ZKUSD_TOKEN
    vk: "7d1a06745a94adf1195fb9f2f987cb48..."
inputs:
  - txid: "abc123..."
    vout: 0
    charms:
      - app: $ZKUSD_TOKEN
        tag: t
        data: { owner: "...", amount: 1000 }
outputs:
  - charms:
      - app: $ZKUSD_TOKEN
        tag: t
        data: { owner: "...", amount: 600 }
  - charms:
      - app: $ZKUSD_TOKEN
        tag: t
        data: { owner: "...", amount: 400 }
```

#### 3. Apps (Validation Functions)

```rust
// Each app is a pure validation function
pub fn app_contract(
    app: &App,           // App identity
    tx: &Transaction,    // Transaction context
    x: &Data,            // Public inputs
    w: &Data,            // Witness (private)
) -> bool {
    // Return true if transformation is valid
}
```

### SDK Structure

```
charms-sdk/
├── charms-data/           # Data types
│   ├── App, Charm, CharmData
│   ├── Transaction, UTXO
│   └── Serialization (JSON, CBOR)
│
├── charms-sdk/            # Core SDK
│   ├── commit!() macro    # Commit proof outputs
│   ├── Transaction parsing
│   └── App lifecycle
│
└── charms-spell-checker/  # Validation
    └── Spell syntax checking
```

### Client-Side Validation

Unlike Ethereum, Charms uses client-side validation:

```
┌─────────────────────────────────────────────────────────────┐
│               Client-Side Validation Model                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Ethereum:                                                  │
│  ┌────────┐    ┌────────────┐    ┌────────┐                │
│  │  User  │───▶│  Miners    │───▶│ Global │                │
│  │ Submit │    │  Execute   │    │ State  │                │
│  └────────┘    └────────────┘    └────────┘                │
│                                                              │
│  Charms:                                                    │
│  ┌────────┐    ┌────────────┐    ┌────────┐                │
│  │  User  │───▶│  User      │───▶│  UTXO  │                │
│  │ Create │    │  Prove     │    │ Commit │                │
│  └────────┘    └────────────┘    └────────┘                │
│                                                              │
│  Benefits:                                                  │
│  - No indexer required                                      │
│  - Cryptographic verification                               │
│  - Parallel validation                                      │
│  - Privacy preserving (ZK)                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Zero-Knowledge Technologies

### SP1 zkVM

zkUSD uses [SP1](https://succinct.xyz) from Succinct Labs:

```
┌─────────────────────────────────────────────────────────────┐
│                         SP1 zkVM                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  What it is:                                                │
│  - Zero-knowledge virtual machine                           │
│  - Write code in Rust, generates ZK proofs                 │
│  - RISC-V based architecture                               │
│                                                              │
│  Current version: 4.0.1                                     │
│                                                              │
│  How zkUSD uses it:                                         │
│  1. Write validation logic in Rust                         │
│  2. SP1 compiles to provable circuit                       │
│  3. Each operation generates proof                         │
│  4. Proof attached to Bitcoin transaction                  │
│  5. Anyone can verify without re-executing                 │
│                                                              │
│  Proof sizes: ~100-500 KB (compressed)                     │
│  Verification: Constant time O(1)                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Proof Aggregation for L2

For the zkUSD Rollup, we'll aggregate proofs:

```
Individual Operations:
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ Op │ │ Op │ │ Op │ │ Op │ │ Op │
│  1 │ │  2 │ │  3 │ │... │ │ N  │
└──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘
   │      │      │      │      │
   └──────┴──────┼──────┴──────┘
                 │
                 ▼
         ┌──────────────┐
         │  Aggregated  │
         │    Proof     │
         │   (single)   │
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │   Bitcoin    │
         │ Transaction  │
         └──────────────┘

Cost reduction: 1000x (1000 ops → 1 Bitcoin tx)
```

---

## Hackathon Details

### Enchanting UTXO Hackathon

**Organizers**: Encode Club + BitcoinOS

**Timeline**:
- Start: December 8, 2025
- Duration: 4-7 weeks
- Judging: Late January 2026 (estimated)

**Prize Pool**:
- Up to $15,000 for best Charms project
- Additional prizes for specific categories

### Requirements

| Requirement | zkUSD Status |
|-------------|--------------|
| Uses Charms Protocol | Deployed |
| Builds on BitcoinOS | Integrated |
| Working Demo | Needs Frontend |
| Documentation | Complete |
| Innovation | UTXO-native Features |

### Our Submission Strategy

```
┌─────────────────────────────────────────────────────────────┐
│              zkUSD Hackathon Submission                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Strengths:                                                 │
│  ├─ Real deployed contracts (4 apps on testnet4)           │
│  ├─ Complex multi-app interactions                         │
│  ├─ UTXO-native innovations (flash mints, atomic rescue)   │
│  ├─ Clear L2 vision (scalability path)                     │
│  └─ Comprehensive documentation                            │
│                                                              │
│  To Complete:                                               │
│  ├─ [ ] Frontend UI (React/Next.js)                        │
│  ├─ [ ] Demo video                                         │
│  ├─ [ ] Open real vault (need faucet funds)                │
│  └─ [ ] Pitch presentation                                 │
│                                                              │
│  Differentiation:                                           │
│  ├─ Only CDP/stablecoin protocol                           │
│  ├─ Most complex Charms integration                        │
│  ├─ Clear production roadmap                               │
│  └─ Real Bitcoin DeFi utility                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Competitive Landscape

### Bitcoin Stablecoins

| Project | Type | Trust Model | Status |
|---------|------|-------------|--------|
| **zkUSD** | CDP (overcollateralized) | Trustless (ZK) | Testnet |
| USDT (Omni) | Fiat-backed | Centralized | Deprecated |
| Stably USD | Fiat-backed | Centralized | Active |
| DOC (RSK) | CDP | Sidechain | Active |
| sBTC | Synthetic | Federated | Proposed |

### Key Differentiators

```
┌─────────────────────────────────────────────────────────────┐
│                    zkUSD Advantages                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  vs. Fiat-backed (USDT, USDC):                              │
│  ├─ No counterparty risk                                    │
│  ├─ No bank account seizure                                 │
│  ├─ Permissionless                                          │
│  └─ Transparent collateralization                           │
│                                                              │
│  vs. Sidechain (RSK, Liquid):                               │
│  ├─ No federated multisig                                   │
│  ├─ Bitcoin-native security                                 │
│  ├─ ZK proofs vs. SPV                                       │
│  └─ UTXO model preserved                                    │
│                                                              │
│  vs. Ethereum CDPs (DAI, LUSD):                             │
│  ├─ Bitcoin collateral (not ETH)                            │
│  ├─ No bridge required                                      │
│  ├─ Atomic UTXO operations                                  │
│  └─ Flash mints without callbacks                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Market Opportunity

```
Total Bitcoin Market Cap: ~$1.5 trillion
Estimated "DeFi-able" BTC: ~10% = $150 billion

If zkUSD captures:
- 0.1% = $150 million TVL
- 1%   = $1.5 billion TVL
- 5%   = $7.5 billion TVL

For comparison:
- Liquity (ETH): $400M TVL
- MakerDAO: $8B TVL
```

---

## Open Questions

### Technical

1. **Proof Size Optimization**
   - Current: ~100-500 KB per operation
   - Target for L2: < 1 KB (aggregated)
   - Solution: Recursive proofs, batching

2. **Oracle Decentralization**
   - Current: Single operator
   - Future: Chainlink/DIA integration, or custom ZK oracle

3. **Sequencer Decentralization**
   - Phase 1: Centralized (faster iteration)
   - Phase 2: Decentralized set with staking

4. **Data Availability**
   - Option A: Bitcoin Inscriptions (expensive, fully on-chain)
   - Option B: Alternative DA layer (cheaper, different trust)

### Economic

1. **L2 Fee Model**
   - Sequencer compensation
   - Proof generation costs
   - Bitcoin settlement gas

2. **Incentive Alignment**
   - Sequencer honest behavior
   - Liquidator incentives at low MIN_DEBT
   - Stability Pool rewards

### Regulatory

1. **Stablecoin Regulations**
   - US: Unclear for decentralized stablecoins
   - EU: MiCA potentially applicable
   - Approach: Decentralized, non-custodial

---

## References

### Primary Sources

- [Charms Protocol Documentation](https://docs.charms.dev)
- [Charms Whitepaper](https://docs.charms.dev/Charms-whitepaper.pdf)
- [BitcoinOS Documentation](https://docs.bitcoinos.build)
- [SP1 zkVM](https://docs.succinct.xyz)
- [Encode Club Hackathons](https://www.encode.club)

### Inspiration

- [Liquity Protocol](https://www.liquity.org) - CDP mechanics, Stability Pool
- [MakerDAO](https://makerdao.com) - Multi-collateral design
- [crvUSD](https://curve.fi) - Soft liquidations (LLAMMA)

### Academic

- [Bitcoin: A Peer-to-Peer Electronic Cash System](https://bitcoin.org/bitcoin.pdf) - Nakamoto
- [Zerocash](https://zerocash-project.org/paper) - ZK on blockchain
- [Optimistic Rollups](https://ethereum.org/en/developers/docs/scaling/optimistic-rollups/)
- [ZK Rollups](https://ethereum.org/en/developers/docs/scaling/zk-rollups/)

---

## Research Log

### December 2025

**Week 1**: Project initialization
- Set up Charms SDK v0.10
- Designed contract architecture
- Implemented core types and math

**Week 2**: Contract development
- Implemented vault-manager
- Implemented zkusd-token
- Implemented stability-pool
- Implemented price-oracle

**Week 3**: Deployment
- Deployed all contracts to testnet4
- Verified 150+ confirmations
- Documented verification keys

**Week 4**: Documentation & Research
- Investigated BitcoinOS L2 stack
- Designed zkUSD Rollup architecture
- Created comprehensive documentation
- Prepared hackathon submission

---

<div align="center">

*Research is ongoing. This document will be updated as we learn more.*

[README](./README.md) | [Vision](./VISION.md) | [Architecture](./ARCHITECTURE.md)

</div>
