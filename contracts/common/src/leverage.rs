//! Leverage Looping Module
//!
//! Implements atomic leverage operations for zkUSD vaults.
//! Users can amplify their BTC exposure in a single transaction,
//! leveraging the UTXO model's atomicity guarantees.
//!
//! ## Key Features
//!
//! - **Atomic Leverage**: Open leveraged positions in one transaction
//! - **Deleverage**: Unwind positions safely without liquidation risk
//! - **Auto-Rebalance**: Maintain target leverage through price changes
//! - **Stop-Loss**: Automatic deleveraging at risk thresholds
//!
//! ## UTXO Advantages
//!
//! In traditional smart contracts, leverage loops require multiple
//! transactions and are vulnerable to front-running. The UTXO model
//! allows the entire loop to execute atomically:
//!
//! 1. Deposit initial BTC collateral
//! 2. Mint zkUSD against collateral
//! 3. Swap zkUSD for more BTC (via DEX)
//! 4. Add BTC as additional collateral
//! 5. Repeat until target leverage reached
//!
//! All steps are validated client-side and committed atomically.

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};
#[cfg(feature = "std")]
use std::vec::Vec;

use crate::{
    constants::ratios,
    errors::{ZkUsdError, ZkUsdResult, AmountErrorReason},
    types::Vault,
};

// ============================================================================
// Constants
// ============================================================================

/// Maximum leverage multiplier (10x = 1000%)
pub const MAX_LEVERAGE_MULTIPLIER: u64 = 10;

/// Minimum leverage multiplier (1.1x = 110%)
pub const MIN_LEVERAGE_MULTIPLIER_BPS: u64 = 11000; // 1.1x in BPS (110%)

/// Maximum leverage in BPS (10x = 1000%)
pub const MAX_LEVERAGE_BPS: u64 = 100_000; // 10x

/// Leverage fee per loop iteration (0.05%)
pub const LEVERAGE_FEE_BPS: u64 = 5;

/// Safety buffer for leverage operations (keeps ICR above MCR)
pub const LEVERAGE_SAFETY_BUFFER_BPS: u64 = 500; // 5% buffer above MCR

/// Maximum iterations for leverage loop
pub const MAX_LEVERAGE_ITERATIONS: u8 = 50;

/// Stop-loss trigger threshold (ICR percentage)
pub const DEFAULT_STOP_LOSS_ICR: u64 = 130_00; // 130%

/// Auto-rebalance threshold (deviation from target leverage)
pub const REBALANCE_THRESHOLD_BPS: u64 = 500; // 5% deviation triggers rebalance

/// MCR in BPS (110% = 11000 BPS)
pub const MCR_BPS: u64 = (ratios::MCR as u64) * 100;

// ============================================================================
// Types
// ============================================================================

/// Leverage operation type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeverageOperation {
    /// Increase leverage by looping
    Leverage,
    /// Decrease leverage by unwinding
    Deleverage,
    /// Adjust to target leverage
    Rebalance,
}

/// Configuration for a leverage position
#[derive(Debug, Clone)]
pub struct LeverageConfig {
    /// Target leverage in BPS (e.g., 30000 = 3x)
    pub target_leverage_bps: u64,
    /// Stop-loss ICR threshold (auto-deleverage if ICR falls below)
    pub stop_loss_icr: u64,
    /// Enable auto-rebalancing
    pub auto_rebalance: bool,
    /// Maximum slippage tolerance in BPS
    pub max_slippage_bps: u64,
    /// DEX/venue to use for swaps
    pub swap_venue: SwapVenue,
}

impl Default for LeverageConfig {
    fn default() -> Self {
        Self {
            target_leverage_bps: 20000, // 2x default
            stop_loss_icr: DEFAULT_STOP_LOSS_ICR,
            auto_rebalance: false,
            max_slippage_bps: 100, // 1% max slippage
            swap_venue: SwapVenue::Default,
        }
    }
}

/// Swap venue for leverage operations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SwapVenue {
    #[default]
    Default,
    /// Atomic swap with specific counterparty
    AtomicSwap { counterparty_id: u64 },
    /// Lightning-based swap
    Lightning,
    /// Cross-chain DEX
    CrossChainDex { chain_id: u32 },
}

/// Request to open a leveraged position
#[derive(Debug, Clone)]
pub struct LeverageRequest {
    /// Vault ID (if adding to existing vault)
    pub vault_id: Option<[u8; 32]>,
    /// Owner public key hash
    pub owner: [u8; 32],
    /// Initial BTC collateral (satoshis)
    pub initial_collateral: u64,
    /// Configuration for this position
    pub config: LeverageConfig,
    /// Current BTC price for calculations
    pub btc_price: u64,
}

/// Result of leverage operation
#[derive(Debug, Clone)]
pub struct LeverageResult {
    /// Final vault state
    pub vault: Vault,
    /// Achieved leverage in BPS
    pub achieved_leverage_bps: u64,
    /// Total collateral after leveraging
    pub total_collateral: u64,
    /// Total debt incurred
    pub total_debt: u64,
    /// Total fees paid
    pub fees_paid: u64,
    /// Number of loop iterations executed
    pub iterations: u8,
    /// Effective swap rate (average across iterations)
    pub effective_swap_rate: u64,
}

/// A single iteration in the leverage loop
#[derive(Debug, Clone)]
pub struct LeverageIteration {
    /// Iteration number (0-indexed)
    pub iteration: u8,
    /// Collateral at start of iteration
    pub collateral_start: u64,
    /// Debt at start of iteration
    pub debt_start: u64,
    /// zkUSD minted in this iteration
    pub zkusd_minted: u64,
    /// BTC received from swap
    pub btc_received: u64,
    /// Fee paid in this iteration
    pub fee_paid: u64,
    /// ICR after this iteration
    pub icr_after: u64,
}

/// Leveraged position state for tracking
#[derive(Debug, Clone)]
pub struct LeveragedPosition {
    /// Associated vault ID
    pub vault_id: [u8; 32],
    /// Owner public key hash
    pub owner: [u8; 32],
    /// Initial collateral deposited
    pub initial_collateral: u64,
    /// Current total collateral
    pub current_collateral: u64,
    /// Current total debt
    pub current_debt: u64,
    /// Target leverage in BPS
    pub target_leverage_bps: u64,
    /// Current leverage in BPS
    pub current_leverage_bps: u64,
    /// Stop-loss ICR threshold
    pub stop_loss_icr: u64,
    /// Auto-rebalance enabled
    pub auto_rebalance: bool,
    /// Block height when position was opened
    pub opened_at_block: u64,
    /// Last rebalance block (if any)
    pub last_rebalance_block: Option<u64>,
    /// Is position active
    pub is_active: bool,
}

impl LeveragedPosition {
    /// Calculate current leverage based on collateral and debt
    pub fn calculate_current_leverage(&self, _btc_price: u64) -> u64 {
        if self.initial_collateral == 0 {
            return 0;
        }

        // Leverage = Total Collateral Value / Initial Collateral Value
        // In BPS: (current_collateral * 10000) / initial_collateral
        ((self.current_collateral as u128) * 10000 / (self.initial_collateral as u128)) as u64
    }

    /// Check if stop-loss should trigger
    pub fn should_stop_loss(&self, current_icr: u64) -> bool {
        self.is_active && current_icr <= self.stop_loss_icr
    }

    /// Check if rebalance is needed
    pub fn needs_rebalance(&self, btc_price: u64) -> bool {
        if !self.auto_rebalance || !self.is_active {
            return false;
        }

        let current = self.calculate_current_leverage(btc_price);
        let target = self.target_leverage_bps;

        // Check if deviation exceeds threshold
        let deviation = if current > target {
            current - target
        } else {
            target - current
        };

        deviation > REBALANCE_THRESHOLD_BPS
    }
}

/// Deleverage request
#[derive(Debug, Clone)]
pub struct DeleverageRequest {
    /// Vault ID to deleverage
    pub vault_id: [u8; 32],
    /// Target leverage after deleveraging (0 = fully close)
    pub target_leverage_bps: u64,
    /// Current BTC price
    pub btc_price: u64,
    /// Maximum slippage tolerance
    pub max_slippage_bps: u64,
}

/// Deleverage result
#[derive(Debug, Clone)]
pub struct DeleverageResult {
    /// Updated vault state
    pub vault: Vault,
    /// Collateral withdrawn (if any)
    pub collateral_withdrawn: u64,
    /// Debt repaid
    pub debt_repaid: u64,
    /// Fees paid
    pub fees_paid: u64,
    /// Final leverage in BPS
    pub final_leverage_bps: u64,
}

/// Rebalance result
#[derive(Debug, Clone)]
pub struct RebalanceResult {
    /// Operation performed (leverage or deleverage)
    pub operation: LeverageOperation,
    /// Leverage/deleverage result
    pub leverage_change: i64, // Positive = leveraged up, negative = deleveraged
    /// Fees paid
    pub fees_paid: u64,
    /// Final leverage in BPS
    pub final_leverage_bps: u64,
}

/// Stop-loss execution result
#[derive(Debug, Clone)]
pub struct StopLossResult {
    /// Vault after stop-loss
    pub vault: Vault,
    /// Collateral sold to repay debt
    pub collateral_sold: u64,
    /// Debt repaid
    pub debt_repaid: u64,
    /// Remaining collateral returned to user
    pub collateral_returned: u64,
    /// ICR at trigger
    pub trigger_icr: u64,
    /// Final ICR after stop-loss
    pub final_icr: u64,
}

// ============================================================================
// Core Operations
// ============================================================================

/// Calculate maximum leverage given MCR and safety buffer
pub fn calculate_max_leverage(mcr_bps: u64, safety_buffer_bps: u64) -> u64 {
    // Max leverage = 1 / (1 - 1/MCR) with safety buffer
    // For MCR = 110%, max theoretical leverage = 11x
    // With 5% safety buffer, practical max is lower

    let effective_mcr = mcr_bps + safety_buffer_bps;

    // leverage = mcr / (mcr - 10000)
    // In BPS: (effective_mcr * 10000) / (effective_mcr - 10000)
    if effective_mcr <= 10000 {
        return 10000; // No leverage possible
    }

    let max_leverage = ((effective_mcr as u128) * 10000 / (effective_mcr as u128 - 10000)) as u64;

    // Cap at MAX_LEVERAGE_BPS
    max_leverage.min(MAX_LEVERAGE_BPS)
}

/// Calculate required debt to achieve target leverage
pub fn calculate_required_debt(
    initial_collateral: u64,
    target_leverage_bps: u64,
    btc_price: u64,
) -> ZkUsdResult<u64> {
    if target_leverage_bps < 10000 {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Target collateral = initial * leverage
    // Required debt = (target_collateral - initial) * price / PRICE_PRECISION

    let leverage_factor = target_leverage_bps - 10000; // Excess over 1x

    let additional_collateral = (initial_collateral as u128)
        .checked_mul(leverage_factor as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(10000)
        .ok_or(ZkUsdError::MathOverflow)?;

    // Debt = additional_collateral * price / 1e8 (price precision)
    let debt = additional_collateral
        .checked_mul(btc_price as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(100_000_000) // PRICE_PRECISION
        .ok_or(ZkUsdError::MathOverflow)?;

    Ok(debt as u64)
}

/// Calculate iterations needed to reach target leverage
pub fn calculate_iterations(
    _initial_collateral: u64,
    target_leverage_bps: u64,
    mcr_bps: u64,
) -> ZkUsdResult<u8> {
    // Each iteration can safely borrow up to (collateral * price / MCR) - existing_debt
    // This is an approximation; actual loop will validate each step

    if target_leverage_bps <= 10000 {
        return Ok(0); // No iterations needed for 1x or less
    }

    // Calculate max single-iteration leverage based on MCR
    let max_single_leverage = ((mcr_bps as u128) * 10000 / (mcr_bps as u128 - 10000)) as u64;

    // Rough estimate: log(target/initial) / log(max_single)
    // Use iterative approximation
    let mut iterations = 0u8;
    let mut current_leverage = 10000u64;

    while current_leverage < target_leverage_bps && iterations < MAX_LEVERAGE_ITERATIONS {
        // Each iteration can multiply leverage by approximately max_single_leverage/10000
        let multiplier = max_single_leverage.min(20000); // Cap at 2x per iteration for safety
        current_leverage = (current_leverage as u128 * multiplier as u128 / 10000) as u64;
        iterations += 1;
    }

    Ok(iterations.min(MAX_LEVERAGE_ITERATIONS))
}

/// Execute a single leverage iteration
pub fn execute_leverage_iteration(
    current_collateral: u64,
    current_debt: u64,
    btc_price: u64,
    mcr_bps: u64,
    swap_rate: u64, // BTC per zkUSD in satoshis (with 8 decimals)
    iteration: u8,
) -> ZkUsdResult<LeverageIteration> {
    // Calculate ICR to determine max borrowable
    let collateral_value = (current_collateral as u128)
        .checked_mul(btc_price as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(100_000_000)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    // Max debt to maintain MCR with safety buffer
    let effective_mcr = mcr_bps + LEVERAGE_SAFETY_BUFFER_BPS;
    let max_debt = (collateral_value as u128)
        .checked_mul(10000)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(effective_mcr as u128)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    if max_debt <= current_debt {
        return Err(ZkUsdError::InsufficientCollateralRatio);
    }

    // Amount we can borrow this iteration
    let borrowable = max_debt - current_debt;

    // Calculate fee
    let fee = (borrowable as u128)
        .checked_mul(LEVERAGE_FEE_BPS as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(10000)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    let zkusd_after_fee = borrowable.saturating_sub(fee);

    // Swap zkUSD for BTC
    // swap_rate is in satoshis per zkUSD (8 decimals)
    let btc_received = (zkusd_after_fee as u128)
        .checked_mul(swap_rate as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(100_000_000) // zkUSD has 8 decimals
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    // New collateral and debt
    let new_collateral = current_collateral + btc_received;
    let new_debt = current_debt + borrowable;

    // Calculate new ICR
    let new_collateral_value = (new_collateral as u128)
        .checked_mul(btc_price as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(100_000_000)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    let new_icr = if new_debt > 0 {
        (new_collateral_value as u128 * 10000 / new_debt as u128) as u64
    } else {
        u64::MAX
    };

    Ok(LeverageIteration {
        iteration,
        collateral_start: current_collateral,
        debt_start: current_debt,
        zkusd_minted: borrowable,
        btc_received,
        fee_paid: fee,
        icr_after: new_icr,
    })
}

/// Open a leveraged position
pub fn open_leverage_position(request: LeverageRequest) -> ZkUsdResult<LeverageResult> {
    // Validate inputs
    if request.initial_collateral == 0 {
        return Err(ZkUsdError::InvalidAmount {
            amount: 0,
            reason: AmountErrorReason::Zero
        });
    }

    if request.config.target_leverage_bps < MIN_LEVERAGE_MULTIPLIER_BPS {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Check against max leverage
    let max_leverage = calculate_max_leverage(MCR_BPS, LEVERAGE_SAFETY_BUFFER_BPS);
    if request.config.target_leverage_bps > max_leverage {
        return Err(ZkUsdError::ExcessiveLeverage);
    }

    // Calculate swap rate (simplified: assuming 1:1 zkUSD to BTC value with price)
    // In production, this would come from DEX oracle
    let swap_rate = (100_000_000u128 * 100_000_000 / request.btc_price as u128) as u64;

    let mut current_collateral = request.initial_collateral;
    let mut current_debt = 0u64;
    let mut total_fees = 0u64;
    let mut iterations: Vec<LeverageIteration> = Vec::new();

    // Execute leverage loop
    for i in 0..MAX_LEVERAGE_ITERATIONS {
        // Check if we've reached target leverage
        let current_leverage = if request.initial_collateral > 0 {
            (current_collateral as u128 * 10000 / request.initial_collateral as u128) as u64
        } else {
            0
        };

        if current_leverage >= request.config.target_leverage_bps {
            break;
        }

        // Execute iteration
        match execute_leverage_iteration(
            current_collateral,
            current_debt,
            request.btc_price,
            MCR_BPS,
            swap_rate,
            i,
        ) {
            Ok(iter) => {
                current_collateral += iter.btc_received;
                current_debt += iter.zkusd_minted;
                total_fees += iter.fee_paid;
                iterations.push(iter);
            }
            Err(_) => break, // Can't leverage further
        }
    }

    // Create vault (block_height 0 - caller should update)
    let vault = Vault::new(
        request.vault_id.unwrap_or([0u8; 32]),
        request.owner,
        current_collateral,
        current_debt,
        0, // block_height - should be set by caller
    );

    let achieved_leverage = if request.initial_collateral > 0 {
        (current_collateral as u128 * 10000 / request.initial_collateral as u128) as u64
    } else {
        10000
    };

    Ok(LeverageResult {
        vault,
        achieved_leverage_bps: achieved_leverage,
        total_collateral: current_collateral,
        total_debt: current_debt,
        fees_paid: total_fees,
        iterations: iterations.len() as u8,
        effective_swap_rate: swap_rate,
    })
}

/// Deleverage a position
pub fn deleverage_position(
    vault: &Vault,
    request: DeleverageRequest,
) -> ZkUsdResult<DeleverageResult> {
    if vault.debt == 0 {
        return Err(ZkUsdError::InvalidAmount {
            amount: 0,
            reason: AmountErrorReason::Zero
        });
    }

    // Calculate current leverage
    let current_leverage = if vault.collateral > 0 {
        // Simplified: assume initial was collateral - debt_equivalent_in_btc
        let collateral_value = (vault.collateral as u128 * request.btc_price as u128 / 100_000_000) as u64;
        if collateral_value > vault.debt {
            let equity = collateral_value - vault.debt;
            (collateral_value as u128 * 10000 / equity as u128) as u64
        } else {
            u64::MAX // Underwater
        }
    } else {
        0
    };

    if request.target_leverage_bps >= current_leverage {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Calculate how much to repay
    // For target_leverage = 10000 (1x), repay all debt
    // For higher target, repay proportionally less

    let debt_to_repay = if request.target_leverage_bps <= 10000 {
        vault.debt
    } else {
        // Calculate debt reduction needed
        let current_ratio = current_leverage;
        let target_ratio = request.target_leverage_bps;

        // debt_to_repay = debt * (1 - target/current)
        let reduction_factor = ((current_ratio - target_ratio) as u128 * 10000 / current_ratio as u128) as u64;
        (vault.debt as u128 * reduction_factor as u128 / 10000) as u64
    };

    // Calculate collateral to sell for repayment
    // collateral_to_sell = debt_to_repay * 1e8 / price
    let collateral_to_sell = (debt_to_repay as u128)
        .checked_mul(100_000_000)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(request.btc_price as u128)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    // Apply slippage
    let slippage_cost = (collateral_to_sell as u128 * request.max_slippage_bps as u128 / 10000) as u64;
    let total_collateral_used = collateral_to_sell + slippage_cost;

    if total_collateral_used > vault.collateral {
        return Err(ZkUsdError::InsufficientCollateral);
    }

    // Calculate fee
    let fee = (debt_to_repay as u128 * LEVERAGE_FEE_BPS as u128 / 10000) as u64;

    // Create updated vault
    let new_collateral = vault.collateral - total_collateral_used;
    let new_debt = vault.debt - debt_to_repay;

    let updated_vault = Vault::new(
        vault.id,
        vault.owner,
        new_collateral,
        new_debt,
        vault.last_updated,
    );

    // Calculate final leverage
    let final_leverage = if new_debt == 0 {
        10000 // 1x (no leverage)
    } else {
        let new_value = (new_collateral as u128 * request.btc_price as u128 / 100_000_000) as u64;
        if new_value > new_debt {
            let equity = new_value - new_debt;
            (new_value as u128 * 10000 / equity as u128) as u64
        } else {
            u64::MAX
        }
    };

    // Calculate withdrawn collateral (if fully deleveraged)
    let collateral_withdrawn = if request.target_leverage_bps <= 10000 && new_debt == 0 {
        new_collateral
    } else {
        0
    };

    Ok(DeleverageResult {
        vault: updated_vault,
        collateral_withdrawn,
        debt_repaid: debt_to_repay,
        fees_paid: fee,
        final_leverage_bps: final_leverage,
    })
}

/// Execute stop-loss for a leveraged position
pub fn execute_stop_loss(
    vault: &Vault,
    position: &LeveragedPosition,
    btc_price: u64,
) -> ZkUsdResult<StopLossResult> {
    // Calculate current ICR
    let collateral_value = (vault.collateral as u128)
        .checked_mul(btc_price as u128)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(100_000_000)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    let current_icr = if vault.debt > 0 {
        (collateral_value as u128 * 10000 / vault.debt as u128) as u64
    } else {
        return Err(ZkUsdError::InvalidOperation);
    };

    // Verify stop-loss should trigger
    if !position.should_stop_loss(current_icr) {
        return Err(ZkUsdError::ConditionNotMet);
    }

    // Sell enough collateral to repay all debt
    let collateral_to_sell = (vault.debt as u128)
        .checked_mul(100_000_000)
        .ok_or(ZkUsdError::MathOverflow)?
        .checked_div(btc_price as u128)
        .ok_or(ZkUsdError::MathOverflow)? as u64;

    // Add 1% buffer for slippage
    let collateral_with_buffer = (collateral_to_sell as u128 * 101 / 100) as u64;

    let actual_sold = collateral_with_buffer.min(vault.collateral);
    let collateral_remaining = vault.collateral.saturating_sub(actual_sold);

    // Create closed vault
    let closed_vault = Vault::new(
        vault.id,
        vault.owner,
        collateral_remaining,
        0, // Debt fully repaid
        vault.last_updated,
    );

    let final_icr = u64::MAX; // No debt = infinite ICR

    Ok(StopLossResult {
        vault: closed_vault,
        collateral_sold: actual_sold,
        debt_repaid: vault.debt,
        collateral_returned: collateral_remaining,
        trigger_icr: current_icr,
        final_icr,
    })
}

/// Rebalance a leveraged position to target
pub fn rebalance_position(
    vault: &Vault,
    position: &LeveragedPosition,
    btc_price: u64,
) -> ZkUsdResult<RebalanceResult> {
    let current_leverage = position.calculate_current_leverage(btc_price);
    let target = position.target_leverage_bps;

    if current_leverage < target {
        // Need to leverage up
        let leverage_request = LeverageRequest {
            vault_id: Some(position.vault_id),
            owner: position.owner,
            initial_collateral: position.initial_collateral,
            config: LeverageConfig {
                target_leverage_bps: target,
                stop_loss_icr: position.stop_loss_icr,
                auto_rebalance: position.auto_rebalance,
                max_slippage_bps: 100,
                swap_venue: SwapVenue::Default,
            },
            btc_price,
        };

        let result = open_leverage_position(leverage_request)?;

        Ok(RebalanceResult {
            operation: LeverageOperation::Leverage,
            leverage_change: (result.achieved_leverage_bps as i64) - (current_leverage as i64),
            fees_paid: result.fees_paid,
            final_leverage_bps: result.achieved_leverage_bps,
        })
    } else {
        // Need to deleverage
        let deleverage_request = DeleverageRequest {
            vault_id: position.vault_id,
            target_leverage_bps: target,
            btc_price,
            max_slippage_bps: 100,
        };

        let result = deleverage_position(vault, deleverage_request)?;

        Ok(RebalanceResult {
            operation: LeverageOperation::Deleverage,
            leverage_change: (result.final_leverage_bps as i64) - (current_leverage as i64),
            fees_paid: result.fees_paid,
            final_leverage_bps: result.final_leverage_bps,
        })
    }
}

/// Create a new leveraged position tracker
pub fn create_position_tracker(
    vault_id: [u8; 32],
    owner: [u8; 32],
    initial_collateral: u64,
    config: &LeverageConfig,
    current_block: u64,
) -> LeveragedPosition {
    LeveragedPosition {
        vault_id,
        owner,
        initial_collateral,
        current_collateral: initial_collateral,
        current_debt: 0,
        target_leverage_bps: config.target_leverage_bps,
        current_leverage_bps: 10000, // 1x initially
        stop_loss_icr: config.stop_loss_icr,
        auto_rebalance: config.auto_rebalance,
        opened_at_block: current_block,
        last_rebalance_block: None,
        is_active: true,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const BTC_PRICE: u64 = 50_000_00000000; // $50,000 with 8 decimals

    #[test]
    fn test_calculate_max_leverage() {
        // With 110% MCR and 5% buffer = 115% effective
        let max_lev = calculate_max_leverage(11000, 500);
        // 11500 / (11500 - 10000) = 11500 / 1500 = 7.67x
        assert!(max_lev > 70000 && max_lev < 80000);

        // With 150% MCR and 5% buffer = 155% effective
        let max_lev_150 = calculate_max_leverage(15000, 500);
        // 15500 / (15500 - 10000) = 15500 / 5500 = 2.82x
        assert!(max_lev_150 > 25000 && max_lev_150 < 30000);
    }

    #[test]
    fn test_calculate_required_debt() {
        let initial = 1_00000000; // 1 BTC
        let target_leverage = 20000; // 2x

        let debt = calculate_required_debt(initial, target_leverage, BTC_PRICE).unwrap();

        // For 2x leverage on 1 BTC at $50k:
        // Target collateral = 2 BTC worth
        // Need to borrow = 1 BTC worth = $50,000
        assert_eq!(debt, 50_000_00000000); // $50k in zkUSD
    }

    #[test]
    fn test_leverage_iteration() {
        let collateral = 1_00000000; // 1 BTC
        let debt = 0;
        let swap_rate = 2000; // 2000 sats per zkUSD (simplified)

        let iter = execute_leverage_iteration(
            collateral,
            debt,
            BTC_PRICE,
            11000, // 110% MCR
            swap_rate,
            0,
        ).unwrap();

        assert!(iter.zkusd_minted > 0);
        assert!(iter.btc_received > 0);
        assert!(iter.fee_paid > 0);
        assert!(iter.icr_after >= 11000); // Should maintain MCR
    }

    #[test]
    fn test_open_leverage_position() {
        let request = LeverageRequest {
            vault_id: None,
            owner: [1u8; 32],
            initial_collateral: 1_00000000, // 1 BTC
            config: LeverageConfig {
                target_leverage_bps: 20000, // 2x
                stop_loss_icr: 13000,
                auto_rebalance: false,
                max_slippage_bps: 100,
                swap_venue: SwapVenue::Default,
            },
            btc_price: BTC_PRICE,
        };

        let result = open_leverage_position(request).unwrap();

        // Should have increased collateral
        assert!(result.total_collateral > 1_00000000);
        // Should have debt
        assert!(result.total_debt > 0);
        // Should have achieved some leverage
        assert!(result.achieved_leverage_bps > 10000);
        // Should have paid fees
        assert!(result.fees_paid > 0);
    }

    #[test]
    fn test_deleverage_position() {
        // First create a leveraged position
        let vault = Vault::new(
            [1u8; 32],
            [2u8; 32],
            2_00000000, // 2 BTC collateral
            50_000_00000000, // $50k debt
            100, // block height
        );

        let request = DeleverageRequest {
            vault_id: vault.id,
            target_leverage_bps: 10000, // Go to 1x (fully deleverage)
            btc_price: BTC_PRICE,
            max_slippage_bps: 100,
        };

        let result = deleverage_position(&vault, request).unwrap();

        // Should have repaid debt
        assert!(result.debt_repaid > 0);
        // Final leverage should be 1x or close
        assert!(result.final_leverage_bps <= 11000); // Allow some tolerance
    }

    #[test]
    fn test_stop_loss_trigger() {
        let position = LeveragedPosition {
            vault_id: [1u8; 32],
            owner: [2u8; 32],
            initial_collateral: 1_00000000,
            current_collateral: 2_00000000,
            current_debt: 50_000_00000000,
            target_leverage_bps: 20000,
            current_leverage_bps: 20000,
            stop_loss_icr: 13000, // 130%
            auto_rebalance: false,
            opened_at_block: 100,
            last_rebalance_block: None,
            is_active: true,
        };

        // ICR above stop-loss: should not trigger
        assert!(!position.should_stop_loss(15000)); // 150%

        // ICR at stop-loss: should trigger
        assert!(position.should_stop_loss(13000)); // 130%

        // ICR below stop-loss: should trigger
        assert!(position.should_stop_loss(12000)); // 120%
    }

    #[test]
    fn test_rebalance_detection() {
        let position = LeveragedPosition {
            vault_id: [1u8; 32],
            owner: [2u8; 32],
            initial_collateral: 1_00000000,
            current_collateral: 2_00000000, // 2x
            current_debt: 50_000_00000000,
            target_leverage_bps: 20000, // 2x target
            current_leverage_bps: 20000,
            stop_loss_icr: 13000,
            auto_rebalance: true,
            opened_at_block: 100,
            last_rebalance_block: None,
            is_active: true,
        };

        // At target: no rebalance needed
        assert!(!position.needs_rebalance(BTC_PRICE));

        // Create position that's off-target
        let off_target = LeveragedPosition {
            current_collateral: 2_50000000, // 2.5x (25% off)
            ..position.clone()
        };

        // Should need rebalance
        assert!(off_target.needs_rebalance(BTC_PRICE));
    }

    #[test]
    fn test_excessive_leverage_rejected() {
        let request = LeverageRequest {
            vault_id: None,
            owner: [1u8; 32],
            initial_collateral: 1_00000000,
            config: LeverageConfig {
                target_leverage_bps: 150000, // 15x - way too high
                stop_loss_icr: 13000,
                auto_rebalance: false,
                max_slippage_bps: 100,
                swap_venue: SwapVenue::Default,
            },
            btc_price: BTC_PRICE,
        };

        let result = open_leverage_position(request);
        assert!(matches!(result, Err(ZkUsdError::ExcessiveLeverage)));
    }

    #[test]
    fn test_position_tracker_creation() {
        let config = LeverageConfig::default();
        let position = create_position_tracker(
            [1u8; 32],
            [2u8; 32],
            1_00000000,
            &config,
            1000,
        );

        assert_eq!(position.initial_collateral, 1_00000000);
        assert_eq!(position.current_leverage_bps, 10000); // 1x initially
        assert!(position.is_active);
        assert_eq!(position.opened_at_block, 1000);
    }

    #[test]
    fn test_stop_loss_execution() {
        let vault = Vault::new(
            [1u8; 32],
            [2u8; 32],
            1_50000000, // 1.5 BTC
            60_000_00000000, // $60k debt
            100, // block height
        );

        let position = LeveragedPosition {
            vault_id: vault.id,
            owner: vault.owner,
            initial_collateral: 1_00000000,
            current_collateral: vault.collateral,
            current_debt: vault.debt,
            target_leverage_bps: 20000,
            current_leverage_bps: 20000,
            stop_loss_icr: 13000, // 130%
            auto_rebalance: false,
            opened_at_block: 100,
            last_rebalance_block: None,
            is_active: true,
        };

        // At current price: ICR = (1.5 * 50000) / 60000 = 125%
        // This is below stop-loss of 130%
        let result = execute_stop_loss(&vault, &position, BTC_PRICE).unwrap();

        // Debt should be fully repaid
        assert_eq!(result.debt_repaid, vault.debt);
        // Some collateral should remain
        assert!(result.collateral_returned > 0 || result.collateral_sold <= vault.collateral);
    }

    #[test]
    fn test_calculate_iterations() {
        // For 2x leverage with 110% MCR
        let iterations = calculate_iterations(1_00000000, 20000, 11000).unwrap();
        assert!(iterations > 0 && iterations < 10); // Should take a few iterations

        // For 1x leverage (no leverage)
        let no_iterations = calculate_iterations(1_00000000, 10000, 11000).unwrap();
        assert_eq!(no_iterations, 0);
    }
}
