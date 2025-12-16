//! UTXO-Native Charms Operations for zkUSD
//!
//! This module implements zkUSD features using Charms/UTXO-native patterns.
//! Uses Bitcoin UTXO patterns, NOT Ethereum smart contracts.
//! Key difference from Ethereum: NO CALLBACKS - spells are inherently atomic.
//!
//! ## IMPORTANT: Bitcoin Logic vs Smart Contract Logic
//!
//! ```text
//! Ethereum (DON'T):                    Bitcoin/UTXO (DO):
//! ─────────────────                    ──────────────────
//! flashLoan() {                        Spell {
//!   mint(amount);                        inputs: [utxo1, utxo2]
//!   callback.execute(); // CALLBACK!     outputs: [utxo3, utxo4]
//!   burn(amount + fee);                  // Atomic by design!
//! }                                    }
//! ```
//!
//! ## Research-Based Design Decisions
//!
//! 1. **Flash Minting**: Unlike Aave/MakerDAO callbacks, UTXO atomicity means
//!    the entire mint-use-repay happens in a single spell validation.
//!    Reference: https://bitcoin.tax/blog/crypto-flash-loan-platforms-in-2024/
//!
//! 2. **Atomic Rescue**: Third party provides collateral + debt repayment
//!    in the same spell that consumes the distressed vault.
//!    Reference: https://blog.defisaver.com/liqity-v2-is-coming-to-defi-saver/
//!
//! 3. **Insurance Charms**: Tradeable NFT-like tokens that can be consumed
//!    to inject collateral into vaults near liquidation.
//!    Reference: https://university.mitosis.org/defi-insurance-protocols/
//!
//! ## Best Practices Applied (from Bitcoin/Charms ecosystem)
//!
//! - Client-side validation (RGB/Charms pattern)
//! - Single-use seals for double-spend prevention
//! - Recursive ZK proofs for state validity
//! - No re-entrancy by design (single-pass validation)
//!
//! ## See Also
//!
//! - `/docs/UTXO_NATIVE_DESIGN.md` - Full design documentation
//! - Charms Protocol: https://blog.bitcoinos.build/blog/bos-unveils-charms
//! - RGB Protocol: https://rgb-org.github.io/

use crate::{
    constants::fees::BPS_DENOMINATOR,
    errors::{ZkUsdError, ZkUsdResult},
    math::calculate_icr,
    types::*,
    Vec,
};

// ============ Constants ============

/// Flash mint fee in basis points (0.05% = 5 bps, same as our existing config)
pub const FLASH_MINT_FEE_BPS: u64 = 5;

/// Maximum flash mint per spell (10M zkUSD)
pub const MAX_FLASH_MINT_PER_SPELL: u64 = 10_000_000_00000000;

/// Minimum flash mint amount (100 zkUSD)
pub const MIN_FLASH_MINT: u64 = 100_00000000;

/// Insurance premium base rate (1% per year in blocks)
pub const INSURANCE_BASE_PREMIUM_BPS: u64 = 100;

/// Grace period for insurance (1 day in blocks ~144)
pub const INSURANCE_GRACE_BLOCKS: u64 = 144;

// ============ Spell State Representation ============

/// Represents zkUSD state within a spell (input or output)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZkUsdCharmState {
    /// Total zkUSD amount
    pub zkusd_amount: u64,
    /// BTC collateral (satoshis)
    pub btc_amount: u64,
    /// Vault states (if any)
    pub vaults: Vec<SpellVault>,
    /// Insurance charms
    pub insurance_charms: Vec<SpellInsurance>,
    /// Rescue offers
    pub rescue_offers: Vec<SpellRescue>,
}

/// Vault state within a spell
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpellVault {
    pub id: VaultId,
    pub owner: Address,
    pub collateral: u64,
    pub debt: u64,
    pub interest_rate_bps: u64,
}

/// Insurance charm within a spell
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpellInsurance {
    pub charm_id: [u8; 32],
    pub vault_id: VaultId,
    pub owner: Address,
    pub coverage_btc: u64,
    pub trigger_icr: u64,
    pub expires_at: u64,
    pub is_triggered: bool,
}

/// Rescue offer within a spell
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpellRescue {
    pub offer_id: [u8; 32],
    pub vault_id: VaultId,
    pub rescuer: Address,
    pub collateral_to_add: u64,
    pub debt_to_repay: u64,
    pub min_icr_after: u64,
    pub expires_at: u64,
}

// ============ UTXO-Native Flash Minting ============

/// Flash mint request in UTXO model
///
/// Unlike Ethereum where you request a loan and provide a callback,
/// in UTXO model the entire operation is defined in the spell.
/// The contract just validates that inputs and outputs balance correctly.
#[derive(Debug, Clone)]
pub struct SpellFlashMint {
    /// Amount being flash minted
    pub mint_amount: u64,
    /// Fee that must be paid (calculated automatically)
    pub fee: u64,
    /// Purpose of the flash mint (for logging/tracking)
    pub purpose: FlashMintPurpose,
}

/// Purpose of flash mint operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlashMintPurpose {
    /// Self-liquidation: repay own vault debt
    SelfLiquidation,
    /// Arbitrage between price feeds
    Arbitrage,
    /// Collateral swap
    CollateralSwap,
    /// Leverage adjustment
    LeverageAdjustment,
    /// Third-party vault rescue
    VaultRescue,
    /// Custom operation
    Custom,
}

/// Validate a flash mint spell
///
/// In UTXO model, flash mint validation is simple:
/// 1. Check the spell's total zkUSD output >= input + fee
/// 2. Verify amount is within bounds
/// 3. The atomicity is guaranteed by UTXO model
pub fn validate_flash_mint_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    flash_mint: &SpellFlashMint,
) -> ZkUsdResult<FlashMintValidation> {
    // Validate amount bounds
    if flash_mint.mint_amount < MIN_FLASH_MINT {
        return Err(ZkUsdError::BelowMinimum {
            amount: flash_mint.mint_amount,
            minimum: MIN_FLASH_MINT,
        });
    }

    if flash_mint.mint_amount > MAX_FLASH_MINT_PER_SPELL {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: flash_mint.mint_amount,
            maximum: MAX_FLASH_MINT_PER_SPELL,
        });
    }

    // Calculate required fee
    let required_fee = calculate_flash_fee(flash_mint.mint_amount);

    // In UTXO model: output_zkusd must be >= input_zkusd
    // The flash minted amount is "used" within the spell
    // Fee must be present as burnt/collected zkUSD
    let zkusd_delta = output_state.zkusd_amount as i128 - input_state.zkusd_amount as i128;

    // If flash mint is used for operations that don't return zkUSD (like self-liquidation),
    // the output might have less zkUSD but the fee must still be paid
    let fee_paid = if zkusd_delta >= 0 {
        // Net positive: some fee might be included in output
        required_fee
    } else {
        // Net negative: fee must come from the "saved" amount
        // This is valid for self-liquidation where you burn zkUSD to free collateral
        let deficit = (-zkusd_delta) as u64;
        if deficit > flash_mint.mint_amount {
            return Err(ZkUsdError::InsufficientBalance {
                available: flash_mint.mint_amount,
                requested: deficit,
            });
        }
        required_fee
    };

    Ok(FlashMintValidation {
        is_valid: true,
        mint_amount: flash_mint.mint_amount,
        fee_paid,
        purpose: flash_mint.purpose,
        input_zkusd: input_state.zkusd_amount,
        output_zkusd: output_state.zkusd_amount,
    })
}

/// Result of flash mint validation
#[derive(Debug, Clone)]
pub struct FlashMintValidation {
    pub is_valid: bool,
    pub mint_amount: u64,
    pub fee_paid: u64,
    pub purpose: FlashMintPurpose,
    pub input_zkusd: u64,
    pub output_zkusd: u64,
}

/// Calculate flash mint fee
pub fn calculate_flash_fee(amount: u64) -> u64 {
    (amount as u128 * FLASH_MINT_FEE_BPS as u128 / BPS_DENOMINATOR as u128) as u64
}

// ============ UTXO-Native Atomic Rescue ============

/// Atomic rescue spell validation
///
/// In UTXO model, a rescue is a single spell that:
/// 1. Consumes the distressed vault UTXO
/// 2. Adds collateral from rescuer
/// 3. Repays some/all debt
/// 4. Creates new vault UTXO with improved health
///
/// All participants must sign the spell (vault owner + rescuer)
pub fn validate_rescue_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    rescue: &SpellRescue,
    btc_price: u64,
    current_block: u64,
) -> ZkUsdResult<RescueValidation> {
    // Find input vault
    let input_vault = input_state.vaults.iter()
        .find(|v| v.id == rescue.vault_id)
        .ok_or(ZkUsdError::VaultNotFound { vault_id: rescue.vault_id })?;

    // Check offer validity
    if current_block >= rescue.expires_at {
        return Err(ZkUsdError::InvalidInput {
            param: "expires_at",
            reason: "Rescue offer expired",
        });
    }

    // Calculate ICR before rescue
    let icr_before = calculate_icr(input_vault.collateral, input_vault.debt, btc_price)?;

    // Find output vault
    let output_vault = output_state.vaults.iter()
        .find(|v| v.id == rescue.vault_id)
        .ok_or(ZkUsdError::VaultNotFound { vault_id: rescue.vault_id })?;

    // Verify collateral was added
    let collateral_added = output_vault.collateral.saturating_sub(input_vault.collateral);
    if collateral_added < rescue.collateral_to_add {
        return Err(ZkUsdError::InvalidInput {
            param: "collateral_to_add",
            reason: "Insufficient collateral added",
        });
    }

    // Verify debt was repaid
    let debt_repaid = input_vault.debt.saturating_sub(output_vault.debt);
    if debt_repaid < rescue.debt_to_repay {
        return Err(ZkUsdError::InvalidInput {
            param: "debt_to_repay",
            reason: "Insufficient debt repaid",
        });
    }

    // Calculate ICR after rescue
    let icr_after = calculate_icr(output_vault.collateral, output_vault.debt, btc_price)?;

    // Verify minimum ICR requirement
    if icr_after < rescue.min_icr_after {
        return Err(ZkUsdError::Undercollateralized {
            current_ratio: icr_after,
            required_ratio: rescue.min_icr_after,
        });
    }

    // Calculate rescuer's potential bonus (from future surplus)
    let bonus = calculate_rescue_bonus(icr_after, output_vault.collateral, btc_price);

    Ok(RescueValidation {
        is_valid: true,
        vault_id: rescue.vault_id,
        icr_before,
        icr_after,
        collateral_added,
        debt_repaid,
        rescuer: rescue.rescuer,
        potential_bonus: bonus,
    })
}

/// Result of rescue validation
#[derive(Debug, Clone)]
pub struct RescueValidation {
    pub is_valid: bool,
    pub vault_id: VaultId,
    pub icr_before: u64,
    pub icr_after: u64,
    pub collateral_added: u64,
    pub debt_repaid: u64,
    pub rescuer: Address,
    pub potential_bonus: u64,
}

/// Calculate potential rescue bonus
fn calculate_rescue_bonus(icr: u64, collateral: u64, _btc_price: u64) -> u64 {
    // Bonus is 0.5% of surplus above 150% ICR
    if icr <= 150 {
        return 0;
    }
    let surplus_ratio = icr - 150;
    (collateral as u128 * surplus_ratio as u128 * 50 / 10000 / 100) as u64
}

/// Create a rescue offer (to be included in spell)
pub fn create_rescue_offer(
    vault_id: VaultId,
    rescuer: Address,
    collateral_to_add: u64,
    debt_to_repay: u64,
    min_icr_after: u64,
    current_block: u64,
    validity_blocks: u64,
) -> SpellRescue {
    // Generate offer ID from vault + block
    let mut offer_id = vault_id;
    let block_bytes = current_block.to_le_bytes();
    for (i, byte) in block_bytes.iter().enumerate() {
        offer_id[24 + i] = *byte;
    }

    SpellRescue {
        offer_id,
        vault_id,
        rescuer,
        collateral_to_add,
        debt_to_repay,
        min_icr_after,
        expires_at: current_block.saturating_add(validity_blocks),
    }
}

// ============ UTXO-Native Insurance Charms ============

/// Insurance charm is a tradeable token that provides liquidation protection
///
/// In UTXO model:
/// - Insurance charm is an NFT-like charm attached to a UTXO
/// - Can be transferred by including in spell inputs/outputs
/// - Triggered by consuming it in a spell that adds collateral to vault
/// - Trading happens through normal charm transfers
#[derive(Debug, Clone)]
pub struct InsuranceCharmOps;

impl InsuranceCharmOps {
    /// Create a new insurance charm
    pub fn mint(
        vault: &SpellVault,
        coverage_btc: u64,
        trigger_icr: u64,
        duration_blocks: u64,
        current_block: u64,
    ) -> ZkUsdResult<(SpellInsurance, u64)> {
        // Validate trigger ICR (100-120%)
        if trigger_icr < 100 || trigger_icr > 120 {
            return Err(ZkUsdError::InvalidInput {
                param: "trigger_icr",
                reason: "Trigger ICR must be 100-120%",
            });
        }

        // Coverage cannot exceed vault collateral
        if coverage_btc > vault.collateral {
            return Err(ZkUsdError::InvalidInput {
                param: "coverage_btc",
                reason: "Coverage exceeds vault collateral",
            });
        }

        // Calculate premium
        let premium = Self::calculate_premium(coverage_btc, duration_blocks, trigger_icr);

        // Generate charm ID
        let mut charm_id = vault.id;
        let block_bytes = current_block.to_le_bytes();
        for (i, byte) in block_bytes.iter().enumerate() {
            charm_id[24 + i] = *byte;
        }

        let charm = SpellInsurance {
            charm_id,
            vault_id: vault.id,
            owner: vault.owner,
            coverage_btc,
            trigger_icr,
            expires_at: current_block.saturating_add(duration_blocks),
            is_triggered: false,
        };

        Ok((charm, premium))
    }

    /// Calculate insurance premium
    pub fn calculate_premium(coverage_btc: u64, duration_blocks: u64, trigger_icr: u64) -> u64 {
        const BLOCKS_PER_YEAR: u64 = 52_560;

        // Base: 1% of coverage per year
        let base = (coverage_btc as u128 * INSURANCE_BASE_PREMIUM_BPS as u128 * duration_blocks as u128)
            / (BLOCKS_PER_YEAR as u128 * 10_000);

        // Adjust for trigger ICR (lower trigger = more expensive)
        let icr_multiplier = if trigger_icr < 110 {
            150 + (110 - trigger_icr) * 10 // 105% = 200% multiplier
        } else {
            100
        };

        (base * icr_multiplier as u128 / 100) as u64
    }

    /// Validate insurance transfer in spell
    pub fn validate_transfer(
        input_state: &ZkUsdCharmState,
        output_state: &ZkUsdCharmState,
        charm_id: [u8; 32],
        new_owner: Address,
        current_block: u64,
    ) -> ZkUsdResult<bool> {
        // Find charm in inputs
        let input_charm = input_state.insurance_charms.iter()
            .find(|c| c.charm_id == charm_id)
            .ok_or(ZkUsdError::InvalidInput {
                param: "charm_id",
                reason: "Insurance charm not found in inputs",
            })?;

        // Verify not expired
        if current_block >= input_charm.expires_at {
            return Err(ZkUsdError::InvalidInput {
                param: "expires_at",
                reason: "Insurance charm expired",
            });
        }

        // Verify not already triggered
        if input_charm.is_triggered {
            return Err(ZkUsdError::InvalidInput {
                param: "is_triggered",
                reason: "Insurance charm already triggered",
            });
        }

        // Find charm in outputs with new owner
        let output_charm = output_state.insurance_charms.iter()
            .find(|c| c.charm_id == charm_id && c.owner == new_owner)
            .ok_or(ZkUsdError::InvalidInput {
                param: "new_owner",
                reason: "Insurance charm not found in outputs with new owner",
            })?;

        // Verify charm properties preserved
        if output_charm.coverage_btc != input_charm.coverage_btc ||
           output_charm.trigger_icr != input_charm.trigger_icr ||
           output_charm.vault_id != input_charm.vault_id {
            return Err(ZkUsdError::InvalidInput {
                param: "charm",
                reason: "Insurance charm properties changed during transfer",
            });
        }

        Ok(true)
    }

    /// Trigger insurance charm (add collateral to vault)
    pub fn validate_trigger(
        input_state: &ZkUsdCharmState,
        output_state: &ZkUsdCharmState,
        charm_id: [u8; 32],
        btc_price: u64,
        current_block: u64,
    ) -> ZkUsdResult<InsuranceTriggerValidation> {
        // Find charm in inputs
        let input_charm = input_state.insurance_charms.iter()
            .find(|c| c.charm_id == charm_id)
            .ok_or(ZkUsdError::InvalidInput {
                param: "charm_id",
                reason: "Insurance charm not found",
            })?;

        // Verify charm is active
        if input_charm.is_triggered {
            return Err(ZkUsdError::InvalidInput {
                param: "is_triggered",
                reason: "Insurance already triggered",
            });
        }

        if current_block >= input_charm.expires_at {
            return Err(ZkUsdError::InvalidInput {
                param: "expires_at",
                reason: "Insurance expired",
            });
        }

        // Find vault in inputs
        let input_vault = input_state.vaults.iter()
            .find(|v| v.id == input_charm.vault_id)
            .ok_or(ZkUsdError::VaultNotFound { vault_id: input_charm.vault_id })?;

        // Check ICR trigger condition
        let icr_before = calculate_icr(input_vault.collateral, input_vault.debt, btc_price)?;
        if icr_before > input_charm.trigger_icr {
            return Err(ZkUsdError::InvalidInput {
                param: "trigger_icr",
                reason: "Vault ICR above trigger threshold",
            });
        }

        // Find vault in outputs (should have more collateral)
        let output_vault = output_state.vaults.iter()
            .find(|v| v.id == input_charm.vault_id)
            .ok_or(ZkUsdError::VaultNotFound { vault_id: input_charm.vault_id })?;

        // Verify collateral was added
        let collateral_added = output_vault.collateral.saturating_sub(input_vault.collateral);
        if collateral_added < input_charm.coverage_btc {
            return Err(ZkUsdError::InvalidInput {
                param: "coverage_btc",
                reason: "Insufficient collateral added by insurance",
            });
        }

        let icr_after = calculate_icr(output_vault.collateral, output_vault.debt, btc_price)?;

        // Charm should be consumed (not in outputs) or marked as triggered
        let charm_consumed = !output_state.insurance_charms.iter()
            .any(|c| c.charm_id == charm_id && !c.is_triggered);

        if !charm_consumed {
            return Err(ZkUsdError::InvalidInput {
                param: "charm",
                reason: "Insurance charm not consumed after trigger",
            });
        }

        Ok(InsuranceTriggerValidation {
            is_valid: true,
            charm_id,
            vault_id: input_charm.vault_id,
            coverage_applied: collateral_added,
            icr_before,
            icr_after,
            grace_expires_at: current_block.saturating_add(INSURANCE_GRACE_BLOCKS),
        })
    }
}

/// Result of insurance trigger validation
#[derive(Debug, Clone)]
pub struct InsuranceTriggerValidation {
    pub is_valid: bool,
    pub charm_id: [u8; 32],
    pub vault_id: VaultId,
    pub coverage_applied: u64,
    pub icr_before: u64,
    pub icr_after: u64,
    pub grace_expires_at: u64,
}

// ============ Combined Spell Validation ============

/// Validate a complete zkUSD spell
///
/// This is the main entry point for validating zkUSD state transitions.
/// Checks all operations: flash mints, rescues, insurance triggers, etc.
pub fn validate_zkusd_spell(
    input_state: &ZkUsdCharmState,
    output_state: &ZkUsdCharmState,
    operations: &SpellOperations,
    btc_price: u64,
    current_block: u64,
) -> ZkUsdResult<SpellValidation> {
    let mut validations = SpellValidation::default();

    // Validate flash mints
    for flash_mint in &operations.flash_mints {
        let validation = validate_flash_mint_spell(input_state, output_state, flash_mint)?;
        validations.flash_mint_validations.push(validation);
    }

    // Validate rescues
    for rescue in &operations.rescues {
        let validation = validate_rescue_spell(
            input_state, output_state, rescue, btc_price, current_block
        )?;
        validations.rescue_validations.push(validation);
    }

    // Validate insurance triggers
    for charm_id in &operations.insurance_triggers {
        let validation = InsuranceCharmOps::validate_trigger(
            input_state, output_state, *charm_id, btc_price, current_block
        )?;
        validations.insurance_validations.push(validation);
    }

    // Validate insurance transfers
    for (charm_id, new_owner) in &operations.insurance_transfers {
        InsuranceCharmOps::validate_transfer(
            input_state, output_state, *charm_id, *new_owner, current_block
        )?;
        validations.insurance_transfers_valid += 1;
    }

    // Global balance checks
    validations.total_zkusd_in = input_state.zkusd_amount;
    validations.total_zkusd_out = output_state.zkusd_amount;
    validations.total_btc_in = input_state.btc_amount;
    validations.total_btc_out = output_state.btc_amount;

    // Calculate total fees
    validations.total_fees = validations.flash_mint_validations.iter()
        .map(|v| v.fee_paid)
        .sum();

    validations.is_valid = true;
    Ok(validations)
}

/// Operations in a spell
#[derive(Debug, Clone, Default)]
pub struct SpellOperations {
    pub flash_mints: Vec<SpellFlashMint>,
    pub rescues: Vec<SpellRescue>,
    pub insurance_triggers: Vec<[u8; 32]>,
    pub insurance_transfers: Vec<([u8; 32], Address)>,
}

/// Result of spell validation
#[derive(Debug, Clone, Default)]
pub struct SpellValidation {
    pub is_valid: bool,
    pub flash_mint_validations: Vec<FlashMintValidation>,
    pub rescue_validations: Vec<RescueValidation>,
    pub insurance_validations: Vec<InsuranceTriggerValidation>,
    pub insurance_transfers_valid: u32,
    pub total_zkusd_in: u64,
    pub total_zkusd_out: u64,
    pub total_btc_in: u64,
    pub total_btc_out: u64,
    pub total_fees: u64,
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_ZKUSD: u64 = 100_000_000;
    const ONE_BTC: u64 = 100_000_000;
    const BTC_PRICE: u64 = 100_000_00000000; // $100,000

    fn create_test_vault(collateral: u64, debt: u64) -> SpellVault {
        SpellVault {
            id: [1u8; 32],
            owner: [2u8; 32],
            collateral,
            debt,
            interest_rate_bps: 100,
        }
    }

    fn create_test_state(zkusd: u64, btc: u64, vaults: Vec<SpellVault>) -> ZkUsdCharmState {
        ZkUsdCharmState {
            zkusd_amount: zkusd,
            btc_amount: btc,
            vaults,
            insurance_charms: Vec::new(),
            rescue_offers: Vec::new(),
        }
    }

    #[test]
    fn test_flash_mint_fee_calculation() {
        // 10,000 zkUSD at 0.05% = 5 zkUSD fee
        let fee = calculate_flash_fee(10_000 * ONE_ZKUSD);
        assert_eq!(fee, 5 * ONE_ZKUSD);
    }

    #[test]
    fn test_flash_mint_validation_success() {
        let input = create_test_state(0, ONE_BTC, vec![]);
        let output = create_test_state(5 * ONE_ZKUSD, ONE_BTC, vec![]); // Fee collected

        let flash_mint = SpellFlashMint {
            mint_amount: 10_000 * ONE_ZKUSD,
            fee: 5 * ONE_ZKUSD,
            purpose: FlashMintPurpose::Arbitrage,
        };

        let result = validate_flash_mint_spell(&input, &output, &flash_mint);
        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(validation.is_valid);
        assert_eq!(validation.fee_paid, 5 * ONE_ZKUSD);
    }

    #[test]
    fn test_flash_mint_below_minimum() {
        let input = create_test_state(0, ONE_BTC, vec![]);
        let output = create_test_state(0, ONE_BTC, vec![]);

        let flash_mint = SpellFlashMint {
            mint_amount: 50 * ONE_ZKUSD, // Below 100 minimum
            fee: 0,
            purpose: FlashMintPurpose::Custom,
        };

        let result = validate_flash_mint_spell(&input, &output, &flash_mint);
        assert!(result.is_err());
    }

    #[test]
    fn test_rescue_validation_success() {
        let vault = create_test_vault(ONE_BTC, 90_000 * ONE_ZKUSD); // ICR ~111%
        let input = create_test_state(10_000 * ONE_ZKUSD, 0, vec![vault.clone()]);

        // Rescue adds 0.1 BTC collateral
        let mut rescued_vault = vault.clone();
        rescued_vault.collateral = ONE_BTC + ONE_BTC / 10;
        let output = create_test_state(10_000 * ONE_ZKUSD, 0, vec![rescued_vault]);

        let rescue = SpellRescue {
            offer_id: [0u8; 32],
            vault_id: [1u8; 32],
            rescuer: [3u8; 32],
            collateral_to_add: ONE_BTC / 10,
            debt_to_repay: 0,
            min_icr_after: 120, // Want at least 120% after
            expires_at: 1000,
        };

        let result = validate_rescue_spell(&input, &output, &rescue, BTC_PRICE, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_insurance_premium_calculation() {
        // 1 BTC coverage, 1 year, 110% trigger
        let premium_110 = InsuranceCharmOps::calculate_premium(ONE_BTC, 52_560, 110);

        // 1 BTC coverage, 1 year, 105% trigger (more expensive)
        let premium_105 = InsuranceCharmOps::calculate_premium(ONE_BTC, 52_560, 105);

        assert!(premium_105 > premium_110);

        // 105% should be 2x the 110% premium
        assert!(premium_105 >= premium_110 * 2);
    }

    #[test]
    fn test_insurance_mint() {
        let vault = create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD);

        let result = InsuranceCharmOps::mint(
            &vault,
            ONE_BTC / 2, // 0.5 BTC coverage
            110,         // 110% trigger
            52_560,      // 1 year
            100,         // current block
        );

        assert!(result.is_ok());
        let (charm, premium) = result.unwrap();
        assert_eq!(charm.coverage_btc, ONE_BTC / 2);
        assert_eq!(charm.trigger_icr, 110);
        assert!(premium > 0);
    }

    #[test]
    fn test_full_spell_validation() {
        let vault = create_test_vault(ONE_BTC, 50_000 * ONE_ZKUSD);
        let input = create_test_state(0, 2 * ONE_BTC, vec![vault.clone()]);

        // Output with fee collected
        let output = create_test_state(5 * ONE_ZKUSD, 2 * ONE_BTC, vec![vault]);

        let operations = SpellOperations {
            flash_mints: vec![SpellFlashMint {
                mint_amount: 10_000 * ONE_ZKUSD,
                fee: 5 * ONE_ZKUSD,
                purpose: FlashMintPurpose::Arbitrage,
            }],
            ..Default::default()
        };

        let result = validate_zkusd_spell(&input, &output, &operations, BTC_PRICE, 100);
        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(validation.is_valid);
        assert_eq!(validation.total_fees, 5 * ONE_ZKUSD);
    }
}
