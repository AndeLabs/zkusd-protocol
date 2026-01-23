//! Unit tests for zkUSD protocol logic
//!
//! Tests cover:
//! - ICR calculations
//! - Liquidation conditions
//! - Fee calculations
//! - Stability Pool math

#[cfg(test)]
mod icr_tests {
    use crate::constants::ratios::{MCR, CCR};

    // Convert percentage to basis points for comparisons
    const MCR_BPS: u64 = MCR * 100; // 110 * 100 = 11000
    const CCR_BPS: u64 = CCR * 100; // 150 * 100 = 15000
    
    /// Calculate ICR in basis points
    /// ICR = (collateral_value / debt) * 10000
    fn calculate_icr(collateral_sats: u64, debt: u64, btc_price: u64) -> u64 {
        if debt == 0 {
            return u64::MAX;
        }
        // collateral_value = collateral_sats * btc_price / 1e8
        // ICR = collateral_value / debt * 10000
        // ICR = (collateral_sats * btc_price) / (debt * 1e8) * 10000
        // To avoid overflow: (collateral_sats * btc_price * 10000) / (debt * 1e8)
        let collateral_value = (collateral_sats as u128) * (btc_price as u128);
        let icr = (collateral_value * 10000) / ((debt as u128) * 100_000_000);
        icr as u64
    }
    
    #[test]
    fn test_icr_at_110_percent() {
        // 1 BTC at $100,000, debt of ~$90,909
        let collateral = 100_000_000; // 1 BTC in sats
        let btc_price = 100_000_00000000u64; // $100,000 with 8 decimals
        let debt = 90_909_00000000u64; // ~$90,909 with 8 decimals
        
        let icr = calculate_icr(collateral, debt, btc_price);
        assert!(icr >= 11000, "ICR should be >= 110%: got {}bps", icr);
    }
    
    #[test]
    fn test_icr_below_mcr() {
        // 1 BTC at $100,000, debt of $100,000 (ICR = 100%)
        let collateral = 100_000_000;
        let btc_price = 100_000_00000000u64;
        let debt = 100_000_00000000u64;
        
        let icr = calculate_icr(collateral, debt, btc_price);
        assert!(icr < MCR_BPS, "ICR should be < MCR: got {}bps", icr);
    }
    
    #[test]
    fn test_icr_safe_at_200_percent() {
        // 1 BTC at $100,000, debt of $50,000 (ICR = 200%)
        let collateral = 100_000_000;
        let btc_price = 100_000_00000000u64;
        let debt = 50_000_00000000u64;
        
        let icr = calculate_icr(collateral, debt, btc_price);
        assert_eq!(icr, 20000, "ICR should be 200%: got {}bps", icr);
    }
    
    #[test]
    fn test_small_vault_icr() {
        // 50,000 sats at $104,000, debt of 40 zkUSD
        let collateral = 50_000; // 50k sats
        let btc_price = 104_000_00000000u64; // $104,000
        let debt = 40_00000000u64; // 40 zkUSD
        
        let icr = calculate_icr(collateral, debt, btc_price);
        // Expected: (50000 * 104000) / 40 / 1e8 * 10000 = 13000 (130%)
        assert!(icr >= 13000, "ICR should be ~130%: got {}bps", icr);
    }
}

#[cfg(test)]
mod liquidation_tests {
    use crate::constants::ratios::MCR;

    // Convert percentage to basis points for comparisons
    const MCR_BPS: u64 = MCR * 100; // 110 * 100 = 11000
    
    fn is_liquidatable(icr_bps: u64, is_recovery_mode: bool) -> bool {
        if is_recovery_mode {
            icr_bps < 15000 // CCR = 150%
        } else {
            icr_bps < MCR_BPS // MCR = 110%
        }
    }
    
    #[test]
    fn test_liquidatable_below_mcr() {
        assert!(is_liquidatable(10900, false)); // 109% < 110%
        assert!(is_liquidatable(10000, false)); // 100% < 110%
    }
    
    #[test]
    fn test_not_liquidatable_above_mcr() {
        assert!(!is_liquidatable(11000, false)); // 110% = MCR
        assert!(!is_liquidatable(15000, false)); // 150%
    }
    
    #[test]
    fn test_recovery_mode_liquidation() {
        // In recovery mode, CCR (150%) is used
        assert!(is_liquidatable(14900, true)); // 149% < 150%
        assert!(!is_liquidatable(15000, true)); // 150% = CCR
    }
}

#[cfg(test)]
mod fee_tests {
    use crate::constants::fees::{
        MIN_BORROWING_FEE_BPS,
        MAX_BORROWING_FEE_BPS,
        REDEMPTION_FEE_FLOOR_BPS,
    };
    
    fn calculate_borrowing_fee(debt: u64, base_rate_bps: u64) -> u64 {
        let fee_rate = base_rate_bps.max(MIN_BORROWING_FEE_BPS).min(MAX_BORROWING_FEE_BPS);
        (debt as u128 * fee_rate as u128 / 10000) as u64
    }
    
    fn calculate_redemption_fee(amount: u64, base_rate_bps: u64) -> u64 {
        let fee_rate = (base_rate_bps + REDEMPTION_FEE_FLOOR_BPS).min(10000);
        (amount as u128 * fee_rate as u128 / 10000) as u64
    }
    
    #[test]
    fn test_borrowing_fee_minimum() {
        let debt = 1000_00000000u64; // 1000 zkUSD
        let fee = calculate_borrowing_fee(debt, 0);
        
        // Min fee is 0.5% = 50 bps
        let expected = debt * MIN_BORROWING_FEE_BPS / 10000;
        assert_eq!(fee, expected);
    }
    
    #[test]
    fn test_borrowing_fee_with_base_rate() {
        let debt = 1000_00000000u64;
        let fee = calculate_borrowing_fee(debt, 100); // 1% base rate
        
        // Fee should be 1%
        let expected = debt * 100 / 10000;
        assert_eq!(fee, expected);
    }
    
    #[test]
    fn test_redemption_fee() {
        let amount = 1000_00000000u64;
        let fee = calculate_redemption_fee(amount, 0);
        
        // Floor is 0.5%
        let expected = amount * REDEMPTION_FEE_FLOOR_BPS / 10000;
        assert_eq!(fee, expected);
    }
}

#[cfg(test)]
mod stability_pool_tests {
    const SCALE_FACTOR: u128 = 1_000_000_000_000_000_000; // 1e18

    /// Calculate compounded deposit after liquidations
    fn calculate_compounded_deposit(
        initial_deposit: u64,
        product_p: u128,
        initial_p: u128,
    ) -> u64 {
        if initial_p == 0 {
            return 0;
        }
        ((initial_deposit as u128) * product_p / initial_p) as u64
    }

    /// Calculate BTC gains from liquidations
    fn calculate_btc_gains(
        initial_deposit: u64,
        sum_s: u128,
        initial_s: u128,
        initial_p: u128,
    ) -> u64 {
        if initial_p == 0 {
            return 0;
        }
        let gain = (initial_deposit as u128) * (sum_s - initial_s) / initial_p;
        gain as u64
    }

    #[test]
    fn test_no_liquidation_compounding() {
        let deposit = 1000_00000000u64;
        let compounded = calculate_compounded_deposit(
            deposit,
            SCALE_FACTOR, // P unchanged
            SCALE_FACTOR,
        );
        assert_eq!(compounded, deposit);
    }

    #[test]
    fn test_50_percent_liquidation() {
        let deposit = 1000_00000000u64;
        let new_p = SCALE_FACTOR / 2; // P halved = 50% loss

        let compounded = calculate_compounded_deposit(
            deposit,
            new_p,
            SCALE_FACTOR,
        );
        assert_eq!(compounded, deposit / 2);
    }

    #[test]
    fn test_btc_gains_calculation() {
        let deposit = 1000_00000000u64; // 1000 zkUSD
        let initial_s = 0u128;
        let sum_s = 100_000_000u128; // 1 BTC distributed per 1e18 zkUSD

        let gains = calculate_btc_gains(deposit, sum_s, initial_s, SCALE_FACTOR);
        // Expected: deposit * sum_s / SCALE_FACTOR
        let expected = (deposit as u128 * sum_s / SCALE_FACTOR) as u64;
        assert_eq!(gains, expected);
    }
}

// ============ Math Edge Case Tests ============

#[cfg(test)]
mod math_edge_case_tests {
    use crate::math::{
        calculate_icr, calculate_tcr, calculate_borrowing_fee, calculate_redemption_fee,
        calculate_redemption_fee_fixed, max_debt_for_collateral, min_collateral_for_debt,
        is_liquidatable, is_recovery_mode, get_min_ratio,
        calculate_compounded_deposit, calculate_btc_gain,
        safe_add, safe_sub, safe_mul, safe_div,
    };
    use crate::constants::{ratios, stability_pool::SCALE_FACTOR};
    use crate::errors::ZkUsdError;

    const BTC_PRICE_100K: u64 = 100_000_00000000;
    const ONE_BTC: u64 = 100_000_000;
    const ONE_ZKUSD: u64 = 100_000_000;

    // ============ Safe Arithmetic Tests ============

    #[test]
    fn test_safe_add_normal() {
        assert_eq!(safe_add(100, 200).unwrap(), 300);
        assert_eq!(safe_add(0, 0).unwrap(), 0);
        assert_eq!(safe_add(u64::MAX - 1, 1).unwrap(), u64::MAX);
    }

    #[test]
    fn test_safe_add_overflow() {
        let result = safe_add(u64::MAX, 1);
        assert!(matches!(result, Err(ZkUsdError::Overflow)));
    }

    #[test]
    fn test_safe_sub_normal() {
        assert_eq!(safe_sub(300, 100).unwrap(), 200);
        assert_eq!(safe_sub(100, 100).unwrap(), 0);
        assert_eq!(safe_sub(0, 0).unwrap(), 0);
    }

    #[test]
    fn test_safe_sub_underflow() {
        let result = safe_sub(100, 200);
        assert!(matches!(result, Err(ZkUsdError::Underflow)));
    }

    #[test]
    fn test_safe_mul_normal() {
        assert_eq!(safe_mul(100, 200).unwrap(), 20000);
        assert_eq!(safe_mul(0, u64::MAX).unwrap(), 0);
        assert_eq!(safe_mul(1, 1).unwrap(), 1);
    }

    #[test]
    fn test_safe_mul_large_values() {
        // Should work with large values that fit in u128
        let result = safe_mul(u64::MAX, u64::MAX);
        assert!(result.is_ok());
        // u64::MAX * u64::MAX = (2^64-1)^2
        let expected = (u64::MAX as u128) * (u64::MAX as u128);
        assert_eq!(result.unwrap(), expected);
    }

    #[test]
    fn test_safe_div_normal() {
        assert_eq!(safe_div(300, 100).unwrap(), 3);
        assert_eq!(safe_div(0, 100).unwrap(), 0);
    }

    #[test]
    fn test_safe_div_by_zero() {
        let result = safe_div(100, 0);
        assert!(matches!(result, Err(ZkUsdError::DivisionByZero)));
    }

    // ============ ICR Edge Cases ============

    #[test]
    fn test_icr_zero_debt_returns_max() {
        let icr = calculate_icr(ONE_BTC, 0, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, u64::MAX);
    }

    #[test]
    fn test_icr_very_small_collateral() {
        // 1 satoshi collateral, 1 zkUSD debt
        let icr = calculate_icr(1, ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        // Expected: (1 * $100k) / 1 zkUSD = 0.001% -> ICR = 0
        assert_eq!(icr, 0);
    }

    #[test]
    fn test_icr_very_large_collateral() {
        // 21M BTC (max supply) backing 1 zkUSD
        let max_btc = 21_000_000 * ONE_BTC;
        let icr = calculate_icr(max_btc, ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        // Should be extremely high but not overflow
        assert!(icr > 1_000_000_000);
    }

    #[test]
    fn test_icr_at_exactly_mcr() {
        // 1.1 BTC backing $100k debt at $100k/BTC = exactly 110%
        let collateral = 110_000_000; // 1.1 BTC
        let debt = 100_000 * ONE_ZKUSD;
        let icr = calculate_icr(collateral, debt, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, 110);
    }

    #[test]
    fn test_icr_at_exactly_ccr() {
        // 1.5 BTC backing $100k debt at $100k/BTC = exactly 150%
        let collateral = 150_000_000; // 1.5 BTC
        let debt = 100_000 * ONE_ZKUSD;
        let icr = calculate_icr(collateral, debt, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, 150);
    }

    #[test]
    fn test_tcr_same_as_icr() {
        // TCR uses same calculation as ICR
        let collateral = 150_000_000;
        let debt = 100_000 * ONE_ZKUSD;
        let icr = calculate_icr(collateral, debt, BTC_PRICE_100K).unwrap();
        let tcr = calculate_tcr(collateral, debt, BTC_PRICE_100K).unwrap();
        assert_eq!(icr, tcr);
    }

    // ============ Liquidation Logic Tests ============

    #[test]
    fn test_is_liquidatable_normal_mode_at_boundary() {
        // TCR = 200% (normal mode, threshold is MCR = 110%)
        assert!(!is_liquidatable(110, 200)); // At MCR - not liquidatable
        assert!(is_liquidatable(109, 200));  // Below MCR - liquidatable
    }

    #[test]
    fn test_is_liquidatable_recovery_mode_at_boundary() {
        // TCR = 140% (recovery mode, threshold is CCR = 150%)
        assert!(!is_liquidatable(150, 140)); // At CCR - not liquidatable
        assert!(is_liquidatable(149, 140));  // Below CCR - liquidatable
    }

    #[test]
    fn test_is_recovery_mode_at_boundary() {
        assert!(!is_recovery_mode(150)); // At CCR - not recovery
        assert!(is_recovery_mode(149));  // Below CCR - recovery mode
    }

    #[test]
    fn test_get_min_ratio() {
        assert_eq!(get_min_ratio(200), ratios::MCR); // Normal mode
        assert_eq!(get_min_ratio(149), ratios::CCR); // Recovery mode
    }

    // ============ Fee Calculation Edge Cases ============

    #[test]
    fn test_borrowing_fee_zero_debt() {
        let fee = calculate_borrowing_fee(0, 100).unwrap();
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_borrowing_fee_very_large_debt() {
        // 10M zkUSD debt
        let debt = 10_000_000 * ONE_ZKUSD;
        let fee = calculate_borrowing_fee(debt, 100).unwrap(); // 1%
        assert_eq!(fee, 100_000 * ONE_ZKUSD); // 100k fee
    }

    #[test]
    fn test_redemption_fee_variable_at_floor() {
        let amount = 100_000 * ONE_ZKUSD;
        let fee = calculate_redemption_fee(amount, 0).unwrap();
        // Should use floor of 0.5%
        assert_eq!(fee, 500 * ONE_ZKUSD);
    }

    #[test]
    fn test_redemption_fee_variable_above_floor() {
        let amount = 100_000 * ONE_ZKUSD;
        let fee = calculate_redemption_fee(amount, 200).unwrap(); // 2% base rate
        // Should use 2%
        assert_eq!(fee, 2_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_redemption_fee_fixed_always_same() {
        let amount = 100_000 * ONE_ZKUSD;
        let fee = calculate_redemption_fee_fixed(amount).unwrap();
        // Always 0.75%
        assert_eq!(fee, 750 * ONE_ZKUSD);
    }

    // ============ Collateral/Debt Calculation Edge Cases ============

    #[test]
    fn test_max_debt_for_collateral() {
        // 1 BTC at $100k with 110% MCR = max ~$90,909 debt
        let max_debt = max_debt_for_collateral(ONE_BTC, BTC_PRICE_100K).unwrap();
        assert_eq!(max_debt, 90909_09090909);
    }

    #[test]
    fn test_max_debt_for_zero_collateral() {
        let max_debt = max_debt_for_collateral(0, BTC_PRICE_100K).unwrap();
        assert_eq!(max_debt, 0);
    }

    #[test]
    fn test_min_collateral_for_debt() {
        // 50k zkUSD needs 0.55 BTC at $100k (110% MCR)
        let min_coll = min_collateral_for_debt(50_000 * ONE_ZKUSD, BTC_PRICE_100K).unwrap();
        assert_eq!(min_coll, 55_000_000);
    }

    #[test]
    fn test_min_collateral_for_zero_debt() {
        let min_coll = min_collateral_for_debt(0, BTC_PRICE_100K).unwrap();
        assert_eq!(min_coll, 0);
    }

    #[test]
    fn test_min_collateral_zero_price_error() {
        let result = min_collateral_for_debt(50_000 * ONE_ZKUSD, 0);
        assert!(matches!(result, Err(ZkUsdError::DivisionByZero)));
    }

    // ============ Compounded Deposit Edge Cases ============

    #[test]
    fn test_compounded_deposit_epoch_change() {
        // If epoch changed, deposit is fully depleted
        let result = calculate_compounded_deposit(
            1000 * ONE_ZKUSD,
            SCALE_FACTOR,
            SCALE_FACTOR,
            0, // snapshot scale
            0, // current scale
            0, // snapshot epoch
            1, // current epoch - changed!
        );
        assert_eq!(result, 0);
    }

    #[test]
    fn test_compounded_deposit_zero_snapshot_p() {
        // Zero snapshot_p indicates corrupt state, return 0
        // Signature: (initial_deposit, snapshot_p, current_p, snapshot_scale, current_scale, snapshot_epoch, current_epoch)
        let result = calculate_compounded_deposit(
            1000 * ONE_ZKUSD,
            0, // invalid zero snapshot_p
            SCALE_FACTOR, // current_p
            0,
            0,
            0,
            0,
        );
        assert_eq!(result, 0);
    }

    #[test]
    fn test_compounded_deposit_single_scale_change() {
        // One scale change
        let result = calculate_compounded_deposit(
            1000 * ONE_ZKUSD,
            SCALE_FACTOR,
            SCALE_FACTOR,
            0, // snapshot scale
            1, // current scale - one change
            0,
            0,
        );
        // With one scale change, result is heavily reduced
        assert!(result < 1000 * ONE_ZKUSD);
    }

    #[test]
    fn test_compounded_deposit_multiple_scale_changes() {
        // More than 1 scale change = deposit zeroed
        let result = calculate_compounded_deposit(
            1000 * ONE_ZKUSD,
            SCALE_FACTOR,
            SCALE_FACTOR,
            0, // snapshot scale
            2, // current scale - two changes
            0,
            0,
        );
        assert_eq!(result, 0);
    }

    #[test]
    fn test_compounded_deposit_no_change() {
        // No liquidations, same P value
        let result = calculate_compounded_deposit(
            1000 * ONE_ZKUSD,
            SCALE_FACTOR,
            SCALE_FACTOR,
            0,
            0,
            0,
            0,
        );
        assert_eq!(result, 1000 * ONE_ZKUSD);
    }

    #[test]
    fn test_compounded_deposit_partial_liquidation() {
        // 30% of pool liquidated
        let new_p = SCALE_FACTOR * 7 / 10; // P reduced to 70%
        // Signature: (initial_deposit, snapshot_p, current_p, snapshot_scale, current_scale, snapshot_epoch, current_epoch)
        let result = calculate_compounded_deposit(
            1000 * ONE_ZKUSD,
            SCALE_FACTOR, // snapshot_p - at deposit time, P was full
            new_p,        // current_p - now P is 70% (after liquidation)
            0,
            0,
            0,
            0,
        );
        assert_eq!(result, 700 * ONE_ZKUSD);
    }

    // ============ BTC Gain Edge Cases ============

    #[test]
    fn test_btc_gain_no_liquidations() {
        // No change in S means no gains
        let result = calculate_btc_gain(
            1000 * ONE_ZKUSD,
            0, // snapshot S
            0, // current S (unchanged)
        );
        assert_eq!(result, 0);
    }

    #[test]
    fn test_btc_gain_with_liquidation() {
        // S increased after liquidation
        let snapshot_s = 0u128;
        let current_s = SCALE_FACTOR; // 1 unit of reward per token
        let result = calculate_btc_gain(
            1000 * ONE_ZKUSD,
            snapshot_s,
            current_s,
        );
        // gain = 1000 * (SCALE_FACTOR - 0) / SCALE_FACTOR = 1000
        assert_eq!(result, 1000 * ONE_ZKUSD);
    }

    #[test]
    fn test_btc_gain_multiple_liquidations() {
        // Multiple S increases
        let snapshot_s = SCALE_FACTOR;
        let current_s = SCALE_FACTOR * 3; // Increased by 2x initial
        let result = calculate_btc_gain(
            500 * ONE_ZKUSD,
            snapshot_s,
            current_s,
        );
        // gain = 500 * (3*SF - 1*SF) / SF = 500 * 2 = 1000
        assert_eq!(result, 1000 * ONE_ZKUSD);
    }

    #[test]
    fn test_btc_gain_handles_saturation() {
        // S diff that doesn't overflow due to saturating_sub
        let snapshot_s = SCALE_FACTOR * 10;
        let current_s = SCALE_FACTOR * 5; // Less than snapshot (shouldn't happen but test safety)
        let result = calculate_btc_gain(
            1000 * ONE_ZKUSD,
            snapshot_s,
            current_s,
        );
        // saturating_sub returns 0
        assert_eq!(result, 0);
    }
}

// ============ Vault Type Tests ============

#[cfg(test)]
mod vault_type_tests {
    use crate::types::{Vault, VaultStatus};
    use crate::constants::limits::LIQUIDATION_RESERVE;

    const ONE_BTC: u64 = 100_000_000;
    const ONE_ZKUSD: u64 = 100_000_000;

    #[test]
    fn test_vault_is_active() {
        let vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        assert!(vault.is_active());
    }

    #[test]
    fn test_vault_not_active_when_closed() {
        let mut vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        vault.status = VaultStatus::Closed;
        assert!(!vault.is_active());
    }

    #[test]
    fn test_vault_not_active_when_liquidated() {
        let mut vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        vault.status = VaultStatus::Liquidated;
        assert!(!vault.is_active());
    }

    #[test]
    fn test_vault_net_debt() {
        let debt = 50_000 * ONE_ZKUSD + LIQUIDATION_RESERVE;
        let vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, debt, 100);
        assert_eq!(vault.net_debt(), 50_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_vault_net_debt_saturates() {
        // Net debt with very small debt should saturate to 0
        let vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, LIQUIDATION_RESERVE / 2, 100);
        assert_eq!(vault.net_debt(), 0);
    }

    #[test]
    fn test_vault_entire_debt() {
        let mut vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        vault.accrued_interest = 100 * ONE_ZKUSD;
        vault.redistributed_debt = 200 * ONE_ZKUSD;

        assert_eq!(vault.entire_debt(), 50_000 * ONE_ZKUSD + 100 * ONE_ZKUSD + 200 * ONE_ZKUSD);
    }

    #[test]
    fn test_vault_entire_collateral() {
        let mut vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        vault.redistributed_collateral = 10_000_000; // 0.1 BTC

        assert_eq!(vault.entire_collateral(), ONE_BTC + 10_000_000);
    }

    #[test]
    fn test_vault_calculate_interest_zero_elapsed() {
        let vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        // No blocks elapsed
        assert_eq!(vault.calculate_interest(100), 0);
    }

    #[test]
    fn test_vault_calculate_interest_zero_rate() {
        let mut vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        vault.interest_rate_bps = 0;
        // Zero rate = zero interest
        assert_eq!(vault.calculate_interest(200), 0);
    }

    #[test]
    fn test_vault_calculate_interest_one_year() {
        let vault = Vault::with_interest_rate(
            [0u8; 32],
            [1u8; 32],
            ONE_BTC,
            50_000 * ONE_ZKUSD,
            0, // created at block 0
            100, // 1% APR
        );
        // 1 year = 52,560 blocks
        let interest = vault.calculate_interest(52_560);
        // Expected: 50,000 * 100bps * 52560 / 52560 / 10000 = 500 zkUSD
        assert_eq!(interest, 500 * ONE_ZKUSD);
    }

    #[test]
    fn test_vault_has_insurance() {
        let mut vault = Vault::new([0u8; 32], [1u8; 32], ONE_BTC, 50_000 * ONE_ZKUSD, 100);
        assert!(!vault.has_insurance());

        vault.insurance_balance = 10_000_000; // 0.1 BTC
        assert!(vault.has_insurance());
    }
}

// ============ Protocol State Tests ============

#[cfg(test)]
mod protocol_state_tests {
    use crate::types::ProtocolState;
    use crate::constants::fees::MIN_BORROWING_FEE_BPS;

    #[test]
    fn test_protocol_state_new() {
        let admin = [1u8; 32];
        let state = ProtocolState::new(admin);

        assert_eq!(state.admin, admin);
        assert_eq!(state.total_collateral, 0);
        assert_eq!(state.total_debt, 0);
        assert_eq!(state.active_vault_count, 0);
        assert_eq!(state.base_rate, MIN_BORROWING_FEE_BPS);
        assert!(!state.is_paused);
    }
}

// ============ Price Data Tests ============

#[cfg(test)]
mod price_data_tests {
    use crate::types::{PriceData, PriceSource};
    use crate::constants::oracle::MAX_PRICE_AGE_BLOCKS;

    #[test]
    fn test_price_data_new() {
        let price = PriceData::new(100_000_00000000, 100, PriceSource::Mock);

        assert_eq!(price.price, 100_000_00000000);
        assert_eq!(price.timestamp_block, 100);
        assert_eq!(price.confidence, 100);
    }

    #[test]
    fn test_price_is_stale() {
        let price = PriceData::new(100_000_00000000, 100, PriceSource::Mock);

        // Not stale within MAX_PRICE_AGE_BLOCKS
        assert!(!price.is_stale(100 + MAX_PRICE_AGE_BLOCKS));
        // Stale after MAX_PRICE_AGE_BLOCKS
        assert!(price.is_stale(100 + MAX_PRICE_AGE_BLOCKS + 1));
    }

    #[test]
    fn test_price_is_stale_saturates() {
        let price = PriceData::new(100_000_00000000, 100, PriceSource::Mock);
        // Should not panic with block < timestamp (though shouldn't happen)
        assert!(!price.is_stale(50)); // Uses saturating_sub
    }
}
