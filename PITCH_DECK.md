# zkUSD Pitch - BitcoinOS/Charms Competition
**Demo Day: January 27, 2025 - 5:00 PM UTC**

---

## 3-MINUTE PITCH SCRIPT

### [0:00-0:30] THE PROBLEM (30 seconds)

"Bitcoin holders have a $1.9 trillion problem.

Sixty-two percent of all Bitcoin hasn't moved in over a year. That's over $1 trillion sitting dormant. Why? Because Bitcoin holders face an impossible choice:

1. **SELL** your Bitcoin to access liquidity - and lose your position in the best-performing asset of the decade
2. **WRAP** your Bitcoin through bridges - but we've seen $4 billion stolen in crypto hacks just in 2025 alone. The Bybit hack took $1.5 billion in a single attack.
3. **Trust centralized custodians** like WBTC - but in 2024, Justin Sun's involvement caused major protocols to consider dropping WBTC support. OKX delisted it entirely.

The result? 99.2% of Bitcoin sits outside DeFi."

---

### [0:30-1:30] THE SOLUTION: zkUSD (60 seconds)

"zkUSD solves this with the first **truly Bitcoin-native stablecoin**.

Built on the Charms protocol, zkUSD uses zero-knowledge proofs to enable smart contracts **directly on Bitcoin** - no bridges, no sidechains, no centralized custody.

**How it works:**
- Deposit BTC as collateral into a vault
- Mint zkUSD stablecoins against it
- Your Bitcoin never leaves Bitcoin's blockchain

**The technology:**
Charms uses recursive zkSNARKs - each transaction proof validates all previous transactions. This means:
- No indexers needed
- No centralized validators
- Every user can verify the entire protocol themselves
- Proof size: just a few hundred bytes

**The model:**
We use Liquity's battle-tested CDP design:
- 110% minimum collateral ratio (most capital efficient in DeFi)
- One-time borrowing fee (no ongoing interest)
- Stability Pool for instant liquidations
- Completely governance-free and immutable

Liquity handled $4.6 billion in peak TVL. It processed 93.5 million in liquidations during the May 2021 crash without any issues. Zero hacks in 4 years. We bring this proven model to Bitcoin."

---

### [1:30-2:30] DIFFERENTIATION & MARKET (60 seconds)

"**Why is zkUSD different from every other solution?**

| Solution | Trust Required | Risk |
|----------|---------------|------|
| WBTC/cbBTC | Centralized custody | Single point of failure |
| RSK/Stacks | Federated signers | Bridge exploits |
| tBTC | 51-of-100 threshold | Still off Bitcoin |
| **zkUSD** | **Math only** | **Bitcoin's security** |

With zkUSD, you trust mathematics and Bitcoin - nothing else.

**The market opportunity:**
- Bitcoin market cap: $1.9 trillion
- Currently in DeFi: only $6-8 billion (0.4%)
- Ethereum DeFi: $80+ billion

If Bitcoin DeFi reaches just 5% of Ethereum's level relative to market cap, that's a $100+ billion opportunity.

**Current competitors on Bitcoin:**
- RSK stablecoins: $13 million total TVL
- Stacks sBTC: Just launched, 15 institutional signers required
- No true Bitcoin-native stablecoin exists

zkUSD is first to market with a fully trustless, Bitcoin-native solution."

---

### [2:30-3:00] DEMO & CLOSE (30 seconds)

"Let me show you zkUSD in action.

[DEMO: Open vault, deposit BTC, mint zkUSD]

- Connect your Bitcoin wallet
- Deposit collateral
- Set your debt amount
- The ZK proof is generated client-side
- Transaction settles on Bitcoin

**What we're building:**
- Core protocol: Live on testnet4
- Full Liquity-style Stability Pool
- Price oracle integration
- Open source on GitHub

**The ask:**
We're looking for technical feedback, early users, and partners to bring the first truly Bitcoin-native stablecoin to mainnet.

zkUSD - Unlock your Bitcoin without leaving Bitcoin.

Thank you."

---

## KEY STATISTICS FOR SLIDES

### Slide 1: The Problem
- **$1.9 trillion** - Bitcoin market cap
- **62%** of BTC hasn't moved in 1+ year
- **$4 billion** stolen in crypto hacks (2025)
- **0.4%** of BTC is in DeFi

### Slide 2: Current Solutions Don't Work
- WBTC: Centralized custody, OKX delisted 2025
- Bridges: $2.8B+ stolen since 2022
- Celsius: $4.7 billion lost
- Mt. Gox: 850,000 BTC lost

### Slide 3: zkUSD Solution
- First Bitcoin-native stablecoin
- Zero bridges, zero custody
- Charms protocol + ZK proofs
- Liquity's proven CDP model

### Slide 4: How Charms Works
- Recursive zkSNARKs validate history
- Client-side verification
- No indexers needed
- Proof: ~few hundred bytes

### Slide 5: Liquity Model (Battle-Tested)
- **$4.6B** peak TVL
- **4 years** running
- **Zero hacks** on mainnet
- **110%** MCR (most efficient)
- **93.5M** processed in one liquidation event

### Slide 6: Market Opportunity
- BTCFi: $6-8B (grew 2,700% in 2024)
- ETH DeFi: $80B+
- Potential: $100B+ market
- Current Bitcoin stablecoins: <$15M TVL

### Slide 7: Competitive Advantage
| Feature | WBTC | sBTC | zkUSD |
|---------|------|------|-------|
| Custody | BitGo | 15 signers | None |
| Bridge | Yes | Yes | No |
| Native BTC | No | No | Yes |
| Trustless | No | No | Yes |

### Slide 8: Demo
[Live demo screenshots/video]

### Slide 9: Team & Progress
- Testnet live
- Smart contracts complete
- Open source
- Seeking: feedback, users, partners

---

## DETAILED RESEARCH FINDINGS

### 1. Bitcoin DeFi Market (BTCFi)

**Market Size:**
- Bitcoin market cap: ~$1.9 trillion
- BTCFi TVL: $6.2-8.6 billion (5% of total DeFi)
- Growth: 2,000-2,700% increase in 2024-2025
- Dormant BTC: 62% hasn't moved in 1+ year
- Only 0.8% of BTC is utilized in DeFi

**Key Competitors by TVL:**
| Protocol | TVL | Model |
|----------|-----|-------|
| Babylon | $4.79-5.32B | BTC staking |
| Solv Protocol | $1.96-2.45B | Yield |
| Lombard | $1.58-2.01B | LBTC on Babylon |
| tBTC | $785M | 51-of-100 threshold |
| Core Chain | $668M | Bitcoin L2 |
| Rootstock | $263M | EVM sidechain |
| Stacks | $208M | PoX sidechain |

**Bitcoin Stablecoins (Current):**
- DOC (RSK): $3.9M TVL
- DLLR (Sovryn): $3.6M TVL - Liquity fork
- XUSD: $2.2M TVL
- Total on RSK: ~$13M

### 2. Security Crisis (Pain Points)

**Hack Statistics:**
- 2025: $4.04 billion stolen (record year)
- Q1 2025: $1.64 billion (worst quarter ever)
- Bybit hack: $1.5 billion (largest single theft)
- North Korea: $2.02 billion stolen in 2025 alone

**Bridge Vulnerabilities:**
- MultiChain (2023): $125M+ lost
- Orbit Chain (2024): $81M lost
- Recovery rates declining: only $334M recovered in 2025

**Centralization Concerns:**
- WBTC: Justin Sun controversy, OKX delisted
- cbBTC: Single custodian (Coinbase)
- Celsius bankruptcy: $4.7B in assets
- Mt. Gox: 850,000 BTC lost

### 3. Liquity Protocol Success

**Performance:**
- Peak TVL: $4.6 billion
- Operating since: April 5, 2021 (4 years)
- Cumulative credit: $4+ billion issued
- First year revenue: $28+ million
- Zero mainnet hacks

**May 2021 Stress Test:**
- 93.5M LUSD debt liquidated
- 48,668 ETH distributed to Stability Pool
- 310 Troves liquidated
- System handled perfectly

**Key Features:**
- 110% MCR (most capital efficient)
- One-time fee (0.5-5%)
- No governance (immutable)
- Stability Pool for instant liquidations

### 4. Charms Protocol Technical

**Architecture:**
- Recursive zkSNARKs
- Client-side validation
- No indexers required
- Every user is their own validator

**How It Works:**
1. Spells = metadata on Bitcoin transactions
2. ZK proofs validate state transitions
3. Each proof covers entire history (recursive)
4. Proof size: few hundred bytes
5. Trust: math only, not validators

**Advantages:**
- No bridge = no bridge hacks
- No custody = no custodian risk
- Native Bitcoin security
- Fully decentralized

### 5. HODL Culture & User Psychology

**The Problem:**
- "Never sell your Bitcoin" culture
- 62% dormant for 1+ year
- Emotional attachment to holdings
- Fear of missing upside

**Pain Points:**
- Need liquidity without selling
- Tax events from selling
- Counterparty risk from bridges
- Complexity of current solutions

**zkUSD Solution:**
- Access USD without selling BTC
- No taxable disposal event
- Keep Bitcoin exposure
- Trustless and simple

---

## TALKING POINTS FOR Q&A

**"How is this different from WBTC?"**
WBTC requires trusting BitGo and BiT Global with custody. Your BTC leaves Bitcoin's blockchain. In 2024, Justin Sun's involvement caused MakerDAO and Aave to consider dropping support. With zkUSD, your BTC never leaves Bitcoin - we use ZK proofs for validation, not custodians.

**"What about RSK/Stacks stablecoins?"**
RSK uses a federated peg with merged mining. Stacks uses 15 institutional signers. Both require trusting validator sets. zkUSD uses recursive ZK proofs where every user validates the protocol themselves. No federation, no signers, just math.

**"Why Liquity model?"**
Liquity has a 4-year track record with $4.6B peak TVL and zero hacks. The 110% MCR makes it the most capital-efficient CDP system. The Stability Pool handled 93.5M in liquidations during the May 2021 crash seamlessly. It's governance-free and immutable - perfect for Bitcoin's ethos.

**"How do ZK proofs work here?"**
Charms uses recursive zkSNARKs. Each new transaction proof also validates all previous transactions. So you don't need to replay history - just verify the latest proof. This is generated client-side in the wallet. No centralized prover needed.

**"What's the timeline?"**
We're live on testnet4 with core functionality. Looking for technical feedback and early testers before mainnet deployment.

**"How does this compare to Babylon?"**
Babylon is for BTC staking yield. zkUSD is for accessing liquidity. They're complementary - you could potentially use staked BTC as collateral for zkUSD in the future. Babylon has massive scale ($5B TVL) but isn't building a stablecoin directly - their vault infrastructure is roadmap for future.

**"What about Mezo/MUSD?"**
Mezo is our closest competitor - also uses Liquity's CDP model with 110% MCR. They have $82M TVL and Pantera backing. The key difference: Mezo requires the tBTC bridge (51-of-100 threshold signers). With zkUSD, your BTC never leaves Bitcoin's blockchain. No bridge means no bridge attack surface.

**"Isn't Lombard/Solv already doing this?"**
Different products. Lombard ($3B) and Solv ($2.5B) are for earning yield on BTC while keeping BTC exposure. zkUSD is for accessing USD liquidity without selling BTC. They're BTC-pegged tokens; we're a USD-pegged stablecoin. Also: both require custody - we don't.

**"USDh on Stacks has 25% APY - why not use that?"**
USDh has only $3M TVL - very small. It runs on Stacks which requires 15 institutional signers. The high yields (18-25%) may not be sustainable long-term. zkUSD uses Bitcoin directly with ZK proofs - no signers, and Liquity's proven economics rather than experimental yield strategies.

**"What are your honest weaknesses?"**
We're building TVL from scratch while competitors have $82M-$5B head start. Charms ecosystem is still emerging. ZK proof generation needs client-side computation (wallet resources). We have less marketing budget than VC-backed competitors. But our trust model is stronger - we're the only truly trustless option.

---

## HONEST COMPETITIVE ANALYSIS

### Major Competitors Overview

| Protocol | TVL | Model | What They Do Well | Trust Required |
|----------|-----|-------|-------------------|----------------|
| **Babylon** | $5B+ | BTC Staking | Massive scale, trustless staking | Native (trustless) |
| **Lombard** | $3B | Liquid Staking | Best cross-chain, strong backers | Consortium custody |
| **Solv** | $2.5B | Reserve Token | 1M+ users, multiple yield strategies | Central reserve |
| **Mezo** | $82M | CDP Stablecoin | Good UX, Pantera backing | tBTC bridge + L2 |
| **satUSD** | $158M | Cross-chain CDP | Multi-chain from day one | Bridges |
| **USDh** | $3M | Synthetic Dollar | High yields (18-25%) | Stacks signers |

---

### 1. Mezo / MUSD (Closest Direct Competitor)

**What It Is:** Bitcoin L2 + stablecoin by Thesis (tBTC team)

**TVL:** $82 million | **Funding:** $21M from Pantera Capital

**How It Works:**
- CDP model with 110% MCR (same as us)
- Fixed-rate borrowing starting at 1%
- Uses tBTC bridge for BTC deposits
- Stability Pool like Liquity

**HONEST Pros (What They Do Well):**
- Strong institutional backing (Pantera, Multicoin, Draper)
- Good UX - "Cathedral" interface consolidates all DeFi actions
- Anchorage Digital partnership for institutional custody
- tBTC is battle-tested threshold bridge

**HONEST Cons (Their Weaknesses):**
- Still requires tBTC bridge (51-of-100 signers)
- BTC doesn't stay on Bitcoin blockchain
- L2 adds complexity and new trust assumptions
- Launched May 2025 - still young

**How zkUSD Differentiates:**
- zkUSD: BTC stays on Bitcoin (native UTXOs)
- zkUSD: No bridge required - eliminates bridge attack surface
- zkUSD: Only trust ZK proofs, not threshold signers

---

### 2. Babylon Protocol (Market Leader)

**What It Is:** Bitcoin staking infrastructure (largest BTCFi protocol)

**TVL:** $5+ billion (78% market share) | **Funding:** $15M from a16z

**How It Works:**
- Native BTC staking without wrapping
- BTC secures PoS chains via cryptographic locks
- ~1% APY in BABY tokens
- Building "Trustless Vaults" for DeFi collateral

**HONEST Pros:**
- Truly trustless - BTC never leaves Bitcoin
- Massive scale and institutional credibility
- a16z backing = serious validation
- Future Aave integration for BTC lending

**HONEST Cons:**
- Not a stablecoin - infrastructure layer only
- Low yields (~1% vs ETH staking 3-5%)
- Stablecoin capabilities are future roadmap, not live
- Complex technical implementation

**How zkUSD Differentiates:**
- zkUSD: End-user stablecoin product, not infrastructure
- zkUSD: Live now on testnet, not future roadmap
- Complementary: Could integrate with Babylon vaults later

---

### 3. Lombard Finance / LBTC

**What It Is:** Liquid staking for Bitcoin via Babylon

**TVL:** $3 billion | **Funding:** $17M from Polychain, Franklin Templeton

**How It Works:**
- Deposit BTC → Get LBTC (liquid, yield-bearing)
- LBTC works across 15+ chains
- Earns ~1% staking yield + DeFi yields
- Consortium custody model

**HONEST Pros:**
- Fastest growth in BTCFi (record $1B in 92 days)
- Strong security consortium (OKX, Galaxy, Kraken)
- Cross-chain native - excellent UX
- Franklin Templeton validation

**HONEST Cons:**
- Not a stablecoin (LBTC tracks BTC price, not USD)
- Custody required (14 major institutions)
- Modest base yields (~1%)
- Not Bitcoin-native - lives on other chains

**How zkUSD Differentiates:**
- zkUSD: USD-pegged (stable value), not BTC-pegged
- zkUSD: No custody required at all
- Different use case: Liquidity vs Yield

---

### 4. Solv Protocol / SolvBTC

**What It Is:** Bitcoin reserve and yield platform

**TVL:** $2.5 billion | **Users:** 1M+

**How It Works:**
- Deposit BTC → Get SolvBTC
- Multiple yield strategies (3-15% APR)
- Cross-chain reserve token
- Chainlink Proof of Reserve

**HONEST Pros:**
- Largest user base (1M+ indicates product-market fit)
- Binance backing and listing
- Multiple yield options
- Institutional deals (Zeta raised $230M using SolvBTC)

**HONEST Cons:**
- TVL manipulation allegations (January 2025)
- Custody required (Solv holds BTC)
- Not a stablecoin - tracks BTC
- Must trust central reserve

**How zkUSD Differentiates:**
- zkUSD: Full on-chain transparency (no central reserve)
- zkUSD: No custody - self-custody only
- zkUSD: USD-pegged for stable purchasing power

---

### 5. USDh (Hermetica) - Stacks Stablecoin

**What It Is:** Bitcoin-backed synthetic dollar on Stacks

**TVL:** $3 million | **Yield:** 18-25% APY

**How It Works:**
- Backed by Bitcoin reserves
- Delta-neutral strategies for yield
- Redeemable for $1 worth of BTC
- Built on Stacks L2

**HONEST Pros:**
- High yield potential (18-25%)
- First Bitcoin stablecoin on Stacks ecosystem
- Stays within Bitcoin ecosystem

**HONEST Cons:**
- Very small TVL ($3M)
- Stacks requires 15 institutional signers
- High yields may not be sustainable
- Limited to Stacks ecosystem

**How zkUSD Differentiates:**
- zkUSD: Native Bitcoin (not Stacks L2)
- zkUSD: No signers required (ZK proofs)
- zkUSD: Proven Liquity model vs experimental design

---

### 6. DAI (MakerDAO) via WBTC

**What It Is:** Ethereum's largest stablecoin, accepts WBTC as collateral

**Market Cap:** $5.4 billion

**HONEST Pros:**
- Battle-tested since 2017
- Wide ecosystem acceptance
- High collateralization (very safe)

**HONEST Cons:**
- Not Bitcoin-native (Ethereum)
- Requires trusting WBTC custody (BitGo)
- Lower capital efficiency (150%+ CR vs 110%)
- Complex governance

**How zkUSD Differentiates:**
- zkUSD: On Bitcoin, for Bitcoin holders
- zkUSD: No WBTC custody risk
- zkUSD: More capital efficient (110% MCR)

---

### Honest Self-Assessment: zkUSD Challenges

**What We're Still Building:**
- Building TVL from scratch (competitors have $82M-$5B head start)
- Charms ecosystem is still emerging
- ZK proof generation requires client-side computation
- Marketing and awareness vs well-funded competitors

**Our Honest Advantages:**
- Only protocol where BTC stays on Bitcoin blockchain
- Only protocol with zero custody requirements
- Proven Liquity model (not experimental)
- Most capital efficient (110% MCR)
- Governance-free and immutable

---

### Summary: Competitive Positioning

```
TRUST SPECTRUM:

Most Trusted                                    Least Trusted
(Math Only)                                     (Full Custody)
     |                                                |
  zkUSD     Babylon    Mezo/tBTC    Lombard    WBTC/cbBTC
     |         |           |            |           |
  ZK proofs  Native    51-of-100   Consortium  Single
   only      staking   threshold    custody    custodian
```

**Our Pitch in One Line:**
zkUSD is the only Bitcoin-native stablecoin where your BTC never leaves Bitcoin and you trust only mathematics - not signers, not custodians, not validators.

---

## SOURCES

- [Chainalysis 2025 Crypto Crime Report](https://www.chainalysis.com/)
- [DefiLlama TVL Data](https://defillama.com/)
- [Liquity Protocol Documentation](https://docs.liquity.org/)
- [Charms Whitepaper](https://docs.charms.dev/Charms-whitepaper.pdf)
- [Messari State of BTCFi Reports](https://messari.io/)
- [Glassnode On-Chain Analysis](https://glassnode.com/)
- [Mezo Documentation](https://mezo.org/blog/)
- [Babylon Labs](https://babylonlabs.io/)
- [Lombard Finance](https://www.lombard.finance/)
- [Solv Protocol](https://solv.finance/)
- [USDh on CoinDesk](https://www.coindesk.com/)
