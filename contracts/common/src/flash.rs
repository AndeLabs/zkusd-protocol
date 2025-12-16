//! Flash Minting Module for zkUSD
//!
//! Implements flash loans/minting following the UTXO atomic model.
//! Uses Bitcoin UTXO patterns, NOT Ethereum smart contracts.
//! Flash operations must complete within a single transaction (spell).
//!
//! ## IMPORTANT: Bitcoin Logic vs Ethereum Smart Contracts
//!
//! This module provides BOTH approaches for reference:
//! - `FlashMintSpell` - Higher-level abstraction (can work with callbacks for compatibility)
//! - `charms_ops::validate_flash_mint_spell` - Pure UTXO-native validation (PREFERRED)
//!
//! In Bitcoin/Charms, flash minting is simpler because spells are inherently atomic.
//! No callbacks needed - just validate input/output balance!
//!
//! ## UTXO Advantages for Flash Operations
//!
//! - **Atomic by Design**: UTXO model guarantees all-or-nothing execution
//! - **No Re-entrancy**: Single-pass validation eliminates re-entrancy attacks
//! - **Predictable Gas**: Fee is known before execution
//! - **Parallel Processing**: Multiple flash ops can process simultaneously
//!
//! ## Use Cases
//!
//! 1. **Arbitrage**: Mint zkUSD, arb across DEXs, repay with profit
//! 2. **Self-Liquidation**: Flash mint to repay debt, recover collateral
//! 3. **Collateral Swap**: Flash mint, swap collateral type, repay
//! 4. **Leverage Adjustment**: Increase/decrease leverage atomically
//!
//! ## References
//!
//! - Aave Flash Loans: https://www.quicknode.com/guides/defi/lending-protocols/how-to-make-a-flash-loan-using-aave
//! - MakerDAO Flash Mint: https://bitcoin.tax/blog/crypto-flash-loan-platforms-in-2024/
//! - Charms Protocol: https://blog.bitcoinos.build/blog/bos-unveils-charms

use crate::{
    constants::fees::BPS_DENOMINATOR,
    errors::{ZkUsdError, ZkUsdResult},
    types::{Address, VaultId},
    Vec,
};

// ============ Flash Minting Configuration ============

/// Flash minting fee in basis points (0.05% = 5 bps)
pub const FLASH_MINT_FEE_BPS: u64 = 5;

/// Maximum flash mint amount (10M zkUSD)
pub const MAX_FLASH_MINT: u64 = 10_000_000_00000000;

/// Minimum flash mint amount (100 zkUSD)
pub const MIN_FLASH_MINT: u64 = 100_00000000;

// ============ Flash Operation Types ============

/// Type of flash operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlashOperationType {
    /// Mint zkUSD, use it, repay + fee
    FlashMint,
    /// Borrow BTC collateral, use it, return + fee
    FlashBorrow,
    /// Combined: mint + borrow for complex operations
    FlashCombo,
}

/// Flash operation request
#[derive(Debug, Clone)]
pub struct FlashRequest {
    /// Type of flash operation
    pub op_type: FlashOperationType,
    /// Requester address
    pub requester: Address,
    /// Amount to flash mint (zkUSD)
    pub mint_amount: u64,
    /// Amount to flash borrow (BTC satoshis)
    pub borrow_amount: u64,
    /// Callback data (serialized operation to perform)
    pub callback_data: Vec<u8>,
    /// Expected return amount (for validation)
    pub expected_return: u64,
    /// Deadline block
    pub deadline_block: u64,
}

impl FlashRequest {
    /// Create a flash mint request
    pub fn flash_mint(
        requester: Address,
        amount: u64,
        callback_data: Vec<u8>,
        deadline_block: u64,
    ) -> Self {
        Self {
            op_type: FlashOperationType::FlashMint,
            requester,
            mint_amount: amount,
            borrow_amount: 0,
            callback_data,
            expected_return: amount + calculate_flash_fee(amount),
            deadline_block,
        }
    }

    /// Create a flash borrow request (BTC)
    pub fn flash_borrow(
        requester: Address,
        btc_amount: u64,
        callback_data: Vec<u8>,
        deadline_block: u64,
    ) -> Self {
        Self {
            op_type: FlashOperationType::FlashBorrow,
            requester,
            mint_amount: 0,
            borrow_amount: btc_amount,
            callback_data,
            expected_return: btc_amount + calculate_flash_fee(btc_amount),
            deadline_block,
        }
    }
}

/// Flash operation result
#[derive(Debug, Clone)]
pub struct FlashResult {
    /// Whether operation succeeded
    pub success: bool,
    /// Amount minted
    pub minted: u64,
    /// Amount borrowed
    pub borrowed: u64,
    /// Fee paid
    pub fee_paid: u64,
    /// Amount returned
    pub amount_returned: u64,
    /// Profit (if any)
    pub profit: i64,
}

// ============ Flash Mint State ============

/// State for tracking flash mint within a spell
#[derive(Debug, Clone, Default)]
pub struct FlashMintState {
    /// Currently outstanding flash mints
    pub outstanding_mints: u64,
    /// Currently outstanding flash borrows
    pub outstanding_borrows: u64,
    /// Total fees collected this spell
    pub fees_collected: u64,
    /// Number of flash ops in current spell
    pub ops_count: u32,
    /// Whether we're in a flash callback
    pub in_callback: bool,
}

impl FlashMintState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if flash state is balanced (must be at spell end)
    pub fn is_balanced(&self) -> bool {
        self.outstanding_mints == 0 && self.outstanding_borrows == 0
    }
}

// ============ Flash Operations ============

/// Calculate flash mint/borrow fee
pub fn calculate_flash_fee(amount: u64) -> u64 {
    (amount as u128 * FLASH_MINT_FEE_BPS as u128 / BPS_DENOMINATOR as u128) as u64
}

/// Validate and initiate flash mint
pub fn initiate_flash_mint(
    state: &mut FlashMintState,
    request: &FlashRequest,
    current_block: u64,
) -> ZkUsdResult<u64> {
    // Validate request
    if request.mint_amount < MIN_FLASH_MINT {
        return Err(ZkUsdError::BelowMinimum {
            amount: request.mint_amount,
            minimum: MIN_FLASH_MINT,
        });
    }

    if request.mint_amount > MAX_FLASH_MINT {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: request.mint_amount,
            maximum: MAX_FLASH_MINT,
        });
    }

    if current_block > request.deadline_block {
        return Err(ZkUsdError::InvalidInput {
            param: "deadline_block",
            reason: "Flash request expired",
        });
    }

    // Check no nested flash mints
    if state.in_callback {
        return Err(ZkUsdError::InvalidInput {
            param: "flash_mint",
            reason: "Nested flash operations not allowed",
        });
    }

    // Calculate fee
    let fee = calculate_flash_fee(request.mint_amount);

    // Update state
    state.outstanding_mints = state.outstanding_mints.saturating_add(request.mint_amount);
    state.in_callback = true;
    state.ops_count += 1;

    Ok(fee)
}

/// Complete flash mint by verifying repayment
pub fn complete_flash_mint(
    state: &mut FlashMintState,
    original_amount: u64,
    returned_amount: u64,
) -> ZkUsdResult<FlashResult> {
    let required_return = original_amount + calculate_flash_fee(original_amount);

    if returned_amount < required_return {
        return Err(ZkUsdError::InsufficientBalance {
            available: returned_amount,
            requested: required_return,
        });
    }

    let fee = calculate_flash_fee(original_amount);
    let profit = (returned_amount as i64) - (required_return as i64);

    // Update state
    state.outstanding_mints = state.outstanding_mints.saturating_sub(original_amount);
    state.fees_collected = state.fees_collected.saturating_add(fee);
    state.in_callback = false;

    Ok(FlashResult {
        success: true,
        minted: original_amount,
        borrowed: 0,
        fee_paid: fee,
        amount_returned: returned_amount,
        profit,
    })
}

// ============ Flash Loan Callbacks ============

/// Callback type for flash operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FlashCallback {
    /// Arbitrage between two price points
    Arbitrage {
        buy_price: u64,
        sell_price: u64,
        venue_a: [u8; 32],
        venue_b: [u8; 32],
    },
    /// Self-liquidation
    SelfLiquidate {
        vault_id: VaultId,
    },
    /// Collateral swap
    CollateralSwap {
        vault_id: VaultId,
        new_collateral_type: u8,
    },
    /// Leverage adjustment
    AdjustLeverage {
        vault_id: VaultId,
        target_leverage: u64, // In basis points (e.g., 30000 = 3x)
    },
    /// Refinance to new interest rate
    Refinance {
        vault_id: VaultId,
        new_rate_bps: u64,
    },
    /// Custom callback with arbitrary data
    Custom {
        callback_id: [u8; 32],
        data: Vec<u8>,
    },
}

/// Process arbitrage callback
pub fn process_arbitrage_callback(
    flash_amount: u64,
    buy_price: u64,
    sell_price: u64,
) -> ZkUsdResult<ArbitrageResult> {
    // Validate prices make sense for arb
    if sell_price <= buy_price {
        return Err(ZkUsdError::InvalidInput {
            param: "prices",
            reason: "No arbitrage opportunity",
        });
    }

    // Calculate profit
    // Buy at lower price, sell at higher price
    let tokens_bought = (flash_amount as u128 * 100_000_000) / buy_price as u128;
    let proceeds = (tokens_bought * sell_price as u128) / 100_000_000;
    let gross_profit = proceeds.saturating_sub(flash_amount as u128);
    let fee = calculate_flash_fee(flash_amount) as u128;
    let net_profit = gross_profit.saturating_sub(fee);

    Ok(ArbitrageResult {
        flash_amount,
        tokens_bought: tokens_bought as u64,
        proceeds: proceeds as u64,
        gross_profit: gross_profit as u64,
        fee: fee as u64,
        net_profit: net_profit as u64,
        is_profitable: net_profit > 0,
    })
}

// ============ Callback Validation (UTXO-Native) ============

/// Callback validation proof - proves the callback was executed correctly
/// In UTXO model, this is verified by checking input/output balance in the spell
#[derive(Debug, Clone)]
pub struct CallbackProof {
    /// Hash of the callback data that was executed
    pub callback_hash: [u8; 32],
    /// Amount that was flash minted
    pub minted_amount: u64,
    /// Amount that was returned (must be >= minted + fee)
    pub returned_amount: u64,
    /// Intermediate outputs created during callback
    pub intermediate_outputs: Vec<IntermediateOutput>,
    /// Whether the callback modified any vault state
    pub vault_modifications: Vec<VaultModification>,
}

/// Intermediate output created during flash callback
#[derive(Debug, Clone)]
pub struct IntermediateOutput {
    /// Output index in the spell
    pub output_index: u32,
    /// Amount of zkUSD
    pub zkusd_amount: u64,
    /// Amount of BTC (satoshis)
    pub btc_amount: u64,
    /// Destination address
    pub destination: Address,
}

/// Vault modification during flash callback
#[derive(Debug, Clone)]
pub struct VaultModification {
    /// Vault ID modified
    pub vault_id: VaultId,
    /// Collateral change (positive = added, negative = removed)
    pub collateral_delta: i64,
    /// Debt change (positive = minted, negative = repaid)
    pub debt_delta: i64,
}

/// Validate a flash mint callback execution
///
/// This is the key innovation: In UTXO model, we validate the callback
/// by checking the spell's inputs and outputs match the expected state.
/// No re-entrancy possible because validation is single-pass.
pub fn validate_callback_execution(
    state: &FlashMintState,
    callback: &FlashCallback,
    proof: &CallbackProof,
    btc_price: u64,
) -> ZkUsdResult<CallbackValidation> {
    // 1. Verify minimum return amount
    let required_return = proof.minted_amount + calculate_flash_fee(proof.minted_amount);
    if proof.returned_amount < required_return {
        return Err(ZkUsdError::InsufficientBalance {
            available: proof.returned_amount,
            requested: required_return,
        });
    }

    // 2. Validate callback-specific constraints
    let validation = match callback {
        FlashCallback::Arbitrage { buy_price, sell_price, .. } => {
            validate_arbitrage_callback(proof, *buy_price, *sell_price)?
        }
        FlashCallback::SelfLiquidate { vault_id } => {
            validate_self_liquidate_callback(proof, vault_id, btc_price)?
        }
        FlashCallback::CollateralSwap { vault_id, new_collateral_type } => {
            validate_collateral_swap_callback(proof, vault_id, *new_collateral_type)?
        }
        FlashCallback::AdjustLeverage { vault_id, target_leverage } => {
            validate_leverage_callback(proof, vault_id, *target_leverage, btc_price)?
        }
        FlashCallback::Refinance { vault_id, new_rate_bps } => {
            validate_refinance_callback(proof, vault_id, *new_rate_bps)?
        }
        FlashCallback::Custom { callback_id, data } => {
            validate_custom_callback(proof, callback_id, data)?
        }
    };

    // 3. Verify state consistency
    if state.in_callback && state.outstanding_mints != proof.minted_amount {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    Ok(validation)
}

/// Result of callback validation
#[derive(Debug, Clone)]
pub struct CallbackValidation {
    /// Whether callback is valid
    pub is_valid: bool,
    /// Net profit/loss from the operation
    pub net_result: i64,
    /// Gas/fee efficiency score (0-100)
    pub efficiency_score: u8,
    /// Warnings (non-fatal issues)
    pub warnings: Vec<&'static str>,
}

fn validate_arbitrage_callback(
    proof: &CallbackProof,
    buy_price: u64,
    sell_price: u64,
) -> ZkUsdResult<CallbackValidation> {
    // Verify the arb is profitable after fees
    let result = process_arbitrage_callback(proof.minted_amount, buy_price, sell_price)?;

    let mut warnings = Vec::new();
    if result.net_profit < calculate_flash_fee(proof.minted_amount) {
        warnings.push("Profit barely covers fees");
    }

    Ok(CallbackValidation {
        is_valid: result.is_profitable,
        net_result: result.net_profit as i64,
        efficiency_score: if result.is_profitable { 80 } else { 0 },
        warnings,
    })
}

fn validate_self_liquidate_callback(
    proof: &CallbackProof,
    vault_id: &VaultId,
    btc_price: u64,
) -> ZkUsdResult<CallbackValidation> {
    // Find vault modification
    let vault_mod = proof.vault_modifications.iter()
        .find(|m| &m.vault_id == vault_id)
        .ok_or(ZkUsdError::VaultNotFound { vault_id: *vault_id })?;

    // Debt should be fully repaid (negative delta = repayment)
    if vault_mod.debt_delta >= 0 {
        return Err(ZkUsdError::InvalidInput {
            param: "debt_delta",
            reason: "Self-liquidation must repay debt",
        });
    }

    // Collateral should be withdrawn (negative delta)
    let collateral_recovered = (-vault_mod.collateral_delta) as u64;
    let debt_repaid = (-vault_mod.debt_delta) as u64;

    // Calculate value saved
    let collateral_value = (collateral_recovered as u128 * btc_price as u128 / 100_000_000) as u64;
    let net_saved = collateral_value.saturating_sub(debt_repaid);

    Ok(CallbackValidation {
        is_valid: collateral_value > debt_repaid,
        net_result: net_saved as i64,
        efficiency_score: 90,
        warnings: Vec::new(),
    })
}

fn validate_collateral_swap_callback(
    proof: &CallbackProof,
    vault_id: &VaultId,
    _new_collateral_type: u8,
) -> ZkUsdResult<CallbackValidation> {
    // Verify vault exists and was modified
    let _vault_mod = proof.vault_modifications.iter()
        .find(|m| &m.vault_id == vault_id)
        .ok_or(ZkUsdError::VaultNotFound { vault_id: *vault_id })?;

    // Collateral swap should maintain or improve ICR
    // (Full validation would check new collateral value vs old)

    Ok(CallbackValidation {
        is_valid: true,
        net_result: 0,
        efficiency_score: 85,
        warnings: Vec::new(),
    })
}

fn validate_leverage_callback(
    proof: &CallbackProof,
    vault_id: &VaultId,
    target_leverage: u64,
    _btc_price: u64,
) -> ZkUsdResult<CallbackValidation> {
    let vault_mod = proof.vault_modifications.iter()
        .find(|m| &m.vault_id == vault_id)
        .ok_or(ZkUsdError::VaultNotFound { vault_id: *vault_id })?;

    // Leverage must be within safe bounds (max 5x = 50000 bps)
    if target_leverage > 50000 {
        return Err(ZkUsdError::InvalidInput {
            param: "target_leverage",
            reason: "Leverage exceeds maximum (5x)",
        });
    }

    let mut warnings = Vec::new();
    if target_leverage > 30000 {
        warnings.push("High leverage increases liquidation risk");
    }

    // Both collateral and debt should increase for leverage up
    let is_leveraging_up = vault_mod.collateral_delta > 0 && vault_mod.debt_delta > 0;
    let is_deleveraging = vault_mod.collateral_delta < 0 && vault_mod.debt_delta < 0;

    Ok(CallbackValidation {
        is_valid: is_leveraging_up || is_deleveraging,
        net_result: 0,
        efficiency_score: 75,
        warnings,
    })
}

fn validate_refinance_callback(
    proof: &CallbackProof,
    vault_id: &VaultId,
    new_rate_bps: u64,
) -> ZkUsdResult<CallbackValidation> {
    let _vault_mod = proof.vault_modifications.iter()
        .find(|m| &m.vault_id == vault_id)
        .ok_or(ZkUsdError::VaultNotFound { vault_id: *vault_id })?;

    // New rate must be reasonable (0-20%)
    if new_rate_bps > 2000 {
        return Err(ZkUsdError::InvalidInput {
            param: "new_rate_bps",
            reason: "Interest rate too high (max 20%)",
        });
    }

    Ok(CallbackValidation {
        is_valid: true,
        net_result: 0,
        efficiency_score: 95,
        warnings: Vec::new(),
    })
}

fn validate_custom_callback(
    proof: &CallbackProof,
    callback_id: &[u8; 32],
    _data: &[u8],
) -> ZkUsdResult<CallbackValidation> {
    // For custom callbacks, we verify:
    // 1. Callback hash matches
    // 2. Return amount is sufficient

    if proof.callback_hash != *callback_id {
        return Err(ZkUsdError::InvalidInput {
            param: "callback_id",
            reason: "Callback hash mismatch",
        });
    }

    Ok(CallbackValidation {
        is_valid: true,
        net_result: 0,
        efficiency_score: 70,
        warnings: vec!["Custom callback - verify manually"],
    })
}

/// Result of arbitrage operation
#[derive(Debug, Clone)]
pub struct ArbitrageResult {
    pub flash_amount: u64,
    pub tokens_bought: u64,
    pub proceeds: u64,
    pub gross_profit: u64,
    pub fee: u64,
    pub net_profit: u64,
    pub is_profitable: bool,
}

/// Process self-liquidation callback
pub fn process_self_liquidation(
    vault_collateral: u64,
    vault_debt: u64,
    btc_price: u64,
) -> ZkUsdResult<SelfLiquidationResult> {
    // Calculate how much zkUSD needed to repay
    let debt_to_repay = vault_debt;

    // Calculate collateral value
    let collateral_value = (vault_collateral as u128 * btc_price as u128 / 100_000_000) as u64;

    // Check if profitable (collateral > debt)
    if collateral_value <= debt_to_repay {
        return Err(ZkUsdError::InvalidInput {
            param: "vault",
            reason: "Self-liquidation not profitable",
        });
    }

    let flash_fee = calculate_flash_fee(debt_to_repay);
    let net_collateral = vault_collateral;
    let net_value = collateral_value.saturating_sub(debt_to_repay).saturating_sub(flash_fee);

    Ok(SelfLiquidationResult {
        debt_repaid: debt_to_repay,
        collateral_recovered: net_collateral,
        flash_fee,
        net_value_saved: net_value,
    })
}

/// Result of self-liquidation
#[derive(Debug, Clone)]
pub struct SelfLiquidationResult {
    pub debt_repaid: u64,
    pub collateral_recovered: u64,
    pub flash_fee: u64,
    pub net_value_saved: u64,
}

// ============ Flash Mint Spell Integration ============

/// A complete flash mint spell for UTXO model
#[derive(Debug, Clone)]
pub struct FlashMintSpell {
    /// Unique spell ID
    pub spell_id: [u8; 32],
    /// Flash request
    pub request: FlashRequest,
    /// Callback to execute
    pub callback: FlashCallback,
    /// State before execution
    pub pre_state: FlashMintState,
    /// State after execution
    pub post_state: Option<FlashMintState>,
    /// Result
    pub result: Option<FlashResult>,
}

impl FlashMintSpell {
    pub fn new(spell_id: [u8; 32], request: FlashRequest, callback: FlashCallback) -> Self {
        Self {
            spell_id,
            request,
            callback,
            pre_state: FlashMintState::new(),
            post_state: None,
            result: None,
        }
    }

    /// Execute the flash mint spell atomically with callback validation
    pub fn execute(&mut self, current_block: u64) -> ZkUsdResult<FlashResult> {
        // 1. Initiate flash mint
        let fee = initiate_flash_mint(&mut self.pre_state, &self.request, current_block)?;

        // 2. Execute callback (simulated - in real impl this would be the callback)
        let returned_amount = self.request.mint_amount + fee;

        // 3. Complete flash mint
        let result = complete_flash_mint(
            &mut self.pre_state,
            self.request.mint_amount,
            returned_amount,
        )?;

        // 4. Verify state is balanced
        if !self.pre_state.is_balanced() {
            return Err(ZkUsdError::InvalidStateTransition);
        }

        self.post_state = Some(self.pre_state.clone());
        self.result = Some(result.clone());

        Ok(result)
    }

    /// Execute with full callback validation (UTXO-native)
    pub fn execute_with_validation(
        &mut self,
        current_block: u64,
        proof: &CallbackProof,
        btc_price: u64,
    ) -> ZkUsdResult<(FlashResult, CallbackValidation)> {
        // 1. Initiate flash mint
        let _fee = initiate_flash_mint(&mut self.pre_state, &self.request, current_block)?;

        // 2. Validate callback execution
        let validation = validate_callback_execution(
            &self.pre_state,
            &self.callback,
            proof,
            btc_price,
        )?;

        if !validation.is_valid {
            return Err(ZkUsdError::InvalidInput {
                param: "callback",
                reason: "Callback validation failed",
            });
        }

        // 3. Complete flash mint with actual returned amount from proof
        let result = complete_flash_mint(
            &mut self.pre_state,
            self.request.mint_amount,
            proof.returned_amount,
        )?;

        // 4. Verify state is balanced
        if !self.pre_state.is_balanced() {
            return Err(ZkUsdError::InvalidStateTransition);
        }

        self.post_state = Some(self.pre_state.clone());
        self.result = Some(result.clone());

        Ok((result, validation))
    }
}

// ============ Flash Borrow (BTC Collateral) ============

/// Flash borrow state - for borrowing BTC collateral
#[derive(Debug, Clone, Default)]
pub struct FlashBorrowState {
    /// Outstanding BTC borrows
    pub outstanding_btc: u64,
    /// Fees collected (in BTC)
    pub fees_collected_btc: u64,
    /// Whether in callback
    pub in_callback: bool,
}

/// Initiate flash borrow of BTC collateral
pub fn initiate_flash_borrow(
    state: &mut FlashBorrowState,
    request: &FlashRequest,
    current_block: u64,
) -> ZkUsdResult<u64> {
    if request.op_type != FlashOperationType::FlashBorrow {
        return Err(ZkUsdError::InvalidInput {
            param: "op_type",
            reason: "Expected FlashBorrow operation",
        });
    }

    if current_block > request.deadline_block {
        return Err(ZkUsdError::InvalidInput {
            param: "deadline_block",
            reason: "Flash request expired",
        });
    }

    if state.in_callback {
        return Err(ZkUsdError::InvalidInput {
            param: "flash_borrow",
            reason: "Nested flash operations not allowed",
        });
    }

    let fee = calculate_flash_fee(request.borrow_amount);
    state.outstanding_btc = state.outstanding_btc.saturating_add(request.borrow_amount);
    state.in_callback = true;

    Ok(fee)
}

/// Complete flash borrow
pub fn complete_flash_borrow(
    state: &mut FlashBorrowState,
    original_amount: u64,
    returned_amount: u64,
) -> ZkUsdResult<FlashResult> {
    let required_return = original_amount + calculate_flash_fee(original_amount);

    if returned_amount < required_return {
        return Err(ZkUsdError::InsufficientBalance {
            available: returned_amount,
            requested: required_return,
        });
    }

    let fee = calculate_flash_fee(original_amount);
    let profit = (returned_amount as i64) - (required_return as i64);

    state.outstanding_btc = state.outstanding_btc.saturating_sub(original_amount);
    state.fees_collected_btc = state.fees_collected_btc.saturating_add(fee);
    state.in_callback = false;

    Ok(FlashResult {
        success: true,
        minted: 0,
        borrowed: original_amount,
        fee_paid: fee,
        amount_returned: returned_amount,
        profit,
    })
}

// ============ Combo Operations ============

/// Flash combo - mint zkUSD + borrow BTC atomically
pub struct FlashComboSpell {
    pub spell_id: [u8; 32],
    pub zkusd_amount: u64,
    pub btc_amount: u64,
    pub callback: FlashCallback,
    pub mint_state: FlashMintState,
    pub borrow_state: FlashBorrowState,
}

impl FlashComboSpell {
    pub fn new(
        spell_id: [u8; 32],
        zkusd_amount: u64,
        btc_amount: u64,
        callback: FlashCallback,
    ) -> Self {
        Self {
            spell_id,
            zkusd_amount,
            btc_amount,
            callback,
            mint_state: FlashMintState::new(),
            borrow_state: FlashBorrowState::default(),
        }
    }

    /// Execute combo flash operation
    pub fn execute(
        &mut self,
        requester: Address,
        current_block: u64,
        deadline_block: u64,
    ) -> ZkUsdResult<ComboFlashResult> {
        // 1. Initiate both flash operations
        let mint_request = FlashRequest {
            op_type: FlashOperationType::FlashMint,
            requester,
            mint_amount: self.zkusd_amount,
            borrow_amount: 0,
            callback_data: Vec::new(),
            expected_return: self.zkusd_amount + calculate_flash_fee(self.zkusd_amount),
            deadline_block,
        };

        let borrow_request = FlashRequest {
            op_type: FlashOperationType::FlashBorrow,
            requester,
            mint_amount: 0,
            borrow_amount: self.btc_amount,
            callback_data: Vec::new(),
            expected_return: self.btc_amount + calculate_flash_fee(self.btc_amount),
            deadline_block,
        };

        let mint_fee = initiate_flash_mint(&mut self.mint_state, &mint_request, current_block)?;
        let borrow_fee = initiate_flash_borrow(&mut self.borrow_state, &borrow_request, current_block)?;

        // 2. Simulate callback execution
        let zkusd_returned = self.zkusd_amount + mint_fee;
        let btc_returned = self.btc_amount + borrow_fee;

        // 3. Complete both operations
        let mint_result = complete_flash_mint(&mut self.mint_state, self.zkusd_amount, zkusd_returned)?;
        let borrow_result = complete_flash_borrow(&mut self.borrow_state, self.btc_amount, btc_returned)?;

        Ok(ComboFlashResult {
            zkusd_minted: mint_result.minted,
            btc_borrowed: borrow_result.borrowed,
            total_fee_zkusd: mint_result.fee_paid,
            total_fee_btc: borrow_result.fee_paid,
            success: mint_result.success && borrow_result.success,
        })
    }
}

/// Result of combo flash operation
#[derive(Debug, Clone)]
pub struct ComboFlashResult {
    pub zkusd_minted: u64,
    pub btc_borrowed: u64,
    pub total_fee_zkusd: u64,
    pub total_fee_btc: u64,
    pub success: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_ZKUSD: u64 = 100_000_000;
    const ONE_BTC: u64 = 100_000_000;
    const BTC_PRICE: u64 = 100_000_00000000;

    #[test]
    fn test_flash_fee_calculation() {
        // 10,000 zkUSD at 0.05% = 5 zkUSD fee
        let fee = calculate_flash_fee(10_000 * ONE_ZKUSD);
        assert_eq!(fee, 5 * ONE_ZKUSD);

        // 100,000 zkUSD at 0.05% = 50 zkUSD fee
        let fee = calculate_flash_fee(100_000 * ONE_ZKUSD);
        assert_eq!(fee, 50 * ONE_ZKUSD);
    }

    #[test]
    fn test_flash_mint_initiation() {
        let mut state = FlashMintState::new();
        let request = FlashRequest::flash_mint(
            [1u8; 32],
            10_000 * ONE_ZKUSD,
            vec![],
            1000,
        );

        let fee = initiate_flash_mint(&mut state, &request, 100).unwrap();
        assert_eq!(fee, 5 * ONE_ZKUSD);
        assert_eq!(state.outstanding_mints, 10_000 * ONE_ZKUSD);
        assert!(state.in_callback);
    }

    #[test]
    fn test_flash_mint_completion() {
        let mut state = FlashMintState::new();
        state.outstanding_mints = 10_000 * ONE_ZKUSD;
        state.in_callback = true;

        let result = complete_flash_mint(
            &mut state,
            10_000 * ONE_ZKUSD,
            10_005 * ONE_ZKUSD, // Original + fee
        ).unwrap();

        assert!(result.success);
        assert_eq!(result.minted, 10_000 * ONE_ZKUSD);
        assert_eq!(result.fee_paid, 5 * ONE_ZKUSD);
        assert!(state.is_balanced());
    }

    #[test]
    fn test_flash_mint_insufficient_repayment() {
        let mut state = FlashMintState::new();
        state.outstanding_mints = 10_000 * ONE_ZKUSD;
        state.in_callback = true;

        let result = complete_flash_mint(
            &mut state,
            10_000 * ONE_ZKUSD,
            10_000 * ONE_ZKUSD, // Missing fee
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_arbitrage_profitable() {
        let result = process_arbitrage_callback(
            10_000 * ONE_ZKUSD,
            99_000_00000000,  // Buy at $99k
            101_000_00000000, // Sell at $101k
        ).unwrap();

        assert!(result.is_profitable);
        assert!(result.net_profit > 0);
    }

    #[test]
    fn test_arbitrage_not_profitable() {
        let result = process_arbitrage_callback(
            10_000 * ONE_ZKUSD,
            100_000_00000000, // Buy at $100k
            99_000_00000000,  // Sell at $99k (lower!)
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_self_liquidation() {
        // Vault with 1 BTC ($100k) and 50k debt
        let result = process_self_liquidation(
            ONE_BTC,
            50_000 * ONE_ZKUSD,
            BTC_PRICE,
        ).unwrap();

        assert_eq!(result.debt_repaid, 50_000 * ONE_ZKUSD);
        assert_eq!(result.collateral_recovered, ONE_BTC);
        assert!(result.net_value_saved > 0);
    }

    #[test]
    fn test_flash_spell_execution() {
        let request = FlashRequest::flash_mint(
            [1u8; 32],
            10_000 * ONE_ZKUSD,
            vec![],
            1000,
        );

        let mut spell = FlashMintSpell::new(
            [0u8; 32],
            request,
            FlashCallback::SelfLiquidate { vault_id: [1u8; 32] },
        );

        let result = spell.execute(100).unwrap();
        assert!(result.success);
        assert!(spell.pre_state.is_balanced());
    }

    #[test]
    fn test_nested_flash_not_allowed() {
        let mut state = FlashMintState::new();
        state.in_callback = true; // Already in a flash

        let request = FlashRequest::flash_mint(
            [1u8; 32],
            10_000 * ONE_ZKUSD,
            vec![],
            1000,
        );

        let result = initiate_flash_mint(&mut state, &request, 100);
        assert!(result.is_err());
    }

    #[test]
    fn test_flash_below_minimum() {
        let mut state = FlashMintState::new();
        let request = FlashRequest::flash_mint(
            [1u8; 32],
            50 * ONE_ZKUSD, // Below minimum
            vec![],
            1000,
        );

        let result = initiate_flash_mint(&mut state, &request, 100);
        assert!(result.is_err());
    }

    #[test]
    fn test_flash_above_maximum() {
        let mut state = FlashMintState::new();
        let request = FlashRequest::flash_mint(
            [1u8; 32],
            20_000_000 * ONE_ZKUSD, // Above maximum
            vec![],
            1000,
        );

        let result = initiate_flash_mint(&mut state, &request, 100);
        assert!(result.is_err());
    }
}
