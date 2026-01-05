# zkUSD Protocol - Charms Hackathon Submission

**Team:** AndeLabs
**Project:** zkUSD - Bitcoin-Native Stablecoin Protocol
**Date:** January 5, 2026

---

## 📝 SUBMISSION DESCRIPTION

zkUSD is a fully decentralized USD-pegged stablecoin protocol running natively on Bitcoin using the Charms Protocol from BitcoinOS. It demonstrates how programmable assets can bring sophisticated DeFi primitives to Bitcoin without bridges, custodians, or leaving Bitcoin's security model.

### What We Built

A complete Collateralized Debt Position (CDP) system with **four interconnected Charms applications** deployed live on Bitcoin Testnet4:

1. **Price Oracle** (NFT state charm) - BTC/USD price feed
2. **zkUSD Token** (Fungible + controller NFT) - USD-pegged stablecoin
3. **Vault Manager** (NFT per vault) - CDP creation and management
4. **Stability Pool** (NFT state) - Liquidation mechanism for underwater vaults

**Live Contracts on Bitcoin Testnet4:**
- Price Oracle: Block 113548, TX: `e4aeedcc32c72a2e09e29744b7ab5c10224dca8a8a5374a98363b4ad9602b977`
- All contracts confirmed and functional (see [DEPLOYMENT_STATUS.md](./spells/DEPLOYMENT_STATUS.md))

### Why This Matters

zkUSD pioneered **UTXO-native DeFi primitives** that are impossible on EVM chains:

#### 🚀 Innovation 1: Atomic Flash Mints (No Callbacks)
Unlike Ethereum's flash loans that require callbacks, zkUSD's flash mints are atomically validated in a single UTXO transaction. Users can borrow up to 10M zkUSD, perform arbitrage/liquidations, and repay within one Bitcoin transaction - all validated by zero-knowledge proofs.

```rust
// contracts/common/src/charms_ops.rs:30-36
pub struct SpellFlashMint {
    pub mint_amount: u64,       // Amount to flash mint
    pub fee: u64,               // 0.05% fee (5 bps)
    pub purpose: FlashMintPurpose, // SelfLiquidation, Arbitrage, etc.
}
```

**Use cases:** Self-liquidation, arbitrage, collateral swaps, leverage adjustments
**Constraints:** 100 zkUSD minimum, 10M zkUSD maximum, 0.05% fee

#### 🛟 Innovation 2: Atomic Vault Rescue
Third parties can rescue underwater vaults **without owner permission** in a single atomic transaction. This is only possible because of UTXO's parallel processing model:

```rust
// contracts/common/src/charms_ops.rs:49-55
pub struct SpellRescue {
    pub vault_id: VaultId,
    pub collateral_to_add: u64,
    pub debt_to_repay: u64,
    pub rescuer_discount: u64,  // Max 5% of added collateral
}
```

Rescuers provide collateral + debt repayment, improve the vault's ICR above MCR, and receive up to 5% discount as incentive - all in one transaction with no owner signature needed.

#### 🛡️ Innovation 3: Tradable Insurance NFTs
Protection against liquidation as **tradable NFT charms**. Insurance policies are transferable assets that can be bought, sold, and automatically triggered when a vault's ICR drops below a threshold.

```rust
// contracts/common/src/charms_ops.rs:68-73
pub struct SpellInsurance {
    pub charm_id: [u8; 32],
    pub coverage_btc: u64,
    pub trigger_icr: u64,  // Auto-triggers when ICR falls below
    pub expires_at: u64,
}
```

### Technical Implementation

**Charms SDK Integration:**
- All 4 contracts compile to WASM for Charms runtime
- ZK proofs generated and verified for every state transition
- Cross-app references using Charms `app_id` system
- Complete client-side validation following RGB protocol inspiration

**Frontend:**
- Production-ready Next.js 15 web app with wallet integration (Unisat, Xverse)
- Mobile-responsive design following 2025 best practices
- Real-time vault management, stability pool deposits, and protocol statistics
- TypeScript SDK for spell building and Bitcoin UTXO management

**Architecture:**
```
zkUSD Protocol on Bitcoin (via Charms)
├── contracts/              # 4 Charms Apps (Rust → WASM → ZK Circuits)
├── packages/sdk/           # TypeScript SDK (Charms Client)
└── apps/web/              # Production UI (Next.js 15)
```

### What Makes It Innovative?

Comparison with existing stablecoins:

| Feature | MakerDAI | Liquity | Mezo | **zkUSD** |
|---------|----------|---------|------|-----------|
| Native to Bitcoin | ❌ | ❌ | ✅ | ✅ |
| UTXO-based | ❌ | ❌ | ❌ | ✅ |
| Flash mints | ✅ (callbacks) | ❌ | ❌ | ✅ (atomic) |
| Atomic rescue | ❌ | ❌ | ❌ | ✅ **NEW** |
| Insurance NFTs | ❌ | ❌ | ❌ | ✅ **NEW** |
| No re-entrancy risk | ❌ | ❌ | ❌ | ✅ |

**Key Differentiators:**
1. **UTXO-Native Flash Mints**: Atomicity guaranteed by Bitcoin's UTXO model, no callbacks needed
2. **Permission-less Rescue**: Anyone can save an underwater vault and earn a fee
3. **Tradable Insurance**: First DeFi insurance as transferable NFT charms
4. **Composable Spells**: Complex multi-operation transactions in single Bitcoin TX

### Hackathon Requirements Compliance

✅ **SDK First:** Comprehensive Charms SDK integration
- 4 Charms Apps with full ZK proof validation
- Cross-app calls using Charms `app_id` system
- See `contracts/*/src/charms.rs` for SDK integration

✅ **Working UI:** Functional front-end with wallet support
- Live demo with vault management, stability pool, and stats
- Unisat and Xverse wallet integration
- Mobile-responsive design

✅ **Core Feature Complete:** End-to-end CDP implementation
- Vault creation with BTC collateral ✅
- zkUSD minting and burning ✅
- Liquidation via Stability Pool ✅
- Price oracle integration ✅
- Cross-contract state validation ✅

**Advanced features** (implemented, ready for UI expansion):
- ⚡ Flash minting (code complete)
- 🛟 Atomic rescue (code complete)
- 🛡️ Insurance charms (code complete)

### Real-World Use Case

**Target Users:** Bitcoin holders who want liquidity without selling or trusting intermediaries

**User Flow:**
1. User deposits 0.1 BTC as collateral
2. Mints 5,000 zkUSD (at 180% collateral ratio)
3. Uses zkUSD for trading, payments, or earning yield
4. BTC remains on Bitcoin L1, validated by ZK proofs
5. Repays debt anytime to reclaim collateral

**Problem Solved:** Provides liquidity to Bitcoin HODLers without:
- Selling BTC (no taxable event)
- Trusting custodians (non-custodial)
- Using bridges (no bridge risk)
- Leaving Bitcoin's security model

### Technical Stack

**Smart Contracts:**
- Language: Rust
- Target: WASM32-WASIP1 (Charms runtime)
- SDK: charms-sdk, charms-data from BitcoinOS
- Deployed on: Bitcoin Testnet4

**Frontend:**
- Framework: Next.js 15, React 19
- Styling: TailwindCSS with fluid typography
- State: Zustand (persistent)
- Wallet: Unisat, Xverse providers

**SDK & Tooling:**
- Language: TypeScript
- Features: Spell building, UTXO management, ZK proof generation

### Future Vision

**Ecosystem Contribution:**
We've created `charms-std/` - a library of reusable DeFi primitives for the Charms ecosystem, similar to OpenZeppelin for Ethereum. Our goal is to submit a CHIP (Charms Improvement Proposal) to make zkUSD's innovations available to all Charms developers.

**Roadmap:**
- Phase 1 (Current): Core CDP system ✅
- Phase 2 (Next): Flash mint UI, atomic rescue interface, insurance marketplace
- Phase 3 (Future): Analytics dashboard, liquidation bots, cross-chain bridges (Cardano, Dogecoin via Charms)

### Code Quality & Documentation

- **Comprehensive README:** Architecture diagrams, technical deep dives, quick start guide
- **Deployment Docs:** Complete transaction IDs, verification keys, operational flows
- **Transaction Analysis:** User experience flows with UTXO diagrams
- **Responsive Design:** Mobile-first implementation documentation
- **Code Comments:** Extensive inline documentation in contracts and SDK

### Why zkUSD Should Win

1. **Technical Excellence:** 4 interconnected Charms apps with full ZK proof validation
2. **Novel Innovations:** 3 new DeFi primitives impossible on other chains
3. **Production Ready:** Live contracts on Bitcoin, functional UI, comprehensive docs
4. **Ecosystem Impact:** First to contribute reusable DeFi patterns to Charms
5. **Real Utility:** Solves genuine problem for Bitcoin holders seeking liquidity

zkUSD demonstrates that Bitcoin can be a foundation for sophisticated DeFi applications through programmable assets, while staying true to Bitcoin's security and decentralization principles.

---

## 📊 Project Metrics

- **Lines of Code:** ~15,000+ (Rust contracts + TypeScript SDK + React UI)
- **Contracts Deployed:** 4 (all confirmed on Bitcoin Testnet4)
- **Documentation Files:** 5+ comprehensive guides
- **Test Coverage:** Unit tests for core math, vault operations, liquidation logic
- **Development Time:** 3+ weeks of intensive development

---

## 🔗 Links & Resources

**Code Repository:** https://github.com/AndeLabs/zkusd-protocol

**Key Files to Review:**
- Main README: `/README.md`
- Deployment Status: `/spells/DEPLOYMENT_STATUS.md`
- Transaction Flows: `/TRANSACTION_FLOW_ANALYSIS.md`
- Charms Integration: `/contracts/*/src/charms.rs`
- TypeScript SDK: `/packages/sdk/src/`
- Web UI: `/apps/web/src/`

**Bitcoin Testnet4 Transactions:**
- Price Oracle Deploy: `e4aeedcc32c72a2e09e29744b7ab5c10224dca8a8a5374a98363b4ad9602b977`
- Token Deploy: `4ec30b16e45b20341586e690f282314d24a5696dde50b80ef02905b1fae8713e`
- Vault Manager Deploy: `a6dfdfaa1834eca1203f871f535aa33d2d197518c485e1d7c6dac4ad1b55a7a9`
- Stability Pool Deploy: `ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c`

---

## 🎥 Demo Video Script

### Introduction (30 seconds)
"Hi, I'm from AndeLabs, and this is zkUSD - a Bitcoin-native stablecoin powered by Charms. Unlike other stablecoins that use bridges or custodians, zkUSD runs entirely on Bitcoin L1 using zero-knowledge proofs."

### Problem Statement (30 seconds)
"Bitcoin holders face a dilemma: to access liquidity, they must either sell their BTC (creating taxable events) or trust centralized custodians. zkUSD solves this by letting users mint USD-pegged stablecoins directly from their BTC collateral, all validated on Bitcoin."

### Technical Demo (2 minutes)
1. **Show Live Contracts:** "These are our 4 Charms contracts deployed on Bitcoin Testnet4 [show blockchain explorer]"
2. **UI Walkthrough:** "Here's our web interface [show vault creation flow]"
3. **Innovations Highlight:**
   - "Flash mints work atomically in one Bitcoin transaction - no callbacks needed"
   - "Atomic rescue lets anyone save underwater vaults for a fee"
   - "Insurance policies are tradable NFT charms"

### Architecture (1 minute)
"zkUSD demonstrates complete Charms SDK integration [show diagram]:
- 4 interconnected apps communicating via app_id references
- Every state transition generates ZK proofs
- UTXO-based design eliminates re-entrancy risks"

### Impact & Future (30 seconds)
"We're not just building a protocol - we're contributing reusable DeFi primitives to the Charms ecosystem. Our charms-std library will help future builders create sophisticated apps on Bitcoin."

### Call to Action (20 seconds)
"Check out our GitHub repo for full code, documentation, and try the live demo. zkUSD proves Bitcoin can be a foundation for sophisticated DeFi while staying true to its decentralization principles."

**Total Duration:** ~4.5 minutes

---

## ✅ Submission Checklist

- [x] Project Name: zkUSD Protocol
- [x] Project Description: Prepared above
- [x] Code Repository: https://github.com/AndeLabs/zkusd-protocol
- [ ] Demo Video: To be created (script above)
- [ ] Live Demo Link: Vercel deployment URL (to be verified)
- [ ] Presentation Deck: Optional (can create if needed)
- [ ] Project Image: Use zkUSD logo or architecture diagram

---

**Built with ❤️ for the Charms Ecosystem by AndeLabs**
