# zkUSD Architecture Guide

Based on [Charms Protocol Best Practices](https://docs.charms.dev/)

## Core Principle: No Traditional Backend Required

Charms uses **recursive zero-knowledge proofs** for client-side validation. This means:

- **No indexer needed**: Each client verifies state independently
- **No centralized database**: State lives on-chain in UTXOs
- **No trusted third parties**: Users are their own validators

> "You just need the transaction and its proof. Every user becomes their own validator."
> — [Charms Documentation](https://docs.charms.dev/concepts/why/)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        zkUSD Client                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Web UI    │  │   Wallet    │  │   Local State Store     │  │
│  │  (Next.js)  │  │  (UniSat)   │  │  (IndexedDB/localStorage)│ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│  ┌──────┴────────────────┴──────────────────────┴──────────────┐│
│  │                      zkUSD SDK                               ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  ││
│  │  │  Vault   │ │ Stability│ │  Oracle  │ │  Spell Builder │  ││
│  │  │ Service  │ │   Pool   │ │ Service  │ │                │  ││
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────┬────────┘  ││
│  │       └────────────┴────────────┴───────────────┘           ││
│  └──────────────────────────┬───────────────────────────────────┘│
└─────────────────────────────┼────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Bitcoin Node  │    │ Charms Prover │    │   Price APIs  │
│  (mempool.space)│  │ (v8.charms.dev)│   │  (CoinGecko)  │
└───────────────┘    └───────────────┘    └───────────────┘
```

## State Management Strategy

### 1. On-Chain State (Source of Truth)
Vault and token state is stored in Charms outputs:
```
UTXO (txid:vout) → Contains:
  - Vault NFT charm with state
  - zkUSD token charm with amount
  - ZK proof in witness
```

### 2. Client-Side Cache (Local State)
Users track their vault UTXOs locally:
```typescript
interface TrackedVault {
  id: string;           // Vault ID (deterministic from genesis UTXO)
  utxo: string;         // Current UTXO (txid:vout)
  collateral: bigint;   // Last known collateral
  debt: bigint;         // Last known debt
  // ... other fields
}
```

### 3. State Verification Flow
```
1. User opens app
2. Load tracked vaults from localStorage/IndexedDB
3. For each vault UTXO:
   a. Check if UTXO is unspent (via mempool API)
   b. If spent → vault was updated/closed elsewhere
   c. If unspent → vault state is valid
4. Display current state
```

## Data Flow: Open Vault

```
User Input                    SDK                         External
    │                          │                             │
    │  collateral, debt        │                             │
    ├─────────────────────────>│                             │
    │                          │                             │
    │                          │  1. Get UTXOs               │
    │                          ├────────────────────────────>│ mempool.space
    │                          │<────────────────────────────┤
    │                          │                             │
    │                          │  2. Build Spell             │
    │                          │  (vault state, zkUSD mint)  │
    │                          │                             │
    │                          │  3. Prove Spell             │
    │                          ├────────────────────────────>│ charms prover
    │                          │<────────────────────────────┤
    │                          │  (commit_tx, spell_tx)      │
    │                          │                             │
    │  4. Sign Transactions    │                             │
    │<─────────────────────────┤                             │
    ├─────────────────────────>│ UniSat                      │
    │                          │                             │
    │                          │  5. Broadcast               │
    │                          ├────────────────────────────>│ mempool.space
    │                          │<────────────────────────────┤
    │                          │                             │
    │                          │  6. Update Local State      │
    │                          │  (save new vault UTXO)      │
    │                          │                             │
    │  Success!                │                             │
    │<─────────────────────────┤                             │
```

## What We DON'T Need

| Traditional Approach | Charms Approach |
|---------------------|-----------------|
| ❌ PostgreSQL database | ✅ On-chain UTXOs + localStorage |
| ❌ Backend API server | ✅ Client-side SDK |
| ❌ Blockchain indexer | ✅ ZK proof verification |
| ❌ State synchronization | ✅ UTXO tracking |
| ❌ Centralized vault queries | ✅ User tracks own UTXOs |

## What We DO Need

### 1. Enhanced Local Storage (`packages/sdk/src/storage/`)
```typescript
interface VaultStorage {
  // Track user's vaults by UTXO
  saveVault(vault: TrackedVault): Promise<void>;
  getVault(id: string): Promise<TrackedVault | null>;
  getAllVaults(owner: string): Promise<TrackedVault[]>;
  updateVaultUtxo(id: string, newUtxo: string): Promise<void>;
  removeVault(id: string): Promise<void>;
}
```

### 2. UTXO Verification Service
```typescript
interface UtxoVerifier {
  // Check if vault UTXO is still unspent
  isVaultValid(utxo: string): Promise<boolean>;

  // Get spending transaction if vault was updated
  getSpendingTx(utxo: string): Promise<string | null>;
}
```

### 3. State Recovery Service
```typescript
interface StateRecovery {
  // If user lost local state, they can recover by:
  // 1. Providing the original vault creation txid
  // 2. Following the UTXO chain to current state
  recoverVault(genesisTxId: string): Promise<TrackedVault | null>;
}
```

### 4. Minimal Backend (Optional, for convenience)
Only needed for:
- **Price feeds**: `/api/price` (already implemented)
- **Health checks**: `/api/health`
- **Analytics**: Usage metrics (optional)

NOT needed for:
- Vault state storage
- User queries
- Transaction indexing

## Security Considerations

### Client-Side
1. **UTXO Validation**: Always verify UTXO is unspent before operations
2. **Proof Verification**: ZK proofs ensure state integrity
3. **Local Encryption**: Consider encrypting localStorage for privacy

### Transaction Safety
1. **UTXO Locking**: Prevent double-spend by tracking pending txs
2. **Fee Estimation**: Use current network fees
3. **Confirmation Tracking**: Monitor tx confirmations

## Implementation Priority

### Phase 1: Core Functionality (Current)
- [x] Vault open/adjust/close spells
- [x] Spell proving via Charms API
- [x] Basic localStorage persistence
- [x] Wallet integration (UniSat)

### Phase 2: Enhanced State Management
- [ ] IndexedDB for better storage
- [ ] UTXO verification on load
- [ ] State recovery service
- [ ] Pending transaction tracking

### Phase 3: Production Hardening
- [ ] Error tracking (Sentry)
- [ ] Performance monitoring
- [ ] Rate limiting improvements
- [ ] Security headers (HSTS)

### Phase 4: Optional Backend
- [ ] Health check endpoint
- [ ] Analytics collection
- [ ] Admin dashboard
- [ ] Liquidation bot (separate service)

## References

- [Charms Whitepaper](https://docs.charms.dev/Charms-whitepaper.pdf)
- [Charms Documentation](https://docs.charms.dev/)
- [BitcoinOS Blog](https://blog.bitcoinos.build/)
- [Groth16 Verifier](https://blog.bitcoinos.build/blog/we-custom-built-a-groth16-verifier-for-bitcoin)
