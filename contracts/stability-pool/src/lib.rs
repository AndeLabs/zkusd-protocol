//! Stability Pool Contract
//!
//! First line of defense for the zkUSD system.
//! Users deposit zkUSD and earn BTC from liquidations.
//!
//! ## UTXO-Based Design (NOT Smart Contracts)
//!
//! This is a **validation function**, not a smart contract:
//! - No global state machine
//! - Each deposit is an individual UTXO charm
//! - Pool state tracks only aggregates (total, P, S)
//! - Users validate their own deposits client-side

use borsh::{BorshDeserialize, BorshSerialize};

// Charms SDK integration (conditional compilation)
#[cfg(feature = "charms")]
pub mod charms;
use serde::{Deserialize, Serialize};

use zkusd_common::{
    constants::stability_pool::{MIN_DEPOSIT, SCALE_FACTOR},
    errors::{ZkUsdError, ZkUsdResult},
    events::{EventLog, ZkUsdEvent},
    math::{calculate_btc_gain, calculate_compounded_deposit},
    types::{Address, AppId, StabilityDeposit, StabilityPoolAction, StabilityPoolState},
};

// ============ Stability Pool Config ============

/// Configuration for the Stability Pool
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct StabilityPoolConfig {
    /// zkUSD Token app_id
    pub zkusd_token_id: AppId,
    /// Vault Manager app_id (only this can call offset)
    pub vault_manager_id: AppId,
    /// Admin address
    pub admin: Address,
}

// ============ Validation Context ============

/// Context for validating stability pool operations
pub struct StabilityPoolContext {
    /// Current pool state
    pub state: StabilityPoolState,
    /// Updated pool state
    pub new_state: StabilityPoolState,
    /// Config
    pub config: StabilityPoolConfig,
    /// User's deposit (if any)
    pub deposit: Option<StabilityDeposit>,
    /// Updated user deposit
    pub new_deposit: Option<StabilityDeposit>,
    /// zkUSD inputs
    pub zkusd_inputs: u64,
    /// zkUSD outputs
    pub zkusd_outputs: u64,
    /// BTC inputs (from liquidations)
    pub btc_inputs: u64,
    /// BTC outputs (to claimers)
    pub btc_outputs: u64,
    /// Caller app_id (for offset authorization)
    pub caller_app_id: Option<AppId>,
    /// Signer address
    pub signer: Address,
    /// Current block height
    pub block_height: u64,
    /// Event log
    pub events: EventLog,
}

// ============ Validation Functions ============

/// Main validation entry point
pub fn validate(ctx: &mut StabilityPoolContext, action: &StabilityPoolAction) -> ZkUsdResult<()> {
    match action {
        StabilityPoolAction::Deposit { amount } => validate_deposit(ctx, *amount),
        StabilityPoolAction::Withdraw { amount } => validate_withdraw(ctx, *amount),
        StabilityPoolAction::ClaimBtc => validate_claim_btc(ctx),
        StabilityPoolAction::Offset { debt, collateral } => {
            validate_offset(ctx, *debt, *collateral)
        }
    }
}

/// Validate depositing zkUSD into the pool
fn validate_deposit(ctx: &mut StabilityPoolContext, amount: u64) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Check minimum deposit
    let existing_deposit = ctx.deposit.as_ref().map(|d| d.initial_value).unwrap_or(0);
    let total_deposit = existing_deposit
        .checked_add(amount)
        .ok_or(ZkUsdError::Overflow)?;

    if total_deposit < MIN_DEPOSIT && existing_deposit == 0 {
        return Err(ZkUsdError::BelowMinimum {
            amount: total_deposit,
            minimum: MIN_DEPOSIT,
        });
    }

    // 3. Verify zkUSD is being deposited
    if ctx.zkusd_inputs < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.zkusd_inputs,
            requested: amount,
        });
    }

    // 4. Calculate compounded deposit value (if existing deposit)
    let compounded_value = if let Some(ref deposit) = ctx.deposit {
        calculate_compounded_deposit(
            deposit.initial_value,
            deposit.snapshot_p,
            ctx.state.product_p,
            deposit.snapshot_scale,
            ctx.state.current_scale,
            deposit.snapshot_epoch,
            ctx.state.current_epoch,
        )
    } else {
        0
    };

    // 5. Verify new deposit state
    let new_deposit = ctx.new_deposit.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    let expected_value = compounded_value
        .checked_add(amount)
        .ok_or(ZkUsdError::Overflow)?;

    if new_deposit.initial_value != expected_value {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 6. Verify pool state update
    let expected_total = ctx.state.total_zkusd
        .checked_add(amount)
        .ok_or(ZkUsdError::Overflow)?;

    if ctx.new_state.total_zkusd != expected_total {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 7. Emit event
    ctx.events.emit(ZkUsdEvent::StabilityDeposit {
        depositor: ctx.signer,
        amount,
        new_deposit: expected_value,
        pool_total: expected_total,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate withdrawing zkUSD from the pool
fn validate_withdraw(ctx: &mut StabilityPoolContext, amount: u64) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Get deposit
    let deposit = ctx.deposit.as_ref().ok_or(ZkUsdError::DepositNotFound {
        user: ctx.signer,
    })?;

    // 3. Only owner can withdraw
    if deposit.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: deposit.owner,
            actual: ctx.signer,
        });
    }

    // 4. Calculate compounded value
    let compounded_value = calculate_compounded_deposit(
        deposit.initial_value,
        deposit.snapshot_p,
        ctx.state.product_p,
        deposit.snapshot_scale,
        ctx.state.current_scale,
        deposit.snapshot_epoch,
        ctx.state.current_epoch,
    );

    // 5. Cannot withdraw more than available
    if amount > compounded_value {
        return Err(ZkUsdError::InsufficientBalance {
            available: compounded_value,
            requested: amount,
        });
    }

    // 6. Calculate and distribute any BTC gains
    let btc_gain = calculate_btc_gain(
        deposit.initial_value,
        deposit.snapshot_s,
        ctx.state.sum_s,
    );

    // 7. Verify zkUSD output
    if ctx.zkusd_outputs < amount {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 8. Verify BTC output if there are gains
    if btc_gain > 0 && ctx.btc_outputs < btc_gain {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 9. Emit event
    ctx.events.emit(ZkUsdEvent::StabilityWithdrawal {
        depositor: ctx.signer,
        zkusd_withdrawn: amount,
        compounded_amount: compounded_value,
        block_height: ctx.block_height,
    });

    // 10. Emit BTC reward event if applicable
    if btc_gain > 0 {
        ctx.events.emit(ZkUsdEvent::BtcRewardClaimed {
            depositor: ctx.signer,
            btc_amount: btc_gain,
            block_height: ctx.block_height,
        });
    }

    Ok(())
}

/// Validate claiming BTC rewards without withdrawing zkUSD
fn validate_claim_btc(ctx: &mut StabilityPoolContext) -> ZkUsdResult<()> {
    // 1. Get deposit
    let deposit = ctx.deposit.as_ref().ok_or(ZkUsdError::DepositNotFound {
        user: ctx.signer,
    })?;

    // 2. Only owner can claim
    if deposit.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: deposit.owner,
            actual: ctx.signer,
        });
    }

    // 3. Calculate BTC gains
    let btc_gain = calculate_btc_gain(
        deposit.initial_value,
        deposit.snapshot_s,
        ctx.state.sum_s,
    );

    // 4. Must have rewards to claim
    if btc_gain == 0 {
        return Err(ZkUsdError::NoRewardsToClaim);
    }

    // 5. Verify BTC output
    if ctx.btc_outputs < btc_gain {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 6. Verify deposit snapshot is updated
    let new_deposit = ctx.new_deposit.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_deposit.snapshot_s != ctx.state.sum_s {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 7. Emit event
    ctx.events.emit(ZkUsdEvent::BtcRewardClaimed {
        depositor: ctx.signer,
        btc_amount: btc_gain,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate offset operation (called during liquidation)
/// Only VaultManager can call this
fn validate_offset(
    ctx: &mut StabilityPoolContext,
    debt: u64,
    collateral: u64,
) -> ZkUsdResult<()> {
    // 1. Only VaultManager can call offset
    let caller = ctx.caller_app_id.ok_or(ZkUsdError::Unauthorized {
        expected: ctx.config.vault_manager_id,
        actual: [0u8; 32],
    })?;

    if caller != ctx.config.vault_manager_id {
        return Err(ZkUsdError::Unauthorized {
            expected: ctx.config.vault_manager_id,
            actual: caller,
        });
    }

    // 2. Pool must have enough zkUSD
    if ctx.state.total_zkusd < debt {
        return Err(ZkUsdError::InsufficientPoolBalance {
            available: ctx.state.total_zkusd,
            required: debt,
        });
    }

    // 3. Verify collateral is being received
    if ctx.btc_inputs < collateral {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.btc_inputs,
            requested: collateral,
        });
    }

    // 4. Update P and S values
    // P_new = P * (1 - debt / total_zkusd)
    // S_new = S + (collateral / total_zkusd) * P
    let debt_ratio = (debt as u128)
        .checked_mul(SCALE_FACTOR)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(ctx.state.total_zkusd as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    let expected_p = ctx.state.product_p
        .checked_mul(SCALE_FACTOR - debt_ratio)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(SCALE_FACTOR)
        .ok_or(ZkUsdError::DivisionByZero)?;

    // Calculate S value update: S_new = S + (collateral * P / total_zkusd)
    // This tracks cumulative BTC gains per unit of zkUSD deposited
    let collateral_per_unit = (collateral as u128)
        .checked_mul(ctx.state.product_p)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(ctx.state.total_zkusd as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    let expected_s = ctx.state.sum_s
        .checked_add(collateral_per_unit)
        .ok_or(ZkUsdError::Overflow)?;

    // 5. Verify pool state update
    let expected_total = ctx.state.total_zkusd
        .checked_sub(debt)
        .ok_or(ZkUsdError::Underflow)?;

    if ctx.new_state.total_zkusd != expected_total {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // Verify P value update
    if ctx.new_state.product_p != expected_p {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // Verify S value update (BTC distribution tracking)
    if ctx.new_state.sum_s != expected_s {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 6. Emit event
    ctx.events.emit(ZkUsdEvent::LiquidationOffset {
        debt_offset: debt,
        collateral_gained: collateral,
        new_pool_total: expected_total,
        block_height: ctx.block_height,
    });

    Ok(())
}

// ============ Helper Functions ============

/// Calculate user's current compounded deposit value
pub fn get_compounded_value(
    deposit: &StabilityDeposit,
    state: &StabilityPoolState,
) -> u64 {
    calculate_compounded_deposit(
        deposit.initial_value,
        deposit.snapshot_p,
        state.product_p,
        deposit.snapshot_scale,
        state.current_scale,
        deposit.snapshot_epoch,
        state.current_epoch,
    )
}

/// Calculate user's pending BTC rewards
pub fn get_pending_btc(
    deposit: &StabilityDeposit,
    state: &StabilityPoolState,
) -> u64 {
    calculate_btc_gain(
        deposit.initial_value,
        deposit.snapshot_s,
        state.sum_s,
    )
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_ZKUSD: u64 = 100_000_000;
    const ONE_BTC: u64 = 100_000_000;

    fn create_test_context() -> StabilityPoolContext {
        StabilityPoolContext {
            state: StabilityPoolState::new(),
            new_state: StabilityPoolState::new(),
            config: StabilityPoolConfig {
                zkusd_token_id: [1u8; 32],
                vault_manager_id: [2u8; 32],
                admin: [0u8; 32],
            },
            deposit: None,
            new_deposit: None,
            zkusd_inputs: 0,
            zkusd_outputs: 0,
            btc_inputs: 0,
            btc_outputs: 0,
            caller_app_id: None,
            signer: [1u8; 32],
            block_height: 100,
            events: EventLog::new(),
        }
    }

    #[test]
    fn test_deposit_success() {
        let mut ctx = create_test_context();
        let depositor = [1u8; 32];
        let amount = 10_000 * ONE_ZKUSD;

        ctx.signer = depositor;
        ctx.zkusd_inputs = amount;
        ctx.new_state.total_zkusd = amount;

        ctx.new_deposit = Some(StabilityDeposit {
            owner: depositor,
            initial_value: amount,
            snapshot_p: SCALE_FACTOR,
            snapshot_s: 0,
            snapshot_epoch: 0,
            snapshot_scale: 0,
            last_updated: 100,
        });

        let action = StabilityPoolAction::Deposit { amount };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Should succeed: {:?}", result);
        assert_eq!(ctx.events.len(), 1);
    }

    #[test]
    fn test_deposit_below_minimum() {
        let mut ctx = create_test_context();
        let amount = 50 * ONE_ZKUSD; // Below MIN_DEPOSIT (100 zkUSD)

        ctx.zkusd_inputs = amount;

        let action = StabilityPoolAction::Deposit { amount };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::BelowMinimum { .. })));
    }

    #[test]
    fn test_offset_authorized() {
        let mut ctx = create_test_context();
        let vault_manager = [2u8; 32];

        ctx.caller_app_id = Some(vault_manager);
        ctx.state.total_zkusd = 100_000 * ONE_ZKUSD;
        ctx.state.product_p = SCALE_FACTOR;
        ctx.state.sum_s = 0;
        ctx.btc_inputs = ONE_BTC;

        let debt = 10_000 * ONE_ZKUSD;
        let collateral = ONE_BTC;

        // Calculate expected product_p after offset
        // debt_ratio = (10_000 * SCALE_FACTOR) / 100_000 = SCALE_FACTOR / 10
        // new_p = SCALE_FACTOR * (SCALE_FACTOR - SCALE_FACTOR/10) / SCALE_FACTOR
        //       = 9 * SCALE_FACTOR / 10
        let debt_ratio = (debt as u128) * SCALE_FACTOR / (100_000 * ONE_ZKUSD) as u128;
        let expected_p = SCALE_FACTOR * (SCALE_FACTOR - debt_ratio) / SCALE_FACTOR;

        // Calculate expected sum_s after offset
        // S_new = S + (collateral * P / total_zkusd)
        // S_new = 0 + (1 BTC * SCALE_FACTOR / 100_000 zkUSD)
        let expected_s = (collateral as u128) * ctx.state.product_p / (100_000 * ONE_ZKUSD) as u128;

        ctx.new_state.total_zkusd = 90_000 * ONE_ZKUSD;
        ctx.new_state.product_p = expected_p;
        ctx.new_state.sum_s = expected_s;

        let action = StabilityPoolAction::Offset {
            debt,
            collateral,
        };

        let result = validate(&mut ctx, &action);
        assert!(result.is_ok(), "Offset should succeed: {:?}", result);

        // Verify S value was set correctly (BTC per unit tracking)
        assert!(ctx.new_state.sum_s > 0, "S value should increase after liquidation");
    }

    #[test]
    fn test_offset_unauthorized() {
        let mut ctx = create_test_context();
        let attacker = [99u8; 32];

        ctx.caller_app_id = Some(attacker);
        ctx.state.total_zkusd = 100_000 * ONE_ZKUSD;

        let action = StabilityPoolAction::Offset {
            debt: 10_000 * ONE_ZKUSD,
            collateral: ONE_BTC,
        };

        let result = validate(&mut ctx, &action);
        assert!(matches!(result, Err(ZkUsdError::Unauthorized { .. })));
    }
}
