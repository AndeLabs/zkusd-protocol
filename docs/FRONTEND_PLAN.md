# zkUSD Frontend Implementation Plan

This document outlines the plan for implementing a web frontend for the zkUSD protocol.

## Overview

The frontend will be a modern React application that allows users to:
- Connect Bitcoin wallets
- Open and manage CDP vaults
- Deposit to the Stability Pool
- View protocol statistics

---

## Tech Stack (Recommended)

### Core
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **State**: Zustand or React Query

### Bitcoin Integration
- **Wallet**: Leather, Xverse, or Unisat wallet adapters
- **Bitcoin**: bitcoinjs-lib for transaction building
- **Charms**: @charms/sdk (when available) or custom integration

### Infrastructure
- **API**: Mempool.space API for blockchain data
- **Indexer**: Custom indexer or Charms indexer for protocol state
- **Hosting**: Vercel or similar

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

#### 1.1 Project Setup
```bash
npx create-next-app@latest zkusd-frontend --typescript --tailwind --app
cd zkusd-frontend
npm install @tanstack/react-query zustand bitcoinjs-lib
npx shadcn-ui@latest init
```

#### 1.2 Core Components
```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── vaults/
│   │   └── page.tsx
│   ├── pool/
│   │   └── page.tsx
│   └── stats/
│       └── page.tsx
├── components/
│   ├── ui/              # shadcn components
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── Sidebar.tsx
│   ├── wallet/
│   │   ├── ConnectButton.tsx
│   │   └── WalletProvider.tsx
│   ├── vault/
│   │   ├── VaultCard.tsx
│   │   ├── OpenVaultModal.tsx
│   │   └── VaultList.tsx
│   └── pool/
│       ├── DepositForm.tsx
│       └── PoolStats.tsx
├── hooks/
│   ├── useWallet.ts
│   ├── useVaults.ts
│   ├── usePool.ts
│   └── useOracle.ts
├── lib/
│   ├── bitcoin.ts
│   ├── charms.ts
│   └── api.ts
└── store/
    └── useStore.ts
```

#### 1.3 Wallet Integration

```typescript
// hooks/useWallet.ts
export interface Wallet {
  address: string;
  publicKey: string;
  network: 'mainnet' | 'testnet4' | 'signet';
  balance: number;
}

export function useWallet() {
  // Connect to Leather/Xverse/Unisat
  // Handle signing requests
  // Manage connection state
}
```

### Phase 2: Core Features (Week 2)

#### 2.1 Dashboard
- Protocol overview
- User's vault summary
- BTC price display
- System health indicators

#### 2.2 Vault Management
- List user's vaults
- Open new vault form
  - Collateral input
  - Debt input
  - ICR calculator
  - Fee preview
- Adjust vault (add/remove collateral, borrow/repay)
- Close vault

#### 2.3 Stability Pool
- Deposit zkUSD
- Withdraw zkUSD + rewards
- View pending BTC rewards
- Claim rewards

### Phase 3: Advanced Features (Week 3)

#### 3.1 Transaction Builder
```typescript
// lib/charms.ts
export async function buildOpenVaultTx(params: {
  collateral: bigint;
  debt: bigint;
  owner: string;
  btcUtxos: UTXO[];
}) {
  // Build Charms spell
  // Create PSBT
  // Return for signing
}
```

#### 3.2 Protocol Statistics
- Total Value Locked (TVL)
- Total zkUSD Supply
- System Collateral Ratio
- Active vaults count
- Stability Pool size
- Recent liquidations

#### 3.3 Notifications
- Vault at risk alerts
- Price drop warnings
- Transaction confirmations

### Phase 4: Polish & Testing (Week 4)

#### 4.1 UX Improvements
- Loading states
- Error handling
- Mobile responsiveness
- Animations

#### 4.2 Testing
- Unit tests (Jest/Vitest)
- E2E tests (Playwright)
- Testnet integration tests

#### 4.3 Documentation
- User guide
- FAQ section
- Glossary

---

## Key Components

### VaultCard Component

```tsx
interface VaultCardProps {
  vault: {
    id: string;
    collateral: bigint;
    debt: bigint;
    icr: number;
    status: 'healthy' | 'at_risk' | 'liquidatable';
  };
}

export function VaultCard({ vault }: VaultCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault #{vault.id.slice(0, 8)}...</CardTitle>
        <StatusBadge status={vault.status} />
      </CardHeader>
      <CardContent>
        <Stat label="Collateral" value={formatBTC(vault.collateral)} />
        <Stat label="Debt" value={formatZKUSD(vault.debt)} />
        <Stat label="ICR" value={`${vault.icr.toFixed(1)}%`} />
      </CardContent>
      <CardFooter>
        <Button variant="outline">Adjust</Button>
        <Button variant="destructive">Close</Button>
      </CardFooter>
    </Card>
  );
}
```

### OpenVaultModal Component

```tsx
export function OpenVaultModal() {
  const [collateral, setCollateral] = useState('');
  const [debt, setDebt] = useState('');
  const { btcPrice } = useOracle();

  const icr = useMemo(() => {
    if (!collateral || !debt || !btcPrice) return 0;
    const collValue = parseFloat(collateral) * btcPrice;
    return (collValue / parseFloat(debt)) * 100;
  }, [collateral, debt, btcPrice]);

  const isValid = icr >= 110;

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open New Vault</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            label="Collateral (BTC)"
            value={collateral}
            onChange={setCollateral}
          />
          <Input
            label="Debt (zkUSD)"
            value={debt}
            onChange={setDebt}
          />

          <ICRIndicator value={icr} />

          <Alert variant={isValid ? "default" : "destructive"}>
            {isValid
              ? "Your vault will be safe"
              : "ICR must be at least 110%"
            }
          </Alert>
        </div>

        <DialogFooter>
          <Button disabled={!isValid} onClick={handleOpen}>
            Open Vault
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## API Integration

### Mempool.space API

```typescript
// lib/api.ts
const MEMPOOL_API = 'https://mempool.space/testnet4/api';

export async function getUtxos(address: string) {
  const res = await fetch(`${MEMPOOL_API}/address/${address}/utxo`);
  return res.json();
}

export async function broadcastTx(hex: string) {
  const res = await fetch(`${MEMPOOL_API}/tx`, {
    method: 'POST',
    body: hex,
  });
  return res.text(); // Returns txid
}
```

### Protocol State

```typescript
// lib/protocol.ts
export async function getProtocolState() {
  // Query Charms indexer for:
  // - All active vaults
  // - Stability pool state
  // - Oracle price
  // - Protocol parameters
}

export async function getUserVaults(address: string) {
  // Query for vaults owned by address
}
```

---

## Design System

### Colors
```css
:root {
  --primary: #F7931A;      /* Bitcoin Orange */
  --secondary: #4A90E2;    /* Trust Blue */
  --success: #10B981;      /* Safe Green */
  --warning: #F59E0B;      /* Caution Yellow */
  --danger: #EF4444;       /* Danger Red */
  --background: #0F172A;   /* Dark Background */
  --surface: #1E293B;      /* Card Background */
}
```

### Typography
- **Headings**: Inter (Bold)
- **Body**: Inter (Regular)
- **Numbers**: JetBrains Mono (for amounts)

### Components
Use shadcn/ui for consistent, accessible components:
- Button, Card, Dialog, Input, Select
- Alert, Badge, Progress, Skeleton
- Table, Tabs, Toast

---

## Security Considerations

1. **No Private Keys** - Frontend never handles private keys
2. **Transaction Preview** - Always show what user is signing
3. **Amount Validation** - Validate all inputs
4. **Rate Limiting** - Prevent spam
5. **HTTPS Only** - Enforce secure connections

---

## Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] API endpoints updated for mainnet
- [ ] Error tracking setup (Sentry)
- [ ] Analytics setup
- [ ] Security headers configured
- [ ] Performance optimized
- [ ] Mobile tested

### Hosting
```bash
# Vercel (recommended)
npm i -g vercel
vercel --prod

# Or build static
npm run build
npm run export
```

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Foundation | Week 1 | Project setup, wallet connection |
| Core Features | Week 2 | Vault & pool management |
| Advanced | Week 3 | Stats, notifications, TX builder |
| Polish | Week 4 | Testing, docs, launch prep |

---

## Resources

- [Next.js Docs](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib)
- [Leather Wallet SDK](https://leather.io/developers)
- [Mempool API](https://mempool.space/docs/api)
- [Charms Documentation](https://docs.charms.dev)
