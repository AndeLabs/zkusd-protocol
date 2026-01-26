//! Charms SDK Integration for zkUSD Vault Manager
//!
//! This module bridges the Charms SDK types with the internal vault validation logic.
//!
//! ## UTXO Transformation Model
//!
//! Each vault operation is a transformation of input UTXOs to output UTXOs:
//!
//! ```text
//! OpenVault:
//!   IN: [BTC collateral, ProtocolState]
//!   OUT: [Vault(new), ProtocolState(updated), zkUSD(minted)]
//!
//! AddCollateral:
//!   IN: [Vault, BTC collateral]
//!   OUT: [Vault(updated)]
//!
//! Liquidate:
//!   IN: [Vault(underwater), StabilityPool, ProtocolState, PriceOracle(ref)]
//!   OUT: [Vault(liquidated), StabilityPool(updated), ProtocolState(updated), BTC(to liquidator)]
//! ```
//!
//! ## Cross-App Validation
//!
//! The VaultManager interacts with other apps in the same transaction:
//! - **zkusd-token**: Minting/burning tokens (authorized caller)
//! - **price-oracle**: Reading BTC price (reference input)
//! - **stability-pool**: Absorbing liquidations

use charms_data::{App, Data, Transaction};
use crate::{VaultManagerState, VaultContext, validate};
use zkusd_common::{
    events::EventLog,
    types::{Vault, VaultAction, VaultId, PriceData},
};

// ============ Operation Codes ============

/// Operation codes for vault actions (encoded in witness)
pub mod op {
    /// Initialize VaultManager (first-time creation)
    pub const INITIALIZE: u8 = 0x00;

    // Core Vault Operations (0x10 - 0x1F)
    pub const OPEN_VAULT: u8 = 0x10;
    pub const CLOSE_VAULT: u8 = 0x11;
    pub const ADD_COLLATERAL: u8 = 0x12;
    pub const WITHDRAW_COLLATERAL: u8 = 0x13;
    pub const MINT_DEBT: u8 = 0x14;
    pub const REPAY_DEBT: u8 = 0x15;
    pub const LIQUIDATE: u8 = 0x16;
    pub const REDEEM: u8 = 0x17;

    // Advanced UTXO-Native Operations (0x20 - 0x2F)
    pub const FLASH_MINT: u8 = 0x20;
    pub const ATOMIC_RESCUE: u8 = 0x21;
    pub const PURCHASE_INSURANCE: u8 = 0x22;
    pub const TRIGGER_INSURANCE: u8 = 0x23;
    pub const TRANSFER_INSURANCE: u8 = 0x24;
}

// ============ Witness Structures ============

/// Witness data for Initialize operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InitWitness {
    pub op: u8,
    /// Admin address
    pub admin: [u8; 32],
    /// zkUSD Token app_id
    pub zkusd_token_id: [u8; 32],
    /// Stability Pool app_id
    pub stability_pool_id: [u8; 32],
    /// Price Oracle app_id
    pub price_oracle_id: [u8; 32],
    /// Active Pool address
    pub active_pool: [u8; 32],
    /// Default Pool address
    pub default_pool: [u8; 32],
}

/// Witness data for vault operations
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultWitness {
    /// Operation type (see `op` module)
    pub op: u8,
    /// Vault ID for operations on existing vaults
    pub vault_id: Option<VaultId>,
    /// Collateral amount in satoshis
    pub collateral: Option<u64>,
    /// Debt amount in zkUSD base units
    pub debt: Option<u64>,

    // Advanced operation fields
    /// Purpose of flash mint (0-5)
    pub flash_purpose: Option<u8>,
    /// Rescuer discount in satoshis
    pub rescuer_discount: Option<u64>,
    /// Insurance coverage amount
    pub coverage: Option<u64>,
    /// Insurance premium
    pub premium: Option<u64>,
    /// Trigger ICR for insurance
    pub trigger_icr: Option<u64>,
    /// Insurance charm ID
    pub insurance_id: Option<[u8; 32]>,
    /// New owner for transfer
    pub new_owner: Option<[u8; 32]>,
}

impl VaultWitness {
    /// Create a default witness with all optional fields as None
    fn default_with_op(op: u8) -> Self {
        Self {
            op,
            vault_id: None,
            collateral: None,
            debt: None,
            flash_purpose: None,
            rescuer_discount: None,
            coverage: None,
            premium: None,
            trigger_icr: None,
            insurance_id: None,
            new_owner: None,
        }
    }

    /// Create witness for opening a new vault
    pub fn open_vault(collateral: u64, debt: u64) -> Self {
        let mut w = Self::default_with_op(op::OPEN_VAULT);
        w.collateral = Some(collateral);
        w.debt = Some(debt);
        w
    }

    /// Create witness for adding collateral
    pub fn add_collateral(vault_id: VaultId, amount: u64) -> Self {
        let mut w = Self::default_with_op(op::ADD_COLLATERAL);
        w.vault_id = Some(vault_id);
        w.collateral = Some(amount);
        w
    }

    /// Create witness for liquidation
    pub fn liquidate(vault_id: VaultId) -> Self {
        let mut w = Self::default_with_op(op::LIQUIDATE);
        w.vault_id = Some(vault_id);
        w
    }

    /// Create witness for flash mint
    pub fn flash_mint(amount: u64, purpose: u8) -> Self {
        let mut w = Self::default_with_op(op::FLASH_MINT);
        w.debt = Some(amount);
        w.flash_purpose = Some(purpose);
        w
    }

    /// Create witness for atomic rescue
    pub fn atomic_rescue(
        vault_id: VaultId,
        collateral_to_add: u64,
        debt_to_repay: u64,
        rescuer_discount: u64,
    ) -> Self {
        let mut w = Self::default_with_op(op::ATOMIC_RESCUE);
        w.vault_id = Some(vault_id);
        w.collateral = Some(collateral_to_add);
        w.debt = Some(debt_to_repay);
        w.rescuer_discount = Some(rescuer_discount);
        w
    }

    /// Create witness for purchasing insurance
    pub fn purchase_insurance(
        vault_id: VaultId,
        coverage_btc: u64,
        premium: u64,
        trigger_icr: u64,
    ) -> Self {
        let mut w = Self::default_with_op(op::PURCHASE_INSURANCE);
        w.vault_id = Some(vault_id);
        w.coverage = Some(coverage_btc);
        w.premium = Some(premium);
        w.trigger_icr = Some(trigger_icr);
        w
    }

    /// Create witness for triggering insurance
    pub fn trigger_insurance(insurance_id: [u8; 32], vault_id: VaultId) -> Self {
        let mut w = Self::default_with_op(op::TRIGGER_INSURANCE);
        w.insurance_id = Some(insurance_id);
        w.vault_id = Some(vault_id);
        w
    }
}

// ============ Main Validation Function ============

/// Validates a vault operation within a Charms transaction.
///
/// This function is called by the Charms runtime to validate CDP operations.
/// It extracts operation details from witness data and verifies the UTXO
/// transformation follows protocol rules.
///
/// ## Operations
///
/// - **Initialize**: Creates initial VaultManager state (no input state required)
/// - **All other ops**: Requires existing VaultManager state
///
/// # Cross-App Interactions
///
/// The VaultManager reads data from other apps in the transaction:
/// - **Price Oracle**: BTC/USD price from `app_public_inputs`
/// - **Stability Pool**: For liquidation offsets
///
/// It also authorizes actions in other apps:
/// - **zkUSD Token**: Mint/burn operations use VaultManager as caller
///
/// # Arguments
/// * `app` - The VaultManager app definition
/// * `tx` - The transaction being validated
/// * `x` - Public inputs (contains oracle price data)
/// * `w` - Witness data (operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn validate_vault_operation(
    app: &App,
    tx: &Transaction,
    x: &Data,
    w: &Data,
) -> bool {
    // Check if this is an Initialize operation
    if let Some(init) = parse_init_witness(w) {
        // Handle Initialize specially (no input state required)
        let output_state = match extract_output_state(app, tx) {
            Some(s) => s,
            None => return false,
        };
        return validate_initialize(&output_state, &init);
    }

    // 1. Parse witness to get operation
    let witness = match parse_witness(w) {
        Some(w) => w,
        None => return false,
    };

    // 2. Convert to internal action type
    let action = match witness_to_action(&witness) {
        Some(a) => a,
        None => return false,
    };

    // 3. Extract protocol state from transaction
    let (state, new_state) = match extract_protocol_states(app, tx) {
        Some(s) => s,
        None => return false,
    };

    // 4. Extract vault being operated on (if applicable)
    let (vault, new_vault) = extract_vaults(app, tx, witness.vault_id);

    // 5. Get BTC price from public inputs or referenced oracle
    let btc_price = match extract_btc_price(tx, x) {
        Some(p) => p,
        None => return false,
    };

    // 6. Calculate BTC inputs and outputs
    let (btc_inputs, btc_outputs) = calculate_btc_flows(tx);

    // 7. Calculate zkUSD inputs and outputs
    let (zkusd_inputs, zkusd_outputs) = calculate_zkusd_flows(tx, &state.zkusd_token_id);

    // 8. Get signer from transaction
    let signer = extract_signer(tx);

    // 9. Build validation context
    let mut ctx = VaultContext {
        state,
        new_state,
        vault,
        new_vault,
        btc_price,
        btc_inputs,
        btc_outputs,
        zkusd_inputs,
        zkusd_outputs,
        signer,
        block_height: 0, // Would be extracted from tx metadata
        events: EventLog::new(),
    };

    // 10. Run validation
    validate(&mut ctx, &action).is_ok()
}

// ============ Parsing Functions ============

/// Parse witness data to check if it's an Initialize operation
fn parse_init_witness(w: &Data) -> Option<InitWitness> {
    if let Ok(init) = w.value::<InitWitness>() {
        if init.op == op::INITIALIZE {
            return Some(init);
        }
    }
    None
}

/// Validate initialization of VaultManager
fn validate_initialize(output: &VaultManagerState, init: &InitWitness) -> bool {
    // Verify output state matches initialization parameters
    if output.zkusd_token_id != init.zkusd_token_id {
        return false;
    }
    if output.stability_pool_id != init.stability_pool_id {
        return false;
    }
    if output.price_oracle_id != init.price_oracle_id {
        return false;
    }
    if output.active_pool != init.active_pool {
        return false;
    }
    if output.default_pool != init.default_pool {
        return false;
    }
    // Verify protocol state is initialized correctly
    if output.protocol.admin != init.admin {
        return false;
    }
    if output.protocol.total_collateral != 0 {
        return false;
    }
    if output.protocol.total_debt != 0 {
        return false;
    }
    if output.protocol.active_vault_count != 0 {
        return false;
    }
    if output.protocol.is_paused {
        return false;
    }
    // Admin cannot be zero address
    if init.admin == [0u8; 32] {
        return false;
    }
    // Pool addresses cannot be zero
    if init.active_pool == [0u8; 32] {
        return false;
    }
    if init.default_pool == [0u8; 32] {
        return false;
    }
    true
}

/// Extract only output state for Initialize operation
fn extract_output_state(app: &App, tx: &Transaction) -> Option<VaultManagerState> {
    tx.outs.iter()
        .find_map(|charms| {
            charms.get(app).and_then(|data| {
                data.value::<VaultManagerState>().ok()
            })
        })
}

/// Parse witness data into VaultWitness
fn parse_witness(w: &Data) -> Option<VaultWitness> {
    // Try serde deserialization
    w.value::<VaultWitness>().ok()
}

/// Convert witness to internal action type
fn witness_to_action(w: &VaultWitness) -> Option<VaultAction> {
    match w.op {
        op::OPEN_VAULT => Some(VaultAction::OpenVault {
            collateral: w.collateral?,
            debt: w.debt?,
        }),
        op::CLOSE_VAULT => Some(VaultAction::CloseVault {
            vault_id: w.vault_id?,
        }),
        op::ADD_COLLATERAL => Some(VaultAction::AddCollateral {
            vault_id: w.vault_id?,
            amount: w.collateral?,
        }),
        op::WITHDRAW_COLLATERAL => Some(VaultAction::WithdrawCollateral {
            vault_id: w.vault_id?,
            amount: w.collateral?,
        }),
        op::MINT_DEBT => Some(VaultAction::MintDebt {
            vault_id: w.vault_id?,
            amount: w.debt?,
        }),
        op::REPAY_DEBT => Some(VaultAction::RepayDebt {
            vault_id: w.vault_id?,
            amount: w.debt?,
        }),
        op::LIQUIDATE => Some(VaultAction::Liquidate {
            vault_id: w.vault_id?,
        }),
        op::REDEEM => Some(VaultAction::Redeem {
            amount: w.debt?,
        }),

        // Advanced UTXO-Native Operations
        op::FLASH_MINT => Some(VaultAction::FlashMint {
            amount: w.debt?,
            purpose: w.flash_purpose.unwrap_or(5), // Default to Custom
        }),
        op::ATOMIC_RESCUE => Some(VaultAction::AtomicRescue {
            vault_id: w.vault_id?,
            collateral_to_add: w.collateral?,
            debt_to_repay: w.debt?,
            rescuer_discount: w.rescuer_discount.unwrap_or(0),
        }),
        op::PURCHASE_INSURANCE => Some(VaultAction::PurchaseInsurance {
            vault_id: w.vault_id?,
            coverage_btc: w.coverage?,
            premium: w.premium?,
            trigger_icr: w.trigger_icr?,
        }),
        op::TRIGGER_INSURANCE => Some(VaultAction::TriggerInsurance {
            insurance_id: w.insurance_id?,
            vault_id: w.vault_id?,
        }),
        op::TRANSFER_INSURANCE => Some(VaultAction::TransferInsurance {
            insurance_id: w.insurance_id?,
            new_owner: w.new_owner?,
        }),
        _ => None,
    }
}

// ============ App Matching ============

/// Match a charm's app by tag and VK (verification key).
///
/// Deploy spells create UTXOs with zero identity (`B32([0; 32])`) because
/// the app_id (`SHA256(commit_txid:vout)`) isn't known at spell creation time.
/// Post-deploy spells use the real identity. Matching by VK+tag handles both
/// cases since VK is consistent across the deploy-to-post-deploy transition.
fn matches_app(charm_app: &App, target_app: &App) -> bool {
    charm_app.tag == target_app.tag && charm_app.vk == target_app.vk
}

// ============ State Extraction ============

/// Extract protocol states from transaction
fn extract_protocol_states(
    app: &App,
    tx: &Transaction,
) -> Option<(VaultManagerState, VaultManagerState)> {
    // Input state from refs or ins - match by VK+tag to handle deploy identity transition
    let input_state = tx.refs.iter()
        .chain(tx.ins.iter())
        .find_map(|(_, charms)| {
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, app) {
                    if let Ok(state) = data.value::<VaultManagerState>() {
                        return Some(state);
                    }
                }
            }
            None
        })?;

    // Output state - match by VK+tag
    let output_state = tx.outs.iter()
        .find_map(|charms| {
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, app) {
                    if let Ok(state) = data.value::<VaultManagerState>() {
                        return Some(state);
                    }
                }
            }
            None
        })?;

    Some((input_state, output_state))
}

/// Extract vault charms from transaction
fn extract_vaults(
    app: &App,
    tx: &Transaction,
    vault_id: Option<VaultId>,
) -> (Option<Vault>, Option<Vault>) {
    let vault_id = match vault_id {
        Some(id) => id,
        None => return (None, None),
    };

    // Find input vault matching ID - match by VK+tag for deploy identity transition
    let input_vault = tx.ins.iter()
        .find_map(|(_, charms)| {
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, app) {
                    if let Ok(v) = data.value::<Vault>() {
                        if v.id == vault_id {
                            return Some(v);
                        }
                    }
                }
            }
            None
        });

    // Find output vault matching ID - match by VK+tag
    let output_vault = tx.outs.iter()
        .find_map(|charms| {
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, app) {
                    if let Ok(v) = data.value::<Vault>() {
                        if v.id == vault_id {
                            return Some(v);
                        }
                    }
                }
            }
            None
        });

    (input_vault, output_vault)
}

/// Minimal OracleState for price extraction
/// (avoids circular dependency on price-oracle crate)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct OracleStateMinimal {
    price: PriceData,
    #[serde(default)]
    is_active: bool,
    #[serde(default)]
    last_valid_price: u64,
}

/// Extract BTC price from public inputs or oracle reference
fn extract_btc_price(tx: &Transaction, x: &Data) -> Option<u64> {
    // First try public inputs as PriceData
    if let Ok(price_data) = x.value::<PriceData>() {
        return Some(price_data.price);
    }

    // Try public inputs as OracleState
    if let Ok(oracle) = x.value::<OracleStateMinimal>() {
        if oracle.is_active {
            return Some(oracle.price.price);
        }
    }

    // Then try to find oracle app in transaction
    for (_app, data) in tx.app_public_inputs.iter() {
        // Try as PriceData first
        if let Ok(price_data) = data.value::<PriceData>() {
            return Some(price_data.price);
        }
        // Try as OracleState
        if let Ok(oracle) = data.value::<OracleStateMinimal>() {
            if oracle.is_active {
                return Some(oracle.price.price);
            }
        }
    }

    // Also check reference inputs
    for (_, charms) in tx.refs.iter() {
        for (_, data) in charms.iter() {
            // Try as PriceData first
            if let Ok(price_data) = data.value::<PriceData>() {
                return Some(price_data.price);
            }
            // Try as OracleState (oracle charm contains nested PriceData)
            if let Ok(oracle) = data.value::<OracleStateMinimal>() {
                if oracle.is_active {
                    return Some(oracle.price.price);
                }
            }
        }
    }

    None
}

// ============ Flow Calculations ============

/// Calculate total BTC flowing in and out of transaction
fn calculate_btc_flows(tx: &Transaction) -> (u64, u64) {
    let inputs = tx.coin_ins
        .as_ref()
        .map(|ins| ins.iter().map(|o| o.amount).sum())
        .unwrap_or(0);

    let outputs = tx.coin_outs
        .as_ref()
        .map(|outs| outs.iter().map(|o| o.amount).sum())
        .unwrap_or(0);

    (inputs, outputs)
}

/// Calculate zkUSD token flows in transaction
fn calculate_zkusd_flows(tx: &Transaction, token_app_id: &[u8; 32]) -> (u64, u64) {
    let mut inputs: u64 = 0;
    let mut outputs: u64 = 0;

    // Sum token amounts from inputs - search by tag and identity
    for (_, charms) in tx.ins.iter() {
        for (app, data) in charms.iter() {
            // Match fungible token ('t' tag) with matching app_id
            if app.tag == 't' && app.identity.0 == *token_app_id {
                if let Ok(amount) = data.value::<u64>() {
                    inputs = inputs.saturating_add(amount);
                }
            }
        }
    }

    // Sum token amounts from outputs - search by tag and identity
    for charms in tx.outs.iter() {
        for (app, data) in charms.iter() {
            // Match fungible token ('t' tag) with matching app_id
            if app.tag == 't' && app.identity.0 == *token_app_id {
                if let Ok(amount) = data.value::<u64>() {
                    outputs = outputs.saturating_add(amount);
                }
            }
        }
    }

    (inputs, outputs)
}

/// Extract signer from transaction
fn extract_signer(tx: &Transaction) -> [u8; 32] {
    // In production, this would verify signatures and extract the signer
    // For now, we use the first input's owner as a proxy
    if let Some((_, charms)) = tx.ins.first() {
        for (_, data) in charms.iter() {
            if let Ok(vault) = data.value::<Vault>() {
                return vault.owner;
            }
        }
    }
    [0u8; 32]
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn create_test_witness() -> VaultWitness {
        VaultWitness::open_vault(100_000_000, 50_000_00000000)
    }

    #[test]
    fn test_witness_serialization() {
        let witness = create_test_witness();
        let data = Data::from(&witness);
        let parsed = parse_witness(&data).unwrap();

        assert_eq!(parsed.op, op::OPEN_VAULT);
        assert_eq!(parsed.collateral, Some(100_000_000));
        assert_eq!(parsed.debt, Some(50_000_00000000));
    }

    #[test]
    fn test_witness_to_action() {
        let witness = create_test_witness();
        let action = witness_to_action(&witness).unwrap();

        match action {
            VaultAction::OpenVault { collateral, debt } => {
                assert_eq!(collateral, 100_000_000);
                assert_eq!(debt, 50_000_00000000);
            }
            _ => panic!("Expected OpenVault action"),
        }
    }

    #[test]
    fn test_liquidate_witness() {
        let vault_id = [42u8; 32];
        let witness = VaultWitness::liquidate(vault_id);
        let action = witness_to_action(&witness).unwrap();

        match action {
            VaultAction::Liquidate { vault_id: id } => {
                assert_eq!(id, vault_id);
            }
            _ => panic!("Expected Liquidate action"),
        }
    }
}
