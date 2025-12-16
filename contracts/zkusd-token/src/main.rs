//! zkUSD Token - Charms App Entry Point
//!
//! This binary is the entry point for the zkUSD Token when running
//! as a Charms application on Bitcoin.

use charms_sdk::data::{App, Data, Transaction};

/// Main validation function for zkUSD Token operations.
///
/// This function is called by the Charms runtime to validate token
/// operations (transfer, mint, burn).
///
/// # Arguments
/// * `app` - The zkUSD Token app definition
/// * `tx` - The transaction being validated
/// * `x` - Public input data (empty for token operations)
/// * `w` - Witness data (contains operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn app_contract(app: &App, tx: &Transaction, x: &Data, w: &Data) -> bool {
    // Delegate to the library implementation
    zkusd_token::charms::validate_token_operation(app, tx, x, w)
}

// Use the Charms SDK main macro to generate the entry point
charms_sdk::main!(app_contract);
