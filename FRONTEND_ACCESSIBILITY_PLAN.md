# PLAN FRONTEND ACCESIBLE - zkUSD

## RESUMEN EJECUTIVO

Este documento detalla como hacer zkUSD accesible como una app Web2, reducir costos para usuarios, e identificar oportunidades de contribucion open source.

**Objetivos**:
1. UX tipo Web2 (sin friccion de crypto)
2. Costos minimos para usuarios
3. Contribuciones open source reutilizables
4. Integrar mejores practicas de Soroban

---

## 1. INTEGRACION DE WALLETS BITCOIN

### 1.1 Unisat Wallet SDK

Unisat es la wallet Bitcoin mas popular para Ordinals/BRC-20. La integracion funciona via `window.unisat`.

**API Principal**:
```typescript
// Detectar wallet
const isAvailable = typeof window.unisat !== 'undefined';

// Conectar
const accounts = await window.unisat.requestAccounts();
const publicKey = await window.unisat.getPublicKey();

// Firmar mensaje
const signature = await window.unisat.signMessage(message, 'ecdsa');

// Enviar BTC
const txid = await window.unisat.sendBitcoin(toAddress, satoshis, { feeRate: 10 });

// Firmar PSBT
const signedPsbt = await window.unisat.signPsbt(psbtHex);
```

### 1.2 Multi-Wallet Support

Para maxima accesibilidad, soportar multiples wallets:

| Wallet | NPM Package | Usuarios |
|--------|-------------|----------|
| **Unisat** | @unisat/wallet-sdk | 1M+ |
| **Xverse** | sats-connect | 2M+ |
| **Leather** | sats-connect | 500K+ |
| **OKX** | window.okxwallet | Multi-chain |

**Recomendacion**: Usar **LaserEyes** para soporte unificado:

```bash
npm install @omnisat/lasereyes-core @omnisat/lasereyes-react
```

### 1.3 Hook Personalizado para zkUSD

```typescript
// hooks/useZkUsdWallet.ts
import { useState, useCallback, useEffect } from 'react';

interface WalletState {
  address: string | null;
  publicKey: string | null;
  balance: number;
  connected: boolean;
  loading: boolean;
  error: string | null;
  walletType: 'unisat' | 'xverse' | 'leather' | null;
}

export function useZkUsdWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    publicKey: null,
    balance: 0,
    connected: false,
    loading: false,
    error: null,
    walletType: null,
  });

  // Detectar wallets disponibles
  const getAvailableWallets = useCallback(() => {
    const wallets: string[] = [];
    if (typeof window !== 'undefined') {
      if (window.unisat) wallets.push('unisat');
      if (window.XverseProviders) wallets.push('xverse');
      if (window.LeatherProvider) wallets.push('leather');
    }
    return wallets;
  }, []);

  // Conectar a wallet especifica
  const connect = useCallback(async (walletType: 'unisat' | 'xverse' | 'leather') => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      let address: string;
      let publicKey: string;

      switch (walletType) {
        case 'unisat':
          const accounts = await window.unisat.requestAccounts();
          address = accounts[0];
          publicKey = await window.unisat.getPublicKey();
          break;

        case 'xverse':
          // Usar sats-connect
          const { request } = await import('sats-connect');
          const response = await request('getAddresses', {
            purposes: ['payment', 'ordinals']
          });
          address = response.result.addresses[0].address;
          publicKey = response.result.addresses[0].publicKey;
          break;

        case 'leather':
          // Similar a xverse via sats-connect
          break;
      }

      setState({
        address,
        publicKey,
        balance: 0, // Obtener balance separadamente
        connected: true,
        loading: false,
        error: null,
        walletType,
      });

      // Persistir sesion
      localStorage.setItem('zkusd_wallet', walletType);
      localStorage.setItem('zkusd_address', address);

    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Error de conexion',
      }));
    }
  }, []);

  // Desconectar
  const disconnect = useCallback(() => {
    setState({
      address: null,
      publicKey: null,
      balance: 0,
      connected: false,
      loading: false,
      error: null,
      walletType: null,
    });
    localStorage.removeItem('zkusd_wallet');
    localStorage.removeItem('zkusd_address');
  }, []);

  // Auto-reconectar al cargar
  useEffect(() => {
    const savedWallet = localStorage.getItem('zkusd_wallet') as WalletState['walletType'];
    const savedAddress = localStorage.getItem('zkusd_address');

    if (savedWallet && savedAddress) {
      setState(prev => ({
        ...prev,
        address: savedAddress,
        walletType: savedWallet,
        connected: true,
      }));
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    getAvailableWallets,
  };
}
```

---

## 2. EXPERIENCIA WEB2-LIKE

### 2.1 Progressive Onboarding

El onboarding debe ser **gradual**, no abrumar al usuario con complejidad.

**Flujo Recomendado**:

```
PASO 1: Landing (sin wallet requerida)
├── Ver stats del protocolo
├── Calcular potencial de borrowing
└── Educacion sobre zkUSD

PASO 2: Conectar Wallet (1 click)
├── Modal con wallets disponibles
├── Auto-detectar wallets instaladas
├── Link a instalar si no tiene
└── Explicacion clara de permisos

PASO 3: Primer Vault (guiado)
├── Wizard paso a paso
├── Preview de resultados
├── Estimacion de fees clara
└── Confirmacion antes de firmar

PASO 4: Dashboard (autonomo)
├── Vista de vault activo
├── Health factor visual
├── Acciones claras
└── Historial de transacciones
```

### 2.2 Abstraccion de Complejidad

**Lo que el usuario NO debe ver**:
- UTXOs
- Satoshis (mostrar BTC)
- Hex addresses completas
- Fee rates en sat/vB
- PSBTs

**Lo que el usuario SI debe ver**:
- "Tu colateral: 1.5 BTC ($150,000)"
- "Tu deuda: 50,000 zkUSD"
- "Fee estimado: ~$2.50 (1 min)"
- "Health: 300% (Seguro)"

### 2.3 Componentes UI Accesibles

```typescript
// components/VaultHealthIndicator.tsx
interface HealthIndicatorProps {
  ratio: number; // Collateral ratio (ej: 250 = 250%)
}

export function VaultHealthIndicator({ ratio }: HealthIndicatorProps) {
  const getStatus = (r: number) => {
    if (r >= 250) return { label: 'Seguro', color: 'green', icon: '✓' };
    if (r >= 150) return { label: 'Moderado', color: 'yellow', icon: '!' };
    if (r >= 110) return { label: 'En riesgo', color: 'orange', icon: '⚠' };
    return { label: 'Peligro', color: 'red', icon: '✕' };
  };

  const status = getStatus(ratio);
  const percentage = Math.min((ratio / 300) * 100, 100);

  return (
    <div className="health-indicator">
      <div className="flex justify-between mb-2">
        <span>Ratio de Colateral</span>
        <span className={`text-${status.color}-500 font-bold`}>
          {status.icon} {ratio}%
        </span>
      </div>
      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full bg-${status.color}-500 transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className={`text-sm mt-1 text-${status.color}-600`}>
        {status.label}
        {ratio < 150 && ' - Considera agregar colateral'}
      </p>
    </div>
  );
}
```

### 2.4 Fee Estimation UX

```typescript
// components/FeeEstimator.tsx
interface FeeEstimatorProps {
  operation: 'open_vault' | 'close_vault' | 'adjust' | 'liquidate';
  amount?: number;
}

export function FeeEstimator({ operation, amount }: FeeEstimatorProps) {
  const [fees, setFees] = useState<{
    fast: number;
    standard: number;
    slow: number;
  } | null>(null);
  const [selected, setSelected] = useState<'fast' | 'standard' | 'slow'>('standard');

  useEffect(() => {
    // Fetch fee estimation from mempool.space
    fetch('https://mempool.space/api/v1/fees/recommended')
      .then(res => res.json())
      .then(data => {
        // Calcular fee total basado en tamano estimado de tx
        const txSize = getEstimatedTxSize(operation);
        setFees({
          fast: (data.fastestFee * txSize) / 100000000, // Convert to BTC
          standard: (data.halfHourFee * txSize) / 100000000,
          slow: (data.hourFee * txSize) / 100000000,
        });
      });
  }, [operation]);

  if (!fees) return <div className="animate-pulse">Calculando fees...</div>;

  const btcPrice = 100000; // Obtener de oracle

  return (
    <div className="fee-estimator bg-gray-50 rounded-lg p-4">
      <h4 className="font-medium mb-3">Velocidad de Transaccion</h4>

      <div className="grid grid-cols-3 gap-2">
        {(['fast', 'standard', 'slow'] as const).map(speed => (
          <button
            key={speed}
            onClick={() => setSelected(speed)}
            className={`p-3 rounded-lg border-2 transition-all ${
              selected === speed
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-medium">
              {speed === 'fast' && 'Rapido (~10 min)'}
              {speed === 'standard' && 'Normal (~30 min)'}
              {speed === 'slow' && 'Economico (~1 hora)'}
            </div>
            <div className="text-lg font-bold mt-1">
              ${(fees[speed] * btcPrice).toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">
              {(fees[speed] * 100000000).toFixed(0)} sats
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function getEstimatedTxSize(operation: string): number {
  // Tamano aproximado en vBytes
  switch (operation) {
    case 'open_vault': return 250;
    case 'close_vault': return 200;
    case 'adjust': return 220;
    case 'liquidate': return 300;
    default: return 250;
  }
}
```

---

## 3. REDUCCION DE COSTOS

### 3.1 Estrategias de Optimizacion

| Estrategia | Ahorro | Implementacion |
|------------|--------|----------------|
| **SegWit/Taproot** | 35-60% | Usar bc1p addresses |
| **Batching** | 65-73% | Agrupar txs cada 30s |
| **RBF** | 54% en spikes | Fees incrementales |
| **Lightning** | 99%+ | Para pagos frecuentes |
| **Fee scheduling** | 20-30% | Esperar fees bajas |

### 3.2 Implementacion de Batching

```typescript
// services/TransactionBatcher.ts
interface PendingTransaction {
  id: string;
  type: 'open' | 'close' | 'adjust';
  params: any;
  userId: string;
  createdAt: number;
}

class TransactionBatcher {
  private pending: PendingTransaction[] = [];
  private batchInterval = 30000; // 30 segundos
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.startBatchTimer();
  }

  // Agregar tx a la cola
  async addTransaction(tx: Omit<PendingTransaction, 'id' | 'createdAt'>) {
    const pendingTx: PendingTransaction = {
      ...tx,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    this.pending.push(pendingTx);

    // Retornar promesa que se resuelve cuando batch se ejecuta
    return new Promise((resolve, reject) => {
      // Almacenar callbacks para este tx
      this.callbacks.set(pendingTx.id, { resolve, reject });
    });
  }

  private startBatchTimer() {
    this.timer = setInterval(() => {
      if (this.pending.length > 0) {
        this.executeBatch();
      }
    }, this.batchInterval);
  }

  private async executeBatch() {
    const batch = [...this.pending];
    this.pending = [];

    // Verificar si fee es aceptable
    const currentFee = await this.getCurrentFeeRate();
    if (currentFee > this.maxFeeRate) {
      // Esperar mejor momento
      this.pending = batch;
      return;
    }

    try {
      // Crear batch transaction
      const batchTx = await this.createBatchTransaction(batch);

      // Ejecutar
      const txid = await this.broadcastTransaction(batchTx);

      // Notificar a todos los usuarios
      batch.forEach(tx => {
        const callback = this.callbacks.get(tx.id);
        if (callback) {
          callback.resolve({ txid, position: batch.indexOf(tx) });
        }
      });

    } catch (error) {
      batch.forEach(tx => {
        const callback = this.callbacks.get(tx.id);
        if (callback) {
          callback.reject(error);
        }
      });
    }
  }

  private async createBatchTransaction(txs: PendingTransaction[]) {
    // Combinar inputs/outputs de multiples usuarios
    // Crear una sola transaccion Bitcoin
    // ... implementacion
  }
}
```

### 3.3 Modelo de Subsidio de Fees

```typescript
// services/FeeSubsidy.ts
interface SubsidyConfig {
  phase: 1 | 2 | 3;
  subsidyPercent: number;
  maxSubsidyPerUser: number;
  dailyBudget: number;
}

const SUBSIDY_PHASES: Record<number, SubsidyConfig> = {
  1: { phase: 1, subsidyPercent: 100, maxSubsidyPerUser: 10, dailyBudget: 5000 },
  2: { phase: 2, subsidyPercent: 50, maxSubsidyPerUser: 5, dailyBudget: 2500 },
  3: { phase: 3, subsidyPercent: 0, maxSubsidyPerUser: 0, dailyBudget: 0 },
};

class FeeSubsidyManager {
  private dailySpent = 0;
  private userSubsidies = new Map<string, number>();
  private currentPhase: SubsidyConfig;

  constructor(phase: 1 | 2 | 3 = 1) {
    this.currentPhase = SUBSIDY_PHASES[phase];
  }

  async calculateSubsidy(userId: string, estimatedFee: number): Promise<{
    userPays: number;
    protocolPays: number;
  }> {
    const config = this.currentPhase;

    // Verificar limites
    const userSpent = this.userSubsidies.get(userId) || 0;
    const availableForUser = config.maxSubsidyPerUser - userSpent;
    const availableDaily = config.dailyBudget - this.dailySpent;

    // Calcular subsidio real
    const maxSubsidy = estimatedFee * (config.subsidyPercent / 100);
    const actualSubsidy = Math.min(maxSubsidy, availableForUser, availableDaily);

    return {
      userPays: estimatedFee - actualSubsidy,
      protocolPays: actualSubsidy,
    };
  }

  async applySubsidy(userId: string, amount: number) {
    this.dailySpent += amount;
    const current = this.userSubsidies.get(userId) || 0;
    this.userSubsidies.set(userId, current + amount);
  }

  // Reset diario
  resetDaily() {
    this.dailySpent = 0;
  }
}
```

### 3.4 Lightning Network Integration (Futuro)

```typescript
// services/LightningBridge.ts
// Para pagos pequenos y frecuentes

interface LightningConfig {
  endpoint: string;
  apiKey: string;
}

class LightningBridge {
  constructor(private config: LightningConfig) {}

  // Transferir zkUSD via Lightning
  async sendZkUsdLightning(
    to: string,
    amountSats: number
  ): Promise<{ preimage: string }> {
    // Usar USDT on Lightning o similar
    // Fee: <$0.01
    // Tiempo: <5 segundos
  }

  // Recibir zkUSD via Lightning
  async receiveZkUsdLightning(
    amountSats: number
  ): Promise<{ invoice: string }> {
    // Generar invoice Lightning
  }
}
```

---

## 4. CONTRIBUCIONES OPEN SOURCE

### 4.1 Oportunidades Identificadas

El ecosistema Bitcoin frontend tiene gaps significativos:

| Gap | Oportunidad | Impacto |
|-----|-------------|---------|
| No hay RainbowKit para Bitcoin | **bitcoin-connect-kit** | ALTO |
| No hay wagmi para Bitcoin | **btc-hooks** | ALTO |
| No hay shadcn DeFi components | **defi-ui** | MEDIO |
| No hay testing utils para wallets | **btc-test-utils** | MEDIO |

### 4.2 Contribucion #1: bitcoin-connect-kit

Analogo a RainbowKit pero para Bitcoin wallets:

```typescript
// packages/bitcoin-connect-kit/src/index.ts

export { BitcoinConnectButton } from './components/ConnectButton';
export { BitcoinConnectProvider } from './providers/ConnectProvider';
export { useBitcoinWallet } from './hooks/useBitcoinWallet';
export { useBitcoinBalance } from './hooks/useBitcoinBalance';
export { useSendBitcoin } from './hooks/useSendBitcoin';
export { useSignMessage } from './hooks/useSignMessage';
export { useSignPsbt } from './hooks/useSignPsbt';

// Tipos
export type { WalletConfig, WalletState, TransactionResult } from './types';

// Wallets soportadas
export { SUPPORTED_WALLETS } from './wallets';
```

**Estructura del paquete**:
```
bitcoin-connect-kit/
├── src/
│   ├── components/
│   │   ├── ConnectButton.tsx
│   │   ├── WalletModal.tsx
│   │   ├── WalletOption.tsx
│   │   └── AddressDisplay.tsx
│   ├── hooks/
│   │   ├── useBitcoinWallet.ts
│   │   ├── useBitcoinBalance.ts
│   │   ├── useSendBitcoin.ts
│   │   ├── useSignMessage.ts
│   │   └── useSignPsbt.ts
│   ├── providers/
│   │   └── ConnectProvider.tsx
│   ├── wallets/
│   │   ├── unisat.ts
│   │   ├── xverse.ts
│   │   ├── leather.ts
│   │   └── index.ts
│   └── types.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 4.3 Contribucion #2: defi-ui (Components DeFi)

Componentes shadcn-style para DeFi:

```typescript
// packages/defi-ui/src/index.ts

// Vault components
export { VaultCard } from './vault/VaultCard';
export { VaultHealthBar } from './vault/VaultHealthBar';
export { CollateralInput } from './vault/CollateralInput';
export { DebtInput } from './vault/DebtInput';

// Pool components
export { PoolCard } from './pool/PoolCard';
export { DepositForm } from './pool/DepositForm';
export { WithdrawForm } from './pool/WithdrawForm';
export { RewardsDisplay } from './pool/RewardsDisplay';

// Transaction components
export { FeeEstimator } from './tx/FeeEstimator';
export { TransactionStatus } from './tx/TransactionStatus';
export { TransactionHistory } from './tx/TransactionHistory';

// Price/Data components
export { PriceDisplay } from './data/PriceDisplay';
export { TokenBalance } from './data/TokenBalance';
export { RatioGauge } from './data/RatioGauge';

// Charts
export { PriceChart } from './charts/PriceChart';
export { TVLChart } from './charts/TVLChart';
export { HealthChart } from './charts/HealthChart';
```

### 4.4 Contribucion #3: btc-test-utils

Testing utilities para Bitcoin DApps:

```typescript
// packages/btc-test-utils/src/index.ts

// Mock wallets
export { MockUnisatProvider } from './mocks/unisat';
export { MockXverseProvider } from './mocks/xverse';

// Test helpers
export { createMockWallet } from './helpers/createMockWallet';
export { createMockTransaction } from './helpers/createMockTransaction';
export { createMockPsbt } from './helpers/createMockPsbt';

// Assertions
export { assertValidBitcoinAddress } from './assertions/address';
export { assertValidSignature } from './assertions/signature';

// Fixtures
export { TEST_ADDRESSES } from './fixtures/addresses';
export { TEST_TRANSACTIONS } from './fixtures/transactions';
```

### 4.5 Estructura de Contribucion Completa

```
zkusd-ecosystem/
├── packages/
│   ├── bitcoin-connect-kit/     # Wallet connection
│   │   └── ... (ver arriba)
│   │
│   ├── defi-ui/                 # UI Components
│   │   ├── src/
│   │   │   ├── vault/
│   │   │   ├── pool/
│   │   │   ├── tx/
│   │   │   ├── data/
│   │   │   └── charts/
│   │   └── package.json
│   │
│   ├── btc-test-utils/          # Testing
│   │   └── ...
│   │
│   ├── btc-hooks/               # React hooks
│   │   ├── src/
│   │   │   ├── useMempool.ts
│   │   │   ├── useFeeEstimate.ts
│   │   │   ├── useOrdinals.ts
│   │   │   └── useInscriptions.ts
│   │   └── package.json
│   │
│   └── zkusd-sdk/               # zkUSD specific
│       ├── src/
│       │   ├── vault.ts
│       │   ├── stability-pool.ts
│       │   ├── liquidation.ts
│       │   └── oracle.ts
│       └── package.json
│
├── apps/
│   └── zkusd-web/               # Main app
│       └── ...
│
├── docs/
│   ├── bitcoin-connect-kit.md
│   ├── defi-ui.md
│   └── contributing.md
│
├── examples/
│   ├── basic-vault/
│   ├── multi-wallet/
│   └── lightning-integration/
│
└── turbo.json                   # Monorepo config
```

---

## 5. INTEGRACION DE LEARNINGS DE SOROBAN

### 5.1 Patrones a Adoptar

De la investigacion de Soroban, adoptamos estos patrones:

#### Error Handling Mejorado (de Soroban)

```typescript
// types/errors.ts
export enum ZkUsdErrorCode {
  VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
  UNDERCOLLATERALIZED = 'UNDERCOLLATERALIZED',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  ORACLE_STALE = 'ORACLE_STALE',
  UNAUTHORIZED = 'UNAUTHORIZED',
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
}

export class ZkUsdError extends Error {
  constructor(
    public code: ZkUsdErrorCode,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ZkUsdError';
  }
}

// Uso en hooks
export function useOpenVault() {
  const openVault = async (params: OpenVaultParams) => {
    try {
      // ... logica
    } catch (error) {
      if (error instanceof ZkUsdError) {
        // Manejar errores conocidos
        switch (error.code) {
          case ZkUsdErrorCode.UNDERCOLLATERALIZED:
            toast.error(`Ratio muy bajo: ${error.details?.currentRatio}%`);
            break;
          // ... otros casos
        }
      }
      throw error;
    }
  };
}
```

#### Token Metadata (de SEP-41)

```typescript
// constants/token.ts
export const ZKUSD_TOKEN = {
  name: 'zkUSD',
  symbol: 'zkUSD',
  decimals: 8,
  description: 'Bitcoin-native stablecoin',
  icon: '/zkusd-icon.svg',
} as const;

// Formatters
export function formatZkUsd(amount: bigint): string {
  const value = Number(amount) / 10 ** ZKUSD_TOKEN.decimals;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
```

#### Events System (de Soroban)

```typescript
// events/index.ts
export enum ZkUsdEventType {
  VAULT_OPENED = 'VAULT_OPENED',
  VAULT_CLOSED = 'VAULT_CLOSED',
  COLLATERAL_ADDED = 'COLLATERAL_ADDED',
  COLLATERAL_WITHDRAWN = 'COLLATERAL_WITHDRAWN',
  DEBT_MINTED = 'DEBT_MINTED',
  DEBT_REPAID = 'DEBT_REPAID',
  LIQUIDATION = 'LIQUIDATION',
  STABILITY_DEPOSIT = 'STABILITY_DEPOSIT',
  STABILITY_WITHDRAWAL = 'STABILITY_WITHDRAWAL',
}

export interface ZkUsdEvent<T = unknown> {
  type: ZkUsdEventType;
  txid: string;
  blockHeight: number;
  timestamp: number;
  data: T;
}

// Event emitter para UI
import { EventEmitter } from 'events';

export const zkUsdEvents = new EventEmitter();

// En componentes
useEffect(() => {
  const handler = (event: ZkUsdEvent) => {
    if (event.type === ZkUsdEventType.VAULT_OPENED) {
      toast.success('Vault creado exitosamente!');
    }
  };

  zkUsdEvents.on('event', handler);
  return () => zkUsdEvents.off('event', handler);
}, []);
```

#### Testing Patterns (de Soroban testutils)

```typescript
// tests/utils/index.ts
export function createTestContext() {
  return {
    wallet: createMockWallet({
      address: 'bc1qtest...',
      balance: 10_00000000, // 10 BTC
    }),
    oracle: createMockOracle({
      btcPrice: 100_000_00000000, // $100,000
    }),
    protocol: createMockProtocol({
      tcr: 200,
      totalCollateral: 1000_00000000,
      totalDebt: 50_000_000_00000000,
    }),
  };
}

// En tests
describe('OpenVault', () => {
  it('should open vault with valid collateral ratio', async () => {
    const ctx = createTestContext();
    const { result } = renderHook(() => useOpenVault(), {
      wrapper: ({ children }) => (
        <TestProvider context={ctx}>{children}</TestProvider>
      ),
    });

    await act(async () => {
      await result.current.openVault({
        collateral: 1_50000000, // 1.5 BTC
        debt: 100_000_00000000, // 100,000 zkUSD
      });
    });

    expect(result.current.vault).toBeDefined();
    expect(result.current.vault.icr).toBeGreaterThan(110);
  });
});
```

### 5.2 Arquitectura Frontend Actualizada

```
apps/zkusd-web/
├── src/
│   ├── app/                     # Next.js 14 App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx             # Landing
│   │   ├── vault/
│   │   │   ├── page.tsx         # Vault management
│   │   │   └── [id]/page.tsx    # Vault detail
│   │   ├── stability/
│   │   │   └── page.tsx         # Stability Pool
│   │   └── dashboard/
│   │       └── page.tsx         # User dashboard
│   │
│   ├── components/
│   │   ├── wallet/              # Wallet connection
│   │   ├── vault/               # Vault components
│   │   ├── pool/                # Pool components
│   │   ├── tx/                  # Transaction components
│   │   └── layout/              # Layout components
│   │
│   ├── hooks/                   # Custom hooks
│   │   ├── useZkUsdWallet.ts
│   │   ├── useVault.ts
│   │   ├── useStabilityPool.ts
│   │   ├── useFeeEstimate.ts
│   │   └── useProtocolStats.ts
│   │
│   ├── lib/
│   │   ├── api/                 # API clients
│   │   ├── utils/               # Utilities
│   │   └── constants.ts         # Constants
│   │
│   ├── stores/                  # Zustand stores
│   │   ├── wallet.ts
│   │   ├── vault.ts
│   │   └── protocol.ts
│   │
│   ├── types/                   # TypeScript types
│   │   ├── vault.ts
│   │   ├── pool.ts
│   │   ├── errors.ts
│   │   └── events.ts
│   │
│   └── styles/                  # Tailwind styles
│
├── public/
├── tests/
└── package.json
```

---

## 6. STACK TECNOLOGICO FINAL

### 6.1 Dependencias Principales

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",

    "zustand": "^4.4.0",
    "@tanstack/react-query": "^5.0.0",
    "react-hook-form": "^7.47.0",

    "@omnisat/lasereyes-react": "^1.0.0",
    "sats-connect": "^4.2.0",
    "@unisat/wallet-sdk": "^1.9.0",

    "recharts": "^2.10.0",
    "framer-motion": "^10.16.0",

    "tailwindcss": "^3.3.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^1.14.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "@types/react": "^18.2.0",
    "@testing-library/react": "^14.0.0",
    "vitest": "^0.34.0"
  }
}
```

### 6.2 Variables de Entorno

```env
# .env.local
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_API_URL=https://api.zkusd.io
NEXT_PUBLIC_MEMPOOL_API=https://mempool.space/api

# Fee subsidy (solo backend)
FEE_SUBSIDY_WALLET=bc1q...
FEE_SUBSIDY_DAILY_BUDGET=5000
```

---

## 7. TIMELINE ACTUALIZADO

### Semana 3: Frontend (Actualizado)

| Dia | Tarea | Entregable |
|-----|-------|------------|
| 15 | Setup Next.js + Wallet hook | Proyecto base |
| 16 | ConnectButton + Modal | Conexion funcional |
| 17 | VaultCard + HealthBar | UI de vault |
| 18 | OpenVaultForm + FeeEstimator | Crear vault |
| 19 | StabilityPoolUI | Depositar/retirar |
| 20 | Dashboard + Stats | Vista general |
| 21 | Testing + Bug fixes | App funcional |

### Semana 4: Polish (Actualizado)

| Dia | Tarea | Entregable |
|-----|-------|------------|
| 22 | Error handling mejorado | UX robusta |
| 23 | Fee subsidy UI | Transparencia costos |
| 24 | Mobile responsive | PWA ready |
| 25 | Demo video | 3-5 min video |
| 26 | Documentation | README, guides |
| 27 | Final testing | QA completo |
| 28 | Submission | Hackathon entry |

---

## 8. METRICAS DE EXITO

### 8.1 UX Metrics

| Metrica | Target | Medicion |
|---------|--------|----------|
| Time to connect wallet | < 10s | Analytics |
| Time to open first vault | < 2 min | Analytics |
| Error rate | < 5% | Sentry |
| Mobile usability | 90%+ | Lighthouse |

### 8.2 Cost Metrics

| Metrica | Target | Medicion |
|---------|--------|----------|
| Avg fee per operation | < $3 | On-chain |
| Fee subsidy utilization | > 80% | Backend |
| Batching efficiency | > 50% txs | Backend |

### 8.3 Contribution Metrics

| Metrica | Target | Medicion |
|---------|--------|----------|
| NPM downloads | 100+ | npm stats |
| GitHub stars | 50+ | GitHub |
| External integrations | 2+ | Tracking |

---

## RESUMEN

Este plan integra:

1. **Wallet Integration**: Unisat + multi-wallet con LaserEyes
2. **UX Accesible**: Progressive onboarding, abstraccion de complejidad
3. **Costos Bajos**: Batching, subsidios, Lightning (futuro)
4. **Contribuciones**: bitcoin-connect-kit, defi-ui, btc-test-utils
5. **Learnings Soroban**: Error handling, events, testing patterns

El resultado sera una app zkUSD que se siente como Web2 pero con la seguridad de Bitcoin.
