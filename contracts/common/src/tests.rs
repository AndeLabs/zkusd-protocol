//! Unit tests for zkUSD protocol logic
//!
//! Tests cover:
//! - ICR calculations
//! - Liquidation conditions
//! - Fee calculations
//! - Stability Pool math

#[cfg(test)]
mod icr_tests {
    use crate::constants::collateral::{MCR_BPS, CCR_BPS};
    
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
    use crate::constants::collateral::MCR_BPS;
    
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
