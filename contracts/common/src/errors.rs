//! Error Types for zkUSD Protocol
//!
//! Inspired by Soroban's error handling patterns, these typed errors
//! provide clear feedback for debugging and better UX.

/// Result type alias for zkUSD operations
pub type ZkUsdResult<T> = Result<T, ZkUsdError>;

/// Main error enum for all zkUSD protocol errors
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZkUsdError {
    // ============ Vault Errors ============
    /// Vault not found with given ID
    VaultNotFound { vault_id: [u8; 32] },

    /// Vault is undercollateralized
    Undercollateralized {
        current_ratio: u64,
        required_ratio: u64,
    },

    /// Vault already exists
    VaultAlreadyExists { vault_id: [u8; 32] },

    /// Vault is not active
    VaultNotActive { vault_id: [u8; 32] },

    /// Cannot close vault with remaining debt
    VaultHasDebt { remaining_debt: u64 },

    // ============ Amount Errors ============
    /// Invalid amount provided
    InvalidAmount { amount: u64, reason: AmountErrorReason },

    /// Insufficient balance for operation
    InsufficientBalance { available: u64, requested: u64 },

    /// Amount below minimum threshold
    BelowMinimum { amount: u64, minimum: u64 },

    /// Amount exceeds maximum allowed
    ExceedsMaximum { amount: u64, maximum: u64 },

    /// Zero amount not allowed
    ZeroAmount,

    // ============ Authorization Errors ============
    /// Caller is not authorized for this operation
    Unauthorized { expected: [u8; 32], actual: [u8; 32] },

    /// Missing required signature
    MissingSignature,

    /// Invalid signature provided
    InvalidSignature,

    /// Only protocol admin can perform this action
    AdminOnly,

    // ============ Oracle Errors ============
    /// Oracle price is stale
    OracleStale {
        last_update_block: u64,
        current_block: u64,
        max_age: u64,
    },

    /// Oracle price deviation too large
    OraclePriceDeviation {
        old_price: u64,
        new_price: u64,
        max_deviation_bps: u64,
    },

    /// Oracle not initialized
    OracleNotInitialized,

    /// Invalid oracle source
    InvalidOracleSource,

    // ============ Recovery Mode Errors ============
    /// Operation not allowed in Recovery Mode
    RecoveryModeRestriction { operation: RecoveryModeOp },

    /// Cannot worsen system TCR in Recovery Mode
    WouldWorsenTCR { current_tcr: u64, new_tcr: u64 },

    // ============ Stability Pool Errors ============
    /// Insufficient balance in Stability Pool
    InsufficientPoolBalance { available: u64, required: u64 },

    /// Deposit not found for user
    DepositNotFound { user: [u8; 32] },

    /// No rewards to claim
    NoRewardsToClaim,

    // ============ Liquidation Errors ============
    /// Vault is not liquidatable
    NotLiquidatable { vault_id: [u8; 32], icr: u64 },

    /// Nothing to liquidate (empty or already liquidated)
    NothingToLiquidate,

    /// Liquidation would leave dust
    LiquidationDust { remaining: u64, minimum: u64 },

    /// No vaults in batch are liquidatable
    NoLiquidatableVaults,

    /// Surplus claim not found
    SurplusNotFound { owner: [u8; 32] },

    /// Insurance policy not found or expired
    InsuranceNotFound { vault_id: [u8; 32] },

    /// Insurance coverage insufficient
    InsufficientInsurance { available: u64, needed: u64 },

    // ============ Token Errors ============
    /// Token transfer failed
    TransferFailed { from: [u8; 32], to: [u8; 32], amount: u64 },

    /// Mint not authorized
    MintUnauthorized { caller: [u8; 32] },

    /// Burn not authorized
    BurnUnauthorized { caller: [u8; 32] },

    /// Token conservation violated (inputs != outputs)
    ConservationViolated { inputs: u64, outputs: u64 },

    // ============ Math Errors ============
    /// Arithmetic overflow occurred
    Overflow,

    /// Arithmetic underflow occurred
    Underflow,

    /// Division by zero
    DivisionByZero,

    // ============ Input Validation Errors ============
    /// Invalid input parameter
    InvalidInput { param: &'static str, reason: &'static str },

    /// Invalid UTXO reference
    InvalidUtxo,

    /// Invalid spell format
    InvalidSpellFormat,

    // ============ State Errors ============
    /// Protocol is paused
    ProtocolPaused,

    /// Invalid state transition
    InvalidStateTransition,

    /// State not found
    StateNotFound,

    // ============ Leverage Errors ============
    /// Leverage exceeds maximum allowed
    ExcessiveLeverage,

    /// Required condition not met
    ConditionNotMet,

    /// Insufficient collateral ratio for operation
    InsufficientCollateralRatio,

    /// Invalid operation for current state
    InvalidOperation,

    /// Invalid parameter value
    InvalidParameter,

    /// Math overflow during calculation
    MathOverflow,

    /// Insufficient collateral for operation
    InsufficientCollateral,

    // ============ Flash Mint Errors ============
    /// Flash mint not fully repaid
    FlashMintNotRepaid { outstanding: u64, repaid: u64 },

    /// Flash mint exceeds maximum
    FlashMintExceedsMax { requested: u64, maximum: u64 },

    /// Nested flash mint not allowed
    NestedFlashMint,

    /// Flash mint below minimum
    FlashMintBelowMin { requested: u64, minimum: u64 },

    /// Flash callback failed
    FlashCallbackFailed,

    /// Arbitrage not profitable
    ArbitrageNotProfitable { expected_profit: i64 },

    // ============ Advanced Operation Errors ============

    /// Vault not eligible for rescue (ICR too high)
    VaultNotEligibleForRescue { vault_id: [u8; 32], icr: u64 },

    /// Vault has no insurance coverage
    NoInsurance { vault_id: [u8; 32] },

    /// Insurance cannot be triggered yet
    InsuranceNotTriggerable {
        vault_id: [u8; 32],
        current_icr: u64,
        trigger_icr: u64,
    },

    /// Invalid insurance parameters
    InvalidInsuranceParams,

    /// Invalid address (e.g., zero address)
    InvalidAddress {
        /// Description of why the address is invalid
        reason: &'static str,
    },
}

/// Reasons for amount-related errors
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmountErrorReason {
    /// Negative amount (shouldn't happen with u64, but for completeness)
    Negative,
    /// Amount is zero when non-zero required
    Zero,
    /// Amount exceeds maximum
    TooLarge,
    /// Amount below minimum
    TooSmall,
    /// Amount doesn't match expected
    Mismatch,
}

/// Operations restricted during Recovery Mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryModeOp {
    /// Opening a new vault
    OpenVault,
    /// Withdrawing collateral
    WithdrawCollateral,
    /// Minting additional debt
    MintDebt,
    /// Closing the last vault
    CloseLastVault,
}

impl ZkUsdError {
    /// Returns a human-readable error code for logging/debugging
    pub fn code(&self) -> &'static str {
        match self {
            Self::VaultNotFound { .. } => "E001_VAULT_NOT_FOUND",
            Self::Undercollateralized { .. } => "E002_UNDERCOLLATERALIZED",
            Self::VaultAlreadyExists { .. } => "E003_VAULT_EXISTS",
            Self::VaultNotActive { .. } => "E004_VAULT_INACTIVE",
            Self::VaultHasDebt { .. } => "E005_VAULT_HAS_DEBT",
            Self::InvalidAmount { .. } => "E010_INVALID_AMOUNT",
            Self::InsufficientBalance { .. } => "E011_INSUFFICIENT_BALANCE",
            Self::BelowMinimum { .. } => "E012_BELOW_MINIMUM",
            Self::ExceedsMaximum { .. } => "E013_EXCEEDS_MAXIMUM",
            Self::ZeroAmount => "E014_ZERO_AMOUNT",
            Self::Unauthorized { .. } => "E020_UNAUTHORIZED",
            Self::MissingSignature => "E021_MISSING_SIGNATURE",
            Self::InvalidSignature => "E022_INVALID_SIGNATURE",
            Self::AdminOnly => "E023_ADMIN_ONLY",
            Self::OracleStale { .. } => "E030_ORACLE_STALE",
            Self::OraclePriceDeviation { .. } => "E031_ORACLE_DEVIATION",
            Self::OracleNotInitialized => "E032_ORACLE_NOT_INIT",
            Self::InvalidOracleSource => "E033_INVALID_ORACLE",
            Self::RecoveryModeRestriction { .. } => "E040_RECOVERY_MODE",
            Self::WouldWorsenTCR { .. } => "E041_WORSEN_TCR",
            Self::InsufficientPoolBalance { .. } => "E050_POOL_INSUFFICIENT",
            Self::DepositNotFound { .. } => "E051_DEPOSIT_NOT_FOUND",
            Self::NoRewardsToClaim => "E052_NO_REWARDS",
            Self::NotLiquidatable { .. } => "E060_NOT_LIQUIDATABLE",
            Self::NothingToLiquidate => "E061_NOTHING_TO_LIQ",
            Self::LiquidationDust { .. } => "E062_LIQ_DUST",
            Self::NoLiquidatableVaults => "E063_NO_LIQ_VAULTS",
            Self::SurplusNotFound { .. } => "E064_SURPLUS_NOT_FOUND",
            Self::InsuranceNotFound { .. } => "E065_INS_NOT_FOUND",
            Self::InsufficientInsurance { .. } => "E066_INS_INSUFFICIENT",
            Self::TransferFailed { .. } => "E070_TRANSFER_FAILED",
            Self::MintUnauthorized { .. } => "E071_MINT_UNAUTH",
            Self::BurnUnauthorized { .. } => "E072_BURN_UNAUTH",
            Self::ConservationViolated { .. } => "E073_CONSERVATION",
            Self::Overflow => "E080_OVERFLOW",
            Self::Underflow => "E081_UNDERFLOW",
            Self::DivisionByZero => "E082_DIV_ZERO",
            Self::InvalidInput { .. } => "E090_INVALID_INPUT",
            Self::InvalidUtxo => "E091_INVALID_UTXO",
            Self::InvalidSpellFormat => "E092_INVALID_SPELL",
            Self::ProtocolPaused => "E100_PAUSED",
            Self::InvalidStateTransition => "E101_INVALID_STATE",
            Self::StateNotFound => "E102_STATE_NOT_FOUND",
            Self::ExcessiveLeverage => "E110_EXCESSIVE_LEVERAGE",
            Self::ConditionNotMet => "E111_CONDITION_NOT_MET",
            Self::InsufficientCollateralRatio => "E112_INSUFFICIENT_CR",
            Self::InvalidOperation => "E113_INVALID_OP",
            Self::InvalidParameter => "E114_INVALID_PARAM",
            Self::MathOverflow => "E115_MATH_OVERFLOW",
            Self::InsufficientCollateral => "E116_INSUFFICIENT_COLL",
            Self::FlashMintNotRepaid { .. } => "E120_FLASH_NOT_REPAID",
            Self::FlashMintExceedsMax { .. } => "E121_FLASH_EXCEEDS_MAX",
            Self::NestedFlashMint => "E122_NESTED_FLASH",
            Self::FlashMintBelowMin { .. } => "E123_FLASH_BELOW_MIN",
            Self::FlashCallbackFailed => "E124_FLASH_CALLBACK_FAIL",
            Self::ArbitrageNotProfitable { .. } => "E125_ARB_NOT_PROFITABLE",
            Self::VaultNotEligibleForRescue { .. } => "E130_NOT_RESCUE_ELIGIBLE",
            Self::NoInsurance { .. } => "E131_NO_INSURANCE",
            Self::InsuranceNotTriggerable { .. } => "E132_INS_NOT_TRIGGERABLE",
            Self::InvalidInsuranceParams => "E133_INVALID_INS_PARAMS",
            Self::InvalidAddress { .. } => "E134_INVALID_ADDRESS",
        }
    }

    /// Returns true if this error is recoverable (user can fix it)
    pub fn is_recoverable(&self) -> bool {
        match self {
            Self::Undercollateralized { .. } => true, // Add more collateral
            Self::InsufficientBalance { .. } => true, // Get more funds
            Self::BelowMinimum { .. } => true,        // Increase amount
            Self::OracleStale { .. } => true,         // Wait for update
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn test_error_codes_unique() {
        // Ensure all error codes are unique
        let errors = [
            ZkUsdError::VaultNotFound { vault_id: [0u8; 32] },
            ZkUsdError::Undercollateralized {
                current_ratio: 100,
                required_ratio: 110,
            },
            ZkUsdError::ZeroAmount,
            ZkUsdError::Overflow,
        ];

        let codes: Vec<_> = errors.iter().map(|e| e.code()).collect();
        let unique: BTreeSet<_> = codes.iter().collect();
        assert_eq!(codes.len(), unique.len(), "Error codes must be unique");
    }
}
