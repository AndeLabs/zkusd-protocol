//! Emergency Module
//!
//! Emergency controls for the zkUSD protocol including pause mechanisms,
//! circuit breakers, and recovery procedures.
//!
//! ## Key Features
//!
//! - **Global Pause**: Halt all protocol operations
//! - **Selective Pause**: Pause specific operations
//! - **Circuit Breakers**: Auto-pause on anomalies
//! - **Recovery Mode**: Special mode for critical situations
//! - **Graceful Shutdown**: Orderly protocol wind-down

use crate::{Vec, ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Maximum pause duration (1 week in blocks = 1008)
pub const MAX_PAUSE_DURATION: u64 = 1008;

/// Cooldown between pause operations (6 hours = 36 blocks)
pub const PAUSE_COOLDOWN: u64 = 36;

/// Auto-unpause duration if no action taken (3 days = 432 blocks)
pub const AUTO_UNPAUSE_DURATION: u64 = 432;

/// Circuit breaker trigger threshold (significant deviation)
pub const EMERGENCY_CB_THRESHOLD_BPS: u64 = 1500; // 15%

// ============================================================================
// Types
// ============================================================================

/// Operations that can be paused
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PausableOperation {
    /// All operations (global pause)
    All,
    /// Vault operations (open, close, adjust)
    Vaults,
    /// Minting new debt
    Minting,
    /// Redemptions
    Redemptions,
    /// Liquidations
    Liquidations,
    /// Stability pool deposits/withdrawals
    StabilityPool,
    /// Oracle updates
    OracleUpdates,
    /// Flash minting
    FlashMint,
    /// PSM swaps
    PsmSwaps,
    /// Cross-chain beaming
    Beaming,
}

impl PausableOperation {
    /// Get operation bitmask position
    pub fn mask(&self) -> u64 {
        match self {
            PausableOperation::All => 0xFFFF,
            PausableOperation::Vaults => 1 << 0,
            PausableOperation::Minting => 1 << 1,
            PausableOperation::Redemptions => 1 << 2,
            PausableOperation::Liquidations => 1 << 3,
            PausableOperation::StabilityPool => 1 << 4,
            PausableOperation::OracleUpdates => 1 << 5,
            PausableOperation::FlashMint => 1 << 6,
            PausableOperation::PsmSwaps => 1 << 7,
            PausableOperation::Beaming => 1 << 8,
        }
    }
}

/// Pause event record
#[derive(Debug, Clone)]
pub struct PauseEvent {
    /// Operation that was paused
    pub operation: PausableOperation,
    /// Who initiated the pause
    pub paused_by: [u8; 32],
    /// Block when paused
    pub paused_at: u64,
    /// Block when pause expires
    pub expires_at: u64,
    /// Reason for pause
    pub reason: PauseReason,
    /// Whether manually unpaused
    pub is_unpaused: bool,
}

/// Reasons for pausing
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PauseReason {
    /// Manual admin action
    AdminAction,
    /// Oracle price anomaly
    OracleAnomaly,
    /// Large liquidation cascade
    LiquidationCascade,
    /// Exploit detected
    ExploitDetected,
    /// Smart contract bug
    BugDetected,
    /// External dependency failure
    DependencyFailure,
    /// Governance action
    GovernanceAction,
    /// Scheduled maintenance
    Maintenance,
}

/// Circuit breaker configuration
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Whether circuit breaker is enabled
    pub enabled: bool,
    /// Price deviation threshold (basis points)
    pub price_deviation_bps: u64,
    /// TVL drop threshold (basis points)
    pub tvl_drop_bps: u64,
    /// Liquidation volume threshold (zkUSD)
    pub liquidation_threshold: u64,
    /// Time window for liquidation tracking (blocks)
    pub liquidation_window: u64,
    /// Cooldown after trigger (blocks)
    pub cooldown_blocks: u64,
    /// Last trigger block
    pub last_triggered: u64,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self::new()
    }
}

impl CircuitBreakerConfig {
    /// Create new circuit breaker config
    pub fn new() -> Self {
        Self {
            enabled: true,
            price_deviation_bps: EMERGENCY_CB_THRESHOLD_BPS,
            tvl_drop_bps: 2000, // 20%
            liquidation_threshold: 10_000_000_00000000, // 10M zkUSD
            liquidation_window: 12, // ~2 hours
            cooldown_blocks: 36, // ~6 hours
            last_triggered: 0,
        }
    }

    /// Check if circuit breaker is in cooldown
    pub fn in_cooldown(&self, current_block: u64) -> bool {
        current_block < self.last_triggered.saturating_add(self.cooldown_blocks)
    }
}

/// Emergency state
#[derive(Debug, Clone)]
pub struct EmergencyState {
    /// Bitmask of paused operations
    pub paused_operations: u64,
    /// List of pause events
    pub pause_history: Vec<PauseEvent>,
    /// Circuit breaker configuration
    pub circuit_breaker: CircuitBreakerConfig,
    /// Whether in recovery mode
    pub in_recovery_mode: bool,
    /// Recovery mode started at block
    pub recovery_started_at: u64,
    /// Global pause timestamp
    pub global_pause_at: Option<u64>,
    /// Shutdown initiated
    pub shutdown_initiated: bool,
    /// Last state update block
    pub last_update_block: u64,
}

impl Default for EmergencyState {
    fn default() -> Self {
        Self::new()
    }
}

impl EmergencyState {
    /// Create new emergency state
    pub fn new() -> Self {
        Self {
            paused_operations: 0,
            pause_history: Vec::new(),
            circuit_breaker: CircuitBreakerConfig::new(),
            in_recovery_mode: false,
            recovery_started_at: 0,
            global_pause_at: None,
            shutdown_initiated: false,
            last_update_block: 0,
        }
    }
}

/// Circuit breaker trigger event
#[derive(Debug, Clone)]
pub struct CircuitBreakerTrigger {
    /// Type of anomaly detected
    pub anomaly_type: AnomalyType,
    /// Measured value
    pub measured_value: u64,
    /// Threshold that was exceeded
    pub threshold: u64,
    /// Block when detected
    pub detected_at: u64,
}

/// Types of anomalies that trigger circuit breaker
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnomalyType {
    /// Large price deviation
    PriceDeviation,
    /// Large TVL drop
    TvlDrop,
    /// Excessive liquidations
    LiquidationSpike,
    /// Oracle failure
    OracleFailure,
}

// ============================================================================
// Core Emergency Functions
// ============================================================================

/// Check if an operation is paused
pub fn is_paused(state: &EmergencyState, operation: PausableOperation, current_block: u64) -> bool {
    // Check global pause
    if let Some(pause_at) = state.global_pause_at {
        if current_block < pause_at.saturating_add(AUTO_UNPAUSE_DURATION) {
            return true;
        }
    }

    // Check shutdown
    if state.shutdown_initiated {
        return true;
    }

    // Check specific operation
    let mask = operation.mask();
    (state.paused_operations & mask) != 0
}

/// Pause an operation
pub fn pause_operation(
    state: &mut EmergencyState,
    operation: PausableOperation,
    pauser: [u8; 32],
    reason: PauseReason,
    duration: u64,
    current_block: u64,
) -> ZkUsdResult<()> {
    // Validate duration
    let actual_duration = duration.min(MAX_PAUSE_DURATION);

    // Set pause bit
    let mask = operation.mask();
    state.paused_operations |= mask;

    // Handle global pause
    if operation == PausableOperation::All {
        state.global_pause_at = Some(current_block);
    }

    // Record pause event
    state.pause_history.push(PauseEvent {
        operation,
        paused_by: pauser,
        paused_at: current_block,
        expires_at: current_block.saturating_add(actual_duration),
        reason,
        is_unpaused: false,
    });

    state.last_update_block = current_block;
    Ok(())
}

/// Unpause an operation
pub fn unpause_operation(
    state: &mut EmergencyState,
    operation: PausableOperation,
    _unpauser: [u8; 32],
    current_block: u64,
) -> ZkUsdResult<()> {
    // Clear pause bit
    let mask = operation.mask();
    state.paused_operations &= !mask;

    // Handle global pause
    if operation == PausableOperation::All {
        state.global_pause_at = None;
        state.paused_operations = 0;
    }

    // Mark latest pause event as unpaused
    for event in state.pause_history.iter_mut().rev() {
        if event.operation == operation && !event.is_unpaused {
            event.is_unpaused = true;
            break;
        }
    }

    state.last_update_block = current_block;
    Ok(())
}

/// Check and trigger circuit breaker for price deviation
pub fn check_price_circuit_breaker(
    state: &mut EmergencyState,
    old_price: u64,
    new_price: u64,
    current_block: u64,
) -> Option<CircuitBreakerTrigger> {
    if !state.circuit_breaker.enabled {
        return None;
    }

    if state.circuit_breaker.in_cooldown(current_block) {
        return None;
    }

    // Calculate deviation
    let deviation = if new_price > old_price {
        ((new_price - old_price) as u128 * 10000 / old_price as u128) as u64
    } else {
        ((old_price - new_price) as u128 * 10000 / old_price as u128) as u64
    };

    if deviation >= state.circuit_breaker.price_deviation_bps {
        // Trigger circuit breaker
        state.circuit_breaker.last_triggered = current_block;

        // Auto-pause oracle updates and minting
        state.paused_operations |= PausableOperation::OracleUpdates.mask();
        state.paused_operations |= PausableOperation::Minting.mask();

        return Some(CircuitBreakerTrigger {
            anomaly_type: AnomalyType::PriceDeviation,
            measured_value: deviation,
            threshold: state.circuit_breaker.price_deviation_bps,
            detected_at: current_block,
        });
    }

    None
}

/// Check circuit breaker for liquidation spike
pub fn check_liquidation_circuit_breaker(
    state: &mut EmergencyState,
    liquidation_amount: u64,
    total_liquidations_in_window: u64,
    current_block: u64,
) -> Option<CircuitBreakerTrigger> {
    if !state.circuit_breaker.enabled {
        return None;
    }

    if state.circuit_breaker.in_cooldown(current_block) {
        return None;
    }

    let total = total_liquidations_in_window.saturating_add(liquidation_amount);

    if total >= state.circuit_breaker.liquidation_threshold {
        // Trigger circuit breaker
        state.circuit_breaker.last_triggered = current_block;

        // Auto-pause liquidations temporarily
        state.paused_operations |= PausableOperation::Liquidations.mask();

        return Some(CircuitBreakerTrigger {
            anomaly_type: AnomalyType::LiquidationSpike,
            measured_value: total,
            threshold: state.circuit_breaker.liquidation_threshold,
            detected_at: current_block,
        });
    }

    None
}

/// Enter recovery mode
pub fn enter_recovery_mode(
    state: &mut EmergencyState,
    current_block: u64,
) -> ZkUsdResult<()> {
    if state.in_recovery_mode {
        return Ok(()); // Already in recovery mode
    }

    state.in_recovery_mode = true;
    state.recovery_started_at = current_block;
    state.last_update_block = current_block;

    Ok(())
}

/// Exit recovery mode
pub fn exit_recovery_mode(
    state: &mut EmergencyState,
    current_block: u64,
) -> ZkUsdResult<()> {
    if !state.in_recovery_mode {
        return Ok(());
    }

    state.in_recovery_mode = false;
    state.recovery_started_at = 0;
    state.last_update_block = current_block;

    Ok(())
}

/// Initiate graceful shutdown
pub fn initiate_shutdown(
    state: &mut EmergencyState,
    current_block: u64,
) -> ZkUsdResult<()> {
    if state.shutdown_initiated {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    state.shutdown_initiated = true;
    state.paused_operations = PausableOperation::All.mask();
    state.last_update_block = current_block;

    Ok(())
}

/// Update circuit breaker configuration
pub fn update_circuit_breaker_config(
    state: &mut EmergencyState,
    price_deviation_bps: Option<u64>,
    tvl_drop_bps: Option<u64>,
    liquidation_threshold: Option<u64>,
) {
    if let Some(pd) = price_deviation_bps {
        state.circuit_breaker.price_deviation_bps = pd;
    }
    if let Some(tvl) = tvl_drop_bps {
        state.circuit_breaker.tvl_drop_bps = tvl;
    }
    if let Some(liq) = liquidation_threshold {
        state.circuit_breaker.liquidation_threshold = liq;
    }
}

/// Get emergency status summary
#[derive(Debug, Clone)]
pub struct EmergencyStatus {
    /// Whether any operation is paused
    pub any_paused: bool,
    /// Number of paused operations
    pub paused_count: u32,
    /// Whether globally paused
    pub globally_paused: bool,
    /// Whether in recovery mode
    pub in_recovery: bool,
    /// Whether shutdown initiated
    pub shutdown: bool,
    /// Circuit breaker in cooldown
    pub circuit_breaker_cooldown: bool,
}

/// Get emergency status
pub fn get_emergency_status(state: &EmergencyState, current_block: u64) -> EmergencyStatus {
    let paused_count = state.paused_operations.count_ones();

    EmergencyStatus {
        any_paused: state.paused_operations != 0,
        paused_count,
        globally_paused: state.global_pause_at.is_some(),
        in_recovery: state.in_recovery_mode,
        shutdown: state.shutdown_initiated,
        circuit_breaker_cooldown: state.circuit_breaker.in_cooldown(current_block),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn admin() -> [u8; 32] {
        [1u8; 32]
    }

    #[test]
    fn test_new_state() {
        let state = EmergencyState::new();
        assert_eq!(state.paused_operations, 0);
        assert!(!state.in_recovery_mode);
        assert!(!state.shutdown_initiated);
    }

    #[test]
    fn test_pause_operation() {
        let mut state = EmergencyState::new();

        pause_operation(
            &mut state,
            PausableOperation::Minting,
            admin(),
            PauseReason::AdminAction,
            100,
            1000,
        )
        .unwrap();

        assert!(is_paused(&state, PausableOperation::Minting, 1001));
        assert!(!is_paused(&state, PausableOperation::Redemptions, 1001));
    }

    #[test]
    fn test_global_pause() {
        let mut state = EmergencyState::new();

        pause_operation(
            &mut state,
            PausableOperation::All,
            admin(),
            PauseReason::ExploitDetected,
            100,
            1000,
        )
        .unwrap();

        // All operations should be paused
        assert!(is_paused(&state, PausableOperation::Minting, 1001));
        assert!(is_paused(&state, PausableOperation::Liquidations, 1001));
        assert!(is_paused(&state, PausableOperation::Vaults, 1001));
    }

    #[test]
    fn test_unpause() {
        let mut state = EmergencyState::new();

        pause_operation(
            &mut state,
            PausableOperation::Minting,
            admin(),
            PauseReason::AdminAction,
            100,
            1000,
        )
        .unwrap();

        assert!(is_paused(&state, PausableOperation::Minting, 1001));

        unpause_operation(&mut state, PausableOperation::Minting, admin(), 1002).unwrap();

        assert!(!is_paused(&state, PausableOperation::Minting, 1003));
    }

    #[test]
    fn test_price_circuit_breaker() {
        let mut state = EmergencyState::new();

        // 20% price drop should trigger
        let trigger = check_price_circuit_breaker(&mut state, 100_000, 80_000, 1000);

        assert!(trigger.is_some());
        let t = trigger.unwrap();
        assert_eq!(t.anomaly_type, AnomalyType::PriceDeviation);

        // Should be in cooldown now
        assert!(state.circuit_breaker.in_cooldown(1001));

        // Oracle updates should be paused
        assert!(is_paused(&state, PausableOperation::OracleUpdates, 1001));
    }

    #[test]
    fn test_price_circuit_breaker_not_triggered() {
        let mut state = EmergencyState::new();

        // 5% price change should not trigger (threshold is 15%)
        let trigger = check_price_circuit_breaker(&mut state, 100_000, 95_000, 1000);

        assert!(trigger.is_none());
    }

    #[test]
    fn test_liquidation_circuit_breaker() {
        let mut state = EmergencyState::new();

        // Large liquidation should trigger
        let trigger = check_liquidation_circuit_breaker(
            &mut state,
            5_000_000_00000000,   // 5M
            6_000_000_00000000,   // 6M already in window
            1000,
        );

        assert!(trigger.is_some());
        assert_eq!(trigger.unwrap().anomaly_type, AnomalyType::LiquidationSpike);
    }

    #[test]
    fn test_recovery_mode() {
        let mut state = EmergencyState::new();

        enter_recovery_mode(&mut state, 1000).unwrap();
        assert!(state.in_recovery_mode);
        assert_eq!(state.recovery_started_at, 1000);

        exit_recovery_mode(&mut state, 1100).unwrap();
        assert!(!state.in_recovery_mode);
    }

    #[test]
    fn test_shutdown() {
        let mut state = EmergencyState::new();

        initiate_shutdown(&mut state, 1000).unwrap();

        assert!(state.shutdown_initiated);
        assert!(is_paused(&state, PausableOperation::Minting, 1001));

        // Can't initiate shutdown twice
        let result = initiate_shutdown(&mut state, 1001);
        assert!(matches!(result, Err(ZkUsdError::InvalidStateTransition)));
    }

    #[test]
    fn test_emergency_status() {
        let mut state = EmergencyState::new();

        pause_operation(
            &mut state,
            PausableOperation::Minting,
            admin(),
            PauseReason::AdminAction,
            100,
            1000,
        )
        .unwrap();

        let status = get_emergency_status(&state, 1001);

        assert!(status.any_paused);
        assert_eq!(status.paused_count, 1);
        assert!(!status.globally_paused);
    }

    #[test]
    fn test_auto_unpause() {
        let mut state = EmergencyState::new();

        state.global_pause_at = Some(1000);

        // Should be paused during auto-unpause window
        assert!(is_paused(&state, PausableOperation::Minting, 1100));

        // Should auto-unpause after duration
        assert!(!is_paused(&state, PausableOperation::Minting, 1000 + AUTO_UNPAUSE_DURATION + 1));
    }

    #[test]
    fn test_operation_masks() {
        assert_eq!(PausableOperation::Vaults.mask(), 1);
        assert_eq!(PausableOperation::Minting.mask(), 2);
        assert_eq!(PausableOperation::All.mask(), 0xFFFF);
    }

    #[test]
    fn test_circuit_breaker_cooldown() {
        let mut config = CircuitBreakerConfig::new();
        config.last_triggered = 1000;
        config.cooldown_blocks = 100;

        assert!(config.in_cooldown(1050));
        assert!(!config.in_cooldown(1150));
    }
}
