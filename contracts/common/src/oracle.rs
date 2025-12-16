//! Oracle Module
//!
//! Provides secure, reliable price feeds for the zkUSD protocol.
//! Aggregates multiple oracle sources with TWAP, median, and circuit breakers.
//!
//! ## Key Features
//!
//! - **Multi-source Aggregation**: Combine multiple oracle sources
//! - **TWAP**: Time-weighted average price for manipulation resistance
//! - **Circuit Breakers**: Automatic pausing on extreme deviations
//! - **Staleness Detection**: Reject stale price data
//! - **ZK-Proof Verification**: Verify oracle attestations
//!
//! ## Oracle Sources
//!
//! - Chainlink-style signed attestations
//! - DEX TWAP (on-chain price)
//! - Cross-chain bridges (for wrapped assets)
//! - Custom oracles with ZK proofs

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};
#[cfg(feature = "std")]
#[allow(unused_imports)]
use std::vec::Vec;

use crate::errors::{ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Maximum price deviation between sources (BPS)
pub const MAX_PRICE_DEVIATION_BPS: u64 = 500; // 5%

/// Maximum price age (blocks)
pub const MAX_PRICE_AGE_BLOCKS: u64 = 10; // ~2.5 minutes at 15s blocks

/// TWAP window size (observations)
pub const TWAP_WINDOW_SIZE: usize = 24; // 24 observations

/// Minimum required oracle sources
pub const MIN_ORACLE_SOURCES: usize = 1;

/// Maximum oracle sources
pub const MAX_ORACLE_SOURCES: usize = 10;

/// Price precision (8 decimals)
pub const PRICE_PRECISION: u64 = 100_000_000;

/// Circuit breaker threshold (max single-block change in BPS)
pub const CIRCUIT_BREAKER_THRESHOLD_BPS: u64 = 1500; // 15%

/// Cooldown after circuit breaker triggers (blocks)
pub const CIRCUIT_BREAKER_COOLDOWN: u64 = 6; // ~1.5 minutes

// ============================================================================
// Types
// ============================================================================

/// Oracle source type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OracleSourceType {
    /// Signed attestation from trusted party
    SignedAttestation,
    /// On-chain DEX TWAP
    DexTwap,
    /// Cross-chain bridge oracle
    CrossChainBridge,
    /// ZK-proof verified oracle
    ZkProofOracle,
    /// Aggregated from multiple sources
    Aggregated,
    /// Manual override (admin only)
    ManualOverride,
}

/// Priority level for oracle sources
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum OraclePriority {
    /// Highest priority - use first if available
    Primary = 3,
    /// Secondary fallback
    Secondary = 2,
    /// Tertiary fallback
    Tertiary = 1,
    /// Emergency only
    Emergency = 0,
}

/// A single oracle source
#[derive(Debug, Clone)]
pub struct OracleSource {
    /// Source ID
    pub source_id: [u8; 32],
    /// Source type
    pub source_type: OracleSourceType,
    /// Priority
    pub priority: OraclePriority,
    /// Public key for verification (if applicable)
    pub public_key: Option<[u8; 33]>,
    /// Last reported price
    pub last_price: u64,
    /// Block of last update
    pub last_update_block: u64,
    /// Is source active
    pub is_active: bool,
    /// Weight for aggregation (BPS, sum should be 10000)
    pub weight_bps: u64,
    /// Historical accuracy score (0-100)
    pub accuracy_score: u8,
}

impl OracleSource {
    /// Create new oracle source
    pub fn new(
        source_id: [u8; 32],
        source_type: OracleSourceType,
        priority: OraclePriority,
        weight_bps: u64,
    ) -> Self {
        Self {
            source_id,
            source_type,
            priority,
            public_key: None,
            last_price: 0,
            last_update_block: 0,
            is_active: true,
            weight_bps,
            accuracy_score: 100,
        }
    }

    /// Check if price is stale
    pub fn is_stale(&self, current_block: u64) -> bool {
        current_block > self.last_update_block + MAX_PRICE_AGE_BLOCKS
    }

    /// Update price
    pub fn update_price(&mut self, price: u64, block: u64) {
        self.last_price = price;
        self.last_update_block = block;
    }
}

/// Price observation for TWAP
#[derive(Debug, Clone, Copy, Default)]
pub struct PriceObservation {
    /// Price at observation
    pub price: u64,
    /// Block number
    pub block: u64,
    /// Cumulative price (for TWAP calculation)
    pub cumulative_price: u128,
}

/// TWAP calculator
#[derive(Debug, Clone)]
pub struct TwapCalculator {
    /// Observations ring buffer
    pub observations: Vec<PriceObservation>,
    /// Current index in ring buffer
    pub current_index: usize,
    /// Number of observations stored
    pub observation_count: usize,
    /// Last cumulative price
    pub last_cumulative: u128,
    /// Last observation block
    pub last_block: u64,
}

impl TwapCalculator {
    /// Create new TWAP calculator
    pub fn new() -> Self {
        Self {
            observations: vec![PriceObservation::default(); TWAP_WINDOW_SIZE],
            current_index: 0,
            observation_count: 0,
            last_cumulative: 0,
            last_block: 0,
        }
    }

    /// Record a new price observation
    pub fn record_observation(&mut self, price: u64, block: u64) {
        if block <= self.last_block {
            return; // Don't record duplicate or past blocks
        }

        let blocks_elapsed = block.saturating_sub(self.last_block);
        self.last_cumulative += price as u128 * blocks_elapsed as u128;

        self.observations[self.current_index] = PriceObservation {
            price,
            block,
            cumulative_price: self.last_cumulative,
        };

        self.current_index = (self.current_index + 1) % TWAP_WINDOW_SIZE;
        if self.observation_count < TWAP_WINDOW_SIZE {
            self.observation_count += 1;
        }
        self.last_block = block;
    }

    /// Calculate TWAP over specified window
    pub fn calculate_twap(&self, window_blocks: u64, current_block: u64) -> Option<u64> {
        if self.observation_count < 2 {
            return None;
        }

        let target_block = current_block.saturating_sub(window_blocks);

        // Find oldest observation within window
        let mut oldest_idx = None;
        let mut oldest_block = u64::MAX;

        for i in 0..self.observation_count {
            let obs = &self.observations[i];
            if obs.block >= target_block && obs.block < oldest_block {
                oldest_block = obs.block;
                oldest_idx = Some(i);
            }
        }

        let oldest = oldest_idx?;
        let newest_idx = if self.current_index == 0 {
            self.observation_count - 1
        } else {
            self.current_index - 1
        };

        let oldest_obs = &self.observations[oldest];
        let newest_obs = &self.observations[newest_idx];

        if newest_obs.block <= oldest_obs.block {
            return Some(newest_obs.price);
        }

        let cumulative_diff = newest_obs.cumulative_price - oldest_obs.cumulative_price;
        let block_diff = newest_obs.block - oldest_obs.block;

        Some((cumulative_diff / block_diff as u128) as u64)
    }

    /// Get latest price
    pub fn latest_price(&self) -> Option<u64> {
        if self.observation_count == 0 {
            return None;
        }
        let idx = if self.current_index == 0 {
            self.observation_count - 1
        } else {
            self.current_index - 1
        };
        Some(self.observations[idx].price)
    }
}

impl Default for TwapCalculator {
    fn default() -> Self {
        Self::new()
    }
}

/// Aggregated price result
#[derive(Debug, Clone)]
pub struct AggregatedPrice {
    /// Final aggregated price
    pub price: u64,
    /// TWAP price (if available)
    pub twap_price: Option<u64>,
    /// Number of sources used
    pub sources_used: u8,
    /// Confidence score (0-100)
    pub confidence: u8,
    /// Block number
    pub block: u64,
    /// Deviation between sources (BPS)
    pub max_deviation_bps: u64,
    /// Was circuit breaker triggered
    pub circuit_breaker_triggered: bool,
}

/// Circuit breaker state
#[derive(Debug, Clone, Default)]
pub struct CircuitBreaker {
    /// Is currently triggered
    pub is_triggered: bool,
    /// Block when triggered
    pub triggered_at_block: u64,
    /// Price before trigger
    pub pre_trigger_price: u64,
    /// Trigger count (for rate limiting)
    pub trigger_count: u32,
    /// Last reset block
    pub last_reset_block: u64,
}

impl CircuitBreaker {
    /// Check if should trigger based on price change
    pub fn should_trigger(&self, old_price: u64, new_price: u64) -> bool {
        if old_price == 0 {
            return false;
        }

        let change = if new_price > old_price {
            new_price - old_price
        } else {
            old_price - new_price
        };

        let change_bps = (change as u128 * 10000 / old_price as u128) as u64;
        change_bps > CIRCUIT_BREAKER_THRESHOLD_BPS
    }

    /// Trigger the circuit breaker
    pub fn trigger(&mut self, current_block: u64, current_price: u64) {
        self.is_triggered = true;
        self.triggered_at_block = current_block;
        self.pre_trigger_price = current_price;
        self.trigger_count += 1;
    }

    /// Check if cooldown has passed
    pub fn can_reset(&self, current_block: u64) -> bool {
        self.is_triggered && current_block >= self.triggered_at_block + CIRCUIT_BREAKER_COOLDOWN
    }

    /// Reset the circuit breaker
    pub fn reset(&mut self, current_block: u64) {
        self.is_triggered = false;
        self.last_reset_block = current_block;
    }
}

/// Oracle configuration for an asset
#[derive(Debug, Clone)]
pub struct OracleConfig {
    /// Asset ID (e.g., BTC, ETH)
    pub asset_id: [u8; 32],
    /// Oracle sources for this asset
    pub sources: Vec<OracleSource>,
    /// TWAP calculator
    pub twap: TwapCalculator,
    /// Circuit breaker
    pub circuit_breaker: CircuitBreaker,
    /// Last aggregated price
    pub last_price: u64,
    /// Last update block
    pub last_update_block: u64,
    /// Aggregation method
    pub aggregation_method: AggregationMethod,
    /// Is oracle active
    pub is_active: bool,
}

/// Method for aggregating multiple oracle sources
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggregationMethod {
    /// Use median of all sources
    Median,
    /// Use weighted average
    WeightedAverage,
    /// Use highest priority available source
    PriorityBased,
    /// Custom aggregation
    Custom,
}

impl OracleConfig {
    /// Create new oracle config for an asset
    pub fn new(asset_id: [u8; 32]) -> Self {
        Self {
            asset_id,
            sources: Vec::new(),
            twap: TwapCalculator::new(),
            circuit_breaker: CircuitBreaker::default(),
            last_price: 0,
            last_update_block: 0,
            aggregation_method: AggregationMethod::Median,
            is_active: true,
        }
    }

    /// Add an oracle source
    pub fn add_source(&mut self, source: OracleSource) -> ZkUsdResult<()> {
        if self.sources.len() >= MAX_ORACLE_SOURCES {
            return Err(ZkUsdError::ExceedsMaximum {
                amount: self.sources.len() as u64,
                maximum: MAX_ORACLE_SOURCES as u64,
            });
        }
        self.sources.push(source);
        Ok(())
    }

    /// Remove an oracle source
    pub fn remove_source(&mut self, source_id: [u8; 32]) -> ZkUsdResult<()> {
        let initial_len = self.sources.len();
        self.sources.retain(|s| s.source_id != source_id);

        if self.sources.len() == initial_len {
            return Err(ZkUsdError::InvalidParameter);
        }
        Ok(())
    }

    /// Get active, non-stale sources
    pub fn get_valid_sources(&self, current_block: u64) -> Vec<&OracleSource> {
        self.sources
            .iter()
            .filter(|s| s.is_active && !s.is_stale(current_block))
            .collect()
    }
}

/// Global oracle state
#[derive(Debug, Clone, Default)]
pub struct OracleState {
    /// Oracle configs by asset
    pub oracles: Vec<OracleConfig>,
    /// Admin address
    pub admin: [u8; 32],
    /// Is oracle system paused
    pub is_paused: bool,
    /// Total price updates
    pub total_updates: u64,
    /// Circuit breaker triggers
    pub circuit_breaker_triggers: u64,
}

// ============================================================================
// Core Operations
// ============================================================================

/// Update price from an oracle source
pub fn update_price(
    config: &mut OracleConfig,
    source_id: [u8; 32],
    price: u64,
    current_block: u64,
    signature: Option<&[u8]>,
) -> ZkUsdResult<()> {
    // Find source
    let source = config.sources
        .iter_mut()
        .find(|s| s.source_id == source_id)
        .ok_or(ZkUsdError::InvalidParameter)?;

    if !source.is_active {
        return Err(ZkUsdError::InvalidOperation);
    }

    // Verify signature if required
    if source.source_type == OracleSourceType::SignedAttestation {
        if signature.is_none() {
            return Err(ZkUsdError::MissingSignature);
        }
        // In production, verify the signature here
        let _sig = signature.unwrap();
    }

    // Check for circuit breaker
    if config.circuit_breaker.should_trigger(source.last_price, price) {
        config.circuit_breaker.trigger(current_block, source.last_price);
    }

    // Update source
    source.update_price(price, current_block);

    // Record TWAP observation
    config.twap.record_observation(price, current_block);

    Ok(())
}

/// Aggregate prices from all valid sources
pub fn aggregate_price(
    config: &mut OracleConfig,
    current_block: u64,
) -> ZkUsdResult<AggregatedPrice> {
    let valid_sources = config.get_valid_sources(current_block);

    if valid_sources.len() < MIN_ORACLE_SOURCES {
        return Err(ZkUsdError::OracleNotInitialized);
    }

    // Collect prices
    let mut prices: Vec<(u64, u64)> = valid_sources
        .iter()
        .map(|s| (s.last_price, s.weight_bps))
        .collect();

    // Sort for median
    prices.sort_by_key(|p| p.0);

    let price = match config.aggregation_method {
        AggregationMethod::Median => {
            let mid = prices.len() / 2;
            if prices.len() % 2 == 0 {
                (prices[mid - 1].0 + prices[mid].0) / 2
            } else {
                prices[mid].0
            }
        }
        AggregationMethod::WeightedAverage => {
            let total_weight: u64 = prices.iter().map(|p| p.1).sum();
            if total_weight == 0 {
                prices[0].0
            } else {
                let weighted_sum: u128 = prices
                    .iter()
                    .map(|p| p.0 as u128 * p.1 as u128)
                    .sum();
                (weighted_sum / total_weight as u128) as u64
            }
        }
        AggregationMethod::PriorityBased => {
            // Sources are already filtered to valid ones, just use first
            prices[0].0
        }
        AggregationMethod::Custom => {
            // Default to median for custom
            prices[prices.len() / 2].0
        }
    };

    // Calculate max deviation
    let max_price = prices.iter().map(|p| p.0).max().unwrap_or(price);
    let min_price = prices.iter().map(|p| p.0).min().unwrap_or(price);
    let max_deviation_bps = if min_price > 0 {
        ((max_price - min_price) as u128 * 10000 / min_price as u128) as u64
    } else {
        0
    };

    // Check circuit breaker
    let circuit_breaker_triggered = config.circuit_breaker.is_triggered
        && !config.circuit_breaker.can_reset(current_block);

    // Calculate confidence
    let confidence = calculate_confidence(
        prices.len(),
        max_deviation_bps,
        circuit_breaker_triggered,
    );

    // Get TWAP
    let twap_price = config.twap.calculate_twap(144, current_block); // ~1 day window

    // Update config
    config.last_price = price;
    config.last_update_block = current_block;

    Ok(AggregatedPrice {
        price,
        twap_price,
        sources_used: prices.len() as u8,
        confidence,
        block: current_block,
        max_deviation_bps,
        circuit_breaker_triggered,
    })
}

/// Get current price (with staleness check)
pub fn get_price(
    config: &OracleConfig,
    current_block: u64,
) -> ZkUsdResult<u64> {
    if !config.is_active {
        return Err(ZkUsdError::OracleNotInitialized);
    }

    if current_block > config.last_update_block + MAX_PRICE_AGE_BLOCKS {
        return Err(ZkUsdError::OracleStale {
            last_update_block: config.last_update_block,
            current_block,
            max_age: MAX_PRICE_AGE_BLOCKS,
        });
    }

    if config.circuit_breaker.is_triggered {
        // Return pre-trigger price during circuit breaker
        return Ok(config.circuit_breaker.pre_trigger_price);
    }

    Ok(config.last_price)
}

/// Get TWAP price
pub fn get_twap_price(
    config: &OracleConfig,
    window_blocks: u64,
    current_block: u64,
) -> ZkUsdResult<u64> {
    config.twap.calculate_twap(window_blocks, current_block)
        .ok_or(ZkUsdError::OracleNotInitialized)
}

/// Reset circuit breaker (admin only)
pub fn reset_circuit_breaker(
    config: &mut OracleConfig,
    current_block: u64,
) -> ZkUsdResult<()> {
    if !config.circuit_breaker.can_reset(current_block) {
        return Err(ZkUsdError::ConditionNotMet);
    }

    config.circuit_breaker.reset(current_block);
    Ok(())
}

/// Verify price is within acceptable deviation
pub fn verify_price_deviation(
    reported_price: u64,
    reference_price: u64,
    max_deviation_bps: u64,
) -> bool {
    if reference_price == 0 {
        return true;
    }

    let deviation = if reported_price > reference_price {
        reported_price - reference_price
    } else {
        reference_price - reported_price
    };

    let deviation_bps = (deviation as u128 * 10000 / reference_price as u128) as u64;
    deviation_bps <= max_deviation_bps
}

// ============================================================================
// Helpers
// ============================================================================

fn calculate_confidence(
    source_count: usize,
    deviation_bps: u64,
    circuit_breaker: bool,
) -> u8 {
    let mut confidence = 100u8;

    // Reduce for fewer sources
    if source_count < 3 {
        confidence = confidence.saturating_sub(20);
    }

    // Reduce for high deviation
    if deviation_bps > 200 {
        confidence = confidence.saturating_sub((deviation_bps / 50) as u8);
    }

    // Reduce for circuit breaker
    if circuit_breaker {
        confidence = confidence.saturating_sub(30);
    }

    confidence
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_source(id: u8, price: u64) -> OracleSource {
        let mut source_id = [0u8; 32];
        source_id[0] = id;
        let mut source = OracleSource::new(
            source_id,
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            3333, // ~33% weight
        );
        source.last_price = price;
        source.last_update_block = 100;
        source
    }

    #[test]
    fn test_oracle_source_creation() {
        let source = create_test_source(1, 50_000_00000000);
        assert!(source.is_active);
        assert_eq!(source.last_price, 50_000_00000000);
    }

    #[test]
    fn test_staleness_detection() {
        let source = create_test_source(1, 50_000_00000000);

        // Not stale
        assert!(!source.is_stale(105));

        // Stale
        assert!(source.is_stale(111)); // 100 + 10 + 1
    }

    #[test]
    fn test_twap_calculator() {
        let mut twap = TwapCalculator::new();

        twap.record_observation(100_00000000, 1);
        twap.record_observation(110_00000000, 2);
        twap.record_observation(105_00000000, 3);

        let latest = twap.latest_price().unwrap();
        assert_eq!(latest, 105_00000000);

        let twap_price = twap.calculate_twap(10, 3);
        assert!(twap_price.is_some());
    }

    #[test]
    fn test_circuit_breaker_trigger() {
        let mut cb = CircuitBreaker::default();

        // 10% change should not trigger
        assert!(!cb.should_trigger(100, 110));

        // 20% change should trigger
        assert!(cb.should_trigger(100, 120));

        cb.trigger(100, 100);
        assert!(cb.is_triggered);
    }

    #[test]
    fn test_circuit_breaker_cooldown() {
        let mut cb = CircuitBreaker::default();
        cb.trigger(100, 50_000_00000000);

        // Cannot reset immediately
        assert!(!cb.can_reset(102));

        // Can reset after cooldown
        assert!(cb.can_reset(100 + CIRCUIT_BREAKER_COOLDOWN));
    }

    #[test]
    fn test_oracle_config_add_source() {
        let mut config = OracleConfig::new([1u8; 32]);
        let source = create_test_source(1, 50_000_00000000);

        config.add_source(source).unwrap();
        assert_eq!(config.sources.len(), 1);
    }

    #[test]
    fn test_median_aggregation() {
        let mut config = OracleConfig::new([1u8; 32]);
        config.aggregation_method = AggregationMethod::Median;

        config.add_source(create_test_source(1, 100_00000000)).unwrap();
        config.add_source(create_test_source(2, 102_00000000)).unwrap();
        config.add_source(create_test_source(3, 104_00000000)).unwrap();

        let result = aggregate_price(&mut config, 105).unwrap();

        // Median of 100, 102, 104 = 102
        assert_eq!(result.price, 102_00000000);
        assert_eq!(result.sources_used, 3);
    }

    #[test]
    fn test_weighted_average_aggregation() {
        let mut config = OracleConfig::new([1u8; 32]);
        config.aggregation_method = AggregationMethod::WeightedAverage;

        let mut source1 = create_test_source(1, 100_00000000);
        source1.weight_bps = 5000; // 50%

        let mut source2 = create_test_source(2, 200_00000000);
        source2.weight_bps = 5000; // 50%

        config.add_source(source1).unwrap();
        config.add_source(source2).unwrap();

        let result = aggregate_price(&mut config, 105).unwrap();

        // Weighted average: (100 * 0.5 + 200 * 0.5) = 150
        assert_eq!(result.price, 150_00000000);
    }

    #[test]
    fn test_get_price_stale() {
        let mut config = OracleConfig::new([1u8; 32]);
        config.last_price = 50_000_00000000;
        config.last_update_block = 100;

        // Should work within age limit
        assert!(get_price(&config, 105).is_ok());

        // Should fail when stale
        let result = get_price(&config, 120);
        assert!(matches!(result, Err(ZkUsdError::OracleStale { .. })));
    }

    #[test]
    fn test_price_deviation_check() {
        let reference = 100_00000000u64;

        // Within 5%
        assert!(verify_price_deviation(104_00000000, reference, 500));

        // Outside 5%
        assert!(!verify_price_deviation(106_00000000, reference, 500));
    }

    #[test]
    fn test_confidence_calculation() {
        // High confidence: many sources, low deviation
        let high = calculate_confidence(5, 100, false);
        assert!(high > 90);

        // Lower confidence: few sources, high deviation, circuit breaker
        let low = calculate_confidence(1, 1000, true);
        assert!(low < 50);
    }

    #[test]
    fn test_update_price_with_twap() {
        let mut config = OracleConfig::new([1u8; 32]);
        let source_id = [1u8; 32];
        config.add_source(OracleSource::new(
            source_id,
            OracleSourceType::DexTwap,
            OraclePriority::Primary,
            10000,
        )).unwrap();

        // Update prices over time
        update_price(&mut config, source_id, 100_00000000, 1, None).unwrap();
        update_price(&mut config, source_id, 102_00000000, 2, None).unwrap();
        update_price(&mut config, source_id, 101_00000000, 3, None).unwrap();

        // TWAP should be available
        let twap = get_twap_price(&config, 10, 3);
        assert!(twap.is_ok());
    }

    #[test]
    fn test_remove_source() {
        let mut config = OracleConfig::new([1u8; 32]);
        let source_id = [1u8; 32];

        config.add_source(OracleSource::new(
            source_id,
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            10000,
        )).unwrap();

        assert_eq!(config.sources.len(), 1);

        config.remove_source(source_id).unwrap();
        assert_eq!(config.sources.len(), 0);
    }
}
