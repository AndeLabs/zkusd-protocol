# PLAN DE IMPLEMENTACION zkUSD - BOS HACKATHON 2025

## RESUMEN

Este documento contiene el plan detallado paso a paso para implementar zkUSD en 4 semanas para el BOS Hackathon.

**Objetivo**: Crear un MVP funcional de stablecoin CDP nativo en Bitcoin usando Charms Protocol.

---

## SEMANA 1: CORE CONTRACTS (Dias 1-7)

### Dia 1-2: Setup del Proyecto

#### Tareas

1. **Instalar dependencias**
```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable

# Charms CLI
cargo install charms-cli

# Verificar
charms --version  # Debe ser 0.10.0+
```

2. **Crear estructura del proyecto**
```bash
mkdir -p zkUSD/{contracts,packages,apps,docs,tests,scripts}
cd zkUSD

# Inicializar git
git init
echo "# zkUSD - Bitcoin Native Stablecoin" > README.md

# Crear contratos base
charms app new contracts/zkusd-token
charms app new contracts/vault-manager
charms app new contracts/stability-pool
charms app new contracts/price-oracle
```

3. **Configurar workspace Rust**
```toml
# zkUSD/Cargo.toml
[workspace]
members = [
    "contracts/zkusd-token",
    "contracts/vault-manager",
    "contracts/stability-pool",
    "contracts/price-oracle",
]

[workspace.dependencies]
charms-sdk = "0.10"
```

4. **Crear .gitignore**
```
target/
node_modules/
.env
*.wasm
.DS_Store
```

#### Entregables Dia 1-2
- [ ] Proyecto creado en GitHub
- [ ] Estructura de carpetas lista
- [ ] Charms CLI funcionando
- [ ] README inicial

---

### Dia 3-4: zkUSD Token Contract

#### Archivo: contracts/zkusd-token/src/lib.rs

```rust
//! zkUSD Token - Stablecoin fungible nativo en Bitcoin
//!
//! Este charm implementa un token fungible con las siguientes propiedades:
//! - Solo VaultManager puede mint/burn
//! - Transfers libres entre usuarios
//! - 8 decimales (como satoshis)

use charms_sdk::prelude::*;

/// ID de la app VaultManager (se configura en deploy)
const VAULT_MANAGER_ID: &str = env!("VAULT_MANAGER_APP_ID");

/// Metadatos del token
pub const TOKEN_NAME: &str = "zkUSD";
pub const TOKEN_SYMBOL: &str = "zkUSD";
pub const DECIMALS: u8 = 8;

/// Acciones soportadas por el token
#[derive(Debug, Clone)]
pub enum TokenAction {
    Transfer { to: Address, amount: u64 },
    Mint { to: Address, amount: u64 },
    Burn { amount: u64 },
}

/// Validacion principal del spell
#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    // Parsear accion del spell
    let action = match parse_action(ctx) {
        Some(a) => a,
        None => return false,
    };

    match action {
        TokenAction::Transfer { to, amount } => validate_transfer(ctx, &to, amount),
        TokenAction::Mint { to, amount } => validate_mint(ctx, &to, amount),
        TokenAction::Burn { amount } => validate_burn(ctx, amount),
    }
}

/// Validar transferencia entre usuarios
fn validate_transfer(ctx: &SpellContext, to: &Address, amount: u64) -> bool {
    // 1. Verificar que sender tiene suficiente balance
    let sender = ctx.get_signer();
    let sender_balance = ctx.get_app_balance(&sender, ZKUSD_APP_ID);

    if sender_balance < amount {
        return false;
    }

    // 2. Verificar conservacion de balance
    let total_inputs: u64 = ctx.get_total_app_inputs(ZKUSD_APP_ID);
    let total_outputs: u64 = ctx.get_total_app_outputs(ZKUSD_APP_ID);

    if total_inputs != total_outputs {
        return false;
    }

    // 3. Verificar que output va al destinatario correcto
    if !ctx.has_app_output(ZKUSD_APP_ID, to, amount) {
        return false;
    }

    // 4. Verificar firma del sender
    ctx.verify_signature(&sender)
}

/// Validar mint (solo desde VaultManager)
fn validate_mint(ctx: &SpellContext, to: &Address, amount: u64) -> bool {
    // 1. CRITICO: Solo VaultManager puede mintear
    if !ctx.has_app_caller(VAULT_MANAGER_ID) {
        return false;
    }

    // 2. Verificar que se crea el output correcto
    if !ctx.has_app_output(ZKUSD_APP_ID, to, amount) {
        return false;
    }

    // 3. Outputs deben ser mayores que inputs (creando tokens)
    let total_inputs: u64 = ctx.get_total_app_inputs(ZKUSD_APP_ID);
    let total_outputs: u64 = ctx.get_total_app_outputs(ZKUSD_APP_ID);

    total_outputs == total_inputs + amount
}

/// Validar burn (repagar deuda)
fn validate_burn(ctx: &SpellContext, amount: u64) -> bool {
    // 1. Solo VaultManager puede quemar
    if !ctx.has_app_caller(VAULT_MANAGER_ID) {
        return false;
    }

    // 2. Inputs deben ser mayores que outputs (destruyendo tokens)
    let total_inputs: u64 = ctx.get_total_app_inputs(ZKUSD_APP_ID);
    let total_outputs: u64 = ctx.get_total_app_outputs(ZKUSD_APP_ID);

    total_inputs == total_outputs + amount
}

/// Parser de acciones desde parametros del spell
fn parse_action(ctx: &SpellContext) -> Option<TokenAction> {
    let action_type = ctx.get_param::<String>("action")?;

    match action_type.as_str() {
        "transfer" => {
            let to = ctx.get_param::<Address>("to")?;
            let amount = ctx.get_param::<u64>("amount")?;
            Some(TokenAction::Transfer { to, amount })
        }
        "mint" => {
            let to = ctx.get_param::<Address>("to")?;
            let amount = ctx.get_param::<u64>("amount")?;
            Some(TokenAction::Mint { to, amount })
        }
        "burn" => {
            let amount = ctx.get_param::<u64>("amount")?;
            Some(TokenAction::Burn { amount })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transfer_conserves_balance() {
        // TODO: Implementar test
    }

    #[test]
    fn test_only_vault_manager_can_mint() {
        // TODO: Implementar test
    }

    #[test]
    fn test_only_vault_manager_can_burn() {
        // TODO: Implementar test
    }
}
```

#### Entregables Dia 3-4
- [ ] zkUSD Token contract implementado
- [ ] Tests unitarios pasando
- [ ] Contract compila a WASM

---

### Dia 5-7: Vault Manager Contract

#### Archivo: contracts/vault-manager/src/lib.rs

```rust
//! Vault Manager - Core CDP logic para zkUSD
//!
//! Gestiona:
//! - Apertura/cierre de vaults
//! - Deposito/retiro de collateral
//! - Mint/burn de zkUSD
//! - Calculo de ratios de colateralizacion

use charms_sdk::prelude::*;

// ============ CONSTANTES DEL PROTOCOLO ============

/// Minimum Collateral Ratio (110%)
pub const MCR: u64 = 110;

/// Critical Collateral Ratio (150%) - activa Recovery Mode
pub const CCR: u64 = 150;

/// Reserva de liquidacion (200 zkUSD)
pub const LIQUIDATION_RESERVE: u64 = 200_00000000; // 8 decimales

/// Borrowing fee minimo (0.5%)
pub const MIN_BORROWING_FEE: u64 = 50; // basis points

/// Deuda minima para abrir vault
pub const MIN_DEBT: u64 = 2000_00000000; // 2000 zkUSD

// ============ ESTRUCTURAS DE DATOS ============

/// Estado de un vault individual
#[derive(Debug, Clone, CharmState)]
pub struct Vault {
    /// Dueno del vault
    pub owner: Address,
    /// Collateral depositado (satoshis)
    pub collateral: u64,
    /// Deuda total (zkUSD con 8 decimales)
    pub debt: u64,
    /// Block height de creacion
    pub created_at: u64,
    /// Estado activo/cerrado
    pub is_active: bool,
}

/// Estado global del protocolo
#[derive(Debug, Clone, CharmState)]
pub struct ProtocolState {
    /// Collateral total en el sistema (satoshis)
    pub total_collateral: u64,
    /// Deuda total (zkUSD)
    pub total_debt: u64,
    /// Numero de vaults activos
    pub active_vaults: u64,
    /// Base rate para fees
    pub base_rate: u64,
    /// Ultimo block de actualizacion
    pub last_update: u64,
}

/// Acciones del Vault Manager
#[derive(Debug, Clone)]
pub enum VaultAction {
    OpenVault { collateral: u64, debt: u64 },
    CloseVault { vault_id: [u8; 32] },
    AddCollateral { vault_id: [u8; 32], amount: u64 },
    WithdrawCollateral { vault_id: [u8; 32], amount: u64 },
    MintDebt { vault_id: [u8; 32], amount: u64 },
    RepayDebt { vault_id: [u8; 32], amount: u64 },
}

// ============ VALIDACION PRINCIPAL ============

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let action = match parse_action(ctx) {
        Some(a) => a,
        None => return false,
    };

    match action {
        VaultAction::OpenVault { collateral, debt } => {
            validate_open_vault(ctx, collateral, debt)
        }
        VaultAction::CloseVault { vault_id } => {
            validate_close_vault(ctx, &vault_id)
        }
        VaultAction::AddCollateral { vault_id, amount } => {
            validate_add_collateral(ctx, &vault_id, amount)
        }
        VaultAction::WithdrawCollateral { vault_id, amount } => {
            validate_withdraw_collateral(ctx, &vault_id, amount)
        }
        VaultAction::MintDebt { vault_id, amount } => {
            validate_mint_debt(ctx, &vault_id, amount)
        }
        VaultAction::RepayDebt { vault_id, amount } => {
            validate_repay_debt(ctx, &vault_id, amount)
        }
    }
}

// ============ VALIDACIONES DE ACCIONES ============

/// Abrir nuevo vault
fn validate_open_vault(ctx: &SpellContext, collateral: u64, debt: u64) -> bool {
    let owner = ctx.get_signer();

    // 1. Verificar deuda minima
    if debt < MIN_DEBT {
        return false;
    }

    // 2. Obtener precio BTC
    let btc_price = get_btc_price(ctx);

    // 3. Calcular ICR
    let icr = calculate_icr(collateral, debt, btc_price);

    // 4. Verificar ICR minimo
    let min_ratio = get_min_ratio(ctx);
    if icr < min_ratio {
        return false;
    }

    // 5. Verificar que collateral BTC está siendo depositado
    if !ctx.has_btc_input_from(&owner, collateral) {
        return false;
    }

    // 6. Verificar que collateral va al ActivePool
    if !ctx.has_btc_output_to(ACTIVE_POOL_ADDRESS, collateral) {
        return false;
    }

    // 7. Calcular borrowing fee
    let borrowing_fee = calculate_borrowing_fee(ctx, debt);
    let net_debt = debt + borrowing_fee + LIQUIDATION_RESERVE;

    // 8. Verificar que se mintea zkUSD correcto
    if !ctx.will_mint_zkusd(&owner, debt) {
        return false;
    }

    // 9. Verificar firma del owner
    ctx.verify_signature(&owner)
}

/// Cerrar vault (repagar toda la deuda)
fn validate_close_vault(ctx: &SpellContext, vault_id: &[u8; 32]) -> bool {
    let vault = match get_vault(ctx, vault_id) {
        Some(v) => v,
        None => return false,
    };

    // 1. Solo owner puede cerrar
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }

    // 2. No cerrar en Recovery Mode si seria el ultimo vault
    if is_recovery_mode(ctx) && get_active_vault_count(ctx) == 1 {
        return false;
    }

    // 3. Verificar que toda la deuda esta siendo quemada
    if !ctx.will_burn_zkusd(vault.debt) {
        return false;
    }

    // 4. Verificar que collateral va al owner
    if !ctx.has_btc_output_to(&vault.owner, vault.collateral) {
        return false;
    }

    true
}

/// Anadir collateral a vault existente
fn validate_add_collateral(ctx: &SpellContext, vault_id: &[u8; 32], amount: u64) -> bool {
    let vault = match get_vault(ctx, vault_id) {
        Some(v) => v,
        None => return false,
    };

    // 1. Solo owner puede agregar (o cualquiera? - decision de diseño)
    // Por seguridad, solo owner
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }

    // 2. Verificar BTC input
    if !ctx.has_btc_input_from(&vault.owner, amount) {
        return false;
    }

    // 3. Verificar BTC va a ActivePool
    if !ctx.has_btc_output_to(ACTIVE_POOL_ADDRESS, amount) {
        return false;
    }

    true
}

/// Retirar collateral de vault
fn validate_withdraw_collateral(ctx: &SpellContext, vault_id: &[u8; 32], amount: u64) -> bool {
    let vault = match get_vault(ctx, vault_id) {
        Some(v) => v,
        None => return false,
    };

    // 1. Solo owner puede retirar
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }

    // 2. Verificar que no retira mas de lo que tiene
    if amount > vault.collateral {
        return false;
    }

    // 3. Calcular nuevo ICR
    let new_collateral = vault.collateral - amount;
    let btc_price = get_btc_price(ctx);
    let new_icr = calculate_icr(new_collateral, vault.debt, btc_price);

    // 4. Verificar nuevo ICR >= minimo
    let min_ratio = get_min_ratio(ctx);
    if new_icr < min_ratio {
        return false;
    }

    // 5. Verificar output al owner
    if !ctx.has_btc_output_to(&vault.owner, amount) {
        return false;
    }

    true
}

/// Mintear mas zkUSD
fn validate_mint_debt(ctx: &SpellContext, vault_id: &[u8; 32], amount: u64) -> bool {
    let vault = match get_vault(ctx, vault_id) {
        Some(v) => v,
        None => return false,
    };

    // 1. Solo owner puede mintear
    if !ctx.verify_signature(&vault.owner) {
        return false;
    }

    // 2. Calcular nuevo ICR
    let new_debt = vault.debt + amount;
    let btc_price = get_btc_price(ctx);
    let new_icr = calculate_icr(vault.collateral, new_debt, btc_price);

    // 3. Verificar nuevo ICR >= minimo
    let min_ratio = get_min_ratio(ctx);
    if new_icr < min_ratio {
        return false;
    }

    // 4. Verificar mint de zkUSD
    if !ctx.will_mint_zkusd(&vault.owner, amount) {
        return false;
    }

    true
}

/// Repagar deuda
fn validate_repay_debt(ctx: &SpellContext, vault_id: &[u8; 32], amount: u64) -> bool {
    let vault = match get_vault(ctx, vault_id) {
        Some(v) => v,
        None => return false,
    };

    // 1. Cualquiera puede repagar deuda de un vault
    // (permite que terceros ayuden)

    // 2. No repagar mas de lo adeudado
    if amount > vault.debt - LIQUIDATION_RESERVE {
        return false;
    }

    // 3. Verificar burn de zkUSD
    if !ctx.will_burn_zkusd(amount) {
        return false;
    }

    true
}

// ============ FUNCIONES HELPER ============

/// Calcular Individual Collateral Ratio
/// ICR = (collateral_value_usd * 100) / debt
fn calculate_icr(collateral_sats: u64, debt: u64, btc_price: u64) -> u64 {
    if debt == 0 {
        return u64::MAX;
    }

    // collateral_value = collateral_sats * btc_price / 1e8
    let collateral_value = (collateral_sats as u128 * btc_price as u128) / 100_000_000;

    // ICR = collateral_value * 100 / debt
    ((collateral_value * 100) / debt as u128) as u64
}

/// Obtener ratio minimo (MCR normal, CCR en recovery)
fn get_min_ratio(ctx: &SpellContext) -> u64 {
    if is_recovery_mode(ctx) {
        CCR
    } else {
        MCR
    }
}

/// Verificar si estamos en Recovery Mode
fn is_recovery_mode(ctx: &SpellContext) -> bool {
    let state = get_protocol_state(ctx);
    let btc_price = get_btc_price(ctx);
    let tcr = calculate_icr(state.total_collateral, state.total_debt, btc_price);
    tcr < CCR
}

/// Calcular borrowing fee
fn calculate_borrowing_fee(ctx: &SpellContext, debt: u64) -> u64 {
    let state = get_protocol_state(ctx);
    let fee_rate = std::cmp::max(MIN_BORROWING_FEE, state.base_rate);
    (debt as u128 * fee_rate as u128 / 10000) as u64
}

/// Obtener precio BTC del oracle
fn get_btc_price(ctx: &SpellContext) -> u64 {
    // En MVP, precio hardcodeado o mock
    // En produccion, leer de oracle charm
    ctx.get_oracle_price(ORACLE_APP_ID, "BTC/USD")
        .unwrap_or(100000_00000000) // $100,000 default
}

/// Obtener vault por ID
fn get_vault(ctx: &SpellContext, vault_id: &[u8; 32]) -> Option<Vault> {
    ctx.get_state::<Vault>(vault_id)
}

/// Obtener estado global
fn get_protocol_state(ctx: &SpellContext) -> ProtocolState {
    ctx.get_state::<ProtocolState>(&PROTOCOL_STATE_KEY)
        .unwrap_or_default()
}

/// Numero de vaults activos
fn get_active_vault_count(ctx: &SpellContext) -> u64 {
    get_protocol_state(ctx).active_vaults
}

/// Parser de acciones
fn parse_action(ctx: &SpellContext) -> Option<VaultAction> {
    let action_type = ctx.get_param::<String>("action")?;

    match action_type.as_str() {
        "open" => {
            let collateral = ctx.get_param::<u64>("collateral")?;
            let debt = ctx.get_param::<u64>("debt")?;
            Some(VaultAction::OpenVault { collateral, debt })
        }
        "close" => {
            let vault_id = ctx.get_param::<[u8; 32]>("vault_id")?;
            Some(VaultAction::CloseVault { vault_id })
        }
        "add_collateral" => {
            let vault_id = ctx.get_param::<[u8; 32]>("vault_id")?;
            let amount = ctx.get_param::<u64>("amount")?;
            Some(VaultAction::AddCollateral { vault_id, amount })
        }
        "withdraw_collateral" => {
            let vault_id = ctx.get_param::<[u8; 32]>("vault_id")?;
            let amount = ctx.get_param::<u64>("amount")?;
            Some(VaultAction::WithdrawCollateral { vault_id, amount })
        }
        "mint_debt" => {
            let vault_id = ctx.get_param::<[u8; 32]>("vault_id")?;
            let amount = ctx.get_param::<u64>("amount")?;
            Some(VaultAction::MintDebt { vault_id, amount })
        }
        "repay_debt" => {
            let vault_id = ctx.get_param::<[u8; 32]>("vault_id")?;
            let amount = ctx.get_param::<u64>("amount")?;
            Some(VaultAction::RepayDebt { vault_id, amount })
        }
        _ => None,
    }
}

// Constantes de direcciones (configurar en deploy)
const ACTIVE_POOL_ADDRESS: &str = env!("ACTIVE_POOL_ADDRESS");
const ORACLE_APP_ID: &str = env!("ORACLE_APP_ID");
const ZKUSD_APP_ID: &str = env!("ZKUSD_APP_ID");
const PROTOCOL_STATE_KEY: [u8; 32] = [0u8; 32];
```

#### Entregables Dia 5-7
- [ ] Vault Manager implementado
- [ ] Open/Close vault funcionando
- [ ] Add/Withdraw collateral
- [ ] Mint/Repay debt
- [ ] ICR calculation correcto
- [ ] Tests unitarios

---

## SEMANA 2: FEATURES CRITICOS (Dias 8-14)

### Dia 8-9: Stability Pool

#### Archivo: contracts/stability-pool/src/lib.rs

```rust
//! Stability Pool - Primera linea de defensa del sistema
//!
//! Usuarios depositan zkUSD y ganan BTC de liquidaciones

use charms_sdk::prelude::*;

/// Escala para precision de calculos
const SCALE_FACTOR: u128 = 1_000_000_000_000_000_000; // 1e18

#[derive(Debug, Clone, CharmState)]
pub struct SPDeposit {
    pub owner: Address,
    pub initial_value: u64,
    pub snapshot_p: u128,
    pub snapshot_s: u128,
    pub snapshot_epoch: u64,
    pub snapshot_scale: u64,
}

#[derive(Debug, Clone, CharmState)]
pub struct StabilityPoolState {
    pub total_zkusd: u64,
    pub total_btc: u64,
    pub product_p: u128,  // Running product
    pub sum_s: u128,      // Running sum for BTC
    pub current_epoch: u64,
    pub current_scale: u64,
}

#[derive(Debug, Clone)]
pub enum SPAction {
    Deposit { amount: u64 },
    Withdraw { amount: u64 },
    ClaimBTC,
    Offset { debt: u64, collateral: u64 }, // Solo desde VaultManager
}

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let action = match parse_action(ctx) {
        Some(a) => a,
        None => return false,
    };

    match action {
        SPAction::Deposit { amount } => validate_deposit(ctx, amount),
        SPAction::Withdraw { amount } => validate_withdraw(ctx, amount),
        SPAction::ClaimBTC => validate_claim_btc(ctx),
        SPAction::Offset { debt, collateral } => validate_offset(ctx, debt, collateral),
    }
}

/// Depositar zkUSD en el pool
fn validate_deposit(ctx: &SpellContext, amount: u64) -> bool {
    let depositor = ctx.get_signer();

    // 1. Verificar zkUSD transfer al pool
    if !ctx.has_app_input_from(ZKUSD_APP_ID, &depositor, amount) {
        return false;
    }

    // 2. Verificar firma
    ctx.verify_signature(&depositor)
}

/// Retirar zkUSD (compounded)
fn validate_withdraw(ctx: &SpellContext, amount: u64) -> bool {
    let depositor = ctx.get_signer();

    // 1. Obtener deposito
    let deposit = match get_deposit(ctx, &depositor) {
        Some(d) => d,
        None => return false,
    };

    // 2. Calcular valor compounded (puede ser menor por liquidaciones)
    let compounded = calculate_compounded_value(&deposit, ctx);
    if amount > compounded {
        return false;
    }

    // 3. Verificar output de zkUSD al depositante
    if !ctx.has_app_output_to(ZKUSD_APP_ID, &depositor, amount) {
        return false;
    }

    // 4. Tambien dar cualquier BTC ganado
    let btc_gain = calculate_btc_gain(&deposit, ctx);
    if btc_gain > 0 && !ctx.has_btc_output_to(&depositor, btc_gain) {
        return false;
    }

    ctx.verify_signature(&depositor)
}

/// Reclamar BTC ganado sin retirar zkUSD
fn validate_claim_btc(ctx: &SpellContext) -> bool {
    let depositor = ctx.get_signer();

    let deposit = match get_deposit(ctx, &depositor) {
        Some(d) => d,
        None => return false,
    };

    let btc_gain = calculate_btc_gain(&deposit, ctx);
    if btc_gain == 0 {
        return false;
    }

    if !ctx.has_btc_output_to(&depositor, btc_gain) {
        return false;
    }

    ctx.verify_signature(&depositor)
}

/// Offset: absorber deuda de liquidacion
/// SOLO PUEDE SER LLAMADO POR VAULT_MANAGER
fn validate_offset(ctx: &SpellContext, debt: u64, collateral: u64) -> bool {
    // 1. CRITICO: Solo VaultManager
    if !ctx.has_app_caller(VAULT_MANAGER_APP_ID) {
        return false;
    }

    // 2. Verificar que hay suficiente en el pool
    let state = get_pool_state(ctx);
    if state.total_zkusd < debt {
        return false;
    }

    // 3. Verificar que collateral BTC está llegando
    if !ctx.has_btc_input(collateral) {
        return false;
    }

    true
}

/// Calcular valor compounded de un deposito
fn calculate_compounded_value(deposit: &SPDeposit, ctx: &SpellContext) -> u64 {
    let state = get_pool_state(ctx);

    // Si epoch/scale cambio, posiblemente perdio todo
    if deposit.snapshot_epoch < state.current_epoch {
        return 0;
    }

    // Factor de escala para precision
    let scale_diff = state.current_scale - deposit.snapshot_scale;
    let p_ratio = if scale_diff == 0 {
        state.product_p * SCALE_FACTOR / deposit.snapshot_p
    } else if scale_diff == 1 {
        state.product_p * SCALE_FACTOR / deposit.snapshot_p / SCALE_FACTOR
    } else {
        0
    };

    (deposit.initial_value as u128 * p_ratio / SCALE_FACTOR) as u64
}

/// Calcular BTC ganado de liquidaciones
fn calculate_btc_gain(deposit: &SPDeposit, ctx: &SpellContext) -> u64 {
    let state = get_pool_state(ctx);

    let sum_diff = state.sum_s - deposit.snapshot_s;
    (deposit.initial_value as u128 * sum_diff / SCALE_FACTOR) as u64
}

fn get_deposit(ctx: &SpellContext, owner: &Address) -> Option<SPDeposit> {
    ctx.get_state::<SPDeposit>(&owner.to_bytes())
}

fn get_pool_state(ctx: &SpellContext) -> StabilityPoolState {
    ctx.get_state::<StabilityPoolState>(&[0u8; 32])
        .unwrap_or_default()
}

fn parse_action(ctx: &SpellContext) -> Option<SPAction> {
    let action_type = ctx.get_param::<String>("action")?;

    match action_type.as_str() {
        "deposit" => {
            let amount = ctx.get_param::<u64>("amount")?;
            Some(SPAction::Deposit { amount })
        }
        "withdraw" => {
            let amount = ctx.get_param::<u64>("amount")?;
            Some(SPAction::Withdraw { amount })
        }
        "claim_btc" => Some(SPAction::ClaimBTC),
        "offset" => {
            let debt = ctx.get_param::<u64>("debt")?;
            let collateral = ctx.get_param::<u64>("collateral")?;
            Some(SPAction::Offset { debt, collateral })
        }
        _ => None,
    }
}

const VAULT_MANAGER_APP_ID: &str = env!("VAULT_MANAGER_APP_ID");
const ZKUSD_APP_ID: &str = env!("ZKUSD_APP_ID");
```

### Dia 10-11: Liquidation Engine

Agregar al Vault Manager:

```rust
// En vault-manager/src/lib.rs - agregar:

/// Acciones de liquidacion
impl VaultAction {
    // ... acciones existentes ...
    Liquidate { vault_id: [u8; 32] },
}

/// Validar liquidacion
fn validate_liquidation(ctx: &SpellContext, vault_id: &[u8; 32]) -> bool {
    let vault = match get_vault(ctx, vault_id) {
        Some(v) => v,
        None => return false,
    };

    // 1. Verificar que vault está bajo-colateralizado
    let btc_price = get_btc_price(ctx);
    let icr = calculate_icr(vault.collateral, vault.debt, btc_price);

    let liquidation_threshold = if is_recovery_mode(ctx) { CCR } else { MCR };
    if icr >= liquidation_threshold {
        return false; // No liquidable
    }

    // 2. Calcular compensación para liquidador
    let gas_compensation = LIQUIDATION_RESERVE;
    let collateral_compensation = vault.collateral * 5 / 1000; // 0.5%

    let debt_to_offset = vault.debt - gas_compensation;
    let collateral_to_offset = vault.collateral - collateral_compensation;

    // 3. Verificar que Stability Pool tiene suficiente
    let sp_balance = get_sp_balance(ctx);

    if sp_balance >= debt_to_offset {
        // Liquidacion via SP
        validate_sp_liquidation(ctx, &vault, debt_to_offset, collateral_to_offset)
    } else if sp_balance > 0 {
        // Liquidacion parcial via SP + redistribucion
        validate_partial_liquidation(ctx, &vault, sp_balance, debt_to_offset, collateral_to_offset)
    } else {
        // Redistribucion pura
        validate_redistribution(ctx, &vault, debt_to_offset, collateral_to_offset)
    }
}

fn validate_sp_liquidation(
    ctx: &SpellContext,
    vault: &Vault,
    debt: u64,
    collateral: u64,
) -> bool {
    // Verificar que se llama offset en SP
    if !ctx.will_call_sp_offset(debt, collateral) {
        return false;
    }

    // Verificar compensacion al liquidador
    let liquidator = ctx.get_signer();
    let gas_comp = LIQUIDATION_RESERVE;
    let coll_comp = vault.collateral * 5 / 1000;

    if !ctx.has_app_output_to(ZKUSD_APP_ID, &liquidator, gas_comp) {
        return false;
    }
    if !ctx.has_btc_output_to(&liquidator, coll_comp) {
        return false;
    }

    true
}

fn validate_redistribution(
    ctx: &SpellContext,
    vault: &Vault,
    debt: u64,
    collateral: u64,
) -> bool {
    // En redistribucion, deuda y collateral se reparten
    // proporcionalmente entre todos los vaults activos

    // Para MVP, simplificamos y solo verificamos que
    // el estado se actualiza correctamente

    let total_collateral = get_total_collateral(ctx);
    if total_collateral == 0 {
        return false; // No hay a quien redistribuir
    }

    // Verificar que Default Pool recibe el collateral
    if !ctx.has_btc_output_to(DEFAULT_POOL_ADDRESS, collateral) {
        return false;
    }

    true
}

fn get_sp_balance(ctx: &SpellContext) -> u64 {
    ctx.get_app_balance(STABILITY_POOL_ADDRESS, ZKUSD_APP_ID)
}

const DEFAULT_POOL_ADDRESS: &str = env!("DEFAULT_POOL_ADDRESS");
const STABILITY_POOL_ADDRESS: &str = env!("STABILITY_POOL_ADDRESS");
```

### Dia 12-14: Mock Oracle + Integration Tests

#### Archivo: contracts/price-oracle/src/lib.rs

```rust
//! Price Oracle Mock para MVP
//! En produccion, integrar con oracle real

use charms_sdk::prelude::*;

#[derive(Debug, Clone, CharmState)]
pub struct PriceData {
    pub price: u64,        // USD price with 8 decimals
    pub timestamp: u64,    // Block height
    pub source: String,    // "mock" / "chainlink" / etc
}

#[derive(Debug, Clone)]
pub enum OracleAction {
    UpdatePrice { price: u64 },
    GetPrice,
}

/// Precio hardcodeado para MVP
const DEFAULT_BTC_PRICE: u64 = 100_000_00000000; // $100,000

/// Maximo cambio permitido por update (5%)
const MAX_PRICE_CHANGE: u64 = 5;

/// Operador autorizado (en MVP)
const AUTHORIZED_OPERATOR: &str = env!("ORACLE_OPERATOR");

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    let action = match parse_action(ctx) {
        Some(a) => a,
        None => return false,
    };

    match action {
        OracleAction::UpdatePrice { price } => validate_update_price(ctx, price),
        OracleAction::GetPrice => true, // Siempre permitido leer
    }
}

fn validate_update_price(ctx: &SpellContext, new_price: u64) -> bool {
    let updater = ctx.get_signer();

    // 1. Solo operador autorizado
    if updater.to_string() != AUTHORIZED_OPERATOR {
        return false;
    }

    // 2. Verificar cambio razonable
    let current = get_current_price(ctx);
    let change_percent = if new_price > current {
        (new_price - current) * 100 / current
    } else {
        (current - new_price) * 100 / current
    };

    if change_percent > MAX_PRICE_CHANGE {
        // Cambio muy grande, podria ser manipulacion
        return false;
    }

    // 3. Verificar firma
    ctx.verify_signature(&updater)
}

fn get_current_price(ctx: &SpellContext) -> u64 {
    ctx.get_state::<PriceData>(&[0u8; 32])
        .map(|p| p.price)
        .unwrap_or(DEFAULT_BTC_PRICE)
}

fn parse_action(ctx: &SpellContext) -> Option<OracleAction> {
    let action_type = ctx.get_param::<String>("action")?;

    match action_type.as_str() {
        "update" => {
            let price = ctx.get_param::<u64>("price")?;
            Some(OracleAction::UpdatePrice { price })
        }
        "get" => Some(OracleAction::GetPrice),
        _ => None,
    }
}
```

#### Entregables Semana 2
- [ ] Stability Pool funcionando
- [ ] Liquidation engine basico
- [ ] Mock oracle
- [ ] Integration tests entre contratos
- [ ] Todos los contratos compilan

---

## SEMANA 3: FRONTEND (Dias 15-21)

### Dia 15-16: Setup Frontend

```bash
# En directorio zkUSD/
cd apps
npx create-next-app@latest web --typescript --tailwind --app --src-dir

cd web
npm install @tanstack/react-query zustand
npm install @unisat/wallet-sdk
npm install recharts framer-motion
npm install lucide-react @radix-ui/react-*
```

### Dia 17-19: UI Components

#### Archivo: apps/web/src/components/vault/VaultCard.tsx

```tsx
'use client';

import { useState } from 'react';
import { useVault } from '@/hooks/useVault';
import { formatBTC, formatUSD, formatPercent } from '@/lib/format';

interface VaultCardProps {
  vaultId: string;
}

export function VaultCard({ vaultId }: VaultCardProps) {
  const { vault, btcPrice, isLoading } = useVault(vaultId);

  if (isLoading || !vault) {
    return <VaultSkeleton />;
  }

  const collateralValueUSD = (vault.collateral / 1e8) * btcPrice;
  const icr = (collateralValueUSD * 100) / (vault.debt / 1e8);
  const healthStatus = getHealthStatus(icr);

  return (
    <div className="rounded-lg border bg-card p-6">
      <h3 className="text-lg font-semibold mb-4">Your Vault</h3>

      {/* Collateral & Debt */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Collateral</p>
          <p className="text-2xl font-bold">{formatBTC(vault.collateral)}</p>
          <p className="text-sm text-muted-foreground">
            {formatUSD(collateralValueUSD)}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Debt</p>
          <p className="text-2xl font-bold">{formatUSD(vault.debt / 1e8)}</p>
          <p className="text-sm text-muted-foreground">zkUSD</p>
        </div>
      </div>

      {/* Health Indicator */}
      <div className="mb-6">
        <div className="flex justify-between mb-2">
          <span className="text-sm">Collateral Ratio</span>
          <span className={`text-sm font-medium ${healthStatus.color}`}>
            {formatPercent(icr)}
          </span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full ${healthStatus.barColor}`}
            style={{ width: `${Math.min(icr / 3, 100)}%` }}
          />
        </div>
        <p className={`text-xs mt-1 ${healthStatus.color}`}>
          {healthStatus.message}
        </p>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-outline">Add Collateral</button>
        <button className="btn btn-outline">Withdraw</button>
        <button className="btn btn-primary">Mint zkUSD</button>
        <button className="btn btn-secondary">Repay Debt</button>
      </div>
    </div>
  );
}

function getHealthStatus(icr: number) {
  if (icr >= 250) {
    return {
      color: 'text-green-500',
      barColor: 'bg-green-500',
      message: 'Healthy - Safe from liquidation'
    };
  } else if (icr >= 150) {
    return {
      color: 'text-yellow-500',
      barColor: 'bg-yellow-500',
      message: 'Moderate - Consider adding collateral'
    };
  } else if (icr >= 110) {
    return {
      color: 'text-orange-500',
      barColor: 'bg-orange-500',
      message: 'At Risk - Add collateral soon!'
    };
  } else {
    return {
      color: 'text-red-500',
      barColor: 'bg-red-500',
      message: 'DANGER - Liquidation imminent!'
    };
  }
}
```

#### Archivo: apps/web/src/components/vault/OpenVaultForm.tsx

```tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useWallet } from '@/hooks/useWallet';
import { useOpenVault } from '@/hooks/useOpenVault';

interface OpenVaultFormData {
  collateralBTC: number;
  debtZKUSD: number;
}

export function OpenVaultForm() {
  const { address, balance } = useWallet();
  const { openVault, isLoading, error } = useOpenVault();
  const [btcPrice] = useState(100000); // Mock price

  const { register, handleSubmit, watch, formState: { errors } } = useForm<OpenVaultFormData>();

  const collateral = watch('collateralBTC', 0);
  const debt = watch('debtZKUSD', 0);

  const collateralValueUSD = collateral * btcPrice;
  const icr = debt > 0 ? (collateralValueUSD * 100) / debt : 0;
  const maxDebt = (collateralValueUSD * 100) / 150; // 150% min ratio
  const borrowingFee = debt * 0.005; // 0.5%

  const onSubmit = async (data: OpenVaultFormData) => {
    await openVault({
      collateral: Math.floor(data.collateralBTC * 1e8), // to sats
      debt: Math.floor(data.debtZKUSD * 1e8), // 8 decimals
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">
          Collateral (BTC)
        </label>
        <input
          type="number"
          step="0.00000001"
          max={balance}
          {...register('collateralBTC', {
            required: true,
            min: 0.001,
            max: balance
          })}
          className="input input-bordered w-full"
          placeholder="0.00"
        />
        <p className="text-sm text-muted-foreground mt-1">
          Balance: {balance} BTC
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          Borrow (zkUSD)
        </label>
        <input
          type="number"
          step="0.01"
          max={maxDebt}
          {...register('debtZKUSD', {
            required: true,
            min: 2000,
            max: maxDebt
          })}
          className="input input-bordered w-full"
          placeholder="0.00"
        />
        <p className="text-sm text-muted-foreground mt-1">
          Max: {maxDebt.toFixed(2)} zkUSD (at 150% ratio)
        </p>
      </div>

      {/* Summary */}
      <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
        <div className="flex justify-between">
          <span>Collateral Value</span>
          <span>${collateralValueUSD.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Borrowing Fee (0.5%)</span>
          <span>{borrowingFee.toFixed(2)} zkUSD</span>
        </div>
        <div className="flex justify-between">
          <span>Collateral Ratio</span>
          <span className={icr < 150 ? 'text-red-500' : 'text-green-500'}>
            {icr.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>You Receive</span>
          <span>{(debt - borrowingFee).toFixed(2)} zkUSD</span>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error.message}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={isLoading || icr < 150}
      >
        {isLoading ? 'Opening Vault...' : 'Open Vault'}
      </button>
    </form>
  );
}
```

### Dia 20-21: Wallet Integration + Testing

#### Archivo: apps/web/src/hooks/useWallet.ts

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';

interface WalletState {
  address: string | null;
  balance: number;
  connected: boolean;
  network: 'mainnet' | 'testnet';
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    balance: 0,
    connected: false,
    network: 'testnet',
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Check if Unisat is available
  const isUnisatAvailable = typeof window !== 'undefined' && window.unisat;

  const connect = useCallback(async () => {
    if (!isUnisatAvailable) {
      setError(new Error('Unisat wallet not found. Please install it.'));
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Request accounts
      const accounts = await window.unisat.requestAccounts();
      const address = accounts[0];

      // Get balance
      const balance = await window.unisat.getBalance();

      // Get network
      const network = await window.unisat.getNetwork();

      setState({
        address,
        balance: balance.confirmed / 1e8, // Convert to BTC
        connected: true,
        network: network === 'livenet' ? 'mainnet' : 'testnet',
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsConnecting(false);
    }
  }, [isUnisatAvailable]);

  const disconnect = useCallback(() => {
    setState({
      address: null,
      balance: 0,
      connected: false,
      network: 'testnet',
    });
  }, []);

  // Auto-connect if previously connected
  useEffect(() => {
    if (isUnisatAvailable) {
      window.unisat.getAccounts().then((accounts: string[]) => {
        if (accounts.length > 0) {
          connect();
        }
      });
    }
  }, [isUnisatAvailable, connect]);

  // Listen for account changes
  useEffect(() => {
    if (isUnisatAvailable) {
      window.unisat.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnect();
        } else {
          connect();
        }
      });
    }
  }, [isUnisatAvailable, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    isConnecting,
    error,
    isUnisatAvailable,
  };
}

// Type declarations for Unisat
declare global {
  interface Window {
    unisat?: {
      requestAccounts: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      getBalance: () => Promise<{ confirmed: number; unconfirmed: number }>;
      getNetwork: () => Promise<string>;
      signMessage: (message: string) => Promise<string>;
      signPsbt: (psbt: string) => Promise<string>;
      on: (event: string, callback: (...args: any[]) => void) => void;
    };
  }
}
```

#### Entregables Semana 3
- [ ] Frontend Next.js funcionando
- [ ] Dashboard con stats del sistema
- [ ] Formulario Open Vault
- [ ] Vista de Vault existente
- [ ] Stability Pool UI
- [ ] Unisat wallet conectando
- [ ] Deployment a testnet

---

## SEMANA 4: POLISH & DEMO (Dias 22-28)

### Dia 22-24: Bug Fixes + UX Improvements

**Checklist de bugs comunes**:
- [ ] Manejo de errores en todas las transacciones
- [ ] Loading states en todos los botones
- [ ] Validacion de inputs
- [ ] Responsive design
- [ ] Edge cases (vault vacio, sin fondos, etc)

### Dia 25-26: Demo Video

**Estructura del demo (3-5 minutos)**:

```
0:00 - 0:30  INTRO
- "zkUSD - El DAI de Bitcoin"
- Problema: No existe stablecoin CDP nativa en Bitcoin

0:30 - 1:30  DEMO LIVE
- Conectar wallet
- Abrir vault con BTC
- Mintear zkUSD
- Ver dashboard

1:30 - 2:30  ARQUITECTURA
- Mostrar diagrama
- Explicar uso de Charms
- ZK proofs
- Cross-chain potencial

2:30 - 3:30  DIFERENCIACION
- vs Mezo (sidechain vs L1)
- vs Liquity (Bitcoin vs ETH)
- 0% interest model

3:30 - 4:00  ROADMAP
- MVP actual
- Stability Pool
- Liquidations
- Cross-chain

4:00 - 4:30  CIERRE
- Link a GitHub
- Call to action
```

### Dia 27-28: Documentacion + Submission

#### README.md Final

```markdown
# zkUSD - Bitcoin Native Stablecoin

The first decentralized stablecoin CDP on Bitcoin Layer 1, powered by Charms Protocol.

## Features

- **Native Bitcoin**: Not a sidechain or L2, runs directly on Bitcoin
- **Zero Interest**: Borrow against your BTC with 0% interest (only 0.5% fee)
- **Overcollateralized**: 150% minimum collateral ratio
- **Liquidation Protected**: Stability Pool absorbs bad debt

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/zkusd
cd zkusd

# Install
pnpm install

# Build contracts
cd contracts && cargo build --release

# Run frontend
cd apps/web && pnpm dev
```

## Architecture

[Diagram]

## How It Works

1. **Deposit BTC** as collateral (minimum 150% ratio)
2. **Mint zkUSD** against your collateral
3. **Use zkUSD** for DeFi, payments, trading
4. **Repay anytime** to retrieve your BTC

## Tech Stack

- **Contracts**: Rust → WASM (Charms Protocol)
- **Frontend**: Next.js 14, TailwindCSS
- **Wallet**: Unisat integration

## Roadmap

- [x] MVP: Open/Close Vaults
- [x] MVP: Mint/Burn zkUSD
- [ ] Stability Pool
- [ ] Liquidation Engine
- [ ] Cross-chain Beaming
- [ ] Real Oracle Integration

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT
```

#### Entregables Semana 4
- [ ] Todos los bugs criticos arreglados
- [ ] Demo video grabado y editado
- [ ] README completo
- [ ] CONTRIBUTING.md
- [ ] Deploy final a testnet
- [ ] Submission completado

---

## CHECKLIST FINAL

### Requisitos del Hackathon
- [ ] Codigo funcional que interactua con Charms
- [ ] Integrado con Charms SDK
- [ ] Frontend funcional
- [ ] Al menos 1 core feature end-to-end
- [ ] Documentacion de planes de expansion

### Criterios de Evaluacion
- [ ] **Funcionalidad**: MVP funciona correctamente
- [ ] **Caso de Uso**: Problema real, mercado grande
- [ ] **Implementacion Charms**: Uso apropiado del protocolo
- [ ] **Potencial Real**: Path claro a producto

### Diferenciadores para Ganar
- [ ] Primera stablecoin CDP en Bitcoin L1
- [ ] Arquitectura modular reutilizable
- [ ] 0% interest model
- [ ] Plan de contribucion open source
- [ ] Demo profesional

---

## RECURSOS

### Links Utiles
- Charms Docs: https://docs.charms.dev
- BitcoinOS Docs: https://docs.bitcoinos.build
- Mezo Reference: https://github.com/mezo-org/musd
- Liquity Whitepaper: https://www.liquity.org/whitepaper

### Contactos
- Discord del Hackathon
- Mentores de BitcoinOS
- Twitter: @BTC_OS, @CharmsDev

---

## APENDICE A: PATRONES SOROBAN ADOPTADOS

Basado en la investigacion de Soroban, adoptamos estos patrones para mejorar la calidad del codigo:

### A.1 Error Handling Mejorado

**Antes (bool simple)**:
```rust
pub fn validate(ctx: &SpellContext) -> bool {
    if icr < MCR { return false; }
    true
}
```

**Despues (Result con tipos)**:
```rust
#[derive(Debug, Clone)]
pub enum VaultError {
    VaultNotFound { vault_id: [u8; 32] },
    Undercollateralized { current: u64, required: u64 },
    InvalidAmount { amount: u64, reason: &'static str },
    OracleStale { last_update: u64, current_block: u64 },
    Unauthorized { expected: Address, actual: Address },
    InsufficientBalance { available: u64, requested: u64 },
    RecoveryModeRestriction,
    MinDebtNotMet { minimum: u64, actual: u64 },
}

pub fn validate(ctx: &SpellContext) -> Result<(), VaultError> {
    let icr = calculate_icr(vault.collateral, vault.debt, btc_price);
    let min_ratio = get_min_ratio(ctx);

    if icr < min_ratio {
        return Err(VaultError::Undercollateralized {
            current: icr,
            required: min_ratio
        });
    }
    Ok(())
}
```

### A.2 Token Metadata (Inspirado en SEP-41)

```rust
// contracts/zkusd-token/src/lib.rs

/// Token metadata siguiendo patron SEP-41 de Soroban
pub mod metadata {
    pub const NAME: &str = "zkUSD";
    pub const SYMBOL: &str = "zkUSD";
    pub const DECIMALS: u8 = 8;
    pub const DESCRIPTION: &str = "Bitcoin-native stablecoin";
}

/// Verificar metadata en compilacion
const _: () = {
    assert!(metadata::DECIMALS <= 18, "Decimals must be <= 18");
    assert!(!metadata::NAME.is_empty(), "Name required");
    assert!(!metadata::SYMBOL.is_empty(), "Symbol required");
};
```

### A.3 Events System

```rust
// events/mod.rs

/// Eventos del protocolo para indexadores
#[derive(Debug, Clone)]
pub enum ZkUsdEvent {
    VaultOpened {
        vault_id: [u8; 32],
        owner: Address,
        collateral: u64,
        debt: u64,
        timestamp: u64,
    },
    VaultClosed {
        vault_id: [u8; 32],
        owner: Address,
        collateral_returned: u64,
        debt_repaid: u64,
    },
    CollateralAdded {
        vault_id: [u8; 32],
        amount: u64,
        new_total: u64,
    },
    CollateralWithdrawn {
        vault_id: [u8; 32],
        amount: u64,
        new_total: u64,
    },
    DebtMinted {
        vault_id: [u8; 32],
        amount: u64,
        fee: u64,
        new_total: u64,
    },
    DebtRepaid {
        vault_id: [u8; 32],
        amount: u64,
        new_total: u64,
    },
    Liquidation {
        vault_id: [u8; 32],
        liquidator: Address,
        debt_absorbed: u64,
        collateral_seized: u64,
    },
    StabilityDeposit {
        depositor: Address,
        amount: u64,
        new_total: u64,
    },
    StabilityWithdrawal {
        depositor: Address,
        zkusd_withdrawn: u64,
        btc_gained: u64,
    },
    PriceUpdated {
        asset: String,
        old_price: u64,
        new_price: u64,
        source: String,
    },
}

/// Emitir evento (para indexadores)
fn emit_event(ctx: &SpellContext, event: ZkUsdEvent) {
    // Serializar y agregar a outputs para indexadores
    ctx.emit_app_event(&event);
}

// Uso en contratos:
fn validate_open_vault(ctx: &SpellContext, collateral: u64, debt: u64) -> Result<(), VaultError> {
    // ... validaciones ...

    emit_event(ctx, ZkUsdEvent::VaultOpened {
        vault_id: new_vault_id,
        owner: owner.clone(),
        collateral,
        debt,
        timestamp: ctx.block_height(),
    });

    Ok(())
}
```

### A.4 Testing Framework

```rust
// tests/common/mod.rs

/// Contexto de testing inspirado en Soroban testutils
pub struct TestContext {
    pub inputs: Vec<TestUTXO>,
    pub outputs: Vec<TestUTXO>,
    pub oracle_price: u64,
    pub block_height: u64,
    pub signer: Address,
    pub protocol_state: ProtocolState,
}

impl TestContext {
    pub fn new() -> Self {
        Self {
            inputs: vec![],
            outputs: vec![],
            oracle_price: 100_000_00000000, // $100,000
            block_height: 800_000,
            signer: Address::mock(),
            protocol_state: ProtocolState::default(),
        }
    }

    /// Builder: agregar collateral BTC
    pub fn with_btc_collateral(mut self, amount_sats: u64) -> Self {
        self.inputs.push(TestUTXO::btc(amount_sats, self.signer.clone()));
        self
    }

    /// Builder: agregar zkUSD balance
    pub fn with_zkusd_balance(mut self, amount: u64) -> Self {
        self.inputs.push(TestUTXO::zkusd(amount, self.signer.clone()));
        self
    }

    /// Builder: establecer precio oracle
    pub fn with_price(mut self, price: u64) -> Self {
        self.oracle_price = price;
        self
    }

    /// Builder: establecer TCR del sistema
    pub fn with_tcr(mut self, tcr: u64) -> Self {
        self.protocol_state.total_collateral = 1000_00000000;
        self.protocol_state.total_debt = (1000_00000000 as u128 * self.oracle_price as u128
            * 100 / tcr as u128) as u64;
        self
    }

    /// Convertir a SpellContext para validacion
    pub fn into_spell_context(self) -> MockSpellContext {
        MockSpellContext {
            inputs: self.inputs,
            outputs: self.outputs,
            oracle_price: self.oracle_price,
            block_height: self.block_height,
            signer: self.signer,
            protocol_state: self.protocol_state,
        }
    }
}

/// Helpers de assertion
pub mod assertions {
    use super::*;

    pub fn assert_vault_icr_above(vault: &Vault, btc_price: u64, min_icr: u64) {
        let icr = calculate_icr(vault.collateral, vault.debt, btc_price);
        assert!(
            icr >= min_icr,
            "Expected ICR >= {}%, got {}%",
            min_icr, icr
        );
    }

    pub fn assert_error_code(result: Result<(), VaultError>, expected: VaultError) {
        match result {
            Err(e) if std::mem::discriminant(&e) == std::mem::discriminant(&expected) => (),
            Err(e) => panic!("Expected {:?}, got {:?}", expected, e),
            Ok(_) => panic!("Expected error {:?}, got Ok", expected),
        }
    }
}

// Ejemplo de test
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_vault_success() {
        let ctx = TestContext::new()
            .with_btc_collateral(15_00000000)  // 15 BTC
            .with_price(100_000_00000000)       // $100,000/BTC
            .with_tcr(200);                     // Sistema saludable

        let result = validate_open_vault(
            &ctx.into_spell_context(),
            15_00000000,                        // 15 BTC collateral
            1_000_000_00000000,                 // 1M zkUSD debt
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_open_vault_undercollateralized() {
        let ctx = TestContext::new()
            .with_btc_collateral(1_00000000)   // 1 BTC
            .with_price(100_000_00000000);      // $100,000/BTC

        let result = validate_open_vault(
            &ctx.into_spell_context(),
            1_00000000,                         // 1 BTC ($100k)
            100_000_00000000,                   // 100k zkUSD (100% ratio)
        );

        assertions::assert_error_code(
            result,
            VaultError::Undercollateralized { current: 0, required: 0 }
        );
    }

    #[test]
    fn test_liquidation_in_recovery_mode() {
        let ctx = TestContext::new()
            .with_tcr(140)  // Below CCR (150%), Recovery Mode
            .with_price(100_000_00000000);

        // En Recovery Mode, vaults con ICR < CCR son liquidables
        // (normalmente solo < MCR)
        let vault = Vault {
            owner: Address::mock(),
            collateral: 15_00000000,  // 15 BTC
            debt: 1_200_000_00000000, // $1.2M debt, ICR = 125%
            created_at: 0,
            is_active: true,
        };

        let result = validate_liquidation(
            &ctx.into_spell_context(),
            &vault,
        );

        assert!(result.is_ok(), "Vault with 125% ICR should be liquidable in Recovery Mode");
    }
}
```

### A.5 Storage Tiers Adaptado

Aunque usamos UTXO en lugar de account model, aplicamos el concepto de tiers:

```rust
// Tier 1: Critico (pequeno, en script pubkey)
// Para configuracion del protocolo que rara vez cambia
pub struct ProtocolConfig {
    pub admin: Address,
    pub mcr: u64,
    pub ccr: u64,
    pub min_debt: u64,
    pub liquidation_reserve: u64,
}

// Tier 2: Persistente (UTXO dedicado por vault)
// Para estado de cada vault
pub struct VaultState {
    pub vault_id: [u8; 32],
    pub owner: Address,
    pub collateral: u64,
    pub debt: u64,
    pub created_at: u64,
    pub status: VaultStatus,
}

// Tier 3: Efimero (off-chain en indexador)
// No usar UTXOs para datos temporales
// - Precios historicos
// - Cache de consultas
// - Metricas de usuario
```

---

## APENDICE B: CONTRIBUCIONES OPEN SOURCE

### B.1 Paquetes a Crear

| Paquete | Descripcion | Prioridad |
|---------|-------------|-----------|
| **bitcoin-connect-kit** | RainbowKit para Bitcoin | Alta |
| **defi-ui** | Componentes shadcn para DeFi | Media |
| **btc-test-utils** | Testing utilities | Media |
| **btc-hooks** | React hooks para Bitcoin | Alta |

### B.2 Estructura de Monorepo

```
zkusd-ecosystem/
├── packages/
│   ├── bitcoin-connect-kit/     # Wallet connection
│   ├── defi-ui/                 # UI Components
│   ├── btc-test-utils/          # Testing
│   ├── btc-hooks/               # React hooks
│   └── zkusd-sdk/               # zkUSD SDK
├── apps/
│   └── zkusd-web/               # Main app
├── contracts/                    # Charms contracts
├── docs/
└── examples/
```

### B.3 Metricas de Impacto

```
Contribucion exitosa si:
- NPM downloads: 100+/semana
- GitHub stars: 50+
- Integraciones externas: 2+
- Issues activos de comunidad
```

---

## APENDICE C: CHECKLIST DE CALIDAD

### C.1 Contracts

- [ ] Todos los errores usan VaultError enum
- [ ] Eventos emitidos en cada operacion
- [ ] Tests para happy path y edge cases
- [ ] ICR calculations verificados matematicamente
- [ ] Recovery Mode behaviors testeados

### C.2 Frontend

- [ ] Wallet connection para Unisat, Xverse, Leather
- [ ] Error handling con mensajes claros
- [ ] Fee estimation visible antes de firmar
- [ ] Health indicator visual
- [ ] Mobile responsive

### C.3 Documentacion

- [ ] README con quick start
- [ ] Architecture diagram
- [ ] API reference
- [ ] Contributing guide
- [ ] Examples para cada operacion

---

**VAMOS A GANAR ESTE HACKATHON!**
