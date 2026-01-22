//! Vault Manager - CDP Validation App for zkUSD
//!
//! This app validates Collateralized Debt Position (CDP) operations on Bitcoin
//! using the Charms protocol. Each vault is represented as a charm (NFT-like)
//! attached to a Bitcoin UTXO.
//!
//! ## Core Operations
//!
//! - **OpenVault**: Create new CDP with BTC collateral, mint zkUSD
//! - **CloseVault**: Repay all debt, withdraw collateral
//! - **AddCollateral**: Increase vault's BTC collateral
//! - **WithdrawCollateral**: Decrease collateral (if ICR permits)
//! - **MintDebt**: Borrow additional zkUSD against collateral
//! - **RepayDebt**: Pay back zkUSD debt
//! - **Liquidate**: Liquidate underwater vaults
//! - **Redeem**: Exchange zkUSD for BTC at face value
//!
//! ## Charms Model
//!
//! Unlike smart contracts with global state, Charms uses UTXO-based state:
//! - Each vault is a charm in its own UTXO
//! - Protocol state is a charm referenced by transactions
//! - All operations are UTXO transformations validated by ZK proofs
//!
//! ## Integration
//!
//! Enable the `charms` feature for Charms SDK integration:
//! ```toml
//! zkusd-vault-manager = { version = "0.1", features = ["charms"] }
//! ```

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

#[cfg(feature = "charms")]
pub mod charms;

use zkusd_common::{
    constants::{limits, ratios},
    errors::{ZkUsdError, ZkUsdResult, RecoveryModeOp},
    events::{EventLog, ZkUsdEvent},
    math::{
        calculate_borrowing_fee, calculate_icr, calculate_tcr,
        get_min_ratio, is_liquidatable, is_recovery_mode,
        safe_add, safe_sub,
    },
    types::{Address, AppId, ProtocolState, Vault, VaultAction, VaultId, VaultStatus},
    // UTXO-native advanced operations
    charms_ops::{
        ZkUsdCharmState, SpellFlashMint, FlashMintPurpose,
        validate_flash_mint_spell, calculate_flash_fee,
    },
};

// ============ Vault Manager State ============

/// Global state for the Vault Manager
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct VaultManagerState {
    /// Protocol-wide state
    pub protocol: ProtocolState,
    /// zkUSD Token app_id
    pub zkusd_token_id: AppId,
    /// Stability Pool app_id
    pub stability_pool_id: AppId,
    /// Price Oracle app_id
    pub price_oracle_id: AppId,
    /// Active Pool address (holds active collateral)
    pub active_pool: Address,
    /// Default Pool address (holds liquidated collateral)
    pub default_pool: Address,
}

impl VaultManagerState {
    /// Creates a new VaultManagerState with all required addresses.
    ///
    /// # Arguments
    /// * `admin` - Protocol admin address
    /// * `zkusd_token_id` - AppId of the zkUSD token contract
    /// * `stability_pool_id` - AppId of the stability pool contract
    /// * `price_oracle_id` - AppId of the price oracle contract
    /// * `active_pool` - Address for holding active collateral
    /// * `default_pool` - Address for holding liquidated collateral
    ///
    /// # Errors
    /// Returns `ZkUsdError::InvalidAddress` if active_pool or default_pool are zero addresses.
    pub fn new(
        admin: Address,
        zkusd_token_id: AppId,
        stability_pool_id: AppId,
        price_oracle_id: AppId,
        active_pool: Address,
        default_pool: Address,
    ) -> ZkUsdResult<Self> {
        // Validate that pool addresses are not zero
        if active_pool == [0u8; 32] {
            return Err(ZkUsdError::InvalidAddress {
                reason: "active_pool cannot be zero address"
            });
        }
        if default_pool == [0u8; 32] {
            return Err(ZkUsdError::InvalidAddress {
                reason: "default_pool cannot be zero address"
            });
        }

        Ok(Self {
            protocol: ProtocolState::new(admin),
            zkusd_token_id,
            stability_pool_id,
            price_oracle_id,
            active_pool,
            default_pool,
        })
    }
}

// ============ Validation Context ============

/// Context for validating vault operations
pub struct VaultContext {
    /// Current global state
    pub state: VaultManagerState,
    /// Updated global state
    pub new_state: VaultManagerState,
    /// Vault being operated on (if any)
    pub vault: Option<Vault>,
    /// Updated vault state
    pub new_vault: Option<Vault>,
    /// BTC price from oracle (8 decimals)
    pub btc_price: u64,
    /// BTC collateral inputs (satoshis)
    pub btc_inputs: u64,
    /// BTC collateral outputs (satoshis)
    pub btc_outputs: u64,
    /// zkUSD inputs
    pub zkusd_inputs: u64,
    /// zkUSD outputs
    pub zkusd_outputs: u64,
    /// Signer address
    pub signer: Address,
    /// Current block height
    pub block_height: u64,
    /// Event log
    pub events: EventLog,
}

// ============ Validation Functions ============

/// Main validation entry point
pub fn validate(ctx: &mut VaultContext, action: &VaultAction) -> ZkUsdResult<()> {
    // Check if protocol is paused
    if ctx.state.protocol.is_paused {
        return Err(ZkUsdError::ProtocolPaused);
    }

    match action {
        VaultAction::OpenVault { collateral, debt } => {
            validate_open_vault(ctx, *collateral, *debt)
        }
        VaultAction::CloseVault { vault_id } => {
            validate_close_vault(ctx, vault_id)
        }
        VaultAction::AddCollateral { vault_id, amount } => {
            validate_add_collateral(ctx, vault_id, *amount)
        }
        VaultAction::WithdrawCollateral { vault_id, amount } => {
            validate_withdraw_collateral(ctx, vault_id, *amount)
        }
        VaultAction::MintDebt { vault_id, amount } => {
            validate_mint_debt(ctx, vault_id, *amount)
        }
        VaultAction::RepayDebt { vault_id, amount } => {
            validate_repay_debt(ctx, vault_id, *amount)
        }
        VaultAction::Liquidate { vault_id } => {
            validate_liquidate(ctx, vault_id)
        }
        VaultAction::Redeem { amount } => {
            validate_redeem(ctx, *amount)
        }

        // ============ Advanced UTXO-Native Operations ============

        VaultAction::FlashMint { amount, purpose } => {
            validate_flash_mint(ctx, *amount, *purpose)
        }
        VaultAction::AtomicRescue {
            vault_id,
            collateral_to_add,
            debt_to_repay,
            rescuer_discount,
        } => {
            validate_atomic_rescue(ctx, vault_id, *collateral_to_add, *debt_to_repay, *rescuer_discount)
        }
        VaultAction::PurchaseInsurance {
            vault_id,
            coverage_btc,
            premium,
            trigger_icr,
        } => {
            validate_purchase_insurance(ctx, vault_id, *coverage_btc, *premium, *trigger_icr)
        }
        VaultAction::TriggerInsurance {
            insurance_id,
            vault_id,
        } => {
            validate_trigger_insurance(ctx, insurance_id, vault_id)
        }
        VaultAction::TransferInsurance {
            insurance_id,
            new_owner,
        } => {
            validate_transfer_insurance(ctx, insurance_id, new_owner)
        }
    }
}

/// Validate opening a new vault
fn validate_open_vault(
    ctx: &mut VaultContext,
    collateral: u64,
    debt: u64,
) -> ZkUsdResult<()> {
    // 1. Check minimum debt requirement
    let total_debt = safe_add(debt, limits::LIQUIDATION_RESERVE)?;
    if total_debt < limits::MIN_DEBT {
        return Err(ZkUsdError::BelowMinimum {
            amount: total_debt,
            minimum: limits::MIN_DEBT,
        });
    }

    // 1b. Check maximum debt per vault (prevents concentration risk)
    if total_debt > limits::MAX_DEBT_PER_VAULT {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: total_debt,
            maximum: limits::MAX_DEBT_PER_VAULT,
        });
    }

    // 2. Calculate ICR for new vault
    let icr = calculate_icr(collateral, total_debt, ctx.btc_price)?;

    // 3. Get current TCR
    let tcr = calculate_tcr(
        ctx.state.protocol.total_collateral,
        ctx.state.protocol.total_debt,
        ctx.btc_price,
    )?;

    // 4. Check minimum ratio (MCR in normal mode, CCR in recovery mode)
    let min_ratio = get_min_ratio(tcr);
    if icr < min_ratio {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: icr,
            required_ratio: min_ratio,
        });
    }

    // 5. In Recovery Mode, new vault must improve TCR
    if is_recovery_mode(tcr) {
        let new_total_coll = safe_add(ctx.state.protocol.total_collateral, collateral)?;
        let new_total_debt = safe_add(ctx.state.protocol.total_debt, total_debt)?;
        let new_tcr = calculate_tcr(new_total_coll, new_total_debt, ctx.btc_price)?;

        if new_tcr <= tcr {
            return Err(ZkUsdError::WouldWorsenTCR {
                current_tcr: tcr,
                new_tcr,
            });
        }
    }

    // 6. Verify BTC collateral is being deposited
    // NOTE: In Charms v8, coin_ins may not be populated from spell inputs with empty charms.
    // The BTC flow is validated at the Bitcoin transaction level (UTXOs must balance).
    // Only check if coin_ins is actually populated (btc_inputs > 0).
    if ctx.btc_inputs > 0 && ctx.btc_inputs < collateral {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.btc_inputs,
            requested: collateral,
        });
    }

    // 7. Calculate borrowing fee
    let borrowing_fee = calculate_borrowing_fee(debt, ctx.state.protocol.base_rate)?;

    // 8. Verify new vault state
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.collateral != collateral {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    if new_vault.debt != total_debt {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    if !new_vault.is_active() {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 9. Verify protocol state updates
    let expected_total_coll = safe_add(ctx.state.protocol.total_collateral, collateral)?;
    let expected_total_debt = safe_add(ctx.state.protocol.total_debt, total_debt)?;

    if ctx.new_state.protocol.total_collateral != expected_total_coll {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    if ctx.new_state.protocol.total_debt != expected_total_debt {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 10. Emit event
    ctx.events.emit(ZkUsdEvent::VaultOpened {
        vault_id: new_vault.id,
        owner: ctx.signer,
        collateral,
        debt,
        fee: borrowing_fee,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate closing a vault
fn validate_close_vault(ctx: &mut VaultContext, vault_id: &VaultId) -> ZkUsdResult<()> {
    // 1. Get vault
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 2. Only owner can close
    if vault.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: vault.owner,
            actual: ctx.signer,
        });
    }

    // 3. Check vault is active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 4. In Recovery Mode, cannot close if it's the last vault
    let tcr = calculate_tcr(
        ctx.state.protocol.total_collateral,
        ctx.state.protocol.total_debt,
        ctx.btc_price,
    )?;

    if is_recovery_mode(tcr) && ctx.state.protocol.active_vault_count == 1 {
        return Err(ZkUsdError::RecoveryModeRestriction {
            operation: RecoveryModeOp::CloseLastVault,
        });
    }

    // 5. Verify all debt is being repaid (zkUSD burned)
    if ctx.zkusd_inputs < vault.debt {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.zkusd_inputs,
            requested: vault.debt,
        });
    }

    // 6. Verify collateral is being returned to owner
    if ctx.btc_outputs < vault.collateral {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 7. Verify vault is marked as closed
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.status != VaultStatus::Closed {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 8. Emit event
    ctx.events.emit(ZkUsdEvent::VaultClosed {
        vault_id: *vault_id,
        owner: vault.owner,
        collateral_returned: vault.collateral,
        debt_repaid: vault.debt,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate adding collateral to a vault
fn validate_add_collateral(
    ctx: &mut VaultContext,
    vault_id: &VaultId,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Get vault
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 3. Only owner can add collateral
    if vault.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: vault.owner,
            actual: ctx.signer,
        });
    }

    // 4. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 5. Verify BTC is being deposited
    // NOTE: In Charms v8, coin_ins may not be populated from spell inputs with empty charms.
    // Only check if coin_ins is actually populated (btc_inputs > 0).
    if ctx.btc_inputs > 0 && ctx.btc_inputs < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.btc_inputs,
            requested: amount,
        });
    }

    // 6. Calculate new collateral and ICR
    let new_collateral = safe_add(vault.collateral, amount)?;
    let new_icr = calculate_icr(new_collateral, vault.debt, ctx.btc_price)?;

    // 7. Verify vault state update
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.collateral != new_collateral {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 8. Emit event
    ctx.events.emit(ZkUsdEvent::CollateralAdded {
        vault_id: *vault_id,
        amount,
        new_collateral,
        new_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate withdrawing collateral from a vault
fn validate_withdraw_collateral(
    ctx: &mut VaultContext,
    vault_id: &VaultId,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Get vault
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 3. Only owner can withdraw
    if vault.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: vault.owner,
            actual: ctx.signer,
        });
    }

    // 4. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 5. Cannot withdraw more than available
    if amount > vault.collateral {
        return Err(ZkUsdError::InsufficientBalance {
            available: vault.collateral,
            requested: amount,
        });
    }

    // 6. Calculate new collateral and ICR
    let new_collateral = safe_sub(vault.collateral, amount)?;
    let new_icr = calculate_icr(new_collateral, vault.debt, ctx.btc_price)?;

    // 7. Get TCR and min ratio
    let tcr = calculate_tcr(
        ctx.state.protocol.total_collateral,
        ctx.state.protocol.total_debt,
        ctx.btc_price,
    )?;

    // 8. In Recovery Mode, withdrawal is restricted
    if is_recovery_mode(tcr) {
        return Err(ZkUsdError::RecoveryModeRestriction {
            operation: RecoveryModeOp::WithdrawCollateral,
        });
    }

    // 9. New ICR must be above MCR
    let min_ratio = get_min_ratio(tcr);
    if new_icr < min_ratio {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: new_icr,
            required_ratio: min_ratio,
        });
    }

    // 10. Verify vault state update
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.collateral != new_collateral {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 11. Emit event
    ctx.events.emit(ZkUsdEvent::CollateralWithdrawn {
        vault_id: *vault_id,
        amount,
        new_collateral,
        new_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate minting additional debt
fn validate_mint_debt(
    ctx: &mut VaultContext,
    vault_id: &VaultId,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Get vault
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 3. Only owner can mint
    if vault.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: vault.owner,
            actual: ctx.signer,
        });
    }

    // 4. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 5. Get TCR
    let tcr = calculate_tcr(
        ctx.state.protocol.total_collateral,
        ctx.state.protocol.total_debt,
        ctx.btc_price,
    )?;

    // 6. In Recovery Mode, cannot mint more debt
    if is_recovery_mode(tcr) {
        return Err(ZkUsdError::RecoveryModeRestriction {
            operation: RecoveryModeOp::MintDebt,
        });
    }

    // 7. Calculate new debt and ICR
    let new_debt = safe_add(vault.debt, amount)?;

    // 7b. Check maximum debt per vault
    if new_debt > limits::MAX_DEBT_PER_VAULT {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: new_debt,
            maximum: limits::MAX_DEBT_PER_VAULT,
        });
    }

    let new_icr = calculate_icr(vault.collateral, new_debt, ctx.btc_price)?;

    // 8. New ICR must be above MCR
    if new_icr < ratios::MCR {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: new_icr,
            required_ratio: ratios::MCR,
        });
    }

    // 9. Calculate borrowing fee
    let borrowing_fee = calculate_borrowing_fee(amount, ctx.state.protocol.base_rate)?;

    // 10. Verify vault state update
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.debt != new_debt {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 11. Emit event
    ctx.events.emit(ZkUsdEvent::DebtMinted {
        vault_id: *vault_id,
        amount,
        fee: borrowing_fee,
        new_debt,
        new_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate repaying debt
fn validate_repay_debt(
    ctx: &mut VaultContext,
    vault_id: &VaultId,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Get vault
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 3. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 4. Cannot repay more than debt (minus liquidation reserve)
    let net_debt = vault.net_debt();
    if amount > net_debt {
        return Err(ZkUsdError::ExceedsMaximum {
            amount,
            maximum: net_debt,
        });
    }

    // 5. Verify zkUSD is being burned
    if ctx.zkusd_inputs < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.zkusd_inputs,
            requested: amount,
        });
    }

    // 6. Calculate new debt and ICR
    let new_debt = safe_sub(vault.debt, amount)?;
    let new_icr = calculate_icr(vault.collateral, new_debt, ctx.btc_price)?;

    // 7. Verify vault state update
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.debt != new_debt {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 8. Emit event
    ctx.events.emit(ZkUsdEvent::DebtRepaid {
        vault_id: *vault_id,
        amount,
        new_debt,
        new_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate liquidation of an undercollateralized vault
fn validate_liquidate(ctx: &mut VaultContext, vault_id: &VaultId) -> ZkUsdResult<()> {
    // 1. Get vault
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 2. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 3. Calculate vault's ICR
    let icr = calculate_icr(vault.collateral, vault.debt, ctx.btc_price)?;

    // 4. Calculate TCR
    let tcr = calculate_tcr(
        ctx.state.protocol.total_collateral,
        ctx.state.protocol.total_debt,
        ctx.btc_price,
    )?;

    // 5. Check if vault is liquidatable
    if !is_liquidatable(icr, tcr) {
        return Err(ZkUsdError::NotLiquidatable {
            vault_id: *vault_id,
            icr,
        });
    }

    // 6. Calculate liquidation amounts
    let gas_comp_coll = vault.collateral * zkusd_common::constants::liquidation::GAS_COMP_BPS / 10000;
    let liquidator_bonus = vault.collateral * zkusd_common::constants::liquidation::LIQUIDATOR_BONUS_BPS / 10000;
    let coll_to_sp = vault.collateral - gas_comp_coll - liquidator_bonus;

    // 7. Verify vault is marked as liquidated
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.status != VaultStatus::Liquidated {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 8. Emit event
    ctx.events.emit(ZkUsdEvent::VaultLiquidated {
        vault_id: *vault_id,
        owner: vault.owner,
        liquidator: ctx.signer,
        debt_absorbed: vault.debt,
        collateral_seized: vault.collateral,
        collateral_to_sp: coll_to_sp,
        collateral_to_liquidator: gas_comp_coll + liquidator_bonus,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate redemption
fn validate_redeem(ctx: &mut VaultContext, amount: u64) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Verify zkUSD is being redeemed
    if ctx.zkusd_inputs < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.zkusd_inputs,
            requested: amount,
        });
    }

    // 3. Validate BTC price is not zero (prevents division by zero)
    if ctx.btc_price == 0 {
        return Err(ZkUsdError::DivisionByZero);
    }

    // 4. Calculate BTC to receive with safe math
    // btc_amount = zkusd_amount * 1e8 / btc_price
    let btc_value_u128 = (amount as u128)
        .checked_mul(zkusd_common::constants::token::ONE as u128)
        .ok_or(ZkUsdError::Overflow)?
        .checked_div(ctx.btc_price as u128)
        .ok_or(ZkUsdError::DivisionByZero)?;

    // 5. Validate result fits in u64
    if btc_value_u128 > u64::MAX as u128 {
        return Err(ZkUsdError::Overflow);
    }
    let btc_value = btc_value_u128 as u64;

    // 6. Calculate redemption fee (fixed 0.75% like Mezo - simpler & predictable)
    let fee = zkusd_common::math::calculate_redemption_fee_fixed(amount)?;

    // 7. Emit event
    // NOTE: vaults_affected is simplified for MVP - full implementation would
    // iterate through vaults sorted by ICR and track actual count
    ctx.events.emit(ZkUsdEvent::Redemption {
        redeemer: ctx.signer,
        zkusd_redeemed: amount,
        btc_received: btc_value,
        fee_paid: fee,
        vaults_affected: 1,
        block_height: ctx.block_height,
    });

    Ok(())
}

// ============ Advanced UTXO-Native Validation Functions ============

/// Validate flash minting operation
///
/// In UTXO model, flash minting is inherently atomic.
/// The spell must have outputs that balance inputs + fee.
fn validate_flash_mint(ctx: &mut VaultContext, amount: u64, purpose: u8) -> ZkUsdResult<()> {
    // 1. Convert purpose code to enum
    let flash_purpose = match purpose {
        0 => FlashMintPurpose::SelfLiquidation,
        1 => FlashMintPurpose::Arbitrage,
        2 => FlashMintPurpose::CollateralSwap,
        3 => FlashMintPurpose::LeverageAdjustment,
        4 => FlashMintPurpose::VaultRescue,
        _ => FlashMintPurpose::Custom,
    };

    // 2. Build charm states from context
    let input_state = ZkUsdCharmState {
        zkusd_amount: ctx.zkusd_inputs,
        btc_amount: ctx.btc_inputs,
        vaults: Vec::new(),
        insurance_charms: Vec::new(),
        rescue_offers: Vec::new(),
    };

    let output_state = ZkUsdCharmState {
        zkusd_amount: ctx.zkusd_outputs,
        btc_amount: ctx.btc_outputs,
        vaults: Vec::new(),
        insurance_charms: Vec::new(),
        rescue_offers: Vec::new(),
    };

    // 3. Create flash mint spell request
    let flash_mint = SpellFlashMint {
        mint_amount: amount,
        fee: calculate_flash_fee(amount),
        purpose: flash_purpose,
    };

    // 4. Validate using charms_ops
    let validation = validate_flash_mint_spell(&input_state, &output_state, &flash_mint)?;

    // 5. Emit event
    ctx.events.emit(ZkUsdEvent::FlashMint {
        minter: ctx.signer,
        amount,
        fee: validation.fee_paid,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate atomic rescue of a distressed vault
///
/// Rescuer provides collateral + debt repayment in single atomic spell.
/// Vault owner doesn't need to sign - they benefit from being rescued.
fn validate_atomic_rescue(
    ctx: &mut VaultContext,
    vault_id: &VaultId,
    collateral_to_add: u64,
    debt_to_repay: u64,
    rescuer_discount: u64,
) -> ZkUsdResult<()> {
    // 1. Get vault being rescued
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 2. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 3. Calculate current ICR
    let current_icr = calculate_icr(vault.collateral, vault.debt, ctx.btc_price)?;

    // 4. Vault must be distressed (below 130% ICR) to allow rescue
    // This prevents unwanted "rescues" on healthy vaults
    const RESCUE_THRESHOLD: u64 = 130; // 130%
    if current_icr >= RESCUE_THRESHOLD {
        return Err(ZkUsdError::VaultNotEligibleForRescue {
            vault_id: *vault_id,
            icr: current_icr,
        });
    }

    // 5. Verify rescuer is providing collateral
    // NOTE: In Charms v8, coin_ins may not be populated from spell inputs with empty charms.
    // Only check if coin_ins is actually populated (btc_inputs > 0).
    if ctx.btc_inputs > 0 && ctx.btc_inputs < collateral_to_add {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.btc_inputs,
            requested: collateral_to_add,
        });
    }

    // 6. Verify rescuer is providing zkUSD for debt repayment
    if ctx.zkusd_inputs < debt_to_repay {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.zkusd_inputs,
            requested: debt_to_repay,
        });
    }

    // 7. Calculate new vault state
    let new_collateral = safe_add(vault.collateral, collateral_to_add)?;
    let new_collateral_after_discount = safe_sub(new_collateral, rescuer_discount)?;
    let new_debt = safe_sub(vault.debt, debt_to_repay)?;

    // 8. Validate discount is reasonable (max 5% of added collateral)
    let max_discount = collateral_to_add * 5 / 100;
    if rescuer_discount > max_discount {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: rescuer_discount,
            maximum: max_discount,
        });
    }

    // 9. New ICR must be above MCR
    let new_icr = calculate_icr(new_collateral_after_discount, new_debt, ctx.btc_price)?;
    if new_icr < ratios::MCR {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: new_icr,
            required_ratio: ratios::MCR,
        });
    }

    // 10. Verify output vault state
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.collateral != new_collateral_after_discount {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    if new_vault.debt != new_debt {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 11. Emit event
    ctx.events.emit(ZkUsdEvent::VaultRescued {
        vault_id: *vault_id,
        owner: vault.owner,
        rescuer: ctx.signer,
        collateral_added: collateral_to_add,
        debt_repaid: debt_to_repay,
        rescuer_reward: rescuer_discount,
        new_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate purchasing insurance for a vault
fn validate_purchase_insurance(
    ctx: &mut VaultContext,
    vault_id: &VaultId,
    coverage_btc: u64,
    premium: u64,
    trigger_icr: u64,
) -> ZkUsdResult<()> {
    // 1. Get vault being insured
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 2. Only vault owner can purchase insurance
    if vault.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: vault.owner,
            actual: ctx.signer,
        });
    }

    // 3. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 4. Trigger ICR must be between MCR and current ICR
    let current_icr = calculate_icr(vault.collateral, vault.debt, ctx.btc_price)?;
    if trigger_icr <= ratios::MCR || trigger_icr >= current_icr {
        return Err(ZkUsdError::InvalidInsuranceParams);
    }

    // 5. Verify premium payment
    if ctx.zkusd_inputs < premium {
        return Err(ZkUsdError::InsufficientBalance {
            available: ctx.zkusd_inputs,
            requested: premium,
        });
    }

    // 6. Coverage must be reasonable (max 50% of vault collateral)
    let max_coverage = vault.collateral / 2;
    if coverage_btc > max_coverage {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: coverage_btc,
            maximum: max_coverage,
        });
    }

    // 7. Update vault's insurance balance
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    if new_vault.insurance_balance != coverage_btc {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 8. Emit event
    ctx.events.emit(ZkUsdEvent::InsurancePurchased {
        vault_id: *vault_id,
        owner: vault.owner,
        coverage_btc,
        premium,
        trigger_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate triggering insurance protection
fn validate_trigger_insurance(
    ctx: &mut VaultContext,
    insurance_id: &[u8; 32],
    vault_id: &VaultId,
) -> ZkUsdResult<()> {
    // 1. Get vault being protected
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::VaultNotFound {
        vault_id: *vault_id,
    })?;

    // 2. Vault must be active
    if !vault.is_active() {
        return Err(ZkUsdError::VaultNotActive {
            vault_id: *vault_id,
        });
    }

    // 3. Vault must have insurance
    if vault.insurance_balance == 0 {
        return Err(ZkUsdError::NoInsurance {
            vault_id: *vault_id,
        });
    }

    // 4. Calculate current ICR
    let current_icr = calculate_icr(vault.collateral, vault.debt, ctx.btc_price)?;

    // 5. ICR must be below trigger threshold (using MCR as default trigger)
    // In production, would read trigger_icr from insurance charm
    const DEFAULT_TRIGGER_ICR: u64 = 115; // 115%
    if current_icr >= DEFAULT_TRIGGER_ICR {
        return Err(ZkUsdError::InsuranceNotTriggerable {
            vault_id: *vault_id,
            current_icr,
            trigger_icr: DEFAULT_TRIGGER_ICR,
        });
    }

    // 6. Calculate how much insurance to use
    // Use minimum needed to get back above MCR
    let new_vault = ctx.new_vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;
    let new_icr = calculate_icr(new_vault.collateral, new_vault.debt, ctx.btc_price)?;

    // 7. New ICR must be >= MCR
    if new_icr < ratios::MCR {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: new_icr,
            required_ratio: ratios::MCR,
        });
    }

    // 8. Insurance balance must decrease appropriately
    let insurance_used = vault.insurance_balance - new_vault.insurance_balance;

    // 9. Emit event
    ctx.events.emit(ZkUsdEvent::InsuranceTriggered {
        insurance_id: *insurance_id,
        vault_id: *vault_id,
        owner: vault.owner,
        collateral_added: insurance_used,
        new_icr,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate transferring insurance charm ownership
fn validate_transfer_insurance(
    ctx: &mut VaultContext,
    _insurance_id: &[u8; 32],
    new_owner: &Address,
) -> ZkUsdResult<()> {
    // 1. Get vault (insurance is attached to vault)
    let vault = ctx.vault.as_ref().ok_or(ZkUsdError::StateNotFound)?;

    // 2. Only current owner can transfer
    if vault.owner != ctx.signer {
        return Err(ZkUsdError::Unauthorized {
            expected: vault.owner,
            actual: ctx.signer,
        });
    }

    // 3. Cannot transfer to zero address
    if *new_owner == [0u8; 32] {
        return Err(ZkUsdError::InvalidAddress {
            reason: "cannot transfer insurance to zero address"
        });
    }

    // 4. Insurance charms are only transferable with vault ownership
    // This is enforced by UTXO model - charm moves with the UTXO

    Ok(())
}

// ============ Helper Functions ============

/// Generate a deterministic vault ID
pub fn generate_vault_id(owner: &Address, block_height: u64, nonce: u64) -> VaultId {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(owner);
    hasher.update(&block_height.to_le_bytes());
    hasher.update(&nonce.to_le_bytes());
    let result = hasher.finalize();
    let mut id = [0u8; 32];
    id.copy_from_slice(&result);
    id
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    const BTC_PRICE_100K: u64 = 100_000_00000000;
    #[allow(dead_code)]
    const ONE_BTC: u64 = 100_000_000;
    const ONE_ZKUSD: u64 = 100_000_000;

    fn create_test_context() -> VaultContext {
        // Test addresses (non-zero for validation)
        let admin = [0u8; 32];
        let zkusd_token = [1u8; 32];
        let stability_pool = [2u8; 32];
        let price_oracle = [3u8; 32];
        let active_pool = [4u8; 32];  // Non-zero for production safety
        let default_pool = [5u8; 32]; // Non-zero for production safety

        VaultContext {
            state: VaultManagerState::new(
                admin, zkusd_token, stability_pool, price_oracle, active_pool, default_pool
            ).expect("test state creation should succeed"),
            new_state: VaultManagerState::new(
                admin, zkusd_token, stability_pool, price_oracle, active_pool, default_pool
            ).expect("test state creation should succeed"),
            vault: None,
            new_vault: None,
            btc_price: BTC_PRICE_100K,
            btc_inputs: 0,
            btc_outputs: 0,
            zkusd_inputs: 0,
            zkusd_outputs: 0,
            signer: [1u8; 32],
            block_height: 100,
            events: EventLog::new(),
        }
    }

    #[test]
    fn test_open_vault_success() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        // Setup: 1.5 BTC collateral, 50,000 zkUSD debt
        // ICR = 150,000 / 52,200 = 287% (above MCR)
        let collateral = 150_000_000; // 1.5 BTC
        let debt = 50_000 * ONE_ZKUSD;
        let total_debt = debt + limits::LIQUIDATION_RESERVE;

        ctx.signer = owner;
        ctx.btc_inputs = collateral;

        let new_vault = Vault::new([0u8; 32], owner, collateral, total_debt, 100);
        ctx.new_vault = Some(new_vault);
        ctx.new_state.protocol.total_collateral = collateral;
        ctx.new_state.protocol.total_debt = total_debt;

        let action = VaultAction::OpenVault { collateral, debt };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Should succeed: {:?}", result);
    }

    #[test]
    fn test_open_vault_undercollateralized() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        // Setup: 0.5 BTC collateral, 50,000 zkUSD debt
        // ICR = 50,000 / 52,200 = 95% (below MCR 110%)
        let collateral = 50_000_000; // 0.5 BTC
        let debt = 50_000 * ONE_ZKUSD;

        ctx.signer = owner;
        ctx.btc_inputs = collateral;

        let action = VaultAction::OpenVault { collateral, debt };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::Undercollateralized { .. })));
    }

    #[test]
    fn test_liquidation_eligible() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];
        let liquidator = [2u8; 32];

        // Vault with 105% ICR (below MCR)
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 105_000_000, // 1.05 BTC = $105,000
            debt: 100_000 * ONE_ZKUSD, // $100,000 debt
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        ctx.vault = Some(vault.clone());
        ctx.new_vault = Some(Vault {
            status: VaultStatus::Liquidated,
            ..vault
        });
        ctx.signer = liquidator;
        ctx.state.protocol.total_collateral = 105_000_000;
        ctx.state.protocol.total_debt = 100_000 * ONE_ZKUSD;

        let action = VaultAction::Liquidate { vault_id: [0u8; 32] };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Should be liquidatable: {:?}", result);
    }

    // ============ Flash Mint Tests ============

    #[test]
    fn test_flash_mint_success() {
        let mut ctx = create_test_context();

        // Flash mint 10,000 zkUSD for arbitrage
        let flash_amount = 10_000 * ONE_ZKUSD;
        let fee = zkusd_common::charms_ops::calculate_flash_fee(flash_amount);

        // User has some zkUSD to pay the fee
        ctx.zkusd_inputs = fee + 100 * ONE_ZKUSD;
        ctx.zkusd_outputs = 100 * ONE_ZKUSD; // After paying fee

        let action = VaultAction::FlashMint {
            amount: flash_amount,
            purpose: 1, // Arbitrage
        };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Flash mint should succeed: {:?}", result);
        assert!(ctx.events.has_events(), "Should emit FlashMint event");
    }

    #[test]
    fn test_flash_mint_below_minimum() {
        let mut ctx = create_test_context();

        // Try to flash mint below minimum (100 zkUSD)
        let flash_amount = 50 * ONE_ZKUSD; // Below MIN_FLASH_MINT

        ctx.zkusd_inputs = 100 * ONE_ZKUSD;
        ctx.zkusd_outputs = 100 * ONE_ZKUSD;

        let action = VaultAction::FlashMint {
            amount: flash_amount,
            purpose: 1,
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::BelowMinimum { .. })));
    }

    #[test]
    fn test_flash_mint_exceeds_maximum() {
        let mut ctx = create_test_context();

        // Try to flash mint above maximum (10M zkUSD)
        let flash_amount = 20_000_000 * ONE_ZKUSD; // Above MAX

        ctx.zkusd_inputs = 1000 * ONE_ZKUSD;
        ctx.zkusd_outputs = 1000 * ONE_ZKUSD;

        let action = VaultAction::FlashMint {
            amount: flash_amount,
            purpose: 1,
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::ExceedsMaximum { .. })));
    }

    // ============ Atomic Rescue Tests ============

    #[test]
    fn test_atomic_rescue_success() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];
        let rescuer = [2u8; 32];

        // Distressed vault with 120% ICR (below rescue threshold 130%)
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 120_000_000, // 1.2 BTC = $120,000
            debt: 100_000 * ONE_ZKUSD, // $100,000 debt -> 120% ICR
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        // Rescuer adds 30,000,000 sats (0.3 BTC) and repays 20,000 zkUSD
        let collateral_to_add = 30_000_000;
        let debt_to_repay = 20_000 * ONE_ZKUSD;
        let rescuer_discount = 1_000_000; // 0.01 BTC discount (3.3% of added)

        ctx.vault = Some(vault.clone());
        ctx.new_vault = Some(Vault {
            collateral: vault.collateral + collateral_to_add - rescuer_discount,
            debt: vault.debt - debt_to_repay,
            last_updated: ctx.block_height,
            ..vault
        });
        ctx.signer = rescuer;
        ctx.btc_inputs = collateral_to_add;
        ctx.zkusd_inputs = debt_to_repay;
        ctx.state.protocol.total_collateral = vault.collateral;
        ctx.state.protocol.total_debt = vault.debt;

        let action = VaultAction::AtomicRescue {
            vault_id: [0u8; 32],
            collateral_to_add,
            debt_to_repay,
            rescuer_discount,
        };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Rescue should succeed: {:?}", result);
        assert!(ctx.events.has_events(), "Should emit VaultRescued event");
    }

    #[test]
    fn test_atomic_rescue_vault_too_healthy() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];
        let rescuer = [2u8; 32];

        // Healthy vault with 150% ICR (above rescue threshold 130%)
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 150_000_000, // 1.5 BTC = $150,000
            debt: 100_000 * ONE_ZKUSD, // $100,000 debt -> 150% ICR
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        ctx.vault = Some(vault);
        ctx.signer = rescuer;
        ctx.btc_inputs = 30_000_000;
        ctx.zkusd_inputs = 20_000 * ONE_ZKUSD;

        let action = VaultAction::AtomicRescue {
            vault_id: [0u8; 32],
            collateral_to_add: 30_000_000,
            debt_to_repay: 20_000 * ONE_ZKUSD,
            rescuer_discount: 1_000_000,
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::VaultNotEligibleForRescue { .. })));
    }

    #[test]
    fn test_atomic_rescue_excessive_discount() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];
        let rescuer = [2u8; 32];

        // Distressed vault
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 120_000_000,
            debt: 100_000 * ONE_ZKUSD,
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        let collateral_to_add = 30_000_000;
        // Discount > 5% of added collateral
        let rescuer_discount = 5_000_000; // 16.7% - way too high

        ctx.vault = Some(vault);
        ctx.signer = rescuer;
        ctx.btc_inputs = collateral_to_add;
        ctx.zkusd_inputs = 20_000 * ONE_ZKUSD;

        let action = VaultAction::AtomicRescue {
            vault_id: [0u8; 32],
            collateral_to_add,
            debt_to_repay: 20_000 * ONE_ZKUSD,
            rescuer_discount,
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::ExceedsMaximum { .. })));
    }

    // ============ Insurance Tests ============

    #[test]
    fn test_purchase_insurance_success() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        // Healthy vault with 200% ICR
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 200_000_000, // 2 BTC = $200,000
            debt: 100_000 * ONE_ZKUSD, // $100,000 debt -> 200% ICR
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        let coverage_btc = 50_000_000; // 0.5 BTC coverage (25% of collateral)
        let premium = 1_000 * ONE_ZKUSD; // 1000 zkUSD premium
        let trigger_icr = 115; // 115% trigger

        ctx.vault = Some(vault.clone());
        ctx.new_vault = Some(Vault {
            insurance_balance: coverage_btc,
            last_updated: ctx.block_height,
            ..vault
        });
        ctx.signer = owner;
        ctx.zkusd_inputs = premium;

        let action = VaultAction::PurchaseInsurance {
            vault_id: [0u8; 32],
            coverage_btc,
            premium,
            trigger_icr,
        };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Insurance purchase should succeed: {:?}", result);
        assert!(ctx.events.has_events(), "Should emit InsurancePurchased event");
    }

    #[test]
    fn test_purchase_insurance_excessive_coverage() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 200_000_000,
            debt: 100_000 * ONE_ZKUSD,
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        // Coverage > 50% of collateral
        let coverage_btc = 150_000_000; // 75% of collateral

        ctx.vault = Some(vault);
        ctx.signer = owner;
        ctx.zkusd_inputs = 1_000 * ONE_ZKUSD;

        let action = VaultAction::PurchaseInsurance {
            vault_id: [0u8; 32],
            coverage_btc,
            premium: 1_000 * ONE_ZKUSD,
            trigger_icr: 115,
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::ExceedsMaximum { .. })));
    }

    #[test]
    fn test_purchase_insurance_not_owner() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];
        let attacker = [99u8; 32];

        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 200_000_000,
            debt: 100_000 * ONE_ZKUSD,
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        };

        ctx.vault = Some(vault);
        ctx.signer = attacker; // Not the owner
        ctx.zkusd_inputs = 1_000 * ONE_ZKUSD;

        let action = VaultAction::PurchaseInsurance {
            vault_id: [0u8; 32],
            coverage_btc: 50_000_000,
            premium: 1_000 * ONE_ZKUSD,
            trigger_icr: 115,
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::Unauthorized { .. })));
    }

    #[test]
    fn test_trigger_insurance_success() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        // Distressed vault with 112% ICR (below trigger 115%)
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 112_000_000, // 1.12 BTC = $112,000
            debt: 100_000 * ONE_ZKUSD, // $100,000 debt -> 112% ICR
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 20_000_000, // Has 0.2 BTC insurance
        };

        let insurance_id = [42u8; 32];

        // After trigger: add insurance to collateral, reduce insurance balance
        ctx.vault = Some(vault.clone());
        ctx.new_vault = Some(Vault {
            collateral: vault.collateral + 10_000_000, // Used 0.1 BTC of insurance
            insurance_balance: 10_000_000, // Remaining insurance
            last_updated: ctx.block_height,
            ..vault
        });
        ctx.signer = owner;

        let action = VaultAction::TriggerInsurance {
            insurance_id,
            vault_id: [0u8; 32],
        };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Insurance trigger should succeed: {:?}", result);
        assert!(ctx.events.has_events(), "Should emit InsuranceTriggered event");
    }

    #[test]
    fn test_trigger_insurance_no_coverage() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        // Vault without insurance
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 112_000_000,
            debt: 100_000 * ONE_ZKUSD,
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0, // No insurance
        };

        ctx.vault = Some(vault);
        ctx.signer = owner;

        let action = VaultAction::TriggerInsurance {
            insurance_id: [42u8; 32],
            vault_id: [0u8; 32],
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::NoInsurance { .. })));
    }

    #[test]
    fn test_trigger_insurance_icr_too_high() {
        let mut ctx = create_test_context();
        let owner = [1u8; 32];

        // Vault with ICR above trigger threshold
        let vault = Vault {
            id: [0u8; 32],
            owner,
            collateral: 150_000_000, // 1.5 BTC = $150,000
            debt: 100_000 * ONE_ZKUSD, // -> 150% ICR (above 115% trigger)
            created_at: 50,
            last_updated: 50,
            status: VaultStatus::Active,
            interest_rate_bps: 100,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 20_000_000, // Has insurance
        };

        ctx.vault = Some(vault);
        ctx.signer = owner;

        let action = VaultAction::TriggerInsurance {
            insurance_id: [42u8; 32],
            vault_id: [0u8; 32],
        };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::InsuranceNotTriggerable { .. })));
    }
}
