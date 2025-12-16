# ARQUITECTURA zkUSD - STABLECOIN CDP NATIVO EN BITCOIN

## RESUMEN EJECUTIVO

zkUSD es la primera stablecoin CDP (Collateralized Debt Position) nativa en Bitcoin L1, construida sobre Charms Protocol. A diferencia de Mezo (sidechain) o Arkadiko (Stacks), zkUSD opera directamente en Bitcoin usando pruebas ZK.

**Diferenciadores clave**:
- Bitcoin L1 nativo (no sidechain)
- ZK proofs para validación
- 0% interest (modelo Liquity)
- Cross-chain via beaming (no bridges)
- Arquitectura modular reutilizable

---

## 1. ARQUITECTURA DE ALTO NIVEL

### 1.1 Diagrama del Sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          zkUSD PROTOCOL ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │                         USER LAYER                                  │     │
│  │                                                                     │     │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │     │
│  │   │   Web UI    │    │  Wallet     │    │   SDK/API   │            │     │
│  │   │  (Next.js)  │    │  (Unisat)   │    │ (TypeScript)│            │     │
│  │   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘            │     │
│  └──────────┼──────────────────┼──────────────────┼───────────────────┘     │
│             │                  │                  │                          │
│             └──────────────────┼──────────────────┘                          │
│                                │                                             │
│  ┌─────────────────────────────┼──────────────────────────────────────┐     │
│  │                    PROTOCOL LAYER (Charms Apps)                     │     │
│  │                             │                                       │     │
│  │   ┌─────────────────────────▼─────────────────────────────────┐    │     │
│  │   │                    VAULT MANAGER                           │    │     │
│  │   │  - Open/Close vaults                                       │    │     │
│  │   │  - Deposit/Withdraw collateral                             │    │     │
│  │   │  - Mint/Burn zkUSD                                         │    │     │
│  │   │  - ICR calculation                                         │    │     │
│  │   └─────────────────────────┬─────────────────────────────────┘    │     │
│  │                             │                                       │     │
│  │   ┌─────────────┬───────────┼───────────┬─────────────┐            │     │
│  │   │             │           │           │             │            │     │
│  │   ▼             ▼           ▼           ▼             ▼            │     │
│  │ ┌───────┐  ┌─────────┐ ┌─────────┐ ┌─────────┐  ┌──────────┐      │     │
│  │ │zkUSD  │  │Stability│ │ Active  │ │ Default │  │  Price   │      │     │
│  │ │Token  │  │  Pool   │ │  Pool   │ │  Pool   │  │  Oracle  │      │     │
│  │ └───────┘  └─────────┘ └─────────┘ └─────────┘  └──────────┘      │     │
│  │                                                                    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                │                                             │
│  ┌─────────────────────────────┼──────────────────────────────────────┐     │
│  │                    BITCOIN LAYER                                    │     │
│  │                             │                                       │     │
│  │   ┌─────────────────────────▼─────────────────────────────────┐    │     │
│  │   │                   CHARMS PROTOCOL                          │    │     │
│  │   │  - Spell creation & verification                           │    │     │
│  │   │  - ZK proof generation (SP1 zkVM)                          │    │     │
│  │   │  - UTXO enchantment                                        │    │     │
│  │   └───────────────────────────────────────────────────────────┘    │     │
│  │                             │                                       │     │
│  │   ┌─────────────────────────▼─────────────────────────────────┐    │     │
│  │   │                   BITCOIN L1                               │    │     │
│  │   │  - Native UTXOs                                            │    │     │
│  │   │  - Taproot witness data                                    │    │     │
│  │   │  - Immutable settlement                                    │    │     │
│  │   └───────────────────────────────────────────────────────────┘    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Flujo de Datos

```
USER ACTION                    PROTOCOL RESPONSE
    │                               │
    ▼                               │
┌─────────────────┐                 │
│ 1. Deposit BTC  │                 │
│    (Collateral) │                 │
└────────┬────────┘                 │
         │                          │
         ▼                          ▼
┌─────────────────┐         ┌─────────────────┐
│ 2. Create Vault │ ──────► │ Validate via    │
│    Spell        │         │ ZK Proof        │
└────────┬────────┘         └────────┬────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│ 3. Mint zkUSD   │ ◄────── │ Check ICR ≥150% │
│    (if valid)   │         │ Oracle Price    │
└────────┬────────┘         └────────┬────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│ 4. Bitcoin TX   │ ──────► │ UTXO enchanted  │
│    Broadcast    │         │ with zkUSD      │
└─────────────────┘         └─────────────────┘
```

---

## 2. CHARMS APPS (SMART CONTRACTS)

### 2.1 zkUSD Token (Fungible Token)

```rust
// zkusd_token/src/lib.rs
use charms_sdk::*;

/// zkUSD Token - Stablecoin fungible
/// Tag: T (Fungible Token)
#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    // 1. Verificar balance conservation
    let inputs_sum: u64 = ctx.inputs.iter()
        .filter(|i| i.app_id == ZKUSD_APP_ID)
        .map(|i| i.amount)
        .sum();

    let outputs_sum: u64 = ctx.outputs.iter()
        .filter(|o| o.app_id == ZKUSD_APP_ID)
        .map(|o| o.amount)
        .sum();

    // 2. Solo VaultManager puede mint/burn
    let is_mint = outputs_sum > inputs_sum;
    let is_burn = outputs_sum < inputs_sum;

    if is_mint || is_burn {
        // Verificar que viene de VaultManager
        if !ctx.has_app_input(VAULT_MANAGER_APP_ID) {
            return false;
        }
    }

    // 3. Transfers normales: conservar balance
    if !is_mint && !is_burn && inputs_sum != outputs_sum {
        return false;
    }

    // 4. Verificar firmas
    ctx.verify_signatures()
}

/// Mint zkUSD (solo desde VaultManager)
pub fn mint(ctx: &SpellContext, amount: u64, recipient: &Address) -> bool {
    // Verificado por VaultManager
    true
}

/// Burn zkUSD (para repagar deuda)
pub fn burn(ctx: &SpellContext, amount: u64) -> bool {
    // Verificado por VaultManager
    true
}

/// Transfer zkUSD entre usuarios
pub fn transfer(ctx: &SpellContext, to: &Address, amount: u64) -> bool {
    ctx.verify_signatures()
}
```

### 2.2 Vault Manager (Core CDP Logic)

```rust
// vault_manager/src/lib.rs
use charms_sdk::*;

// Constantes del protocolo
const MCR: u64 = 110;  // Minimum Collateral Ratio (110%)
const CCR: u64 = 150;  // Critical Collateral Ratio (150%)
const LIQUIDATION_RESERVE: u64 = 200_000;  // 200 zkUSD gas compensation

/// Estado de un Vault individual
#[derive(CharmState)]
pub struct Vault {
    pub owner: Address,
    pub collateral: u64,      // satoshis
    pub debt: u64,            // zkUSD (8 decimals)
    pub created_at: u64,      // block height
    pub last_updated: u64,
}

/// Estado global del protocolo
#[derive(CharmState)]
pub struct ProtocolState {
    pub total_collateral: u64,
    pub total_debt: u64,
    pub vault_count: u64,
    pub base_rate: u64,       // Para redemption fee
}

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let action = ctx.get_action();

    match action {
        Action::OpenVault => validate_open_vault(ctx),
        Action::CloseVault => validate_close_vault(ctx),
        Action::AdjustVault => validate_adjust_vault(ctx),
        Action::Liquidate => validate_liquidation(ctx),
        Action::Redeem => validate_redemption(ctx),
        _ => false,
    }
}

/// Abrir nuevo vault
fn validate_open_vault(ctx: &SpellContext) -> bool {
    let collateral = ctx.get_param::<u64>("collateral");
    let debt = ctx.get_param::<u64>("debt");
    let owner = ctx.get_param::<Address>("owner");

    // 1. Obtener precio de oracle
    let btc_price = get_oracle_price(ctx);

    // 2. Calcular ICR
    let collateral_value = (collateral as u128 * btc_price as u128) / 100_000_000;
    let icr = (collateral_value * 100) / debt as u128;

    // 3. Verificar ICR >= MCR (o CCR en recovery mode)
    let min_ratio = if is_recovery_mode(ctx) { CCR } else { MCR };
    if icr < min_ratio as u128 {
        return false;
    }

    // 4. Deuda mínima (para gas compensation)
    if debt < LIQUIDATION_RESERVE {
        return false;
    }

    // 5. Verificar que collateral está siendo depositado
    if !ctx.has_btc_input(collateral) {
        return false;
    }

    // 6. Verificar firma del owner
    if !ctx.verify_signature(&owner) {
        return false;
    }

    true
}

/// Cerrar vault (repagar toda la deuda)
fn validate_close_vault(ctx: &SpellContext) -> bool {
    let vault_id = ctx.get_param::<[u8; 32]>("vault_id");
    let vault = get_vault(ctx, &vault_id);

    // 1. Verificar que owner está cerrando
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }

    // 2. Verificar que zkUSD de deuda está siendo quemado
    let zkusd_burned = ctx.get_burned_amount(ZKUSD_APP_ID);
    if zkusd_burned < vault.debt {
        return false;
    }

    // 3. Verificar que collateral va al owner
    if !ctx.has_btc_output(&vault.owner, vault.collateral) {
        return false;
    }

    true
}

/// Ajustar vault (añadir/retirar collateral, mint/repay debt)
fn validate_adjust_vault(ctx: &SpellContext) -> bool {
    let vault_id = ctx.get_param::<[u8; 32]>("vault_id");
    let vault = get_vault(ctx, &vault_id);

    let collateral_change = ctx.get_param::<i64>("collateral_change");
    let debt_change = ctx.get_param::<i64>("debt_change");

    // 1. Calcular nuevo estado
    let new_collateral = (vault.collateral as i64 + collateral_change) as u64;
    let new_debt = (vault.debt as i64 + debt_change) as u64;

    // 2. Verificar nuevo ICR
    let btc_price = get_oracle_price(ctx);
    let collateral_value = (new_collateral as u128 * btc_price as u128) / 100_000_000;
    let new_icr = (collateral_value * 100) / new_debt as u128;

    let min_ratio = if is_recovery_mode(ctx) { CCR } else { MCR };
    if new_icr < min_ratio as u128 {
        return false;
    }

    // 3. Verificar firma del owner
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }

    // 4. Si retira collateral, verificar output
    if collateral_change < 0 {
        let withdrawal = (-collateral_change) as u64;
        if !ctx.has_btc_output(&vault.owner, withdrawal) {
            return false;
        }
    }

    // 5. Si añade collateral, verificar input
    if collateral_change > 0 {
        if !ctx.has_btc_input(collateral_change as u64) {
            return false;
        }
    }

    true
}

/// Liquidación de vault sub-colateralizado
fn validate_liquidation(ctx: &SpellContext) -> bool {
    let vault_id = ctx.get_param::<[u8; 32]>("vault_id");
    let vault = get_vault(ctx, &vault_id);

    // 1. Verificar que vault está bajo MCR
    let btc_price = get_oracle_price(ctx);
    let collateral_value = (vault.collateral as u128 * btc_price as u128) / 100_000_000;
    let icr = (collateral_value * 100) / vault.debt as u128;

    if icr >= MCR as u128 {
        return false;  // No liquidable
    }

    // 2. Verificar Stability Pool tiene suficiente
    let sp_balance = get_stability_pool_balance(ctx);

    if sp_balance >= vault.debt {
        // Liquidación via Stability Pool
        validate_sp_liquidation(ctx, &vault)
    } else {
        // Redistribución a otros vaults
        validate_redistribution(ctx, &vault)
    }
}

/// Redemption: canjear zkUSD por BTC
fn validate_redemption(ctx: &SpellContext) -> bool {
    let zkusd_amount = ctx.get_param::<u64>("amount");
    let redeemer = ctx.get_param::<Address>("redeemer");

    // 1. Verificar que zkUSD está siendo quemado
    let zkusd_burned = ctx.get_burned_amount(ZKUSD_APP_ID);
    if zkusd_burned != zkusd_amount {
        return false;
    }

    // 2. Calcular BTC a recibir (menos fee)
    let btc_price = get_oracle_price(ctx);
    let base_rate = get_base_rate(ctx);
    let redemption_fee = calculate_redemption_fee(base_rate, zkusd_amount);

    let btc_to_receive = ((zkusd_amount - redemption_fee) as u128 * 100_000_000)
                         / btc_price as u128;

    // 3. Verificar que BTC va al redeemer
    if !ctx.has_btc_output(&redeemer, btc_to_receive as u64) {
        return false;
    }

    // 4. Afectar vaults con menor ICR primero (sorted list)
    // Esta lógica redistribuye el impacto

    true
}

// Helper functions
fn get_oracle_price(ctx: &SpellContext) -> u64 {
    ctx.get_oracle_value(ORACLE_APP_ID, "BTC/USD")
}

fn is_recovery_mode(ctx: &SpellContext) -> bool {
    let state = get_protocol_state(ctx);
    let btc_price = get_oracle_price(ctx);
    let tcr = calculate_tcr(&state, btc_price);
    tcr < CCR as u128
}

fn calculate_tcr(state: &ProtocolState, btc_price: u64) -> u128 {
    let total_value = (state.total_collateral as u128 * btc_price as u128) / 100_000_000;
    (total_value * 100) / state.total_debt as u128
}
```

### 2.3 Stability Pool

```rust
// stability_pool/src/lib.rs
use charms_sdk::*;

/// Depósito en Stability Pool
#[derive(CharmState)]
pub struct SPDeposit {
    pub owner: Address,
    pub amount: u64,           // zkUSD depositado
    pub snapshot_p: u128,      // Product snapshot
    pub snapshot_s: u128,      // Sum snapshot (para BTC gains)
}

/// Estado global del Stability Pool
#[derive(CharmState)]
pub struct StabilityPoolState {
    pub total_deposits: u64,
    pub product_p: u128,       // Running product para calcular shares
    pub sum_s: u128,           // Running sum para BTC distribution
    pub btc_balance: u64,      // BTC ganado de liquidaciones
}

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let action = ctx.get_action();

    match action {
        Action::Deposit => validate_deposit(ctx),
        Action::Withdraw => validate_withdraw(ctx),
        Action::ClaimBTC => validate_claim_btc(ctx),
        Action::Offset => validate_offset(ctx),  // Llamado por liquidaciones
        _ => false,
    }
}

/// Depositar zkUSD en Stability Pool
fn validate_deposit(ctx: &SpellContext) -> bool {
    let amount = ctx.get_param::<u64>("amount");
    let depositor = ctx.get_param::<Address>("depositor");

    // 1. Verificar que zkUSD está siendo transferido al pool
    let zkusd_received = ctx.get_app_input_amount(ZKUSD_APP_ID);
    if zkusd_received != amount {
        return false;
    }

    // 2. Verificar firma
    if !ctx.verify_signature(&depositor) {
        return false;
    }

    true
}

/// Retirar zkUSD (y BTC ganado)
fn validate_withdraw(ctx: &SpellContext) -> bool {
    let deposit_id = ctx.get_param::<[u8; 32]>("deposit_id");
    let deposit = get_deposit(ctx, &deposit_id);
    let amount = ctx.get_param::<u64>("amount");

    // 1. Verificar owner
    if !ctx.verify_signature(&deposit.owner) {
        return false;
    }

    // 2. Calcular zkUSD disponible (puede ser menos por liquidaciones)
    let available = calculate_compounded_deposit(&deposit, ctx);
    if amount > available {
        return false;
    }

    // 3. Calcular BTC ganado
    let btc_gain = calculate_btc_gain(&deposit, ctx);

    // 4. Verificar outputs
    if !ctx.has_app_output(ZKUSD_APP_ID, &deposit.owner, amount) {
        return false;
    }
    if btc_gain > 0 && !ctx.has_btc_output(&deposit.owner, btc_gain) {
        return false;
    }

    true
}

/// Offset: absorber deuda de liquidación
fn validate_offset(ctx: &SpellContext) -> bool {
    // Solo VaultManager puede llamar esto
    if !ctx.has_app_input(VAULT_MANAGER_APP_ID) {
        return false;
    }

    let debt_to_offset = ctx.get_param::<u64>("debt");
    let collateral_gain = ctx.get_param::<u64>("collateral");

    // Verificar que hay suficiente en el pool
    let state = get_pool_state(ctx);
    if state.total_deposits < debt_to_offset {
        return false;
    }

    // La deuda se "quema" y el collateral se distribuye
    true
}

// Helpers para calcular gains (modelo Liquity)
fn calculate_compounded_deposit(deposit: &SPDeposit, ctx: &SpellContext) -> u64 {
    let state = get_pool_state(ctx);
    let scale_factor = state.product_p / deposit.snapshot_p;
    (deposit.amount as u128 * scale_factor / 1e18 as u128) as u64
}

fn calculate_btc_gain(deposit: &SPDeposit, ctx: &SpellContext) -> u64 {
    let state = get_pool_state(ctx);
    let sum_diff = state.sum_s - deposit.snapshot_s;
    (deposit.amount as u128 * sum_diff / 1e18 as u128) as u64
}
```

### 2.4 Price Oracle

```rust
// price_oracle/src/lib.rs
use charms_sdk::*;

/// Price feed con múltiples fuentes
#[derive(CharmState)]
pub struct PriceFeed {
    pub primary_price: u64,    // Precio principal
    pub backup_price: u64,     // Precio backup
    pub last_update: u64,      // Block height
    pub is_broken: bool,       // Flag de circuito
}

const PRICE_DEVIATION_THRESHOLD: u64 = 5;  // 5% max deviation
const MAX_PRICE_AGE: u64 = 10;             // 10 blocks

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let action = ctx.get_action();

    match action {
        Action::UpdatePrice => validate_price_update(ctx),
        Action::GetPrice => validate_price_read(ctx),
        _ => false,
    }
}

/// Actualizar precio (llamado por oracles)
fn validate_price_update(ctx: &SpellContext) -> bool {
    let new_price = ctx.get_param::<u64>("price");
    let oracle_sig = ctx.get_param::<Signature>("oracle_signature");

    // 1. Verificar firma de oracle autorizado
    if !verify_oracle_signature(&oracle_sig, new_price) {
        return false;
    }

    // 2. Verificar desviación razonable
    let current = get_current_price(ctx);
    let deviation = calculate_deviation(current, new_price);

    if deviation > PRICE_DEVIATION_THRESHOLD {
        // Activar circuit breaker
        return false;
    }

    true
}

/// Leer precio (usado por otros contratos)
fn validate_price_read(ctx: &SpellContext) -> bool {
    let feed = get_price_feed(ctx);
    let current_block = ctx.block_height();

    // 1. Verificar precio no es muy viejo
    if current_block - feed.last_update > MAX_PRICE_AGE {
        // Usar precio de backup o fallar
        if feed.is_broken {
            return false;
        }
    }

    true
}

fn calculate_deviation(a: u64, b: u64) -> u64 {
    let diff = if a > b { a - b } else { b - a };
    (diff * 100) / a
}
```

---

## 3. POOLS DEL SISTEMA

### 3.1 Arquitectura de Pools

```
┌─────────────────────────────────────────────────────────────────┐
│                      POOLS ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    ACTIVE POOL                           │   │
│   │  - Almacena collateral de vaults activos                 │   │
│   │  - Recibe BTC cuando se abren vaults                     │   │
│   │  - Envía BTC cuando se cierran vaults                    │   │
│   │  - Envía a StabilityPool en liquidaciones                │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   STABILITY POOL                         │   │
│   │  - Recibe depósitos de zkUSD de usuarios                 │   │
│   │  - Absorbe deuda en liquidaciones                        │   │
│   │  - Distribuye BTC ganado a depositantes                  │   │
│   │  - Primera línea de defensa del sistema                  │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    DEFAULT POOL                          │   │
│   │  - Almacena collateral de redistribuciones               │   │
│   │  - Cuando SP está vacío, deuda se redistribuye           │   │
│   │  - Vaults activos absorben deuda/collateral              │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  SURPLUS POOL                            │   │
│   │  - Almacena excedentes de redemptions                    │   │
│   │  - Usuarios pueden reclamar su surplus                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Flujo de Liquidación

```
VAULT ICR < 110%
      │
      ▼
┌─────────────────┐
│ Liquidation     │
│ Triggered       │
└────────┬────────┘
         │
         ▼
    ┌────────────────────────────────────┐
    │  Stability Pool tiene suficiente?  │
    └──────────────┬─────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
         ▼ YES               ▼ NO
┌─────────────────┐   ┌─────────────────┐
│ SP Offset       │   │ Redistribution  │
│                 │   │                 │
│ - Debt burned   │   │ - Debt split    │
│   from SP       │   │   to all vaults │
│ - Collateral    │   │ - Collateral    │
│   to SP stakers │   │   split too     │
└─────────────────┘   └─────────────────┘
         │                   │
         └─────────┬─────────┘
                   │
                   ▼
         ┌─────────────────┐
         │ Liquidator gets │
         │ gas compensation│
         │ (200 zkUSD +    │
         │ 0.5% collateral)│
         └─────────────────┘
```

---

## 4. MODELO DE FEES (0% INTEREST)

### 4.1 Estructura de Fees

A diferencia de Mezo (tasas fijas), zkUSD usa el modelo Liquity:

| Fee | Valor | Cuando | Destino |
|-----|-------|--------|---------|
| **Borrowing Fee** | 0.5% - 5% | Al mint zkUSD | Protocol Treasury |
| **Redemption Fee** | 0.5% - 5% | Al redimir por BTC | Protocol Treasury |
| **Interest Rate** | **0%** | Nunca | N/A |

### 4.2 Fee Dinámico (baseRate)

```
baseRate aumenta con:
  - Cada redemption (+0.5% del monto redimido / deuda total)

baseRate disminuye:
  - Con el tiempo (decay hacia 0%)
  - Formula: baseRate * e^(-time/halfLife)

Borrowing Fee = max(0.5%, baseRate)
Redemption Fee = max(0.5%, baseRate)
```

### 4.3 Ventaja Competitiva

```
COMPARACIÓN DE COSTOS (préstamo de 10,000 zkUSD por 1 año):

Mezo mUSD (1% interest):
  - Borrowing fee: 1% = $100
  - Interest 1 año: 1% = $100
  - TOTAL: $200

zkUSD (0% interest):
  - Borrowing fee: 0.5% = $50
  - Interest 1 año: 0% = $0
  - TOTAL: $50

AHORRO: 75% menos costos
```

---

## 5. RECOVERY MODE

### 5.1 Activación

```
TCR (Total Collateral Ratio) < 150% (CCR)
           │
           ▼
┌─────────────────────────────┐
│    RECOVERY MODE ACTIVO     │
├─────────────────────────────┤
│ - MCR sube de 110% a 150%   │
│ - Liquidaciones más amplias │
│ - Nuevos mints restringidos │
│ - Protege solvencia sistema │
└─────────────────────────────┘
```

### 5.2 Reglas en Recovery Mode

| Acción | Normal Mode | Recovery Mode |
|--------|-------------|---------------|
| Open vault | ICR ≥ 110% | ICR ≥ 150% |
| Adjust (más deuda) | ICR ≥ 110% | ICR ≥ 150% |
| Adjust (menos deuda) | Siempre OK | Siempre OK |
| Liquidation | ICR < 110% | ICR < 150% |

---

## 6. CROSS-CHAIN VIA BEAMING

### 6.1 Proceso de Beaming

```
BITCOIN L1                              CARDANO
     │                                      │
     │  1. Usuario tiene zkUSD              │
     │     en Bitcoin                       │
     │                                      │
     │  2. Crear Spell de "beam"            │
     │     - Lock zkUSD en Bitcoin          │
     │     - Generar ZK proof               │
     │                                      │
     │  3. Proof incluye:                   │
     │     - Merkle path del UTXO           │
     │     - Validación del lock            │
     │     - Destino en Cardano             │
     │                                      │
     ├──────────── ZK Proof ────────────────►
     │                                      │
     │                               4. Cardano verifica:
     │                                  - Proof es válido
     │                                  - Bitcoin headers
     │                                  - PoW suficiente
     │                                      │
     │                               5. Mint zkUSD en
     │                                  Cardano (nativo)
     │                                      │
```

### 6.2 Chains Soportadas

| Chain | Estado | Mecanismo |
|-------|--------|-----------|
| Bitcoin | Base | Nativo |
| Cardano | Activo | Beaming nativo |
| Ethereum | Via Grail | Bridge zkBTC |
| Litecoin | Futuro | LitVM |

---

## 7. COMPONENTES REUTILIZABLES

### 7.1 Extracción para Charms Standard Library

Estos componentes serán extraídos como librería reutilizable:

```
charms-stdlib/
├── tokens/
│   ├── fungible.rs       # Base para tokens fungibles
│   ├── nft.rs            # Base para NFTs
│   └── multi.rs          # Multi-tokens
│
├── cdp/
│   ├── vault.rs          # CDP vault base
│   ├── liquidation.rs    # Engine de liquidación
│   └── redemption.rs     # Mecanismo redemption
│
├── pools/
│   ├── stability.rs      # Stability pool
│   ├── active.rs         # Active pool
│   └── surplus.rs        # Surplus pool
│
├── oracles/
│   ├── price_feed.rs     # Oracle base
│   ├── aggregator.rs     # Multi-source aggregator
│   └── circuit_breaker.rs
│
├── math/
│   ├── fixed_point.rs    # Matemáticas precisas
│   ├── exponential.rs    # Decay functions
│   └── percentage.rs     # Cálculos de ratios
│
└── security/
    ├── access_control.rs # Permisos
    ├── reentrancy.rs     # Guards
    └── pausable.rs       # Emergency stops
```

### 7.2 Uso de la Librería

```rust
// Ejemplo: crear nuevo CDP protocol
use charms_stdlib::{cdp::Vault, tokens::Fungible, oracles::PriceFeed};

#[charms_spell]
pub fn my_cdp_protocol(ctx: &SpellContext) -> bool {
    // Usar componentes pre-auditados
    let vault = Vault::new(ctx)
        .with_mcr(120)  // 120% MCR
        .with_ccr(160); // 160% CCR

    let token = Fungible::new("myUSD")
        .with_decimals(8);

    let oracle = PriceFeed::new()
        .with_source(CHAINLINK_APP_ID)
        .with_fallback(BAND_APP_ID);

    // Lógica custom sobre base sólida
    vault.validate_open(ctx, &token, &oracle)
}
```

---

## 8. STACK TÉCNICO COMPLETO

### 8.1 Backend

```
┌─────────────────────────────────────────────────────────────┐
│                      BACKEND STACK                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  CHARMS APPS (Rust → WASM)                                  │
│  ├── zkusd_token/                                           │
│  ├── vault_manager/                                         │
│  ├── stability_pool/                                        │
│  └── price_oracle/                                          │
│                                                              │
│  INDEXER (Node.js/TypeScript)                               │
│  ├── Watch Bitcoin mempool/blocks                           │
│  ├── Parse Charms spells                                    │
│  ├── Index vault states                                     │
│  └── Store in PostgreSQL                                    │
│                                                              │
│  API SERVER (Node.js/TypeScript)                            │
│  ├── Express/Fastify REST API                               │
│  ├── GraphQL endpoint                                       │
│  ├── WebSocket for real-time                                │
│  └── Rate limiting, auth                                    │
│                                                              │
│  DATABASE                                                    │
│  ├── PostgreSQL (vault states, history)                     │
│  ├── Redis (caching, sessions)                              │
│  └── TimescaleDB (time-series prices)                       │
│                                                              │
│  KEEPERS (Background Jobs)                                  │
│  ├── Liquidation bot                                        │
│  ├── Oracle price updater                                   │
│  └── Redemption queue processor                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Frontend

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND STACK                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  FRAMEWORK: Next.js 14 (App Router)                         │
│                                                              │
│  UI COMPONENTS                                               │
│  ├── TailwindCSS + shadcn/ui                                │
│  ├── Recharts (gráficas)                                    │
│  └── Framer Motion (animaciones)                            │
│                                                              │
│  STATE MANAGEMENT                                            │
│  ├── Zustand (global state)                                 │
│  ├── TanStack Query (server state)                          │
│  └── React Hook Form (formularios)                          │
│                                                              │
│  WALLET INTEGRATION                                          │
│  ├── @unisat/wallet-sdk (Bitcoin)                           │
│  ├── @cardano-sdk (Cardano)                                 │
│  └── wagmi/viem (EVM fallback)                              │
│                                                              │
│  PAGES                                                       │
│  ├── /dashboard     - Overview general                      │
│  ├── /vault         - Gestión de vault                      │
│  ├── /stability     - Stability Pool                        │
│  ├── /redeem        - Redemptions                           │
│  └── /analytics     - Estadísticas                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 Infraestructura

```
┌─────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  DEVELOPMENT                                                 │
│  ├── Docker Compose (local dev)                             │
│  ├── Bitcoin Regtest/Testnet                                │
│  └── Mock oracles                                           │
│                                                              │
│  CI/CD                                                       │
│  ├── GitHub Actions                                         │
│  ├── Automated testing                                      │
│  └── Vercel (frontend)                                      │
│                                                              │
│  PRODUCTION                                                  │
│  ├── Railway/Render (backend)                               │
│  ├── Supabase (database)                                    │
│  ├── Upstash (Redis)                                        │
│  └── Bitcoin mainnet node (QuickNode/self-hosted)           │
│                                                              │
│  MONITORING                                                  │
│  ├── Sentry (errors)                                        │
│  ├── Grafana (metrics)                                      │
│  └── PagerDuty (alerts)                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. MVP PARA HACKATHON

### 9.1 Scope del MVP (4 semanas)

```
SEMANA 1: Core Contracts
├── zkUSD Token charm
├── Vault Manager (open/close básico)
└── Tests unitarios

SEMANA 2: Features Críticos
├── Stability Pool básico
├── Liquidation engine
├── Mock oracle
└── Integration tests

SEMANA 3: Frontend
├── Dashboard UI
├── Wallet connection
├── Vault management UI
├── Stability Pool UI
└── Testnet deployment

SEMANA 4: Polish & Demo
├── Bug fixes
├── UX improvements
├── Demo video
├── Documentation
└── Submission
```

### 9.2 Features MVP vs Full

| Feature | MVP | Full Version |
|---------|-----|--------------|
| Open/Close vault | ✅ | ✅ |
| Mint/Burn zkUSD | ✅ | ✅ |
| Stability Pool deposit | ✅ | ✅ |
| Basic liquidation | ✅ | ✅ |
| Mock oracle | ✅ | Real oracle |
| Recovery Mode | ❌ | ✅ |
| Redemptions | ❌ | ✅ |
| Cross-chain beaming | ❌ | ✅ |
| Sorted troves | ❌ | ✅ |
| Hints system | ❌ | ✅ |
| Fee decay | ❌ | ✅ |

### 9.3 UI Mockups

```
┌─────────────────────────────────────────────────────────────┐
│  zkUSD                               [Connect Wallet]       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           YOUR VAULT                                 │    │
│  │  ┌─────────────────┐  ┌─────────────────┐           │    │
│  │  │ Collateral      │  │ Debt            │           │    │
│  │  │ 1.5 BTC         │  │ 45,000 zkUSD    │           │    │
│  │  │ ($150,000)      │  │                 │           │    │
│  │  └─────────────────┘  └─────────────────┘           │    │
│  │                                                      │    │
│  │  Collateral Ratio: 333%  [████████████░░] SAFE      │    │
│  │                                                      │    │
│  │  [+ Add Collateral]  [- Withdraw]  [Mint zkUSD]     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           STABILITY POOL                             │    │
│  │                                                      │    │
│  │  Your Deposit: 5,000 zkUSD                          │    │
│  │  BTC Gains: 0.02 BTC ($2,000)                       │    │
│  │  APY: ~15% (variable)                               │    │
│  │                                                      │    │
│  │  [Deposit zkUSD]  [Withdraw]  [Claim BTC]           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           SYSTEM STATS                               │    │
│  │                                                      │    │
│  │  Total Collateral: 500 BTC ($50,000,000)            │    │
│  │  Total zkUSD: 25,000,000                            │    │
│  │  TCR: 200%                                          │    │
│  │  zkUSD Price: $0.998                                │    │
│  │  Mode: NORMAL                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. PLAN DE CONTRIBUCIÓN OPEN SOURCE

### 10.1 Fases de Open Source

```
FASE 1: Hackathon (Semana 1-4)
├── Código funcional
├── Repositorio público
├── Licencia MIT/Apache 2.0
└── README básico

FASE 2: Documentación (Mes 2)
├── Documentación completa
├── Tutoriales
├── Ejemplos de uso
└── API reference

FASE 3: Extracción CSL (Mes 3-4)
├── Separar componentes reutilizables
├── charms-stdlib package
├── Tests exhaustivos
└── Auditoría inicial

FASE 4: Ecosistema (Mes 5-12)
├── TypeScript SDK
├── Más ejemplos
├── Integraciones
└── Comunidad
```

### 10.2 Estructura del Repositorio

```
zkUSD/
├── README.md
├── LICENSE (MIT)
├── CONTRIBUTING.md
├── SECURITY.md
│
├── contracts/              # Charms apps
│   ├── zkusd-token/
│   ├── vault-manager/
│   ├── stability-pool/
│   └── price-oracle/
│
├── packages/
│   ├── sdk/               # TypeScript SDK
│   ├── indexer/           # Event indexer
│   └── api/               # REST API
│
├── apps/
│   └── web/               # Next.js frontend
│
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   └── api-reference.md
│
├── scripts/
│   ├── deploy.sh
│   └── test.sh
│
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## SIGUIENTE PASO

1. ✅ Arquitectura definida
2. → Crear estructura de proyecto
3. → Implementar zkUSD Token charm
4. → Implementar Vault Manager
5. → Crear frontend básico
6. → Testnet deployment
