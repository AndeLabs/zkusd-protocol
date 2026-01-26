# zkUSD - Bitcoin-Native Stablecoin

## The Pitch (Demo Day - BitcoinOS/Charms Hackathon)

---

## THE PROBLEM

### Bitcoin Holders Are Stuck

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   You own 1 BTC ($100,000)                                      │
│                                                                 │
│   You need $10,000 for an emergency                             │
│                                                                 │
│   Your options today:                                           │
│                                                                 │
│   ❌ SELL BTC     → Lose future upside, taxable event           │
│   ❌ CEX LOAN     → KYC, counterparty risk (FTX, Celsius)       │
│   ❌ WBTC + DeFi  → Bridge hacks ($2B+ lost), not your BTC      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**$1.7 TRILLION** in Bitcoin sits idle because there's no trustless way to borrow against it.

---

## THE SOLUTION

### zkUSD: Borrow Against Your BTC Without Leaving Bitcoin

```
   DEPOSIT BTC  ──────►  MINT zkUSD  ──────►  USE ANYWHERE

   Your BTC stays        Get stablecoins      Pay bills, invest,
   on Bitcoin L1         instantly            or just hold

   ✓ No bridges    ✓ No wrapped tokens    ✓ No custodians
```

---

## WHAT WE BUILT

### 4 Smart Contracts Deployed on Bitcoin Testnet4

```
┌─────────────────────────────────────────────────────────────────┐
│                    zkUSD PROTOCOL ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐    │
│   │   PRICE     │      │   VAULT     │      │   zkUSD     │    │
│   │   ORACLE    │◄────►│   MANAGER   │◄────►│   TOKEN     │    │
│   │             │      │    (CDP)    │      │             │    │
│   └─────────────┘      └──────┬──────┘      └─────────────┘    │
│                               │                                 │
│                               ▼                                 │
│                        ┌─────────────┐                          │
│                        │  STABILITY  │                          │
│                        │    POOL     │                          │
│                        └─────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Live on Testnet4

| Contract | App ID | Status |
|----------|--------|--------|
| **Price Oracle** | `26186d7c...` | ✅ Confirmed |
| **zkUSD Token** | `7ff62ba4...` | ✅ Confirmed |
| **Vault Manager** | `69035cf2...` | ✅ Deployed |
| **Stability Pool** | `b9412ca5...` | ✅ Confirmed |

**View on Explorer:** https://mempool.space/testnet4

---

## TECHNICAL INNOVATIONS

### 1. UTXO-Native Flash Minting (First on Bitcoin!)

```
┌─────────────────────────────────────────────────────────────────┐
│              ETHEREUM vs BITCOIN FLASH LOANS                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ETHEREUM (Complex):              BITCOIN/zkUSD (Simple):      │
│   ───────────────────              ────────────────────         │
│   flashLoan() {                    Spell {                      │
│     mint(amount);                    inputs: [utxo1, utxo2]     │
│     callback.execute(); ← RISK!      outputs: [utxo3, utxo4]   │
│     burn(amount + fee);              // Atomic by design!       │
│   }                                }                            │
│                                                                 │
│   ❌ Re-entrancy attacks           ✅ Impossible by design      │
│   ❌ Callback exploits             ✅ Single validation pass    │
│   ❌ Complex state management      ✅ UTXO atomicity             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why it matters:** Flash loans on Ethereum have been exploited for $100M+. Our UTXO design makes these attacks **mathematically impossible**.

---

### 2. Atomic Vault Rescue

```rust
// Third party can rescue a distressed vault in ONE atomic transaction
pub struct SpellRescue {
    vault_id: VaultId,           // Vault being rescued
    rescuer: Address,            // Who provides the funds
    collateral_to_add: u64,      // BTC being added
    debt_to_repay: u64,          // zkUSD being repaid
    min_icr_after: u64,          // Minimum health after rescue
}
```

**Innovation:** Unlike Ethereum where rescue requires multiple transactions (and can be front-run), on zkUSD it's **one atomic spell**.

---

### 3. Insurance Charms (Tradeable Protection NFTs)

```
┌─────────────────────────────────────────────────────────────────┐
│                     INSURANCE CHARM                             │
├─────────────────────────────────────────────────────────────────┤
│   charm_id: 0xabc123...                                         │
│   vault_id: 0xdef456...        ← Protects this vault            │
│   coverage: 0.1 BTC            ← Injects this much collateral   │
│   trigger_icr: 115%            ← Activates at this ratio        │
│   expires: block 150000                                         │
│   owner: tb1q...               ← Can be traded/sold!            │
└─────────────────────────────────────────────────────────────────┘
```

**Innovation:** First implementation of **tradeable liquidation protection** as Bitcoin-native NFTs.

---

### 4. Stability Pool (Liquity-Style on Bitcoin)

```
┌─────────────────────────────────────────────────────────────────┐
│                    STABILITY POOL FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Users deposit zkUSD    Underwater vaults    Depositors get    │
│   to earn rewards        get liquidated       discounted BTC    │
│         │                      │                    │           │
│         ▼                      ▼                    ▼           │
│   ┌──────────┐           ┌──────────┐         ┌──────────┐     │
│   │  zkUSD   │  ──────►  │  ABSORB  │  ─────► │   BTC    │     │
│   │ Deposits │           │  DEBT    │         │ Rewards  │     │
│   └──────────┘           └──────────┘         └──────────┘     │
│                                                                 │
│   State tracked with P (product) and S (sum) accumulators       │
│   Efficient O(1) reward calculation for any depositor           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 5. Client-Side Validation (Privacy by Default)

```
┌─────────────────────────────────────────────────────────────────┐
│           ETHEREUM vs zkUSD PRIVACY MODEL                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ETHEREUM:                        zkUSD (Charms):              │
│   ─────────                        ───────────────              │
│   Everyone sees:                   Only YOU see:                │
│   • Your balance                   • Your vault details         │
│   • Your transactions              • Your collateral amount     │
│   • Your liquidation risk          • Your debt level            │
│                                                                 │
│   Validators execute code          YOU generate ZK proof        │
│   on public state                  Blockchain only sees proof   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## TECHNOLOGY STACK

### Charms Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                     HOW CHARMS WORKS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Write smart contract in Rust                               │
│   2. Compile to WASM                                            │
│   3. User executes WASM locally                                 │
│   4. Generate ZK proof of correct execution                     │
│   5. Attach proof to Bitcoin transaction                        │
│   6. Anyone can verify the proof (without executing)            │
│                                                                 │
│   Result: Smart contract logic + Bitcoin security               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Our Stack

| Layer | Technology |
|-------|------------|
| **Blockchain** | Bitcoin L1 (Testnet4) |
| **Smart Contracts** | Rust → WASM |
| **Validation** | Charms Protocol v0.11.1 |
| **ZK Proofs** | SP1 zkVM (Succinct) |
| **Frontend** | Next.js + TypeScript |
| **Wallet Integration** | UniSat, Xverse, Leather |

---

## HOW TO SEE IT WORKING

### 1. View Deployed Contracts on Mempool

**Stability Pool (Confirmed):**
```
https://mempool.space/testnet4/tx/678046c4a16e1dfd4cc7686c30f2c6fbda3350ce21380611c23aba922013bb30
```

**Vault Manager (Deployed):**
```
https://mempool.space/testnet4/tx/df985065ba8d477b432dac31a25e47b587c6a56d4a28f5213e0b458eb6b7f322
```

### 2. Run the Web App

```bash
git clone https://github.com/[your-repo]/zkusd
cd zkusd/apps/web
pnpm install
pnpm dev
# Open http://localhost:3000
```

### 3. Open a Vault (Demo Flow)

```
1. Connect Bitcoin wallet (or use Demo Mode)
2. Enter collateral amount (e.g., 0.01 BTC)
3. Enter debt amount (e.g., 500 zkUSD)
4. App calculates ICR (must be > 110%)
5. Sign transaction with wallet
6. ZK proof generated client-side
7. Transaction broadcast to Bitcoin
8. Receive zkUSD stablecoins!
```

---

## COMPARISON

| Feature | zkUSD | WBTC+MakerDAO | Liquid | Lightning |
|---------|-------|---------------|--------|-----------|
| **Chain** | Bitcoin L1 | Ethereum | Sidechain | L2 Channels |
| **Bridge Risk** | None | High | Medium | Low |
| **Stablecoin** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Privacy** | ✅ Client-side | ❌ Public | ❌ Public | ✅ Private |
| **Trustless** | ✅ ZK Proofs | ❌ Validators | ❌ Federation | ⚠️ Channels |

---

## PROS & CONS

### PROS
✅ **True Bitcoin-native** - No bridges, no wrapping
✅ **Self-custody** - Your keys, your BTC, always
✅ **Privacy** - Client-side validation
✅ **Novel features** - Flash minting, atomic rescue, insurance charms
✅ **Battle-tested model** - Based on Liquity (works on Ethereum)

### CONS
⚠️ **New technology** - Charms launched 2024
⚠️ **Testnet phase** - Not yet audited for mainnet
⚠️ **Client computation** - ZK proofs take ~30s to generate
⚠️ **Ecosystem size** - Bitcoin DeFi is nascent

---

## ONE-LINER

> **"zkUSD: Borrow dollars against your Bitcoin. No bridges. No custodians. Just math."**

---

## DEMO CHECKLIST

- [ ] Show web app (localhost:3000)
- [ ] Show deployed contracts on mempool.space
- [ ] Explain the Spell YAML structure
- [ ] Demo opening a vault (demo mode)
- [ ] Show ZK proof generation
- [ ] Explain how Stability Pool works

---

## LINKS

- **Web App:** http://localhost:3000
- **Testnet Explorer:** https://mempool.space/testnet4
- **Charms Protocol:** https://charms.dev
- **Liquity (inspiration):** https://liquity.org

---

## Q&A PREP

**Q: How is this different from wrapped BTC?**
> WBTC requires trusting BitGo custodians. zkUSD uses ZK proofs - trustless math.

**Q: What if the ZK proof is wrong?**
> The proof is verified on-chain. Invalid proofs are rejected. Your BTC stays safe.

**Q: Can this be front-run?**
> UTXO model + atomic spells prevent front-running. Unlike Ethereum's mempool.

**Q: What's the interest rate?**
> One-time 0.5% fee. No ongoing interest. Same as Liquity.

**Q: When mainnet?**
> After security audit. We're building for real users, not just demos.
