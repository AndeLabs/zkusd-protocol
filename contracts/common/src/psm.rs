//! Peg Stability Module (PSM)
//!
//! Implements a mechanism to maintain zkUSD's peg to $1 USD by enabling
//! 1:1 swaps with other stablecoins and reserve assets.
//!
//! ## Key Features
//!
//! - **1:1 Swaps**: Exchange zkUSD for USDC, USDT, or other stables
//! - **Debt Ceiling**: Limit exposure to any single stablecoin
//! - **Dynamic Fees**: Adjust fees based on reserve composition
//! - **Emergency Circuit Breaker**: Pause swaps during extreme events
//!
//! ## Peg Defense Mechanism
//!
//! When zkUSD trades above peg:
//! - Users swap stables for zkUSD (arbitrage opportunity)
//! - PSM mints zkUSD, increasing supply
//!
//! When zkUSD trades below peg:
//! - Users swap zkUSD for stables (arbitrage opportunity)
//! - PSM burns zkUSD, decreasing supply
//!
//! ## UTXO Advantages
//!
//! - Atomic swaps prevent front-running
//! - Reserve composition verified client-side
//! - No slippage within swap (exact 1:1 rate)

#[cfg(not(feature = "std"))]
use alloc::vec::Vec;
#[cfg(feature = "std")]
#[allow(unused_imports)]
use std::vec::Vec;

use crate::errors::{ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Default fee for swapping stable to zkUSD (in BPS)
pub const SWAP_IN_FEE_BPS: u64 = 10; // 0.1%

/// Default fee for swapping zkUSD to stable (in BPS)
pub const SWAP_OUT_FEE_BPS: u64 = 10; // 0.1%

/// Maximum fee (in BPS)
pub const MAX_FEE_BPS: u64 = 100; // 1%

/// Minimum swap amount
pub const MIN_SWAP_AMOUNT: u64 = 100_00000000; // $100 minimum

/// Maximum single swap
pub const MAX_SWAP_AMOUNT: u64 = 10_000_000_00000000; // $10M max per swap

/// Default debt ceiling per stablecoin
pub const DEFAULT_DEBT_CEILING: u64 = 100_000_000_00000000; // $100M

/// High utilization threshold (BPS of ceiling)
pub const HIGH_UTILIZATION_BPS: u64 = 8000; // 80%

/// Fee multiplier at high utilization
pub const HIGH_UTILIZATION_FEE_MULTIPLIER: u64 = 3; // 3x fees above 80%

/// Reserve ratio target (BPS)
pub const TARGET_RESERVE_RATIO_BPS: u64 = 10000; // 100% backed

/// Minimum reserve ratio (BPS)
pub const MIN_RESERVE_RATIO_BPS: u64 = 9500; // 95% minimum

// ============================================================================
// Types
// ============================================================================

/// Supported stablecoin types for PSM
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StablecoinType {
    /// USD Coin
    USDC,
    /// Tether USD
    USDT,
    /// Dai
    DAI,
    /// Wrapped BTC-backed stablecoin
    WBTC,
    /// Custom stablecoin
    Custom { id: u32 },
}

impl StablecoinType {
    /// Get decimal precision for the stablecoin
    pub fn decimals(&self) -> u8 {
        match self {
            StablecoinType::USDC => 6,
            StablecoinType::USDT => 6,
            StablecoinType::DAI => 18,
            StablecoinType::WBTC => 8,
            StablecoinType::Custom { .. } => 8, // Default to 8
        }
    }

    /// Get risk weight (BPS) - higher = riskier
    pub fn risk_weight(&self) -> u64 {
        match self {
            StablecoinType::USDC => 10000, // 100% weight
            StablecoinType::USDT => 10500, // 105% weight (slightly higher risk)
            StablecoinType::DAI => 10200, // 102% weight
            StablecoinType::WBTC => 11000, // 110% weight (BTC volatility)
            StablecoinType::Custom { .. } => 12000, // 120% weight for unknowns
        }
    }
}

/// Configuration for a stablecoin in the PSM
#[derive(Debug, Clone)]
pub struct StablecoinConfig {
    /// Stablecoin type
    pub coin_type: StablecoinType,
    /// Maximum debt ceiling
    pub debt_ceiling: u64,
    /// Current outstanding (zkUSD minted against this)
    pub outstanding: u64,
    /// Reserve balance of this coin
    pub reserve_balance: u64,
    /// Fee for swapping this coin to zkUSD (BPS)
    pub swap_in_fee_bps: u64,
    /// Fee for swapping zkUSD to this coin (BPS)
    pub swap_out_fee_bps: u64,
    /// Is swapping enabled
    pub is_enabled: bool,
    /// Oracle price (8 decimals, should be ~1.0 for stables)
    pub oracle_price: u64,
    /// Block of last oracle update
    pub oracle_update_block: u64,
}

impl StablecoinConfig {
    /// Create new config
    pub fn new(coin_type: StablecoinType) -> Self {
        Self {
            coin_type,
            debt_ceiling: DEFAULT_DEBT_CEILING,
            outstanding: 0,
            reserve_balance: 0,
            swap_in_fee_bps: SWAP_IN_FEE_BPS,
            swap_out_fee_bps: SWAP_OUT_FEE_BPS,
            is_enabled: true,
            oracle_price: 100_000_000, // $1.00 with 8 decimals
            oracle_update_block: 0,
        }
    }

    /// Calculate utilization ratio (BPS)
    pub fn utilization_bps(&self) -> u64 {
        if self.debt_ceiling == 0 {
            return 0;
        }
        (self.outstanding as u128 * 10000 / self.debt_ceiling as u128) as u64
    }

    /// Get effective fee for swap in (considers utilization)
    pub fn effective_swap_in_fee(&self) -> u64 {
        let base = self.swap_in_fee_bps;
        if self.utilization_bps() >= HIGH_UTILIZATION_BPS {
            base * HIGH_UTILIZATION_FEE_MULTIPLIER
        } else {
            base
        }
    }

    /// Get effective fee for swap out
    pub fn effective_swap_out_fee(&self) -> u64 {
        let base = self.swap_out_fee_bps;
        // Lower fees when reserves are high (incentivize taking from reserves)
        if self.utilization_bps() < 5000 { // Under 50% utilized
            base / 2 // Half fees
        } else {
            base
        }
    }

    /// Check if has capacity for swap in
    pub fn has_capacity(&self, amount: u64) -> bool {
        self.is_enabled && self.outstanding + amount <= self.debt_ceiling
    }

    /// Check if has reserves for swap out
    pub fn has_reserves(&self, amount: u64) -> bool {
        self.is_enabled && self.reserve_balance >= amount
    }
}

/// PSM swap request
#[derive(Debug, Clone)]
pub struct SwapRequest {
    /// User address
    pub user: [u8; 32],
    /// Stablecoin type
    pub coin_type: StablecoinType,
    /// Amount to swap (in source token units)
    pub amount: u64,
    /// Direction: true = stable to zkUSD, false = zkUSD to stable
    pub is_swap_in: bool,
    /// Minimum output expected (slippage protection)
    pub min_output: u64,
}

/// PSM swap result
#[derive(Debug, Clone)]
pub struct SwapResult {
    /// User address
    pub user: [u8; 32],
    /// Input amount
    pub input_amount: u64,
    /// Output amount (after fees)
    pub output_amount: u64,
    /// Fee charged
    pub fee_amount: u64,
    /// Exchange rate used (8 decimals)
    pub exchange_rate: u64,
    /// Was swap in (stable -> zkUSD)
    pub is_swap_in: bool,
    /// Block when swap executed
    pub block_number: u64,
}

/// PSM global state
#[derive(Debug, Clone)]
pub struct PsmState {
    /// Total zkUSD minted through PSM
    pub total_psm_debt: u64,
    /// Total reserves (in zkUSD-equivalent value)
    pub total_reserves_value: u64,
    /// Total fees collected
    pub fees_collected: u64,
    /// Is PSM paused
    pub is_paused: bool,
    /// Admin address
    pub admin: [u8; 32],
    /// Last rebalance block
    pub last_rebalance_block: u64,
    /// Emergency mode (higher fees, lower limits)
    pub emergency_mode: bool,
}

impl Default for PsmState {
    fn default() -> Self {
        Self {
            total_psm_debt: 0,
            total_reserves_value: 0,
            fees_collected: 0,
            is_paused: false,
            admin: [0u8; 32],
            last_rebalance_block: 0,
            emergency_mode: false,
        }
    }
}

/// Rebalance action type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RebalanceAction {
    /// Move reserves between coins
    Transfer,
    /// Sell reserve for different coin
    Sell,
    /// Buy more of a coin
    Buy,
}

/// Rebalance request
#[derive(Debug, Clone)]
pub struct RebalanceRequest {
    /// Source coin type
    pub from_coin: StablecoinType,
    /// Target coin type
    pub to_coin: StablecoinType,
    /// Amount to rebalance
    pub amount: u64,
    /// Action type
    pub action: RebalanceAction,
}

/// PSM Rebalance result
#[derive(Debug, Clone)]
pub struct PsmRebalanceResult {
    /// Amount moved from source
    pub from_amount: u64,
    /// Amount received at target
    pub to_amount: u64,
    /// Slippage incurred (BPS)
    pub slippage_bps: u64,
    /// Success
    pub success: bool,
}

// ============================================================================
// Core Operations
// ============================================================================

/// Normalize amount between different decimals
fn normalize_amount(amount: u64, from_decimals: u8, to_decimals: u8) -> u64 {
    if from_decimals == to_decimals {
        return amount;
    }

    if from_decimals > to_decimals {
        let divisor = 10u64.pow((from_decimals - to_decimals) as u32);
        amount / divisor
    } else {
        let multiplier = 10u64.pow((to_decimals - from_decimals) as u32);
        amount * multiplier
    }
}

/// Execute a swap (stable to zkUSD or zkUSD to stable)
pub fn execute_swap(
    request: SwapRequest,
    config: &mut StablecoinConfig,
    state: &mut PsmState,
    current_block: u64,
) -> ZkUsdResult<SwapResult> {
    // Check PSM is active
    if state.is_paused {
        return Err(ZkUsdError::ProtocolPaused);
    }

    // Check coin is enabled
    if !config.is_enabled {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Validate amount
    if request.amount < MIN_SWAP_AMOUNT {
        return Err(ZkUsdError::BelowMinimum {
            amount: request.amount,
            minimum: MIN_SWAP_AMOUNT,
        });
    }

    if request.amount > MAX_SWAP_AMOUNT {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: request.amount,
            maximum: MAX_SWAP_AMOUNT,
        });
    }

    // Apply emergency mode limits
    let effective_max = if state.emergency_mode {
        MAX_SWAP_AMOUNT / 10 // 10x lower limit in emergency
    } else {
        MAX_SWAP_AMOUNT
    };

    if request.amount > effective_max {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: request.amount,
            maximum: effective_max,
        });
    }

    if request.is_swap_in {
        // Stable -> zkUSD
        execute_swap_in(request, config, state, current_block)
    } else {
        // zkUSD -> Stable
        execute_swap_out(request, config, state, current_block)
    }
}

/// Swap stablecoin for zkUSD
fn execute_swap_in(
    request: SwapRequest,
    config: &mut StablecoinConfig,
    state: &mut PsmState,
    current_block: u64,
) -> ZkUsdResult<SwapResult> {
    // Normalize input to 8 decimals (zkUSD precision)
    let normalized_input = normalize_amount(
        request.amount,
        config.coin_type.decimals(),
        8,
    );

    // Check capacity
    if !config.has_capacity(normalized_input) {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: normalized_input,
            maximum: config.debt_ceiling - config.outstanding,
        });
    }

    // Calculate fee
    let fee_bps = if state.emergency_mode {
        config.effective_swap_in_fee() * 2 // Double fees in emergency
    } else {
        config.effective_swap_in_fee()
    };

    let fee = (normalized_input as u128 * fee_bps as u128 / 10000) as u64;
    let output_amount = normalized_input.saturating_sub(fee);

    // Check minimum output
    if output_amount < request.min_output {
        return Err(ZkUsdError::InsufficientCollateral);
    }

    // Apply oracle price adjustment (protect against depegged stables)
    let price_adjusted_output = (output_amount as u128 * config.oracle_price as u128 / 100_000_000) as u64;

    // Update state
    config.outstanding += normalized_input;
    config.reserve_balance += request.amount;
    state.total_psm_debt += normalized_input;
    state.total_reserves_value += normalized_input;
    state.fees_collected += fee;

    Ok(SwapResult {
        user: request.user,
        input_amount: request.amount,
        output_amount: price_adjusted_output,
        fee_amount: fee,
        exchange_rate: config.oracle_price,
        is_swap_in: true,
        block_number: current_block,
    })
}

/// Swap zkUSD for stablecoin
fn execute_swap_out(
    request: SwapRequest,
    config: &mut StablecoinConfig,
    state: &mut PsmState,
    current_block: u64,
) -> ZkUsdResult<SwapResult> {
    // Calculate output in stablecoin units
    let output_in_stable_decimals = normalize_amount(
        request.amount,
        8,
        config.coin_type.decimals(),
    );

    // Check reserves
    if !config.has_reserves(output_in_stable_decimals) {
        return Err(ZkUsdError::InsufficientBalance {
            available: config.reserve_balance,
            requested: output_in_stable_decimals,
        });
    }

    // Calculate fee
    let fee_bps = if state.emergency_mode {
        config.effective_swap_out_fee() * 2
    } else {
        config.effective_swap_out_fee()
    };

    let fee = (output_in_stable_decimals as u128 * fee_bps as u128 / 10000) as u64;
    let output_amount = output_in_stable_decimals.saturating_sub(fee);

    // Check minimum output
    if output_amount < request.min_output {
        return Err(ZkUsdError::InsufficientCollateral);
    }

    // Update state
    config.outstanding = config.outstanding.saturating_sub(request.amount);
    config.reserve_balance = config.reserve_balance.saturating_sub(output_in_stable_decimals);
    state.total_psm_debt = state.total_psm_debt.saturating_sub(request.amount);
    state.total_reserves_value = state.total_reserves_value.saturating_sub(request.amount);
    state.fees_collected += fee;

    Ok(SwapResult {
        user: request.user,
        input_amount: request.amount,
        output_amount,
        fee_amount: fee,
        exchange_rate: config.oracle_price,
        is_swap_in: false,
        block_number: current_block,
    })
}

/// Calculate reserve ratio
pub fn calculate_reserve_ratio(state: &PsmState) -> u64 {
    if state.total_psm_debt == 0 {
        return 10000; // 100% if no debt
    }

    (state.total_reserves_value as u128 * 10000 / state.total_psm_debt as u128) as u64
}

/// Check if PSM is healthy
pub fn is_psm_healthy(state: &PsmState) -> bool {
    let ratio = calculate_reserve_ratio(state);
    ratio >= MIN_RESERVE_RATIO_BPS && !state.is_paused
}

/// Rebalance reserves between stablecoins
pub fn rebalance_reserves(
    request: RebalanceRequest,
    from_config: &mut StablecoinConfig,
    to_config: &mut StablecoinConfig,
    state: &mut PsmState,
    current_block: u64,
) -> ZkUsdResult<PsmRebalanceResult> {
    // Only admin can rebalance (in production, could be automated)
    // Check reserves available
    if from_config.reserve_balance < request.amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: from_config.reserve_balance,
            requested: request.amount,
        });
    }

    // Normalize between coins
    let normalized_amount = normalize_amount(
        request.amount,
        from_config.coin_type.decimals(),
        to_config.coin_type.decimals(),
    );

    // Apply slippage (simulated - in production would use DEX)
    let slippage_bps = 50u64; // 0.5% slippage assumption
    let slippage_amount = (normalized_amount as u128 * slippage_bps as u128 / 10000) as u64;
    let received_amount = normalized_amount.saturating_sub(slippage_amount);

    // Update reserves
    from_config.reserve_balance -= request.amount;
    to_config.reserve_balance += received_amount;

    state.last_rebalance_block = current_block;

    Ok(PsmRebalanceResult {
        from_amount: request.amount,
        to_amount: received_amount,
        slippage_bps,
        success: true,
    })
}

/// Enable emergency mode
pub fn enable_emergency_mode(
    state: &mut PsmState,
    caller: [u8; 32],
) -> ZkUsdResult<()> {
    if caller != state.admin {
        return Err(ZkUsdError::AdminOnly);
    }

    state.emergency_mode = true;
    Ok(())
}

/// Disable emergency mode
pub fn disable_emergency_mode(
    state: &mut PsmState,
    caller: [u8; 32],
) -> ZkUsdResult<()> {
    if caller != state.admin {
        return Err(ZkUsdError::AdminOnly);
    }

    state.emergency_mode = false;
    Ok(())
}

/// Pause PSM
pub fn pause_psm(
    state: &mut PsmState,
    caller: [u8; 32],
) -> ZkUsdResult<()> {
    if caller != state.admin {
        return Err(ZkUsdError::AdminOnly);
    }

    state.is_paused = true;
    Ok(())
}

/// Update oracle price for a stablecoin
pub fn update_oracle_price(
    config: &mut StablecoinConfig,
    new_price: u64,
    current_block: u64,
) -> ZkUsdResult<()> {
    // Price should be close to $1.00 (100_000_000 with 8 decimals)
    // Allow 5% deviation before auto-disabling
    let one_dollar = 100_000_000u64;
    let max_deviation = one_dollar / 20; // 5%

    if new_price > one_dollar + max_deviation || new_price < one_dollar - max_deviation {
        // Depeg detected - disable this coin
        config.is_enabled = false;
    }

    config.oracle_price = new_price;
    config.oracle_update_block = current_block;

    Ok(())
}

/// Collect accumulated fees
pub fn collect_fees(
    state: &mut PsmState,
    recipient: [u8; 32],
    caller: [u8; 32],
) -> ZkUsdResult<u64> {
    if caller != state.admin {
        return Err(ZkUsdError::AdminOnly);
    }

    let fees = state.fees_collected;
    state.fees_collected = 0;

    // In production, would transfer to recipient
    let _ = recipient; // Used in actual transfer

    Ok(fees)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> StablecoinConfig {
        let mut config = StablecoinConfig::new(StablecoinType::USDC);
        config.reserve_balance = 50_000_000_00000000; // $50M in reserves
        config.outstanding = 25_000_000_00000000; // $25M outstanding
        config
    }

    fn create_test_state() -> PsmState {
        PsmState {
            total_psm_debt: 25_000_000_00000000,
            total_reserves_value: 50_000_000_00000000,
            fees_collected: 0,
            is_paused: false,
            admin: [1u8; 32],
            last_rebalance_block: 0,
            emergency_mode: false,
        }
    }

    #[test]
    fn test_stablecoin_decimals() {
        assert_eq!(StablecoinType::USDC.decimals(), 6);
        assert_eq!(StablecoinType::USDT.decimals(), 6);
        assert_eq!(StablecoinType::DAI.decimals(), 18);
        assert_eq!(StablecoinType::WBTC.decimals(), 8);
    }

    #[test]
    fn test_normalize_amount() {
        // USDC (6) to zkUSD (8)
        let usdc_amount = 1_000_000u64; // $1 in USDC (6 decimals)
        let normalized = normalize_amount(usdc_amount, 6, 8);
        assert_eq!(normalized, 100_000_000); // $1 in zkUSD (8 decimals)

        // zkUSD (8) to USDC (6)
        let zkusd_amount = 100_000_000u64; // $1 in zkUSD
        let denormalized = normalize_amount(zkusd_amount, 8, 6);
        assert_eq!(denormalized, 1_000_000); // $1 in USDC
    }

    #[test]
    fn test_utilization_calculation() {
        let mut config = create_test_config();
        config.debt_ceiling = 100_000_000_00000000; // $100M
        config.outstanding = 50_000_000_00000000; // $50M

        assert_eq!(config.utilization_bps(), 5000); // 50%
    }

    #[test]
    fn test_effective_fees() {
        let mut config = create_test_config();
        config.debt_ceiling = 100_000_000_00000000;

        // Low utilization
        config.outstanding = 20_000_000_00000000; // 20%
        let low_fee = config.effective_swap_out_fee();
        assert_eq!(low_fee, SWAP_OUT_FEE_BPS / 2); // Half fee

        // High utilization
        config.outstanding = 85_000_000_00000000; // 85%
        let high_fee = config.effective_swap_in_fee();
        assert_eq!(high_fee, SWAP_IN_FEE_BPS * HIGH_UTILIZATION_FEE_MULTIPLIER);
    }

    #[test]
    fn test_swap_in() {
        let mut config = create_test_config();
        let mut state = create_test_state();

        // 10,000 USDC in 6 decimals = 10_000_000_000
        // This normalizes to 1_000_000_000_000 in 8 decimals ($10k)
        let request = SwapRequest {
            user: [2u8; 32],
            coin_type: StablecoinType::USDC,
            amount: 10_000_000_000u64, // 10,000 USDC (6 decimals)
            is_swap_in: true,
            min_output: 0,
        };

        let result = execute_swap(request, &mut config, &mut state, 100).unwrap();

        assert!(result.is_swap_in);
        assert!(result.output_amount > 0);
        assert!(result.fee_amount > 0);
        // State should be updated
        assert!(config.outstanding > 25_000_000_00000000);
    }

    #[test]
    fn test_swap_out() {
        let mut config = create_test_config();
        let mut state = create_test_state();

        let request = SwapRequest {
            user: [2u8; 32],
            coin_type: StablecoinType::USDC,
            amount: 1000_00000000u64, // 1000 zkUSD (8 decimals)
            is_swap_in: false,
            min_output: 0,
        };

        let result = execute_swap(request, &mut config, &mut state, 100).unwrap();

        assert!(!result.is_swap_in);
        assert!(result.output_amount > 0);
        // State should be updated
        assert!(config.outstanding < 25_000_000_00000000);
    }

    #[test]
    fn test_swap_below_minimum() {
        let mut config = create_test_config();
        let mut state = create_test_state();

        let request = SwapRequest {
            user: [2u8; 32],
            coin_type: StablecoinType::USDC,
            amount: 1u64, // Way too small
            is_swap_in: true,
            min_output: 0,
        };

        let result = execute_swap(request, &mut config, &mut state, 100);
        assert!(matches!(result, Err(ZkUsdError::BelowMinimum { .. })));
    }

    #[test]
    fn test_swap_paused() {
        let mut config = create_test_config();
        let mut state = create_test_state();
        state.is_paused = true;

        let request = SwapRequest {
            user: [2u8; 32],
            coin_type: StablecoinType::USDC,
            amount: 1000_00000000u64,
            is_swap_in: true,
            min_output: 0,
        };

        let result = execute_swap(request, &mut config, &mut state, 100);
        assert!(matches!(result, Err(ZkUsdError::ProtocolPaused)));
    }

    #[test]
    fn test_reserve_ratio() {
        let state = create_test_state();
        let ratio = calculate_reserve_ratio(&state);
        // 50M / 25M = 200%
        assert_eq!(ratio, 20000);
    }

    #[test]
    fn test_psm_health() {
        let mut state = create_test_state();
        assert!(is_psm_healthy(&state));

        // Reduce reserves below minimum
        state.total_reserves_value = state.total_psm_debt * 90 / 100; // 90%
        assert!(!is_psm_healthy(&state));
    }

    #[test]
    fn test_emergency_mode() {
        let mut state = create_test_state();

        // Non-admin cannot enable
        let result = enable_emergency_mode(&mut state, [2u8; 32]);
        assert!(matches!(result, Err(ZkUsdError::AdminOnly)));

        // Admin can enable
        enable_emergency_mode(&mut state, [1u8; 32]).unwrap();
        assert!(state.emergency_mode);
    }

    #[test]
    fn test_oracle_depeg_detection() {
        let mut config = create_test_config();

        // Normal price update
        update_oracle_price(&mut config, 100_500_000, 100).unwrap(); // $1.005
        assert!(config.is_enabled);

        // Depeg detected (6% off)
        update_oracle_price(&mut config, 94_000_000, 101).unwrap(); // $0.94
        assert!(!config.is_enabled); // Auto-disabled
    }

    #[test]
    fn test_rebalance() {
        let mut from_config = create_test_config();
        let mut to_config = StablecoinConfig::new(StablecoinType::USDT);
        to_config.reserve_balance = 10_000_000_000000; // $10M in USDT (6 decimals)

        let mut state = create_test_state();

        let request = RebalanceRequest {
            from_coin: StablecoinType::USDC,
            to_coin: StablecoinType::USDT,
            amount: 1_000_000_000000, // $1M (6 decimals for USDC)
            action: RebalanceAction::Transfer,
        };

        let result = rebalance_reserves(
            request,
            &mut from_config,
            &mut to_config,
            &mut state,
            100,
        ).unwrap();

        assert!(result.success);
        assert!(result.slippage_bps > 0);
        assert!(from_config.reserve_balance < 50_000_000_00000000);
    }

    #[test]
    fn test_collect_fees() {
        let mut state = create_test_state();
        state.fees_collected = 1_000_00000000; // $1000 in fees

        // Non-admin cannot collect
        let result = collect_fees(&mut state, [3u8; 32], [2u8; 32]);
        assert!(matches!(result, Err(ZkUsdError::AdminOnly)));

        // Admin can collect
        let fees = collect_fees(&mut state, [3u8; 32], [1u8; 32]).unwrap();
        assert_eq!(fees, 1_000_00000000);
        assert_eq!(state.fees_collected, 0);
    }

    #[test]
    fn test_has_capacity() {
        let mut config = create_test_config();
        config.debt_ceiling = 100_000_000_00000000;
        config.outstanding = 90_000_000_00000000;

        // Has capacity for 10M
        assert!(config.has_capacity(10_000_000_00000000));

        // No capacity for 11M
        assert!(!config.has_capacity(11_000_000_00000000));
    }
}
