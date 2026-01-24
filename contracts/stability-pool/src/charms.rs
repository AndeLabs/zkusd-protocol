//! Charms SDK Integration for zkUSD Stability Pool
//!
//! This module bridges the Charms SDK types with the internal stability pool validation logic.
//!
//! ## UTXO Transformation Model (NOT Smart Contracts)
//!
//! The Stability Pool validates UTXO transformations - there is NO global state machine.
//! Each user's deposit is a charm in a UTXO that they control.
//!
//! ```text
//! Deposit:
//!   IN:  [zkUSD charm (user), StabilityPool state (ref)]
//!   OUT: [Deposit charm (new), StabilityPool state (updated)]
//!
//! Withdraw:
//!   IN:  [Deposit charm (user), StabilityPool state (ref)]
//!   OUT: [zkUSD charm (to user), BTC output (gains), Deposit charm (updated or spent)]
//!
//! ClaimBtc:
//!   IN:  [Deposit charm (user), StabilityPool state (ref)]
//!   OUT: [BTC output (gains), Deposit charm (updated snapshot)]
//!
//! Offset (called by VaultManager during liquidation):
//!   IN:  [StabilityPool state, BTC from liquidated vault]
//!   OUT: [StabilityPool state (updated P/S/total)]
//! ```
//!
//! ## Key Insight: Deposits as Individual Charms
//!
//! Unlike smart contracts where deposits are entries in a mapping, here each
//! deposit is a **separate UTXO** owned by the depositor. The pool state charm
//! only tracks aggregate values (total_zkusd, product_p, sum_s).
//!
//! This means:
//! - Users can validate their own deposit independently
//! - No indexer needed to track balances
//! - Deposits are spent and recreated atomically in transactions

use charms_data::{App, Data, Transaction, B32};
use crate::{StabilityPoolConfig, StabilityPoolContext, validate};
use zkusd_common::{
    events::EventLog,
    types::{Address, StabilityDeposit, StabilityPoolAction, StabilityPoolState},
};

// ============ Operation Codes ============

/// Operation codes for stability pool actions (encoded in witness)
pub mod op {
    /// Initialize stability pool (first-time creation)
    pub const INITIALIZE: u8 = 0x00;
    /// Deposit zkUSD into the stability pool
    pub const DEPOSIT: u8 = 0x20;
    /// Withdraw zkUSD from the stability pool
    pub const WITHDRAW: u8 = 0x21;
    /// Claim BTC rewards without withdrawing zkUSD
    pub const CLAIM_BTC: u8 = 0x22;
    /// Offset debt during liquidation (VaultManager only)
    pub const OFFSET: u8 = 0x23;
}

// ============ Witness Structures ============

/// Witness data for Initialize operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InitWitness {
    pub op: u8,
    /// zkUSD Token app_id
    pub zkusd_token_id: Address,
    /// VaultManager app_id (for offset authorization)
    pub vault_manager_id: Address,
    /// Admin address
    pub admin: Address,
}

/// Witness data for stability pool operations
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StabilityWitness {
    /// Operation type (see `op` module)
    pub op: u8,
    /// Amount for deposit/withdraw operations
    pub amount: Option<u64>,
    /// Debt amount for offset operations
    pub debt: Option<u64>,
    /// Collateral amount for offset operations
    pub collateral: Option<u64>,
}

impl StabilityWitness {
    /// Create witness for deposit operation
    pub fn deposit(amount: u64) -> Self {
        Self {
            op: op::DEPOSIT,
            amount: Some(amount),
            debt: None,
            collateral: None,
        }
    }

    /// Create witness for withdraw operation
    pub fn withdraw(amount: u64) -> Self {
        Self {
            op: op::WITHDRAW,
            amount: Some(amount),
            debt: None,
            collateral: None,
        }
    }

    /// Create witness for claiming BTC rewards
    pub fn claim_btc() -> Self {
        Self {
            op: op::CLAIM_BTC,
            amount: None,
            debt: None,
            collateral: None,
        }
    }

    /// Create witness for offset operation (called by VaultManager)
    pub fn offset(debt: u64, collateral: u64) -> Self {
        Self {
            op: op::OFFSET,
            amount: None,
            debt: Some(debt),
            collateral: Some(collateral),
        }
    }
}

// ============ Main Validation Function ============

/// Validates a stability pool operation within a Charms transaction.
///
/// This function verifies UTXO transformations follow protocol rules.
/// It does NOT execute state changes - it validates that the proposed
/// output state is correct given the inputs and operation.
///
/// ## Operations
///
/// - **Initialize**: Creates initial pool state (no input state required)
/// - **Deposit/Withdraw/ClaimBtc/Offset**: Requires existing pool state
///
/// # Cross-App Interactions
///
/// - **VaultManager**: Can call offset during liquidations
/// - **zkUSD Token**: Deposits/withdrawals involve token transfers
///
/// # Arguments
/// * `app` - The StabilityPool app definition
/// * `tx` - The transaction being validated
/// * `_x` - Public inputs (unused for stability pool)
/// * `w` - Witness data (operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn validate_stability_operation(
    app: &App,
    tx: &Transaction,
    _x: &Data,
    w: &Data,
) -> bool {
    // Check if this is an Initialize operation
    if let Some(init) = parse_init_witness(w) {
        // Handle Initialize specially (no input state required)
        let (output_config, output_state) = match extract_output_config_and_state(app, tx) {
            Some(s) => s,
            None => return false,
        };
        return validate_initialize(&output_config, &output_state, &init);
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

    // 3. Extract pool config from app identity
    let config = match extract_config(app, tx) {
        Some(c) => c,
        None => return false,
    };

    // 4. Extract pool states from transaction
    let (state, new_state) = match extract_pool_states(app, tx) {
        Some(s) => s,
        None => return false,
    };

    // 5. Extract user deposit (if applicable)
    let (deposit, new_deposit) = extract_deposits(app, tx);

    // 6. Calculate zkUSD flows
    let (zkusd_inputs, zkusd_outputs) = calculate_zkusd_flows(tx, &config.zkusd_token_id);

    // 7. Calculate BTC flows
    let (btc_inputs, btc_outputs) = calculate_btc_flows(tx);

    // 8. Check if called by another app (for offset authorization)
    let caller_app_id = extract_caller_app(tx, app);

    // 9. Get signer from transaction
    let signer = extract_signer(tx);

    // 10. Build validation context
    let mut ctx = StabilityPoolContext {
        state,
        new_state,
        config,
        deposit,
        new_deposit,
        zkusd_inputs,
        zkusd_outputs,
        btc_inputs,
        btc_outputs,
        caller_app_id,
        signer,
        block_height: 0, // Would be extracted from tx metadata
        events: EventLog::new(),
    };

    // 11. Run validation
    validate(&mut ctx, &action).is_ok()
}

// ============ Parsing Functions ============

/// Parse witness data to check if it's an Initialize operation
/// Supports both struct format and simple string (UTXO ID) format
fn parse_init_witness(w: &Data) -> Option<InitWitness> {
    // Try parsing as InitWitness struct first
    if let Ok(init) = w.value::<InitWitness>() {
        if init.op == op::INITIALIZE {
            return Some(init);
        }
    }
    // Try parsing as simple string (Charms template pattern)
    // For initialization, we derive parameters from output charm instead
    if w.value::<String>().is_ok() {
        // Return a placeholder InitWitness - actual values come from output charm
        return Some(InitWitness {
            op: op::INITIALIZE,
            zkusd_token_id: [0u8; 32],
            vault_manager_id: [0u8; 32],
            admin: [0u8; 32],
        });
    }
    None
}

/// Validate initialization of stability pool
fn validate_initialize(
    output_config: &StabilityPoolConfig,
    output_state: &StabilityPoolState,
    init: &InitWitness,
) -> bool {
    // If witness has placeholder values (from string pattern), only validate output state
    // Otherwise verify config matches initialization parameters
    let is_placeholder_witness = init.zkusd_token_id == [0u8; 32]
        && init.vault_manager_id == [0u8; 32]
        && init.admin == [0u8; 32];

    if !is_placeholder_witness {
        // Full validation with witness parameters
        if output_config.zkusd_token_id != init.zkusd_token_id {
            return false;
        }
        if output_config.vault_manager_id != init.vault_manager_id {
            return false;
        }
        if output_config.admin != init.admin {
            return false;
        }
    }
    // For placeholder witness, just validate output config is not all zeros
    else {
        if output_config.zkusd_token_id == [0u8; 32] {
            return false;
        }
        if output_config.vault_manager_id == [0u8; 32] {
            return false;
        }
        if output_config.admin == [0u8; 32] {
            return false;
        }
    }
    // Verify initial state is valid
    if output_state.total_zkusd != 0 {
        return false;
    }
    if output_state.total_btc != 0 {
        return false;
    }
    // product_p should be SCALE_FACTOR (1e18)
    if output_state.product_p != 1_000_000_000_000_000_000u128 {
        return false;
    }
    if output_state.sum_s != 0 {
        return false;
    }
    if output_state.current_epoch != 0 {
        return false;
    }
    if output_state.current_scale != 0 {
        return false;
    }
    if output_state.depositor_count != 0 {
        return false;
    }
    // Admin validation: for non-placeholder witnesses, admin cannot be zero
    // For placeholder witnesses, admin is always [0;32] so we skip this check
    if !is_placeholder_witness && init.admin == [0u8; 32] {
        return false;
    }
    true
}

/// Extract output config and state for Initialize operation
fn extract_output_config_and_state(
    app: &App,
    tx: &Transaction,
) -> Option<(StabilityPoolConfig, StabilityPoolState)> {
    // For Initialize, we need the output state
    // Support both: nested structure and flat structure
    for charms in tx.outs.iter() {
        if let Some(data) = charms.get(app) {
            // Try nested structure first
            if let Ok(combined) = data.value::<StabilityPoolOutput>() {
                return Some((combined.config, combined.state));
            }
            // Try flat structure (all fields at same level)
            if let Ok(flat) = data.value::<StabilityPoolFlat>() {
                let config = StabilityPoolConfig {
                    zkusd_token_id: flat.zkusd_token_id,
                    vault_manager_id: flat.vault_manager_id,
                    admin: flat.admin,
                };
                let state = StabilityPoolState {
                    total_zkusd: flat.total_zkusd,
                    total_btc: flat.total_btc,
                    product_p: flat.product_p,
                    sum_s: flat.sum_s,
                    current_epoch: flat.current_epoch,
                    current_scale: flat.current_scale,
                    depositor_count: flat.depositor_count,
                };
                return Some((config, state));
            }
        }
    }
    None
}

/// Combined output structure for stability pool charm (nested)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StabilityPoolOutput {
    pub config: StabilityPoolConfig,
    pub state: StabilityPoolState,
}

/// Flat output structure for stability pool charm (all fields at same level)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StabilityPoolFlat {
    // Config fields
    pub zkusd_token_id: [u8; 32],
    pub vault_manager_id: [u8; 32],
    pub admin: [u8; 32],
    // State fields
    pub total_zkusd: u64,
    pub total_btc: u64,
    pub product_p: u128,
    pub sum_s: u128,
    pub current_epoch: u64,
    pub current_scale: u64,
    pub depositor_count: u64,
}

/// Parse witness data into StabilityWitness
fn parse_witness(w: &Data) -> Option<StabilityWitness> {
    w.value::<StabilityWitness>().ok()
}

/// Convert witness to internal action type
fn witness_to_action(w: &StabilityWitness) -> Option<StabilityPoolAction> {
    match w.op {
        op::DEPOSIT => Some(StabilityPoolAction::Deposit {
            amount: w.amount?,
        }),
        op::WITHDRAW => Some(StabilityPoolAction::Withdraw {
            amount: w.amount?,
        }),
        op::CLAIM_BTC => Some(StabilityPoolAction::ClaimBtc),
        op::OFFSET => Some(StabilityPoolAction::Offset {
            debt: w.debt?,
            collateral: w.collateral?,
        }),
        _ => None,
    }
}

// ============ State Extraction ============

/// Extract pool configuration from app or transaction
fn extract_config(_app: &App, tx: &Transaction) -> Option<StabilityPoolConfig> {
    // Config could be stored in app identity or in a reference input
    // For now, look for it in reference inputs
    for (_, charms) in tx.refs.iter() {
        for (_, data) in charms.iter() {
            if let Ok(config) = data.value::<StabilityPoolConfig>() {
                return Some(config);
            }
        }
    }

    // Fallback: derive from app identity (would be encoded in app setup)
    None
}

/// Extract pool states from transaction inputs and outputs
fn extract_pool_states(
    app: &App,
    tx: &Transaction,
) -> Option<(StabilityPoolState, StabilityPoolState)> {
    // Input state from refs or ins
    let input_state = tx.refs.iter()
        .chain(tx.ins.iter())
        .find_map(|(_, charms)| {
            charms.get(app).and_then(|data| {
                data.value::<StabilityPoolState>().ok()
            })
        })?;

    // Output state
    let output_state = tx.outs.iter()
        .find_map(|charms| {
            charms.get(app).and_then(|data| {
                data.value::<StabilityPoolState>().ok()
            })
        })?;

    Some((input_state, output_state))
}

/// Extract user deposits from transaction
/// Returns (input_deposit, output_deposit)
fn extract_deposits(
    app: &App,
    tx: &Transaction,
) -> (Option<StabilityDeposit>, Option<StabilityDeposit>) {
    // Input deposit (being spent/updated)
    let input_deposit = tx.ins.iter()
        .find_map(|(_, charms)| {
            charms.get(app).and_then(|data| {
                data.value::<StabilityDeposit>().ok()
            })
        });

    // Output deposit (created/updated)
    let output_deposit = tx.outs.iter()
        .find_map(|charms| {
            charms.get(app).and_then(|data| {
                data.value::<StabilityDeposit>().ok()
            })
        });

    (input_deposit, output_deposit)
}

/// Extract caller app ID (for cross-app authorization)
fn extract_caller_app(tx: &Transaction, _current_app: &App) -> Option<[u8; 32]> {
    // In Charms, cross-app calls are detected by analyzing which apps
    // are involved in the same transaction. If VaultManager is also
    // validating this transaction, it's the caller.
    for (app, _) in tx.app_public_inputs.iter() {
        // Return the first other app found (in real impl, would be more specific)
        return Some(app.identity.0);
    }
    None
}

/// Extract signer from transaction
fn extract_signer(tx: &Transaction) -> Address {
    // In production, this would verify signatures and extract the signer
    // For now, we look for deposit owner in inputs
    for (_, charms) in tx.ins.iter() {
        for (_, data) in charms.iter() {
            if let Ok(deposit) = data.value::<StabilityDeposit>() {
                return deposit.owner;
            }
        }
    }
    [0u8; 32]
}

// ============ Flow Calculations ============

/// Calculate zkUSD token flows in transaction
fn calculate_zkusd_flows(tx: &Transaction, token_app_id: &[u8; 32]) -> (u64, u64) {
    let mut inputs: u64 = 0;
    let mut outputs: u64 = 0;

    // Create App key for lookup
    let token_app = App {
        tag: 't',
        identity: B32(*token_app_id),
        vk: B32([0u8; 32]), // VK not needed for lookup
    };

    // Sum token amounts from inputs
    for (_, charms) in tx.ins.iter() {
        if let Some(data) = charms.get(&token_app) {
            if let Ok(amount) = data.value::<u64>() {
                inputs = inputs.saturating_add(amount);
            }
        }
    }

    // Sum token amounts from outputs
    for charms in tx.outs.iter() {
        if let Some(data) = charms.get(&token_app) {
            if let Ok(amount) = data.value::<u64>() {
                outputs = outputs.saturating_add(amount);
            }
        }
    }

    (inputs, outputs)
}

/// Calculate total BTC flowing in and out
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

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_witness() -> StabilityWitness {
        StabilityWitness::deposit(1_000_00000000) // 1000 zkUSD
    }

    #[test]
    fn test_witness_serialization() {
        let witness = create_test_witness();
        let data = Data::from(&witness);
        let parsed = parse_witness(&data).unwrap();

        assert_eq!(parsed.op, op::DEPOSIT);
        assert_eq!(parsed.amount, Some(1_000_00000000));
    }

    #[test]
    fn test_witness_to_action() {
        let witness = create_test_witness();
        let action = witness_to_action(&witness).unwrap();

        match action {
            StabilityPoolAction::Deposit { amount } => {
                assert_eq!(amount, 1_000_00000000);
            }
            _ => panic!("Expected Deposit action"),
        }
    }

    #[test]
    fn test_offset_witness() {
        let witness = StabilityWitness::offset(
            10_000_00000000, // 10k zkUSD debt
            100_000_000,     // 1 BTC collateral
        );
        let action = witness_to_action(&witness).unwrap();

        match action {
            StabilityPoolAction::Offset { debt, collateral } => {
                assert_eq!(debt, 10_000_00000000);
                assert_eq!(collateral, 100_000_000);
            }
            _ => panic!("Expected Offset action"),
        }
    }

    #[test]
    fn test_claim_btc_witness() {
        let witness = StabilityWitness::claim_btc();
        let action = witness_to_action(&witness).unwrap();

        assert!(matches!(action, StabilityPoolAction::ClaimBtc));
    }
}
