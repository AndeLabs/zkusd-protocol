# ANALISIS TECNICO: LIQUITY PROTOCOL Y LUSD

## Analisis para aplicacion a zkUSD - Stablecoin CDP en Bitcoin via Charms

**Fecha**: 13 de Diciembre 2025
**Autor**: Investigacion para BOS Hackathon 2025
**Objetivo**: Extraer lecciones de diseño de Liquity para implementar zkUSD

---

## INDICE

1. [Vision General de Liquity](#1-vision-general-de-liquity)
2. [Modelo Unico: 0% Interest](#2-modelo-unico-0-interest)
3. [Mecanismos Core](#3-mecanismos-core)
4. [Arquitectura de Smart Contracts](#4-arquitectura-de-smart-contracts)
5. [Comparacion con MakerDAO](#5-comparacion-con-makerdao)
6. [Metricas y Adopcion](#6-metricas-y-adopcion)
7. [Problemas Encontrados](#7-problemas-encontrados)
8. [Lecciones para zkUSD](#8-lecciones-para-zkusd)
9. [Roadmap de Implementacion](#9-roadmap-de-implementacion)

---

## 1. VISION GENERAL DE LIQUITY

### 1.1 Que es Liquity

Liquity es un **protocolo de borrowing descentralizado** que permite prestamos sin interes contra ETH como colateral. Los prestamos se pagan en **LUSD**, una stablecoin anclada al USD.

**Caracteristicas principales:**
- 0% tasa de interes (solo fee unico)
- 110% collateral ratio minimo (muy bajo)
- Completamente inmutable y sin gobernanza
- Solo ETH como colateral
- Lanzado en Abril 2021

### 1.2 Estadisticas Clave

| Metrica | Valor |
|---------|-------|
| Peak TVL | $4.6B (2021) |
| TVL Actual | ~$250M+ |
| Usuarios | Miles |
| Uptime | 100% desde lanzamiento |
| Tiempo operando | 4+ años |
| Liquidaciones exitosas | Miles (incluye crash Mayo 2021) |

### 1.3 Principios de Diseño

```
1. INMUTABILIDAD
   - No governance
   - Parametros en piedra
   - No admin keys

2. DESCENTRALIZACION
   - Solo ETH (asset mas descentralizado)
   - No oracles centralizados
   - Sin puntos de falla

3. EFICIENCIA DE CAPITAL
   - 110% MCR (vs 130-150% competencia)
   - Liquidaciones instantaneas
   - Sin lock-up periods

4. SIMPLICIDAD
   - Un solo tipo de colateral
   - Mecanismos matematicos puros
   - Sin opcionalidad compleja
```

---

## 2. MODELO UNICO: 0% INTEREST

### 2.1 Como es Sostenible

Liquity reemplaza los intereses variables con:

#### A) One-Time Borrowing Fee

**Formula:**
```
fee = (baseRate + 0.5%) * LUSD_borrowed
```

**Caracteristicas:**
- Minimo: 0.5%
- Maximo: 5%
- Cobrado al crear/aumentar prestamo
- NO hay fees recurrentes

#### B) Base Rate Mechanism

El `baseRate` es una variable dinamica que:

1. **Aumenta con redemptions:**
   ```
   Redemption → baseRate ↑ → Borrowing Fee ↑ → Menos borrowing
   ```

2. **Decae con el tiempo:**
   ```
   Half-life: 12 horas
   Sin redemptions → baseRate ↓ → Borrowing Fee ↓ → Mas borrowing
   ```

3. **Formula de decay:**
   ```rust
   // Decay exponencial basado en tiempo
   time_passed = block.timestamp - lastFeeOpTime;
   decay_factor = 0.5 ^ (time_passed / DECAY_HALF_LIFE);
   baseRate = baseRate * decay_factor;
   ```

**Efecto de auto-regulacion:**
```
LUSD < $1 → Redemptions ↑ → baseRate ↑ → Borrowing costoso → LUSD supply ↓ → Peg recovery
LUSD > $1 → Redemptions ↓ → baseRate ↓ → Borrowing barato → LUSD supply ↑ → Peg recovery
```

### 2.2 Por que Cambiaron a V2

**Problema en V1:**
- En ambiente de tasas altas (2022-2024), LUSD no podia competir con yields de 10-50%
- Usuarios preferian stablecoins que pagaban interes
- Redemptions excesivas forzaban collateral ratios muy altos
- Capital efficiency se degradaba

**Solucion en V2 (BOLD):**
- **User-set interest rates** (0.5% - 1000%)
- Borrowers eligen su tasa (cost vs redemption risk)
- Redemptions afectan primero a tasas mas bajas
- 100% de ingresos van a Stability Pool (sustainable yield)

**Leccion clave:**
> El 0% interes es elegante pero inflexible. En mercados con tasas altas, necesitas mecanismos de yield sostenible para mantener demanda de la stablecoin.

---

## 3. MECANISMOS CORE

### 3.1 Collateral Ratio System

#### Minimum Collateral Ratio (MCR)

**Normal Mode:**
```
MCR = 110%

Si collateral_value / debt_value < 1.10 → LIQUIDABLE
```

**Recovery Mode:**
```
Trigger: Total Collateral Ratio (TCR) < 150%

Liquidation threshold: 150% (vs 110% normal)
```

#### Total Collateral Ratio (TCR)

```
TCR = (Total ETH value in system) / (Total LUSD debt)

Ejemplo:
- 1000 ETH @ $2000 = $2M
- 1.5M LUSD debt
- TCR = $2M / $1.5M = 133%

Si TCR < 150% → RECOVERY MODE
```

### 3.2 Stability Pool

**Concepto:**
Pool de LUSD que absorbe bad debt instantaneamente.

**Como funciona:**

1. **Depositors proveen LUSD:**
   ```
   Alice deposita: 10,000 LUSD
   Bob deposita: 5,000 LUSD
   Carol deposita: 5,000 LUSD

   Total Pool: 20,000 LUSD
   ```

2. **Liquidacion ocurre:**
   ```
   Trove liquidado:
   - Debt: 8,000 LUSD
   - Collateral: 4 ETH ($2000/ETH = $8,800)

   Sistema:
   - Quema 8,000 LUSD del pool proporcionalmente
   - Distribuye 4 ETH proporcionalmente
   ```

3. **Distribucion:**
   ```
   Alice: -4,000 LUSD, +2 ETH
   Bob:   -2,000 LUSD, +1 ETH
   Carol: -2,000 LUSD, +1 ETH

   Alice gano: ($4,400 ETH value - $4,000 LUSD) = $400 profit
   ```

**Matematicas escalables - Product-Sum:**

El desafio: actualizar miles/millones de depositos es gas-prohibitivo.

**Solucion elegante:**

```rust
// Variables globales (O(1) gas)
P: f64  // Product depletion factor
S: f64  // Sum of ETH gains per unit LUSD

// Por liquidacion
P_new = P * (1 - debt_liquidated / total_pool)
S_new = S + (ETH_gained / total_pool)

// Por usuario (calculado on-demand)
compounded_deposit = initial_deposit * (P_current / P_snapshot)
ETH_gain = initial_deposit * (S_current - S_snapshot)
```

**Genialidad:**
- Solo 2 variables globales se actualizan (gas constante)
- Cada usuario calcula su estado cuando interactua
- Soporta millones de depositors sin escalar gas costs

### 3.3 Redemption Mechanism

**Proposito:** Mantener floor price de LUSD en $1.

**Como funciona:**

```
1. Usuario tiene LUSD trading < $1
2. Redeem LUSD por $1 de ETH del sistema
3. Sistema paga deuda de Troves mas riesgosos
```

**Ejemplo:**
```
LUSD = $0.98

Arbitrageur:
1. Compra 1000 LUSD por $980
2. Redeem por $1000 de ETH
3. Profit: $20 (menos fees)

Efecto:
- LUSD supply baja
- Presion al alza en precio
- Peg restaurado
```

**Redemption ordering:**
```sql
-- V1: Por collateral ratio
SELECT * FROM troves
ORDER BY (collateral_value / debt_value) ASC
LIMIT needed_for_redemption;

-- V2: Por interest rate
SELECT * FROM troves
ORDER BY interest_rate ASC
LIMIT needed_for_redemption;
```

**Redemption fee:**
```
fee = (baseRate + 0.5%) * ETH_redeemed

Minimo: 0.5%
Se cobra en ETH del usuario
```

**Protecciones:**

1. **Fee dinamico:** Disuade redemptions masivas
2. **14 dias de gracia:** No redemptions en primeras 2 semanas post-launch
3. **Disabled en crash:** Si TCR < 110%, redemptions bloqueadas

### 3.4 Recovery Mode

**Trigger:**
```
TCR < 150%
```

**Cambios en Recovery Mode:**

| Aspecto | Normal Mode | Recovery Mode |
|---------|-------------|---------------|
| Liquidation threshold | 110% | 150% |
| Borrowing fee | 0.5% - 5% | 0% |
| New borrowing | Allowed si >110% | Solo si mejora TCR o >150% |
| Liquidation penalty | 10% | 10% (max) |
| Collateral recovery | No | Si, surplus >110% recuperable |

**Incentivos en Recovery:**

```
1. Borrowing fee = 0%
   → Incentiva crear Troves con alto CR
   → Mejora TCR

2. Liquidaciones hasta 150%
   → Incentiva cerrar posiciones riesgosas
   → Reduce systemic risk

3. Repayments sin costo
   → Incentiva pagar deuda
   → Mejora TCR
```

**Caso real - Mayo 2021 ETH Crash:**

```
Crash: ETH $4000 → $1700 en horas

Resultado:
- Recovery Mode activado: TCR < 150%
- 189 Troves liquidados en Recovery
- 121 Troves liquidados en Normal
- 93.5M LUSD debt offset
- 48,668 ETH distribuidos a Stability Pool
- Sistema permanecio solvente
- Cero bad debt
```

### 3.5 Liquidation Mechanism

**Criterios:**

```rust
fn is_liquidatable(trove: &Trove, mode: Mode) -> bool {
    let icr = trove.collateral_value / trove.debt;

    match mode {
        Normal => icr < 1.10,
        Recovery => icr < 1.50 && TCR < 1.50
    }
}
```

**Process:**

```
1. Cualquiera puede llamar liquidate(trove_id)

2. Sistema verifica:
   - ICR < threshold?
   - Price oracle valido?

3. Si liquidable:

   A) Stability Pool tiene LUSD?
      → Usar pool (instantaneo)

   B) Pool vacio?
      → Redistribucion a otros Troves
```

**Redistribucion mechanism:**

```rust
// Cuando Stability Pool vacio
// Deuda y colateral se redistribuyen proporcionalmente

for trove in active_troves {
    additional_debt = liquidated_debt * (trove.collateral / total_collateral);
    additional_coll = liquidated_coll * (trove.collateral / total_collateral);

    trove.debt += additional_debt;
    trove.collateral += additional_coll;
}
```

**Optimizacion:** Rewards pendientes no se escriben a storage inmediatamente, solo cuando usuario interactua (ahorra gas masivo).

**Gas compensation:**

```
Liquidator recibe:
- 200 LUSD fijo
- 0.5% del collateral del Trove

Formula:
reward = 200 LUSD + (0.005 * trove.collateral_ETH)
```

**Batch liquidations:**

```
Costos por Trove:
- 1 Trove:    215K - 450K gas
- 10 Troves:  75K - 85K gas/trove
- 65 Troves:  65K - 70K gas/trove
- Max batch:  160-185 Troves

Razon: EIP-2200 net metering (storage refunds)
```

---

## 4. ARQUITECTURA DE SMART CONTRACTS

### 4.1 Contratos Principales

```
┌─────────────────────────────────────────────────┐
│         LIQUITY PROTOCOL ARCHITECTURE           │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────────┐      ┌────────────────┐  │
│  │ BorrowerOps.sol  │◄────►│ TroveManager   │  │
│  │                  │      │    .sol        │  │
│  │ - openTrove()    │      │                │  │
│  │ - closeTrove()   │      │ - liquidate()  │  │
│  │ - adjustTrove()  │      │ - redeem()     │  │
│  │ - repayLUSD()    │      │ - Trove state  │  │
│  └──────────────────┘      └────────────────┘  │
│           │                        │            │
│           │                        │            │
│           ▼                        ▼            │
│  ┌──────────────────────────────────────────┐  │
│  │         LiquityBase.sol                  │  │
│  │  - Constants                             │  │
│  │  - Common functions                      │  │
│  └──────────────────────────────────────────┘  │
│           │                                     │
│           │                                     │
│           ▼                                     │
│  ┌──────────────────┐      ┌────────────────┐  │
│  │ StabilityPool    │      │ SortedTroves   │  │
│  │    .sol          │      │    .sol        │  │
│  │                  │      │                │  │
│  │ - provideToSP()  │      │ Doubly-linked  │  │
│  │ - withdrawFromSP()│     │ list by ICR    │  │
│  │ - Product-Sum    │      │                │  │
│  └──────────────────┘      └────────────────┘  │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │            POOL CONTRACTS                │  │
│  │                                          │  │
│  │  ActivePool  │  DefaultPool             │  │
│  │  StabilityPool │  CollSurplusPool       │  │
│  │  LQTYStaking                             │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ┌──────────────────┐                          │
│  │   LUSDToken.sol  │                          │
│  │                  │                          │
│  │  ERC-20 + EIP-2612                         │
│  └──────────────────┘                          │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 4.2 BorrowerOperations.sol

**Funciones principales:**

```solidity
// Abrir nueva posicion
function openTrove(
    uint _maxFeePercentage,
    uint _LUSDAmount,
    address _upperHint,
    address _lowerHint
) external payable;

// Ajustar posicion existente
function adjustTrove(
    uint _maxFeePercentage,
    uint _collWithdrawal,
    uint _LUSDChange,
    bool _isDebtIncrease,
    address _upperHint,
    address _lowerHint
) external payable;

// Cerrar posicion
function closeTrove() external;

// Repagar deuda
function repayLUSD(uint _LUSDAmount) external;
```

**Responsabilidades:**
- Validar inputs del usuario
- Calcular fees
- Actualizar Trove via TroveManager
- Llamar a Pools para mover fondos
- Mantener lista ordenada (SortedTroves)

### 4.3 TroveManager.sol

**Funciones principales:**

```solidity
// Liquidar un Trove
function liquidate(address _borrower) external;

// Liquidar batch
function batchLiquidateTroves(address[] calldata _troveArray) external;

// Redeem LUSD por ETH
function redeemCollateral(
    uint _LUSDAmount,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint _partialRedemptionHintNICR,
    uint _maxIterations,
    uint _maxFeePercentage
) external;

// Calcular ICR
function getCurrentICR(address _borrower, uint _price)
    external view returns (uint);
```

**Estado almacenado:**

```solidity
struct Trove {
    uint debt;
    uint coll;
    uint stake;
    Status status;
    uint128 arrayIndex;
}

enum Status {
    nonExistent,
    active,
    closedByOwner,
    closedByLiquidation,
    closedByRedemption
}

mapping(address => Trove) public Troves;
```

### 4.4 StabilityPool.sol

**Formula Product-Sum implementada:**

```solidity
// Variables globales
uint128 public P = DECIMAL_PRECISION;  // Depletion product
uint128 public currentScale;
uint128 public currentEpoch;

mapping(uint128 => mapping(uint128 => uint)) public epochToScaleToSum;

// Snapshots por depositor
struct Snapshot {
    uint P;
    uint S;
    uint128 scale;
    uint128 epoch;
}

mapping(address => Snapshot) public depositSnapshots;

// Calcular compounded deposit
function getCompoundedLUSDDeposit(address _depositor)
    public view returns (uint) {

    uint initialDeposit = deposits[_depositor];
    if (initialDeposit == 0) return 0;

    Snapshot memory snapshot = depositSnapshots[_depositor];

    uint compoundedDeposit = _getCompoundedStakeFromSnapshots(
        initialDeposit,
        snapshot
    );

    return compoundedDeposit;
}
```

**Optimizacion de gas:**
- Solo actualiza P y S en liquidaciones (O(1))
- Calcula estado individual on-demand
- Escala con epochs para evitar underflow

### 4.5 SortedTroves.sol

**Implementacion de doubly-linked list:**

```solidity
// Node structure
struct Node {
    bool exists;
    address nextId;
    address prevId;
}

mapping(address => Node) public data;
address public head;
address public tail;
uint256 public size;

// Insert con hints (evita iterar toda lista)
function insert(
    address _id,
    uint256 _NICR,
    address _prevId,
    address _nextId
) external;

// Remove
function remove(address _id) external;

// Find insert position
function findInsertPosition(
    uint256 _NICR,
    address _prevId,
    address _nextId
) external view returns (address, address);
```

**Por que linked list?**
- Inserts/removes O(1) con hints
- No necesita reordenar array completo
- Gas eficiente para grandes cantidades de Troves

**Hints system:**
- Frontend/bots calculan posicion off-chain
- Pasan `_prevId` y `_nextId` como hints
- Contract valida hints
- Si invalidos, busca posicion (mas gas, pero funciona)

### 4.6 Pool Contracts

**ActivePool.sol:**
```solidity
// Almacena collateral y deuda de Troves activos
uint256 internal ETH;
uint256 internal LUSDDebt;

function sendETH(address _account, uint _amount) external;
```

**DefaultPool.sol:**
```solidity
// Almacena collateral y deuda de Troves cerrados esperando redistribucion
```

**CollSurplusPool.sol:**
```solidity
// Almacena surplus collateral de Troves liquidados en Recovery
// Owners pueden reclamar
```

---

## 5. COMPARACION CON MAKERDAO

### 5.1 Tabla Comparativa

| Aspecto | Liquity | MakerDAO | Ganador |
|---------|---------|----------|---------|
| **Governanza** | Cero (inmutable) | MKR token voting | Liquity (simplicidad) |
| **Collateral** | Solo ETH | 20+ assets | MakerDAO (flexibilidad) |
| **MCR** | 110% | 130-175% | Liquity (eficiencia) |
| **Interes** | 0% (fee unico) | Variable (DSR) | Empate (depende mercado) |
| **Liquidaciones** | Instant (Stability Pool) | Auctions (Dutch) | Liquity (velocidad) |
| **Peg mechanism** | Redemptions | PSM + DSR | Empate |
| **Riesgo sistematico** | Solo ETH price | Multi-collateral | Liquity (menor superficie) |
| **Escalabilidad** | Alta (Product-Sum) | Media | Liquity |
| **Flexibilidad** | Baja (inmutable) | Alta (governance) | MakerDAO |
| **TVL** | ~$250M | ~$5B+ | MakerDAO |
| **Adopcion** | Nicho | Mainstream | MakerDAO |

### 5.2 Que Simplifico Liquity

**1. Gobernanza:**
```
MakerDAO:
- MKR token holders votan
- Executive votes
- Governance polls
- Risk teams
- Procesos lentos (semanas)

Liquity:
- Cero gobernanza
- Parametros inmutables
- Algoritmos matematicos
- Sin procesos humanos
```

**2. Collateral:**
```
MakerDAO:
- 20+ collateral types
- Diferentes risk parameters por asset
- Complejas integraciones de oracles
- Surface area grande

Liquity:
- Solo ETH
- Un set de parametros
- Oracle simple
- Minimal surface area
```

**3. Liquidaciones:**
```
MakerDAO (Liquidations 2.0):
- Dutch auctions
- Proceso multi-step
- Keepers compiten
- Puede tomar tiempo

Liquity:
- Instant via Stability Pool
- Un solo paso
- Pre-funded liquidity
- Sub-segundo
```

**4. Fees:**
```
MakerDAO:
- Stability fee (APR variable)
- DSR (Dai Savings Rate)
- Governance ajusta rates
- Complejo calcular costo total

Liquity:
- One-time borrowing fee
- Redemption fee
- Formulas fijas
- Costo predecible
```

### 5.3 Trade-offs

**Liquity gana en:**
- Simplicidad
- Descentralizacion
- Capital efficiency
- Velocidad de liquidacion
- Inmutabilidad

**MakerDAO gana en:**
- Flexibilidad
- Diversificacion de riesgo
- Capacidad de adaptacion
- TVL y adopcion
- Ecosistema y partnerships

**Leccion clave:**
> Liquity sacrifica flexibilidad por simplicidad y descentralizacion. MakerDAO sacrifica simplicidad por adaptabilidad y escala. No hay "mejor" absoluto, depende de prioridades.

---

## 6. METRICAS Y ADOPCION

### 6.1 TVL Historico

```
Abril 2021:   Launch
Mayo 2021:    $2.7B (ETH bull run)
Agosto 2021:  $4.6B (peak)
Mayo 2022:    $1.8B (Luna/UST crash contagion)
2023-2024:    $250M - $800M (consolidacion)
2025:         ~$250M+ (pre-V2)
```

**Factores de TVL:**

```
Positivos:
✓ 0% interes atractivo en bear markets
✓ Capital efficiency (110% MCR)
✓ Sin governance risk
✓ Track record de seguridad

Negativos:
✗ Redemption risk en high-interest environments
✗ Solo ETH (no diversification)
✗ LUSD sin yield nativo (V1)
✗ Competencia con protocolos que pagan APY
```

### 6.2 LUSD Peg Performance

**Estabilidad general:**
```
95% del tiempo: $0.98 - $1.02
Stress tests: Mantuvo peg en May 2021 crash
Redemptions: Floor efectivo en $0.995
```

**Issues:**
```
2022-2024 high-rate environment:
- LUSD tendencia a $0.97-$0.99
- Redemptions frecuentes
- Usuarios forzados a CR muy altos (200%+)
- Reduccion de capital efficiency
```

**V2 addressing:**
- User-set rates permiten competir
- Yield sostenible en Stability Pool
- Mejor demand-side economics

### 6.3 Liquidation Metrics

**May 2021 Crash (mayor stress test):**

```
Contexto:
- ETH: $4000 → $1700 en ~24h
- 40%+ caida

Resultados:
- 310 Troves liquidados total
  - 121 en Normal Mode
  - 189 en Recovery Mode

- $93.5M LUSD debt offset
- 48,668 ETH distribuidos
- Cero bad debt
- Sistema funciono perfectamente

Stability Pool depositors:
- Ganaron ETH con discount
- ROI positivo vs hold LUSD
```

**Eficiencia:**
```
Liquidations velocidad: < 1 segundo
Gas costs: 65-85K gas/trove (batched)
Slippage: Cero (fixed price)
Bad debt: Cero historico
```

### 6.4 Problemas Encontrados

**1. Redemption Pressure (2022-2024):**

```
Problema:
- Tasas de mercado: 10-50%
- LUSD: 0% yield
- Demand baja → LUSD < $1
- Redemptions frecuentes
- Users mantienen CR 200%+ para evitar redemptions
- Capital efficiency destruida

Solucion (V2):
- User-set interest rates
- Yield sostenible en Stability Pool
```

**2. Hint Manipulation:**

```
Problema:
- SortedTroves usa hints para eficiencia
- Hints pueden quedar stale si otras txs se procesan primero
- Attacker podria crear big Trove en primera posicion
- Redemptions pequeñas fallarian

Mitigacion:
- Contract valida hints, busca posicion si invalidos
- Attack es caro (mantener big Trove con low CR = riesgo)
- Flashbots permite evitar mempool
```

**3. Front-running:**

```
Problema:
- Liquidations/redemptions visibles en mempool
- Bots pueden front-run

Mitigacion:
- Redemption fee minimo 0.5% (protege contra arb front-run)
- Gas compensation para liquidators
- Flashbots para transacciones sensibles
```

**4. Scalability (resuelto):**

```
Problema inicial:
- Actualizar miles de depositors en Stability Pool = prohibitivo

Solucion:
- Product-Sum formula
- O(1) gas sin importar depositors
- Innovacion tecnica clave
```

---

## 7. PROBLEMAS ENCONTRADOS

### 7.1 Redemption Attack Vectors

**A) Hint Manipulation:**

```solidity
// Scenario
1. Attacker crea Trove grande con CR justo sobre 110%
2. Trove queda primero en SortedTroves
3. Cualquier redemption < deuda del Trove usa ese hint
4. Si hint falla → redemption falla (DoS temporal)

// Mitigaciones
- Hints son opcionales, contract busca si invalidos
- Attack es caro (mantener gran Trove riesgoso = CR bajo)
- Profitable solo si LUSD << $1 (raro)
```

**B) TCR Manipulation:**

```solidity
// Scenario
1. TCR cerca de 110%
2. Attacker con mucho LUSD redeem masivamente
3. TCR baja mas → sistema en crisis

// Mitigaciones
- Redemptions bloqueadas si TCR < 110%
- baseRate aumenta con redemptions (disuade masivas)
- Economicamente irracional (LUSD valdria > $1 en crash)
```

### 7.2 Lecciones de Seguridad

**1. Inmutabilidad = Arma de doble filo:**

```
Ventajas:
✓ No governance attacks
✓ No rug pulls
✓ Confianza maxima

Desventajas:
✗ No se pueden fix bugs post-deploy
✗ No adaptacion a condiciones de mercado
✗ Requiere diseño impecable pre-launch
```

**Accion para zkUSD:**
- Considerar pausability limitada en V1
- Upgrade path via new contracts
- No inmutabilidad total al inicio

**2. Single collateral = Simplicidad + Riesgo:**

```
Ventajas:
✓ Menor superficie de ataque
✓ Testing mas exhaustivo
✓ Oracles mas simples

Desventajas:
✗ Riesgo concentrado en un asset
✗ Si ETH falla → sistema falla
✗ Menos diversificacion
```

**Accion para zkUSD:**
- Empezar con solo xBTC (como Liquity con ETH)
- Considerar expansion futura
- Multi-collateral via separados pools (como V2)

**3. Testing en condiciones extremas:**

```
Liquity caso de estudio:
- ETH -40% en 24h → Sistema funciono
- Recovery mode activado correctamente
- Cero bad debt generado
- Stability Pool funciono como diseñado
```

**Accion para zkUSD:**
- Simular BTC crashes 50%+
- Test con pools vacios
- Test redistribution mechanism
- Fuzzing exhaustivo

---

## 8. LECCIONES PARA zkUSD

### 8.1 Que Copiar Directamente

#### A) Stability Pool Mechanism

**Aplicabilidad: ALTA (95%)**

```rust
// Estructura para zkUSD en Charms

pub struct StabilityPool {
    pub total_zkusd: u64,
    pub p_product: u128,      // Depletion factor
    pub s_sum_btc: u128,       // BTC gains sum
    pub epoch: u32,
    pub scale: u32,
}

pub struct Depositor {
    pub zkusd_amount: u64,
    pub snapshot_p: u128,
    pub snapshot_s: u128,
    pub snapshot_epoch: u32,
    pub snapshot_scale: u32,
}

// Liquidation handler
pub fn liquidate_via_pool(
    pool: &mut StabilityPool,
    debt: u64,
    collateral_btc: u64
) -> Result<()> {

    // Update P (depletion factor)
    let depletion = debt as u128 / pool.total_zkusd as u128;
    pool.p_product = pool.p_product * (PRECISION - depletion) / PRECISION;

    // Update S (BTC gains sum)
    let btc_per_zkusd = collateral_btc as u128 / pool.total_zkusd as u128;
    pool.s_sum_btc += btc_per_zkusd;

    // Update pool size
    pool.total_zkusd -= debt;

    Ok(())
}

// Calculate user position on-demand
pub fn get_compounded_deposit(
    depositor: &Depositor,
    pool: &StabilityPool
) -> (u64, u64) {

    let p_ratio = pool.p_product / depositor.snapshot_p;
    let compounded_zkusd = depositor.zkusd_amount * p_ratio / PRECISION;

    let s_diff = pool.s_sum_btc - depositor.snapshot_s;
    let btc_gain = depositor.zkusd_amount * s_diff / PRECISION;

    (compounded_zkusd, btc_gain)
}
```

**Adaptaciones para UTXO:**
- Pool state en UTXO con datos globales
- Depositors mantienen UTXO individual con snapshots
- Liquidacion consume pool UTXO, produce nuevo con P/S actualizados
- Withdraw consume depositor UTXO + lee pool state

**Ventajas:**
✓ Probado en batalla ($4B+ manejados)
✓ Gas eficiente (O(1))
✓ Matematicamente elegante
✓ Escalable a millones de usuarios

#### B) BaseRate Fee Mechanism

**Aplicabilidad: MEDIA (70%)**

```rust
// zkUSD adaption

pub struct FeeState {
    pub base_rate: u64,           // Base rate en basis points
    pub last_fee_time: u64,       // Timestamp ultima operacion
}

const MIN_FEE_BPS: u64 = 50;      // 0.5%
const MAX_FEE_BPS: u64 = 500;     // 5%
const DECAY_HALF_LIFE: u64 = 43200; // 12 horas en segundos

pub fn calculate_borrowing_fee(
    fee_state: &mut FeeState,
    zkusd_amount: u64,
    current_time: u64
) -> u64 {

    // Apply decay
    let time_passed = current_time - fee_state.last_fee_time;
    let decay_factor = 0.5_f64.powf(time_passed as f64 / DECAY_HALF_LIFE as f64);
    fee_state.base_rate = (fee_state.base_rate as f64 * decay_factor) as u64;

    // Calculate fee
    let fee_rate = fee_state.base_rate + MIN_FEE_BPS;
    let fee_rate = fee_rate.min(MAX_FEE_BPS);

    let fee = zkusd_amount * fee_rate / 10000;

    fee
}

pub fn update_base_rate_on_redemption(
    fee_state: &mut FeeState,
    zkusd_redeemed: u64,
    total_zkusd_supply: u64,
    current_time: u64
) {

    // Decay first
    calculate_borrowing_fee(fee_state, 0, current_time);

    // Increase based on redemption size
    let redemption_fraction = (zkusd_redeemed * 10000) / total_zkusd_supply;
    fee_state.base_rate += redemption_fraction;
    fee_state.base_rate = fee_state.base_rate.min(MAX_FEE_BPS - MIN_FEE_BPS);

    fee_state.last_fee_time = current_time;
}
```

**Consideracion:**
- En modelo UTXO, mantener state global (base_rate) requiere patron especial
- Opcion 1: UTXO singleton para fee state (consume y recrea)
- Opcion 2: Oracle/indexer mantiene, incluye en proofs

**Alternativa mas simple para MVP:**
```rust
// Fixed fee para MVP
const BORROWING_FEE: u64 = 100; // 1%
const REDEMPTION_FEE: u64 = 50;  // 0.5%
```

#### C) Recovery Mode

**Aplicabilidad: ALTA (90%)**

```rust
// Sistema de modos para zkUSD

pub enum SystemMode {
    Normal,
    Recovery,
}

pub fn get_system_mode(
    total_collateral_btc: u64,
    total_zkusd_debt: u64,
    btc_price_usd: u64
) -> SystemMode {

    let collateral_value = total_collateral_btc * btc_price_usd;
    let tcr = (collateral_value * 100) / total_zkusd_debt;

    if tcr < 150 {
        SystemMode::Recovery
    } else {
        SystemMode::Normal
    }
}

pub fn get_liquidation_threshold(mode: SystemMode) -> u64 {
    match mode {
        SystemMode::Normal => 110,   // 110% MCR
        SystemMode::Recovery => 150, // 150% MCR
    }
}

pub fn get_borrowing_fee(mode: SystemMode, base_fee: u64) -> u64 {
    match mode {
        SystemMode::Normal => base_fee,
        SystemMode::Recovery => 0, // Free borrowing to encourage CR improvement
    }
}

pub fn can_borrow(
    mode: SystemMode,
    vault_cr: u64,
    action_improves_tcr: bool
) -> bool {
    match mode {
        SystemMode::Normal => vault_cr >= 110,
        SystemMode::Recovery => {
            (vault_cr >= 150) || action_improves_tcr
        }
    }
}
```

**Beneficio:**
- Auto-regulacion en crisis
- Incentiva comportamiento correcto
- Probado en crash real (May 2021)

#### D) Redemption Mechanism

**Aplicabilidad: MEDIA-ALTA (80%)**

```rust
// Redemption para zkUSD

pub fn redeem_zkusd(
    zkusd_amount: u64,
    btc_price: u64,
    sorted_vaults: &mut Vec<Vault>,
    redemption_fee_bps: u64
) -> Result<Vec<RedemptionResult>> {

    let btc_to_redeem = (zkusd_amount * USD_PRECISION) / btc_price;
    let fee = btc_to_redeem * redemption_fee_bps / 10000;
    let btc_to_user = btc_to_redeem - fee;

    let mut remaining_zkusd = zkusd_amount;
    let mut results = Vec::new();

    // Iterate vaults from lowest CR
    for vault in sorted_vaults.iter_mut() {
        if remaining_zkusd == 0 {
            break;
        }

        let redeemable_from_vault = remaining_zkusd.min(vault.debt);
        let btc_from_vault = (redeemable_from_vault * USD_PRECISION) / btc_price;

        // Update vault
        vault.debt -= redeemable_from_vault;
        vault.collateral -= btc_from_vault;

        results.push(RedemptionResult {
            vault_id: vault.id,
            zkusd_redeemed: redeemable_from_vault,
            btc_received: btc_from_vault,
        });

        remaining_zkusd -= redeemable_from_vault;
    }

    Ok(results)
}
```

**Adaptacion UTXO:**
- Redemption consume multiples vault UTXOs
- Produce nuevos vault UTXOs con deuda reducida
- Paga BTC a redeemer
- Challenge: encontrar vaults on-chain sin indexer

**Solucion:**
- Requiere hints (como Liquity)
- Off-chain service indexa vaults por CR
- User provee lista de vaults a redeem
- Contract verifica que estan ordenados correctamente

### 8.2 Que Adaptar para UTXO/Charms

#### A) Sorted Data Structures

**Problema:**
- Liquity usa doubly-linked list on-chain
- UTXO no tiene storage persistente

**Solucion 1: Off-chain indexing + Hints**

```rust
// User provee hints calculados off-chain
pub struct VaultHints {
    pub prev_vault_id: [u8; 32],
    pub next_vault_id: [u8; 32],
    pub expected_position: u32,
}

// Contract verifica que hints son validos
pub fn verify_position_hints(
    vault: &Vault,
    hints: &VaultHints,
    prev_vault: &Vault,
    next_vault: &Vault,
) -> bool {

    // Verify vault CR is between prev and next
    vault.get_cr() >= prev_vault.get_cr() &&
    vault.get_cr() <= next_vault.get_cr()
}
```

**Solucion 2: Merkle tree de vaults**

```rust
// Mantener Merkle tree de vaults ordenados por CR
pub struct VaultTree {
    pub root: [u8; 32],
    pub total_vaults: u32,
}

// Probar posicion con Merkle proof
pub fn verify_vault_position(
    vault_id: [u8; 32],
    position: u32,
    merkle_proof: Vec<[u8; 32]>,
    tree_root: [u8; 32],
) -> bool {
    // Verify merkle proof
    verify_merkle_proof(vault_id, position, merkle_proof, tree_root)
}
```

#### B) Global State Management

**Problema:**
- Liquity tiene state mutables (P, S, baseRate, etc.)
- UTXO es stateless

**Solucion: Singleton UTXOs**

```rust
// Patron: UTXO unico que se consume y recrea

pub struct GlobalState {
    // Stability Pool
    pub pool_zkusd: u64,
    pub pool_p: u128,
    pub pool_s: u128,

    // System totals
    pub total_collateral: u64,
    pub total_debt: u64,

    // Fees
    pub base_rate: u64,
    pub last_fee_time: u64,

    // Mode
    pub recovery_mode: bool,
}

// Toda operacion que modifica estado:
// 1. Consume UTXO de GlobalState actual
// 2. Produce nuevo UTXO de GlobalState actualizado

pub fn liquidate_vault(
    ctx: &SpellContext,
    global_state_input: &GlobalState,
    vault_input: &Vault,
) -> Result<(GlobalState, Vec<Output>)> {

    // Update global state
    let mut new_state = global_state_input.clone();
    new_state.total_collateral -= vault_input.collateral;
    new_state.total_debt -= vault_input.debt;

    // Update pool
    liquidate_via_pool(
        &mut new_state.pool_zkusd,
        &mut new_state.pool_p,
        &mut new_state.pool_s,
        vault_input.debt,
        vault_input.collateral,
    )?;

    // Create outputs
    let outputs = vec![
        Output::GlobalState(new_state.clone()),
        // ... otros outputs
    ];

    Ok((new_state, outputs))
}
```

**Desafio:**
- Singleton UTXO es bottleneck (solo una tx a la vez)
- Puede causar contention

**Soluciones:**
- Batching: agrupar multiples operaciones en una tx
- Sharding: separar state (ej: pool state vs fee state)
- Optimistic updates: permitir parallelism con conflict resolution

#### C) Oracle Integration

**Problema:**
- Liquity usa Chainlink + Tellor con fallback
- Bitcoin no tiene oracles nativos

**Solucion 1: Cross-chain oracle via Charms Beaming**

```rust
// Traer precio desde Ethereum/Cardano via proof

pub struct PriceProof {
    pub btc_price_usd: u64,
    pub timestamp: u64,
    pub source_chain: String,
    pub merkle_proof: Vec<[u8; 32]>,
    pub block_header: BlockHeader,
}

pub fn verify_price_proof(proof: &PriceProof) -> Result<bool> {
    // 1. Verify block header POW
    verify_pow(&proof.block_header)?;

    // 2. Verify merkle proof includes price
    verify_merkle_proof(
        &proof.btc_price_usd.to_le_bytes(),
        &proof.merkle_proof,
        &proof.block_header.merkle_root,
    )?;

    // 3. Verify timestamp is recent
    if proof.timestamp < current_time() - MAX_PRICE_AGE {
        return Err(Error::StalePrice);
    }

    Ok(true)
}
```

**Solucion 2: DLC (Discreet Log Contracts) Oracle**

```rust
// Usar DLC oracle signatures para precios

pub struct DLCPriceAttestation {
    pub price: u64,
    pub timestamp: u64,
    pub oracle_pubkey: [u8; 33],
    pub signature: [u8; 64],
}

pub fn verify_dlc_price(attestation: &DLCPriceAttestation) -> Result<bool> {
    // Verify oracle signature
    verify_schnorr_signature(
        &attestation.oracle_pubkey,
        &attestation.price.to_le_bytes(),
        &attestation.signature,
    )
}
```

**Solucion 3: Median de multiples sources**

```rust
pub fn get_median_price(prices: &[PriceProof]) -> Result<u64> {
    if prices.len() < MIN_ORACLES {
        return Err(Error::InsufficientOracles);
    }

    let mut price_values: Vec<u64> = prices
        .iter()
        .filter(|p| verify_price_proof(p).is_ok())
        .map(|p| p.btc_price_usd)
        .collect();

    price_values.sort();

    // Return median
    Ok(price_values[price_values.len() / 2])
}
```

**Recomendacion para MVP:**
- Empezar con trusted oracle (centralizado)
- Plan de descentralizacion en roadmap
- Usar multiple sources desde inicio (Chainlink via beaming)

#### D) Liquidation Batching

**Problema:**
- En UTXO, cada vault es un UTXO separado
- Liquidar multiples vaults = consumir multiples UTXOs
- Bitcoin tiene limite de tx size

**Solucion: Batching con limites**

```rust
pub const MAX_VAULTS_PER_LIQUIDATION: usize = 10;

pub fn batch_liquidate(
    ctx: &SpellContext,
    global_state: &GlobalState,
    vaults: &[Vault],
) -> Result<Vec<Output>> {

    if vaults.len() > MAX_VAULTS_PER_LIQUIDATION {
        return Err(Error::TooManyVaults);
    }

    let mut new_state = global_state.clone();
    let mut outputs = Vec::new();

    for vault in vaults {
        if !is_liquidatable(vault, &new_state) {
            continue;
        }

        // Liquidate via pool
        liquidate_via_pool(
            &mut new_state,
            vault.debt,
            vault.collateral,
        )?;

        // Add to outputs
        outputs.push(Output::LiquidationEvent {
            vault_id: vault.id,
            debt: vault.debt,
            collateral: vault.collateral,
        });
    }

    // Liquidator compensation
    let compensation = calculate_liquidation_reward(vaults.len());
    outputs.push(Output::Payment {
        to: ctx.liquidator,
        amount: compensation,
    });

    Ok(outputs)
}
```

**Gas optimization en UTXO:**
- Menos preocupacion que Ethereum (no hay gas)
- Pero: tx size limits
- Priorizar: correctness > efficiency para MVP

### 8.3 Innovaciones Posibles

#### A) Multi-Collateral desde Inicio (via V2 pattern)

**Leccin de Liquity:**
- V1 solo ETH → simple pero inflexible
- V2 multi-collateral → separated pools

**Propuesta zkUSD:**

```rust
// Diseño modular desde dia 1

pub enum CollateralType {
    XBTC,      // Wrapped BTC
    WBTC,      // Wrapped BTC via bridge
    LBTC,      // Liquid BTC
    TBTC,      // tBTC
}

pub struct CollateralConfig {
    pub collateral_type: CollateralType,
    pub mcr: u64,              // Minimum CR (puede variar)
    pub ccr: u64,              // Critical CR (recovery mode)
    pub liquidation_penalty: u64,
}

// Separate pools por collateral
pub struct VaultPool {
    pub collateral_type: CollateralType,
    pub config: CollateralConfig,
    pub total_collateral: u64,
    pub total_debt: u64,
    pub stability_pool: StabilityPool,
}

// Sistema puede tener multiples pools independientes
pub struct ZkUSDSystem {
    pub pools: HashMap<CollateralType, VaultPool>,
    pub total_zkusd_supply: u64,
}
```

**Ventajas:**
✓ Diversificacion de riesgo desde inicio
✓ Facil agregar nuevos colaterales
✓ Isolated risk (un collateral failing no mata todo)

**MVP:**
- Empezar solo con xBTC
- Arquitectura lista para expansion

#### B) Progressive Decentralization de Oracle

**Fase 1 (MVP):**
```rust
// Trusted oracle (centralized)
pub struct TrustedOracle {
    pub authorized_pubkey: [u8; 33],
}

pub fn get_price_mvp(signature: &[u8; 64]) -> Result<u64> {
    verify_signature(TRUSTED_ORACLE_PUBKEY, signature)
}
```

**Fase 2:**
```rust
// Multiple oracles con threshold
pub struct MultiOracle {
    pub oracle_pubkeys: Vec<[u8; 33]>,
    pub threshold: usize, // Ej: 3 de 5
}
```

**Fase 3:**
```rust
// Decentralized oracle via Charms Beaming
pub fn get_price_from_chainlink_via_proof(
    proof: &CrossChainProof
) -> Result<u64> {
    verify_cross_chain_proof(proof)
}
```

#### C) Parametric Insurance para Stability Pool

**Innovacion:**

```rust
// Depositors del Stability Pool pueden comprar seguro

pub struct InsurancePolicy {
    pub depositor: [u8; 32],
    pub coverage_amount: u64,
    pub premium_paid: u64,
    pub expiry: u64,
}

pub fn calculate_insurance_premium(
    coverage: u64,
    current_tcr: u64,
    duration_days: u64,
) -> u64 {

    // Premium basado en riesgo sistemico
    let risk_factor = if current_tcr < 150 {
        200 // 2% en recovery
    } else if current_tcr < 200 {
        100 // 1% en riesgo medio
    } else {
        50  // 0.5% en bajo riesgo
    };

    coverage * risk_factor / 10000 * duration_days / 365
}

pub fn claim_insurance(
    policy: &InsurancePolicy,
    actual_loss: u64,
) -> Result<u64> {

    // Paga el menor entre coverage y actual loss
    Ok(actual_loss.min(policy.coverage_amount))
}
```

**Beneficio:**
- Reduce riesgo para Stability Pool depositors
- Aumenta incentivos para proveer liquidez
- Nuevo revenue stream

#### D) Liquidity Mining con Decay

**Problema:**
- Liquity V1 distribuye LQTY a Stability Pool
- Emision fija puede crear dumping

**Mejora para zkUSD:**

```rust
pub struct LiquidityMining {
    pub initial_rate: u64,       // zkUSD rewards por bloque
    pub decay_rate: u64,         // % decay por epoch
    pub min_rate: u64,           // Floor
}

pub fn calculate_rewards(
    lm: &LiquidityMining,
    user_share: u64,
    blocks_since_deposit: u64,
    current_epoch: u64,
) -> u64 {

    let current_rate = lm.initial_rate
        * (100 - lm.decay_rate).pow(current_epoch) / 100_u64.pow(current_epoch);

    let current_rate = current_rate.max(lm.min_rate);

    user_share * current_rate * blocks_since_deposit / TOTAL_SHARES
}
```

**Ventajas:**
✓ Incentivos altos al inicio (bootstrapping)
✓ Reduce dumping a largo plazo
✓ Sostenible economicamente

#### E) Vault Templates

**Innovacion UX:**

```rust
// Vaults pre-configurados para diferentes risk profiles

pub enum VaultTemplate {
    Conservative,  // CR: 200%, bajo risk
    Balanced,      // CR: 150%, medio risk
    Aggressive,    // CR: 120%, alto risk
}

impl VaultTemplate {
    pub fn get_config(&self) -> VaultConfig {
        match self {
            Conservative => VaultConfig {
                target_cr: 200,
                auto_rebalance: true,
                max_debt: 50_000,  // $50k max
            },
            Balanced => VaultConfig {
                target_cr: 150,
                auto_rebalance: true,
                max_debt: 100_000,
            },
            Aggressive => VaultConfig {
                target_cr: 120,
                auto_rebalance: false,
                max_debt: 200_000,
            },
        }
    }
}

// Auto-rebalance feature
pub fn auto_rebalance_vault(
    vault: &mut Vault,
    target_cr: u64,
    current_cr: u64,
) -> Result<()> {

    if current_cr < target_cr - 10 {
        // Add collateral or repay debt
        let debt_to_repay = calculate_rebalance_amount(vault, target_cr);
        repay_debt(vault, debt_to_repay)?;
    }

    Ok(())
}
```

---

## 9. ROADMAP DE IMPLEMENTACION

### 9.1 MVP (Semanas 1-4) - HACKATHON

**Objetivo:** Demostrar concepto core funcionando.

#### Semana 1: Contratos Base

```rust
// Deliverables

1. Vault básico
   - open_vault()
   - adjust_collateral()
   - borrow_zkusd()
   - repay_zkusd()
   - close_vault()

2. zkUSD token
   - Charms token standard
   - mint() / burn()

3. Simple oracle
   - get_btc_price() trusted
```

**Tests:**
```bash
✓ Abrir vault con 1 BTC, mint 10k zkUSD (CR 200%)
✓ Ajustar collateral (add/remove)
✓ Borrowear mas zkUSD
✓ Repagar deuda
✓ Cerrar vault
```

#### Semana 2: Liquidaciones + Stability Pool

```rust
// Deliverables

1. Stability Pool
   - deposit_zkusd()
   - withdraw_zkusd()
   - Product-Sum implementation

2. Liquidation engine
   - is_liquidatable()
   - liquidate_vault()
   - distribute_to_pool()

3. Recovery mode
   - get_system_mode()
   - liquidation thresholds
```

**Tests:**
```bash
✓ Depositar zkUSD en pool
✓ Simular price drop → liquidation
✓ Verificar distribucion correcta
✓ Calcular compounded deposits
✓ Recovery mode triggers
```

#### Semana 3: Frontend + UX

```typescript
// Deliverables

1. Dashboard
   - Ver vaults
   - Health factor
   - System stats (TCR, mode, etc)

2. Vault management
   - Crear vault
   - Ajustar CR
   - Mint/repay zkUSD

3. Stability Pool UI
   - Depositar
   - Ver rewards
   - Withdraw
```

**Screens:**
```
1. Dashboard: TVL, vaults, pools, system mode
2. My Vault: CR, debt, collateral, actions
3. Stability Pool: APY, deposits, rewards
4. Liquidation: Search liquidatable vaults
```

#### Semana 4: Testing + Demo

```bash
# Testing checklist

□ Unit tests (100% coverage)
□ Integration tests (flujos completos)
□ Price crash simulation
□ Recovery mode test
□ Multi-user scenarios
□ Gas/size optimization

# Demo

□ Video demo grabado (5 min)
□ Slides presentacion
□ GitHub repo pulido
□ README comprehensive
□ Deployed testnet
```

### 9.2 Post-Hackathon: Fase 2

**Timeline: 2-3 meses**

#### Features

**1. Redemption Mechanism**
```rust
impl Redemptions {
    fn redeem_zkusd();
    fn calculate_redemption_fee();
    fn update_base_rate();
}
```

**2. Advanced Oracle**
```rust
impl Oracle {
    fn get_price_from_multiple_sources();
    fn calculate_median();
    fn verify_cross_chain_proofs();
}
```

**3. BaseRate Fee System**
```rust
impl Fees {
    fn calculate_borrowing_fee();
    fn update_base_rate();
    fn apply_decay();
}
```

**4. Gas Optimizations**
```rust
impl Optimizations {
    fn batch_liquidations();
    fn pending_rewards();
    fn efficient_hints();
}
```

### 9.3 Fase 3: Mainnet Prep

**Timeline: 3-6 meses**

#### Checklist

**1. Auditorias**
```
□ Internal audit (2 semanas)
□ External audit firm (4-6 semanas)
  - Code4rena / Sherlock / Trail of Bits
□ Bug bounty program ($100k+)
□ Fix issues encontrados
□ Re-audit si cambios mayores
```

**2. Optimizaciones**
```
□ Gas profiling exhaustivo
□ Reducir UTXO size
□ Batching avanzado
□ Merkle proofs optimizados
```

**3. Gobernanza**
```
□ Timelock contracts
□ Multi-sig para upgrades
□ Emergency pause mechanism
□ Parameter adjustment process
```

**4. Documentacion**
```
□ Technical whitepaper
□ User guides
□ Developer docs
□ API documentation
□ Video tutorials
```

**5. Integraciones**
```
□ Wallet support (Unisat, Xverse, etc)
□ DEX listings (swap zkUSD)
□ Analytics dashboards
□ Block explorers
```

### 9.4 Fase 4: Mainnet Launch

**Timeline: 1-2 meses**

#### Launch Sequence

**Week 1-2: Soft Launch**
```
Day 1:
- Deploy contracts mainnet
- Disable redemptions (14 days grace)
- Max individual vault: 1 BTC
- Total TVL cap: 10 BTC

Day 7:
- Increase caps if stable
- Max vault: 5 BTC
- Total TVL: 50 BTC

Day 14:
- Enable redemptions
- Remove individual caps
- Keep TVL cap: 100 BTC
```

**Week 3-4: Public Launch**
```
- Remove TVL cap
- Full marketing push
- Liquidity mining starts
- Partnerships announcements
```

**Monitoring:**
```
24/7 monitoring:
□ Price oracle liveness
□ Liquidation bots running
□ System mode
□ TCR
□ Redemption activity
□ Smart contract events
□ Uptime
```

### 9.5 Metricas de Exito

#### Hackathon (Semana 4)

```
Minimo viable:
✓ Smart contracts funcionando en testnet
✓ Vault creation + liquidation working
✓ Stability Pool con Product-Sum
✓ UI basica funcional
✓ Video demo de 5 min

Target:
✓ Todo lo minimo +
✓ Recovery mode implementado
✓ Multi-user testing
✓ Clean code + tests
✓ Professional presentation
```

#### 6 Meses Post-Hackathon

```
□ $1M+ TVL
□ 100+ active vaults
□ $500k+ en Stability Pool
□ Cero hacks/exploits
□ <5% LUSD peg deviation
□ 3+ audits completed
```

#### 1 Año

```
□ $10M+ TVL
□ 1000+ users
□ Listed en major DEXs
□ Cross-chain integrations (3+ chains)
□ Decentralized oracle
□ V2 features (user-set rates?)
```

---

## 10. RECURSOS ADICIONALES

### 10.1 Liquity Resources

**Documentacion:**
- Docs V1: https://docs.liquity.org/liquity-v1
- Docs V2: https://docs.liquity.org
- Whitepaper V2: https://liquity.gitbook.io/v2-whitepaper
- Technical Resources: https://docs.liquity.org/liquity-v1/documentation/resources

**GitHub:**
- V1 Monorepo: https://github.com/liquity/dev
- V2 Monorepo: https://github.com/liquity/bold
- Beta Contracts: https://github.com/liquity/beta

**Blog Posts (Highly Recommended):**
- How Liquity Replaces Floating Interest Rates: https://www.liquity.org/blog/how-liquity-replaces-floating-interest-rates
- Understanding Liquity's Stability Pool: https://www.liquity.org/blog/understanding-liquitys-stability-pool
- Scaling Liquity's Stability Pool: https://www.liquity.org/blog/scaling-liquitys-stability-pool
- Understanding Liquity's Redemption Mechanism: https://www.liquity.org/blog/understanding-liquitys-redemption-mechanism
- Liquity V2: Why User-Set Interest Rates: https://www.liquity.org/blog/liquity-v2-why-user-set-interest-rates
- How Faster Liquidations Improve Capital Efficiency: https://www.liquity.org/blog/how-faster-liquidations-improve-capital-efficiency

**Audits:**
- Dedaub Liquity V2 Audit: https://dedaub.com/audits/liquity/liquity-v2-second-audit-nov-11-2024/

**Analytics:**
- DeFiLlama - Liquity V1: https://defillama.com/protocol/liquity-v1
- DeFiLlama - Liquity V2: https://defillama.com/protocol/liquity-v2

**Community:**
- Discord: Liquity community
- Twitter: @LiquityProtocol

### 10.2 Comparables

**MakerDAO:**
- Comparison Liquity vs MakerDAO Pt 1: https://medium.com/@DerrickN_/liquity-protocol-vs-makerdao-84ed9f3440d5
- Comparison Liquity vs MakerDAO Pt 2: https://www.liquity.org/blog/comparison-series-liquity-protocol-vs-makerdao-pt-2

**General CDP Research:**
- Footprint: Comparison MakerDAO and Liquity: https://medium.com/@footprintofficial/footprint-a-comparison-between-makerdao-and-liquity-in-stablecoin-lending-3e11e6260528

### 10.3 UTXO & Bitcoin L2 Resources

**UTXO Model:**
- Bitcoin's UTXO Model: https://river.com/learn/bitcoins-utxo-model/
- UTXO vs Account Model: https://www.horizen.io/academy/utxo-vs-account-model/
- Extended UTXO Models: https://www.gate.io/learn/articles/from-btc-to-sui-ada-and-nervos-the-utxo-model-and-extensions/1932

**Charms (para implementacion):**
- Docs: https://docs.charms.dev
- Whitepaper: https://charms.dev/Charms-whitepaper.pdf
- GitHub: https://github.com/CharmsDev/charms

---

## CONCLUSIONES EJECUTIVAS

### Lecciones Clave de Liquity para zkUSD

1. **Simplicidad > Flexibilidad (para MVP)**
   - Un solo collateral (xBTC)
   - Parametros fijos
   - Mecanismos matematicos puros

2. **Stability Pool es el killer feature**
   - Liquidaciones instantaneas
   - Capital efficient (110% MCR)
   - Product-Sum formula es genial
   - DEBE estar en MVP

3. **Recovery Mode es critical**
   - Auto-regulacion en crisis
   - Probado en batalla
   - Simple de implementar
   - Alto ROI

4. **Redemptions pueden esperar para V2**
   - Complejo para MVP
   - Requiere hints/indexing
   - Funcionan sin el para testing
   - Pero critico para peg a largo plazo

5. **Oracle es el mayor desafio en Bitcoin**
   - Empezar trusted, descentralizar despues
   - Cross-chain via Charms beaming
   - Multiple sources desde inicio
   - Progressive decentralization

6. **Testing exhaustivo es no-negociable**
   - Simular crashes
   - Recovery mode transitions
   - Multi-user edge cases
   - Fuzzing

7. **UX diferenciador**
   - Dashboard claro
   - Health factor visible
   - Risk templates
   - Auto-rebalance (innovacion)

### Por que zkUSD puede superar a Liquity

1. **Bitcoin > Ethereum**
   - Mejor collateral (mas descentralizado)
   - Mas confianza institucional
   - Mayor TAM

2. **UTXO > Account Model (para CDPs)**
   - Mejor privacy
   - Parallelism natural
   - Simpler state management

3. **Learn from V1 mistakes**
   - No commitment a 0% forever
   - Multi-collateral arquitectura desde inicio
   - Better oracle strategy

4. **Charms advantages**
   - Cross-chain native
   - ZK proofs = trust minimized
   - Bitcoin L1 = max security

### Riesgos a Mitigar

1. **Oracle centralization**
   → Progressive decentralization roadmap

2. **UTXO limitations**
   → Clever use of singleton patterns

3. **Liquidity bootstrapping**
   → Liquidity mining + partnerships

4. **Redemption complexity**
   → Defer to V2, focus MVP features

5. **Audits**
   → Budget $50k+ for audits pre-mainnet

---

**Siguiente paso:** Implementar MVP siguiendo roadmap Semana 1-4.

**Enfoque:** Stability Pool + Liquidations + Recovery Mode = Core value prop.

**Diferenciador:** "Liquity para Bitcoin - 110% MCR, instant liquidations, native L1"
