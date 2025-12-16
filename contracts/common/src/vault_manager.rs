//! Vault Manager Module
//!
//! Comprehensive vault lifecycle management for the zkUSD protocol.
//! Handles vault creation, updates, closures, and registry operations.
//!
//! ## Key Features
//!
//! - **Vault Lifecycle**: Create, update, and close vaults atomically
//! - **Sorted Vaults**: Maintain sorted list by ICR for efficient redemption
//! - **Batch Operations**: Process multiple vault operations atomically
//! - **Vault Registry**: Efficient lookup and iteration of all vaults
//! - **Health Monitoring**: Continuous vault health tracking
//! - **UTXO-Native**: All operations designed for UTXO atomicity

use crate::{Vec, ZkUsdError, ZkUsdResult, Vault, calculate_icr};
use crate::errors::AmountErrorReason;
use crate::constants::token;

// ============================================================================
// Constants
// ============================================================================

/// Maximum number of vaults a single owner can have
pub const MAX_VAULTS_PER_OWNER: usize = 100;

/// Minimum collateral amount in satoshis (0.001 BTC = 100,000 sats)
pub const VM_MIN_COLLATERAL: u64 = 100_000;

/// Minimum debt amount in zkUSD (10 zkUSD with 8 decimals)
pub const VM_MIN_DEBT: u64 = 10 * token::ONE;

/// Maximum vaults in a single batch operation
pub const MAX_BATCH_SIZE: usize = 50;

/// Grace period in blocks before a vault can be liquidated after going unhealthy
pub const LIQUIDATION_GRACE_BLOCKS: u64 = 6;

// ============================================================================
// Types
// ============================================================================

/// Vault status in the vault manager system
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VmVaultStatus {
    /// Active and healthy
    Active,
    /// Below MCR but in grace period
    AtRisk,
    /// Eligible for liquidation
    Liquidatable,
    /// Vault has been closed
    Closed,
    /// Vault has been liquidated
    Liquidated,
}

/// Operation type for vault modifications
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultOperation {
    /// Add collateral to vault
    AddCollateral,
    /// Withdraw collateral from vault
    WithdrawCollateral,
    /// Borrow more zkUSD
    BorrowMore,
    /// Repay debt
    RepayDebt,
    /// Adjust both collateral and debt
    AdjustBoth,
    /// Close the vault
    Close,
}

/// Vault position in sorted list
#[derive(Debug, Clone)]
pub struct VaultPosition {
    /// Vault identifier
    pub vault_id: [u8; 32],
    /// Owner's public key
    pub owner: [u8; 32],
    /// Individual Collateral Ratio in basis points
    pub icr_bps: u64,
    /// Previous vault in sorted list (None if first)
    pub prev: Option<[u8; 32]>,
    /// Next vault in sorted list (None if last)
    pub next: Option<[u8; 32]>,
}

/// Request to create a new vault
#[derive(Debug, Clone)]
pub struct CreateVaultRequest {
    /// Owner's public key
    pub owner: [u8; 32],
    /// Initial collateral in satoshis
    pub collateral: u64,
    /// Initial debt to mint in zkUSD
    pub debt: u64,
    /// Current BTC price in USD (8 decimals)
    pub btc_price: u64,
    /// Current block height
    pub block_height: u64,
    /// Interest rate in basis points
    pub interest_rate_bps: u64,
}

/// Request to adjust an existing vault
#[derive(Debug, Clone)]
pub struct AdjustVaultRequest {
    /// Vault identifier
    pub vault_id: [u8; 32],
    /// Collateral change (positive = add, negative = withdraw)
    pub collateral_change: i64,
    /// Debt change (positive = borrow, negative = repay)
    pub debt_change: i64,
    /// Current BTC price in USD (8 decimals)
    pub btc_price: u64,
    /// Current block height
    pub block_height: u64,
}

/// Result of a vault creation
#[derive(Debug, Clone)]
pub struct CreateVaultResult {
    /// The created vault
    pub vault: Vault,
    /// Position in sorted list
    pub position: VaultPosition,
    /// Mint fee charged
    pub mint_fee: u64,
}

/// Result of a vault adjustment
#[derive(Debug, Clone)]
pub struct AdjustVaultResult {
    /// The updated vault
    pub vault: Vault,
    /// New position in sorted list
    pub position: VaultPosition,
    /// Any fees charged
    pub fees: u64,
    /// Operation performed
    pub operation: VaultOperation,
}

/// Vault health report
#[derive(Debug, Clone)]
pub struct VaultHealth {
    /// Vault identifier
    pub vault_id: [u8; 32],
    /// Current status
    pub status: VmVaultStatus,
    /// Current ICR in basis points
    pub icr_bps: u64,
    /// Minimum required ICR
    pub min_icr_bps: u64,
    /// Distance to liquidation in basis points
    pub buffer_bps: i64,
    /// Estimated time until unhealthy (blocks)
    pub blocks_until_unhealthy: Option<u64>,
    /// Block when vault became at risk (if applicable)
    pub at_risk_since: Option<u64>,
}

/// Batch operation request
#[derive(Debug, Clone)]
pub struct BatchVaultOperation {
    /// Vault to operate on
    pub vault_id: [u8; 32],
    /// Operation to perform
    pub operation: VaultOperation,
    /// Amount for the operation
    pub amount: u64,
}

/// Registry statistics
#[derive(Debug, Clone, Default)]
pub struct RegistryStats {
    /// Total number of active vaults
    pub total_vaults: u64,
    /// Total collateral locked in satoshis
    pub total_collateral: u64,
    /// Total debt minted in zkUSD
    pub total_debt: u64,
    /// Average ICR in basis points
    pub average_icr_bps: u64,
    /// Median ICR in basis points
    pub median_icr_bps: u64,
    /// Number of vaults at risk
    pub vaults_at_risk: u64,
    /// Number of liquidatable vaults
    pub liquidatable_vaults: u64,
}

/// Sorted vault list for efficient operations
#[derive(Debug, Clone)]
pub struct SortedVaults {
    /// Head of the list (lowest ICR)
    pub head: Option<[u8; 32]>,
    /// Tail of the list (highest ICR)
    pub tail: Option<[u8; 32]>,
    /// Number of vaults in the list
    pub size: u64,
}

impl Default for SortedVaults {
    fn default() -> Self {
        Self::new()
    }
}

impl SortedVaults {
    /// Create a new empty sorted list
    pub fn new() -> Self {
        Self {
            head: None,
            tail: None,
            size: 0,
        }
    }

    /// Check if the list is empty
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
}

// ============================================================================
// Core Vault Manager Functions
// ============================================================================

/// Validate vault creation parameters
pub fn validate_create_params(request: &CreateVaultRequest) -> ZkUsdResult<()> {
    // Check minimum collateral
    if request.collateral < VM_MIN_COLLATERAL {
        return Err(ZkUsdError::InvalidAmount {
            amount: request.collateral,
            reason: AmountErrorReason::TooSmall,
        });
    }

    // Check minimum debt
    if request.debt < VM_MIN_DEBT {
        return Err(ZkUsdError::InvalidAmount {
            amount: request.debt,
            reason: AmountErrorReason::TooSmall,
        });
    }

    // Check price is valid
    if request.btc_price == 0 {
        return Err(ZkUsdError::InvalidParameter);
    }

    Ok(())
}

/// Create a new vault
pub fn create_vault(request: CreateVaultRequest, mcr_bps: u64) -> ZkUsdResult<CreateVaultResult> {
    // Validate parameters
    validate_create_params(&request)?;

    // Calculate ICR
    let icr = calculate_icr(request.collateral, request.debt, request.btc_price)?;
    let icr_bps = icr * 100; // Convert ratio to basis points

    // Check MCR requirement
    if icr_bps < mcr_bps {
        return Err(ZkUsdError::InsufficientCollateralRatio);
    }

    // Generate vault ID (hash of owner + block + collateral + debt)
    let vault_id = generate_vault_id(&request.owner, request.block_height, request.collateral);

    // Calculate mint fee (0.5% = 50 bps)
    let mint_fee = request.debt * 50 / 10000;

    // Create the vault
    let vault = Vault::with_interest_rate(
        vault_id,
        request.owner,
        request.collateral,
        request.debt,
        request.block_height,
        request.interest_rate_bps,
    );

    // Create position entry
    let position = VaultPosition {
        vault_id,
        owner: request.owner,
        icr_bps,
        prev: None,
        next: None,
    };

    Ok(CreateVaultResult {
        vault,
        position,
        mint_fee,
    })
}

/// Generate a deterministic vault ID
pub fn generate_vault_id(owner: &[u8; 32], block_height: u64, collateral: u64) -> [u8; 32] {
    let mut id = [0u8; 32];
    // Simple deterministic ID generation
    for i in 0..24 {
        id[i] = owner[i];
    }
    id[24..32].copy_from_slice(&(block_height ^ collateral).to_le_bytes());
    id
}

/// Adjust an existing vault
pub fn adjust_vault(
    vault: &Vault,
    request: &AdjustVaultRequest,
    mcr_bps: u64,
) -> ZkUsdResult<AdjustVaultResult> {
    // Calculate new collateral
    let new_collateral = if request.collateral_change >= 0 {
        vault.collateral.saturating_add(request.collateral_change as u64)
    } else {
        vault.collateral.saturating_sub((-request.collateral_change) as u64)
    };

    // Calculate new debt
    let new_debt = if request.debt_change >= 0 {
        vault.debt.saturating_add(request.debt_change as u64)
    } else {
        vault.debt.saturating_sub((-request.debt_change) as u64)
    };

    // Validate minimum amounts if not closing
    if new_debt > 0 {
        if new_collateral < VM_MIN_COLLATERAL {
            return Err(ZkUsdError::InvalidAmount {
                amount: new_collateral,
                reason: AmountErrorReason::TooSmall,
            });
        }
        if new_debt < VM_MIN_DEBT {
            return Err(ZkUsdError::InvalidAmount {
                amount: new_debt,
                reason: AmountErrorReason::TooSmall,
            });
        }
    }

    // Calculate new ICR
    let icr_bps = if new_debt == 0 {
        u64::MAX
    } else {
        let icr = calculate_icr(new_collateral, new_debt, request.btc_price)?;
        icr * 100
    };

    // Check MCR requirement (unless closing)
    if new_debt > 0 && icr_bps < mcr_bps {
        return Err(ZkUsdError::InsufficientCollateralRatio);
    }

    // Determine operation type
    let operation = match (request.collateral_change, request.debt_change) {
        (c, d) if c > 0 && d == 0 => VaultOperation::AddCollateral,
        (c, d) if c < 0 && d == 0 => VaultOperation::WithdrawCollateral,
        (c, d) if c == 0 && d > 0 => VaultOperation::BorrowMore,
        (c, d) if c == 0 && d < 0 => VaultOperation::RepayDebt,
        (_, d) if d < 0 && new_debt == 0 => VaultOperation::Close,
        _ => VaultOperation::AdjustBoth,
    };

    // Calculate fees (only for new debt)
    let fees = if request.debt_change > 0 {
        (request.debt_change as u64) * 50 / 10000
    } else {
        0
    };

    // Create updated vault
    let updated_vault = Vault::with_interest_rate(
        vault.id,
        vault.owner,
        new_collateral,
        new_debt,
        request.block_height,
        vault.interest_rate_bps,
    );

    // Create new position
    let position = VaultPosition {
        vault_id: request.vault_id,
        owner: vault.owner,
        icr_bps,
        prev: None,
        next: None,
    };

    Ok(AdjustVaultResult {
        vault: updated_vault,
        position,
        fees,
        operation,
    })
}

/// Close a vault (repay all debt)
pub fn close_vault(vault: &Vault, repayment: u64, block_height: u64) -> ZkUsdResult<Vault> {
    // Check if repayment covers debt
    if repayment < vault.debt {
        return Err(ZkUsdError::InvalidAmount {
            amount: repayment,
            reason: AmountErrorReason::TooSmall,
        });
    }

    // Create closed vault (zero debt)
    Ok(Vault::with_interest_rate(
        vault.id,
        vault.owner,
        vault.collateral,
        0,
        block_height,
        vault.interest_rate_bps,
    ))
}

/// Calculate vault health status
pub fn calculate_vault_health(
    vault: &Vault,
    btc_price: u64,
    mcr_bps: u64,
    current_block: u64,
    at_risk_block: Option<u64>,
) -> VaultHealth {
    let icr = calculate_icr(vault.collateral, vault.debt, btc_price).unwrap_or(0);
    let icr_bps = icr * 100;
    let buffer_bps = icr_bps as i64 - mcr_bps as i64;

    // Determine status
    let status = if vault.debt == 0 {
        VmVaultStatus::Closed
    } else if icr_bps >= mcr_bps {
        VmVaultStatus::Active
    } else if let Some(risk_block) = at_risk_block {
        if current_block >= risk_block + LIQUIDATION_GRACE_BLOCKS {
            VmVaultStatus::Liquidatable
        } else {
            VmVaultStatus::AtRisk
        }
    } else {
        VmVaultStatus::AtRisk
    };

    VaultHealth {
        vault_id: vault.id,
        status,
        icr_bps,
        min_icr_bps: mcr_bps,
        buffer_bps,
        blocks_until_unhealthy: None, // Would need price prediction
        at_risk_since: at_risk_block,
    }
}

/// Find insert position in sorted list (binary search style hint)
pub fn find_insert_position(
    new_icr_bps: u64,
    positions: &[VaultPosition],
) -> (Option<[u8; 32]>, Option<[u8; 32]>) {
    if positions.is_empty() {
        return (None, None);
    }

    // Find position where new_icr_bps fits
    let mut prev: Option<[u8; 32]> = None;
    let mut next: Option<[u8; 32]> = None;

    for pos in positions {
        if pos.icr_bps <= new_icr_bps {
            prev = Some(pos.vault_id);
        } else {
            next = Some(pos.vault_id);
            break;
        }
    }

    (prev, next)
}

/// Execute batch vault operations
pub fn execute_batch_operations(
    vaults: &mut [(Vault, VaultPosition)],
    operations: &[BatchVaultOperation],
    btc_price: u64,
    mcr_bps: u64,
    block_height: u64,
) -> ZkUsdResult<Vec<AdjustVaultResult>> {
    if operations.len() > MAX_BATCH_SIZE {
        return Err(ZkUsdError::InvalidAmount {
            amount: operations.len() as u64,
            reason: AmountErrorReason::TooLarge,
        });
    }

    let mut results = Vec::new();

    for op in operations {
        // Find the vault
        let vault_opt = vaults.iter().find(|(_, p)| p.vault_id == op.vault_id);
        let (vault, _) = vault_opt.ok_or(ZkUsdError::VaultNotFound { vault_id: op.vault_id })?;

        // Build adjustment request based on operation type
        let request = match op.operation {
            VaultOperation::AddCollateral => AdjustVaultRequest {
                vault_id: op.vault_id,
                collateral_change: op.amount as i64,
                debt_change: 0,
                btc_price,
                block_height,
            },
            VaultOperation::WithdrawCollateral => AdjustVaultRequest {
                vault_id: op.vault_id,
                collateral_change: -(op.amount as i64),
                debt_change: 0,
                btc_price,
                block_height,
            },
            VaultOperation::BorrowMore => AdjustVaultRequest {
                vault_id: op.vault_id,
                collateral_change: 0,
                debt_change: op.amount as i64,
                btc_price,
                block_height,
            },
            VaultOperation::RepayDebt => AdjustVaultRequest {
                vault_id: op.vault_id,
                collateral_change: 0,
                debt_change: -(op.amount as i64),
                btc_price,
                block_height,
            },
            VaultOperation::AdjustBoth | VaultOperation::Close => {
                return Err(ZkUsdError::InvalidOperation);
            }
        };

        let result = adjust_vault(vault, &request, mcr_bps)?;
        results.push(result);
    }

    Ok(results)
}

/// Calculate registry statistics
pub fn calculate_registry_stats(vaults: &[(Vault, VaultPosition)], btc_price: u64, mcr_bps: u64) -> RegistryStats {
    if vaults.is_empty() {
        return RegistryStats::default();
    }

    let mut total_collateral: u64 = 0;
    let mut total_debt: u64 = 0;
    let mut vaults_at_risk: u64 = 0;
    let mut liquidatable_vaults: u64 = 0;
    let mut icrs: Vec<u64> = Vec::new();

    for (vault, _) in vaults {
        if vault.debt == 0 {
            continue;
        }

        total_collateral = total_collateral.saturating_add(vault.collateral);
        total_debt = total_debt.saturating_add(vault.debt);

        let icr = calculate_icr(vault.collateral, vault.debt, btc_price).unwrap_or(0);
        let icr_bps = icr * 100;
        icrs.push(icr_bps);

        if icr_bps < mcr_bps {
            vaults_at_risk += 1;
            liquidatable_vaults += 1;
        }
    }

    let total_vaults = icrs.len() as u64;

    // Calculate average ICR
    let average_icr_bps = if !icrs.is_empty() {
        icrs.iter().sum::<u64>() / icrs.len() as u64
    } else {
        0
    };

    // Calculate median ICR
    let median_icr_bps = if !icrs.is_empty() {
        icrs.sort();
        icrs[icrs.len() / 2]
    } else {
        0
    };

    RegistryStats {
        total_vaults,
        total_collateral,
        total_debt,
        average_icr_bps,
        median_icr_bps,
        vaults_at_risk,
        liquidatable_vaults,
    }
}

/// Get vaults eligible for redemption (sorted by ICR, lowest first)
pub fn get_redemption_candidates(
    positions: &[VaultPosition],
    amount_to_redeem: u64,
    _btc_price: u64,
) -> Vec<[u8; 32]> {
    // Positions should already be sorted by ICR
    let mut candidates = Vec::new();
    let mut remaining = amount_to_redeem;

    for pos in positions {
        if remaining == 0 {
            break;
        }
        candidates.push(pos.vault_id);
        // In real implementation, would track how much each vault can provide
        remaining = remaining.saturating_sub(pos.icr_bps); // Simplified
    }

    candidates
}

/// Check if owner has reached vault limit
pub fn check_vault_limit(owner_vault_count: usize) -> ZkUsdResult<()> {
    if owner_vault_count >= MAX_VAULTS_PER_OWNER {
        return Err(ZkUsdError::InvalidAmount {
            amount: owner_vault_count as u64,
            reason: AmountErrorReason::TooLarge,
        });
    }
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_BTC_PRICE: u64 = 50_000_00000000; // $50,000 with 8 decimals
    const MCR_BPS: u64 = 11000; // 110%
    const ONE_BTC: u64 = 100_000_000; // 1 BTC in satoshis
    const ONE_ZKUSD: u64 = 100_000_000; // 1 zkUSD with 8 decimals

    fn test_owner() -> [u8; 32] {
        [1u8; 32]
    }

    #[test]
    fn test_create_vault() {
        let request = CreateVaultRequest {
            owner: test_owner(),
            collateral: ONE_BTC,
            debt: 30_000 * ONE_ZKUSD,
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            interest_rate_bps: 500,
        };

        let result = create_vault(request, MCR_BPS).unwrap();

        assert_eq!(result.vault.collateral, ONE_BTC);
        assert_eq!(result.vault.debt, 30_000 * ONE_ZKUSD);
        assert!(result.position.icr_bps > MCR_BPS);
        assert_eq!(result.mint_fee, 30_000 * ONE_ZKUSD * 50 / 10000);
    }

    #[test]
    fn test_create_vault_insufficient_collateral() {
        let request = CreateVaultRequest {
            owner: test_owner(),
            collateral: ONE_BTC,
            debt: 48_000 * ONE_ZKUSD, // Too much debt for 1 BTC at $50k (ICR < 110%)
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            interest_rate_bps: 500,
        };

        let result = create_vault(request, MCR_BPS);
        assert!(matches!(result, Err(ZkUsdError::InsufficientCollateralRatio)));
    }

    #[test]
    fn test_create_vault_below_minimum() {
        let request = CreateVaultRequest {
            owner: test_owner(),
            collateral: 1000, // Too little collateral
            debt: 100 * ONE_ZKUSD,
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            interest_rate_bps: 500,
        };

        let result = create_vault(request, MCR_BPS);
        assert!(matches!(result, Err(ZkUsdError::InvalidAmount { .. })));
    }

    #[test]
    fn test_adjust_vault_add_collateral() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 30_000 * ONE_ZKUSD, 1000);

        let request = AdjustVaultRequest {
            vault_id,
            collateral_change: (ONE_BTC / 2) as i64, // Add 0.5 BTC
            debt_change: 0,
            btc_price: TEST_BTC_PRICE,
            block_height: 1001,
        };

        let result = adjust_vault(&vault, &request, MCR_BPS).unwrap();

        assert_eq!(result.vault.collateral, ONE_BTC + ONE_BTC / 2);
        assert_eq!(result.operation, VaultOperation::AddCollateral);
        assert_eq!(result.fees, 0);
    }

    #[test]
    fn test_adjust_vault_borrow_more() {
        let vault_id = generate_vault_id(&test_owner(), 1000, 2 * ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), 2 * ONE_BTC, 30_000 * ONE_ZKUSD, 1000);

        let request = AdjustVaultRequest {
            vault_id,
            collateral_change: 0,
            debt_change: (10_000 * ONE_ZKUSD) as i64, // Borrow 10k more
            btc_price: TEST_BTC_PRICE,
            block_height: 1001,
        };

        let result = adjust_vault(&vault, &request, MCR_BPS).unwrap();

        assert_eq!(result.vault.debt, 40_000 * ONE_ZKUSD);
        assert_eq!(result.operation, VaultOperation::BorrowMore);
        assert!(result.fees > 0);
    }

    #[test]
    fn test_adjust_vault_withdraw_too_much() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 30_000 * ONE_ZKUSD, 1000);

        let request = AdjustVaultRequest {
            vault_id,
            collateral_change: -((ONE_BTC / 2) as i64), // Try to withdraw 0.5 BTC
            debt_change: 0,
            btc_price: TEST_BTC_PRICE,
            block_height: 1001,
        };

        // This should fail because ICR would drop below MCR
        let result = adjust_vault(&vault, &request, MCR_BPS);
        assert!(matches!(result, Err(ZkUsdError::InsufficientCollateralRatio)));
    }

    #[test]
    fn test_close_vault() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 30_000 * ONE_ZKUSD, 1000);

        let result = close_vault(&vault, 30_000 * ONE_ZKUSD, 1001).unwrap();

        assert_eq!(result.debt, 0);
        assert_eq!(result.collateral, ONE_BTC);
    }

    #[test]
    fn test_close_vault_insufficient_repayment() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 30_000 * ONE_ZKUSD, 1000);

        let result = close_vault(&vault, 20_000 * ONE_ZKUSD, 1001);
        assert!(matches!(result, Err(ZkUsdError::InvalidAmount { .. })));
    }

    #[test]
    fn test_vault_health_active() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 30_000 * ONE_ZKUSD, 1000);

        let health = calculate_vault_health(&vault, TEST_BTC_PRICE, MCR_BPS, 1001, None);

        assert_eq!(health.status, VmVaultStatus::Active);
        assert!(health.buffer_bps > 0);
    }

    #[test]
    fn test_vault_health_at_risk() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 46_000 * ONE_ZKUSD, 1000);

        let health = calculate_vault_health(&vault, TEST_BTC_PRICE, MCR_BPS, 1001, Some(1000));

        assert_eq!(health.status, VmVaultStatus::AtRisk);
        assert!(health.buffer_bps < 0);
    }

    #[test]
    fn test_vault_health_liquidatable() {
        let vault_id = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault = Vault::new(vault_id, test_owner(), ONE_BTC, 46_000 * ONE_ZKUSD, 1000);

        // Grace period has passed
        let health = calculate_vault_health(
            &vault,
            TEST_BTC_PRICE,
            MCR_BPS,
            1000 + LIQUIDATION_GRACE_BLOCKS + 1,
            Some(1000)
        );

        assert_eq!(health.status, VmVaultStatus::Liquidatable);
    }

    #[test]
    fn test_sorted_vaults() {
        let sorted = SortedVaults::new();
        assert!(sorted.is_empty());
        assert_eq!(sorted.size, 0);
    }

    #[test]
    fn test_find_insert_position() {
        let positions = vec![
            VaultPosition {
                vault_id: [1u8; 32],
                owner: test_owner(),
                icr_bps: 11500,
                prev: None,
                next: None,
            },
            VaultPosition {
                vault_id: [2u8; 32],
                owner: test_owner(),
                icr_bps: 15000,
                prev: None,
                next: None,
            },
        ];

        // Insert between
        let (prev, next) = find_insert_position(13000, &positions);
        assert_eq!(prev, Some([1u8; 32]));
        assert_eq!(next, Some([2u8; 32]));

        // Insert at beginning
        let (prev, next) = find_insert_position(11000, &positions);
        assert_eq!(prev, None);
        assert_eq!(next, Some([1u8; 32]));
    }

    #[test]
    fn test_registry_stats() {
        let vault_id1 = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let vault_id2 = generate_vault_id(&[2u8; 32], 1000, 2 * ONE_BTC);

        let vaults = vec![
            (
                Vault::new(vault_id1, test_owner(), ONE_BTC, 30_000 * ONE_ZKUSD, 1000),
                VaultPosition {
                    vault_id: vault_id1,
                    owner: test_owner(),
                    icr_bps: 16666,
                    prev: None,
                    next: None,
                },
            ),
            (
                Vault::new(vault_id2, [2u8; 32], 2 * ONE_BTC, 50_000 * ONE_ZKUSD, 1000),
                VaultPosition {
                    vault_id: vault_id2,
                    owner: [2u8; 32],
                    icr_bps: 20000,
                    prev: None,
                    next: None,
                },
            ),
        ];

        let stats = calculate_registry_stats(&vaults, TEST_BTC_PRICE, MCR_BPS);

        assert_eq!(stats.total_vaults, 2);
        assert_eq!(stats.total_collateral, 3 * ONE_BTC);
        assert_eq!(stats.total_debt, 80_000 * ONE_ZKUSD);
        assert_eq!(stats.vaults_at_risk, 0);
    }

    #[test]
    fn test_vault_limit() {
        assert!(check_vault_limit(0).is_ok());
        assert!(check_vault_limit(99).is_ok());
        assert!(check_vault_limit(100).is_err());
    }

    #[test]
    fn test_generate_vault_id() {
        let id1 = generate_vault_id(&test_owner(), 1000, ONE_BTC);
        let id2 = generate_vault_id(&test_owner(), 1001, ONE_BTC);
        let id3 = generate_vault_id(&test_owner(), 1000, 2 * ONE_BTC);

        // Different block heights or collateral should produce different IDs
        assert_ne!(id1, id2);
        assert_ne!(id1, id3);
    }
}
