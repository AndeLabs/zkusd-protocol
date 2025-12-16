//! zkUSD Vault Manager - Charms App Entry Point
//!
//! This app validates CDP (Collateralized Debt Position) operations on Bitcoin.
//!
//! ## Charm Types Managed
//!
//! - **Vault Charms**: Individual CDP positions (NFT-like, unique per vault)
//! - **Protocol State Charm**: Global protocol parameters (referenced/updated)
//!
//! ## Operations Validated
//!
//! - `OpenVault`: Create new CDP with collateral
//! - `CloseVault`: Repay all debt and withdraw collateral
//! - `AddCollateral`: Increase vault collateral
//! - `WithdrawCollateral`: Decrease vault collateral (if ICR allows)
//! - `MintDebt`: Borrow more zkUSD against collateral
//! - `RepayDebt`: Pay back zkUSD debt
//! - `Liquidate`: Liquidate underwater vault
//! - `Redeem`: Exchange zkUSD for BTC collateral
//!
//! ## UTXO Model
//!
//! Each operation transforms input UTXOs into output UTXOs:
//! ```text
//! INPUTS                    OUTPUTS
//! ├─ Vault charm     ────► ├─ Vault charm (updated)
//! ├─ BTC collateral        ├─ zkUSD tokens (minted)
//! └─ Protocol state  ────► └─ Protocol state (updated)
//! ```

use charms_sdk::data::{App, Data, Transaction};

/// Main validation function for Vault Manager operations.
///
/// This function is called by the Charms runtime to validate CDP operations.
/// It verifies that UTXO transformations follow protocol rules.
///
/// # Validation Rules
///
/// - **Collateralization**: ICR must stay above MCR (or CCR in Recovery Mode)
/// - **Debt Limits**: Minimum debt requirement, maximum per vault
/// - **Authorization**: Only vault owner can modify their vault
/// - **Conservation**: BTC and zkUSD must be properly accounted
///
/// # Arguments
/// * `app` - The VaultManager app definition
/// * `tx` - The transaction being validated
/// * `x` - Public inputs (price oracle data)
/// * `w` - Witness data (operation details)
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn app_contract(app: &App, tx: &Transaction, x: &Data, w: &Data) -> bool {
    zkusd_vault_manager::charms::validate_vault_operation(app, tx, x, w)
}

// Use the Charms SDK main macro to generate the entry point
charms_sdk::main!(app_contract);
