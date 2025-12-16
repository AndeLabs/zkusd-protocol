//! Advanced Operations for zkUSD Protocol
//!
//! This module implements the innovative features that leverage the UTXO model:
//! - Soft Liquidation (LLAMMA-inspired)
//! - Vault Sharding
//! - Redemption by Interest Rate
//! - Batch Operations
//! - Atomic Rescue
//! - Fee Prediction

use crate::{
    constants::{fees::BPS_DENOMINATOR, ratios::MCR},
    errors::{ZkUsdError, ZkUsdResult},
    math::calculate_icr,
    types::*,
    Vec,
};

// ============ Soft Liquidation Operations ============

/// Configuration for soft liquidation
#[derive(Debug, Clone)]
pub struct SoftLiquidationConfig {
    /// Number of bands to create
    pub num_bands: u8,
    /// Minimum price as percentage of current (e.g., 80 = 80%)
    pub min_price_pct: u64,
    /// Maximum price as percentage of current (e.g., 110 = 110%)
    pub max_price_pct: u64,
    /// Blocks before hard liquidation after soft liq starts
    pub grace_period_blocks: u64,
}

impl Default for SoftLiquidationConfig {
    fn default() -> Self {
        Self {
            num_bands: 4,
            min_price_pct: 80,
            max_price_pct: 110,
            grace_period_blocks: 144, // ~1 day
        }
    }
}

/// Process soft liquidation for a vault
pub fn process_soft_liquidation(
    vault: &mut SoftLiquidationVault,
    current_price: u64,
    current_block: u64,
    config: &SoftLiquidationConfig,
) -> ZkUsdResult<SoftLiquidationResult> {
    let btc_converted = vault.process_soft_liquidation(current_price, current_block);

    // Check if we should force hard liquidation
    let should_hard_liquidate = if vault.soft_liq_start_block > 0 {
        current_block > vault.soft_liq_start_block + config.grace_period_blocks
    } else {
        false
    };

    Ok(SoftLiquidationResult {
        vault_id: vault.vault.id,
        btc_converted,
        zkusd_received: (btc_converted as u128 * current_price as u128 / 100_000_000) as u64,
        is_in_soft_liquidation: vault.is_in_soft_liquidation,
        should_hard_liquidate,
        bands_affected: vault.bands.iter().filter(|b| b.status == LiquidationBandStatus::SoftLiquidation).count() as u8,
    })
}

/// Result of soft liquidation processing
#[derive(Debug, Clone)]
pub struct SoftLiquidationResult {
    pub vault_id: VaultId,
    pub btc_converted: u64,
    pub zkusd_received: u64,
    pub is_in_soft_liquidation: bool,
    pub should_hard_liquidate: bool,
    pub bands_affected: u8,
}

/// Reverse soft liquidation when price recovers
pub fn reverse_soft_liquidation(
    vault: &mut SoftLiquidationVault,
    current_price: u64,
) -> ZkUsdResult<u64> {
    Ok(vault.reverse_soft_liquidation(current_price))
}

// ============ Vault Sharding Operations ============

/// Split a vault into shards
pub fn shard_vault(vault: Vault, num_shards: u8) -> ZkUsdResult<ShardedVault> {
    if !ShardedVault::should_shard(vault.collateral) {
        return Err(ZkUsdError::InvalidInput {
            param: "collateral",
            reason: "Vault too small to shard",
        });
    }

    if num_shards < 2 || num_shards > 10 {
        return Err(ZkUsdError::InvalidInput {
            param: "num_shards",
            reason: "Must be between 2 and 10",
        });
    }

    Ok(ShardedVault::from_vault(vault, num_shards))
}

/// Merge shards back into a single vault
pub fn merge_shards(sharded_vault: &ShardedVault) -> ZkUsdResult<Vault> {
    // Sum up all active shards
    let mut total_collateral = 0u64;
    let mut total_debt = 0u64;

    for shard in &sharded_vault.shards {
        if shard.status == VaultStatus::Active {
            total_collateral = total_collateral.saturating_add(shard.collateral);
            total_debt = total_debt.saturating_add(shard.debt);
        }
    }

    Ok(Vault {
        id: sharded_vault.vault_id,
        owner: sharded_vault.owner,
        collateral: total_collateral,
        debt: total_debt,
        created_at: sharded_vault.created_at,
        last_updated: 0, // Should be set by caller
        status: VaultStatus::Active,
        interest_rate_bps: sharded_vault.interest_rate_bps,
        accrued_interest: 0,
        redistributed_debt: 0,
        redistributed_collateral: 0,
        insurance_balance: 0,
    })
}

/// Liquidate a single shard (parallel processing advantage)
pub fn liquidate_shard(
    shard: &mut VaultShard,
    btc_price: u64,
) -> ZkUsdResult<ShardLiquidationResult> {
    let icr = calculate_icr(shard.collateral, shard.debt, btc_price)?;

    if icr >= MCR {
        return Err(ZkUsdError::NotLiquidatable {
            vault_id: shard.shard_id,
            icr,
        });
    }

    let collateral_to_liquidate = shard.collateral;
    let debt_to_offset = shard.debt;

    shard.status = VaultStatus::Liquidated;
    shard.collateral = 0;
    shard.debt = 0;

    Ok(ShardLiquidationResult {
        shard_id: shard.shard_id,
        parent_vault_id: shard.parent_vault_id,
        shard_index: shard.shard_index,
        collateral_liquidated: collateral_to_liquidate,
        debt_offset: debt_to_offset,
    })
}

/// Result of shard liquidation
#[derive(Debug, Clone)]
pub struct ShardLiquidationResult {
    pub shard_id: [u8; 32],
    pub parent_vault_id: VaultId,
    pub shard_index: u8,
    pub collateral_liquidated: u64,
    pub debt_offset: u64,
}

// ============ Redemption by Interest Rate ============

/// Build a redemption batch from a list of vaults, ordered by interest rate
pub fn build_redemption_batch(
    vaults: &[Vault],
    redeemer: Address,
    zkusd_to_redeem: u64,
    btc_price: u64,
) -> ZkUsdResult<RedemptionBatch> {
    let mut batch = RedemptionBatch::new(redeemer);

    // Add all vaults to batch (will be sorted automatically)
    for vault in vaults {
        if vault.status != VaultStatus::Active {
            continue;
        }

        let order = RedemptionOrder {
            vault_id: vault.id,
            interest_rate_bps: vault.interest_rate_bps,
            max_redeemable: vault.entire_debt(),
            btc_per_zkusd: 0, // Will be calculated
        };
        batch.add_vault(order);
    }

    // Calculate redemption amounts
    batch.calculate(zkusd_to_redeem, btc_price);

    Ok(batch)
}

/// Execute redemption against vaults in interest rate order
pub fn execute_redemption(
    vaults: &mut [Vault],
    batch: &RedemptionBatch,
    btc_price: u64,
) -> ZkUsdResult<RedemptionExecution> {
    let mut total_redeemed = 0u64;
    let mut total_btc = 0u64;
    let mut vaults_affected = 0u32;

    for order in &batch.orders {
        if order.btc_per_zkusd == 0 {
            continue; // No redemption from this vault
        }

        // Find and update the vault
        if let Some(vault) = vaults.iter_mut().find(|v| v.id == order.vault_id) {
            let debt_to_redeem = order.max_redeemable.min(batch.total_zkusd - total_redeemed);
            let btc_to_give = (debt_to_redeem as u128 * 100_000_000 / btc_price as u128) as u64;

            vault.debt = vault.debt.saturating_sub(debt_to_redeem);
            vault.collateral = vault.collateral.saturating_sub(btc_to_give);

            // Close vault if debt is too low
            if vault.debt < crate::constants::limits::MIN_DEBT {
                vault.status = VaultStatus::Closed;
            }

            total_redeemed = total_redeemed.saturating_add(debt_to_redeem);
            total_btc = total_btc.saturating_add(btc_to_give);
            vaults_affected += 1;

            if total_redeemed >= batch.total_zkusd {
                break;
            }
        }
    }

    Ok(RedemptionExecution {
        zkusd_redeemed: total_redeemed,
        btc_received: total_btc,
        fee_paid: batch.fee,
        vaults_affected,
    })
}

/// Result of redemption execution
#[derive(Debug, Clone)]
pub struct RedemptionExecution {
    pub zkusd_redeemed: u64,
    pub btc_received: u64,
    pub fee_paid: u64,
    pub vaults_affected: u32,
}

// ============ Batch Operations ============

/// Process a batch of deposits to stability pool
pub fn process_batch_deposits(
    deposits: &[BatchDeposit],
    pool: &mut StabilityPoolState,
) -> ZkUsdResult<BatchResult> {
    let mut results = Vec::with_capacity(deposits.len());
    let mut successes = 0u32;
    let mut failures = 0u32;

    for (i, deposit) in deposits.iter().enumerate() {
        if deposit.amount < crate::constants::stability_pool::MIN_DEPOSIT {
            results.push(OperationResult {
                index: i as u32,
                success: false,
                error_code: Some(12), // BelowMinimum
            });
            failures += 1;
        } else {
            pool.total_zkusd = pool.total_zkusd.saturating_add(deposit.amount);
            pool.depositor_count += 1;
            results.push(OperationResult {
                index: i as u32,
                success: true,
                error_code: None,
            });
            successes += 1;
        }
    }

    // Calculate gas savings (60% savings for batching)
    let individual_gas = deposits.len() as u64 * 21000; // Approx gas per deposit
    let batched_gas = 21000 + (deposits.len() as u64 * 5000);
    let gas_saved = individual_gas.saturating_sub(batched_gas);

    Ok(BatchResult {
        successes,
        failures,
        gas_saved,
        results,
    })
}

/// Process a batch of liquidations
pub fn process_batch_liquidations(
    batch: &BatchLiquidation,
    vaults: &mut [Vault],
    pool: &mut StabilityPoolState,
    btc_price: u64,
) -> ZkUsdResult<BatchResult> {
    let mut results = Vec::with_capacity(batch.vault_ids.len());
    let mut successes = 0u32;
    let mut failures = 0u32;

    for (i, vault_id) in batch.vault_ids.iter().enumerate() {
        // Find the vault
        if let Some(vault) = vaults.iter_mut().find(|v| v.id == *vault_id) {
            let icr = calculate_icr(vault.collateral, vault.debt, btc_price)
                .unwrap_or(u64::MAX);

            if icr >= MCR {
                results.push(OperationResult {
                    index: i as u32,
                    success: false,
                    error_code: Some(60), // NotLiquidatable
                });
                failures += 1;
            } else if pool.total_zkusd >= vault.debt {
                // Can fully offset
                pool.total_zkusd = pool.total_zkusd.saturating_sub(vault.debt);
                pool.total_btc = pool.total_btc.saturating_add(vault.collateral);
                vault.status = VaultStatus::Liquidated;
                vault.collateral = 0;
                vault.debt = 0;

                results.push(OperationResult {
                    index: i as u32,
                    success: true,
                    error_code: None,
                });
                successes += 1;
            } else {
                results.push(OperationResult {
                    index: i as u32,
                    success: false,
                    error_code: Some(50), // InsufficientPoolBalance
                });
                failures += 1;
            }
        } else {
            results.push(OperationResult {
                index: i as u32,
                success: false,
                error_code: Some(1), // VaultNotFound
            });
            failures += 1;
        }
    }

    let gas_saved = (batch.vault_ids.len() as u64 * 50000).saturating_sub(50000 + batch.vault_ids.len() as u64 * 10000);

    Ok(BatchResult {
        successes,
        failures,
        gas_saved,
        results,
    })
}

// ============ Atomic Rescue ============

/// Execute an atomic rescue offer
pub fn execute_rescue(
    vault: &mut Vault,
    offer: &mut RescueOffer,
    btc_price: u64,
    current_block: u64,
) -> ZkUsdResult<RescueExecution> {
    // Validate offer
    if !offer.is_valid(current_block) {
        return Err(ZkUsdError::InvalidInput {
            param: "offer",
            reason: "Offer expired or already executed",
        });
    }

    if vault.id != offer.vault_id {
        return Err(ZkUsdError::VaultNotFound { vault_id: offer.vault_id });
    }

    // Calculate new ICR after rescue
    let new_collateral = vault.collateral.saturating_add(offer.collateral_to_add);
    let new_debt = vault.debt.saturating_sub(offer.debt_to_repay);
    let new_icr = calculate_icr(new_collateral, new_debt, btc_price)?;

    if new_icr < offer.min_icr_after {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: new_icr,
            required_ratio: offer.min_icr_after,
        });
    }

    // Execute rescue
    vault.collateral = new_collateral;
    vault.debt = new_debt;
    vault.last_updated = current_block;
    offer.is_executed = true;

    // Calculate rescuer's bonus (if vault has future surplus)
    let surplus_bonus = if new_icr > 150 {
        let surplus_value = (vault.collateral as u128 * btc_price as u128 / 100_000_000) as u64;
        let debt_value = vault.debt;
        let excess = surplus_value.saturating_sub(debt_value * 150 / 100);
        excess * offer.surplus_bonus_bps / BPS_DENOMINATOR
    } else {
        0
    };

    Ok(RescueExecution {
        vault_id: vault.id,
        collateral_added: offer.collateral_to_add,
        debt_repaid: offer.debt_to_repay,
        new_icr,
        rescuer_bonus: surplus_bonus,
    })
}

/// Result of rescue execution
#[derive(Debug, Clone)]
pub struct RescueExecution {
    pub vault_id: VaultId,
    pub collateral_added: u64,
    pub debt_repaid: u64,
    pub new_icr: u64,
    pub rescuer_bonus: u64,
}

// ============ Staking Operations ============

/// Stake zkUSD to earn yield
pub fn stake_zkusd(
    pool: &mut StakingPool,
    owner: Address,
    amount: u64,
    current_block: u64,
) -> ZkUsdResult<StakedZkUSD> {
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // Distribute pending fees first
    pool.distribute_fees();

    let stake = StakedZkUSD::new(owner, amount, current_block, pool.reward_index);
    pool.total_staked = pool.total_staked.saturating_add(amount);
    pool.staker_count += 1;

    Ok(stake)
}

/// Unstake zkUSD and claim rewards
pub fn unstake_zkusd(
    pool: &mut StakingPool,
    stake: &mut StakedZkUSD,
    current_block: u64,
) -> ZkUsdResult<UnstakeResult> {
    // Distribute pending fees first
    pool.distribute_fees();

    // Calculate rewards
    let rewards = stake.pending_rewards(pool.reward_index);
    let total_to_receive = stake.staked_amount.saturating_add(rewards);

    // Update pool
    pool.total_staked = pool.total_staked.saturating_sub(stake.staked_amount);
    pool.staker_count = pool.staker_count.saturating_sub(1);

    // Clear stake
    let original_amount = stake.staked_amount;
    stake.staked_amount = 0;
    stake.rewards_earned = stake.rewards_earned.saturating_add(rewards);
    stake.last_claim_block = current_block;

    Ok(UnstakeResult {
        principal: original_amount,
        rewards,
        total: total_to_receive,
    })
}

/// Result of unstaking
#[derive(Debug, Clone)]
pub struct UnstakeResult {
    pub principal: u64,
    pub rewards: u64,
    pub total: u64,
}

// ============ Insurance Operations ============

/// Purchase insurance charm for a vault
pub fn purchase_insurance(
    vault: &Vault,
    coverage_btc: u64,
    trigger_icr: u64,
    duration_blocks: u64,
    current_block: u64,
) -> ZkUsdResult<(InsuranceCharm, u64)> {
    // Validate inputs
    if trigger_icr < 100 || trigger_icr > 120 {
        return Err(ZkUsdError::InvalidInput {
            param: "trigger_icr",
            reason: "Must be between 100% and 120%",
        });
    }

    if coverage_btc > vault.collateral {
        return Err(ZkUsdError::InvalidInput {
            param: "coverage_btc",
            reason: "Coverage exceeds vault collateral",
        });
    }

    // Calculate premium
    let premium = InsuranceCharm::calculate_premium(coverage_btc, duration_blocks, trigger_icr);

    // Create charm ID (hash of vault_id + block)
    let mut charm_id = vault.id;
    let block_bytes = current_block.to_le_bytes();
    for (i, byte) in block_bytes.iter().enumerate() {
        charm_id[24 + i] = *byte;
    }

    let charm = InsuranceCharm::new(
        charm_id,
        vault.id,
        vault.owner,
        coverage_btc,
        premium,
        trigger_icr,
        144, // 1 day grace period
        current_block,
        duration_blocks,
    );

    Ok((charm, premium))
}

/// Trigger insurance if conditions are met
pub fn trigger_insurance(
    charm: &mut InsuranceCharm,
    vault: &mut Vault,
    btc_price: u64,
    current_block: u64,
) -> ZkUsdResult<InsuranceTriggerResult> {
    let current_icr = calculate_icr(vault.collateral, vault.debt, btc_price)?;

    if !charm.should_trigger(current_icr, current_block) {
        return Err(ZkUsdError::InvalidInput {
            param: "charm",
            reason: "Insurance conditions not met",
        });
    }

    // Trigger the charm
    if !charm.trigger(current_block) {
        return Err(ZkUsdError::InvalidInput {
            param: "charm",
            reason: "Charm already triggered or expired",
        });
    }

    // Add coverage to vault collateral
    vault.collateral = vault.collateral.saturating_add(charm.coverage_btc);
    vault.insurance_balance = vault.insurance_balance.saturating_sub(charm.premium_paid);

    let new_icr = calculate_icr(vault.collateral, vault.debt, btc_price)?;

    Ok(InsuranceTriggerResult {
        charm_id: charm.charm_id,
        vault_id: vault.id,
        coverage_applied: charm.coverage_btc,
        icr_before: current_icr,
        icr_after: new_icr,
        grace_expires_at: charm.triggered_at + charm.grace_blocks,
    })
}

/// Result of insurance trigger
#[derive(Debug, Clone)]
pub struct InsuranceTriggerResult {
    pub charm_id: [u8; 32],
    pub vault_id: VaultId,
    pub coverage_applied: u64,
    pub icr_before: u64,
    pub icr_after: u64,
    pub grace_expires_at: u64,
}

// ============ Fee Prediction ============

/// Predict fees for an operation
pub fn predict_fees(operation: &OperationType, params: &FeeParams) -> FeeEstimate {
    match operation {
        OperationType::OpenVault => FeeEstimate::for_open_vault(params.debt_amount, params.base_rate),
        OperationType::Liquidation => FeeEstimate::for_liquidation(params.num_vaults),
        OperationType::BatchOperation => FeeEstimate::for_batch(params.batch_size),
        OperationType::Redemption => {
            let mut estimate = FeeEstimate::new(1, 2, 0);
            estimate.protocol_fee = params.redemption_amount * 75 / 10_000; // 0.75% fixed
            estimate.total_cost = estimate.base_fee + estimate.protocol_fee;
            estimate
        }
        OperationType::Insurance => {
            let premium = InsuranceCharm::calculate_premium(
                params.coverage_btc,
                params.duration_blocks,
                params.trigger_icr,
            );
            let mut estimate = FeeEstimate::new(1, 2, premium);
            estimate.total_cost = estimate.base_fee + premium;
            estimate
        }
    }
}

/// Types of operations for fee prediction
#[derive(Debug, Clone)]
pub enum OperationType {
    OpenVault,
    Liquidation,
    BatchOperation,
    Redemption,
    Insurance,
}

/// Parameters for fee prediction
#[derive(Debug, Clone, Default)]
pub struct FeeParams {
    pub debt_amount: u64,
    pub base_rate: u64,
    pub num_vaults: u32,
    pub batch_size: u32,
    pub redemption_amount: u64,
    pub coverage_btc: u64,
    pub duration_blocks: u64,
    pub trigger_icr: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_BTC: u64 = 100_000_000;
    const ONE_ZKUSD: u64 = 100_000_000;
    const BTC_PRICE: u64 = 100_000_00000000; // $100,000

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

    #[test]
    fn test_soft_liquidation_bands() {
        let vault = create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD);
        let soft_vault = SoftLiquidationVault::from_vault(vault, BTC_PRICE);

        assert_eq!(soft_vault.bands.len(), 4);
        assert!(!soft_vault.is_in_soft_liquidation);
        assert_eq!(soft_vault.total_btc_in_bands, ONE_BTC);
    }

    #[test]
    fn test_vault_sharding() {
        let vault = create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD);
        let sharded = shard_vault(vault, 4).unwrap();

        assert_eq!(sharded.shards.len(), 4);
        assert_eq!(sharded.total_collateral, ONE_BTC);
        assert_eq!(sharded.total_debt, 50_000 * ONE_ZKUSD);

        // Each shard should have roughly equal collateral
        for shard in &sharded.shards {
            assert!(shard.collateral >= ONE_BTC / 4 - 1);
            assert!(shard.collateral <= ONE_BTC / 4 + 1);
        }
    }

    #[test]
    fn test_redemption_by_interest_rate() {
        let vaults = vec![
            create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD), // 200% ICR
            {
                let mut v = create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD);
                v.id = [2u8; 32];
                v.interest_rate_bps = 50; // Lower rate - will be redeemed first
                v
            },
            {
                let mut v = create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD);
                v.id = [3u8; 32];
                v.interest_rate_bps = 200; // Higher rate - last to be redeemed
                v
            },
        ];

        let batch = build_redemption_batch(&vaults, [10u8; 32], 10_000 * ONE_ZKUSD, BTC_PRICE).unwrap();

        // Should be ordered by interest rate
        assert_eq!(batch.orders[0].interest_rate_bps, 50);
        assert_eq!(batch.orders[1].interest_rate_bps, 100);
        assert_eq!(batch.orders[2].interest_rate_bps, 200);
    }

    #[test]
    fn test_staking_rewards() {
        let mut pool = StakingPool::new();
        let staker = [1u8; 32];

        // Stake
        let stake = stake_zkusd(&mut pool, staker, 1000 * ONE_ZKUSD, 100).unwrap();
        assert_eq!(pool.total_staked, 1000 * ONE_ZKUSD);

        // Add fees
        pool.add_fees(100 * ONE_ZKUSD);
        pool.distribute_fees();

        // Check rewards
        let rewards = stake.pending_rewards(pool.reward_index);
        assert!(rewards > 0);
    }

    #[test]
    fn test_insurance_premium_calculation() {
        // 1 BTC coverage, 1 year, 110% trigger
        let premium_110 = InsuranceCharm::calculate_premium(ONE_BTC, 52_560, 110);

        // 1 BTC coverage, 1 year, 105% trigger (more expensive)
        let premium_105 = InsuranceCharm::calculate_premium(ONE_BTC, 52_560, 105);

        assert!(premium_105 > premium_110);
    }

    #[test]
    fn test_fee_prediction() {
        let params = FeeParams {
            debt_amount: 10_000 * ONE_ZKUSD,
            base_rate: 50,
            ..Default::default()
        };

        let estimate = predict_fees(&OperationType::OpenVault, &params);
        assert!(estimate.base_fee > 0);
        assert!(estimate.protocol_fee > 0);
    }

    #[test]
    fn test_batch_operations() {
        let deposits = vec![
            BatchDeposit { depositor: [1u8; 32], amount: 1000 * ONE_ZKUSD },
            BatchDeposit { depositor: [2u8; 32], amount: 2000 * ONE_ZKUSD },
            BatchDeposit { depositor: [3u8; 32], amount: 50 * ONE_ZKUSD }, // Below minimum
        ];

        let mut pool = StabilityPoolState::new();
        let result = process_batch_deposits(&deposits, &mut pool).unwrap();

        assert_eq!(result.successes, 2);
        assert_eq!(result.failures, 1);
        assert!(result.gas_saved > 0);
    }
}
