//! Price Oracle Contract
//!
//! Provides BTC/USD price feed for the zkUSD protocol.
//! In MVP, uses a trusted operator model. In production,
//! would integrate with decentralized oracles.
//!
//! ## Reference Input Pattern (UTXO Model)
//!
//! The oracle charm is used as a **reference input** by other apps:
//! - Not consumed when read (can be referenced by multiple transactions)
//! - Only operator can spend and update the oracle charm
//! - Price freshness verified via block height comparison

use borsh::{BorshDeserialize, BorshSerialize};

// Charms SDK integration (conditional compilation)
#[cfg(feature = "charms")]
pub mod charms;
use serde::{Deserialize, Serialize};

use zkusd_common::{
    constants::oracle::MAX_PRICE_DEVIATION_BPS,
    errors::{ZkUsdError, ZkUsdResult},
    events::{EventLog, ZkUsdEvent},
    types::{Address, OracleAction, PriceData, PriceSource},
};

// ============ Oracle State ============

/// Oracle contract state
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct OracleState {
    /// Current price data
    pub price: PriceData,
    /// Authorized operator (can update price)
    pub operator: Address,
    /// Admin (can change operator)
    pub admin: Address,
    /// Whether oracle is active
    pub is_active: bool,
    /// Last valid price (fallback)
    pub last_valid_price: u64,
}

impl OracleState {
    /// Create new oracle state with initial price
    pub fn new(admin: Address, operator: Address, initial_price: u64, block_height: u64) -> Self {
        Self {
            price: PriceData::new(initial_price, block_height, PriceSource::Mock),
            operator,
            admin,
            is_active: true,
            last_valid_price: initial_price,
        }
    }

    /// Default price for testing ($100,000)
    pub const DEFAULT_BTC_PRICE: u64 = 100_000_00000000;
}

impl Default for OracleState {
    fn default() -> Self {
        Self {
            price: PriceData::new(Self::DEFAULT_BTC_PRICE, 0, PriceSource::Mock),
            operator: [0u8; 32],
            admin: [0u8; 32],
            is_active: true,
            last_valid_price: Self::DEFAULT_BTC_PRICE,
        }
    }
}

// ============ Validation Context ============

/// Context for validating oracle operations
pub struct OracleContext {
    /// Current oracle state
    pub state: OracleState,
    /// Updated oracle state
    pub new_state: OracleState,
    /// Signer address
    pub signer: Address,
    /// Current block height
    pub block_height: u64,
    /// Event log
    pub events: EventLog,
}

// ============ Validation Functions ============

/// Main validation entry point
pub fn validate(ctx: &mut OracleContext, action: &OracleAction) -> ZkUsdResult<()> {
    match action {
        OracleAction::Initialize { .. } => {
            // Initialize is handled directly in charms.rs validate_oracle_operation
            // as it doesn't require an input state context
            Ok(())
        }
        OracleAction::UpdatePrice { price } => validate_update_price(ctx, *price),
        OracleAction::SetOperator { operator } => validate_set_operator(ctx, operator),
    }
}

/// Validate price update
fn validate_update_price(ctx: &mut OracleContext, new_price: u64) -> ZkUsdResult<()> {
    // 1. Only operator can update price
    if ctx.signer != ctx.state.operator {
        return Err(ZkUsdError::Unauthorized {
            expected: ctx.state.operator,
            actual: ctx.signer,
        });
    }

    // 2. Oracle must be active
    if !ctx.state.is_active {
        return Err(ZkUsdError::InvalidOracleSource);
    }

    // 3. Price must be positive
    if new_price == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 3b. Price must be within reasonable range ($1,000 - $10,000,000)
    if !validate_price_format(new_price) {
        return Err(ZkUsdError::InvalidInput {
            param: "price",
            reason: "outside reasonable range ($1k - $10M)",
        });
    }

    // 4. Check price deviation (prevent manipulation)
    let old_price = ctx.state.price.price;
    let deviation = calculate_price_deviation(old_price, new_price);

    if deviation > MAX_PRICE_DEVIATION_BPS {
        return Err(ZkUsdError::OraclePriceDeviation {
            old_price,
            new_price,
            max_deviation_bps: MAX_PRICE_DEVIATION_BPS,
        });
    }

    // 5. Verify new state
    if ctx.new_state.price.price != new_price {
        return Err(ZkUsdError::InvalidStateTransition);
    }
    if ctx.new_state.price.timestamp_block != ctx.block_height {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 6. Update last valid price
    if ctx.new_state.last_valid_price != new_price {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 7. Emit event
    ctx.events.emit(ZkUsdEvent::PriceUpdated {
        old_price,
        new_price,
        source: ctx.state.price.source as u8,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate operator change
fn validate_set_operator(ctx: &mut OracleContext, new_operator: &Address) -> ZkUsdResult<()> {
    // 1. Only admin can change operator
    if ctx.signer != ctx.state.admin {
        return Err(ZkUsdError::AdminOnly);
    }

    // 2. New operator must be different
    if *new_operator == ctx.state.operator {
        return Err(ZkUsdError::InvalidInput {
            param: "operator",
            reason: "same as current",
        });
    }

    // 3. Verify new state
    if ctx.new_state.operator != *new_operator {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 4. Emit event
    ctx.events.emit(ZkUsdEvent::OracleOperatorChanged {
        old_operator: ctx.state.operator,
        new_operator: *new_operator,
        block_height: ctx.block_height,
    });

    Ok(())
}

// ============ Query Functions ============

/// Get current BTC price
///
/// Returns an error if the price is stale to prevent using outdated prices
/// for critical operations like liquidations.
///
/// # Errors
/// - `OracleNotInitialized` if oracle is not active
/// - `OracleStale` if price exceeds MAX_PRICE_AGE_BLOCKS
pub fn get_price(state: &OracleState, current_block: u64) -> ZkUsdResult<u64> {
    // Check if oracle is active
    if !state.is_active {
        return Err(ZkUsdError::OracleNotInitialized);
    }

    // Check if price is stale - MUST error in production to prevent
    // using outdated prices for liquidations/redemptions
    if state.price.is_stale(current_block) {
        return Err(ZkUsdError::OracleStale {
            last_update_block: state.price.timestamp_block,
            current_block,
            max_age: zkusd_common::constants::oracle::MAX_PRICE_AGE_BLOCKS,
        });
    }

    Ok(state.price.price)
}

/// Get price with fallback for read-only queries (NOT for transactions)
///
/// This function can return stale prices and should ONLY be used for
/// display/informational purposes, never for validation logic.
pub fn get_price_for_display(state: &OracleState, current_block: u64) -> (u64, bool) {
    let is_stale = state.price.is_stale(current_block);
    let price = if is_stale {
        state.last_valid_price
    } else {
        state.price.price
    };
    (price, is_stale)
}

/// Check if price is fresh (not stale)
pub fn is_price_fresh(state: &OracleState, current_block: u64) -> bool {
    state.is_active && !state.price.is_stale(current_block)
}

// ============ Helper Functions ============

/// Calculate price deviation in basis points
///
/// Returns the percentage deviation between old and new price in basis points.
/// 100 bps = 1%, 10000 bps = 100%
fn calculate_price_deviation(old_price: u64, new_price: u64) -> u64 {
    if old_price == 0 {
        return 10000; // 100% if no previous price
    }

    let diff = if new_price > old_price {
        new_price - old_price
    } else {
        old_price - new_price
    };

    // deviation_bps = (diff * 10000) / old_price
    // Safe: diff <= max(old, new), so diff * 10000 won't overflow u128
    // Result is capped at u64::MAX for safety
    let deviation = (diff as u128 * 10000) / old_price as u128;
    deviation.min(u64::MAX as u128) as u64
}

/// Validate price format (8 decimals)
pub fn validate_price_format(price: u64) -> bool {
    // Price should be reasonable ($1,000 - $10,000,000)
    const MIN_REASONABLE_PRICE: u64 = 1_000_00000000;      // $1,000
    const MAX_REASONABLE_PRICE: u64 = 10_000_000_00000000; // $10,000,000

    price >= MIN_REASONABLE_PRICE && price <= MAX_REASONABLE_PRICE
}

/// Convert price to different decimal precision
pub fn convert_price_decimals(price: u64, from_decimals: u8, to_decimals: u8) -> u64 {
    if from_decimals == to_decimals {
        return price;
    }

    if from_decimals > to_decimals {
        let divisor = 10u64.pow((from_decimals - to_decimals) as u32);
        price / divisor
    } else {
        let multiplier = 10u64.pow((to_decimals - from_decimals) as u32);
        price.saturating_mul(multiplier)
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    const BTC_PRICE_100K: u64 = 100_000_00000000;

    fn create_test_context() -> OracleContext {
        let admin = [0u8; 32];
        let operator = [1u8; 32];

        OracleContext {
            state: OracleState::new(admin, operator, BTC_PRICE_100K, 100),
            new_state: OracleState::new(admin, operator, BTC_PRICE_100K, 100),
            signer: operator,
            block_height: 101,
            events: EventLog::new(),
        }
    }

    #[test]
    fn test_update_price_success() {
        let mut ctx = create_test_context();
        let new_price = 101_000_00000000; // $101,000 (1% increase)

        ctx.new_state.price.price = new_price;
        ctx.new_state.price.timestamp_block = ctx.block_height;
        ctx.new_state.last_valid_price = new_price;

        let action = OracleAction::UpdatePrice { price: new_price };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok(), "Should succeed: {:?}", result);
        assert_eq!(ctx.events.len(), 1);
    }

    #[test]
    fn test_update_price_too_large_deviation() {
        let mut ctx = create_test_context();
        let new_price = 120_000_00000000; // $120,000 (20% increase, exceeds 5% limit)

        let action = OracleAction::UpdatePrice { price: new_price };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::OraclePriceDeviation { .. })));
    }

    #[test]
    fn test_update_price_unauthorized() {
        let mut ctx = create_test_context();
        ctx.signer = [99u8; 32]; // Not operator

        let action = OracleAction::UpdatePrice { price: BTC_PRICE_100K };
        let result = validate(&mut ctx, &action);

        assert!(matches!(result, Err(ZkUsdError::Unauthorized { .. })));
    }

    #[test]
    fn test_price_staleness() {
        let state = OracleState::new([0u8; 32], [1u8; 32], BTC_PRICE_100K, 100);

        // Fresh price
        assert!(is_price_fresh(&state, 103));

        // Stale price (more than MAX_PRICE_AGE_BLOCKS)
        assert!(!is_price_fresh(&state, 110));
    }

    #[test]
    fn test_price_deviation_calculation() {
        // 0% deviation
        assert_eq!(calculate_price_deviation(100_000, 100_000), 0);

        // 1% deviation
        assert_eq!(calculate_price_deviation(100_000, 101_000), 100);

        // 5% deviation
        assert_eq!(calculate_price_deviation(100_000, 105_000), 500);

        // 10% deviation
        assert_eq!(calculate_price_deviation(100_000, 110_000), 1000);
    }

    #[test]
    fn test_set_operator() {
        let mut ctx = create_test_context();
        ctx.signer = [0u8; 32]; // Admin
        let new_operator = [2u8; 32];

        ctx.new_state.operator = new_operator;

        let action = OracleAction::SetOperator { operator: new_operator };
        let result = validate(&mut ctx, &action);

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_price_format() {
        // Valid prices
        assert!(validate_price_format(50_000_00000000));   // $50,000
        assert!(validate_price_format(100_000_00000000));  // $100,000
        assert!(validate_price_format(1_000_000_00000000)); // $1,000,000

        // Invalid prices
        assert!(!validate_price_format(100_00000000));     // $100 (too low)
        assert!(!validate_price_format(100_000_000_00000000)); // $100M (too high)
    }
}
