//! Rate Limiter Module
//!
//! Rate limiting for protocol operations to prevent abuse and spam.
//! Implements sliding window rate limits for various operations.
//!
//! ## Key Features
//!
//! - **Per-User Limits**: Limit operations per user
//! - **Global Limits**: System-wide operation limits
//! - **Sliding Window**: Time-based rate limiting
//! - **Tiered Limits**: Different limits for different user tiers
//! - **Burst Allowance**: Allow short bursts within limits

use crate::{Vec, ZkUsdError, ZkUsdResult};
use crate::errors::AmountErrorReason;

// ============================================================================
// Constants
// ============================================================================

/// Default window size in blocks (144 = ~1 day)
pub const DEFAULT_WINDOW_BLOCKS: u64 = 144;

/// Short window for burst detection (6 blocks = ~1 hour)
pub const BURST_WINDOW_BLOCKS: u64 = 6;

/// Default per-user mint limit per day (100,000 zkUSD)
pub const DEFAULT_MINT_LIMIT: u64 = 100_000_00000000;

/// Default per-user redeem limit per day (100,000 zkUSD)
pub const DEFAULT_REDEEM_LIMIT: u64 = 100_000_00000000;

/// Default operations per hour limit
pub const DEFAULT_OPS_PER_HOUR: u32 = 50;

/// Maximum operations per block (anti-spam)
pub const MAX_OPS_PER_BLOCK: u32 = 5;

// ============================================================================
// Types
// ============================================================================

/// Types of rate-limited operations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RateLimitedOp {
    /// Minting zkUSD
    Mint,
    /// Redeeming zkUSD
    Redeem,
    /// Opening vault
    OpenVault,
    /// Adjusting vault
    AdjustVault,
    /// Flash mint
    FlashMint,
    /// PSM swap
    PsmSwap,
    /// Stability pool deposit
    SpDeposit,
    /// Stability pool withdraw
    SpWithdraw,
    /// Liquidation
    Liquidation,
    /// Cross-chain beam
    BeamOut,
}

/// User tier for tiered limits
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserTier {
    /// Basic user (default)
    Basic,
    /// Verified user (higher limits)
    Verified,
    /// Premium user (highest limits)
    Premium,
    /// Contract/protocol (special limits)
    Contract,
    /// Whitelisted (unlimited)
    Whitelisted,
}

impl UserTier {
    /// Get limit multiplier for this tier
    pub fn multiplier(&self) -> u64 {
        match self {
            UserTier::Basic => 100,      // 1x
            UserTier::Verified => 200,   // 2x
            UserTier::Premium => 500,    // 5x
            UserTier::Contract => 1000,  // 10x
            UserTier::Whitelisted => u64::MAX, // Unlimited
        }
    }
}

/// Rate limit configuration
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Operation type
    pub operation: RateLimitedOp,
    /// Window size in blocks
    pub window_blocks: u64,
    /// Maximum amount per window (for value-based limits)
    pub max_amount_per_window: u64,
    /// Maximum operations per window (for count-based limits)
    pub max_ops_per_window: u32,
    /// Burst limit (max in short window)
    pub burst_limit: u32,
    /// Whether limit is enabled
    pub enabled: bool,
}

impl RateLimitConfig {
    /// Create new rate limit config
    pub fn new(
        operation: RateLimitedOp,
        window_blocks: u64,
        max_amount: u64,
        max_ops: u32,
    ) -> Self {
        Self {
            operation,
            window_blocks,
            max_amount_per_window: max_amount,
            max_ops_per_window: max_ops,
            burst_limit: MAX_OPS_PER_BLOCK,
            enabled: true,
        }
    }

    /// Get effective limit for a user tier
    pub fn effective_limit(&self, tier: UserTier) -> u64 {
        let multiplier = tier.multiplier();
        if multiplier == u64::MAX {
            return u64::MAX;
        }
        self.max_amount_per_window.saturating_mul(multiplier) / 100
    }
}

/// Usage record for a user
#[derive(Debug, Clone)]
pub struct UsageRecord {
    /// User address
    pub user: [u8; 32],
    /// Operation type
    pub operation: RateLimitedOp,
    /// Amount used in current window
    pub amount_used: u64,
    /// Number of operations in current window
    pub ops_count: u32,
    /// Window start block
    pub window_start: u64,
    /// Block of last operation
    pub last_op_block: u64,
    /// Operations in current block (for burst detection)
    pub ops_this_block: u32,
}

impl UsageRecord {
    /// Create new usage record
    pub fn new(user: [u8; 32], operation: RateLimitedOp, block: u64) -> Self {
        Self {
            user,
            operation,
            amount_used: 0,
            ops_count: 0,
            window_start: block,
            last_op_block: 0,
            ops_this_block: 0,
        }
    }

    /// Reset window if expired
    pub fn maybe_reset_window(&mut self, current_block: u64, window_size: u64) {
        if current_block >= self.window_start.saturating_add(window_size) {
            self.window_start = current_block;
            self.amount_used = 0;
            self.ops_count = 0;
        }

        // Reset block counter if new block
        if current_block > self.last_op_block {
            self.ops_this_block = 0;
        }
    }

    /// Check if operation is within limits
    pub fn within_limits(
        &self,
        amount: u64,
        config: &RateLimitConfig,
        tier: UserTier,
    ) -> bool {
        if !config.enabled || tier == UserTier::Whitelisted {
            return true;
        }

        let effective_amount_limit = config.effective_limit(tier);
        let effective_ops_limit = (config.max_ops_per_window as u64)
            .saturating_mul(tier.multiplier()) / 100;

        // Check amount limit
        if self.amount_used.saturating_add(amount) > effective_amount_limit {
            return false;
        }

        // Check ops limit
        if (self.ops_count + 1) as u64 > effective_ops_limit {
            return false;
        }

        // Check burst limit
        if self.ops_this_block >= config.burst_limit {
            return false;
        }

        true
    }
}

/// Global rate limit state
#[derive(Debug, Clone)]
pub struct GlobalRateLimitState {
    /// Total amount minted in current window
    pub total_minted: u64,
    /// Total amount redeemed in current window
    pub total_redeemed: u64,
    /// Total liquidations in current window
    pub total_liquidations: u64,
    /// Window start block
    pub window_start: u64,
    /// Operations count per block
    pub ops_per_block: u32,
    /// Current block being tracked
    pub current_block: u64,
}

impl Default for GlobalRateLimitState {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalRateLimitState {
    /// Create new global state
    pub fn new() -> Self {
        Self {
            total_minted: 0,
            total_redeemed: 0,
            total_liquidations: 0,
            window_start: 0,
            ops_per_block: 0,
            current_block: 0,
        }
    }

    /// Reset window if needed
    pub fn maybe_reset(&mut self, current_block: u64, window_size: u64) {
        if current_block >= self.window_start.saturating_add(window_size) {
            self.window_start = current_block;
            self.total_minted = 0;
            self.total_redeemed = 0;
            self.total_liquidations = 0;
        }

        if current_block > self.current_block {
            self.ops_per_block = 0;
            self.current_block = current_block;
        }
    }
}

/// Rate limiter state
#[derive(Debug, Clone)]
pub struct RateLimiterState {
    /// Configuration per operation type
    pub configs: Vec<RateLimitConfig>,
    /// Global limits
    pub global: GlobalRateLimitState,
    /// Whether rate limiting is enabled globally
    pub enabled: bool,
}

impl Default for RateLimiterState {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiterState {
    /// Create new rate limiter with default configs
    pub fn new() -> Self {
        let mut configs = Vec::new();

        // Default configurations
        configs.push(RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            DEFAULT_MINT_LIMIT,
            DEFAULT_OPS_PER_HOUR * 24,
        ));

        configs.push(RateLimitConfig::new(
            RateLimitedOp::Redeem,
            DEFAULT_WINDOW_BLOCKS,
            DEFAULT_REDEEM_LIMIT,
            DEFAULT_OPS_PER_HOUR * 24,
        ));

        configs.push(RateLimitConfig::new(
            RateLimitedOp::FlashMint,
            BURST_WINDOW_BLOCKS,
            DEFAULT_MINT_LIMIT * 10, // Higher limit for flash
            10, // Limited operations
        ));

        Self {
            configs,
            global: GlobalRateLimitState::new(),
            enabled: true,
        }
    }

    /// Get config for operation
    pub fn get_config(&self, operation: RateLimitedOp) -> Option<&RateLimitConfig> {
        self.configs.iter().find(|c| c.operation == operation)
    }
}

// ============================================================================
// Core Rate Limiter Functions
// ============================================================================

/// Check if operation is allowed
pub fn check_rate_limit(
    state: &RateLimiterState,
    record: &UsageRecord,
    operation: RateLimitedOp,
    amount: u64,
    tier: UserTier,
) -> ZkUsdResult<()> {
    if !state.enabled {
        return Ok(());
    }

    let config = state.get_config(operation);
    if config.is_none() {
        return Ok(()); // No config means no limit
    }

    let config = config.unwrap();
    if !record.within_limits(amount, config, tier) {
        return Err(ZkUsdError::InvalidAmount {
            amount,
            reason: AmountErrorReason::TooLarge,
        });
    }

    Ok(())
}

/// Record usage of an operation
pub fn record_usage(
    record: &mut UsageRecord,
    amount: u64,
    current_block: u64,
    window_size: u64,
) {
    record.maybe_reset_window(current_block, window_size);
    record.amount_used = record.amount_used.saturating_add(amount);
    record.ops_count += 1;
    record.ops_this_block += 1;
    record.last_op_block = current_block;
}

/// Record global usage
pub fn record_global_usage(
    state: &mut GlobalRateLimitState,
    operation: RateLimitedOp,
    amount: u64,
    current_block: u64,
) {
    state.maybe_reset(current_block, DEFAULT_WINDOW_BLOCKS);

    match operation {
        RateLimitedOp::Mint => {
            state.total_minted = state.total_minted.saturating_add(amount);
        }
        RateLimitedOp::Redeem => {
            state.total_redeemed = state.total_redeemed.saturating_add(amount);
        }
        RateLimitedOp::Liquidation => {
            state.total_liquidations = state.total_liquidations.saturating_add(amount);
        }
        _ => {}
    }

    state.ops_per_block += 1;
}

/// Get remaining limit for user
pub fn get_remaining_limit(
    record: &UsageRecord,
    config: &RateLimitConfig,
    tier: UserTier,
) -> u64 {
    if tier == UserTier::Whitelisted {
        return u64::MAX;
    }

    let effective_limit = config.effective_limit(tier);
    effective_limit.saturating_sub(record.amount_used)
}

/// Check global rate limit
pub fn check_global_limit(
    state: &GlobalRateLimitState,
    operation: RateLimitedOp,
    amount: u64,
    global_limit: u64,
) -> ZkUsdResult<()> {
    let current_total = match operation {
        RateLimitedOp::Mint => state.total_minted,
        RateLimitedOp::Redeem => state.total_redeemed,
        RateLimitedOp::Liquidation => state.total_liquidations,
        _ => 0,
    };

    if current_total.saturating_add(amount) > global_limit {
        return Err(ZkUsdError::InvalidAmount {
            amount,
            reason: AmountErrorReason::TooLarge,
        });
    }

    Ok(())
}

/// Update rate limit configuration
pub fn update_config(
    state: &mut RateLimiterState,
    operation: RateLimitedOp,
    max_amount: Option<u64>,
    max_ops: Option<u32>,
    enabled: Option<bool>,
) {
    if let Some(config) = state.configs.iter_mut().find(|c| c.operation == operation) {
        if let Some(amount) = max_amount {
            config.max_amount_per_window = amount;
        }
        if let Some(ops) = max_ops {
            config.max_ops_per_window = ops;
        }
        if let Some(e) = enabled {
            config.enabled = e;
        }
    }
}

/// Rate limit status for a user
#[derive(Debug, Clone)]
pub struct RateLimitStatus {
    /// Operation type
    pub operation: RateLimitedOp,
    /// Amount used in current window
    pub amount_used: u64,
    /// Remaining amount allowed
    pub remaining_amount: u64,
    /// Operations used
    pub ops_used: u32,
    /// Remaining operations
    pub remaining_ops: u32,
    /// Window reset block
    pub window_resets_at: u64,
}

/// Get rate limit status for user
pub fn get_user_status(
    record: &UsageRecord,
    config: &RateLimitConfig,
    tier: UserTier,
    _current_block: u64,
) -> RateLimitStatus {
    let effective_amount = config.effective_limit(tier);
    let effective_ops = ((config.max_ops_per_window as u64) * tier.multiplier() / 100) as u32;

    RateLimitStatus {
        operation: record.operation,
        amount_used: record.amount_used,
        remaining_amount: effective_amount.saturating_sub(record.amount_used),
        ops_used: record.ops_count,
        remaining_ops: effective_ops.saturating_sub(record.ops_count),
        window_resets_at: record.window_start.saturating_add(config.window_blocks),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn test_user() -> [u8; 32] {
        [1u8; 32]
    }

    const ONE_ZKUSD: u64 = 100_000_000;

    #[test]
    fn test_new_state() {
        let state = RateLimiterState::new();
        assert!(state.enabled);
        assert!(!state.configs.is_empty());
    }

    #[test]
    fn test_within_limits() {
        let config = RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            100_000 * ONE_ZKUSD,
            100,
        );

        let record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);

        assert!(record.within_limits(50_000 * ONE_ZKUSD, &config, UserTier::Basic));
        assert!(!record.within_limits(150_000 * ONE_ZKUSD, &config, UserTier::Basic));
    }

    #[test]
    fn test_tier_multiplier() {
        let config = RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            100_000 * ONE_ZKUSD,
            100,
        );

        // Basic tier: 1x = 100,000
        assert_eq!(config.effective_limit(UserTier::Basic), 100_000 * ONE_ZKUSD);

        // Premium tier: 5x = 500,000
        assert_eq!(config.effective_limit(UserTier::Premium), 500_000 * ONE_ZKUSD);

        // Whitelisted: unlimited
        assert_eq!(config.effective_limit(UserTier::Whitelisted), u64::MAX);
    }

    #[test]
    fn test_record_usage() {
        let mut record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);

        record_usage(&mut record, 10_000 * ONE_ZKUSD, 1001, DEFAULT_WINDOW_BLOCKS);

        assert_eq!(record.amount_used, 10_000 * ONE_ZKUSD);
        assert_eq!(record.ops_count, 1);
    }

    #[test]
    fn test_window_reset() {
        let mut record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);
        record.amount_used = 50_000 * ONE_ZKUSD;
        record.ops_count = 10;

        // Advance past window
        record.maybe_reset_window(1000 + DEFAULT_WINDOW_BLOCKS + 1, DEFAULT_WINDOW_BLOCKS);

        assert_eq!(record.amount_used, 0);
        assert_eq!(record.ops_count, 0);
    }

    #[test]
    fn test_burst_limit() {
        let config = RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            100_000 * ONE_ZKUSD,
            100,
        );

        let mut record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);
        record.ops_this_block = MAX_OPS_PER_BLOCK;

        // Burst limit exceeded
        assert!(!record.within_limits(1000 * ONE_ZKUSD, &config, UserTier::Basic));
    }

    #[test]
    fn test_check_rate_limit() {
        let state = RateLimiterState::new();
        let record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);

        // Should be within limits
        let result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::Mint,
            50_000 * ONE_ZKUSD,
            UserTier::Basic,
        );
        assert!(result.is_ok());

        // Should exceed limits
        let result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::Mint,
            200_000 * ONE_ZKUSD,
            UserTier::Basic,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_global_usage() {
        let mut state = GlobalRateLimitState::new();

        record_global_usage(&mut state, RateLimitedOp::Mint, 100_000 * ONE_ZKUSD, 1000);
        record_global_usage(&mut state, RateLimitedOp::Mint, 50_000 * ONE_ZKUSD, 1001);

        assert_eq!(state.total_minted, 150_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_get_remaining_limit() {
        let config = RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            100_000 * ONE_ZKUSD,
            100,
        );

        let mut record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);
        record.amount_used = 30_000 * ONE_ZKUSD;

        let remaining = get_remaining_limit(&record, &config, UserTier::Basic);
        assert_eq!(remaining, 70_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_user_status() {
        let config = RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            100_000 * ONE_ZKUSD,
            100,
        );

        let mut record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);
        record.amount_used = 25_000 * ONE_ZKUSD;
        record.ops_count = 5;

        let status = get_user_status(&record, &config, UserTier::Basic, 1001);

        assert_eq!(status.amount_used, 25_000 * ONE_ZKUSD);
        assert_eq!(status.remaining_amount, 75_000 * ONE_ZKUSD);
        assert_eq!(status.ops_used, 5);
        assert_eq!(status.remaining_ops, 95);
    }

    #[test]
    fn test_update_config() {
        let mut state = RateLimiterState::new();

        update_config(
            &mut state,
            RateLimitedOp::Mint,
            Some(200_000 * ONE_ZKUSD),
            Some(200),
            None,
        );

        let config = state.get_config(RateLimitedOp::Mint).unwrap();
        assert_eq!(config.max_amount_per_window, 200_000 * ONE_ZKUSD);
        assert_eq!(config.max_ops_per_window, 200);
    }

    #[test]
    fn test_whitelisted_unlimited() {
        let config = RateLimitConfig::new(
            RateLimitedOp::Mint,
            DEFAULT_WINDOW_BLOCKS,
            100_000 * ONE_ZKUSD,
            100,
        );

        let mut record = UsageRecord::new(test_user(), RateLimitedOp::Mint, 1000);
        record.amount_used = u64::MAX / 2;

        // Whitelisted should always be within limits
        assert!(record.within_limits(u64::MAX / 2, &config, UserTier::Whitelisted));
    }
}
