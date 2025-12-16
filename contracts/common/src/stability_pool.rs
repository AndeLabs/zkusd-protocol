//! Stability Pool Module
//!
//! The Stability Pool is the first line of defense in maintaining zkUSD's peg.
//! Users deposit zkUSD to absorb debt during liquidations and earn BTC rewards.
//!
//! ## Key Features
//!
//! - **Deposit/Withdraw**: Users can deposit and withdraw zkUSD
//! - **Loss Absorption**: Pool absorbs debt during liquidations
//! - **BTC Rewards**: Depositors earn BTC from liquidated collateral
//! - **Compounding**: Product P tracks proportional losses
//! - **Epochs/Scales**: Handle precision for large liquidations
//! - **UTXO-Native**: All operations designed for atomic execution

use crate::{Vec, ZkUsdError, ZkUsdResult};
use crate::errors::AmountErrorReason;
use crate::constants::token;

// ============================================================================
// Constants
// ============================================================================

/// Minimum deposit amount (100 zkUSD)
pub const SP_MIN_DEPOSIT: u64 = 100 * token::ONE;

/// Scale factor for precision (1e18)
pub const SP_SCALE_FACTOR: u128 = 1_000_000_000_000_000_000;

/// P underflow threshold - when to increment epoch
pub const P_UNDERFLOW_THRESHOLD: u128 = SP_SCALE_FACTOR / 1_000_000_000; // 1e9

/// Maximum depositors per batch operation
pub const MAX_BATCH_DEPOSITORS: usize = 50;

// ============================================================================
// Types
// ============================================================================

/// Individual deposit in the stability pool
#[derive(Debug, Clone)]
pub struct SpDeposit {
    /// Depositor's address
    pub owner: [u8; 32],
    /// Current deposit value (zkUSD, decreases with liquidations)
    pub deposit: u64,
    /// Snapshot of P when deposited/last updated
    pub snapshot_p: u128,
    /// Snapshot of S when deposited/last updated (for BTC rewards)
    pub snapshot_s: u128,
    /// Epoch when deposited/last updated
    pub snapshot_epoch: u64,
    /// Scale when deposited/last updated
    pub snapshot_scale: u64,
    /// Block when last updated
    pub last_updated_block: u64,
}

impl SpDeposit {
    /// Create a new deposit
    pub fn new(
        owner: [u8; 32],
        amount: u64,
        pool: &SpPoolState,
        block: u64,
    ) -> Self {
        Self {
            owner,
            deposit: amount,
            snapshot_p: pool.product_p,
            snapshot_s: pool.sum_s,
            snapshot_epoch: pool.current_epoch,
            snapshot_scale: pool.current_scale,
            last_updated_block: block,
        }
    }

    /// Calculate compounded deposit value
    pub fn compounded_value(&self, pool: &SpPoolState) -> u64 {
        if self.snapshot_epoch < pool.current_epoch {
            // Deposit was wiped out in a previous epoch
            return 0;
        }

        if self.snapshot_p == 0 || pool.product_p == 0 {
            return 0;
        }

        // Handle scale changes
        let scale_diff = pool.current_scale.saturating_sub(self.snapshot_scale);
        if scale_diff > 1 {
            // More than 2 scale changes, deposit is essentially zero
            return 0;
        }

        // Calculate compounded value: deposit * (P_current / P_snapshot)
        let compounded = if scale_diff == 0 {
            (self.deposit as u128 * pool.product_p / self.snapshot_p) as u64
        } else {
            // Scale changed once, divide by SCALE_FACTOR
            (self.deposit as u128 * pool.product_p / self.snapshot_p / SP_SCALE_FACTOR) as u64
        };

        compounded
    }

    /// Calculate pending BTC rewards
    pub fn pending_btc_reward(&self, pool: &SpPoolState) -> u64 {
        if self.deposit == 0 {
            return 0;
        }

        // S_delta = S_current - S_snapshot (in same epoch/scale)
        let s_delta = if self.snapshot_epoch == pool.current_epoch
            && self.snapshot_scale == pool.current_scale
        {
            pool.sum_s.saturating_sub(self.snapshot_s)
        } else if self.snapshot_epoch == pool.current_epoch
            && self.snapshot_scale + 1 == pool.current_scale
        {
            // One scale change
            pool.sum_s.saturating_add(pool.sum_s_at_scale_change.unwrap_or(0))
                .saturating_sub(self.snapshot_s)
        } else {
            // Multiple scale changes or different epoch
            pool.sum_s
        };

        // BTC reward = deposit * S_delta / SCALE_FACTOR
        let reward = (self.deposit as u128 * s_delta / SP_SCALE_FACTOR) as u64;
        reward
    }
}

/// Stability Pool global state
#[derive(Debug, Clone)]
pub struct SpPoolState {
    /// Total zkUSD in the pool
    pub total_deposits: u64,
    /// Total BTC from liquidations (pending or distributed)
    pub total_btc_gains: u64,
    /// Product P - tracks proportional losses (starts at SCALE_FACTOR)
    pub product_p: u128,
    /// Sum S - tracks BTC reward per unit deposit
    pub sum_s: u128,
    /// Current epoch (incremented when P underflows)
    pub current_epoch: u64,
    /// Current scale (incremented for precision)
    pub current_scale: u64,
    /// Number of depositors
    pub depositor_count: u64,
    /// S value at last scale change (for cross-scale reward calculation)
    pub sum_s_at_scale_change: Option<u128>,
    /// Last block when pool was updated
    pub last_update_block: u64,
}

impl Default for SpPoolState {
    fn default() -> Self {
        Self::new()
    }
}

impl SpPoolState {
    /// Create new stability pool state
    pub fn new() -> Self {
        Self {
            total_deposits: 0,
            total_btc_gains: 0,
            product_p: SP_SCALE_FACTOR,
            sum_s: 0,
            current_epoch: 0,
            current_scale: 0,
            depositor_count: 0,
            sum_s_at_scale_change: None,
            last_update_block: 0,
        }
    }

    /// Check if pool has sufficient deposits for an offset
    pub fn has_sufficient_deposits(&self, amount: u64) -> bool {
        self.total_deposits >= amount
    }

    /// Get the coverage ratio (total deposits / total debt in system)
    pub fn coverage_ratio(&self, total_debt: u64) -> u64 {
        if total_debt == 0 {
            return 10000; // 100% coverage
        }
        ((self.total_deposits as u128 * 10000) / total_debt as u128) as u64
    }
}

/// Request to deposit into stability pool
#[derive(Debug, Clone)]
pub struct DepositRequest {
    /// Depositor address
    pub depositor: [u8; 32],
    /// Amount to deposit
    pub amount: u64,
    /// Current block height
    pub block_height: u64,
}

/// Request to withdraw from stability pool
#[derive(Debug, Clone)]
pub struct WithdrawRequest {
    /// Depositor address
    pub depositor: [u8; 32],
    /// Amount to withdraw (0 = withdraw all)
    pub amount: u64,
    /// Current block height
    pub block_height: u64,
}

/// Result of a deposit operation
#[derive(Debug, Clone)]
pub struct DepositResult {
    /// Updated deposit state
    pub deposit: SpDeposit,
    /// BTC rewards claimed (if any)
    pub btc_claimed: u64,
    /// New total in pool
    pub new_pool_total: u64,
}

/// Result of a withdrawal operation
#[derive(Debug, Clone)]
pub struct WithdrawResult {
    /// Amount withdrawn (may be less than requested due to losses)
    pub amount_withdrawn: u64,
    /// BTC rewards claimed
    pub btc_claimed: u64,
    /// Remaining deposit
    pub remaining_deposit: u64,
    /// New total in pool
    pub new_pool_total: u64,
}

/// Result of a liquidation offset
#[derive(Debug, Clone)]
pub struct OffsetResult {
    /// Debt absorbed by pool
    pub debt_absorbed: u64,
    /// BTC distributed to pool
    pub btc_distributed: u64,
    /// Debt remaining (for redistribution)
    pub debt_remaining: u64,
    /// BTC remaining (for redistribution)
    pub btc_remaining: u64,
    /// New P value
    pub new_product_p: u128,
    /// New S value
    pub new_sum_s: u128,
}

/// Batch deposit request
#[derive(Debug, Clone)]
pub struct BatchDepositRequest {
    /// List of deposits
    pub deposits: Vec<(/*owner*/ [u8; 32], /*amount*/ u64)>,
    /// Current block height
    pub block_height: u64,
}

// ============================================================================
// Core Stability Pool Functions
// ============================================================================

/// Validate deposit request
pub fn validate_deposit(request: &DepositRequest) -> ZkUsdResult<()> {
    if request.amount < SP_MIN_DEPOSIT {
        return Err(ZkUsdError::InvalidAmount {
            amount: request.amount,
            reason: AmountErrorReason::TooSmall,
        });
    }
    Ok(())
}

/// Execute a deposit into the stability pool
pub fn execute_deposit(
    request: &DepositRequest,
    existing_deposit: Option<&SpDeposit>,
    pool: &mut SpPoolState,
) -> ZkUsdResult<DepositResult> {
    validate_deposit(request)?;

    // Calculate any pending rewards from existing deposit
    let btc_claimed = existing_deposit
        .map(|d| d.pending_btc_reward(pool))
        .unwrap_or(0);

    // Calculate compounded value of existing deposit
    let compounded_existing = existing_deposit
        .map(|d| d.compounded_value(pool))
        .unwrap_or(0);

    // New total deposit amount
    let new_deposit_amount = compounded_existing.saturating_add(request.amount);

    // Update pool totals
    pool.total_deposits = pool.total_deposits
        .saturating_sub(compounded_existing)
        .saturating_add(new_deposit_amount);

    if existing_deposit.is_none() {
        pool.depositor_count += 1;
    }

    pool.last_update_block = request.block_height;

    // Create new deposit snapshot
    let deposit = SpDeposit::new(
        request.depositor,
        new_deposit_amount,
        pool,
        request.block_height,
    );

    Ok(DepositResult {
        deposit,
        btc_claimed,
        new_pool_total: pool.total_deposits,
    })
}

/// Execute a withdrawal from the stability pool
pub fn execute_withdraw(
    request: &WithdrawRequest,
    deposit: &SpDeposit,
    pool: &mut SpPoolState,
) -> ZkUsdResult<WithdrawResult> {
    // Calculate compounded value
    let compounded = deposit.compounded_value(pool);

    if compounded == 0 {
        return Err(ZkUsdError::InvalidAmount {
            amount: 0,
            reason: AmountErrorReason::Zero,
        });
    }

    // Calculate pending BTC rewards
    let btc_claimed = deposit.pending_btc_reward(pool);

    // Determine withdrawal amount
    let withdraw_amount = if request.amount == 0 || request.amount >= compounded {
        compounded // Withdraw all
    } else {
        request.amount
    };

    let remaining = compounded.saturating_sub(withdraw_amount);

    // Update pool totals
    pool.total_deposits = pool.total_deposits.saturating_sub(withdraw_amount);

    if remaining == 0 {
        pool.depositor_count = pool.depositor_count.saturating_sub(1);
    }

    pool.last_update_block = request.block_height;

    Ok(WithdrawResult {
        amount_withdrawn: withdraw_amount,
        btc_claimed,
        remaining_deposit: remaining,
        new_pool_total: pool.total_deposits,
    })
}

/// Calculate liquidation offset - how much debt the pool can absorb
pub fn calculate_offset(
    debt_to_offset: u64,
    btc_to_distribute: u64,
    pool: &SpPoolState,
) -> OffsetResult {
    if pool.total_deposits == 0 {
        return OffsetResult {
            debt_absorbed: 0,
            btc_distributed: 0,
            debt_remaining: debt_to_offset,
            btc_remaining: btc_to_distribute,
            new_product_p: pool.product_p,
            new_sum_s: pool.sum_s,
        };
    }

    // Calculate how much debt can be absorbed
    let debt_absorbed = debt_to_offset.min(pool.total_deposits);
    let absorption_ratio = (debt_absorbed as u128 * SP_SCALE_FACTOR) / debt_to_offset as u128;
    let btc_distributed = ((btc_to_distribute as u128 * absorption_ratio) / SP_SCALE_FACTOR) as u64;

    // Calculate new P: P_new = P_old * (1 - debt_absorbed/total_deposits)
    let loss_ratio = (debt_absorbed as u128 * SP_SCALE_FACTOR) / pool.total_deposits as u128;
    let remaining_ratio = SP_SCALE_FACTOR.saturating_sub(loss_ratio);
    let new_p = (pool.product_p * remaining_ratio) / SP_SCALE_FACTOR;

    // Calculate new S: S_new = S_old + (btc_distributed * SCALE / total_deposits)
    let btc_per_deposit = (btc_distributed as u128 * SP_SCALE_FACTOR) / pool.total_deposits as u128;
    let new_s = pool.sum_s.saturating_add(btc_per_deposit);

    OffsetResult {
        debt_absorbed,
        btc_distributed,
        debt_remaining: debt_to_offset.saturating_sub(debt_absorbed),
        btc_remaining: btc_to_distribute.saturating_sub(btc_distributed),
        new_product_p: new_p,
        new_sum_s: new_s,
    }
}

/// Apply liquidation offset to the pool
pub fn apply_offset(
    offset: &OffsetResult,
    pool: &mut SpPoolState,
    block_height: u64,
) -> ZkUsdResult<()> {
    if offset.debt_absorbed == 0 {
        return Ok(());
    }

    // Check if P underflows (requires epoch increment)
    if offset.new_product_p < P_UNDERFLOW_THRESHOLD {
        pool.current_epoch += 1;
        pool.product_p = SP_SCALE_FACTOR;
        pool.sum_s = 0;
    } else {
        // Check if scale change is needed
        if offset.new_product_p < SP_SCALE_FACTOR / 1000 {
            pool.sum_s_at_scale_change = Some(pool.sum_s);
            pool.current_scale += 1;
            pool.product_p = offset.new_product_p * 1000;
        } else {
            pool.product_p = offset.new_product_p;
        }
        pool.sum_s = offset.new_sum_s;
    }

    // Update totals
    pool.total_deposits = pool.total_deposits.saturating_sub(offset.debt_absorbed);
    pool.total_btc_gains = pool.total_btc_gains.saturating_add(offset.btc_distributed);
    pool.last_update_block = block_height;

    Ok(())
}

/// Execute batch deposits
pub fn execute_batch_deposits(
    request: &BatchDepositRequest,
    pool: &mut SpPoolState,
) -> ZkUsdResult<Vec<DepositResult>> {
    if request.deposits.len() > MAX_BATCH_DEPOSITORS {
        return Err(ZkUsdError::InvalidAmount {
            amount: request.deposits.len() as u64,
            reason: AmountErrorReason::TooLarge,
        });
    }

    let mut results = Vec::new();

    for (owner, amount) in &request.deposits {
        let req = DepositRequest {
            depositor: *owner,
            amount: *amount,
            block_height: request.block_height,
        };
        let result = execute_deposit(&req, None, pool)?;
        results.push(result);
    }

    Ok(results)
}

/// Calculate total claimable BTC for a depositor
pub fn calculate_claimable_btc(
    deposit: &SpDeposit,
    pool: &SpPoolState,
) -> u64 {
    deposit.pending_btc_reward(pool)
}

/// Claim BTC rewards without withdrawing
pub fn claim_btc_rewards(
    deposit: &mut SpDeposit,
    pool: &SpPoolState,
    block_height: u64,
) -> ZkUsdResult<u64> {
    let btc_reward = deposit.pending_btc_reward(pool);

    if btc_reward == 0 {
        return Err(ZkUsdError::NoRewardsToClaim);
    }

    // Update snapshot to reset rewards
    deposit.snapshot_s = pool.sum_s;
    deposit.snapshot_epoch = pool.current_epoch;
    deposit.snapshot_scale = pool.current_scale;
    deposit.last_updated_block = block_height;

    // Update deposit value to compounded value
    deposit.deposit = deposit.compounded_value(pool);
    deposit.snapshot_p = pool.product_p;

    Ok(btc_reward)
}

/// Get pool statistics
#[derive(Debug, Clone)]
pub struct PoolStats {
    /// Total zkUSD deposited
    pub total_deposits: u64,
    /// Total BTC gains earned
    pub total_btc_gains: u64,
    /// Number of depositors
    pub depositor_count: u64,
    /// Current epoch
    pub epoch: u64,
    /// Current scale
    pub scale: u64,
    /// Average deposit size
    pub avg_deposit: u64,
    /// Coverage ratio (deposits / total debt)
    pub coverage_ratio_bps: u64,
}

/// Calculate pool statistics
pub fn get_pool_stats(pool: &SpPoolState, total_debt: u64) -> PoolStats {
    let avg_deposit = if pool.depositor_count > 0 {
        pool.total_deposits / pool.depositor_count
    } else {
        0
    };

    PoolStats {
        total_deposits: pool.total_deposits,
        total_btc_gains: pool.total_btc_gains,
        depositor_count: pool.depositor_count,
        epoch: pool.current_epoch,
        scale: pool.current_scale,
        avg_deposit,
        coverage_ratio_bps: pool.coverage_ratio(total_debt),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_ZKUSD: u64 = 100_000_000;
    const ONE_BTC: u64 = 100_000_000;

    fn test_owner() -> [u8; 32] {
        [1u8; 32]
    }

    fn test_owner_2() -> [u8; 32] {
        [2u8; 32]
    }

    #[test]
    fn test_new_pool() {
        let pool = SpPoolState::new();
        assert_eq!(pool.total_deposits, 0);
        assert_eq!(pool.product_p, SP_SCALE_FACTOR);
        assert_eq!(pool.sum_s, 0);
        assert_eq!(pool.current_epoch, 0);
    }

    #[test]
    fn test_deposit() {
        let mut pool = SpPoolState::new();

        let request = DepositRequest {
            depositor: test_owner(),
            amount: 10_000 * ONE_ZKUSD,
            block_height: 1000,
        };

        let result = execute_deposit(&request, None, &mut pool).unwrap();

        assert_eq!(result.deposit.deposit, 10_000 * ONE_ZKUSD);
        assert_eq!(pool.total_deposits, 10_000 * ONE_ZKUSD);
        assert_eq!(pool.depositor_count, 1);
    }

    #[test]
    fn test_deposit_below_minimum() {
        let mut pool = SpPoolState::new();

        let request = DepositRequest {
            depositor: test_owner(),
            amount: 10 * ONE_ZKUSD, // Below minimum
            block_height: 1000,
        };

        let result = execute_deposit(&request, None, &mut pool);
        assert!(matches!(result, Err(ZkUsdError::InvalidAmount { .. })));
    }

    #[test]
    fn test_withdraw() {
        let mut pool = SpPoolState::new();

        // First deposit
        let deposit_req = DepositRequest {
            depositor: test_owner(),
            amount: 10_000 * ONE_ZKUSD,
            block_height: 1000,
        };
        let deposit_result = execute_deposit(&deposit_req, None, &mut pool).unwrap();

        // Then withdraw half
        let withdraw_req = WithdrawRequest {
            depositor: test_owner(),
            amount: 5_000 * ONE_ZKUSD,
            block_height: 1001,
        };
        let result = execute_withdraw(&withdraw_req, &deposit_result.deposit, &mut pool).unwrap();

        assert_eq!(result.amount_withdrawn, 5_000 * ONE_ZKUSD);
        assert_eq!(result.remaining_deposit, 5_000 * ONE_ZKUSD);
        assert_eq!(pool.total_deposits, 5_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_withdraw_all() {
        let mut pool = SpPoolState::new();

        let deposit_req = DepositRequest {
            depositor: test_owner(),
            amount: 10_000 * ONE_ZKUSD,
            block_height: 1000,
        };
        let deposit_result = execute_deposit(&deposit_req, None, &mut pool).unwrap();

        let withdraw_req = WithdrawRequest {
            depositor: test_owner(),
            amount: 0, // 0 means withdraw all
            block_height: 1001,
        };
        let result = execute_withdraw(&withdraw_req, &deposit_result.deposit, &mut pool).unwrap();

        assert_eq!(result.amount_withdrawn, 10_000 * ONE_ZKUSD);
        assert_eq!(result.remaining_deposit, 0);
        assert_eq!(pool.depositor_count, 0);
    }

    #[test]
    fn test_liquidation_offset() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;

        let offset = calculate_offset(
            50_000 * ONE_ZKUSD, // debt
            ONE_BTC,           // BTC
            &pool,
        );

        assert_eq!(offset.debt_absorbed, 50_000 * ONE_ZKUSD);
        assert_eq!(offset.btc_distributed, ONE_BTC);
        assert_eq!(offset.debt_remaining, 0);
    }

    #[test]
    fn test_partial_offset() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 30_000 * ONE_ZKUSD;

        let offset = calculate_offset(
            50_000 * ONE_ZKUSD, // debt (more than deposits)
            ONE_BTC,           // BTC
            &pool,
        );

        assert_eq!(offset.debt_absorbed, 30_000 * ONE_ZKUSD);
        assert_eq!(offset.debt_remaining, 20_000 * ONE_ZKUSD);
        // BTC distributed proportionally
        assert!(offset.btc_distributed < ONE_BTC);
        assert!(offset.btc_remaining > 0);
    }

    #[test]
    fn test_apply_offset() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;

        let offset = calculate_offset(
            50_000 * ONE_ZKUSD,
            ONE_BTC,
            &pool,
        );

        apply_offset(&offset, &mut pool, 1001).unwrap();

        // Deposits should be reduced by debt absorbed
        assert_eq!(pool.total_deposits, 50_000 * ONE_ZKUSD);
        // BTC gains should increase
        assert_eq!(pool.total_btc_gains, ONE_BTC);
        // P should be reduced (50% loss = P * 0.5)
        assert!(pool.product_p < SP_SCALE_FACTOR);
    }

    #[test]
    fn test_compounded_deposit_after_loss() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;

        // Create deposit
        let deposit = SpDeposit::new(test_owner(), 10_000 * ONE_ZKUSD, &pool, 1000);

        // Apply 20% loss (20,000 debt absorbed from 100,000 total)
        let offset = calculate_offset(20_000 * ONE_ZKUSD, ONE_BTC / 5, &pool);
        apply_offset(&offset, &mut pool, 1001).unwrap();

        // Compounded value should be ~80% of original
        let compounded = deposit.compounded_value(&pool);
        // Allow some precision loss
        assert!(compounded >= 7_900 * ONE_ZKUSD && compounded <= 8_100 * ONE_ZKUSD);
    }

    #[test]
    fn test_btc_rewards() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;

        // Create deposit (10% of pool)
        let deposit = SpDeposit::new(test_owner(), 10_000 * ONE_ZKUSD, &pool, 1000);

        // Apply liquidation with BTC distribution
        let offset = calculate_offset(20_000 * ONE_ZKUSD, 10 * ONE_BTC, &pool);
        apply_offset(&offset, &mut pool, 1001).unwrap();

        // Should receive ~10% of distributed BTC (proportional to deposit share)
        let btc_reward = deposit.pending_btc_reward(&pool);
        // Allow for precision differences
        assert!(btc_reward > 0);
    }

    #[test]
    fn test_claim_rewards() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;
        pool.sum_s = SP_SCALE_FACTOR / 10; // Some rewards accumulated

        let mut deposit = SpDeposit::new(test_owner(), 10_000 * ONE_ZKUSD, &pool, 1000);
        deposit.snapshot_s = 0; // Start from 0 to have rewards

        let claimed = claim_btc_rewards(&mut deposit, &pool, 1001).unwrap();

        assert!(claimed > 0);
        // Snapshot should be updated
        assert_eq!(deposit.snapshot_s, pool.sum_s);
    }

    #[test]
    fn test_pool_stats() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;
        pool.total_btc_gains = 5 * ONE_BTC;
        pool.depositor_count = 10;

        let stats = get_pool_stats(&pool, 200_000 * ONE_ZKUSD);

        assert_eq!(stats.total_deposits, 100_000 * ONE_ZKUSD);
        assert_eq!(stats.depositor_count, 10);
        assert_eq!(stats.avg_deposit, 10_000 * ONE_ZKUSD);
        assert_eq!(stats.coverage_ratio_bps, 5000); // 50%
    }

    #[test]
    fn test_batch_deposits() {
        let mut pool = SpPoolState::new();

        let request = BatchDepositRequest {
            deposits: vec![
                (test_owner(), 10_000 * ONE_ZKUSD),
                (test_owner_2(), 20_000 * ONE_ZKUSD),
            ],
            block_height: 1000,
        };

        let results = execute_batch_deposits(&request, &mut pool).unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(pool.total_deposits, 30_000 * ONE_ZKUSD);
        assert_eq!(pool.depositor_count, 2);
    }

    #[test]
    fn test_coverage_ratio() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 60_000 * ONE_ZKUSD;

        // 60% coverage
        let ratio = pool.coverage_ratio(100_000 * ONE_ZKUSD);
        assert_eq!(ratio, 6000);

        // Full coverage
        pool.total_deposits = 100_000 * ONE_ZKUSD;
        let ratio = pool.coverage_ratio(100_000 * ONE_ZKUSD);
        assert_eq!(ratio, 10000);

        // No debt
        let ratio = pool.coverage_ratio(0);
        assert_eq!(ratio, 10000);
    }

    #[test]
    fn test_empty_pool_offset() {
        let pool = SpPoolState::new();

        let offset = calculate_offset(50_000 * ONE_ZKUSD, ONE_BTC, &pool);

        // Empty pool can't absorb anything
        assert_eq!(offset.debt_absorbed, 0);
        assert_eq!(offset.debt_remaining, 50_000 * ONE_ZKUSD);
    }
}
