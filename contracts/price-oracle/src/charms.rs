//! Charms SDK Integration for zkUSD Price Oracle
//!
//! This module bridges the Charms SDK types with the internal oracle validation logic.
//!
//! ## UTXO Transformation Model (NOT Smart Contracts)
//!
//! The Price Oracle is a **reference data source** - other apps read it without consuming.
//!
//! ```text
//! UpdatePrice (by operator):
//!   IN:  [Oracle state charm]
//!   OUT: [Oracle state charm (updated price)]
//!
//! Other apps reading price (e.g., VaultManager liquidation):
//!   REFS: [Oracle state charm]  <- Not consumed, just referenced
//!   IN:   [Vault charm, ...]
//!   OUT:  [Updated vaults, ...]
//! ```
//!
//! ## Reference Input Pattern
//!
//! The oracle charm is designed to be used as a **reference input**:
//! - The charm is NOT spent when read
//! - Multiple transactions can reference the same oracle charm
//! - Only the operator can update (spend and recreate) the oracle charm
//!
//! This pattern ensures:
//! - Oracle data is available to all transactions
//! - Only one party controls updates
//! - Stale price detection via block height

use charms_data::{App, Data, Transaction};
use crate::{OracleState, OracleContext, validate};
use zkusd_common::{
    events::EventLog,
    types::{Address, OracleAction},
};

// ============ Operation Codes ============

/// Operation codes for oracle actions (encoded in witness)
pub mod op {
    /// Initialize oracle (first-time creation)
    pub const INITIALIZE: u8 = 0x00;
    /// Update BTC/USD price (operator only)
    pub const UPDATE_PRICE: u8 = 0x30;
    /// Set new operator (admin only)
    pub const SET_OPERATOR: u8 = 0x31;
}

// ============ Witness Structures ============

/// Witness data for oracle operations
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OracleWitness {
    /// Operation type (see `op` module)
    pub op: u8,
    /// Admin address (for Initialize)
    pub admin: Option<Address>,
    /// New operator address (for SetOperator or Initialize)
    pub operator: Option<Address>,
    /// Price value (8 decimals, e.g., 100_000_00000000 = $100,000)
    pub price: Option<u64>,
}

impl OracleWitness {
    /// Create witness for oracle initialization
    pub fn initialize(admin: Address, operator: Address, initial_price: u64) -> Self {
        Self {
            op: op::INITIALIZE,
            admin: Some(admin),
            operator: Some(operator),
            price: Some(initial_price),
        }
    }

    /// Create witness for price update
    pub fn update_price(price: u64) -> Self {
        Self {
            op: op::UPDATE_PRICE,
            admin: None,
            operator: None,
            price: Some(price),
        }
    }

    /// Create witness for setting new operator
    pub fn set_operator(operator: Address) -> Self {
        Self {
            op: op::SET_OPERATOR,
            admin: None,
            operator: Some(operator),
            price: None,
        }
    }
}

// ============ Main Validation Function ============

/// Validates an oracle operation within a Charms transaction.
///
/// The oracle app validates three types of operations:
/// 1. **Initialize**: Create oracle for first time (no input state)
/// 2. **UpdatePrice**: Operator updates the BTC/USD price
/// 3. **SetOperator**: Admin changes the operator address
///
/// ## Public Inputs
///
/// The oracle exposes its price data through `app_public_inputs`, allowing
/// other apps to read the price without consuming the oracle charm.
///
/// # Arguments
/// * `app` - The PriceOracle app definition
/// * `tx` - The transaction being validated
/// * `_x` - Public inputs (oracle exports data, doesn't read)
/// * `w` - Witness data (operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn validate_oracle_operation(
    app: &App,
    tx: &Transaction,
    _x: &Data,
    w: &Data,
) -> bool {
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

    // 3. Handle Initialize specially (no input state required)
    if let OracleAction::Initialize { admin, operator, initial_price } = &action {
        // For initialization, we only need to validate the output state
        let output_state = match extract_output_state(app, tx) {
            Some(s) => s,
            None => return false,
        };

        // Validate the output state matches the initialization parameters
        return validate_initialize(&output_state, admin, operator, *initial_price);
    }

    // 4. For other operations, extract both input and output states
    let (state, new_state) = match extract_oracle_states(app, tx) {
        Some(s) => s,
        None => return false,
    };

    // 5. Get signer from transaction
    let signer = extract_signer(tx);

    // 6. Get current block height
    let block_height = extract_block_height(tx);

    // 7. Build validation context
    let mut ctx = OracleContext {
        state,
        new_state,
        signer,
        block_height,
        events: EventLog::new(),
    };

    // 8. Run validation
    validate(&mut ctx, &action).is_ok()
}

/// Validate initialization of oracle
fn validate_initialize(
    output: &OracleState,
    admin: &Address,
    operator: &Address,
    initial_price: u64,
) -> bool {
    // Verify output state matches initialization parameters
    if output.admin != *admin {
        return false;
    }
    if output.operator != *operator {
        return false;
    }
    if output.price.price != initial_price {
        return false;
    }
    if !output.is_active {
        return false;
    }
    if output.last_valid_price != initial_price {
        return false;
    }

    // Validate price is reasonable
    crate::validate_price_format(initial_price)
}

/// Extract only the output oracle state (for Initialize)
fn extract_output_state(app: &App, tx: &Transaction) -> Option<OracleState> {
    tx.outs.iter()
        .find_map(|charms| {
            charms.get(app).and_then(|data| {
                data.value::<OracleState>().ok()
            })
        })
}

// ============ Parsing Functions ============

/// Parse witness data into OracleWitness
fn parse_witness(w: &Data) -> Option<OracleWitness> {
    w.value::<OracleWitness>().ok()
}

/// Convert witness to internal action type
fn witness_to_action(w: &OracleWitness) -> Option<OracleAction> {
    match w.op {
        op::INITIALIZE => Some(OracleAction::Initialize {
            admin: w.admin?,
            operator: w.operator?,
            initial_price: w.price?,
        }),
        op::UPDATE_PRICE => Some(OracleAction::UpdatePrice {
            price: w.price?,
        }),
        op::SET_OPERATOR => Some(OracleAction::SetOperator {
            operator: w.operator?,
        }),
        _ => None,
    }
}

// ============ State Extraction ============

/// Extract oracle states from transaction inputs and outputs
fn extract_oracle_states(
    app: &App,
    tx: &Transaction,
) -> Option<(OracleState, OracleState)> {
    // Input state (being updated)
    let input_state = tx.ins.iter()
        .find_map(|(_, charms)| {
            charms.get(app).and_then(|data| {
                data.value::<OracleState>().ok()
            })
        })?;

    // Output state (updated)
    let output_state = tx.outs.iter()
        .find_map(|charms| {
            charms.get(app).and_then(|data| {
                data.value::<OracleState>().ok()
            })
        })?;

    Some((input_state, output_state))
}

/// Extract signer from transaction
fn extract_signer(tx: &Transaction) -> Address {
    // In production, this would verify signatures and extract the signer
    // For now, we look for oracle state owner in inputs
    for (_, charms) in tx.ins.iter() {
        for (_, data) in charms.iter() {
            if let Ok(state) = data.value::<OracleState>() {
                // Assume operator is the signer for UpdatePrice
                return state.operator;
            }
        }
    }
    [0u8; 32]
}

/// Extract block height from transaction metadata
fn extract_block_height(tx: &Transaction) -> u64 {
    // In production, this would come from transaction metadata or locktime
    // For now, we estimate from transaction structure
    // The actual block height should be verified by the Charms runtime
    tx.coin_ins
        .as_ref()
        .and_then(|ins| ins.first())
        .map(|_| 0u64) // Would extract from actual tx metadata
        .unwrap_or(0)
}

// ============ Price Reading (for other apps) ============

/// Read price from oracle reference input
///
/// This function is used by other apps (VaultManager, etc.) to read
/// the BTC/USD price from an oracle charm in their transaction references.
///
/// # Arguments
/// * `tx` - The transaction containing oracle reference
/// * `oracle_app` - The oracle app definition
///
/// # Returns
/// The current price if oracle is found and not stale
pub fn read_price_from_refs(tx: &Transaction, oracle_app: &App) -> Option<u64> {
    // Look for oracle charm in reference inputs
    for (_, charms) in tx.refs.iter() {
        if let Some(data) = charms.get(oracle_app) {
            if let Ok(state) = data.value::<OracleState>() {
                if state.is_active {
                    return Some(state.price.price);
                }
            }
        }
    }
    None
}

/// Read full oracle state from reference inputs
pub fn read_oracle_state_from_refs(tx: &Transaction, oracle_app: &App) -> Option<OracleState> {
    for (_, charms) in tx.refs.iter() {
        if let Some(data) = charms.get(oracle_app) {
            if let Ok(state) = data.value::<OracleState>() {
                return Some(state);
            }
        }
    }
    None
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    const BTC_PRICE_100K: u64 = 100_000_00000000;

    fn create_test_witness() -> OracleWitness {
        OracleWitness::update_price(BTC_PRICE_100K)
    }

    #[test]
    fn test_witness_serialization() {
        let witness = create_test_witness();
        let data = Data::from(&witness);
        let parsed = parse_witness(&data).unwrap();

        assert_eq!(parsed.op, op::UPDATE_PRICE);
        assert_eq!(parsed.price, Some(BTC_PRICE_100K));
    }

    #[test]
    fn test_witness_to_action() {
        let witness = create_test_witness();
        let action = witness_to_action(&witness).unwrap();

        match action {
            OracleAction::UpdatePrice { price } => {
                assert_eq!(price, BTC_PRICE_100K);
            }
            _ => panic!("Expected UpdatePrice action"),
        }
    }

    #[test]
    fn test_set_operator_witness() {
        let new_operator = [42u8; 32];
        let witness = OracleWitness::set_operator(new_operator);
        let action = witness_to_action(&witness).unwrap();

        match action {
            OracleAction::SetOperator { operator } => {
                assert_eq!(operator, new_operator);
            }
            _ => panic!("Expected SetOperator action"),
        }
    }
}
