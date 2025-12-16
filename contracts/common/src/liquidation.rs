//! Advanced Liquidation Logic
//!
//! This module implements the improved liquidation system inspired by Mezo/Liquity V2:
//!
//! ## Liquidation Flow
//!
//! ```text
//! Vault ICR < MCR (or < CCR in Recovery Mode)
//!                 │
//!                 ▼
//! ┌───────────────────────────────────────┐
//! │     STEP 1: Check Stability Pool      │
//! │     Can SP absorb the debt?           │
//! └───────────────┬───────────────────────┘
//!                 │
//!         ┌──────┴──────┐
//!         │             │
//!         ▼             ▼
//!    SP >= debt     SP < debt
//!         │             │
//!         ▼             ▼
//! ┌───────────────┐ ┌───────────────────────┐
//! │ OFFSET        │ │ PARTIAL OFFSET +      │
//! │ Full debt     │ │ REDISTRIBUTE rest     │
//! │ absorbed      │ │ to other vaults       │
//! └───────────────┘ └───────────────────────┘
//!         │             │
//!         └──────┬──────┘
//!                ▼
//! ┌───────────────────────────────────────┐
//! │     STEP 2: Handle Surplus            │
//! │     If ICR > 110% in RM, return       │
//! │     excess to CollSurplusPool         │
//! └───────────────────────────────────────┘
//!                 │
//!                 ▼
//! ┌───────────────────────────────────────┐
//! │     STEP 3: Compensate Liquidator     │
//! │     - 200 zkUSD gas compensation      │
//! │     - 0.5% of collateral bonus        │
//! └───────────────────────────────────────┘
//! ```
//!
//! ## UTXO Advantages
//!
//! - **Parallel Liquidations**: Multiple vaults can be liquidated in one TX
//! - **Atomic Operations**: All or nothing - no partial state
//! - **Insurance Charms**: Can be attached and triggered automatically

use crate::{
    constants::{
        fees::BPS_DENOMINATOR,
        liquidation::LIQUIDATOR_BONUS_BPS,
        ratios::{CCR, MCR},
        redistribution::{LIQUIDATION_PENALTY_BPS, LIQUIDATION_PENALTY_RM_BPS},
    },
    errors::{ZkUsdError, ZkUsdResult},
    math::calculate_icr,
    types::{Address, LiquidationResult, StabilityPoolState, SurplusClaim, Vault},
};

/// Configuration for liquidation processing
#[derive(Debug, Clone)]
pub struct LiquidationConfig {
    /// Current BTC price (8 decimals)
    pub btc_price: u64,
    /// Current block height
    pub block_height: u64,
    /// Whether system is in recovery mode
    pub is_recovery_mode: bool,
    /// Total collateral in system (for redistribution calc)
    pub total_system_collateral: u64,
    /// Liquidator address (receives bonus)
    pub liquidator: Address,
}

/// Result of processing a liquidation
#[derive(Debug, Clone)]
pub struct ProcessedLiquidation {
    /// Liquidation details
    pub result: LiquidationResult,
    /// Surplus claim created (if any)
    pub surplus_claim: Option<SurplusClaim>,
    /// Whether redistribution was needed
    pub used_redistribution: bool,
}

/// Check if a vault can be liquidated
pub fn can_liquidate(vault: &Vault, btc_price: u64, is_recovery_mode: bool) -> bool {
    if !vault.is_active() {
        return false;
    }

    let icr = match calculate_icr(vault.entire_collateral(), vault.entire_debt(), btc_price) {
        Ok(icr) => icr,
        Err(_) => return false, // On math error, assume not liquidatable
    };

    if is_recovery_mode {
        // In Recovery Mode, can liquidate if ICR < CCR (150%)
        icr < CCR
    } else {
        // Normal mode: can liquidate if ICR < MCR (110%)
        icr < MCR
    }
}

/// Process a single vault liquidation
///
/// Returns the liquidation result with all distributions calculated.
/// This is a pure function - actual state changes happen in the validation layer.
pub fn process_liquidation(
    vault: &Vault,
    stability_pool: &StabilityPoolState,
    config: &LiquidationConfig,
) -> ZkUsdResult<ProcessedLiquidation> {
    // 1. Verify vault can be liquidated
    if !can_liquidate(vault, config.btc_price, config.is_recovery_mode) {
        let icr = calculate_icr(vault.entire_collateral(), vault.entire_debt(), config.btc_price)
            .unwrap_or(u64::MAX);
        return Err(ZkUsdError::NotLiquidatable {
            vault_id: vault.id,
            icr,
        });
    }

    let entire_debt = vault.entire_debt();
    let entire_collateral = vault.entire_collateral();

    let mut result = LiquidationResult::new(vault.id);

    // 2. Calculate liquidator bonus (0.5% of collateral)
    result.liquidator_bonus = entire_collateral
        .saturating_mul(LIQUIDATOR_BONUS_BPS)
        / BPS_DENOMINATOR;

    let collateral_after_bonus = entire_collateral.saturating_sub(result.liquidator_bonus);

    // 3. Check for surplus collateral in Recovery Mode
    // If ICR > 110% but < 150%, user gets excess back
    let icr = calculate_icr(entire_collateral, entire_debt, config.btc_price)
        .unwrap_or(0);
    let surplus_claim = if config.is_recovery_mode && icr > MCR {
        // Calculate collateral needed to cover debt at 110%
        let collateral_needed = entire_debt
            .saturating_mul(MCR as u64)
            / 100;

        // Convert zkUSD value to BTC
        let collateral_needed_btc = collateral_needed
            .saturating_mul(100_000_000) // 8 decimals
            / config.btc_price;

        let surplus = collateral_after_bonus.saturating_sub(collateral_needed_btc);

        if surplus > 0 {
            result.collateral_surplus = surplus;
            Some(SurplusClaim::new(
                vault.owner,
                surplus,
                vault.id,
                config.block_height,
            ))
        } else {
            None
        }
    } else {
        None
    };

    let collateral_for_distribution = collateral_after_bonus
        .saturating_sub(result.collateral_surplus);

    // 4. Calculate penalty (for redistribution scenarios)
    // Note: penalty is built into the redistribution math, retained for future use
    let _penalty_bps = if config.is_recovery_mode {
        LIQUIDATION_PENALTY_RM_BPS
    } else {
        LIQUIDATION_PENALTY_BPS
    };

    // 5. Try to offset with Stability Pool first
    let used_redistribution;
    if stability_pool.total_zkusd >= entire_debt {
        // Full offset - Stability Pool absorbs all debt
        result.debt_offset = entire_debt;
        result.collateral_to_sp = collateral_for_distribution;
        used_redistribution = false;
    } else if stability_pool.total_zkusd > 0 {
        // Partial offset - SP absorbs what it can, rest redistributed
        result.debt_offset = stability_pool.total_zkusd;

        // Proportional collateral split
        let sp_share = (collateral_for_distribution as u128)
            .saturating_mul(stability_pool.total_zkusd as u128)
            / entire_debt as u128;
        result.collateral_to_sp = sp_share as u64;

        // Rest goes to redistribution
        result.debt_redistributed = entire_debt.saturating_sub(result.debt_offset);
        result.collateral_redistributed = collateral_for_distribution
            .saturating_sub(result.collateral_to_sp);
        used_redistribution = true;
    } else {
        // No SP funds - full redistribution
        result.debt_redistributed = entire_debt;
        result.collateral_redistributed = collateral_for_distribution;
        used_redistribution = true;
    }

    Ok(ProcessedLiquidation {
        result,
        surplus_claim,
        used_redistribution,
    })
}

/// Process multiple liquidations in batch (UTXO advantage: parallel processing)
pub fn process_batch_liquidation(
    vaults: &[Vault],
    stability_pool: &StabilityPoolState,
    config: &LiquidationConfig,
) -> ZkUsdResult<Vec<ProcessedLiquidation>> {
    let mut results = Vec::with_capacity(vaults.len());
    let mut remaining_sp = stability_pool.total_zkusd;

    // Create a mutable copy of SP state for tracking
    let mut current_sp = stability_pool.clone();

    for vault in vaults {
        // Update SP state for next liquidation
        current_sp.total_zkusd = remaining_sp;

        match process_liquidation(vault, &current_sp, config) {
            Ok(processed) => {
                // Update remaining SP
                remaining_sp = remaining_sp.saturating_sub(processed.result.debt_offset);
                results.push(processed);
            }
            Err(_) => {
                // Skip vaults that can't be liquidated
                // In production, might want to collect these errors
                continue;
            }
        }
    }

    if results.is_empty() {
        return Err(ZkUsdError::NoLiquidatableVaults);
    }

    Ok(results)
}

/// Calculate redistribution shares for active vaults
///
/// Each vault receives a proportional share based on their collateral
pub fn calculate_redistribution_shares(
    debt_to_redistribute: u64,
    collateral_to_redistribute: u64,
    recipient_collateral: u64,
    total_system_collateral: u64,
) -> (u64, u64) {
    if total_system_collateral == 0 {
        return (0, 0);
    }

    // Share = (recipient_collateral / total_collateral) * amount
    let debt_share = (debt_to_redistribute as u128)
        .saturating_mul(recipient_collateral as u128)
        / total_system_collateral as u128;

    let collateral_share = (collateral_to_redistribute as u128)
        .saturating_mul(recipient_collateral as u128)
        / total_system_collateral as u128;

    (debt_share as u64, collateral_share as u64)
}

/// Apply redistribution to a vault
///
/// In the UTXO model, this creates a new vault charm with updated values
pub fn apply_redistribution_to_vault(
    vault: &mut Vault,
    debt_share: u64,
    collateral_share: u64,
) {
    vault.redistributed_debt = vault.redistributed_debt.saturating_add(debt_share);
    vault.redistributed_collateral = vault.redistributed_collateral.saturating_add(collateral_share);
}

/// Check if insurance should trigger for a vault
pub fn should_trigger_insurance(
    vault: &Vault,
    btc_price: u64,
    insurance_trigger_icr: u64,
) -> bool {
    if !vault.has_insurance() {
        return false;
    }

    let icr = calculate_icr(vault.entire_collateral(), vault.entire_debt(), btc_price)
        .unwrap_or(u64::MAX);
    icr <= insurance_trigger_icr
}

/// Calculate insurance payout needed to restore vault to safe ICR
pub fn calculate_insurance_payout(
    vault: &Vault,
    btc_price: u64,
    target_icr: u64, // e.g., 150% = 150
) -> u64 {
    let current_icr = calculate_icr(vault.entire_collateral(), vault.entire_debt(), btc_price)
        .unwrap_or(u64::MAX);

    if current_icr >= target_icr {
        return 0;
    }

    // Calculate additional collateral needed
    // target_icr = (collateral + additional) * price / debt
    // additional = (target_icr * debt / price) - collateral
    let target_collateral_value = (vault.entire_debt() as u128)
        .saturating_mul(target_icr as u128)
        / 10000;

    let current_collateral_value = (vault.entire_collateral() as u128)
        .saturating_mul(btc_price as u128)
        / 100_000_000;

    let needed_value = target_collateral_value.saturating_sub(current_collateral_value);

    // Convert to BTC
    let needed_btc = (needed_value as u128)
        .saturating_mul(100_000_000)
        / btc_price as u128;

    needed_btc.min(u64::MAX as u128) as u64
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::VaultStatus;

    const BTC_PRICE: u64 = 100_000_00000000; // $100,000
    const ONE_BTC: u64 = 100_000_000;
    const ONE_ZKUSD: u64 = 100_000_000;

    fn create_test_vault(collateral: u64, debt: u64) -> Vault {
        Vault {
            id: [1u8; 32],
            owner: [2u8; 32],
            collateral,
            debt,
            created_at: 100,
            last_updated: 100,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        }
    }

    fn create_test_config(is_recovery_mode: bool) -> LiquidationConfig {
        LiquidationConfig {
            btc_price: BTC_PRICE,
            block_height: 1000,
            is_recovery_mode,
            total_system_collateral: 100 * ONE_BTC,
            liquidator: [99u8; 32],
        }
    }

    #[test]
    fn test_can_liquidate_underwater_vault() {
        // Vault with ICR = 100% (underwater)
        let vault = create_test_vault(ONE_BTC, 100_000 * ONE_ZKUSD);
        assert!(can_liquidate(&vault, BTC_PRICE, false));
    }

    #[test]
    fn test_cannot_liquidate_healthy_vault() {
        // Vault with ICR = 200% (healthy)
        let vault = create_test_vault(2 * ONE_BTC, 100_000 * ONE_ZKUSD);
        assert!(!can_liquidate(&vault, BTC_PRICE, false));
    }

    #[test]
    fn test_recovery_mode_liquidation_threshold() {
        // Vault with ICR = 130% - safe in normal, liquidatable in RM
        let vault = create_test_vault(
            130_000_000, // 1.3 BTC
            100_000 * ONE_ZKUSD,
        );

        assert!(!can_liquidate(&vault, BTC_PRICE, false)); // Normal mode: safe
        assert!(can_liquidate(&vault, BTC_PRICE, true));   // RM: liquidatable
    }

    #[test]
    fn test_full_stability_pool_offset() {
        // 0.98 BTC at $100k = $98k collateral, $90k debt => ICR ~109% (below MCR 110%)
        let vault = create_test_vault(98_000_000, 90_000 * ONE_ZKUSD);
        let sp = StabilityPoolState {
            total_zkusd: 100_000 * ONE_ZKUSD,
            ..Default::default()
        };
        let config = create_test_config(false);

        let result = process_liquidation(&vault, &sp, &config).unwrap();

        assert_eq!(result.result.debt_offset, 90_000 * ONE_ZKUSD);
        assert_eq!(result.result.debt_redistributed, 0);
        assert!(!result.used_redistribution);
    }

    #[test]
    fn test_partial_offset_with_redistribution() {
        // 0.98 BTC at $100k = $98k collateral, $90k debt => ICR ~109% (below MCR 110%)
        let vault = create_test_vault(98_000_000, 90_000 * ONE_ZKUSD);
        let sp = StabilityPoolState {
            total_zkusd: 50_000 * ONE_ZKUSD, // Only covers 55%
            ..Default::default()
        };
        let config = create_test_config(false);

        let result = process_liquidation(&vault, &sp, &config).unwrap();

        assert_eq!(result.result.debt_offset, 50_000 * ONE_ZKUSD);
        assert_eq!(result.result.debt_redistributed, 40_000 * ONE_ZKUSD);
        assert!(result.used_redistribution);
    }

    #[test]
    fn test_surplus_in_recovery_mode() {
        // Vault with ICR = 130% liquidated in RM
        // Should get surplus back
        let vault = create_test_vault(
            130_000_000, // 1.3 BTC = $130,000
            100_000 * ONE_ZKUSD, // $100,000 debt
        );
        let sp = StabilityPoolState {
            total_zkusd: 200_000 * ONE_ZKUSD,
            ..Default::default()
        };
        let config = create_test_config(true); // Recovery Mode

        let result = process_liquidation(&vault, &sp, &config).unwrap();

        // User should get surplus (130% - 110% = 20% of debt value)
        assert!(result.surplus_claim.is_some());
        assert!(result.result.collateral_surplus > 0);
    }

    #[test]
    fn test_redistribution_shares() {
        let (debt_share, coll_share) = calculate_redistribution_shares(
            10_000 * ONE_ZKUSD, // debt to redistribute
            ONE_BTC,            // collateral to redistribute
            10 * ONE_BTC,       // recipient has 10 BTC
            100 * ONE_BTC,      // total system has 100 BTC
        );

        // Recipient should get 10% of redistributed amounts
        assert_eq!(debt_share, 1_000 * ONE_ZKUSD);
        assert_eq!(coll_share, ONE_BTC / 10);
    }
}
