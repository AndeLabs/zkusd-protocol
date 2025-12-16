//! Multi-Collateral Support Module
//!
//! Enables zkUSD vaults to accept multiple collateral types beyond BTC.
//! Each collateral type has its own risk parameters, oracle, and debt ceiling.
//!
//! ## Supported Collateral Types
//!
//! - **BTC**: Native Bitcoin (primary collateral)
//! - **Wrapped BTC**: Various wrapped BTC tokens (wBTC, tBTC, etc.)
//! - **LSTs**: Liquid staking tokens (stBTC, etc.)
//! - **LP Tokens**: Liquidity provider tokens (with haircut)
//!
//! ## Risk Parameters
//!
//! Each collateral type has:
//! - MCR (Minimum Collateral Ratio)
//! - Liquidation penalty
//! - Debt ceiling
//! - Oracle configuration
//! - Stability fee
//!
//! ## UTXO Advantages
//!
//! - Each collateral type tracked in separate UTXOs
//! - Parallel liquidation processing by collateral type
//! - Atomic multi-collateral vault operations

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};
#[cfg(feature = "std")]
#[allow(unused_imports)]
use std::vec::Vec;

use crate::errors::{ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Maximum number of collateral types
pub const MAX_COLLATERAL_TYPES: usize = 16;

/// Minimum debt per vault
pub const MIN_VAULT_DEBT: u64 = 100_00000000; // $100 minimum

/// Default liquidation bonus (BPS)
pub const DEFAULT_LIQUIDATION_BONUS_BPS: u64 = 1000; // 10%

/// Maximum debt ceiling per collateral
pub const MAX_DEBT_CEILING: u64 = 1_000_000_000_00000000; // $1B

/// Correlation discount for multi-collateral (BPS)
pub const CORRELATION_DISCOUNT_BPS: u64 = 500; // 5% discount for diversification

// ============================================================================
// Types
// ============================================================================

/// Collateral type identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CollateralType {
    /// Native Bitcoin
    NativeBTC,
    /// Wrapped BTC (e.g., wBTC on other chains)
    WrappedBTC { chain_id: u32 },
    /// Liquid staking token
    LiquidStakingToken { protocol_id: u32 },
    /// Liquidity provider token
    LPToken { pool_id: u32 },
    /// Synthetic asset
    Synthetic { asset_id: u32 },
    /// Custom collateral
    Custom { id: [u8; 32] },
}

impl CollateralType {
    /// Get base risk weight (BPS, 10000 = 100%)
    pub fn base_risk_weight(&self) -> u64 {
        match self {
            CollateralType::NativeBTC => 10000, // 100% - lowest risk
            CollateralType::WrappedBTC { .. } => 10500, // 105%
            CollateralType::LiquidStakingToken { .. } => 11000, // 110%
            CollateralType::LPToken { .. } => 12000, // 120% - higher volatility
            CollateralType::Synthetic { .. } => 13000, // 130% - highest risk
            CollateralType::Custom { .. } => 15000, // 150% - unknown risk
        }
    }

    /// Get minimum MCR for this collateral type (BPS)
    pub fn min_mcr(&self) -> u64 {
        match self {
            CollateralType::NativeBTC => 11000, // 110%
            CollateralType::WrappedBTC { .. } => 12000, // 120%
            CollateralType::LiquidStakingToken { .. } => 12500, // 125%
            CollateralType::LPToken { .. } => 15000, // 150%
            CollateralType::Synthetic { .. } => 17500, // 175%
            CollateralType::Custom { .. } => 20000, // 200%
        }
    }
}

/// Configuration for a collateral type
#[derive(Debug, Clone)]
pub struct CollateralConfig {
    /// Collateral type
    pub coll_type: CollateralType,
    /// Token identifier (address/script hash)
    pub token_id: [u8; 32],
    /// Display name
    pub name: [u8; 32],
    /// Decimal precision
    pub decimals: u8,
    /// Minimum Collateral Ratio (BPS)
    pub mcr_bps: u64,
    /// Critical Collateral Ratio for recovery mode (BPS)
    pub ccr_bps: u64,
    /// Liquidation bonus (BPS)
    pub liquidation_bonus_bps: u64,
    /// Stability fee (annual, BPS)
    pub stability_fee_bps: u64,
    /// Debt ceiling
    pub debt_ceiling: u64,
    /// Current total debt
    pub total_debt: u64,
    /// Is collateral active
    pub is_active: bool,
    /// Oracle ID
    pub oracle_id: [u8; 32],
    /// Last oracle price (8 decimals)
    pub last_price: u64,
    /// Oracle update block
    pub price_update_block: u64,
}

impl CollateralConfig {
    /// Create new config for a collateral type
    pub fn new(coll_type: CollateralType, token_id: [u8; 32]) -> Self {
        Self {
            coll_type,
            token_id,
            name: [0u8; 32],
            decimals: 8,
            mcr_bps: coll_type.min_mcr(),
            ccr_bps: coll_type.min_mcr() + 4000, // CCR = MCR + 40%
            liquidation_bonus_bps: DEFAULT_LIQUIDATION_BONUS_BPS,
            stability_fee_bps: 200, // 2% default annual fee
            debt_ceiling: MAX_DEBT_CEILING,
            total_debt: 0,
            is_active: true,
            oracle_id: [0u8; 32],
            last_price: 0,
            price_update_block: 0,
        }
    }

    /// Check if has capacity for more debt
    pub fn has_capacity(&self, additional_debt: u64) -> bool {
        self.is_active && self.total_debt + additional_debt <= self.debt_ceiling
    }

    /// Calculate utilization (BPS)
    pub fn utilization_bps(&self) -> u64 {
        if self.debt_ceiling == 0 {
            return 0;
        }
        (self.total_debt as u128 * 10000 / self.debt_ceiling as u128) as u64
    }

    /// Get effective MCR based on utilization
    pub fn effective_mcr(&self) -> u64 {
        let util = self.utilization_bps();
        if util > 8000 {
            // Above 80% utilization, increase MCR
            let premium = (util - 8000) / 10; // 0.1% increase per 1% above 80%
            self.mcr_bps + premium
        } else {
            self.mcr_bps
        }
    }
}

/// Multi-collateral vault
#[derive(Debug, Clone)]
pub struct MultiCollateralVault {
    /// Vault ID
    pub id: [u8; 32],
    /// Owner address
    pub owner: [u8; 32],
    /// Collateral positions
    pub positions: Vec<CollateralPosition>,
    /// Total debt in zkUSD
    pub total_debt: u64,
    /// Interest rate (BPS)
    pub interest_rate_bps: u64,
    /// Created at block
    pub created_at: u64,
    /// Last updated block
    pub last_updated: u64,
    /// Is active
    pub is_active: bool,
}

/// A single collateral position within a vault
#[derive(Debug, Clone)]
pub struct CollateralPosition {
    /// Collateral type
    pub coll_type: CollateralType,
    /// Amount of collateral
    pub amount: u64,
    /// Value in USD at deposit (for tracking)
    pub initial_value_usd: u64,
    /// Allocated debt portion
    pub allocated_debt: u64,
}

impl MultiCollateralVault {
    /// Create new multi-collateral vault
    pub fn new(id: [u8; 32], owner: [u8; 32], block_height: u64) -> Self {
        Self {
            id,
            owner,
            positions: Vec::new(),
            total_debt: 0,
            interest_rate_bps: 200, // 2% default
            created_at: block_height,
            last_updated: block_height,
            is_active: true,
        }
    }

    /// Add collateral to vault
    pub fn add_collateral(&mut self, coll_type: CollateralType, amount: u64, value_usd: u64) {
        // Check if position exists
        for pos in &mut self.positions {
            if pos.coll_type == coll_type {
                pos.amount += amount;
                pos.initial_value_usd += value_usd;
                return;
            }
        }

        // Create new position
        self.positions.push(CollateralPosition {
            coll_type,
            amount,
            initial_value_usd: value_usd,
            allocated_debt: 0,
        });
    }

    /// Remove collateral from vault
    pub fn remove_collateral(&mut self, coll_type: CollateralType, amount: u64) -> ZkUsdResult<()> {
        for pos in &mut self.positions {
            if pos.coll_type == coll_type {
                if pos.amount < amount {
                    return Err(ZkUsdError::InsufficientBalance {
                        available: pos.amount,
                        requested: amount,
                    });
                }
                pos.amount -= amount;
                return Ok(());
            }
        }
        Err(ZkUsdError::InvalidParameter)
    }

    /// Get total collateral value
    pub fn total_collateral_value(&self, configs: &[CollateralConfig]) -> u64 {
        let mut total = 0u64;
        for pos in &self.positions {
            if let Some(config) = configs.iter().find(|c| c.coll_type == pos.coll_type) {
                let value = (pos.amount as u128 * config.last_price as u128 / 100_000_000) as u64;
                total += value;
            }
        }
        total
    }

    /// Calculate weighted average MCR
    pub fn weighted_mcr(&self, configs: &[CollateralConfig]) -> u64 {
        let mut weighted_sum = 0u128;
        let mut total_value = 0u128;

        for pos in &self.positions {
            if let Some(config) = configs.iter().find(|c| c.coll_type == pos.coll_type) {
                let value = (pos.amount as u128 * config.last_price as u128 / 100_000_000) as u128;
                weighted_sum += value * config.effective_mcr() as u128;
                total_value += value;
            }
        }

        if total_value == 0 {
            return 11000; // Default MCR
        }

        // Apply diversification discount if multiple collateral types
        let base_mcr = (weighted_sum / total_value) as u64;
        if self.positions.len() > 1 {
            let discount = base_mcr * CORRELATION_DISCOUNT_BPS / 10000;
            base_mcr.saturating_sub(discount)
        } else {
            base_mcr
        }
    }

    /// Calculate ICR
    pub fn calculate_icr(&self, configs: &[CollateralConfig]) -> u64 {
        if self.total_debt == 0 {
            return u64::MAX;
        }

        let collateral_value = self.total_collateral_value(configs);
        (collateral_value as u128 * 10000 / self.total_debt as u128) as u64
    }

    /// Check if vault is liquidatable
    pub fn is_liquidatable(&self, configs: &[CollateralConfig]) -> bool {
        let icr = self.calculate_icr(configs);
        let mcr = self.weighted_mcr(configs);
        icr < mcr
    }

    /// Allocate debt to positions based on value
    pub fn allocate_debt(&mut self, configs: &[CollateralConfig]) {
        let total_value = self.total_collateral_value(configs);
        if total_value == 0 || self.total_debt == 0 {
            return;
        }

        for pos in &mut self.positions {
            if let Some(config) = configs.iter().find(|c| c.coll_type == pos.coll_type) {
                let pos_value = (pos.amount as u128 * config.last_price as u128 / 100_000_000) as u64;
                let share = pos_value as u128 * 10000 / total_value as u128;
                pos.allocated_debt = (self.total_debt as u128 * share / 10000) as u64;
            }
        }
    }
}

/// Multi-collateral system state
#[derive(Debug, Clone)]
pub struct MultiCollateralState {
    /// Registered collateral types
    pub collaterals: Vec<CollateralConfig>,
    /// Total system debt
    pub total_system_debt: u64,
    /// Total system collateral value
    pub total_collateral_value: u64,
    /// Active vault count
    pub active_vaults: u64,
    /// Is system active
    pub is_active: bool,
}

impl Default for MultiCollateralState {
    fn default() -> Self {
        Self {
            collaterals: Vec::new(),
            total_system_debt: 0,
            total_collateral_value: 0,
            active_vaults: 0,
            is_active: true,
        }
    }
}

impl MultiCollateralState {
    /// Add new collateral type
    pub fn add_collateral_type(&mut self, config: CollateralConfig) -> ZkUsdResult<()> {
        if self.collaterals.len() >= MAX_COLLATERAL_TYPES {
            return Err(ZkUsdError::ExceedsMaximum {
                amount: self.collaterals.len() as u64,
                maximum: MAX_COLLATERAL_TYPES as u64,
            });
        }

        // Check for duplicate
        if self.collaterals.iter().any(|c| c.coll_type == config.coll_type) {
            return Err(ZkUsdError::InvalidParameter);
        }

        self.collaterals.push(config);
        Ok(())
    }

    /// Get collateral config
    pub fn get_collateral(&self, coll_type: CollateralType) -> Option<&CollateralConfig> {
        self.collaterals.iter().find(|c| c.coll_type == coll_type)
    }

    /// Get mutable collateral config
    pub fn get_collateral_mut(&mut self, coll_type: CollateralType) -> Option<&mut CollateralConfig> {
        self.collaterals.iter_mut().find(|c| c.coll_type == coll_type)
    }

    /// Calculate system TCR
    pub fn system_tcr(&self) -> u64 {
        if self.total_system_debt == 0 {
            return u64::MAX;
        }
        (self.total_collateral_value as u128 * 10000 / self.total_system_debt as u128) as u64
    }

    /// Check if in recovery mode
    pub fn is_recovery_mode(&self) -> bool {
        // Recovery mode if TCR < 150%
        self.system_tcr() < 15000
    }
}

// ============================================================================
// Core Operations
// ============================================================================

/// Open a multi-collateral vault
pub fn open_multi_vault(
    owner: [u8; 32],
    initial_positions: Vec<(CollateralType, u64)>,
    initial_debt: u64,
    state: &mut MultiCollateralState,
    current_block: u64,
) -> ZkUsdResult<MultiCollateralVault> {
    // Validate debt
    if initial_debt < MIN_VAULT_DEBT {
        return Err(ZkUsdError::BelowMinimum {
            amount: initial_debt,
            minimum: MIN_VAULT_DEBT,
        });
    }

    // Check system is active
    if !state.is_active {
        return Err(ZkUsdError::ProtocolPaused);
    }

    // Generate vault ID
    let vault_id = generate_vault_id(owner, current_block);

    let mut vault = MultiCollateralVault::new(vault_id, owner, current_block);
    vault.total_debt = initial_debt;

    // Add collateral positions
    for (coll_type, amount) in initial_positions {
        let config = state.get_collateral(coll_type)
            .ok_or(ZkUsdError::InvalidParameter)?;

        if !config.is_active {
            return Err(ZkUsdError::InvalidParameter);
        }

        let value = (amount as u128 * config.last_price as u128 / 100_000_000) as u64;
        vault.add_collateral(coll_type, amount, value);
    }

    // Check ICR meets MCR
    let icr = vault.calculate_icr(&state.collaterals);
    let mcr = vault.weighted_mcr(&state.collaterals);
    if icr < mcr {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: icr,
            required_ratio: mcr,
        });
    }

    // Allocate debt to positions
    vault.allocate_debt(&state.collaterals);

    // Update state
    state.total_system_debt += initial_debt;
    state.total_collateral_value += vault.total_collateral_value(&state.collaterals);
    state.active_vaults += 1;

    // Update individual collateral debt
    for pos in &vault.positions {
        if let Some(config) = state.get_collateral_mut(pos.coll_type) {
            config.total_debt += pos.allocated_debt;
        }
    }

    Ok(vault)
}

/// Add collateral to existing vault
pub fn add_vault_collateral(
    vault: &mut MultiCollateralVault,
    coll_type: CollateralType,
    amount: u64,
    state: &mut MultiCollateralState,
) -> ZkUsdResult<()> {
    let config = state.get_collateral(coll_type)
        .ok_or(ZkUsdError::InvalidParameter)?;

    if !config.is_active {
        return Err(ZkUsdError::InvalidParameter);
    }

    let value = (amount as u128 * config.last_price as u128 / 100_000_000) as u64;

    vault.add_collateral(coll_type, amount, value);

    // Update state
    state.total_collateral_value += value;

    // Reallocate debt
    vault.allocate_debt(&state.collaterals);

    Ok(())
}

/// Borrow more zkUSD from vault
pub fn borrow_from_vault(
    vault: &mut MultiCollateralVault,
    borrow_amount: u64,
    state: &mut MultiCollateralState,
) -> ZkUsdResult<()> {
    // Check capacity for each collateral type
    for pos in &vault.positions {
        if let Some(config) = state.get_collateral(pos.coll_type) {
            let additional_debt = (borrow_amount as u128 * pos.allocated_debt as u128 / vault.total_debt as u128) as u64;
            if !config.has_capacity(additional_debt) {
                return Err(ZkUsdError::ExceedsMaximum {
                    amount: config.total_debt + additional_debt,
                    maximum: config.debt_ceiling,
                });
            }
        }
    }

    // Check ICR after borrow
    let new_total_debt = vault.total_debt + borrow_amount;
    let collateral_value = vault.total_collateral_value(&state.collaterals);
    let new_icr = (collateral_value as u128 * 10000 / new_total_debt as u128) as u64;
    let mcr = vault.weighted_mcr(&state.collaterals);

    if new_icr < mcr {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: new_icr,
            required_ratio: mcr,
        });
    }

    // Update vault
    vault.total_debt = new_total_debt;

    // Reallocate debt
    vault.allocate_debt(&state.collaterals);

    // Update state
    state.total_system_debt += borrow_amount;

    // Update individual collateral debt
    for pos in &vault.positions {
        if let Some(config) = state.get_collateral_mut(pos.coll_type) {
            config.total_debt += pos.allocated_debt;
        }
    }

    Ok(())
}

/// Repay debt on vault
pub fn repay_vault_debt(
    vault: &mut MultiCollateralVault,
    repay_amount: u64,
    state: &mut MultiCollateralState,
) -> ZkUsdResult<()> {
    if repay_amount > vault.total_debt {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: repay_amount,
            maximum: vault.total_debt,
        });
    }

    // Check remaining debt meets minimum (unless full repay)
    let remaining = vault.total_debt - repay_amount;
    if remaining > 0 && remaining < MIN_VAULT_DEBT {
        return Err(ZkUsdError::BelowMinimum {
            amount: remaining,
            minimum: MIN_VAULT_DEBT,
        });
    }

    // Calculate debt reduction per position
    for pos in &mut vault.positions {
        let reduction = (repay_amount as u128 * pos.allocated_debt as u128 / vault.total_debt as u128) as u64;
        if let Some(config) = state.get_collateral_mut(pos.coll_type) {
            config.total_debt = config.total_debt.saturating_sub(reduction);
        }
        pos.allocated_debt = pos.allocated_debt.saturating_sub(reduction);
    }

    // Update vault
    vault.total_debt = remaining;
    state.total_system_debt = state.total_system_debt.saturating_sub(repay_amount);

    Ok(())
}

/// Withdraw collateral from vault
pub fn withdraw_collateral(
    vault: &mut MultiCollateralVault,
    coll_type: CollateralType,
    amount: u64,
    state: &mut MultiCollateralState,
) -> ZkUsdResult<()> {
    // Remove collateral from vault
    vault.remove_collateral(coll_type, amount)?;

    // Check ICR after withdrawal
    let icr = vault.calculate_icr(&state.collaterals);
    let mcr = vault.weighted_mcr(&state.collaterals);

    if vault.total_debt > 0 && icr < mcr {
        // Revert the removal
        let config = state.get_collateral(coll_type)
            .ok_or(ZkUsdError::InvalidParameter)?;
        let value = (amount as u128 * config.last_price as u128 / 100_000_000) as u64;
        vault.add_collateral(coll_type, amount, value);

        return Err(ZkUsdError::Undercollateralized {
            current_ratio: icr,
            required_ratio: mcr,
        });
    }

    // Update state
    let config = state.get_collateral(coll_type)
        .ok_or(ZkUsdError::InvalidParameter)?;
    let value = (amount as u128 * config.last_price as u128 / 100_000_000) as u64;
    state.total_collateral_value = state.total_collateral_value.saturating_sub(value);

    Ok(())
}

/// Update oracle price for collateral
pub fn update_collateral_price(
    state: &mut MultiCollateralState,
    coll_type: CollateralType,
    new_price: u64,
    current_block: u64,
) -> ZkUsdResult<()> {
    let config = state.get_collateral_mut(coll_type)
        .ok_or(ZkUsdError::InvalidParameter)?;

    config.last_price = new_price;
    config.price_update_block = current_block;

    // Recalculate total collateral value would require iterating all vaults
    // In production, this would be tracked differently

    Ok(())
}

/// Liquidate undercollateralized vault
pub fn liquidate_multi_vault(
    vault: &MultiCollateralVault,
    state: &MultiCollateralState,
) -> ZkUsdResult<MultiVaultLiquidation> {
    if !vault.is_liquidatable(&state.collaterals) {
        return Err(ZkUsdError::ConditionNotMet);
    }

    let mut liquidations = Vec::new();
    let collateral_value = vault.total_collateral_value(&state.collaterals);

    for pos in &vault.positions {
        if let Some(config) = state.get_collateral(pos.coll_type) {
            let pos_value = (pos.amount as u128 * config.last_price as u128 / 100_000_000) as u64;
            let bonus = (pos_value as u128 * config.liquidation_bonus_bps as u128 / 10000) as u64;

            liquidations.push(PositionLiquidation {
                coll_type: pos.coll_type,
                collateral_seized: pos.amount,
                debt_covered: pos.allocated_debt,
                liquidation_bonus: bonus,
            });
        }
    }

    Ok(MultiVaultLiquidation {
        vault_id: vault.id,
        total_collateral_seized_value: collateral_value,
        total_debt_covered: vault.total_debt,
        position_liquidations: liquidations,
    })
}

/// Result of multi-collateral vault liquidation
#[derive(Debug, Clone)]
pub struct MultiVaultLiquidation {
    /// Vault ID
    pub vault_id: [u8; 32],
    /// Total collateral seized value (USD)
    pub total_collateral_seized_value: u64,
    /// Total debt covered
    pub total_debt_covered: u64,
    /// Individual position liquidations
    pub position_liquidations: Vec<PositionLiquidation>,
}

/// Individual position liquidation
#[derive(Debug, Clone)]
pub struct PositionLiquidation {
    /// Collateral type
    pub coll_type: CollateralType,
    /// Collateral amount seized
    pub collateral_seized: u64,
    /// Debt covered by this position
    pub debt_covered: u64,
    /// Liquidation bonus amount
    pub liquidation_bonus: u64,
}

// ============================================================================
// Helpers
// ============================================================================

/// Generate unique vault ID
fn generate_vault_id(owner: [u8; 32], block: u64) -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..24].copy_from_slice(&owner[0..24]);
    id[24..32].copy_from_slice(&block.to_le_bytes());
    id
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_state() -> MultiCollateralState {
        let mut state = MultiCollateralState::default();

        // Add BTC
        let mut btc_config = CollateralConfig::new(CollateralType::NativeBTC, [1u8; 32]);
        btc_config.last_price = 50_000_00000000; // $50,000
        state.add_collateral_type(btc_config).unwrap();

        // Add wBTC
        let mut wbtc_config = CollateralConfig::new(
            CollateralType::WrappedBTC { chain_id: 1 },
            [2u8; 32],
        );
        wbtc_config.last_price = 49_900_00000000; // $49,900 (slight discount)
        state.add_collateral_type(wbtc_config).unwrap();

        state
    }

    #[test]
    fn test_collateral_type_properties() {
        assert_eq!(CollateralType::NativeBTC.base_risk_weight(), 10000);
        assert_eq!(CollateralType::NativeBTC.min_mcr(), 11000);

        let wbtc = CollateralType::WrappedBTC { chain_id: 1 };
        assert_eq!(wbtc.min_mcr(), 12000);
    }

    #[test]
    fn test_collateral_config() {
        let config = CollateralConfig::new(CollateralType::NativeBTC, [1u8; 32]);
        assert_eq!(config.mcr_bps, 11000);
        assert_eq!(config.ccr_bps, 15000); // MCR + 40%
        assert!(config.is_active);
    }

    #[test]
    fn test_open_multi_vault() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 1_00000000), // 1 BTC
        ];

        let vault = open_multi_vault(
            [3u8; 32],
            positions,
            20_000_00000000, // $20k debt
            &mut state,
            100,
        ).unwrap();

        assert_eq!(vault.positions.len(), 1);
        assert_eq!(vault.total_debt, 20_000_00000000);
        // ICR = 50000 / 20000 = 250%
        let icr = vault.calculate_icr(&state.collaterals);
        assert_eq!(icr, 25000);
    }

    #[test]
    fn test_multi_collateral_vault() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 50000000), // 0.5 BTC = $25k
            (CollateralType::WrappedBTC { chain_id: 1 }, 50000000), // 0.5 wBTC = ~$24.95k
        ];

        let vault = open_multi_vault(
            [3u8; 32],
            positions,
            20_000_00000000,
            &mut state,
            100,
        ).unwrap();

        assert_eq!(vault.positions.len(), 2);

        // Check diversification discount applied
        let mcr = vault.weighted_mcr(&state.collaterals);
        // Should be less than simple average due to discount
        assert!(mcr < 11500); // Below average of 11000 and 12000
    }

    #[test]
    fn test_undercollateralized_rejected() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 10000000), // 0.1 BTC = $5k
        ];

        let result = open_multi_vault(
            [3u8; 32],
            positions,
            10_000_00000000, // $10k debt (would be 50% ICR)
            &mut state,
            100,
        );

        assert!(matches!(result, Err(ZkUsdError::Undercollateralized { .. })));
    }

    #[test]
    fn test_add_collateral() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 1_00000000),
        ];

        let mut vault = open_multi_vault(
            [3u8; 32],
            positions,
            20_000_00000000,
            &mut state,
            100,
        ).unwrap();

        let old_icr = vault.calculate_icr(&state.collaterals);

        // Add more collateral
        add_vault_collateral(
            &mut vault,
            CollateralType::NativeBTC,
            50000000, // 0.5 BTC
            &mut state,
        ).unwrap();

        let new_icr = vault.calculate_icr(&state.collaterals);
        assert!(new_icr > old_icr);
    }

    #[test]
    fn test_borrow_more() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 1_00000000), // 1 BTC = $50k
        ];

        let mut vault = open_multi_vault(
            [3u8; 32],
            positions,
            10_000_00000000, // $10k debt, ICR = 500%
            &mut state,
            100,
        ).unwrap();

        // Borrow more
        borrow_from_vault(&mut vault, 10_000_00000000, &mut state).unwrap();

        assert_eq!(vault.total_debt, 20_000_00000000);
        assert_eq!(state.total_system_debt, 20_000_00000000);
    }

    #[test]
    fn test_repay_debt() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 1_00000000),
        ];

        let mut vault = open_multi_vault(
            [3u8; 32],
            positions,
            20_000_00000000,
            &mut state,
            100,
        ).unwrap();

        repay_vault_debt(&mut vault, 10_000_00000000, &mut state).unwrap();

        assert_eq!(vault.total_debt, 10_000_00000000);
        assert_eq!(state.total_system_debt, 10_000_00000000);
    }

    #[test]
    fn test_withdraw_collateral() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 2_00000000), // 2 BTC = $100k
        ];

        let mut vault = open_multi_vault(
            [3u8; 32],
            positions,
            20_000_00000000, // ICR = 500%
            &mut state,
            100,
        ).unwrap();

        // Withdraw some collateral
        withdraw_collateral(
            &mut vault,
            CollateralType::NativeBTC,
            50000000, // 0.5 BTC
            &mut state,
        ).unwrap();

        // Should still be valid
        let icr = vault.calculate_icr(&state.collaterals);
        assert!(icr >= 11000); // Above MCR
    }

    #[test]
    fn test_liquidation() {
        let mut state = create_test_state();

        let positions = vec![
            (CollateralType::NativeBTC, 1_00000000),
        ];

        let vault = open_multi_vault(
            [3u8; 32],
            positions,
            20_000_00000000,
            &mut state,
            100,
        ).unwrap();

        // Simulate price drop
        state.get_collateral_mut(CollateralType::NativeBTC).unwrap().last_price = 20_000_00000000; // $20k

        // Now ICR = 20000 / 20000 = 100%, below MCR
        assert!(vault.is_liquidatable(&state.collaterals));

        let liquidation = liquidate_multi_vault(&vault, &state).unwrap();
        assert_eq!(liquidation.total_debt_covered, 20_000_00000000);
        assert!(!liquidation.position_liquidations.is_empty());
    }

    #[test]
    fn test_recovery_mode() {
        let mut state = create_test_state();
        state.total_system_debt = 100_00000000;
        state.total_collateral_value = 140_00000000; // TCR = 140%

        assert!(state.is_recovery_mode()); // Below 150%

        state.total_collateral_value = 160_00000000; // TCR = 160%
        assert!(!state.is_recovery_mode());
    }

    #[test]
    fn test_debt_ceiling() {
        let mut state = create_test_state();

        // Set low ceiling
        state.get_collateral_mut(CollateralType::NativeBTC).unwrap().debt_ceiling = 10_000_00000000;

        let positions = vec![
            (CollateralType::NativeBTC, 1_00000000),
        ];

        let mut vault = open_multi_vault(
            [3u8; 32],
            positions,
            5_000_00000000,
            &mut state,
            100,
        ).unwrap();

        // Try to borrow more than ceiling
        let result = borrow_from_vault(&mut vault, 10_000_00000000, &mut state);
        assert!(matches!(result, Err(ZkUsdError::ExceedsMaximum { .. })));
    }
}
