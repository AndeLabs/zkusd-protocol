//! Mathematical Utilities for zkUSD Protocol
//!
//! Safe math operations and financial calculations.

use crate::errors::{ZkUsdError, ZkUsdResult};
use crate::constants::{precision, ratios, token, fees};

/// Calculate Individual Collateral Ratio (ICR)
///
/// ICR = (collateral_value_usd * 100) / debt
///
/// # Arguments
/// * `collateral_sats` - Collateral in satoshis
/// * `debt` - Debt in zkUSD base units (8 decimals)
/// * `btc_price` - BTC price in USD with 8 decimals
///
/// # Returns
/// ICR as a percentage (e.g., 150 = 150%)
pub fn calculate_icr(collateral_sats: u64, debt: u64, btc_price: u64) -> ZkUsdResult<u64> {
    if debt == 0 {
        return Ok(u64::MAX); // Infinite ratio for zero debt
    }

    // collateral_value_usd = collateral_sats * btc_price / 1e8
    let collateral_value = (collateral_sats as u128)
        .checked_mul(btc_price as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(token::ONE as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    // ICR = collateral_value * 100 / debt
    let icr = collateral_value
        .checked_mul(precision::PERCENT_PRECISION as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(debt as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    // Cap at u64::MAX if somehow exceeds
    Ok(icr.min(u64::MAX as u128) as u64)
}

/// Calculate Total Collateral Ratio (TCR) for the entire system
pub fn calculate_tcr(total_collateral: u64, total_debt: u64, btc_price: u64) -> ZkUsdResult<u64> {
    calculate_icr(total_collateral, total_debt, btc_price)
}

/// Check if a vault is liquidatable
///
/// # Arguments
/// * `icr` - Vault's ICR
/// * `tcr` - System's TCR (for Recovery Mode check)
///
/// # Returns
/// true if vault can be liquidated
pub fn is_liquidatable(icr: u64, tcr: u64) -> bool {
    let threshold = if tcr < ratios::CCR {
        // Recovery Mode: liquidate if ICR < CCR
        ratios::CCR
    } else {
        // Normal Mode: liquidate if ICR < MCR
        ratios::MCR
    };

    icr < threshold
}

/// Check if system is in Recovery Mode
pub fn is_recovery_mode(tcr: u64) -> bool {
    tcr < ratios::CCR
}

/// Get minimum collateral ratio based on mode
pub fn get_min_ratio(tcr: u64) -> u64 {
    if is_recovery_mode(tcr) {
        ratios::CCR
    } else {
        ratios::MCR
    }
}

/// Calculate borrowing fee
///
/// # Arguments
/// * `debt` - Debt amount in zkUSD base units
/// * `base_rate` - Current base rate in basis points
///
/// # Returns
/// Fee amount in zkUSD base units
pub fn calculate_borrowing_fee(debt: u64, base_rate: u64) -> ZkUsdResult<u64> {
    // fee_rate = clamp(base_rate, MIN_FEE, MAX_FEE)
    let fee_rate = base_rate
        .max(fees::MIN_BORROWING_FEE_BPS)
        .min(fees::MAX_BORROWING_FEE_BPS);

    // fee = debt * fee_rate / 10000
    let fee = (debt as u128)
        .checked_mul(fee_rate as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(fees::BPS_DENOMINATOR as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    Ok(fee as u64)
}

/// Calculate redemption fee (variable rate - Liquity style)
///
/// # Arguments
/// * `redeemed_amount` - Amount being redeemed in zkUSD
/// * `base_rate` - Current base rate in basis points
///
/// # Returns
/// Fee amount in zkUSD base units
pub fn calculate_redemption_fee(redeemed_amount: u64, base_rate: u64) -> ZkUsdResult<u64> {
    // fee_rate = max(FLOOR, base_rate)
    let fee_rate = base_rate.max(fees::REDEMPTION_FEE_FLOOR_BPS);

    let fee = (redeemed_amount as u128)
        .checked_mul(fee_rate as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(fees::BPS_DENOMINATOR as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    Ok(fee as u64)
}

/// Calculate fixed redemption fee (Mezo style - simpler, more predictable)
///
/// Uses a fixed 0.75% fee regardless of base rate.
/// This is more predictable for users and simpler to understand.
///
/// # Arguments
/// * `redeemed_amount` - Amount being redeemed in zkUSD
///
/// # Returns
/// Fee amount in zkUSD base units (0.75% of redeemed amount)
pub fn calculate_redemption_fee_fixed(redeemed_amount: u64) -> ZkUsdResult<u64> {
    let fee = (redeemed_amount as u128)
        .checked_mul(fees::REDEMPTION_FEE_FIXED_BPS as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(fees::BPS_DENOMINATOR as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    Ok(fee as u64)
}

/// Calculate maximum debt for given collateral
///
/// max_debt = collateral_value * 100 / MCR
pub fn max_debt_for_collateral(collateral_sats: u64, btc_price: u64) -> ZkUsdResult<u64> {
    // collateral_value_usd = collateral_sats * btc_price / 1e8
    let collateral_value = (collateral_sats as u128)
        .checked_mul(btc_price as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(token::ONE as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    // max_debt = collateral_value * 100 / MCR
    let max_debt = collateral_value
        .checked_mul(precision::PERCENT_PRECISION as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(ratios::MCR as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    Ok(max_debt as u64)
}

/// Calculate minimum collateral for given debt
///
/// min_collateral = debt * MCR / 100 / btc_price * 1e8
pub fn min_collateral_for_debt(debt: u64, btc_price: u64) -> ZkUsdResult<u64> {
    if btc_price == 0 {
        return Err(ZkUsdError::DivisionByZero);
    }

    // Required USD value = debt * MCR / 100
    let required_usd = (debt as u128)
        .checked_mul(ratios::MCR as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(precision::PERCENT_PRECISION as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    // min_collateral = required_usd * 1e8 / btc_price
    let min_collateral = required_usd
        .checked_mul(token::ONE as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(btc_price as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    Ok(min_collateral as u64)
}

/// Calculate compounded deposit value in Stability Pool
///
/// Based on Liquity's scaled sum algorithm.
///
/// # Arguments
/// * `initial_deposit` - Original deposit amount
/// * `snapshot_p` - P value at deposit time (must be > 0)
/// * `current_p` - Current P value
/// * `snapshot_scale` - Scale at deposit time
/// * `current_scale` - Current scale
/// * `snapshot_epoch` - Epoch at deposit time
/// * `current_epoch` - Current epoch
///
/// # Returns
/// Compounded deposit value, or 0 if deposit was depleted by epoch change
/// or if more than 1 scale change occurred.
pub fn calculate_compounded_deposit(
    initial_deposit: u64,
    snapshot_p: u128,
    current_p: u128,
    snapshot_scale: u64,
    current_scale: u64,
    snapshot_epoch: u64,
    current_epoch: u64,
) -> u64 {
    // If epoch changed, deposit was fully depleted by a liquidation
    // that zeroed the pool - this is expected behavior, not an error
    if current_epoch > snapshot_epoch {
        return 0;
    }

    // Validate snapshot_p is not zero (would indicate corrupt state)
    if snapshot_p == 0 {
        // This should never happen in production - indicates corrupt state
        // Return 0 rather than panicking to allow graceful degradation
        return 0;
    }

    let scale_factor = crate::constants::stability_pool::SCALE_FACTOR;

    // Calculate scale difference
    let scale_diff = current_scale.saturating_sub(snapshot_scale);

    // Calculate P ratio with scale adjustment
    let p_ratio = if scale_diff == 0 {
        // Same scale: simple ratio
        current_p
            .saturating_mul(scale_factor)
            / snapshot_p // Safe: snapshot_p validated above
    } else if scale_diff == 1 {
        // One scale change: additional division needed
        current_p
            .saturating_mul(scale_factor)
            / snapshot_p // Safe: snapshot_p validated above
            / scale_factor // Safe: scale_factor is constant > 0
    } else {
        // More than 1 scale change = deposit effectively zeroed
        // This happens when pool size decreased dramatically
        0
    };

    // compounded = initial * p_ratio / SCALE_FACTOR
    // Safe: scale_factor is constant > 0
    let result = (initial_deposit as u128)
        .saturating_mul(p_ratio)
        / scale_factor;

    // Safe truncation: result will always fit in u64 due to the division
    result.min(u64::MAX as u128) as u64
}

/// Calculate BTC gain from Stability Pool
///
/// Calculates the accumulated BTC rewards for a depositor based on
/// their initial deposit and the change in S (cumulative reward per unit).
///
/// # Arguments
/// * `initial_deposit` - Original deposit amount
/// * `snapshot_s` - S value at deposit/last claim time
/// * `current_s` - Current S value
///
/// # Returns
/// BTC gain in satoshis
pub fn calculate_btc_gain(
    initial_deposit: u64,
    snapshot_s: u128,
    current_s: u128,
) -> u64 {
    let scale_factor = crate::constants::stability_pool::SCALE_FACTOR;

    // Calculate difference in S (cumulative reward per unit)
    let s_diff = current_s.saturating_sub(snapshot_s);

    // gain = initial * s_diff / SCALE_FACTOR
    // Safe: SCALE_FACTOR is a constant > 0
    let result = (initial_deposit as u128)
        .saturating_mul(s_diff)
        / scale_factor;

    // Safe truncation: result will always fit in u64 due to the division
    result.min(u64::MAX as u128) as u64
}

/// Safe addition with overflow check
pub fn safe_add(a: u64, b: u64) -> ZkUsdResult<u64> {
    a.checked_add(b).ok_or(ZkUsdError::Overflow)
}

/// Safe subtraction with underflow check
pub fn safe_sub(a: u64, b: u64) -> ZkUsdResult<u64> {
    a.checked_sub(b).ok_or(ZkUsdError::Underflow)
}

/// Safe multiplication with overflow check
pub fn safe_mul(a: u64, b: u64) -> ZkUsdResult<u128> {
    (a as u128).checked_mul(b as u128).ok_or(ZkUsdError::Overflow)
}

/// Safe division with zero check
pub fn safe_div(a: u128, b: u64) -> ZkUsdResult<u64> {
    if b == 0 {
        return Err(ZkUsdError::DivisionByZero);
    }
    Ok((a / b as u128) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BTC_PRICE_100K: u64 = 100_000_00000000; // $100,000
    const ONE_BTC: u64 = 100_000_000; // 1 BTC in sats
    const ONE_ZKUSD: u64 = 100_000_000; // 1 zkUSD

    #[test]
    fn test_icr_calculation() {
        // 1 BTC ($100k) backing 50k zkUSD = 200% ICR
        let icr = calculate_icr(ONE_BTC, 50_000 * ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, 200);

        // 1 BTC backing 100k zkUSD = 100% ICR
        let icr = calculate_icr(ONE_BTC, 100_000 * ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, 100);

        // 1.5 BTC backing 100k zkUSD = 150% ICR
        let icr = calculate_icr(150_000_000, 100_000 * ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, 150);
    }

    #[test]
    fn test_icr_zero_debt() {
        let icr = calculate_icr(ONE_BTC, 0, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, u64::MAX);
    }

    #[test]
    fn test_liquidatable() {
        // Normal mode (TCR = 200%)
        assert!(is_liquidatable(105, 200)); // Below MCR
        assert!(is_liquidatable(109, 200)); // Just below MCR
        assert!(!is_liquidatable(110, 200)); // At MCR
        assert!(!is_liquidatable(150, 200)); // Above MCR

        // Recovery mode (TCR = 140%)
        assert!(is_liquidatable(105, 140)); // Below MCR
        assert!(is_liquidatable(140, 140)); // Below CCR
        assert!(is_liquidatable(149, 140)); // Just below CCR
        assert!(!is_liquidatable(150, 140)); // At CCR
        assert!(!is_liquidatable(200, 140)); // Above CCR
    }

    #[test]
    fn test_recovery_mode() {
        assert!(!is_recovery_mode(200)); // Healthy
        assert!(!is_recovery_mode(150)); // At threshold
        assert!(is_recovery_mode(149));  // Below threshold
        assert!(is_recovery_mode(100));  // Critical
    }

    #[test]
    fn test_borrowing_fee() {
        // 100,000 zkUSD at 0.5% = 500 zkUSD fee
        let fee = calculate_borrowing_fee(100_000 * ONE_ZKUSD, 50).unwrap();
        assert_eq!(fee, 500 * ONE_ZKUSD);

        // With higher base rate (1%)
        let fee = calculate_borrowing_fee(100_000 * ONE_ZKUSD, 100).unwrap();
        assert_eq!(fee, 1_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_max_debt_for_collateral() {
        // 1 BTC at $100k with 110% MCR = max ~90,909 zkUSD
        let max_debt = max_debt_for_collateral(ONE_BTC, BTC_PRICE_100K).unwrap();
        assert_eq!(max_debt, 90909_09090909); // ~90,909 zkUSD
    }

    #[test]
    fn test_min_collateral_for_debt() {
        // 50,000 zkUSD needs at least 0.55 BTC at $100k (110% MCR)
        let min_coll = min_collateral_for_debt(50_000 * ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        assert_eq!(min_coll, 55_000_000); // 0.55 BTC
    }

    #[test]
    fn test_redemption_fee_fixed() {
        // Fixed 0.75% fee (Mezo style)
        // 100,000 zkUSD * 0.75% = 750 zkUSD
        let fee = calculate_redemption_fee_fixed(100_000 * ONE_ZKUSD).unwrap();
        assert_eq!(fee, 750 * ONE_ZKUSD);

        // 10,000 zkUSD * 0.75% = 75 zkUSD
        let fee = calculate_redemption_fee_fixed(10_000 * ONE_ZKUSD).unwrap();
        assert_eq!(fee, 75 * ONE_ZKUSD);

        // 1,000,000 zkUSD * 0.75% = 7,500 zkUSD
        let fee = calculate_redemption_fee_fixed(1_000_000 * ONE_ZKUSD).unwrap();
        assert_eq!(fee, 7_500 * ONE_ZKUSD);
    }

    #[test]
    fn test_redemption_fee_variable_vs_fixed() {
        let amount = 100_000 * ONE_ZKUSD;

        // Variable fee with base_rate = 0 uses floor (0.5%)
        let var_fee = calculate_redemption_fee(amount, 0).unwrap();
        assert_eq!(var_fee, 500 * ONE_ZKUSD); // 0.5%

        // Fixed fee is always 0.75%
        let fixed_fee = calculate_redemption_fee_fixed(amount).unwrap();
        assert_eq!(fixed_fee, 750 * ONE_ZKUSD); // 0.75%

        // Fixed is more predictable but slightly higher
        assert!(fixed_fee > var_fee);
    }
}
