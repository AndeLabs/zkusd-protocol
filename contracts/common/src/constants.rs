//! Protocol Constants
//!
//! All magic numbers and configuration values for zkUSD protocol.
//! These values are carefully chosen based on Liquity's battle-tested parameters.
//!
//! # Network Configuration
//!
//! Use feature flags to compile for different networks:
//! - `mainnet` - Production values (higher minimums, proper gas compensation)
//! - Default (no feature) - Testnet values (lower minimums for testing)
//!
//! ```toml
//! # For mainnet deployment:
//! zkusd-common = { path = "...", features = ["mainnet"] }
//! ```

/// Token Metadata
pub mod token {
    /// Token name
    pub const NAME: &str = "zkUSD";
    /// Token symbol
    pub const SYMBOL: &str = "zkUSD";
    /// Decimal places (same as Bitcoin satoshis)
    pub const DECIMALS: u8 = 8;
    /// One unit with decimals (1 zkUSD = 100_000_000 base units)
    pub const ONE: u64 = 100_000_000;
}

/// Collateralization Ratios (in percentage points, e.g., 110 = 110%)
pub mod ratios {
    /// Minimum Collateral Ratio - below this, vault can be liquidated
    /// 110% means $110 of BTC collateral for every $100 of zkUSD debt
    pub const MCR: u64 = 110;

    /// Critical Collateral Ratio - system enters Recovery Mode below this
    /// 150% provides buffer before system-wide stress
    pub const CCR: u64 = 150;

    /// Recommended minimum ratio for users (safety buffer)
    pub const RECOMMENDED_MIN: u64 = 200;

    /// Maximum LTV (Loan-to-Value) = 100/MCR = ~90.9%
    pub const MAX_LTV: u64 = 90;
}

/// Fee Configuration (in basis points, 100 = 1%)
pub mod fees {
    /// Minimum borrowing fee (0.5%)
    pub const MIN_BORROWING_FEE_BPS: u64 = 50;

    /// Maximum borrowing fee (5%)
    pub const MAX_BORROWING_FEE_BPS: u64 = 500;

    /// Redemption fee floor (0.5%)
    pub const REDEMPTION_FEE_FLOOR_BPS: u64 = 50;

    /// Fixed redemption fee (0.75% like Mezo)
    pub const REDEMPTION_FEE_FIXED_BPS: u64 = 75;

    /// Basis points denominator
    pub const BPS_DENOMINATOR: u64 = 10_000;

    // ===== NEW: Fixed Interest Rate System (Mezo-inspired) =====

    /// Default interest rate for new vaults (1% APR)
    pub const DEFAULT_INTEREST_RATE_BPS: u64 = 100;

    /// Minimum interest rate (0.5% APR)
    pub const MIN_INTEREST_RATE_BPS: u64 = 50;

    /// Maximum interest rate (5% APR)
    pub const MAX_INTEREST_RATE_BPS: u64 = 500;

    /// Refinancing fee (percentage of borrowing fee)
    pub const REFINANCING_FEE_PERCENT: u64 = 50; // 50% of issuance fee

    // ===== NEW: Insurance System =====

    /// Insurance premium rate (1% of coverage per year)
    pub const INSURANCE_PREMIUM_RATE_BPS: u64 = 100;

    /// Minimum insurance coverage (0.01 BTC)
    pub const MIN_INSURANCE_COVERAGE: u64 = 1_000_000; // satoshis

    /// Maximum insurance duration (52,560 blocks ~ 1 year)
    pub const MAX_INSURANCE_DURATION_BLOCKS: u64 = 52_560;
}

/// Debt Limits
///
/// Values differ between mainnet and testnet to allow easier testing.
pub mod limits {
    use super::token::ONE;

    /// Minimum debt to open a vault
    /// - Mainnet: 2,000 zkUSD (ensures liquidation profitability)
    /// - Testnet: 10 zkUSD (allows testing with faucet BTC)
    #[cfg(feature = "mainnet")]
    pub const MIN_DEBT: u64 = 2_000 * ONE;
    #[cfg(not(feature = "mainnet"))]
    pub const MIN_DEBT: u64 = 10 * ONE;

    /// Liquidation reserve - gas compensation for liquidators
    /// - Mainnet: 200 zkUSD (covers real gas costs)
    /// - Testnet: 2 zkUSD (reduced for testing)
    #[cfg(feature = "mainnet")]
    pub const LIQUIDATION_RESERVE: u64 = 200 * ONE;
    #[cfg(not(feature = "mainnet"))]
    pub const LIQUIDATION_RESERVE: u64 = 2 * ONE;

    /// Maximum debt per vault (prevents concentration risk)
    pub const MAX_DEBT_PER_VAULT: u64 = 10_000_000 * ONE; // 10M zkUSD

    /// Helper to check if running in mainnet mode
    #[cfg(feature = "mainnet")]
    pub const IS_MAINNET: bool = true;
    #[cfg(not(feature = "mainnet"))]
    pub const IS_MAINNET: bool = false;
}

/// Oracle Configuration
pub mod oracle {
    /// Maximum price age in blocks before considered stale
    pub const MAX_PRICE_AGE_BLOCKS: u64 = 6; // ~1 hour at 10 min blocks

    /// Maximum allowed price deviation per update (5%)
    pub const MAX_PRICE_DEVIATION_BPS: u64 = 500;

    /// Price precision (8 decimals like BTC)
    pub const PRICE_DECIMALS: u8 = 8;
}

/// Stability Pool Configuration
pub mod stability_pool {
    /// Scale factor for precision in reward calculations
    pub const SCALE_FACTOR: u128 = 1_000_000_000_000_000_000; // 1e18

    /// Minimum deposit to earn rewards
    /// - Mainnet: 100 zkUSD (meaningful participation)
    /// - Testnet: 1 zkUSD (allows testing with small amounts)
    #[cfg(feature = "mainnet")]
    pub const MIN_DEPOSIT: u64 = 100 * super::token::ONE;
    #[cfg(not(feature = "mainnet"))]
    pub const MIN_DEPOSIT: u64 = 1 * super::token::ONE;
}

/// Liquidation Configuration
pub mod liquidation {
    /// Collateral bonus for liquidators (0.5% of liquidated collateral)
    pub const LIQUIDATOR_BONUS_BPS: u64 = 50;

    /// Gas compensation percentage from collateral (0.5%)
    pub const GAS_COMP_BPS: u64 = 50;

    /// Maximum batch liquidation size
    pub const MAX_BATCH_SIZE: usize = 10;
}

/// Time-related constants
pub mod time {
    /// Blocks per day (assuming 10 min blocks)
    pub const BLOCKS_PER_DAY: u64 = 144;

    /// Blocks per hour
    pub const BLOCKS_PER_HOUR: u64 = 6;

    /// Base rate decay half-life in blocks (~12 hours)
    pub const BASE_RATE_DECAY_HALFLIFE: u64 = 72;
}

/// Precision constants
pub mod precision {
    /// Percentage precision (100 = 100%)
    pub const PERCENT_PRECISION: u64 = 100;

    /// High precision for internal calculations
    pub const DECIMAL_PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18
}

// ===== NEW: Protocol Controlled Value (PCV) Configuration =====

/// PCV Configuration
pub mod pcv {
    use super::token::ONE;

    /// Bootstrap loan amount (15M zkUSD like Mezo)
    pub const BOOTSTRAP_LOAN: u64 = 15_000_000 * ONE;

    /// Maximum gauge allocation while bootstrap not repaid (50%)
    pub const MAX_GAUGE_ALLOCATION_BPS: u64 = 5_000;

    /// Target stability pool coverage ratio (60%)
    pub const TARGET_SP_COVERAGE_BPS: u64 = 6_000;
}

/// Gas Pool Configuration
pub mod gas_pool {
    use super::token::ONE;

    /// Gas compensation per liquidation
    /// - Mainnet: 200 zkUSD (covers real gas costs + incentive)
    /// - Testnet: 2 zkUSD (reduced for testing)
    #[cfg(feature = "mainnet")]
    pub const GAS_COMPENSATION: u64 = 200 * ONE;
    #[cfg(not(feature = "mainnet"))]
    pub const GAS_COMPENSATION: u64 = 2 * ONE;

    /// Gas buffer added to each vault at opening
    /// - Mainnet: 200 zkUSD (matches gas compensation)
    /// - Testnet: 2 zkUSD (reduced for testing)
    #[cfg(feature = "mainnet")]
    pub const VAULT_GAS_BUFFER: u64 = 200 * ONE;
    #[cfg(not(feature = "mainnet"))]
    pub const VAULT_GAS_BUFFER: u64 = 2 * ONE;
}

/// Redistribution Configuration
pub mod redistribution {
    /// Liquidation penalty in normal mode (5% of debt)
    pub const LIQUIDATION_PENALTY_BPS: u64 = 500;

    /// Liquidation penalty in recovery mode for ETH-like collateral (10%)
    pub const LIQUIDATION_PENALTY_RM_BPS: u64 = 1_000;

    /// Minimum collateral share to receive redistribution
    pub const MIN_REDISTRIBUTION_SHARE_BPS: u64 = 1; // 0.01%
}

/// Surplus Collateral Configuration
pub mod surplus {
    /// Blocks before unclaimed surplus can be swept to PCV
    pub const CLAIM_DEADLINE_BLOCKS: u64 = 52_560; // ~1 year

    /// Minimum surplus amount worth claiming
    pub const MIN_SURPLUS_AMOUNT: u64 = 10_000; // 0.0001 BTC
}
