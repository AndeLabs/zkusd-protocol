//! zkUSD Stability Pool - Charms App Entry Point
//!
//! This app validates Stability Pool operations on Bitcoin using client-side validation.
//!
//! ## What This App Validates
//!
//! - **Deposit**: User moves zkUSD into the pool, receives deposit charm
//! - **Withdraw**: User redeems deposit charm for zkUSD + BTC gains
//! - **ClaimBtc**: User claims accumulated BTC rewards
//! - **Offset**: VaultManager absorbs liquidation debt (cross-app call)
//!
//! ## UTXO Model (Not Smart Contracts!)
//!
//! Each deposit is an **individual UTXO** owned by the depositor:
//!
//! ```text
//! User's Wallet:
//! ├─ UTXO with zkUSD charm (before deposit)
//! └─ UTXO with Deposit charm (after deposit)
//!
//! Pool State UTXO:
//! └─ Single charm tracking: total_zkusd, product_p, sum_s
//! ```
//!
//! The pool state only tracks aggregate values. Individual balances
//! are computed from each user's deposit charm + pool snapshots.

use charms_sdk::data::{App, Data, Transaction};

/// Main validation function for Stability Pool operations.
///
/// Validates that UTXO transformations follow protocol rules:
/// - Deposits add to pool total, create deposit charm with snapshot
/// - Withdrawals compute compounded value using P snapshots
/// - BTC gains are computed using S snapshots
/// - Offsets are only valid when called by VaultManager
///
/// # Arguments
/// * `app` - The StabilityPool app definition
/// * `tx` - The transaction being validated
/// * `x` - Public inputs
/// * `w` - Witness data (operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn app_contract(app: &App, tx: &Transaction, x: &Data, w: &Data) -> bool {
    zkusd_stability_pool::charms::validate_stability_operation(app, tx, x, w)
}

// Use the Charms SDK main macro to generate the entry point
charms_sdk::main!(app_contract);
