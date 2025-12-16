# ANALISIS PROFUNDO: MEZO PROTOCOL Y mUSD

## RESUMEN EJECUTIVO

Mezo Protocol es un "Economic Layer" para Bitcoin que lanzó mainnet en Mayo 2025. Su stablecoin mUSD es 100% respaldado por Bitcoin (via tBTC) y utiliza un modelo CDP similar a Liquity.

**Métricas clave**:
- $400M+ en depósitos totales
- $2B+ en mUSD prestados (testnet+mainnet)
- 2M+ transacciones en testnet
- Auditorías por Quantstamp y Thesis Defense

---

## 1. ARQUITECTURA TÉCNICA DE mUSD

### 1.1 Componentes del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    MEZO mUSD ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 TOKEN CONTRACTS                      │   │
│  │  - mUSD (stablecoin ERC-20)                         │   │
│  │  - MEZO (governance token)                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 CORE PROTOCOL                        │   │
│  │  - BorrowerOperations (open/close positions)        │   │
│  │  - TroveManager (position tracking)                 │   │
│  │  - Liquidation logic                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   ASSET POOLS                        │   │
│  │  - ActivePool (collateral activo)                   │   │
│  │  - DefaultPool (collateral liquidado)               │   │
│  │  - StabilityPool (absorbe deuda)                    │   │
│  │  - CollSurplusPool (excedentes)                     │   │
│  │  - GasPool (compensación gas)                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SUPPORTING CONTRACTS                    │   │
│  │  - PriceFeed (oracles)                              │   │
│  │  - SortedTroves (lista ordenada por ICR)            │   │
│  │  - PCV (Protocol Controlled Value)                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Smart Contracts Principales

| Contrato | Dirección (Mezo) | Función |
|----------|------------------|---------|
| ActivePool | 0x3012C2fE... | Collateral de posiciones activas |
| DefaultPool | 0xE4B5913C... | Collateral de liquidaciones |
| CollSurplusPool | 0xBF51807A... | Excedentes de redenciones |
| GasPool | 0x3EB418Bd... | Reservas de compensación |
| BorrowerOperations | - | Abrir/cerrar troves |
| TroveManager | - | Gestión de posiciones |
| StabilityPool | - | Pool de estabilidad |
| PriceFeed | - | Oracle de precios |

### 1.3 Collateral: tBTC

- **Proveedor**: Threshold Network
- **Tipo**: Bitcoin tokenizado 1:1
- **Track record**: 18,000+ BTC bridgeados desde 2020
- **Verificación**: Proof-of-Reserves on-chain

---

## 2. MECANISMOS DE ESTABILIDAD

### 2.1 Ratios de Colateralización

| Ratio | Valor | Descripción |
|-------|-------|-------------|
| **MCR** (Minimum) | 110% | Mínimo para posición individual |
| **CCR** (Critical) | 150% | Dispara Recovery Mode |
| **Recomendado** | 250%+ | Para seguridad en volatilidad |

### 2.2 Tipos de Ratios

```
ICR (Individual Collateral Ratio):
  = (Valor USD del collateral) / (Deuda total en mUSD)

NICR (Nominal ICR):
  = (Collateral × 100e18) / (Deuda)

TCR (Total Collateral Ratio):
  = (Collateral total del sistema en USD) / (Deuda total del sistema)
```

### 2.3 Recovery Mode

Cuando TCR < 150% (CCR):
- Se activa modo de emergencia
- Liquidaciones más agresivas
- Protege solvencia del sistema

---

## 3. MODELO DE TASAS DE INTERÉS

### 3.1 Fixed-Rate Model

A diferencia de Liquity (0% siempre), Mezo usa tasas fijas:

```
- Tasa global aplicada a nuevos préstamos
- Tasa bloqueada por préstamo individual
- Cambio solo via refinance()
- Interés simple (no compuesto)
```

### 3.2 Fees

| Fee | Valor | Destino |
|-----|-------|---------|
| Borrowing Fee | Variable (desde 1%) | PCV |
| Refinance Fee | Configurable | PCV |
| Redemption Fee | 0.5% (no-borrowers) | Sistema |

### 3.3 Protocol Controlled Value (PCV)

```
Fees → PCV → Distribución:
  ├── Bootstrap loan repayment (priority)
  └── Gauge system (máx 50% hasta payback)

Post-payback:
  └── Protocol-Owned Liquidity en Stability Pool
```

---

## 4. LIQUIDACIONES

### 4.1 Proceso de Liquidación

```
1. ICR cae < 110% (MCR)
        ↓
2. Posición liquidable permissionlessly
        ↓
3. IF Stability Pool suficiente:
   ├── Deuda offset contra SP
   └── Collateral distribuido a depositors
        ↓
4. ELSE (SP vacío):
   └── Redistribución a troves activos con ICR > 110%
        ↓
5. Liquidator recibe compensación (MUSD + collateral)
```

### 4.2 Compensación para Liquidators

- Gas compensation automático
- MUSD + porción de collateral
- Garantiza rentabilidad durante volatilidad

### 4.3 Stability Pool

**Para depositantes**:
- Pierden mUSD (absorben deuda)
- Ganan collateral (BTC) con descuento
- Típicamente ganancia neta

**Mecanismo de respaldo**:
- Si SP vacío → redistribución socializada
- Deuda y collateral se distribuyen proporcionalmente
- Elimina necesidad de rescates externos

---

## 5. REDEMPTION MECHANISM

### 5.1 Cómo Funciona

```
Usuario tiene mUSD → Quiere BTC

IF usuario tiene préstamo activo:
  └── Sin fee de redención

ELSE:
  └── Redemption fee: 0.5%

Resultado:
  - mUSD quemado
  - BTC equivalente entregado
  - Piso de precio ≈ $0.995
```

### 5.2 Arbitraje

```
IF mUSD < $1:
  ├── Comprar mUSD barato en mercado
  ├── Redimir por BTC a $1
  └── Profit = (1 - precio_mercado - fee)

IF mUSD > $1:
  ├── Depositar BTC
  ├── Mint mUSD
  ├── Vender mUSD en mercado
  └── Profit = (precio_mercado - 1 - fee)
```

---

## 6. STACK TÉCNICO

### 6.1 Blockchain

```
Mezo Chain:
  ├── Fork de Evmos (modificado)
  ├── Cosmos SDK
  ├── CometBFT consensus
  ├── EVM compatible
  └── Gas fees en BTC
```

### 6.2 Repositorio GitHub

```
github.com/mezo-org/musd
├── solidity/
│   └── contracts/
│       ├── BorrowerOperations.sol
│       ├── TroveManager.sol
│       ├── StabilityPool.sol
│       ├── PriceFeed.sol
│       └── ...
├── dapp/
├── docs/
└── .github/workflows/
```

### 6.3 Tech Stack

| Componente | Tecnología |
|------------|------------|
| Lenguaje | Solidity (33%), TypeScript (67%) |
| Package Manager | pnpm |
| Testing | pnpm test |
| Deployment | Hardhat/custom |
| Licencia | GPL-3.0 |

---

## 7. PROS Y CONTRAS

### 7.1 PROS (Fortalezas)

| Pro | Descripción |
|-----|-------------|
| **100% BTC backed** | Primer stablecoin solo respaldado por Bitcoin |
| **LTV alta (90%)** | Hasta 90% del valor de BTC prestable |
| **Tasas bajas** | Desde 1% (fijas) |
| **Auditorías** | Quantstamp + Thesis Defense |
| **EVM compatible** | Fácil para desarrolladores Solidity |
| **tBTC probado** | 18K+ BTC bridgeados desde 2020 |
| **Sin plazo fijo** | "Buy Now, Pay Never" |
| **Multichain** | Wormhole NTT integration |
| **Métricas fuertes** | $400M depósitos, $2B borrowed |

### 7.2 CONTRAS (Debilidades)

| Contra | Descripción | Impacto |
|--------|-------------|---------|
| **Dependencia tBTC** | Si tBTC falla, sistema colapsa | ALTO |
| **No es Bitcoin L1** | Es un L2/sidechain, no nativo | MEDIO |
| **Centralización tBTC** | Threshold Network tiene operadores limitados | MEDIO |
| **EVM, no UTXO** | Pierde propiedades nativas de Bitcoin | MEDIO |
| **Liquidez nueva** | Menos probado que DAI/LUSD | MEDIO |
| **Recovery Mode** | Puede ser agresivo en volatilidad | BAJO |
| **No 0% interest** | Liquity ofrece 0%, Mezo no | BAJO |
| **Gas en BTC** | Puede ser confuso para usuarios | BAJO |

### 7.3 Riesgos Específicos

**Riesgo de tBTC**:
- Dependencia de Threshold Network
- Operadores pueden ser comprometidos
- Bridge ha funcionado bien pero no es trustless

**Riesgo de Oracle**:
- Dependencia de price feeds externos
- Manipulación posible en teoría

**Riesgo de Contrato**:
- Smart contracts son upgradeable?
- Governance keys existen?

---

## 8. COMPARACIÓN CON OTROS PROTOCOLOS

### 8.1 Tabla Comparativa

| Feature | Mezo mUSD | Liquity LUSD | MakerDAO DAI | Avalon USDa |
|---------|-----------|--------------|--------------|-------------|
| **Collateral** | BTC (tBTC) | ETH | Multi-asset | BTC (FBTC) |
| **Chain** | Mezo (Cosmos) | Ethereum | Ethereum | Multi |
| **MCR** | 110% | 110% | ~150% | Variable |
| **Interest** | Fijo (1%+) | 0% | Variable | 1.37% |
| **Governance** | MEZO token | Immutable | MKR token | ? |
| **TVL** | $400M+ | $500M+ | $5B+ | $700M+ |
| **Audits** | 2 | Multiple | Extensive | ? |
| **Cross-chain** | Wormhole | No | No | LayerZero |

### 8.2 Lo que Mezo hace MEJOR

1. **LTV más alto** (90% vs 66% de otros)
2. **Bitcoin puro** como collateral
3. **EVM compatible** (fácil desarrollo)
4. **Multichain ready** desde inicio

### 8.3 Lo que Mezo hace PEOR

1. **No es 0% interest** (Liquity sí)
2. **No es Bitcoin L1** (depende de sidechain)
3. **Depende de bridge** (tBTC)
4. **Menos descentralizado** que Liquity

---

## 9. OPORTUNIDADES PARA zkUSD

### 9.1 Ventajas de zkUSD sobre Mezo

| Ventaja zkUSD | vs Mezo |
|---------------|---------|
| **Nativo Bitcoin L1** | Mezo es sidechain |
| **ZK proofs** | Mezo es EVM tradicional |
| **No bridge tradicional** | Mezo depende de tBTC |
| **Cross-chain nativo** | Mezo usa Wormhole (bridge) |
| **Charms ecosystem** | Mezo es ecosistema aislado |

### 9.2 Qué Copiar de Mezo

1. **Arquitectura de pools** (ActivePool, StabilityPool, etc.)
2. **Sistema de liquidación** (offset + redistribution)
3. **Redemption mechanism** (arbitrage floor)
4. **Recovery Mode** (protección sistémica)
5. **Fee structure** (borrowing, redemption)

### 9.3 Qué Mejorar

1. **0% interest** como Liquity
2. **Sin dependencia de bridge**
3. **Más descentralizado** (sin operadores centrales)
4. **Native Bitcoin** (Charms en L1)
5. **Templates reutilizables**

---

## 10. IMPLICACIONES PARA CONTRIBUCIONES OPEN SOURCE

### 10.1 Gaps en Ecosistema Bitcoin DeFi

| Gap | Oportunidad |
|-----|-------------|
| No hay CDP library para Bitcoin | Crear "CDP.charms" |
| No hay token templates para Charms | Crear "CharmTokens" |
| No hay oracle standard | Crear "CharmOracles" |
| No hay liquidation bots | Crear "CharmKeepers" |
| No hay testing framework | Crear "CharmTest" |

### 10.2 Estructura de Contribución Propuesta

```
zkUSD-Protocol/
├── contracts/
│   ├── core/
│   │   ├── Vault.charms        # CDP base
│   │   ├── StabilityPool.charms
│   │   └── Liquidator.charms
│   ├── tokens/
│   │   ├── zkUSD.charms        # Stablecoin
│   │   └── zkGOV.charms        # Governance
│   └── oracles/
│       └── PriceFeed.charms
├── sdk/
│   ├── typescript/             # SDK para developers
│   └── rust/                   # SDK nativo
├── templates/
│   ├── cdp-basic/              # Template CDP simple
│   ├── token-fungible/         # Template token
│   └── oracle-integration/     # Template oracle
├── docs/
├── tests/
└── examples/
```

### 10.3 Impacto de Contribución

**Nivel 1**: zkUSD funcional (hackathon)
**Nivel 2**: Templates reutilizables (post-hackathon)
**Nivel 3**: SDK completo (6 meses)
**Nivel 4**: Ecosistema de tools (1 año)

---

## FUENTES

### Documentación Oficial
- Mezo Docs: https://mezo.org/docs/users/musd
- Architecture: https://mezo.org/docs/users/musd/architecture-and-terminology/
- How MUSD Works: https://mezo.org/blog/how-musd-works-and-why-its-stable/

### GitHub
- MUSD Repo: https://github.com/mezo-org/musd
- Mezo Org: https://github.com/mezo-org

### Referencias
- Mezo Mainnet: https://mezo.org/blog/mezo-mainnet-is-here/
- 2025 Roadmap: https://blog.mezo.org/mezo-the-2025-roadmap/
- Multichain: https://mezo.org/blog/mezo-and-musd-go-multichain-with-wormhole/
