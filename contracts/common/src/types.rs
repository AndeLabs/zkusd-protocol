//! Core Types for zkUSD Protocol
//!
//! This module defines all the fundamental data structures used across
//! the zkUSD protocol contracts.

use crate::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

/// Type alias for addresses (32-byte hash)
pub type Address = [u8; 32];

/// Type alias for vault identifiers
pub type VaultId = [u8; 32];

/// Type alias for transaction identifiers
pub type TxId = [u8; 32];

/// Type alias for app identifiers
pub type AppId = [u8; 32];

// ============ Vault Types ============

/// Status of a vault
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum VaultStatus {
    /// Vault is active and can be modified
    #[default]
    Active,
    /// Vault is being liquidated
    Liquidating,
    /// Vault has been closed (debt fully repaid)
    Closed,
    /// Vault was liquidated
    Liquidated,
}

/// Individual vault state
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Vault {
    /// Unique identifier for this vault
    pub id: VaultId,
    /// Owner's address (pubkey hash)
    pub owner: Address,
    /// Collateral amount in satoshis
    pub collateral: u64,
    /// Debt amount in zkUSD base units (8 decimals)
    pub debt: u64,
    /// Block height when vault was created
    pub created_at: u64,
    /// Last modification block height
    pub last_updated: u64,
    /// Current status
    pub status: VaultStatus,
    // ===== NEW: Mezo-inspired improvements =====
    /// Fixed interest rate (basis points, e.g., 100 = 1% APR)
    pub interest_rate_bps: u64,
    /// Accrued interest in zkUSD base units
    pub accrued_interest: u64,
    /// Redistributed debt received from other liquidations
    pub redistributed_debt: u64,
    /// Redistributed collateral received from liquidations
    pub redistributed_collateral: u64,
    /// Insurance premium paid (for optional liquidation protection)
    pub insurance_balance: u64,
}

impl Vault {
    /// Creates a new vault with fixed interest rate
    pub fn new(id: VaultId, owner: Address, collateral: u64, debt: u64, block_height: u64) -> Self {
        Self::with_interest_rate(id, owner, collateral, debt, block_height, crate::constants::fees::DEFAULT_INTEREST_RATE_BPS)
    }

    /// Creates a new vault with custom interest rate
    pub fn with_interest_rate(
        id: VaultId,
        owner: Address,
        collateral: u64,
        debt: u64,
        block_height: u64,
        interest_rate_bps: u64,
    ) -> Self {
        Self {
            id,
            owner,
            collateral,
            debt,
            created_at: block_height,
            last_updated: block_height,
            status: VaultStatus::Active,
            interest_rate_bps,
            accrued_interest: 0,
            redistributed_debt: 0,
            redistributed_collateral: 0,
            insurance_balance: 0,
        }
    }

    /// Returns true if vault is active
    pub fn is_active(&self) -> bool {
        self.status == VaultStatus::Active
    }

    /// Returns net debt (total debt minus liquidation reserve)
    pub fn net_debt(&self) -> u64 {
        self.debt.saturating_sub(crate::constants::limits::LIQUIDATION_RESERVE)
    }

    /// Returns entire debt including accrued interest and redistributions
    pub fn entire_debt(&self) -> u64 {
        self.debt
            .saturating_add(self.accrued_interest)
            .saturating_add(self.redistributed_debt)
    }

    /// Returns entire collateral including redistributions
    pub fn entire_collateral(&self) -> u64 {
        self.collateral.saturating_add(self.redistributed_collateral)
    }

    /// Calculate accrued interest based on blocks elapsed
    /// Uses simple interest: principal * rate * time / (blocks_per_year * 10000)
    pub fn calculate_interest(&self, current_block: u64) -> u64 {
        let blocks_elapsed = current_block.saturating_sub(self.last_updated);
        if blocks_elapsed == 0 || self.interest_rate_bps == 0 {
            return 0;
        }

        // Blocks per year (assuming ~10 min blocks): 52,560
        const BLOCKS_PER_YEAR: u128 = 52_560;

        let interest = (self.debt as u128)
            .saturating_mul(self.interest_rate_bps as u128)
            .saturating_mul(blocks_elapsed as u128)
            / BLOCKS_PER_YEAR
            / 10_000;

        interest.min(u64::MAX as u128) as u64
    }

    /// Check if vault has liquidation insurance active
    pub fn has_insurance(&self) -> bool {
        self.insurance_balance > 0
    }
}

// ============ Protocol State Types ============

/// Global protocol state
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct ProtocolState {
    /// Total collateral in the system (satoshis)
    pub total_collateral: u64,
    /// Total debt in the system (zkUSD base units)
    pub total_debt: u64,
    /// Number of active vaults
    pub active_vault_count: u64,
    /// Current base rate for borrowing fee (in basis points)
    pub base_rate: u64,
    /// Last block when base rate was updated
    pub last_fee_update_block: u64,
    /// Protocol admin address
    pub admin: Address,
    /// Whether protocol is paused
    pub is_paused: bool,
}

impl ProtocolState {
    /// Creates initial protocol state
    pub fn new(admin: Address) -> Self {
        Self {
            total_collateral: 0,
            total_debt: 0,
            active_vault_count: 0,
            base_rate: crate::constants::fees::MIN_BORROWING_FEE_BPS,
            last_fee_update_block: 0,
            admin,
            is_paused: false,
        }
    }
}

// ============ Oracle Types ============

/// Price data from oracle
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct PriceData {
    /// Price in USD with 8 decimal places (e.g., 100000_00000000 = $100,000)
    pub price: u64,
    /// Block height when price was updated
    pub timestamp_block: u64,
    /// Source identifier
    pub source: PriceSource,
    /// Confidence level (0-100)
    pub confidence: u8,
}

/// Price source identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum PriceSource {
    /// Mock oracle for testing
    #[default]
    Mock,
    /// Aggregated from multiple sources
    Aggregated,
    /// Chainlink-style oracle
    Chainlink,
    /// DIA oracle
    DIA,
    /// Custom oracle
    Custom,
}

impl PriceData {
    /// Creates a new price data entry
    pub fn new(price: u64, block: u64, source: PriceSource) -> Self {
        Self {
            price,
            timestamp_block: block,
            source,
            confidence: 100,
        }
    }

    /// Checks if price is stale based on current block
    pub fn is_stale(&self, current_block: u64) -> bool {
        current_block.saturating_sub(self.timestamp_block) > crate::constants::oracle::MAX_PRICE_AGE_BLOCKS
    }
}

// ============ Stability Pool Types ============

/// Individual deposit in stability pool
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct StabilityDeposit {
    /// Depositor's address
    pub owner: Address,
    /// Initial deposit amount (zkUSD)
    pub initial_value: u64,
    /// Snapshot of P at deposit time (for compounding)
    pub snapshot_p: u128,
    /// Snapshot of S at deposit time (for BTC rewards)
    pub snapshot_s: u128,
    /// Epoch at deposit time
    pub snapshot_epoch: u64,
    /// Scale at deposit time
    pub snapshot_scale: u64,
    /// Block height of last update
    pub last_updated: u64,
}

/// Global stability pool state
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct StabilityPoolState {
    /// Total zkUSD deposited
    pub total_zkusd: u64,
    /// Total BTC from liquidations (pending distribution)
    pub total_btc: u64,
    /// Product P for loss calculation (decreases on liquidations)
    pub product_p: u128,
    /// Sum S for BTC reward calculation
    pub sum_s: u128,
    /// Current epoch (resets on P underflow)
    pub current_epoch: u64,
    /// Current scale (for precision)
    pub current_scale: u64,
    /// Number of depositors
    pub depositor_count: u64,
}

impl StabilityPoolState {
    /// Creates initial stability pool state
    pub fn new() -> Self {
        Self {
            total_zkusd: 0,
            total_btc: 0,
            product_p: crate::constants::stability_pool::SCALE_FACTOR,
            sum_s: 0,
            current_epoch: 0,
            current_scale: 0,
            depositor_count: 0,
        }
    }
}

// ============ Token Types ============

/// Token metadata
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenMetadata {
    /// Token name
    pub name: &'static str,
    /// Token symbol
    pub symbol: &'static str,
    /// Decimal places
    pub decimals: u8,
    /// Total supply
    pub total_supply: u64,
}

impl Default for TokenMetadata {
    fn default() -> Self {
        Self {
            name: crate::constants::token::NAME,
            symbol: crate::constants::token::SYMBOL,
            decimals: crate::constants::token::DECIMALS,
            total_supply: 0,
        }
    }
}

// ============ Action Types ============

/// Actions for zkUSD Token contract
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum TokenAction {
    /// Transfer tokens between addresses
    Transfer { from: Address, to: Address, amount: u64 },
    /// Mint new tokens (only from authorized contracts)
    Mint { to: Address, amount: u64 },
    /// Burn tokens (repay debt)
    Burn { from: Address, amount: u64 },
}

/// Actions for Vault Manager contract
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum VaultAction {
    /// Open a new vault
    OpenVault { collateral: u64, debt: u64 },
    /// Close an existing vault
    CloseVault { vault_id: VaultId },
    /// Add collateral to vault
    AddCollateral { vault_id: VaultId, amount: u64 },
    /// Withdraw collateral from vault
    WithdrawCollateral { vault_id: VaultId, amount: u64 },
    /// Mint additional debt
    MintDebt { vault_id: VaultId, amount: u64 },
    /// Repay debt
    RepayDebt { vault_id: VaultId, amount: u64 },
    /// Liquidate undercollateralized vault
    Liquidate { vault_id: VaultId },
    /// Redeem zkUSD for collateral
    Redeem { amount: u64 },

    // ============ Advanced UTXO-Native Operations ============

    /// Flash mint zkUSD - atomic mint-use-repay in single spell
    /// UTXO model ensures atomicity without callbacks
    FlashMint {
        /// Amount to flash mint
        amount: u64,
        /// Purpose of the flash mint (for tracking)
        purpose: u8,
    },

    /// Atomic rescue of a distressed vault by third party
    /// Rescuer adds collateral + repays debt atomically
    AtomicRescue {
        /// Vault to rescue
        vault_id: VaultId,
        /// Collateral rescuer is adding (satoshis)
        collateral_to_add: u64,
        /// Debt rescuer is repaying (zkUSD)
        debt_to_repay: u64,
        /// Discount for rescuer (in BTC satoshis)
        rescuer_discount: u64,
    },

    /// Purchase insurance charm for a vault
    PurchaseInsurance {
        /// Vault to insure
        vault_id: VaultId,
        /// Coverage amount in BTC
        coverage_btc: u64,
        /// Premium paid in zkUSD
        premium: u64,
        /// ICR threshold that triggers insurance
        trigger_icr: u64,
    },

    /// Trigger insurance protection for a distressed vault
    TriggerInsurance {
        /// Insurance charm ID
        insurance_id: [u8; 32],
        /// Vault being protected
        vault_id: VaultId,
    },

    /// Transfer insurance charm ownership
    TransferInsurance {
        /// Insurance charm ID
        insurance_id: [u8; 32],
        /// New owner address
        new_owner: Address,
    },
}

/// Actions for Stability Pool contract
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum StabilityPoolAction {
    /// Deposit zkUSD into pool
    Deposit { amount: u64 },
    /// Withdraw zkUSD from pool
    Withdraw { amount: u64 },
    /// Claim accumulated BTC rewards
    ClaimBtc,
    /// Offset debt during liquidation (internal)
    Offset { debt: u64, collateral: u64 },
}

/// Actions for Price Oracle contract
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum OracleAction {
    /// Initialize oracle with initial state (admin and operator only)
    Initialize {
        admin: Address,
        operator: Address,
        initial_price: u64,
    },
    /// Update price feed
    UpdatePrice { price: u64 },
    /// Set oracle operator
    SetOperator { operator: Address },
}

// ============ NEW: Advanced Pool Types (Mezo-inspired) ============

/// Collateral Surplus Pool - stores excess collateral from liquidations
/// that users can claim later
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct CollSurplusPool {
    /// Total BTC held in surplus pool
    pub total_btc: u64,
}

/// Individual surplus claim
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct SurplusClaim {
    /// Owner who can claim this surplus
    pub owner: Address,
    /// BTC amount claimable
    pub btc_amount: u64,
    /// Block when surplus was created
    pub created_at: u64,
    /// Source vault ID (for reference)
    pub source_vault_id: VaultId,
}

impl SurplusClaim {
    pub fn new(owner: Address, btc_amount: u64, source_vault_id: VaultId, block_height: u64) -> Self {
        Self {
            owner,
            btc_amount,
            created_at: block_height,
            source_vault_id,
        }
    }
}

/// Default Pool - holds debt and collateral from liquidations
/// pending redistribution to other vaults
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct DefaultPool {
    /// Total debt pending redistribution
    pub debt: u64,
    /// Total BTC collateral pending redistribution
    pub collateral: u64,
    /// Debt redistribution index (for proportional calc)
    pub debt_redistribution_index: u128,
    /// Collateral redistribution index
    pub collateral_redistribution_index: u128,
}

impl DefaultPool {
    pub fn new() -> Self {
        Self {
            debt: 0,
            collateral: 0,
            debt_redistribution_index: 0,
            collateral_redistribution_index: 0,
        }
    }

    /// Check if there's pending redistribution
    pub fn has_pending(&self) -> bool {
        self.debt > 0 || self.collateral > 0
    }
}

/// Protocol Controlled Value (PCV) - protocol's own stability deposit
/// Acts as first line of defense in liquidations
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct ProtocolControlledValue {
    /// zkUSD deposited in stability pool by protocol
    pub stability_deposit: u64,
    /// Bootstrap loan (initial debt to seed the system)
    pub bootstrap_debt: u64,
    /// Accumulated fees from borrowing/refinancing
    pub accumulated_fees: u64,
    /// BTC earned from liquidations
    pub btc_rewards: u64,
    /// Percentage of fees going to gauge/rewards (rest pays bootstrap)
    pub gauge_allocation_bps: u64,
}

impl ProtocolControlledValue {
    /// Create new PCV with bootstrap loan
    pub fn new(bootstrap_debt: u64) -> Self {
        Self {
            stability_deposit: bootstrap_debt, // Initial deposit equals bootstrap
            bootstrap_debt,
            accumulated_fees: 0,
            btc_rewards: 0,
            gauge_allocation_bps: 5000, // 50% max to gauge until bootstrap repaid
        }
    }

    /// Check if bootstrap loan is fully repaid
    pub fn is_bootstrap_repaid(&self) -> bool {
        self.bootstrap_debt == 0
    }

    /// Calculate how much of a fee goes to bootstrap repayment
    pub fn fee_to_bootstrap(&self, fee: u64) -> u64 {
        if self.is_bootstrap_repaid() {
            return 0;
        }
        // At least 50% goes to bootstrap repayment
        let to_bootstrap = fee.saturating_mul(10000 - self.gauge_allocation_bps) / 10000;
        to_bootstrap.min(self.bootstrap_debt)
    }
}

/// Gas Pool - holds MUSD for gas compensation to liquidators
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct GasPool {
    /// Total zkUSD available for gas compensation
    pub total_zkusd: u64,
}

impl GasPool {
    /// Gas compensation per liquidation (200 zkUSD like Mezo)
    pub const GAS_COMPENSATION: u64 = 200_00000000; // 200 zkUSD

    pub fn new() -> Self {
        Self { total_zkusd: 0 }
    }

    /// Check if pool can pay gas compensation
    pub fn can_compensate(&self) -> bool {
        self.total_zkusd >= Self::GAS_COMPENSATION
    }
}

// ============ NEW: Insurance System Types ============

/// Liquidation Insurance - optional protection users can purchase
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct InsurancePolicy {
    /// Vault being insured
    pub vault_id: VaultId,
    /// Owner of the policy
    pub owner: Address,
    /// Coverage amount (max BTC to inject)
    pub coverage_btc: u64,
    /// Premium paid (zkUSD)
    pub premium_paid: u64,
    /// ICR threshold to trigger (e.g., 115% = 11500)
    pub trigger_icr: u64,
    /// Block when policy expires
    pub expires_at: u64,
    /// Whether policy has been used
    pub is_triggered: bool,
}

impl InsurancePolicy {
    pub fn new(
        vault_id: VaultId,
        owner: Address,
        coverage_btc: u64,
        premium_paid: u64,
        trigger_icr: u64,
        current_block: u64,
        duration_blocks: u64,
    ) -> Self {
        Self {
            vault_id,
            owner,
            coverage_btc,
            premium_paid,
            trigger_icr,
            expires_at: current_block.saturating_add(duration_blocks),
            is_triggered: false,
        }
    }

    /// Check if policy is active
    pub fn is_active(&self, current_block: u64) -> bool {
        !self.is_triggered && current_block < self.expires_at
    }

    /// Check if policy should trigger based on ICR
    pub fn should_trigger(&self, current_icr: u64, current_block: u64) -> bool {
        self.is_active(current_block) && current_icr <= self.trigger_icr
    }
}

// ============ NEW: Extended Actions ============

/// Extended Vault Actions with new features
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum ExtendedVaultAction {
    /// Standard vault actions
    Basic(VaultAction),

    /// Refinance: change interest rate (may have fee)
    Refinance { vault_id: VaultId, new_rate_bps: u64 },

    /// Claim surplus collateral from liquidation
    ClaimSurplus { vault_id: VaultId },

    /// Purchase liquidation insurance
    PurchaseInsurance {
        vault_id: VaultId,
        coverage_btc: u64,
        trigger_icr: u64,
        duration_blocks: u64,
    },

    /// Atomic rescue: add collateral + repay debt in one TX
    AtomicRescue {
        vault_id: VaultId,
        add_collateral: u64,
        repay_debt: u64,
    },

    /// Batch liquidate multiple vaults (UTXO advantage: parallel)
    BatchLiquidate { vault_ids: Vec<VaultId> },
}

/// Liquidation result - tracks what happened during liquidation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct LiquidationResult {
    /// Vault that was liquidated
    pub vault_id: VaultId,
    /// Debt that was offset by stability pool
    pub debt_offset: u64,
    /// Debt that was redistributed to other vaults
    pub debt_redistributed: u64,
    /// Collateral sent to stability pool depositors
    pub collateral_to_sp: u64,
    /// Collateral redistributed to other vaults
    pub collateral_redistributed: u64,
    /// Surplus collateral (if ICR > 110% in Recovery Mode)
    pub collateral_surplus: u64,
    /// Gas compensation to liquidator
    pub gas_compensation: u64,
    /// Liquidator bonus (0.5% of collateral)
    pub liquidator_bonus: u64,
}

impl LiquidationResult {
    pub fn new(vault_id: VaultId) -> Self {
        Self {
            vault_id,
            debt_offset: 0,
            debt_redistributed: 0,
            collateral_to_sp: 0,
            collateral_redistributed: 0,
            collateral_surplus: 0,
            gas_compensation: GasPool::GAS_COMPENSATION,
            liquidator_bonus: 0,
        }
    }

    /// Total debt handled
    pub fn total_debt(&self) -> u64 {
        self.debt_offset.saturating_add(self.debt_redistributed)
    }

    /// Total collateral distributed
    pub fn total_collateral(&self) -> u64 {
        self.collateral_to_sp
            .saturating_add(self.collateral_redistributed)
            .saturating_add(self.collateral_surplus)
            .saturating_add(self.liquidator_bonus)
    }
}

// ============ NEW: Soft Liquidation Bands (LLAMMA-inspired) ============

/// Liquidation band status for soft liquidation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum LiquidationBandStatus {
    /// Band is healthy, no conversion needed
    Healthy,
    /// Band is in soft liquidation zone
    SoftLiquidation,
    /// Band has been fully converted to zkUSD
    Converted,
    /// Band was hard liquidated
    HardLiquidated,
}

/// Individual liquidation band for soft liquidation mechanism
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct LiquidationBand {
    /// Band index (0 = lowest price, higher = higher price)
    pub index: u8,
    /// Lower price bound for this band (with 8 decimals)
    pub price_lower: u64,
    /// Upper price bound for this band
    pub price_upper: u64,
    /// BTC collateral in this band
    pub btc_amount: u64,
    /// zkUSD converted (increases during soft liquidation)
    pub zkusd_amount: u64,
    /// Current status
    pub status: LiquidationBandStatus,
}

impl LiquidationBand {
    pub fn new(index: u8, price_lower: u64, price_upper: u64, btc_amount: u64) -> Self {
        Self {
            index,
            price_lower,
            price_upper,
            btc_amount,
            zkusd_amount: 0,
            status: LiquidationBandStatus::Healthy,
        }
    }

    /// Check if current price is in this band
    pub fn contains_price(&self, price: u64) -> bool {
        price >= self.price_lower && price < self.price_upper
    }

    /// Calculate how much BTC should be converted at current price
    pub fn btc_to_convert(&self, current_price: u64) -> u64 {
        if current_price >= self.price_upper {
            0 // Price above band, no conversion
        } else if current_price < self.price_lower {
            self.btc_amount // Full conversion
        } else {
            // Proportional conversion within band
            let band_width = self.price_upper.saturating_sub(self.price_lower);
            if band_width == 0 {
                return self.btc_amount;
            }
            let price_in_band = self.price_upper.saturating_sub(current_price);
            (self.btc_amount as u128 * price_in_band as u128 / band_width as u128) as u64
        }
    }
}

/// Soft Liquidation Vault - vault with multiple price bands
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct SoftLiquidationVault {
    /// Base vault data
    pub vault: Vault,
    /// Liquidation bands (typically 4-10 bands)
    pub bands: Vec<LiquidationBand>,
    /// Total BTC currently in bands
    pub total_btc_in_bands: u64,
    /// Total zkUSD from conversions
    pub total_zkusd_converted: u64,
    /// Block when soft liquidation started (0 if healthy)
    pub soft_liq_start_block: u64,
    /// Whether vault is in soft liquidation mode
    pub is_in_soft_liquidation: bool,
}

impl SoftLiquidationVault {
    /// Create with default 4 bands
    pub fn from_vault(vault: Vault, current_price: u64) -> Self {
        let collateral = vault.collateral;
        let bands = Self::create_bands(collateral, current_price, 4);
        Self {
            vault,
            bands,
            total_btc_in_bands: collateral,
            total_zkusd_converted: 0,
            soft_liq_start_block: 0,
            is_in_soft_liquidation: false,
        }
    }

    /// Create liquidation bands for collateral
    fn create_bands(collateral: u64, current_price: u64, num_bands: u8) -> Vec<LiquidationBand> {
        let mut bands = Vec::with_capacity(num_bands as usize);
        let btc_per_band = collateral / num_bands as u64;

        // Bands span from 80% of current price to 110% (liquidation threshold)
        let price_110 = current_price * 110 / 100;
        let price_80 = current_price * 80 / 100;
        let band_width = (price_110 - price_80) / num_bands as u64;

        for i in 0..num_bands {
            let lower = price_80 + (i as u64 * band_width);
            let upper = lower + band_width;
            let btc = if i == num_bands - 1 {
                collateral - (btc_per_band * (num_bands - 1) as u64)
            } else {
                btc_per_band
            };
            bands.push(LiquidationBand::new(i, lower, upper, btc));
        }
        bands
    }

    /// Process soft liquidation at current price
    pub fn process_soft_liquidation(&mut self, current_price: u64, current_block: u64) -> u64 {
        let mut total_converted = 0u64;

        for band in &mut self.bands {
            if band.status == LiquidationBandStatus::Healthy && band.contains_price(current_price) {
                let to_convert = band.btc_to_convert(current_price);
                if to_convert > 0 {
                    let zkusd_value = (to_convert as u128 * current_price as u128 / 100_000_000) as u64;
                    band.btc_amount = band.btc_amount.saturating_sub(to_convert);
                    band.zkusd_amount = band.zkusd_amount.saturating_add(zkusd_value);
                    band.status = LiquidationBandStatus::SoftLiquidation;
                    total_converted += to_convert;
                }
            }
        }

        if total_converted > 0 {
            self.total_btc_in_bands = self.total_btc_in_bands.saturating_sub(total_converted);
            if self.soft_liq_start_block == 0 {
                self.soft_liq_start_block = current_block;
                self.is_in_soft_liquidation = true;
            }
        }

        total_converted
    }

    /// Reverse soft liquidation when price recovers
    pub fn reverse_soft_liquidation(&mut self, current_price: u64) -> u64 {
        let mut total_recovered = 0u64;

        for band in &mut self.bands {
            if band.status == LiquidationBandStatus::SoftLiquidation && current_price > band.price_upper {
                // Convert zkUSD back to BTC
                let btc_recovered = (band.zkusd_amount as u128 * 100_000_000 / current_price as u128) as u64;
                band.btc_amount = band.btc_amount.saturating_add(btc_recovered);
                band.zkusd_amount = 0;
                band.status = LiquidationBandStatus::Healthy;
                total_recovered += btc_recovered;
            }
        }

        if total_recovered > 0 {
            self.total_btc_in_bands = self.total_btc_in_bands.saturating_add(total_recovered);
            // Check if all bands are healthy
            if self.bands.iter().all(|b| b.status == LiquidationBandStatus::Healthy) {
                self.is_in_soft_liquidation = false;
                self.soft_liq_start_block = 0;
            }
        }

        total_recovered
    }
}

// ============ NEW: Vault Shards for Parallel Processing ============

/// Vault Shard - a fragment of a large vault for parallel processing
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct VaultShard {
    /// Unique shard ID
    pub shard_id: [u8; 32],
    /// Parent vault ID
    pub parent_vault_id: VaultId,
    /// Shard index within parent (0, 1, 2, ...)
    pub shard_index: u8,
    /// Collateral in this shard (satoshis)
    pub collateral: u64,
    /// Debt allocated to this shard
    pub debt: u64,
    /// Status of this shard
    pub status: VaultStatus,
    /// Owner (same as parent vault)
    pub owner: Address,
}

impl VaultShard {
    pub fn new(
        parent_vault_id: VaultId,
        shard_index: u8,
        collateral: u64,
        debt: u64,
        owner: Address,
    ) -> Self {
        let mut shard_id = parent_vault_id;
        shard_id[31] = shard_index;

        Self {
            shard_id,
            parent_vault_id,
            shard_index,
            collateral,
            debt,
            status: VaultStatus::Active,
            owner,
        }
    }
}

/// Sharded Vault - a vault split into multiple shards
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct ShardedVault {
    /// Original vault ID
    pub vault_id: VaultId,
    /// Owner address
    pub owner: Address,
    /// All shards
    pub shards: Vec<VaultShard>,
    /// Total collateral across all shards
    pub total_collateral: u64,
    /// Total debt across all shards
    pub total_debt: u64,
    /// Interest rate (shared across shards)
    pub interest_rate_bps: u64,
    /// Created at block
    pub created_at: u64,
}

impl ShardedVault {
    /// Minimum vault size to benefit from sharding (0.5 BTC)
    pub const MIN_SHARDING_SIZE: u64 = 50_000_000;
    /// Default number of shards
    pub const DEFAULT_SHARD_COUNT: u8 = 4;

    /// Create sharded vault from regular vault
    pub fn from_vault(vault: Vault, shard_count: u8) -> Self {
        let collateral_per_shard = vault.collateral / shard_count as u64;
        let debt_per_shard = vault.debt / shard_count as u64;

        let mut shards = Vec::with_capacity(shard_count as usize);
        for i in 0..shard_count {
            let coll = if i == shard_count - 1 {
                vault.collateral - (collateral_per_shard * (shard_count - 1) as u64)
            } else {
                collateral_per_shard
            };
            let debt = if i == shard_count - 1 {
                vault.debt - (debt_per_shard * (shard_count - 1) as u64)
            } else {
                debt_per_shard
            };
            shards.push(VaultShard::new(vault.id, i, coll, debt, vault.owner));
        }

        Self {
            vault_id: vault.id,
            owner: vault.owner,
            shards,
            total_collateral: vault.collateral,
            total_debt: vault.debt,
            interest_rate_bps: vault.interest_rate_bps,
            created_at: vault.created_at,
        }
    }

    /// Get active shards count
    pub fn active_shard_count(&self) -> usize {
        self.shards.iter().filter(|s| s.status == VaultStatus::Active).count()
    }

    /// Can be sharded?
    pub fn should_shard(collateral: u64) -> bool {
        collateral >= Self::MIN_SHARDING_SIZE
    }
}

// ============ NEW: Yield-Bearing Staked zkUSD ============

/// Staked zkUSD position - earns yield from protocol fees
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct StakedZkUSD {
    /// Owner address
    pub owner: Address,
    /// Amount of zkUSD staked
    pub staked_amount: u64,
    /// Rewards earned (in zkUSD)
    pub rewards_earned: u64,
    /// Block when staked
    pub staked_at: u64,
    /// Last reward claim block
    pub last_claim_block: u64,
    /// Reward index snapshot at stake time
    pub reward_index_snapshot: u128,
}

impl StakedZkUSD {
    pub fn new(owner: Address, amount: u64, block_height: u64, reward_index: u128) -> Self {
        Self {
            owner,
            staked_amount: amount,
            rewards_earned: 0,
            staked_at: block_height,
            last_claim_block: block_height,
            reward_index_snapshot: reward_index,
        }
    }

    /// Calculate pending rewards based on current index
    pub fn pending_rewards(&self, current_reward_index: u128) -> u64 {
        if current_reward_index <= self.reward_index_snapshot {
            return 0;
        }
        let delta = current_reward_index - self.reward_index_snapshot;
        ((self.staked_amount as u128 * delta) / 1_000_000_000_000_000_000) as u64
    }
}

/// Global staking pool state
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct StakingPool {
    /// Total zkUSD staked
    pub total_staked: u64,
    /// Total rewards distributed
    pub total_rewards_distributed: u64,
    /// Current reward index (scaled by 1e18)
    pub reward_index: u128,
    /// Number of stakers
    pub staker_count: u64,
    /// Accumulated fees pending distribution
    pub pending_fees: u64,
}

impl StakingPool {
    const SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

    pub fn new() -> Self {
        Self {
            total_staked: 0,
            total_rewards_distributed: 0,
            reward_index: 0,
            staker_count: 0,
            pending_fees: 0,
        }
    }

    /// Add fees to be distributed
    pub fn add_fees(&mut self, amount: u64) {
        self.pending_fees = self.pending_fees.saturating_add(amount);
    }

    /// Distribute pending fees to stakers
    pub fn distribute_fees(&mut self) {
        if self.total_staked == 0 || self.pending_fees == 0 {
            return;
        }
        let reward_per_token = (self.pending_fees as u128 * Self::SCALE) / self.total_staked as u128;
        self.reward_index = self.reward_index.saturating_add(reward_per_token);
        self.total_rewards_distributed = self.total_rewards_distributed.saturating_add(self.pending_fees);
        self.pending_fees = 0;
    }
}

// ============ NEW: Atomic Rescue Mechanism ============

/// Rescue offer - allows third parties to rescue underwater vaults
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct RescueOffer {
    /// Target vault to rescue
    pub vault_id: VaultId,
    /// Rescuer address
    pub rescuer: Address,
    /// BTC to add as collateral
    pub collateral_to_add: u64,
    /// zkUSD to repay as debt
    pub debt_to_repay: u64,
    /// Minimum ICR after rescue (rescuer's requirement)
    pub min_icr_after: u64,
    /// Bonus claimed on surplus (in basis points)
    pub surplus_bonus_bps: u64,
    /// Expiration block
    pub expires_at: u64,
    /// Whether offer was executed
    pub is_executed: bool,
}

impl RescueOffer {
    pub fn new(
        vault_id: VaultId,
        rescuer: Address,
        collateral_to_add: u64,
        debt_to_repay: u64,
        min_icr_after: u64,
        current_block: u64,
        validity_blocks: u64,
    ) -> Self {
        Self {
            vault_id,
            rescuer,
            collateral_to_add,
            debt_to_repay,
            min_icr_after,
            surplus_bonus_bps: 50, // 0.5% bonus on surplus
            expires_at: current_block.saturating_add(validity_blocks),
            is_executed: false,
        }
    }

    pub fn is_valid(&self, current_block: u64) -> bool {
        !self.is_executed && current_block < self.expires_at
    }
}

// ============ NEW: Batch Operations ============

/// Batch operation result
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct BatchResult {
    /// Number of successful operations
    pub successes: u32,
    /// Number of failed operations
    pub failures: u32,
    /// Total gas saved (estimated)
    pub gas_saved: u64,
    /// Individual results
    pub results: Vec<OperationResult>,
}

/// Individual operation result in a batch
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct OperationResult {
    /// Index in the batch
    pub index: u32,
    /// Whether operation succeeded
    pub success: bool,
    /// Error code if failed
    pub error_code: Option<u16>,
}

/// Batch deposit request for stability pool
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct BatchDeposit {
    /// Depositor address
    pub depositor: Address,
    /// Amount to deposit
    pub amount: u64,
}

/// Batch liquidation request
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct BatchLiquidation {
    /// Vaults to liquidate
    pub vault_ids: Vec<VaultId>,
    /// Maximum gas to spend
    pub max_gas: u64,
    /// Liquidator address
    pub liquidator: Address,
}

// ============ NEW: Fee Prediction ============

/// Fee estimate for a spell/operation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct FeeEstimate {
    /// Base transaction fee (satoshis)
    pub base_fee: u64,
    /// Protocol fee (zkUSD)
    pub protocol_fee: u64,
    /// Estimated ZK proof verification cost
    pub zk_verification_cost: u64,
    /// Total estimated cost
    pub total_cost: u64,
    /// Confidence level (0-100)
    pub confidence: u8,
    /// Whether this is an exact or estimated fee
    pub is_exact: bool,
}

impl FeeEstimate {
    /// Base cost per input (satoshis)
    const COST_PER_INPUT: u64 = 68;
    /// Base cost per output (satoshis)
    const COST_PER_OUTPUT: u64 = 34;
    /// Base transaction overhead
    const TX_OVERHEAD: u64 = 10;
    /// ZK proof size cost (approx)
    const ZK_PROOF_COST: u64 = 500;

    pub fn new(num_inputs: u32, num_outputs: u32, protocol_fee: u64) -> Self {
        let base_fee = Self::TX_OVERHEAD
            + (num_inputs as u64 * Self::COST_PER_INPUT)
            + (num_outputs as u64 * Self::COST_PER_OUTPUT);

        let zk_cost = Self::ZK_PROOF_COST;

        Self {
            base_fee,
            protocol_fee,
            zk_verification_cost: zk_cost,
            total_cost: base_fee + zk_cost,
            confidence: 95,
            is_exact: true,
        }
    }

    /// Estimate fee for opening a vault
    pub fn for_open_vault(debt: u64, base_rate: u64) -> Self {
        let borrowing_fee = (debt as u128 * base_rate as u128 / 10_000) as u64;
        Self::new(1, 2, borrowing_fee)
    }

    /// Estimate fee for liquidation
    pub fn for_liquidation(num_vaults: u32) -> Self {
        Self::new(num_vaults + 1, num_vaults * 2, 0)
    }

    /// Estimate fee for batch operation
    pub fn for_batch(num_operations: u32) -> Self {
        // Batching saves ~60% on per-operation overhead
        let individual_cost = num_operations as u64 * (Self::COST_PER_INPUT + Self::COST_PER_OUTPUT);
        let batched_cost = individual_cost * 40 / 100; // 60% savings

        Self {
            base_fee: Self::TX_OVERHEAD + batched_cost,
            protocol_fee: 0,
            zk_verification_cost: Self::ZK_PROOF_COST,
            total_cost: Self::TX_OVERHEAD + batched_cost + Self::ZK_PROOF_COST,
            confidence: 90,
            is_exact: false,
        }
    }
}

// ============ NEW: Redemption by Interest Rate ============

/// Redemption order - ordered by interest rate
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct RedemptionOrder {
    /// Vault ID
    pub vault_id: VaultId,
    /// Interest rate (for ordering)
    pub interest_rate_bps: u64,
    /// Maximum zkUSD to redeem from this vault
    pub max_redeemable: u64,
    /// BTC to receive per zkUSD
    pub btc_per_zkusd: u64,
}

/// Redemption batch - processes multiple vaults in interest rate order
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct RedemptionBatch {
    /// Ordered list of vaults (by interest rate ascending)
    pub orders: Vec<RedemptionOrder>,
    /// Total zkUSD to redeem
    pub total_zkusd: u64,
    /// Total BTC to receive
    pub total_btc: u64,
    /// Fixed redemption fee (0.75%)
    pub fee: u64,
    /// Redeemer address
    pub redeemer: Address,
}

impl RedemptionBatch {
    pub fn new(redeemer: Address) -> Self {
        Self {
            orders: Vec::new(),
            total_zkusd: 0,
            total_btc: 0,
            fee: 0,
            redeemer,
        }
    }

    /// Add vault to redemption batch (maintains sorted order)
    pub fn add_vault(&mut self, order: RedemptionOrder) {
        // Insert in sorted order by interest_rate_bps
        let pos = self.orders.iter()
            .position(|o| o.interest_rate_bps > order.interest_rate_bps)
            .unwrap_or(self.orders.len());
        self.orders.insert(pos, order);
    }

    /// Calculate redemption amounts
    pub fn calculate(&mut self, zkusd_to_redeem: u64, btc_price: u64) {
        let mut remaining = zkusd_to_redeem;
        self.total_btc = 0;

        for order in &mut self.orders {
            if remaining == 0 {
                break;
            }
            let to_redeem = remaining.min(order.max_redeemable);
            let btc_amount = (to_redeem as u128 * 100_000_000 / btc_price as u128) as u64;
            order.btc_per_zkusd = btc_amount;
            self.total_btc = self.total_btc.saturating_add(btc_amount);
            remaining = remaining.saturating_sub(to_redeem);
        }

        self.total_zkusd = zkusd_to_redeem - remaining;
        // Fixed 0.75% fee
        self.fee = self.total_zkusd * 75 / 10_000;
    }
}

// ============ NEW: Insurance Charm (Enhanced) ============

/// Insurance Charm - tradeable insurance token
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct InsuranceCharm {
    /// Unique charm ID
    pub charm_id: [u8; 32],
    /// Vault it protects
    pub vault_id: VaultId,
    /// Current owner (can be transferred)
    pub owner: Address,
    /// BTC coverage amount
    pub coverage_btc: u64,
    /// Grace period in blocks after trigger
    pub grace_blocks: u64,
    /// ICR trigger threshold (e.g., 105 = 105%)
    pub trigger_icr: u64,
    /// Premium paid for this charm
    pub premium_paid: u64,
    /// Block when coverage expires
    pub expires_at: u64,
    /// Whether charm has been triggered
    pub is_triggered: bool,
    /// Block when triggered (if applicable)
    pub triggered_at: u64,
}

impl InsuranceCharm {
    pub fn new(
        charm_id: [u8; 32],
        vault_id: VaultId,
        owner: Address,
        coverage_btc: u64,
        premium_paid: u64,
        trigger_icr: u64,
        grace_blocks: u64,
        current_block: u64,
        duration_blocks: u64,
    ) -> Self {
        Self {
            charm_id,
            vault_id,
            owner,
            coverage_btc,
            grace_blocks,
            trigger_icr,
            premium_paid,
            expires_at: current_block.saturating_add(duration_blocks),
            is_triggered: false,
            triggered_at: 0,
        }
    }

    /// Check if charm is active and valid
    pub fn is_active(&self, current_block: u64) -> bool {
        !self.is_triggered && current_block < self.expires_at
    }

    /// Check if in grace period
    pub fn is_in_grace_period(&self, current_block: u64) -> bool {
        self.is_triggered && current_block < self.triggered_at.saturating_add(self.grace_blocks)
    }

    /// Check if charm should trigger based on ICR and block
    pub fn should_trigger(&self, current_icr: u64, current_block: u64) -> bool {
        self.is_active(current_block) && current_icr <= self.trigger_icr
    }

    /// Trigger the insurance charm
    pub fn trigger(&mut self, current_block: u64) -> bool {
        if self.is_active(current_block) {
            self.is_triggered = true;
            self.triggered_at = current_block;
            true
        } else {
            false
        }
    }

    /// Calculate premium for given coverage
    pub fn calculate_premium(coverage_btc: u64, duration_blocks: u64, trigger_icr: u64) -> u64 {
        // Base: 1% of coverage per year
        // Adjusted by trigger ICR (lower trigger = more expensive)
        const BLOCKS_PER_YEAR: u64 = 52_560;
        const BASE_PREMIUM_BPS: u64 = 100; // 1%

        let base = (coverage_btc as u128 * BASE_PREMIUM_BPS as u128 * duration_blocks as u128)
            / (BLOCKS_PER_YEAR as u128 * 10_000);

        // Adjust for trigger ICR (105% trigger is 50% more expensive than 110% trigger)
        let icr_multiplier = if trigger_icr < 110 {
            150 + (110 - trigger_icr) * 10
        } else {
            100
        };

        (base * icr_multiplier as u128 / 100) as u64
    }
}

// ============ Spell Input/Output Types ============

/// Represents a charm (asset) in a UTXO
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Charm {
    /// App ID that owns this charm
    pub app_id: AppId,
    /// Charm data (serialized state)
    pub data: Vec<u8>,
}

/// Input to a spell
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct SpellInput {
    /// UTXO being spent
    pub utxo_id: TxId,
    /// Output index
    pub vout: u32,
    /// Charms attached to this input
    pub charms: Vec<Charm>,
    /// BTC amount in satoshis
    pub btc_amount: u64,
}

/// Output from a spell
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct SpellOutput {
    /// Recipient address
    pub address: Address,
    /// Charms to create
    pub charms: Vec<Charm>,
    /// BTC amount in satoshis
    pub btc_amount: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_creation() {
        let vault = Vault::new(
            [1u8; 32],
            [2u8; 32],
            100_000_000,  // 1 BTC
            50_000_00000000, // 50,000 zkUSD
            100,
        );

        assert!(vault.is_active());
        assert_eq!(vault.owner, [2u8; 32]);
        assert_eq!(vault.collateral, 100_000_000);
    }

    #[test]
    fn test_price_staleness() {
        let price = PriceData::new(100_000_00000000, 100, PriceSource::Mock);

        assert!(!price.is_stale(103)); // 3 blocks old, ok
        assert!(price.is_stale(110));  // 10 blocks old, stale
    }
}
