//! zkUSD Price Oracle - Charms App Entry Point
//!
//! This app validates price oracle operations on Bitcoin using client-side validation.
//!
//! ## What This App Validates
//!
//! - **UpdatePrice**: Operator publishes new BTC/USD price
//! - **SetOperator**: Admin changes the price operator
//!
//! ## Reference Input Pattern (NOT Consumed!)
//!
//! The oracle charm is designed as a **reference data source**:
//!
//! ```text
//! Transaction reading price:
//!   REFS: [Oracle charm]     <- Referenced, NOT spent
//!   INS:  [Vault charm, ...]
//!   OUTS: [Updated charms...]
//!
//! Transaction updating price:
//!   INS:  [Oracle charm]     <- Spent (only by operator)
//!   OUTS: [Oracle charm]     <- Recreated with new price
//! ```
//!
//! This means:
//! - Many transactions can reference the same oracle simultaneously
//! - Only the operator can update (spend + recreate) the oracle
//! - Price freshness is checked via block height

use charms_sdk::data::{App, Data, Transaction};

/// Main validation function for Price Oracle operations.
///
/// Validates that UTXO transformations follow protocol rules:
/// - Only operator can update price
/// - Price deviation is within limits
/// - New state correctly reflects the update
///
/// # Arguments
/// * `app` - The PriceOracle app definition
/// * `tx` - The transaction being validated
/// * `x` - Public inputs
/// * `w` - Witness data (operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn app_contract(app: &App, tx: &Transaction, x: &Data, w: &Data) -> bool {
    zkusd_price_oracle::charms::validate_oracle_operation(app, tx, x, w)
}

// Use the Charms SDK main macro to generate the entry point
charms_sdk::main!(app_contract);
