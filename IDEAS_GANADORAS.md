# IDEAS GANADORAS - BOS HACKATHON 2025

## RESUMEN EJECUTIVO

Despues de analizar 20+ hackathons, el mercado Bitcoin DeFi y las capacidades de Charms, estas son las 5 ideas ordenadas por potencial de ganar:

---

## #1 zkUSD - STABLECOIN CDP (RECOMENDACION TOP)

### Puntuacion: 9.3/10

**Pitch en 1 linea**: "El DAI de Bitcoin - primera stablecoin descentralizada nativa en Bitcoin L1"

### Por que ganara

| Criterio | Score | Razon |
|----------|-------|-------|
| Innovacion | 10/10 | NO existe CDP nativo en Bitcoin |
| Caso de uso | 10/10 | Mercado $250B, critico para DeFi |
| Uso de Charms | 9/10 | Tokens + predicados + cross-chain |
| Potencial real | 10/10 | TAM masivo, path claro a producto |
| Viabilidad | 7/10 | Complejo pero alcanzable en 4 semanas |

### Arquitectura

```
xBTC (Collateral)
    |
    v
VAULT (Charms App)
    |-- Oracle Price Feed
    |-- Collateral Ratio Check (150%)
    |-- Liquidation Engine
    |
    v
zkUSD (Mint)
    |
    v
Cross-Chain Beaming (Bitcoin <-> Cardano <-> EVM)
```

### Features MVP

1. **Vault Management**
   - Depositar xBTC
   - Mint zkUSD (ratio 150%)
   - Health factor dashboard

2. **Liquidation**
   - Auto-liquidacion si ratio < 110%
   - Keeper incentives

3. **UI**
   - Dashboard vaults
   - Mint/Burn interface
   - Portfolio tracker

### Stack Tecnico

- **Contracts**: Rust -> WASM (Charms)
- **Oracle**: zkVM price validation
- **Frontend**: Next.js + Wallet Connect
- **Backend**: Node.js + PostgreSQL

### Diferenciacion vs Competencia

| Feature | zkUSD | Arkadiko | Sovryn Zero |
|---------|-------|----------|-------------|
| Chain | Bitcoin L1 | Stacks | RSK |
| Cross-chain | Native | No | No |
| Trust | ZK proofs | Consensus | Federation |

### Timeline

- Semana 1: Smart contracts base
- Semana 2: Oracle + liquidations
- Semana 3: Frontend integration
- Semana 4: Testing + demo

---

## #2 CharmsPay - PAYMENT STREAMING

### Puntuacion: 8.6/10

**Pitch en 1 linea**: "Pagos que fluyen por segundo en Bitcoin - payroll, subscriptions y vesting nativos"

### Por que funciona

- Scope mas manejable
- Demo muy visual
- Feature imposible sin Charms
- Caso de uso claro

### Como Funciona

```
SENDER crea Stream:
- Deposita 100 xBTC
- Rate: 1 xBTC/dia
- Duration: 100 dias

RECIPIENT claims:
- Dia 10: claim hasta 10 xBTC
- Spell calcula: claimable = rate x time
- Cancel -> remaining vuelve a sender
```

### Casos de Uso

1. **Payroll**: Cobrar por segundo
2. **Subscriptions**: Netflix crypto
3. **Vesting**: Token unlocks
4. **Rent**: Pagos continuos

### Features MVP

1. Crear streams
2. Claim pagos
3. Cancel/modify
4. Dashboard activos

---

## #3 TypeScript SDK

### Puntuacion: 8.0/10

**Pitch en 1 linea**: "Construye Bitcoin programable en TypeScript - democratizando Charms"

### Por que funciona

- Organizadores lo pidieron explicitamente
- Menos competencia (todos haran DeFi)
- Impacto multiplicador
- Mas rapido de implementar

### Developer Experience

```typescript
import { CharmsSDK, Token } from 'charms-ts';

const token = Token.create({
  name: "MyToken",
  symbol: "MTK",
  supply: 1000000
});

await token.transfer({
  to: "bc1q...",
  amount: 100
});
```

### Componentes

1. Wrapper de Charms CLI
2. TypeScript types
3. Helper functions
4. Ejemplos + docs

---

## #4 CharmsDEX - AMM

### Puntuacion: 7.7/10

**Pitch en 1 linea**: "Uniswap para Bitcoin con liquidez programable"

### Features Unicas

1. **Conditional Liquidity**: LPs definen cuando esta activa
2. **Programmable Fees**: Dinamicos basados en condiciones
3. **Cross-chain Swaps**: Via beaming

### MVP

- Swap xBTC <-> zkUSD
- Add/Remove liquidity
- AMM basico (x*y=k)

---

## #5 CharmsDAO - Governance

### Puntuacion: 6.7/10

**Pitch en 1 linea**: "Aragon/Snapshot para Bitcoin - DAOs nativos"

### Componentes

1. Governance token
2. Proposal system
3. Treasury management
4. Voting mechanisms

---

## MATRIZ DE DECISION

| Criterio (peso) | zkUSD | CharmsPay | TS SDK | DEX | DAO |
|-----------------|-------|-----------|--------|-----|-----|
| Innovacion (30%) | 10 | 9 | 8 | 7 | 7 |
| Caso de uso (25%) | 10 | 8 | 9 | 8 | 6 |
| Uso Charms (20%) | 9 | 9 | 6 | 8 | 7 |
| Potencial (15%) | 10 | 8 | 8 | 9 | 6 |
| Viabilidad (10%) | 7 | 9 | 9 | 7 | 8 |
| **TOTAL** | **9.3** | **8.6** | **8.0** | **7.7** | **6.7** |

---

## RECOMENDACION FINAL

### Para MAXIMO IMPACTO -> zkUSD

- Resuelve gap mas grande del mercado
- Demuestra todo potencial de Charms
- Narrativa ganadora
- Path a producto real

### Para MENOR RIESGO -> CharmsPay

- Scope controlado
- Demo muy visual
- Feature unica

### Para ESTRATEGIA DIFERENTE -> TypeScript SDK

- Pedido por organizadores
- Menos competencia
- Rapido de implementar

---

## SIGUIENTE PASO

1. Elegir idea
2. Revisar BOS_HACKATHON_RESEARCH.md para detalles tecnicos
3. Comenzar setup de desarrollo
4. Seguir timeline de 4 semanas
