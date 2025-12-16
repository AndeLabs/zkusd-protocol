# ANALISIS TECNICO: MakerDAO/DAI como Referencia para zkUSD

**Fecha:** 2025-12-13
**Objetivo:** Analizar la arquitectura de MakerDAO como gold-standard para diseñar zkUSD en Charms/Bitcoin

---

## TABLA DE CONTENIDOS

1. [Arquitectura de Smart Contracts](#1-arquitectura-de-smart-contracts)
2. [Sistema de Vaults/CDPs](#2-sistema-de-vaultscpds)
3. [Mecanismo de Liquidacion](#3-mecanismo-de-liquidacion)
4. [Sistema de Oraculos](#4-sistema-de-oraculos)
5. [Governance (MKR Token)](#5-governance-mkr-token)
6. [Emergency Shutdown](#6-emergency-shutdown)
7. [Lecciones de 5+ Anos de Operacion](#7-lecciones-de-5-anos-de-operacion)
8. [Patrones Reutilizables para zkUSD](#8-patrones-reutilizables-para-zkusd)
9. [Limitaciones del Modelo UTXO](#9-limitaciones-del-modelo-utxo)
10. [Simplificaciones Posibles](#10-simplificaciones-posibles)
11. [Arquitectura Propuesta para zkUSD](#11-arquitectura-propuesta-para-zkusd)

---

## 1. ARQUITECTURA DE SMART CONTRACTS

### 1.1 Core Module: Vat.sol

**Funcion:** Motor central de contabilidad del sistema Maker

**Responsabilidades:**
- Mantiene el estado de todos los Vaults (urns)
- Tracking de balances de collateral (gem) y Dai
- Enforcement de invariantes contables

**Variables de Estado Clave:**

```solidity
// Por collateral type (ilk)
struct Ilk {
    uint256 Art;   // Deuda total normalizada
    uint256 rate;  // Tasa acumulada (multiplier de deuda)
    uint256 spot;  // Precio de liquidacion
    uint256 line;  // Debt ceiling
    uint256 dust;  // Minimo de deuda
}

// Por vault (urn)
struct Urn {
    uint256 ink;   // Collateral locked
    uint256 art;   // Deuda normalizada
}

// Balances de usuarios
mapping (bytes32 => uint256) public gem;  // Collateral sin lock
mapping (bytes32 => uint256) public dai;  // Dai interno
mapping (bytes32 => uint256) public sin;  // Debt del sistema
```

**Funciones Core:**

1. **`frob(ilk, u, v, w, dink, dart)`** - Modificar vault
   - `u`: Owner del vault
   - `v`: Proveedor de collateral
   - `w`: Receptor de dai
   - `dink`: Delta de ink (collateral)
   - `dart`: Delta de art (deuda)

2. **`grab(ilk, u, v, w, dink, dart)`** - Liquidacion forzada
   - Confisca collateral de vault inseguro
   - Transfiere deuda al sistema (sin)

3. **`fold(ilk, u, rate)`** - Update acumulacion de fees
   - Actualiza el rate multiplier
   - Afecta todas las vaults del tipo

**Invariante Contable Central:**
```
Total Dai = Sum(Vault Debts * Rates) = System Surplus + System Debt
```

**Caracteristicas de Diseno:**
- **Sin external calls** - Aislado de riesgos externos
- **Sin division** - Evita perdida de precision
- **Formalmente verificable** - Pruebas matematicas posibles
- **Inmutable** - Las reglas no cambian post-deploy

**Riesgos Identificados:**
- Bug en Vat = perdida de TODO el collateral del sistema
- Oracles incorrectos = minteo sin respaldo o liquidaciones injustas
- Modulos autorizados tienen acceso root = riesgo de robo

---

### 1.2 Rates Module: Jug.sol

**Funcion:** Acumulacion de stability fees

**Mecanismo:**
```solidity
// Stability fee = interes compuesto continuo
// rate = base_rate + risk_premium

function drip(bytes32 ilk) public {
    // Calcula tiempo transcurrido
    uint256 elapsed = block.timestamp - lastUpdate;

    // Aplica interes compuesto usando rpow()
    // rate_new = rate_old * (1 + fee)^elapsed
    uint256 newRate = rpow(rate, elapsed, RAY);

    // Update en Vat via fold()
    vat.fold(ilk, vow, newRate - oldRate);
}
```

**Formula de Interes Compuesto:**
- Usa fixed-point arithmetic (ray = 10^27)
- Implementado en assembly (repeated squaring)
- Precision extrema para calculos a largo plazo

**Parametros:**
- `base`: Tasa base aplicada a todos los ilks
- `duty`: Risk premium especifico por collateral type

---

### 1.3 Oracle Module: Spot.sol

**Funcion:** Interface entre oracles y core contracts

**Calculo del Spot Price:**
```solidity
// spot = (oracle_price / par) / liquidation_ratio
//
// donde:
// - oracle_price: Precio del collateral (ej: $2000/ETH)
// - par: Valor target de DAI (ej: $1.00)
// - liquidation_ratio (mat): Collateral ratio minimo (ej: 150%)

spot = (val / par) / mat
```

**Ejemplo:**
- ETH = $2000
- par = $1
- mat = 1.5 (150%)
- spot = (2000/1) / 1.5 = $1333.33

Esto significa: puedes generar maximo $1333.33 DAI por cada ETH

---

### 1.4 System Stabilizer: Vow.sol

**Funcion:** Balance sheet del protocolo

**Estado:**
```solidity
uint256 public Sin;  // Deuda total del sistema
uint256 public Ash;  // Deuda en cola para auction
```

**Responsabilidades:**
- Trigger debt auctions (flop) cuando deuda > limite
- Trigger surplus auctions (flap) cuando surplus > limite
- Absorber deuda de vaults liquidadas

---

### 1.5 Join Adapters

**Funcion:** Puentes entre tokens ERC20 y sistema interno

**Tipos:**
1. **GemJoin** - Para collateral ERC20
2. **DaiJoin** - Para DAI
3. **ETHJoin** - Para ETH nativo (via WETH)

**Patron:**
```solidity
contract GemJoin {
    function join(address usr, uint wad) external {
        // 1. Transfer ERC20 al adapter
        gem.transferFrom(msg.sender, address(this), wad);

        // 2. Increment balance interno en Vat
        vat.slip(ilk, usr, int(wad));
    }

    function exit(address usr, uint wad) external {
        // 1. Decrement balance interno
        vat.slip(ilk, msg.sender, -int(wad));

        // 2. Transfer ERC20 al usuario
        gem.transfer(usr, wad);
    }
}
```

**Ventajas del Patron:**
- Aislamiento: Vat nunca interactua con tokens directamente
- Flexibilidad: Multiples adapters por collateral type
- Seguridad: Adapters son auditables independientemente

---

## 2. SISTEMA DE VAULTS/CDPs

### 2.1 Concepto Fundamental

**Vault (CDP - Collateralized Debt Position):**
- Usuario bloquea collateral (ej: ETH, WBTC)
- Genera DAI contra ese collateral
- Debe mantener collateral ratio > liquidation threshold

### 2.2 Flujo de Operacion

**1. Abrir Vault:**
```
Usuario -> Deposit ETH -> Join Adapter -> Vat (gem balance++)
```

**2. Generar DAI:**
```
Usuario -> frob(+ink, +art) -> Vat checks:
  - spot * (ink + dink) >= rate * (art + dart)  ✓ Safe?
  - (art + dart) >= dust  ✓ Above minimum?
  - ilk.Art + dart <= ilk.line  ✓ Under ceiling?

Si OK -> Increment ink, art -> User recibe DAI
```

**3. Pagar Deuda:**
```
Usuario -> Return DAI -> frob(-ink, -art) ->
  Burn DAI -> Liberar collateral
```

**4. Liquidacion (si unsafe):**
```
Keeper -> bite() -> grab() ->
  Confiscar collateral -> Auction ->
  Pagar deuda + penalty
```

### 2.3 Parametros por Collateral Type

| Parametro | Descripcion | Ejemplo (ETH-A) |
|-----------|-------------|-----------------|
| `spot` | Precio de liquidacion | $1333/ETH |
| `line` | Debt ceiling | 5B DAI |
| `dust` | Deuda minima | 5000 DAI |
| `mat` | Liquidation ratio | 150% |
| `duty` | Stability fee | 0.5% anual |
| `chop` | Liquidation penalty | 13% |

### 2.4 CDP Manager (Proxy Pattern)

**Problema:** Vaults en Vat se identifican por (ilk, address)
- Dificil gestionar multiples vaults
- No transferibles

**Solucion:** CDP Manager
```solidity
// Crea NFT que representa ownership del vault
// Vault real esta en address del CDPManager
// NFT es transferible

function open(bytes32 ilk, address usr) external returns (uint256 cdp) {
    cdp = ++cdpi;
    owns[cdp] = usr;
    ilks[cdp] = ilk;
    urns[cdp] = address(new UrnHandler(address(vat)));

    emit NewCdp(usr, usr, cdp);
}
```

**Ventajas:**
- Vaults son NFTs transferibles
- Proxy permite upgrades de logica
- Mejor UX para usuarios

---

## 3. MECANISMO DE LIQUIDACION

### 3.1 Evolucion: Cat -> Dog

#### Liquidation 1.2 (Cat + Flip) - DEPRECATED

**Problemas:**
- English auctions (bids crecientes)
- Capital bloqueado hasta fin de auction
- Lotes fijos (dunk) - ineficiente
- Lento en mercados volatiles

**Flujo:**
```
1. Keeper llama bite(ilk, urn)
2. Cat.bite() verifica vault unsafe
3. Transfiere lote fijo (dunk) a Flipper
4. Empieza English auction:
   - Fase 1: Bid mas DAI por collateral fijo
   - Fase 2: Bid menos collateral por DAI fijo
5. Al terminar: Keeper recibe collateral
```

#### Liquidation 2.0 (Dog + Clipper) - ACTUAL

**Mejoras:**
- Dutch auctions (precio decreciente)
- Sin lock de capital (instant settlement)
- Liquidacion parcial dinamica
- Circuit breakers

**Flujo:**
```
1. Keeper llama bark(ilk, urn, kpr)
   - kpr = address que recibe incentivo

2. Dog.bark() checks:
   - Vault unsafe? ✓
   - Hole (global limit) no excedido? ✓

3. Calcula cuanto liquidar:
   - Puede ser parcial si vault muy grande
   - Respeta limits: ilk.hole, Dog.Hole

4. Llama Clipper.kick():
   - Inicia Dutch auction
   - Precio inicial = oracle * buf (ej: 110%)
   - Precio decrece segun curva

5. Keepers llaman take():
   - Compran al precio actual
   - Settlement instantaneo
   - Pueden comprar todo o parte
```

### 3.2 Dutch Auction Detallado

**Mecanismo de Precio:**
```solidity
// Precio decrece exponencialmente
price(t) = top * (cut ^ t)

// Donde:
// top = precio inicial (oracle_price * buf)
// cut = factor de decrecimiento (ej: 0.99 por segundo)
// t = tiempo desde inicio auction
```

**Curvas de Precio:**

| Parametro | Valor Tipico | Efecto |
|-----------|--------------|--------|
| `buf` | 1.1 - 1.2 | Precio inicial = oracle * buf |
| `tail` | 3600s (1h) | Duracion maxima auction |
| `cusp` | 0.4 (40%) | Precio minimo = top * cusp |
| `cut` | 0.995 | Decrecimiento por segundo |

**Ejemplo:**
```
t=0:    $2200 (oracle=$2000, buf=1.1)
t=60s:  $2134
t=300s: $2000
t=600s: $1866
t=1800s: $1466
t=3600s: $880 (cusp = 40% de top)
```

### 3.3 Incentivos para Keepers

**Flat Incentive (`chip`):**
```solidity
// Pago fijo por liquidacion
uint256 chip = 50 DAI;  // Ejemplo
```

**Proportional Incentive (`tip`):**
```solidity
// Porcentaje de la deuda liquidada
uint256 tip = 0.02 * debt;  // 2% de la deuda
```

**Total Incentivo:**
```solidity
incentive = min(chip + (debt * tip), debt * chop)
```

**Ejemplo:**
- Deuda = 10,000 DAI
- chip = 50 DAI
- tip = 2%
- chop = 13%

Incentivo = min(50 + 200, 1300) = 250 DAI

### 3.4 Circuit Breakers

**Global Limit (`Dog.Hole`):**
```solidity
// Maximo DAI en liquidacion simultanea
uint256 Hole = 100_000_000 DAI;  // 100M
```

**Per-Collateral Limit (`ilk.hole`):**
```solidity
// Maximo por tipo de collateral
ilk[ETH-A].hole = 30_000_000 DAI;  // 30M
```

**Por que?**
- Prevenir cascadas de liquidacion
- Proteger durante Black Swan events
- Dar tiempo a governance para reaccionar

---

## 4. SISTEMA DE ORACULOS

### 4.1 Arquitectura de 3 Capas

```
LAYER 1: Feeds (Fuentes de Precio)
  ↓
LAYER 2: Medianizer (Agregador)
  ↓
LAYER 3: OSM (Security Module con delay)
  ↓
CORE: Vat, Spot (Consumidores)
```

### 4.2 Layer 1: Feeds

**Feeds Autorizados:**
- ~15-20 feeds independientes
- Whitelisted via governance
- Cada feed usa Setzer (price fetcher)

**Fuentes:**
- Exchanges centralizados (Coinbase, Kraken, Binance)
- DEXs (Uniswap, Curve)
- Otros oracles (Chainlink)

**Transmision:**
- Secure Scuttlebutt network
- Relayers publican a Medianizer

### 4.3 Layer 2: Medianizer (Median)

**Funcion:** Calcular mediana de feeds autorizados

**Validaciones:**
```solidity
function poke(
    uint256[] memory val_,    // Precios
    uint256[] memory age_,    // Timestamps
    uint8[] memory v,         // Firmas ECDSA
    bytes32[] memory r,
    bytes32[] memory s
) external {
    // 1. Verificar cada firma es de feed autorizado
    for (uint i = 0; i < val_.length; i++) {
        address signer = ecrecover(hash, v[i], r[i], s[i]);
        require(orcl[signer] == 1, "unauthorized");

        // 2. Verificar timestamp no es stale
        require(age_[i] > last[signer], "stale");
        last[signer] = age_[i];
    }

    // 3. Verificar orden ascendente (para median)
    for (uint i = 1; i < val_.length; i++) {
        require(val_[i] >= val_[i-1], "not sorted");
    }

    // 4. Verificar quorum minimo (bar)
    require(val_.length >= bar, "insufficient quorum");

    // 5. Calcular mediana
    uint256 median = val_[val_.length / 2];

    // 6. Bloom filter para unicidad
    checkUniqueness(val_);

    // 7. Publicar
    val = median;
    age = block.timestamp;
}
```

**Parametros:**
- `bar`: Minimo de feeds (ej: 13 de 20)
- `orcl`: Whitelist de feeds autorizados

**Por que Mediana (no promedio)?**
- Resistente a outliers
- Atacante necesita 50%+ de feeds
- Filtra datos irregulares naturalmente

### 4.4 Layer 3: OSM (Oracle Security Module)

**Funcion:** Time delay de 1 hora

**Estado:**
```solidity
uint128 val;  // Precio actual (usado por sistema)
uint128 nxt;  // Precio siguiente (en espera)
uint64 zzz;   // Timestamp del ultimo poke
```

**Mecanismo:**
```solidity
function poke() external {
    // Solo actualizar si paso el hop (1 hora)
    require(block.timestamp >= zzz + hop, "too soon");

    // Promover nxt -> val
    val = nxt;

    // Leer nuevo precio de Medianizer
    (bytes32 price, bool valid) = src.peek();
    require(valid, "invalid price");
    nxt = uint128(price);

    // Update timestamp (redondeado a multiplo de hop)
    zzz = uint64(block.timestamp);
}
```

**Delay de 1 Hora: Por Que?**

1. **Deteccion de Ataques:**
   - Oracle comprometido publica precio = $0
   - Sistema tiene 1 hora para detectar
   - Governance puede llamar `stop()` o `void()`

2. **Emergency Response:**
   - `stop()`: Congela updates futuros
   - `void()`: Pone precios en 0 (trigger shutdown)
   - Emergency Shutdown si necesario

3. **Trade-off:**
   - Pro: Tiempo para reaccionar
   - Con: Precio puede quedar desactualizado en alta volatilidad

**Whitelist de Readers:**
```solidity
mapping (address => uint256) public bud;  // Autorizados para leer

function peek() external view returns (bytes32, bool) {
    require(bud[msg.sender] == 1, "unauthorized");
    return (bytes32(val), val > 0);
}
```

Solo contratos autorizados (Spot, End) pueden leer precio.

### 4.5 Resistencia a Ataques

**Sybil Attack:**
- Whitelist previene feeds falsos
- Governance controla quien es feed

**Manipulation Attack:**
- Median requiere 50%+ de feeds
- Costoso comprometer mayoria

**Flash Crash Attack:**
- OSM delay da tiempo de reaccion
- Circuit breakers en liquidaciones

**Censorship Attack:**
- Poke() es public, cualquiera puede llamar
- Relayers redundantes

---

## 5. GOVERNANCE (MKR TOKEN)

### 5.1 Arquitectura de Governance

**Componentes:**
1. **MKR Token** - ERC20 (DSToken)
2. **Chief** - Voting contract (DSChief)
3. **Pause** - Delay execution
4. **Spell** - Proposal ejecutable

### 5.2 MKR Token

**Funciones:**
```solidity
contract DSToken {
    // ERC20 standard
    function transfer(address dst, uint wad) external;
    function approve(address guy, uint wad) external;

    // Governance functions
    function mint(address guy, uint wad) external auth;
    function burn(uint wad) external;
}
```

**Dual Purpose:**
1. **Governance:** 1 MKR = 1 voto
2. **Recapitalization:** Mint MKR si deficit, burn si surplus

### 5.3 Chief (Voting Contract)

**Continuous Approval Voting:**
```solidity
// Usuarios "levantan" propuestas con su MKR locked
mapping (address => uint256) public approvals;  // MKR voting for spell
mapping (address => address[]) public votes;    // User's current votes
address public hat;  // Spell con mas approvals

function lock(uint wad) external {
    // Lock MKR, recibe IOU tokens
    gov.transferFrom(msg.sender, address(this), wad);
    IOU.mint(msg.sender, wad);
    deposits[msg.sender] += wad;
}

function vote(address[] memory slate) external {
    // Cambiar votos a nuevas propuestas
    // Restar de propuestas viejas
    for (uint i = 0; i < votes[msg.sender].length; i++) {
        approvals[votes[msg.sender][i]] -= deposits[msg.sender];
    }

    // Sumar a nuevas propuestas
    for (uint i = 0; i < slate.length; i++) {
        approvals[slate[i]] += deposits[msg.sender];
    }

    votes[msg.sender] = slate;
}

function lift(address spell) external {
    // Promover spell con mas votos a "hat"
    require(approvals[spell] > approvals[hat], "insufficient approval");
    hat = spell;
}
```

**Caracteristicas:**
- MKR permanece locked (liquidez en IOU tokens)
- Voto continuo (no por periodo)
- "Hat" = propuesta ejecutable actual
- Se puede cambiar voto anytime

### 5.4 Pause (Delay Module)

**Funcion:** Enforced delay entre aprobacion y ejecucion

```solidity
contract DSPause {
    uint256 public delay;  // Ej: 48 horas

    mapping (bytes32 => bool) public plans;

    function plot(address usr, bytes32 tag, bytes memory fax, uint eta)
        external auth
    {
        // Schedule ejecucion
        bytes32 id = keccak256(abi.encode(usr, tag, fax, eta));
        plans[id] = true;
    }

    function exec(address usr, bytes32 tag, bytes memory fax, uint eta)
        external
        returns (bytes memory out)
    {
        // Verificar delay paso
        require(block.timestamp >= eta, "too early");
        require(eta <= block.timestamp + delay, "expired");

        // Execute via delegatecall
        bytes32 id = keccak256(abi.encode(usr, tag, fax, eta));
        require(plans[id], "not planned");
        delete plans[id];

        out = usr.delegatecall(fax);
    }
}
```

**Por que Delay?**
- Da tiempo a holders para reaccionar
- Pueden vender MKR/DAI si desacuerdo
- Previene governance attacks
- Standard: 48 horas (GSM delay)

### 5.5 Spell (Proposal Contract)

**Patron:**
```solidity
contract SpellAction {
    function execute() external {
        // Cambios atomicos al sistema
        // Ej: Update stability fee

        VatLike(vat).file("ETH-A", "line", 500_000_000 * RAY);
        JugLike(jug).file("ETH-A", "duty", 1000000000315522921573372069);
    }
}

contract Spell {
    address public action;
    bool public done;

    function cast() external {
        require(!done, "already cast");
        DSPauseAbstract(pause).exec(action, abi.encodeWithSignature("execute()"), now);
        done = true;
    }
}
```

**Tipos de Cambios:**
- Risk parameters (stability fees, debt ceilings)
- Agregar/quitar collateral types
- Upgrades de modulos
- Emergency actions

### 5.6 Tipos de Votos

#### Governance Polls
- Sentiment check
- 2-3 dias
- Off-chain signaling
- Instant Run-Off voting
- No binding

#### Executive Votes
- On-chain execution
- Continuous approval
- Binding changes
- Pasan via Chief.lift()

### 5.7 Riesgos de Governance

**Flash Loan Attack:**
- Imposible: MKR debe lockear primero
- Chief no acepta flash loans

**Low Turnout Attack:**
```
Si pocos MKR voting:
  Atacante puede lift malicious spell con poco MKR

Mitigacion:
  GSM (Governance Security Module)
  Delay de 48h para reaccionar
```

**Governance Capture:**
- Whale compra mayoria de MKR
- Puede pasar cualquier propuesta
- Mitigacion: Transparencia, delay, fork option

---

## 6. EMERGENCY SHUTDOWN

### 6.1 Proposito

**Cuando Usar:**
- Bug critico descubierto
- Oracle attack
- Governance compromise
- System upgrade

**Objetivo:**
- Shutdown ordenado
- Preservar valor para holders
- Redimibilidad justa

### 6.2 End.sol (Cage Contract)

**Estado:**
```solidity
uint256 public live = 1;  // 1 = running, 0 = shutdown
uint256 public when;      // Timestamp de shutdown
```

**Propiedades Garantizadas:**

1. **Dai Parity:**
   - Cada DAI redeemable por $1 de collateral
   - Basado en precio al momento de cage

2. **No Race Condition:**
   - Todos los DAI holders reciben mismo ratio
   - Sin importar cuando redimen

3. **Vault Parity:**
   - Vault owners priorizados
   - Pueden retirar excess collateral primero

### 6.3 Proceso de Shutdown

**Fase 1: Cage (Freeze System)**
```solidity
function cage() external auth {
    require(live == 1, "already shut down");
    live = 0;
    when = block.timestamp;

    // Freeze todo
    vat.cage();  // No mas frob
    // Cat/Dog liquidations stopped
    // Oracles frozen
}
```

**Fase 2: Settle Auctions**
```solidity
// Cancelar todas las auctions activas
// Flap: Return DAI surplus
// Flop: Return MKR
// Flip/Clip: Return collateral

function cancel_auction(uint id) external {
    // Yank auction
    // Return assets to rightful owners
}
```

**Fase 3: Snapshot Prices**
```solidity
function cage(bytes32 ilk) external {
    // Capturar precio final de cada collateral
    tag[ilk] = osm[ilk].read();  // Precio usado para redemption
}
```

**Fase 4: Process Vaults**
```solidity
function skim(bytes32 ilk, address urn) external {
    // Calcular collateral excedente
    uint debt = vat.urns(ilk, urn).art * vat.ilks(ilk).rate;
    uint collat_value = vat.urns(ilk, urn).ink * tag[ilk];

    if (collat_value > debt) {
        // Vault owner puede retirar excess
        uint excess = (collat_value - debt) / tag[ilk];
        // Transfer excess a owner
    }
}
```

**Fase 5: Calculate Redemption**
```solidity
function thaw() external {
    // Esperar periodo (ej: 3 dias)
    require(block.timestamp >= when + wait);

    // Calcular ratio de redemption por collateral
    for (ilk in ilks) {
        // Collateral disponible / DAI total
        fix[ilk] = (collateral_pool[ilk] * RAY) / total_dai;
    }
}
```

**Fase 6: DAI Redemption**
```solidity
function pack(uint wad) external {
    // User burns DAI
    vat.move(msg.sender, address(vow), wad);
    bag[msg.sender] += wad;
}

function cash(bytes32 ilk, uint wad) external {
    // User recibe collateral proporcional
    uint redemption = wad * fix[ilk];
    // Transfer collateral to user
}
```

### 6.4 ESM (Emergency Shutdown Module)

**Trigger Mecanismo:**
```solidity
contract ESM {
    uint256 public min = 50_000 * WAD;  // 50k MKR
    uint256 public sum;  // MKR depositado

    function join(uint wad) external {
        // Burn MKR (irreversible!)
        gem.burn(msg.sender, wad);
        sum += wad;
    }

    function fire() external {
        require(sum >= min, "insufficient MKR");
        end.cage();  // Trigger shutdown
    }
}
```

**Caracteristicas:**
- Descentralizado (cualquiera con 50k MKR)
- MKR quemado permanentemente
- Irreversible
- Emergency-only

### 6.5 Timeframes

| Fase | Tiempo | Accion |
|------|--------|--------|
| Cage | Inmediato | Freeze sistema |
| Wait | 3-7 dias | Settlement period |
| Thaw | Despues de wait | Calcular ratios |
| Cash | Ongoing | Users redimen DAI |

---

## 7. LECCIONES DE 5+ ANOS DE OPERACION

### 7.1 Black Thursday (Marzo 12, 2020)

**Contexto:**
- COVID-19 panic sell-off
- ETH cayo 43%: $194 → $111 (mayor caida en 1 dia)
- Network congestion extrema
- Gas prices 10x normal

**Fallas del Sistema:**

#### 1. Oracle Delay
```
Medianizer reporto $166 cuando ETH = $130
↓
Liquidaciones retrasadas
↓
Vaults mas undercollateralized de lo detectado
```

#### 2. Keeper Script Rigido
```
MakerDAO proveia script oficial de keeper
↓
Script no adaptaba gas price dinamicamente
↓
Keepers no podian competir con atacantes
```

#### 3. Zero-Bid Auctions
```
Atacantes pagaron gas alto + bid $0
↓
Ganaron 1,462 auctions (36.6% del total)
↓
$8.32M ETH extraido gratis
↓
$5.67M DAI unbacked (bad debt)
```

**Metricas del Desastre:**
- 3,994 liquidaciones totales
- 1,462 zero-bid wins
- 62,843 ETH perdidos (~$4.5M)
- Sistema undercollateralized: 6.65M DAI

**Recapitalizacion:**
```
Debt Auctions (Flop)
↓
Mint nuevo MKR
↓
Auction por DAI
↓
Paradigm Capital compro 68% del MKR
↓
Raised 5M DAI
```

### 7.2 Mejoras Post-Black Thursday

#### 1. Liquidation 2.0 (Dog + Clipper)
**Antes (Cat + Flip):**
```
- English auctions
- Lotes fijos (dunk)
- Capital locked hasta fin
- 10 minutos auction
```

**Despues (Dog + Clipper):**
```
- Dutch auctions
- Instant settlement
- Liquidacion parcial
- 6 horas auction (mas tiempo)
```

#### 2. Circuit Breakers
```solidity
// Limites globales
Dog.Hole = 100M DAI  // Max liquidacion simultanea

// Limites por collateral
ilk[ETH-A].hole = 30M DAI
```

**Efecto:**
- Previene cascadas
- Da tiempo a governance
- Protege en alta volatilidad

#### 3. Auction Parameters
```
ANTES:
- Duracion: 10 min
- Sin restart mechanism

DESPUES:
- Duracion: 6 horas
- Restart si < 3 bids
- Restart si < 2 bidders unicos
- Lotes max: 50 ETH
```

#### 4. Keeper Incentives
```solidity
// Incentivo fijo
chip = 50 DAI

// Incentivo proporcional
tip = 2% * debt

// Total
incentive = chip + (debt * tip)
```

Mejor alineacion de incentivos para keepers.

#### 5. Instant Halt Authority
```
Governance puede:
  - Pausar liquidaciones instantaneamente
  - Prevenir zero-bid exploits
  - Tiempo para investigar
```

#### 6. Liquidation Dashboard
```
UI publica para:
  - Monitorear vaults en riesgo
  - Facilitar participacion en auctions
  - Mas transparencia
```

### 7.3 Otras Lecciones Aprendidas

#### 1. Stress Testing
**Leccion:**
> "Complicated formulas simply don't work under extreme volatility"

**Aplicacion:**
- Simular Black Swan events
- Test con gas extremo
- Test con oracle delays
- Monkey testing (random actions)

#### 2. Decentralizacion vs Velocidad
**Leccion:**
> "MakerDAO necesito 24 horas para ajustar parametros post-ataque"

**Trade-off:**
```
Mas descentralizacion = Mas lento decidir
Mas centralizacion = Mas rapido, mas riesgo
```

**Balance:**
- GSM delay para seguridad
- Emergency authority para speed
- Clear escalation paths

#### 3. Contingency Plans
**Leccion:**
> "Siempre debe haber plan de contingencia"

**Implementaciones:**
- Emergency Shutdown bien diseñado
- Recapitalization mechanism (MKR dilution)
- Insurance fund (future: CES)

#### 4. Dependency Risks

**Leccion:**
> "Keeper script oficial creo single point of failure"

**Aplicacion:**
- Diversidad de implementations
- Incentivos robustos
- Public APIs
- Competition entre keepers

#### 5. Oracle Robustness

**Implementaciones Post-Crisis:**
```
1. OSM delay mantenido (1 hora)
   Pro: Tiempo para reaccionar
   Con: Puede quedar stale

2. Multiple feeds
   13-20 feeds independientes

3. Median (no average)
   Resistente a outliers

4. Monitoring tools
   Alertas de precio anomalo
```

#### 6. Parameter Tuning

**Ajustes Continuos:**
```
- Stability fees: 0% → 8% (2019 crisis)
- Debt ceilings: Dinamicos por demanda
- Liquidation ratios: Por volatilidad de asset
- Oracle delay: Balance riesgo/freshness
```

### 7.4 Evolution Timeline

| Fecha | Evento | Cambio |
|-------|--------|--------|
| Nov 2017 | SCD Launch | Single Collateral DAI |
| Nov 2019 | MCD Launch | Multi-Collateral DAI |
| Mar 2020 | Black Thursday | $4.5M bad debt |
| Mar 2020 | Debt Auctions | Recapitalization via MKR |
| Apr 2020 | Post-Mortem | Security improvements |
| Nov 2020 | Liq 2.0 Deployed | Dog + Clipper |
| 2021-2023 | RWA Integration | Real World Assets as collateral |
| 2024 | PSM Evolution | Peg Stability Module refinements |

---

## 8. PATRONES REUTILIZABLES PARA zkUSD

### 8.1 Separation of Concerns

**Patron MakerDAO:**
```
Vat (Core) - Accounting solo
  ↓
Join (Adapters) - Token bridges
  ↓
Cat/Dog (Liquidation) - Enforcement
  ↓
Jug (Rates) - Fee accrual
  ↓
Spot (Oracles) - Price feeds
```

**Aplicacion a zkUSD:**
```rust
// Core State Module
mod vault_engine {
    // Solo accounting
    // Sin external calls
    // Formalmente verificable
}

// Adapter Module
mod bitcoin_bridge {
    // UTXO → Internal balance
    // Isolated Bitcoin interactions
}

// Liquidation Module
mod liquidator {
    // Enforcement logic
    // Auction mechanism
}

// Oracle Module
mod price_feed {
    // Charms-based oracle
    // Time delay built-in
}
```

**Ventajas:**
- Modularidad
- Auditabilidad
- Upgradeable (via governance)
- Menor superficie de ataque

### 8.2 Accounting Invariants

**Patron MakerDAO:**
```solidity
// Invariante central
Total_DAI = Sum(Vault_Debts) = System_Surplus + System_Debt

// Nunca roto, garantizado en cada tx
```

**Aplicacion a zkUSD:**
```rust
// En cada Spell validation
pub fn validate_invariants(ctx: &Context) -> bool {
    // 1. Conservation of value
    let inputs_sum: u64 = ctx.inputs.iter().map(|i| i.amount).sum();
    let outputs_sum: u64 = ctx.outputs.iter().map(|o| o.amount).sum();
    assert!(inputs_sum == outputs_sum);

    // 2. Collateral backing
    let total_zkusd = get_total_supply();
    let total_collateral_value = get_collateral_value();
    assert!(total_collateral_value >= total_zkusd);

    // 3. No negative balances
    for vault in vaults {
        assert!(vault.collateral >= 0);
        assert!(vault.debt >= 0);
    }

    true
}
```

**Ventajas:**
- Imposible crear deuda sin collateral
- Verificable en cada transaccion
- ZK proof del invariante

### 8.3 Oracle Security Module (OSM)

**Patron MakerDAO:**
```
Oracle → Medianizer → OSM (1h delay) → Core
```

**Adaptacion a zkUSD/Charms:**

```rust
// Oracle Module con delay built-in
pub struct OracleSecurityModule {
    current_price: u64,
    next_price: u64,
    last_update: u64,
    delay: u64,  // ej: 6 blocks (~1 hora)
}

impl OracleSecurityModule {
    pub fn poke(&mut self, new_price: u64, block_height: u64) {
        if block_height >= self.last_update + self.delay {
            // Promote next → current
            self.current_price = self.next_price;

            // Queue new price
            self.next_price = new_price;

            self.last_update = block_height;
        }
    }

    pub fn peek(&self) -> u64 {
        self.current_price
    }
}

// En Spell
#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let oracle = ctx.get_oracle();
    let price = oracle.peek();  // Delayed price

    // Usar para liquidation checks, etc.
    check_vault_safety(ctx, price)
}
```

**Implementacion en Charms:**
- Oracle como Charms App separado
- Price updates via Spells
- Delay garantizado por blockchain
- Cross-chain oracles via Beaming

**Fuentes de Precio:**
```
1. Bitcoin DEXs (futuros)
2. Centralized exchanges (CEX)
3. Other chains via Beaming
   - Chainlink en Ethereum
   - Pyth Network
   - Median de multiples fuentes
```

### 8.4 Liquidation con Dutch Auctions

**Por que Dutch mejor que English:**
```
English Auction:
  ✗ Capital locked
  ✗ Lento (esperar bids)
  ✗ Race conditions

Dutch Auction:
  ✓ Instant settlement
  ✓ Capital efficiency
  ✓ Precio justo (market-driven)
```

**Implementacion en UTXO:**

```rust
// Auction State (stored in Charms App)
struct DutchAuction {
    id: [u8; 32],
    collateral_amount: u64,      // BTC in satoshis
    debt_to_cover: u64,          // zkUSD to repay
    start_price: u64,            // Initial price (oracle * 1.1)
    start_block: u64,
    duration_blocks: u64,        // ej: 36 blocks (~6 horas)
    decay_rate: u64,             // Price decay per block
}

impl DutchAuction {
    pub fn current_price(&self, current_block: u64) -> u64 {
        let elapsed = current_block - self.start_block;

        if elapsed >= self.duration_blocks {
            // Minimum price (cusp)
            return self.start_price * 40 / 100;  // 40% of start
        }

        // Exponential decay
        let decay = self.decay_rate.pow(elapsed as u32);
        self.start_price * decay / RAY
    }

    pub fn take(&mut self, taker: Address, amount: u64, current_block: u64)
        -> Result<(), Error>
    {
        let price = self.current_price(current_block);
        let cost = amount * price;

        // Validaciones
        require!(cost >= self.debt_to_cover, "insufficient payment");
        require!(amount <= self.collateral_amount, "insufficient collateral");

        // Transfer collateral to taker (UTXO)
        // Burn zkUSD payment
        // Return excess collateral to vault owner

        Ok(())
    }
}

// Spell para participar en auction
#[charms_spell]
pub fn auction_take(ctx: &SpellContext) -> bool {
    let auction_id = ctx.params.get("auction_id");
    let bid_amount = ctx.params.get("bid_amount");

    // Verificar pago zkUSD en inputs
    let zkusd_in = ctx.inputs.iter()
        .filter(|i| i.app_id == ZKUSD_APP_ID)
        .map(|i| i.amount)
        .sum();

    // Get auction state
    let auction = get_auction(auction_id)?;

    // Calculate current price
    let price = auction.current_price(ctx.block_height);
    let cost = bid_amount * price;

    // Verify payment sufficient
    if zkusd_in < cost {
        return false;
    }

    // Transfer collateral BTC to bidder
    ctx.add_output(Output {
        address: ctx.caller,
        amount: bid_amount,
        app_id: BITCOIN_APP_ID,  // Raw BTC
    });

    // Burn zkUSD
    // (No output = burn in UTXO model)

    // Return change if any
    if zkusd_in > cost {
        ctx.add_output(Output {
            address: ctx.caller,
            amount: zkusd_in - cost,
            app_id: ZKUSD_APP_ID,
        });
    }

    true
}
```

**Ventajas en UTXO:**
- Settlement atomico
- Sin estado complejo
- ZK proof de correctness
- Sin MEV (no mempool inspection en Bitcoin)

### 8.5 Modular Collateral Types

**Patron MakerDAO:**
```solidity
// Cada collateral = ilk diferente
ilks["ETH-A"]  // Conservative (150% ratio)
ilks["ETH-B"]  // Moderate (130% ratio)
ilks["ETH-C"]  // Aggressive (110% ratio)

// Diferentes risk parameters
```

**Aplicacion a zkUSD:**

```rust
pub struct CollateralType {
    id: [u8; 32],
    name: String,  // "BTC-A", "BTC-B", "RUNE-A"

    // Risk parameters
    liquidation_ratio: u64,      // 150% = 150_000_000_000 (ray)
    stability_fee: u64,          // Annual rate
    debt_ceiling: u64,           // Max zkUSD from this type
    debt_floor: u64,             // Min debt per vault (dust)
    liquidation_penalty: u64,    // 13% = 13_000_000_000

    // Oracle
    oracle_id: [u8; 32],

    // Adapter
    adapter_id: [u8; 32],        // Charms App for deposits/withdrawals
}

// Ejemplo configuraciones
let btc_conservative = CollateralType {
    name: "BTC-A",
    liquidation_ratio: 150 * RAY / 100,  // 150%
    stability_fee: annual_to_rate(2.0),  // 2% anual
    debt_ceiling: 100_000_000 * WAD,     // 100M zkUSD
    debt_floor: 1000 * WAD,              // 1000 zkUSD min
    liquidation_penalty: 13 * RAY / 100, // 13%
    ...
};

let rune_aggressive = CollateralType {
    name: "RUNE-A",
    liquidation_ratio: 200 * RAY / 100,  // 200% (mas volatil)
    stability_fee: annual_to_rate(5.0),  // 5% anual
    debt_ceiling: 10_000_000 * WAD,      // 10M zkUSD
    debt_floor: 500 * WAD,
    liquidation_penalty: 15 * RAY / 100,
    ...
};
```

**Ventajas:**
- Risk segregation
- User choice (risk vs capital efficiency)
- Iteracion sin afectar existentes
- Governance can adjust per-type

### 8.6 Continuous Fee Accrual

**Patron MakerDAO:**
```solidity
// Jug.drip() actualiza rate
rate_new = rate_old * (1 + fee)^elapsed_time

// Deuda real = normalized_debt * rate
debt = art * rate
```

**Implementacion en zkUSD:**

```rust
pub struct VaultEngine {
    // Per collateral type
    collateral_types: HashMap<CollateralId, CollateralType>,

    // Per vault
    vaults: HashMap<VaultId, Vault>,
}

pub struct Vault {
    owner: Address,
    collateral_type: CollateralId,
    ink: u64,          // Collateral locked
    art: u64,          // Normalized debt
}

impl VaultEngine {
    // Actualizar rate (llamado periodicamente)
    pub fn drip(&mut self, ilk: CollateralId, current_time: u64) {
        let collateral = self.collateral_types.get_mut(&ilk)?;

        let elapsed = current_time - collateral.last_update;

        // Compound interest: rate_new = rate * (1 + fee)^elapsed
        let fee_factor = rpow(
            RAY + collateral.stability_fee_per_second,
            elapsed,
            RAY
        );

        collateral.rate = collateral.rate * fee_factor / RAY;
        collateral.last_update = current_time;

        // Surplus increase = delta_rate * total_normalized_debt
        let surplus_increase =
            (collateral.rate - old_rate) * collateral.total_art;

        self.surplus += surplus_increase;
    }

    // Get vault debt actual
    pub fn get_vault_debt(&self, vault_id: VaultId) -> u64 {
        let vault = self.vaults.get(&vault_id)?;
        let collateral = self.collateral_types.get(&vault.collateral_type)?;

        // Debt = normalized_debt * rate
        vault.art * collateral.rate / RAY
    }
}

// Helper: repeated squaring for exponentiation
fn rpow(x: u64, n: u64, base: u64) -> u64 {
    // x^n in fixed-point arithmetic
    // Implementation similar to MakerDAO's rpow
    let mut result = base;
    let mut exp = n;
    let mut val = x;

    while exp > 0 {
        if exp % 2 == 1 {
            result = result * val / base;
        }
        val = val * val / base;
        exp /= 2;
    }

    result
}
```

**Charms Integration:**

```rust
// Spell para accrual periodico
#[charms_spell]
pub fn accrue_fees(ctx: &SpellContext) -> bool {
    let ilk_id = ctx.params.get("collateral_type");

    // Get state
    let mut engine = load_vault_engine();

    // Drip fees
    engine.drip(ilk_id, ctx.block_time);

    // Save state
    save_vault_engine(engine);

    true
}

// Keeper bot llama esto cada X blocks
```

### 8.7 Governance con Time Delay

**Patron MakerDAO:**
```
Proposal → Vote → Delay (48h) → Execute
```

**Adaptacion a zkUSD:**

```rust
pub struct GovernanceModule {
    proposals: HashMap<ProposalId, Proposal>,
    delay_blocks: u64,  // ej: 288 blocks (~48 horas)
}

pub struct Proposal {
    id: ProposalId,
    proposer: Address,
    eta: u64,           // Block height de ejecucion
    votes_for: u64,
    votes_against: u64,
    executed: bool,
    actions: Vec<Action>,
}

pub enum Action {
    UpdateParameter { param: String, value: u64 },
    AddCollateral { config: CollateralType },
    RemoveCollateral { ilk: CollateralId },
    UpgradeModule { module: ModuleId, new_code: Vec<u8> },
}

impl GovernanceModule {
    // Proponer cambio
    pub fn propose(&mut self, actions: Vec<Action>, block: u64) -> ProposalId {
        let id = generate_id();
        let eta = block + self.delay_blocks;

        self.proposals.insert(id, Proposal {
            id,
            proposer: msg_sender(),
            eta,
            votes_for: 0,
            votes_against: 0,
            executed: false,
            actions,
        });

        id
    }

    // Votar (weight = governance token balance)
    pub fn vote(&mut self, proposal_id: ProposalId, support: bool) {
        let weight = get_voter_weight(msg_sender());
        let proposal = self.proposals.get_mut(&proposal_id)?;

        if support {
            proposal.votes_for += weight;
        } else {
            proposal.votes_against += weight;
        }
    }

    // Ejecutar (solo despues de delay)
    pub fn execute(&mut self, proposal_id: ProposalId, current_block: u64)
        -> Result<(), Error>
    {
        let proposal = self.proposals.get_mut(&proposal_id)?;

        // Checks
        require!(current_block >= proposal.eta, "too early");
        require!(!proposal.executed, "already executed");
        require!(proposal.votes_for > proposal.votes_against, "rejected");

        // Execute actions
        for action in &proposal.actions {
            execute_action(action)?;
        }

        proposal.executed = true;
        Ok(())
    }
}

// Spell para ejecutar governance
#[charms_spell]
pub fn execute_proposal(ctx: &SpellContext) -> bool {
    let proposal_id = ctx.params.get("proposal_id");

    let mut gov = load_governance();
    gov.execute(proposal_id, ctx.block_height).is_ok()
}
```

**Governance Token:**
- Podria ser Charms NFT/Token
- O BTC-based (holder votes)
- O hybrid (zkUSD holder votes)

### 8.8 Emergency Shutdown Pattern

**Implementacion para zkUSD:**

```rust
pub struct EmergencyShutdown {
    live: bool,              // true = running, false = shutdown
    shutdown_block: u64,
    settlement_prices: HashMap<CollateralId, u64>,
    redemption_ratios: HashMap<CollateralId, u64>,
}

impl EmergencyShutdown {
    // Trigger shutdown (governance o emergency module)
    pub fn cage(&mut self, block: u64) {
        self.live = false;
        self.shutdown_block = block;

        // Freeze everything
        freeze_minting();
        freeze_liquidations();
        cancel_auctions();
    }

    // Snapshot precios
    pub fn cage_collateral(&mut self, ilk: CollateralId) {
        let price = get_oracle_price(ilk);
        self.settlement_prices.insert(ilk, price);
    }

    // Calcular ratios de redemption
    pub fn thaw(&mut self, wait_blocks: u64, current_block: u64) {
        require!(current_block >= self.shutdown_block + wait_blocks);

        let total_zkusd = get_total_supply();

        for (ilk, price) in &self.settlement_prices {
            let collat_pool = get_collateral_pool(ilk);
            let collat_value = collat_pool * price;

            // Ratio: cuanto collateral por zkUSD
            let ratio = (collat_pool * RAY) / total_zkusd;
            self.redemption_ratios.insert(*ilk, ratio);
        }
    }

    // Usuario redime zkUSD por collateral
    pub fn cash(&self, ilk: CollateralId, zkusd_amount: u64)
        -> u64  // Collateral amount
    {
        let ratio = self.redemption_ratios.get(&ilk)?;
        zkusd_amount * ratio / RAY
    }
}

// Spell para redemption
#[charms_spell]
pub fn redeem_zkusd(ctx: &SpellContext) -> bool {
    let shutdown = load_emergency_shutdown();
    require!(!shutdown.live, "system still running");

    let ilk = ctx.params.get("collateral_type");
    let zkusd_in = get_zkusd_inputs(ctx);

    // Calculate redemption
    let collateral_out = shutdown.cash(ilk, zkusd_in);

    // Burn zkUSD (no output)
    // Transfer collateral to user
    ctx.add_output(Output {
        address: ctx.caller,
        amount: collateral_out,
        app_id: get_collateral_app_id(ilk),
    });

    true
}
```

---

## 9. LIMITACIONES DEL MODELO UTXO

### 9.1 No hay "Accounts" Persistentes

**EVM (Ethereum):**
```solidity
// Estado global mutable
mapping (address => Vault) public vaults;

// Actualizar vault directamente
vaults[user].debt += 100;
```

**UTXO (Bitcoin/Charms):**
```rust
// No hay estado global mutable
// Cada transaccion consume UTXOs y crea nuevos

// "Vault" debe ser representado como UTXO
struct VaultUTXO {
    owner: Address,
    collateral: u64,
    debt: u64,
    collateral_type: CollateralId,
}

// "Update" = consumir viejo UTXO + crear nuevo
Input: VaultUTXO { debt: 1000 }
Output: VaultUTXO { debt: 1100 }  // "Updated"
```

**Problemas:**

1. **Fragmentation:**
   - Multiples UTXOs por vault
   - Dificulta calculos globales (total debt, etc.)

2. **Concurrency:**
   - No puedes actualizar mismo vault desde 2 txs en mismo block
   - Race conditions

3. **State Queries:**
   - No hay `vaults[user].debt`
   - Necesitas indexer off-chain

**Soluciones:**

#### A. App State en Charms
```rust
// Charms Apps pueden tener "global state"
// Implementado via commitment scheme

pub struct VaultEngineState {
    vaults: HashMap<VaultId, Vault>,
    total_debt: u64,
    total_collateral: HashMap<CollateralId, u64>,
}

// State hash committeado en Bitcoin
// ZK proof de state transitions
```

**Ventaja:** Estado global similar a EVM
**Desventaja:** Dependes de App state (off-chain storage)

#### B. UTXO Aggregation
```rust
// Vault = conjunto de UTXOs
// Identificados por tag

struct VaultTag {
    owner: Address,
    collateral_type: CollateralId,
}

// Spell valida que suma de inputs = suma de outputs
// Permite "merge" multiple UTXOs
```

**Ventaja:** Puramente on-chain
**Desventaja:** Complicado, fragmentacion

### 9.2 No hay "Loops" ni Iteracion Global

**EVM:**
```solidity
// Liquidar todos los vaults unsafe
for (uint i = 0; i < vaults.length; i++) {
    if (isUnsafe(vaults[i])) {
        liquidate(vaults[i]);
    }
}
```

**UTXO:**
```rust
// No puedes iterar sobre "todos los vaults"
// Cada tx es aislada

// Solucion: Keepers identifican vaults unsafe off-chain
// Luego submitean tx para liquidar uno especifico
```

**Implicaciones:**

1. **Keeper Dependency:**
   - Sistema depende de bots externos
   - Similar a MakerDAO pero mas critico

2. **No Automatic Execution:**
   - Nada "pasa automaticamente"
   - Alguien debe submitear tx

3. **Incentive Design Crucial:**
   - Keepers deben ser profitable
   - Gas/fees consideration

**Mitigaciones:**

```rust
// Incentivos fuertes para keepers
liquidation_reward = max(
    fixed_amount,
    debt * percentage
)

// Multiple keepers compiten
// Profitable = participacion garantizada
```

### 9.3 No hay "Timestamps" Precisos

**EVM:**
```solidity
uint256 elapsed = block.timestamp - lastUpdate;
// Timestamp preciso por segundo
```

**Bitcoin/UTXO:**
```rust
// block.timestamp puede variar ±2 horas
// No confiable para fees precision

// Solucion: usar block height
let elapsed_blocks = current_block - last_update_block;

// Convertir blocks → tiempo (approx)
let elapsed_time = elapsed_blocks * AVG_BLOCK_TIME;  // ~10 min
```

**Implicaciones:**

1. **Fee Accrual:**
   - Menos preciso que Ethereum
   - Aceptable para stability fees (error ~±10 min)

2. **Auction Timing:**
   - Duration en blocks, no segundos
   - Price decay per block, no por segundo

**Mitigacion:**
```rust
// Diseñar parametros en blocks
pub struct AuctionParams {
    duration_blocks: u64,      // 36 blocks (~6 horas)
    decay_per_block: u64,      // Price decay per block
}

// Fees en rate per block
pub struct FeeParams {
    rate_per_block: u64,       // Compounding per block
}
```

### 9.4 No hay "Easy Oracle Integration"

**EVM:**
```solidity
// Chainlink oracle
uint256 price = oracle.latestAnswer();
```

**UTXO:**
```rust
// No external calls en validation

// Solucion 1: Oracle como Charms App
// Price updates son Spells
// Delayed via blocks

// Solucion 2: Cross-chain via Beaming
// Import price from Ethereum/Cardano
// Merkle proof verification

// Solucion 3: Multi-sig oracle
// Trusted parties sign prices
// Verificar signatures en Spell
```

**Implicaciones:**

1. **Latency:**
   - Price updates mas lentos
   - Mitigado por OSM-style delay anyway

2. **Trust Assumptions:**
   - Depende de oracle signers
   - O depende de cross-chain bridge

**Mitigacion:**
```rust
// Hybrid oracle
pub struct OraclePrice {
    price: u64,
    timestamp: u64,
    signatures: Vec<Signature>,  // Multi-sig
    chainlink_proof: Option<MerkleProof>,  // Cross-chain
}

// Validar en Spell
#[charms_spell]
pub fn validate_oracle(ctx: &SpellContext) -> bool {
    let oracle_data = ctx.params.get("oracle");

    // Opcion 1: Verificar multi-sig (>= threshold)
    let valid_sigs = verify_signatures(oracle_data.signatures);
    if valid_sigs >= THRESHOLD {
        return true;
    }

    // Opcion 2: Verificar Merkle proof de Chainlink
    if let Some(proof) = oracle_data.chainlink_proof {
        return verify_cross_chain_proof(proof);
    }

    false
}
```

### 9.5 Limitaciones de Smart Contract Complexity

**EVM:**
```solidity
// Logica arbitrariamente compleja
// Loops, recursion, etc.
```

**Charms (zkVM):**
```rust
// Limitado por:
// 1. Proof generation time
// 2. Proof size
// 3. Verification cost

// Complejidad aumenta costo exponencialmente
```

**Implicaciones:**

1. **Keep Spells Simple:**
   - Una operacion por Spell
   - No liquidar 100 vaults en 1 tx

2. **Off-chain Computation:**
   - Calculos complejos off-chain
   - Solo verify on-chain

**Best Practices:**
```rust
// BAD: Computacion pesada en Spell
#[charms_spell]
pub fn liquidate_all(ctx: &SpellContext) -> bool {
    for vault in get_all_vaults() {  // ✗ Expensive!
        if vault.is_unsafe() {
            liquidate(vault);
        }
    }
}

// GOOD: Specify vault to liquidate
#[charms_spell]
pub fn liquidate_vault(ctx: &SpellContext) -> bool {
    let vault_id = ctx.params.get("vault_id");
    let vault = get_vault(vault_id);

    // Simple check
    require!(vault.is_unsafe());

    // Simple action
    start_auction(vault);

    true
}
```

### 9.6 Dificultad para "Shared Liquidity Pools"

**EVM:**
```solidity
// Pool global de liquidez
uint256 totalLiquidity = pool.balance;

// Cualquiera puede contribuir/retirar
pool.deposit(amount);
```

**UTXO:**
```rust
// "Pool" es conjunto de UTXOs
// Difficulta gestion centralizada

// Solucion: Pool como Charms App con state
// O: Cada LP tiene su UTXO
```

**Aplicacion a zkUSD:**

- **Stability Pool** (para absorber bad debt) mas dificil
- **PSM** (Peg Stability Module) posible pero complejo
- Mejor usar mecanismos mas simples

---

## 10. SIMPLIFICACIONES POSIBLES

### 10.1 Menos Tipos de Auctions

**MakerDAO tiene 3:**
- Flip/Clip (collateral auctions)
- Flap (surplus auctions)
- Flop (debt auctions)

**zkUSD puede simplificar:**

```rust
// SOLO Dutch auctions para collateral
// Eliminar Flap/Flop

// Surplus management:
// - Burn zkUSD (reduce supply)
// - O distribute a governance token holders

// Debt management:
// - Insurance fund (pre-funded)
// - Backstop via governance treasury
// - Emergency shutdown si extremo
```

**Ventajas:**
- Menos complejidad
- Menos superficie de ataque
- Mas rapido de implementar

### 10.2 Fixed Stability Fee (Inicialmente)

**MakerDAO:**
```solidity
// Continuous compounding
// Ajustable via governance
// Diferente por collateral type
```

**zkUSD v1:**
```rust
// Fixed fee simple
pub const STABILITY_FEE: u64 = 2_00; // 2% anual

// O incluso 0% inicialmente
// Simplifica todo:
// - No need for Jug equivalent
// - No continuous compounding
// - Deuda = siempre mismo valor
```

**Cuando agregar fees:**
- Despues de product-market fit
- Cuando governance madura
- Si necesario para peg stability

### 10.3 Single Collateral Type (Fase 1)

**MakerDAO:** Multi-Collateral desde 2019

**zkUSD Roadmap:**

**Fase 1: BTC-only**
```rust
// Solo acepta BTC como collateral
// Simplifica enormemente:
// - 1 oracle
// - 1 set de parameters
// - 1 liquidation mechanism
```

**Fase 2: Agregar RUNE**
```rust
// Añadir Thorchain RUNE
// Test multi-collateral logic
```

**Fase 3: Arbitrary Assets**
```rust
// Cualquier asset via governance
// Sistema maduro y probado
```

**Ventajas:**
- Faster launch
- Easier audit
- Proven before scaling

### 10.4 No DSR (Dai Savings Rate)

**MakerDAO DSR:**
```solidity
// Users depositan DAI
// Earn interest
// Funded por stability fees
```

**zkUSD:**
```rust
// Skip DSR inicialmente
// Simplifica:
// - No Pot contract equivalent
// - No need to track deposits
// - No continuous rate calculations

// Agregar despues si demanda
```

**Alternativa:**
- Users pueden depositar zkUSD en DeFi protocols
- Earn yield alli
- zkUSD solo es stablecoin

### 10.5 Oracle Simplificado

**MakerDAO:**
- 15-20 feeds
- Medianizer
- OSM
- Multiple layers

**zkUSD v1:**
```rust
// Trusted multi-sig oracle (5-of-9)
pub struct SimplifiedOracle {
    signers: [Address; 9],
    threshold: u8,  // 5
    price: u64,
    last_update: u64,
}

// Validar precio tiene >=5 signatures validas
#[charms_spell]
pub fn update_price(ctx: &SpellContext) -> bool {
    let price_data: OracleUpdate = ctx.params.get("oracle_update");

    let valid_sigs = verify_multi_sig(
        price_data.price,
        price_data.timestamp,
        price_data.signatures,
    );

    valid_sigs >= 5  // Threshold
}
```

**Roadmap:**
1. **Launch:** Multi-sig oracle (5-of-9)
2. **Month 3:** Add Chainlink via cross-chain
3. **Month 6:** Add more feeds, implement Medianizer
4. **Month 12:** Fully decentralized oracle network

### 10.6 Governance Simplificada

**MakerDAO:**
- MKR token
- Chief (continuous approval)
- Pause (delay)
- Spell system

**zkUSD v1:**
```rust
// Multi-sig governance (inicialmente)
pub struct Governance {
    signers: [Address; 5],  // Core team
    threshold: u8,  // 3-of-5
}

// Ejecutar cambios via multi-sig
#[charms_spell]
pub fn update_parameter(ctx: &SpellContext) -> bool {
    let update: ParamUpdate = ctx.params.get("update");

    // Verify multi-sig
    let valid = verify_multi_sig(update.signatures);
    if !valid { return false; }

    // Apply change
    match update.param {
        "liquidation_ratio" => {
            set_liquidation_ratio(update.value);
        },
        "debt_ceiling" => {
            set_debt_ceiling(update.value);
        },
        // ...
    }

    true
}
```

**Transicion a DAO:**
```
Month 0-6:   Multi-sig (core team)
Month 6-12:  Hybrid (multi-sig + token votes)
Month 12+:   Full DAO (token governance)
```

### 10.7 No CDP Manager (Inicialmente)

**MakerDAO:** CDP Manager para UX

**zkUSD:**
```rust
// Vault = directamente UTXOs
// Sin abstraction layer
// Mas simple, menos features

// Agregar CDP Manager later si demanda:
// - Transferible vaults
// - Better UX
// - Proxy pattern
```

### 10.8 Parametros Conservadores

**Lanzar con parametros MUY seguros:**

```rust
pub const INITIAL_PARAMS: VaultParams = VaultParams {
    // Collateral ratio muy alto
    liquidation_ratio: 200,  // 200% (vs MakerDAO 150%)

    // Debt ceiling bajo
    debt_ceiling: 1_000_000,  // 1M zkUSD max

    // Liquidation penalty alto
    liquidation_penalty: 15,  // 15% (vs MakerDAO 13%)

    // Dust alto (evitar micro-vaults)
    debt_floor: 5000,  // 5000 zkUSD minimum

    // Sin stability fee
    stability_fee: 0,
};
```

**Iterar basado en data:**
- Monitorear collateralization ratios
- Ajustar si sistema muy safe
- Gradualmente acercarse a MakerDAO params

---

## 11. ARQUITECTURA PROPUESTA PARA zkUSD

### 11.1 Modulos Core

```
┌─────────────────────────────────────────────────────┐
│                   zkUSD SYSTEM                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ VaultEngine  │  │ Liquidator   │  │  Oracle   │ │
│  │              │  │              │  │           │ │
│  │ - Vaults     │  │ - Auctions   │  │ - Prices  │ │
│  │ - Collateral │  │ - Keepers    │  │ - Delay   │ │
│  │ - Debt       │  │              │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Governance   │  │ Emergency    │  │ Treasury  │ │
│  │              │  │ Shutdown     │  │           │ │
│  │ - Proposals  │  │              │  │ - Surplus │ │
│  │ - Voting     │  │ - Redemption │  │ - Reserve │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
         ↑                    ↑                    ↑
         │                    │                    │
    Bitcoin Layer        Charms Apps          zkVM Proofs
```

### 11.2 Vault Engine

**Responsabilidades:**
- Core accounting
- Vault management
- Collateral tracking
- Debt calculations

**State:**
```rust
pub struct VaultEngineState {
    // Global parameters
    total_supply: u64,           // Total zkUSD minted
    surplus: i64,                // Surplus/deficit

    // Collateral types
    collateral_types: HashMap<CollateralId, CollateralType>,

    // Vaults
    vaults: HashMap<VaultId, Vault>,

    // Last update
    last_update_block: u64,
}

pub struct Vault {
    id: VaultId,
    owner: Address,
    collateral_type: CollateralId,
    collateral_amount: u64,      // satoshis
    debt: u64,                   // zkUSD
    last_update_block: u64,
}
```

**Operations:**
```rust
// Open vault & mint zkUSD
#[charms_spell]
pub fn open_vault(ctx: &SpellContext) -> bool {
    let params = ctx.params;

    // Verify BTC collateral input
    let btc_in = get_btc_inputs(ctx);
    require!(btc_in > 0, "no collateral");

    // Calculate max debt
    let price = get_oracle_price();
    let max_debt = (btc_in * price) / liquidation_ratio;

    let debt = params.get("debt_to_mint");
    require!(debt <= max_debt, "insufficient collateral");
    require!(debt >= DEBT_FLOOR, "below minimum");

    // Create vault UTXO (locked BTC)
    ctx.add_output(VaultUTXO {
        owner: ctx.caller,
        collateral: btc_in,
        debt: debt,
        collateral_type: BTC_COLLATERAL_ID,
    });

    // Mint zkUSD to user
    ctx.add_output(zkUSDOutput {
        address: ctx.caller,
        amount: debt,
    });

    true
}

// Repay debt & close vault
#[charms_spell]
pub fn close_vault(ctx: &SpellContext) -> bool {
    // Verify vault ownership
    let vault_in = get_vault_input(ctx);
    require!(vault_in.owner == ctx.caller);

    // Verify zkUSD repayment
    let zkusd_in = get_zkusd_inputs(ctx);
    require!(zkusd_in >= vault_in.debt, "insufficient repayment");

    // Return BTC collateral
    ctx.add_output(BTCOutput {
        address: ctx.caller,
        amount: vault_in.collateral,
    });

    // Burn zkUSD (no output = burn)

    // Return change if overpaid
    if zkusd_in > vault_in.debt {
        ctx.add_output(zkUSDOutput {
            address: ctx.caller,
            amount: zkusd_in - vault_in.debt,
        });
    }

    true
}

// Add collateral
#[charms_spell]
pub fn add_collateral(ctx: &SpellContext) -> bool {
    let vault_in = get_vault_input(ctx);
    require!(vault_in.owner == ctx.caller);

    let btc_in = get_btc_inputs(ctx);

    // Update vault
    ctx.add_output(VaultUTXO {
        owner: vault_in.owner,
        collateral: vault_in.collateral + btc_in,
        debt: vault_in.debt,
        collateral_type: vault_in.collateral_type,
    });

    true
}

// Mint more zkUSD
#[charms_spell]
pub fn mint_more(ctx: &SpellContext) -> bool {
    let vault_in = get_vault_input(ctx);
    require!(vault_in.owner == ctx.caller);

    let additional_debt = ctx.params.get("additional_debt");

    // Check still safe
    let new_debt = vault_in.debt + additional_debt;
    let price = get_oracle_price();
    let collateral_value = vault_in.collateral * price;

    require!(
        collateral_value >= new_debt * liquidation_ratio,
        "would be unsafe"
    );

    // Update vault
    ctx.add_output(VaultUTXO {
        owner: vault_in.owner,
        collateral: vault_in.collateral,
        debt: new_debt,
        collateral_type: vault_in.collateral_type,
    });

    // Mint additional zkUSD
    ctx.add_output(zkUSDOutput {
        address: ctx.caller,
        amount: additional_debt,
    });

    true
}
```

### 11.3 Liquidation Module

**Mecanismo:** Dutch Auctions (como MakerDAO Liq 2.0)

**State:**
```rust
pub struct AuctionState {
    active_auctions: HashMap<AuctionId, Auction>,
}

pub struct Auction {
    id: AuctionId,
    vault_id: VaultId,
    collateral_amount: u64,
    debt_to_cover: u64,
    start_price: u64,           // oracle_price * 1.1
    start_block: u64,
    duration_blocks: u64,       // 36 blocks (~6h)
    cusp: u64,                  // 0.4 (40%)
    decay_per_block: u64,
}
```

**Operations:**
```rust
// Keeper inicia liquidacion
#[charms_spell]
pub fn liquidate(ctx: &SpellContext) -> bool {
    let vault_in = get_vault_input(ctx);

    // Check vault unsafe
    let price = get_oracle_price();
    let collateral_value = vault_in.collateral * price;
    let min_collateral = vault_in.debt * liquidation_ratio;

    require!(
        collateral_value < min_collateral,
        "vault is safe"
    );

    // Start auction
    let auction_id = create_auction(Auction {
        id: generate_auction_id(),
        vault_id: vault_in.id,
        collateral_amount: vault_in.collateral,
        debt_to_cover: vault_in.debt + (vault_in.debt * penalty / 100),
        start_price: price * 110 / 100,  // 10% above oracle
        start_block: ctx.block_height,
        duration_blocks: 36,
        cusp: 40,  // 40% minimum
        decay_per_block: 9990,  // 0.10% per block
    });

    // Incentivo para keeper
    let incentive = calculate_keeper_incentive(vault_in.debt);
    ctx.add_output(zkUSDOutput {
        address: ctx.caller,
        amount: incentive,
    });

    // Vault collateral va a auction contract
    // (implementado como Charms App state)

    true
}

// Participar en auction
#[charms_spell]
pub fn auction_take(ctx: &SpellContext) -> bool {
    let auction_id = ctx.params.get("auction_id");
    let auction = get_auction(auction_id);

    // Calculate current price
    let elapsed = ctx.block_height - auction.start_block;
    let current_price = calculate_auction_price(auction, elapsed);

    let amount_to_buy = ctx.params.get("amount");
    let cost = amount_to_buy * current_price / WAD;

    // Verify zkUSD payment
    let zkusd_in = get_zkusd_inputs(ctx);
    require!(zkusd_in >= cost, "insufficient payment");

    // Transfer collateral to buyer
    ctx.add_output(BTCOutput {
        address: ctx.caller,
        amount: amount_to_buy,
    });

    // Burn zkUSD payment

    // Update auction (reduce remaining)
    update_auction(auction_id, amount_to_buy);

    // Return change
    if zkusd_in > cost {
        ctx.add_output(zkUSDOutput {
            address: ctx.caller,
            amount: zkusd_in - cost,
        });
    }

    true
}

// Helper: calculate auction price
fn calculate_auction_price(auction: &Auction, elapsed_blocks: u64) -> u64 {
    if elapsed_blocks >= auction.duration_blocks {
        // Minimum price
        return auction.start_price * auction.cusp / 100;
    }

    // Exponential decay
    let decay_factor = rpow(
        auction.decay_per_block,
        elapsed_blocks,
        RAY
    );

    auction.start_price * decay_factor / RAY
}
```

### 11.4 Oracle Module

**Arquitectura:**
```
Off-chain Feeds → Multi-sig Aggregator → OSM Delay → VaultEngine
```

**State:**
```rust
pub struct OracleState {
    // Current (delayed) price
    current_price: u64,
    current_block: u64,

    // Next (queued) price
    next_price: u64,
    next_block: u64,

    // Delay in blocks
    delay_blocks: u64,  // 6 blocks (~1 hour)

    // Authorized signers
    signers: [Address; 9],
    threshold: u8,  // 5
}
```

**Operations:**
```rust
// Update price (multi-sig)
#[charms_spell]
pub fn update_oracle(ctx: &SpellContext) -> bool {
    let update: OracleUpdate = ctx.params.get("oracle_update");

    // Verify signatures
    let valid_sigs = verify_multi_sig(
        &update.price,
        &update.timestamp,
        &update.signatures,
        &ORACLE_SIGNERS,
    );

    require!(valid_sigs >= 5, "insufficient signatures");

    // Check not stale
    require!(
        update.timestamp > last_oracle_update,
        "stale update"
    );

    let mut oracle = load_oracle_state();

    // Check if delay passed
    if ctx.block_height >= oracle.next_block + oracle.delay_blocks {
        // Promote next → current
        oracle.current_price = oracle.next_price;
        oracle.current_block = ctx.block_height;
    }

    // Queue new price
    oracle.next_price = update.price;
    oracle.next_block = ctx.block_height;

    save_oracle_state(oracle);

    true
}

// Read current price (usado por otros modulos)
pub fn get_oracle_price() -> u64 {
    let oracle = load_oracle_state();
    oracle.current_price
}
```

**Proceso:**
```
1. Feeds off-chain fetchean precio (Coinbase, Kraken, etc.)
2. Agregador calcula mediana
3. 5+ signers firman precio
4. Spell submiteado a blockchain
5. Precio queda en "next" por 6 blocks (~1 hora)
6. Despues de delay, otro spell promotes next → current
7. VaultEngine usa current price
```

### 11.5 Governance Module

**Fase 1: Multi-sig (Meses 0-6)**
```rust
pub struct GovernanceV1 {
    signers: [Address; 5],
    threshold: u8,  // 3
}

#[charms_spell]
pub fn execute_governance_action(ctx: &SpellContext) -> bool {
    let action: GovAction = ctx.params.get("action");

    // Verify multi-sig
    require!(
        verify_multi_sig(&action.data, &action.signatures) >= 3,
        "insufficient signatures"
    );

    // Execute action
    match action.action_type {
        ActionType::UpdateParameter(param, value) => {
            update_parameter(param, value);
        },
        ActionType::AddCollateral(config) => {
            add_collateral_type(config);
        },
        ActionType::EmergencyPause => {
            emergency_pause();
        },
        // ...
    }

    true
}
```

**Fase 2: Governance Token (Meses 6+)**
```rust
pub struct GovernanceV2 {
    proposals: HashMap<ProposalId, Proposal>,
    votes: HashMap<ProposalId, HashMap<Address, Vote>>,
    delay_blocks: u64,  // 288 blocks (~48 hours)
}

pub struct Proposal {
    id: ProposalId,
    proposer: Address,
    actions: Vec<Action>,
    created_block: u64,
    eta: u64,  // Execution block
    votes_for: u64,
    votes_against: u64,
    executed: bool,
}

// Create proposal
#[charms_spell]
pub fn propose(ctx: &SpellContext) -> bool {
    let actions: Vec<Action> = ctx.params.get("actions");

    // Check proposer has enough governance tokens
    let balance = get_gov_token_balance(ctx.caller);
    require!(balance >= PROPOSAL_THRESHOLD, "insufficient balance");

    let proposal_id = generate_proposal_id();
    let eta = ctx.block_height + DELAY_BLOCKS;

    create_proposal(Proposal {
        id: proposal_id,
        proposer: ctx.caller,
        actions,
        created_block: ctx.block_height,
        eta,
        votes_for: 0,
        votes_against: 0,
        executed: false,
    });

    true
}

// Vote
#[charms_spell]
pub fn vote(ctx: &SpellContext) -> bool {
    let proposal_id = ctx.params.get("proposal_id");
    let support: bool = ctx.params.get("support");

    // Weight = governance token balance
    let weight = get_gov_token_balance(ctx.caller);

    record_vote(proposal_id, ctx.caller, support, weight);

    true
}

// Execute (after delay)
#[charms_spell]
pub fn execute_proposal(ctx: &SpellContext) -> bool {
    let proposal_id = ctx.params.get("proposal_id");
    let proposal = get_proposal(proposal_id);

    // Checks
    require!(ctx.block_height >= proposal.eta, "delay not passed");
    require!(!proposal.executed, "already executed");
    require!(
        proposal.votes_for > proposal.votes_against,
        "proposal rejected"
    );
    require!(
        proposal.votes_for >= QUORUM,
        "quorum not reached"
    );

    // Execute actions atomically
    for action in proposal.actions {
        execute_action(action)?;
    }

    mark_executed(proposal_id);

    true
}
```

### 11.6 Emergency Shutdown

**Trigger:**
```rust
pub struct EmergencyModule {
    live: bool,
    threshold_tokens: u64,  // Amount needed to trigger
    deposited: u64,
}

// Burn governance tokens to trigger shutdown
#[charms_spell]
pub fn trigger_shutdown(ctx: &SpellContext) -> bool {
    let amount = ctx.params.get("amount");

    // Burn tokens (irreversible!)
    burn_governance_tokens(ctx.caller, amount);

    let mut em = load_emergency_module();
    em.deposited += amount;

    if em.deposited >= em.threshold_tokens {
        // TRIGGER SHUTDOWN
        em.live = false;

        // Freeze system
        freeze_vault_operations();
        freeze_liquidations();
        cancel_all_auctions();

        // Snapshot prices
        snapshot_oracle_prices();
    }

    save_emergency_module(em);

    true
}
```

**Redemption:**
```rust
#[charms_spell]
pub fn redeem_after_shutdown(ctx: &SpellContext) -> bool {
    let em = load_emergency_module();
    require!(!em.live, "system still running");

    let zkusd_in = get_zkusd_inputs(ctx);

    // Calculate redemption (pro-rata)
    let total_zkusd = get_total_supply();
    let total_btc_collateral = get_total_btc_collateral();

    let btc_share = (zkusd_in * total_btc_collateral) / total_zkusd;

    // Transfer BTC to redeemer
    ctx.add_output(BTCOutput {
        address: ctx.caller,
        amount: btc_share,
    });

    // Burn zkUSD (no output)

    true
}
```

### 11.7 Deployment Phases

**Phase 0: Testnet (Month 1-2)**
```
- Deploy core modules
- Basic vault operations
- Simple oracle (multi-sig)
- Testing & audits
```

**Phase 1: Mainnet Launch (Month 3)**
```
- BTC-only collateral
- Conservative parameters:
  * 200% collateralization
  * 1M zkUSD debt ceiling
  * 5000 zkUSD minimum debt
- Multi-sig governance (3-of-5)
- Multi-sig oracle (5-of-9)
```

**Phase 2: Decentralization (Month 4-6)**
```
- Add more oracle feeds
- Implement OSM delay
- Launch governance token
- Transition to DAO governance
```

**Phase 3: Expansion (Month 7-12)**
```
- Add RUNE collateral
- Add other Charms-compatible assets
- Implement stability fees
- Optimize liquidation parameters
```

**Phase 4: Advanced Features (Month 12+)**
```
- DSR (savings rate)
- PSM (peg stability module)
- Cross-chain expansion via Beaming
- Advanced governance features
```

---

## CONCLUSIONES Y NEXT STEPS

### Patrones MakerDAO Aplicables a zkUSD

1. **Separation of Concerns** ✓
   - Modulos independientes
   - Core accounting aislado
   - Adapters para assets externos

2. **Accounting Invariants** ✓
   - Conservacion de valor
   - Collateral backing guarantee
   - Verificable via ZK proofs

3. **Oracle Security Module** ✓
   - Time delay (6 blocks ~1h)
   - Multi-sig agregacion
   - Future: Decentralized feeds

4. **Dutch Auctions** ✓
   - Instant settlement
   - Capital efficient
   - Fair price discovery

5. **Emergency Shutdown** ✓
   - Decentralized trigger
   - Fair redemption
   - System safety valve

### Adaptaciones Necesarias para UTXO

1. **State Management**
   - Charms App state (off-chain storage + commitment)
   - UTXO como vault representation
   - Indexer para queries

2. **No Global Loops**
   - Keeper-driven liquidations
   - One vault per transaction
   - Strong incentives crucial

3. **Oracle Integration**
   - Multi-sig (short-term)
   - Cross-chain via Beaming (medium-term)
   - Decentralized feeds (long-term)

4. **Simplified Initially**
   - Single collateral (BTC)
   - No stability fees
   - Multi-sig governance
   - Add complexity gradually

### Lecciones de Black Thursday

1. **Circuit Breakers** ✓ Implement desde dia 1
2. **Keeper Incentives** ✓ Robustos y competitivos
3. **Auction Duration** ✓ 6 horas (36 blocks)
4. **Oracle Redundancy** ✓ Multiple signers
5. **Conservative Params** ✓ 200% ratio inicial

### Recommended Architecture

```rust
zkUSD = {
    VaultEngine: {
        collateral_types: [BTC],
        vaults: UTXO-based,
        accounting: Invariant-protected,
    },

    Liquidation: {
        mechanism: DutchAuction,
        duration: 36_blocks,
        incentives: chip + tip,
    },

    Oracle: {
        phase1: MultiSig(5of9),
        phase2: Medianizer + OSM,
        delay: 6_blocks,
    },

    Governance: {
        phase1: MultiSig(3of5),
        phase2: Token + DAO,
        delay: 288_blocks,
    },

    Emergency: {
        trigger: BurnTokens(threshold),
        redemption: ProRata,
    },
}
```

### Next Steps

1. **Diseñar schemas detallados** de cada modulo
2. **Implementar VaultEngine** como Charms App
3. **Crear oracle multi-sig** con feeds iniciales
4. **Desarrollar liquidation bot** de referencia
5. **Auditar** antes de mainnet
6. **Lanzar en testnet** con usuarios beta
7. **Iterar** basado en feedback
8. **Mainnet launch** conservador
9. **Gradualmente descentralizar** governance y oracles
10. **Expandir** collateral types y features

---

## FUENTES Y REFERENCIAS

### Documentacion MakerDAO
- [MakerDAO Technical Docs](https://docs.makerdao.com/)
- [Dai Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/dai-module/dai-detailed-documentation)
- [Vat Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/core-module/vat-detailed-documentation)
- [Core Module](https://docs.makerdao.com/smart-contract-modules/core-module)
- [Liquidation 2.0 Module](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation)
- [Cat Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/core-module/cat-detailed-documentation)
- [Oracle Security Module (OSM) Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/oracle-module/oracle-security-module-osm-detailed-documentation)
- [Oracle Module](https://docs.makerdao.com/smart-contract-modules/oracle-module)
- [Median Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/oracle-module/median-detailed-documentation)
- [Jug Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/rates-module/jug-detailed-documentation)
- [Flapper Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/system-stabilizer-module/flap-detailed-documentation)
- [Flopper Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/system-stabilizer-module/flop-detailed-documentation)
- [The Auctions of the Maker Protocol](https://docs.makerdao.com/keepers/the-auctions-of-the-maker-protocol)
- [End Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/shutdown/end-detailed-documentation)
- [Emergency Shutdown Module](https://docs.makerdao.com/smart-contract-modules/shutdown/emergency-shutdown-module)
- [The Emergency Shutdown Process for Multi-Collateral Dai (MCD)](https://docs.makerdao.com/smart-contract-modules/shutdown/the-emergency-shutdown-process-for-multi-collateral-dai-mcd)
- [Governance Module](https://docs.makerdao.com/smart-contract-modules/governance-module)
- [Chief Detailed Documentation](https://docs.makerdao.com/smart-contract-modules/governance-module/chief-detailed-documentation)

### Codigo Fuente
- [GitHub - makerdao/dss: Dai Stablecoin System](https://github.com/makerdao/dss)
- [MCD Security Audit Reports](https://github.com/makerdao/mcd-security/blob/master/audit-reports.md)
- [GitHub - makerdao/dss-deploy](https://github.com/makerdao/dss-deploy)

### Black Thursday Analysis
- [Black Thursday for MakerDAO: $8.32 million was liquidated for 0 DAI](https://medium.com/@whiterabbit_hq/black-thursday-for-makerdao-8-32-million-was-liquidated-for-0-dai-36b83cac56b6)
- [What Really Happened To MakerDAO?](https://insights.glassnode.com/what-really-happened-to-makerdao/)
- [The Market Collapse of March 12-13, 2020](https://blog.makerdao.com/the-market-collapse-of-march-12-2020-how-it-impacted-makerdao/)
- [MakerDAO Takes New Measures to Prevent Another 'Black Swan' Collapse](https://cointelegraph.com/news/makerdao-takes-new-measures-to-prevent-another-black-swan-collapse)

### Bitcoin Stablecoins & UTXO
- [Taproot Assets | Builder's Guide](https://docs.lightning.engineering/the-lightning-network/taproot-assets)
- [RGB vs Taproot Assets: protocols compared](https://atlas21.com/rgb-vs-taproot-assets-protocols-compared/)
- [UTXO vs. Account Models | Alchemy Docs](https://www.alchemy.com/docs/utxo-vs-account-models)
- [Plasma Review: Understanding The Stablecoin-First Blockchain](https://crypto-economy.com/plasma/)
- [Collateralized Debt Position (CDP) in DeFi](https://metana.io/blog/what-is-collateralized-debt-position-cdp-in-defi/)
- [DigiDollar Whitepaper: A Fully Decentralized USD Stablecoin on The DigiByte Blockchain](https://github.com/orgs/DigiByte-Core/discussions/319)

---

**Documento generado:** 2025-12-13
**Para:** zkUSD Project - BOS Hackathon 2025
**Version:** 1.0
