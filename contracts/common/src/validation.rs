//! Validation Helpers for zkUSD Protocol
//!
//! Centralized validation utilities following Charms v0.12 best practices.
//! Provides reusable validation macros and helper functions.
//!
//! ## Features
//!
//! - `check!` macro for cleaner validation code
//! - `token_amounts_balanced()` for zkUSD conservation
//! - Common validation helpers for cross-contract operations
//!
//! ## Usage
//!
//! ```rust,ignore
//! use zkusd_common::validation::{check, require_positive, token_amounts_balanced};
//!
//! // Using check! macro
//! check!(amount > 0, ZkUsdError::ZeroAmount)?;
//!
//! // Token conservation check
//! token_amounts_balanced(inputs, outputs, minted, burned)?;
//! ```

use crate::{
    errors::{ZkUsdError, ZkUsdResult},
    types::Address,
    Vec,
};

// ============ Validation Macro ============

/// Check a condition and return an error if it fails.
///
/// This macro provides cleaner validation code by combining the condition
/// check and error return in a single expression.
///
/// # Examples
///
/// ```rust,ignore
/// use zkusd_common::validation::check;
///
/// // Simple condition check
/// check!(amount > 0, ZkUsdError::ZeroAmount)?;
///
/// // With formatted error
/// check!(
///     icr >= min_ratio,
///     ZkUsdError::Undercollateralized {
///         current_ratio: icr,
///         required_ratio: min_ratio,
///     }
/// )?;
/// ```
#[macro_export]
macro_rules! check {
    ($condition:expr, $error:expr) => {
        if !($condition) {
            return Err($error);
        }
    };
}

pub use check;

// ============ Token Conservation ============

/// Validates that token amounts are balanced (conservation law).
///
/// For any valid spell: inputs + minted = outputs + burned
///
/// This is the fundamental conservation check for zkUSD tokens.
/// Every operation must maintain this invariant.
///
/// # Arguments
///
/// * `inputs` - Total zkUSD coming into the spell
/// * `outputs` - Total zkUSD going out of the spell
/// * `minted` - New zkUSD minted in this spell
/// * `burned` - zkUSD burned/destroyed in this spell
///
/// # Returns
///
/// * `Ok(())` if balanced
/// * `Err(ZkUsdError::ConservationViolated)` if not balanced
///
/// # Examples
///
/// ```rust,ignore
/// // Open vault: mint 1000 zkUSD
/// token_amounts_balanced(0, 1000, 1000, 0)?; // OK
///
/// // Close vault: burn 1000 zkUSD
/// token_amounts_balanced(1000, 0, 0, 1000)?; // OK
///
/// // Transfer: no mint/burn
/// token_amounts_balanced(1000, 1000, 0, 0)?; // OK
/// ```
pub fn token_amounts_balanced(
    inputs: u64,
    outputs: u64,
    minted: u64,
    burned: u64,
) -> ZkUsdResult<()> {
    let total_in = (inputs as u128).saturating_add(minted as u128);
    let total_out = (outputs as u128).saturating_add(burned as u128);

    if total_in != total_out {
        return Err(ZkUsdError::ConservationViolated {
            inputs: total_in as u64,
            outputs: total_out as u64,
        });
    }

    Ok(())
}

/// Sum token amounts from a list.
///
/// Useful for calculating total zkUSD in spell inputs/outputs.
///
/// # Arguments
///
/// * `amounts` - Slice of token amounts
///
/// # Returns
///
/// Sum of all amounts, saturating at u64::MAX
pub fn sum_token_amount(amounts: &[u64]) -> u64 {
    amounts.iter().fold(0u64, |acc, &x| acc.saturating_add(x))
}

/// Check that a token amount delta matches expected mint/burn.
///
/// # Arguments
///
/// * `inputs` - Total inputs
/// * `outputs` - Total outputs
/// * `expected_delta` - Expected (outputs - inputs), can be negative for burns
pub fn check_token_delta(inputs: u64, outputs: u64, expected_delta: i64) -> ZkUsdResult<()> {
    let actual_delta = (outputs as i64) - (inputs as i64);

    if actual_delta != expected_delta {
        return Err(ZkUsdError::ConservationViolated {
            inputs,
            outputs,
        });
    }

    Ok(())
}

// ============ Common Validation Helpers ============

/// Require a value to be positive (non-zero).
pub fn require_positive(value: u64, param: &'static str) -> ZkUsdResult<()> {
    if value == 0 {
        return Err(ZkUsdError::InvalidInput {
            param,
            reason: "Value must be positive",
        });
    }
    Ok(())
}

/// Require a value to be within a range (inclusive).
pub fn require_in_range(
    value: u64,
    min: u64,
    max: u64,
    _param: &'static str,
) -> ZkUsdResult<()> {
    if value < min {
        return Err(ZkUsdError::BelowMinimum {
            amount: value,
            minimum: min,
        });
    }
    if value > max {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: value,
            maximum: max,
        });
    }
    Ok(())
}

/// Require sufficient balance for an operation.
pub fn require_sufficient_balance(available: u64, requested: u64) -> ZkUsdResult<()> {
    if available < requested {
        return Err(ZkUsdError::InsufficientBalance {
            available,
            requested,
        });
    }
    Ok(())
}

/// Require the signer to be the owner.
pub fn require_owner(owner: Address, signer: Address) -> ZkUsdResult<()> {
    if owner != signer {
        return Err(ZkUsdError::Unauthorized {
            expected: owner,
            actual: signer,
        });
    }
    Ok(())
}

/// Require the signer to be the admin.
pub fn require_admin(admin: Address, signer: Address) -> ZkUsdResult<()> {
    if admin != signer {
        return Err(ZkUsdError::AdminOnly);
    }
    Ok(())
}

/// Require address to not be zero.
pub fn require_valid_address(address: Address, param: &'static str) -> ZkUsdResult<()> {
    if address == [0u8; 32] {
        return Err(ZkUsdError::InvalidAddress {
            reason: param,
        });
    }
    Ok(())
}

/// Require the protocol to not be paused.
pub fn require_not_paused(is_paused: bool) -> ZkUsdResult<()> {
    if is_paused {
        return Err(ZkUsdError::ProtocolPaused);
    }
    Ok(())
}

// ============ Collateral Ratio Helpers ============

/// Require ICR to meet minimum ratio.
pub fn require_min_icr(icr: u64, min_ratio: u64) -> ZkUsdResult<()> {
    if icr < min_ratio {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: icr,
            required_ratio: min_ratio,
        });
    }
    Ok(())
}

/// Require that an operation doesn't worsen TCR.
pub fn require_tcr_not_worsened(current_tcr: u64, new_tcr: u64) -> ZkUsdResult<()> {
    if new_tcr <= current_tcr {
        return Err(ZkUsdError::WouldWorsenTCR {
            current_tcr,
            new_tcr,
        });
    }
    Ok(())
}

/// Require vault to be liquidatable.
pub fn require_liquidatable(icr: u64, vault_id: [u8; 32], threshold: u64) -> ZkUsdResult<()> {
    if icr >= threshold {
        return Err(ZkUsdError::NotLiquidatable {
            vault_id,
            icr,
        });
    }
    Ok(())
}

// ============ State Transition Helpers ============

/// Verify a field value matches expected.
pub fn verify_field_eq<T: PartialEq>(actual: T, expected: T) -> ZkUsdResult<()> {
    if actual != expected {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    Ok(())
}

/// Verify state was properly updated with delta.
pub fn verify_state_delta(
    old_value: u64,
    new_value: u64,
    expected_delta: i64,
) -> ZkUsdResult<()> {
    let actual_new = if expected_delta >= 0 {
        old_value.saturating_add(expected_delta as u64)
    } else {
        old_value.saturating_sub((-expected_delta) as u64)
    };

    if new_value != actual_new {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    Ok(())
}

// ============ Cross-Contract Validation ============

/// Validation result for cross-contract calls.
#[derive(Debug, Clone)]
pub struct CrossContractValidation {
    /// Source contract app_id
    pub source_app_id: [u8; 32],
    /// Target contract app_id
    pub target_app_id: [u8; 32],
    /// Operation being validated
    pub operation: &'static str,
    /// Whether validation passed
    pub is_valid: bool,
}

/// Validate that a cross-contract call comes from an authorized source.
///
/// In Charms protocol, cross-contract calls are validated by checking
/// that the calling app_id is in the authorized list.
pub fn validate_cross_contract_call(
    caller_app_id: [u8; 32],
    authorized_callers: &[[u8; 32]],
    operation: &'static str,
) -> ZkUsdResult<CrossContractValidation> {
    let is_authorized = authorized_callers.iter().any(|&auth| auth == caller_app_id);

    if !is_authorized {
        return Err(ZkUsdError::Unauthorized {
            expected: authorized_callers.first().copied().unwrap_or([0u8; 32]),
            actual: caller_app_id,
        });
    }

    Ok(CrossContractValidation {
        source_app_id: caller_app_id,
        target_app_id: [0u8; 32], // Filled by caller
        operation,
        is_valid: true,
    })
}

// ============ Witness Data Structures ============

/// Standard witness structure for vault operations.
///
/// Witness data provides off-chain information that the ZK circuit
/// uses to validate state transitions without on-chain storage.
#[derive(Debug, Clone)]
pub struct VaultWitness {
    /// Vault ID being operated on
    pub vault_id: [u8; 32],
    /// Owner address
    pub owner: Address,
    /// Collateral amount (satoshis)
    pub collateral: u64,
    /// Debt amount (zkUSD with 8 decimals)
    pub debt: u64,
    /// BTC price at time of operation (8 decimals)
    pub btc_price: u64,
    /// Block height
    pub block_height: u64,
}

/// Standard witness structure for liquidation operations.
#[derive(Debug, Clone)]
pub struct LiquidationWitness {
    /// Vault being liquidated
    pub vault: VaultWitness,
    /// Liquidator address
    pub liquidator: Address,
    /// Amount of debt to liquidate
    pub debt_to_offset: u64,
    /// Collateral to distribute
    pub collateral_to_distribute: u64,
    /// Whether this is a full or partial liquidation
    pub is_full_liquidation: bool,
}

/// Standard witness structure for redemption operations.
#[derive(Debug, Clone)]
pub struct RedemptionWitness {
    /// zkUSD amount being redeemed
    pub zkusd_amount: u64,
    /// BTC price at time of redemption
    pub btc_price: u64,
    /// Vaults to redeem from (ordered by ICR, lowest first)
    pub vaults: Vec<VaultWitness>,
    /// Redeemer address
    pub redeemer: Address,
    /// Redemption fee rate (basis points)
    pub fee_rate_bps: u64,
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_amounts_balanced() {
        // Mint: 0 in, 1000 out, 1000 minted
        assert!(token_amounts_balanced(0, 1000, 1000, 0).is_ok());

        // Burn: 1000 in, 0 out, 1000 burned
        assert!(token_amounts_balanced(1000, 0, 0, 1000).is_ok());

        // Transfer: 1000 in, 1000 out
        assert!(token_amounts_balanced(1000, 1000, 0, 0).is_ok());

        // Invalid: 1000 in, 500 out (missing 500)
        assert!(token_amounts_balanced(1000, 500, 0, 0).is_err());
    }

    #[test]
    fn test_sum_token_amount() {
        assert_eq!(sum_token_amount(&[100, 200, 300]), 600);
        assert_eq!(sum_token_amount(&[]), 0);
        assert_eq!(sum_token_amount(&[u64::MAX, 1]), u64::MAX); // Saturates
    }

    #[test]
    fn test_require_positive() {
        assert!(require_positive(100, "amount").is_ok());
        assert!(require_positive(0, "amount").is_err());
    }

    #[test]
    fn test_require_in_range() {
        assert!(require_in_range(50, 0, 100, "value").is_ok());
        assert!(require_in_range(0, 0, 100, "value").is_ok());
        assert!(require_in_range(100, 0, 100, "value").is_ok());
        assert!(require_in_range(101, 0, 100, "value").is_err());
    }

    #[test]
    fn test_require_owner() {
        let owner = [1u8; 32];
        let signer = [1u8; 32];
        let other = [2u8; 32];

        assert!(require_owner(owner, signer).is_ok());
        assert!(require_owner(owner, other).is_err());
    }

    #[test]
    fn test_require_min_icr() {
        assert!(require_min_icr(150, 110).is_ok());
        assert!(require_min_icr(110, 110).is_ok());
        assert!(require_min_icr(100, 110).is_err());
    }

    #[test]
    fn test_verify_state_delta() {
        // Positive delta
        assert!(verify_state_delta(100, 150, 50).is_ok());
        assert!(verify_state_delta(100, 100, 50).is_err());

        // Negative delta
        assert!(verify_state_delta(100, 50, -50).is_ok());
        assert!(verify_state_delta(100, 100, -50).is_err());
    }

    #[test]
    fn test_check_macro() {
        fn test_check_positive(value: u64) -> ZkUsdResult<()> {
            check!(value > 0, ZkUsdError::ZeroAmount);
            Ok(())
        }

        assert!(test_check_positive(100).is_ok());
        assert!(test_check_positive(0).is_err());
    }

    #[test]
    fn test_cross_contract_validation() {
        let caller = [1u8; 32];
        let authorized = [[1u8; 32], [2u8; 32]];
        let unauthorized = [3u8; 32];

        assert!(validate_cross_contract_call(caller, &authorized, "mint").is_ok());
        assert!(validate_cross_contract_call(unauthorized, &authorized, "mint").is_err());
    }
}
