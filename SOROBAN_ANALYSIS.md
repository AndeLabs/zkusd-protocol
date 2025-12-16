# ANALISIS SOROBAN - APLICABILIDAD A zkUSD

## RESUMEN EJECUTIVO

Soroban es la plataforma de smart contracts de Stellar, lanzada con el objetivo de crear una "red de activos" global. Despues de una investigacion profunda, concluimos que:

**VEREDICTO: PARCIALMENTE APLICABLE**

- **SI adoptar**: Patrones de diseño, error handling, testing, interfaces de tokens
- **NO adoptar**: Arquitectura fundamental (account-based vs UTXO)
- **Razon**: Soroban optimiza para Stellar (bajo costo, rapido), zkUSD optimiza para Bitcoin (seguridad, descentralizacion)

---

## 1. QUE ES SOROBAN

### 1.1 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    STELLAR NETWORK                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              HOST ENVIRONMENT (Stellar Core)           │  │
│  │  - WASM Interpreter                                    │  │
│  │  - Storage Interface (3 tiers)                         │  │
│  │  - Fee/Resource Metering                               │  │
│  │  - Authorization Framework                             │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ▲                                   │
│                          │                                   │
│  ┌─────────────┐  ┌──────┴──────┐  ┌─────────────┐         │
│  │  Contract A │  │  Contract B │  │  Contract C │         │
│  │   (WASM)    │  │   (WASM)    │  │   (WASM)    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Caracteristicas Clave

| Caracteristica | Soroban | Charms (zkUSD) |
|----------------|---------|----------------|
| **Lenguaje** | Rust | Rust |
| **Runtime** | WASM | WASM via zkVM |
| **Blockchain** | Stellar | Bitcoin L1 |
| **Modelo** | Account-based | UTXO-based |
| **Consenso** | Stellar BFT | Bitcoin PoW |
| **Finality** | ~5 segundos | ~1 hora |
| **Fees** | Fracciones de centavo | $1-100 (Bitcoin) |

### 1.3 Enfoque de Stellar

Stellar se enfoca en:
- Pagos cross-border
- Stablecoins (USDC, EURC, PYUSD)
- Integracion con sistema financiero tradicional
- Ultra-bajo costo y alta velocidad

---

## 2. PATRONES UTILES DE SOROBAN

### 2.1 Three-Tier Storage (Adaptable)

Soroban tiene 3 tipos de almacenamiento:

```rust
// Instance Storage (pequeno, critico, 100KB max)
env.storage().instance().set(&key, &admin_address);

// Persistent Storage (grande, con TTL)
env.storage().persistent().set(&key, &vault_state);

// Temporary Storage (efimero, barato)
env.storage().temporary().set(&key, &price_feed);
```

**Adaptacion para zkUSD (UTXO-based)**:

```rust
// En lugar de storage tiers, usar diferentes UTXOs:

// "Instance" → Codificar en script pubkey (pequeno)
pub struct ProtocolConfig {
    admin: Address,
    mcr: u64,
    ccr: u64,
}

// "Persistent" → UTXO dedicado por vault
pub struct VaultUTXO {
    vault_id: [u8; 32],
    state: VaultState,
}

// "Temporary" → Cache en indexador (off-chain)
// No gastar fees de Bitcoin en datos efimeros
```

### 2.2 Error Handling con Result

**Soroban (mejor practice)**:
```rust
#[derive(Debug)]
pub enum ContractError {
    InvalidAmount,
    InsufficientBalance,
    Unauthorized,
}

pub fn transfer(...) -> Result<(), ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }
    Ok(())
}
```

**Aplicar a zkUSD**:
```rust
// Actual (bool)
pub fn validate(ctx: &SpellContext) -> bool {
    if icr < MCR { return false; }
    true
}

// Mejorado (Result)
pub fn validate(ctx: &SpellContext) -> Result<(), VaultError> {
    if icr < MCR {
        return Err(VaultError::Undercollateralized { current: icr, required: MCR });
    }
    Ok(())
}
```

### 2.3 Token Interface (SEP-41)

Soroban define un estandar para tokens:

```rust
pub trait Token {
    fn transfer(from: Address, to: Address, amount: i128) -> Result<(), Error>;
    fn balance(id: Address) -> i128;
    fn approve(from: Address, spender: Address, amount: i128) -> Result<(), Error>;
    fn allowance(from: Address, spender: Address) -> i128;
    fn burn(from: Address, amount: i128) -> Result<(), Error>;
    fn decimals() -> u32;
    fn name() -> String;
    fn symbol() -> String;
}
```

**Para zkUSD Token**:
```rust
// Agregar metadata como constantes
pub const TOKEN_NAME: &str = "zkUSD";
pub const TOKEN_SYMBOL: &str = "zkUSD";
pub const DECIMALS: u8 = 8;

// Agregar eventos
pub enum TokenEvent {
    Transfer { from: Address, to: Address, amount: u64 },
    Mint { to: Address, amount: u64 },
    Burn { from: Address, amount: u64 },
}

// Emitir eventos en operaciones
fn emit_transfer(ctx: &SpellContext, from: &Address, to: &Address, amount: u64) {
    ctx.emit_event(TokenEvent::Transfer { from: from.clone(), to: to.clone(), amount });
}
```

### 2.4 Testing Framework

**Soroban testutils**:
```rust
#[test]
fn test_transfer() {
    let env = Env::default();
    let contract = env.register(MyContract, ());
    let client = ContractClient::new(&env, &contract);

    env.mock_all_auths();

    let result = client.transfer(&alice, &bob, &100);
    assert_eq!(client.balance(&bob), 100);
}
```

**Crear para Charms/zkUSD**:
```rust
// tests/common/mod.rs
pub struct TestContext {
    inputs: Vec<UTXO>,
    outputs: Vec<UTXO>,
    oracle_price: u64,
    block_height: u64,
}

impl TestContext {
    pub fn new() -> Self { /* ... */ }
    pub fn with_collateral(mut self, amount: u64) -> Self { /* ... */ }
    pub fn with_debt(mut self, amount: u64) -> Self { /* ... */ }
    pub fn with_price(mut self, price: u64) -> Self { /* ... */ }
}

#[test]
fn test_open_vault() {
    let ctx = TestContext::new()
        .with_collateral(1_500_000_000) // 15 BTC
        .with_debt(1_000_000_000_000)   // 10,000 zkUSD
        .with_price(100_000_000_000);   // $100,000/BTC

    let result = validate_open_vault(&ctx.into());
    assert!(result.is_ok());
}
```

### 2.5 Authorization Pattern

**Soroban**:
```rust
pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth();  // Verifica firma automaticamente
    // ...
}
```

**Para zkUSD (ya lo tienes similar)**:
```rust
pub fn validate(ctx: &SpellContext) -> bool {
    // Tu implementacion actual es correcta
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }
    // ...
}
```

---

## 3. DeFi EN SOROBAN (REFERENCIA)

### 3.1 Protocolos Existentes

| Protocolo | Tipo | Relevancia para zkUSD |
|-----------|------|----------------------|
| **Soroswap** | DEX AMM | Bajo (no necesitamos DEX) |
| **Blend** | Lending | Medio (patrones de pools) |
| **Orbit CDP** | Stablecoin | **ALTO** (mismo concepto) |
| **DIA Oracles** | Oracle | Alto (integracion oracle) |

### 3.2 Orbit CDP (Mas Relevante)

Orbit es el CDP mas similar a zkUSD en Soroban:

```
Orbit vs zkUSD:
┌─────────────────┬─────────────────┬─────────────────┐
│ Feature         │ Orbit (Soroban) │ zkUSD (Charms)  │
├─────────────────┼─────────────────┼─────────────────┤
│ Collateral      │ XLM             │ BTC             │
│ Stablecoin      │ oUSD            │ zkUSD           │
│ MCR             │ 120%            │ 110%            │
│ Interest        │ Variable        │ 0%              │
│ Liquidation     │ PegKeeper       │ Stability Pool  │
│ Multi-currency  │ Si (oEUR, etc)  │ No (solo zkUSD) │
└─────────────────┴─────────────────┴─────────────────┘
```

**Lecciones de Orbit**:
1. Integracion con lending pool (Blend) para yield
2. PegKeeper para mantener peg (diferente a Stability Pool)
3. Gobernanza DAO desde inicio

### 3.3 Oracles en Soroban

**DIA Oracle (principal)**:
```rust
// Soroban tiene SEP-40 para oracles
// Similar a lo que necesitamos para zkUSD

pub trait PriceOracle {
    fn get_price(asset: Symbol) -> Result<PriceData, OracleError>;
    fn get_last_update() -> u64;
}

pub struct PriceData {
    price: i128,      // Con decimales
    timestamp: u64,   // Block cuando se actualizo
    source: String,   // Identificador de fuente
}
```

**Aplicar a zkUSD Oracle**:
```rust
// Ya tienes algo similar, mejorar con:
pub struct PriceData {
    pub price: u64,
    pub timestamp: u64,
    pub is_stale: bool,  // Agregar flag de freshness
}

// Verificacion de staleness
const MAX_PRICE_AGE: u64 = 10; // blocks

fn is_price_valid(ctx: &SpellContext, data: &PriceData) -> bool {
    ctx.block_height() - data.timestamp <= MAX_PRICE_AGE
}
```

---

## 4. COMPARACION: SOROBAN vs CHARMS

### 4.1 Ventajas de Soroban

| Ventaja | Descripcion | Relevante para zkUSD? |
|---------|-------------|----------------------|
| **Bajo costo** | ~$0.0001 por tx | NO (usamos Bitcoin) |
| **Rapido** | 5 seg finality | NO (Bitcoin es lento pero seguro) |
| **SAC nativo** | Assets de Stellar | NO (usamos xBTC) |
| **Ecosystem** | USDC, PayPal | NO (diferentes usuarios) |

### 4.2 Ventajas de Charms/zkUSD

| Ventaja | Descripcion | Diferenciador |
|---------|-------------|---------------|
| **Seguridad Bitcoin** | PoW de Bitcoin | SI - mas seguro |
| **ZK Proofs** | Privacidad y verificacion | SI - unico |
| **Bitcoin Nativo** | Sin bridges | SI - mas simple |
| **Cross-chain Beaming** | Sin bridges tradicionales | SI - innovador |

### 4.3 Tabla de Decision

| Aspecto | Adoptar de Soroban? | Razon |
|---------|---------------------|-------|
| Error handling (Result) | **SI** | Mejor DX |
| Storage tiers concept | **SI** (adaptado) | Optimizacion |
| Token interface | **SI** | Interoperabilidad |
| Testing patterns | **SI** | Calidad |
| Account model | **NO** | UTXO es mejor para Bitcoin |
| BFT consensus | **NO** | PoW es mas seguro |
| Stellar assets | **NO** | Usamos xBTC |
| Fee structure | **NO** | Diferentes economias |

---

## 5. RECOMENDACIONES PARA zkUSD

### 5.1 ADOPTAR (Alta Prioridad)

#### 1. Error Handling Mejorado

```rust
// ANTES (actual)
pub fn validate(ctx: &SpellContext) -> bool { /* ... */ }

// DESPUES
#[derive(Debug)]
pub enum ZkUsdError {
    VaultNotFound,
    Undercollateralized { current: u128, required: u128 },
    InvalidAmount,
    OracleStale,
    Unauthorized,
}

pub fn validate(ctx: &SpellContext) -> Result<(), ZkUsdError> { /* ... */ }
```

#### 2. Token Metadata y Eventos

```rust
// Agregar al zkUSD Token contract
pub mod metadata {
    pub const NAME: &str = "zkUSD";
    pub const SYMBOL: &str = "zkUSD";
    pub const DECIMALS: u8 = 8;
}

// Eventos para indexadores
pub fn emit_transfer(ctx: &SpellContext, from: &Address, to: &Address, amount: u64) {
    // Log para indexadores
}
```

#### 3. Testing Framework

```rust
// Crear test helpers
mod test_utils {
    pub fn create_vault(collateral: u64, debt: u64) -> Vault;
    pub fn mock_oracle_price(price: u64);
    pub fn assert_icr(vault: &Vault, expected: u64);
}
```

### 5.2 CONSIDERAR (Media Prioridad)

#### 1. Storage Tiers Adaptado

Separar estado por "criticidad" y "frecuencia de actualizacion":
- Critico (admin, params) → Script pubkey
- Vaults → UTXOs dedicados
- Precios → Off-chain cache

#### 2. Documentacion Estilo Soroban

Estructura de docs clara con ejemplos.

### 5.3 NO ADOPTAR

| Aspecto | Razon |
|---------|-------|
| Account model | UTXO es core de Bitcoin/Charms |
| Stellar Assets | Usamos xBTC, no XLM |
| Fee structure | Diferentes economias |
| BFT consensus | PoW da mas seguridad |

---

## 6. CONCLUSION

### Es Soroban Necesario para zkUSD?

**NO** - Soroban es una plataforma diferente con objetivos diferentes.

### Es Util Estudiar Soroban?

**SI** - Hay patrones valiosos:
1. Error handling con tipos
2. Testing framework
3. Token standards
4. Documentacion

### Que Adoptar Concretamente?

```rust
// 1. Error types
pub enum VaultError { /* ... */ }
pub enum TokenError { /* ... */ }

// 2. Result returns
pub fn validate(...) -> Result<(), VaultError>

// 3. Token metadata
pub const NAME: &str = "zkUSD";

// 4. Event emissions
pub fn emit_event(...)

// 5. Test helpers
mod test_utils { /* ... */ }
```

### Diferenciadores de zkUSD (Mantener)

1. **Bitcoin L1 Nativo** - No es sidechain como Soroban
2. **ZK Proofs** - Soroban no tiene esto
3. **0% Interest** - Modelo Liquity
4. **Cross-chain Beaming** - Sin bridges tradicionales

---

## 7. PROXIMOS PASOS

1. [ ] Implementar error types en contracts existentes
2. [ ] Agregar metadata a zkUSD Token
3. [ ] Crear test_utils library
4. [ ] Documentar APIs con ejemplos
5. [ ] NO cambiar arquitectura fundamental

---

## FUENTES

- Soroban Documentation: https://developers.stellar.org/docs/build/smart-contracts
- SEP-41 Token Standard: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md
- Soroban Examples: https://github.com/stellar/soroban-examples
- Orbit CDP: https://docs.orbitcdp.finance/
- Blend Capital: https://docs.blend.capital/
