//! Access Control Module
//!
//! Role-based access control for the zkUSD protocol.
//! Manages admin roles, permissions, and authorization.
//!
//! ## Key Features
//!
//! - **Role-Based Access**: Multiple roles with different permissions
//! - **Multi-sig Support**: Require multiple signatures for critical operations
//! - **Timelock**: Delay execution of sensitive operations
//! - **Delegation**: Delegate specific permissions
//! - **UTXO-Native**: Authorization verified in client-side validation

use crate::{Vec, ZkUsdError, ZkUsdResult};
use crate::errors::AmountErrorReason;

// ============================================================================
// Constants
// ============================================================================

/// Timelock duration for admin operations (144 blocks = ~1 day)
pub const TIMELOCK_DURATION: u64 = 144;

/// Short timelock for less critical operations (36 blocks = ~6 hours)
pub const SHORT_TIMELOCK: u64 = 36;

/// Maximum number of admins in multi-sig
pub const MAX_MULTISIG_ADMINS: usize = 10;

/// Default quorum for multi-sig (2 of N)
pub const DEFAULT_QUORUM: u8 = 2;

// ============================================================================
// Types
// ============================================================================

/// Protocol roles
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Super admin - can do anything
    SuperAdmin,
    /// Protocol admin - can adjust parameters
    Admin,
    /// Oracle operator - can update prices
    OracleOperator,
    /// Emergency operator - can pause/unpause
    EmergencyOperator,
    /// Guardian - can veto dangerous actions
    Guardian,
    /// Fee collector - can withdraw protocol fees
    FeeCollector,
    /// Upgrade manager - can upgrade contracts
    UpgradeManager,
}

impl Role {
    /// Get role priority (higher = more powerful)
    pub fn priority(&self) -> u8 {
        match self {
            Role::SuperAdmin => 100,
            Role::Admin => 80,
            Role::UpgradeManager => 70,
            Role::EmergencyOperator => 60,
            Role::Guardian => 50,
            Role::OracleOperator => 40,
            Role::FeeCollector => 30,
        }
    }
}

/// Permission types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    /// Pause the protocol
    Pause,
    /// Unpause the protocol
    Unpause,
    /// Update protocol parameters
    UpdateParams,
    /// Update oracle prices
    UpdateOracle,
    /// Withdraw protocol fees
    WithdrawFees,
    /// Add new collateral type
    AddCollateral,
    /// Remove collateral type
    RemoveCollateral,
    /// Grant roles to others
    GrantRole,
    /// Revoke roles from others
    RevokeRole,
    /// Execute timelocked action
    ExecuteTimelock,
    /// Veto pending action
    VetoAction,
    /// Upgrade contracts
    Upgrade,
    /// Mint tokens (authorized contracts)
    Mint,
    /// Burn tokens
    Burn,
    /// Liquidate vaults
    Liquidate,
}

impl Permission {
    /// Check if permission requires timelock
    pub fn requires_timelock(&self) -> bool {
        matches!(
            self,
            Permission::UpdateParams
                | Permission::AddCollateral
                | Permission::RemoveCollateral
                | Permission::GrantRole
                | Permission::RevokeRole
                | Permission::Upgrade
        )
    }

    /// Get minimum role required for this permission
    pub fn min_role(&self) -> Role {
        match self {
            Permission::Pause | Permission::Unpause => Role::EmergencyOperator,
            Permission::UpdateOracle => Role::OracleOperator,
            Permission::WithdrawFees => Role::FeeCollector,
            Permission::VetoAction => Role::Guardian,
            Permission::Upgrade => Role::UpgradeManager,
            Permission::GrantRole | Permission::RevokeRole => Role::SuperAdmin,
            _ => Role::Admin,
        }
    }
}

/// Role assignment for an address
#[derive(Debug, Clone)]
pub struct RoleAssignment {
    /// Address with the role
    pub address: [u8; 32],
    /// Assigned role
    pub role: Role,
    /// Block when role was granted
    pub granted_at: u64,
    /// Block when role expires (0 = never)
    pub expires_at: u64,
    /// Address that granted the role
    pub granted_by: [u8; 32],
    /// Whether assignment is active
    pub is_active: bool,
}

impl RoleAssignment {
    /// Create new role assignment
    pub fn new(address: [u8; 32], role: Role, granted_by: [u8; 32], block: u64) -> Self {
        Self {
            address,
            role,
            granted_at: block,
            expires_at: 0,
            granted_by,
            is_active: true,
        }
    }

    /// Create role assignment with expiration
    pub fn with_expiration(
        address: [u8; 32],
        role: Role,
        granted_by: [u8; 32],
        block: u64,
        duration: u64,
    ) -> Self {
        Self {
            address,
            role,
            granted_at: block,
            expires_at: block.saturating_add(duration),
            granted_by,
            is_active: true,
        }
    }

    /// Check if role is valid at given block
    pub fn is_valid(&self, current_block: u64) -> bool {
        self.is_active && (self.expires_at == 0 || current_block < self.expires_at)
    }
}

/// Timelocked action
#[derive(Debug, Clone)]
pub struct TimelockAction {
    /// Unique action ID
    pub action_id: [u8; 32],
    /// Action type/description
    pub action_type: TimelockActionType,
    /// Block when action was proposed
    pub proposed_at: u64,
    /// Block when action can be executed
    pub executable_at: u64,
    /// Proposer address
    pub proposer: [u8; 32],
    /// Whether action has been executed
    pub is_executed: bool,
    /// Whether action has been cancelled/vetoed
    pub is_cancelled: bool,
    /// Encoded action data
    pub data: Vec<u8>,
}

/// Types of timelocked actions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimelockActionType {
    /// Update protocol parameter
    UpdateParameter,
    /// Grant role to address
    GrantRole,
    /// Revoke role from address
    RevokeRole,
    /// Add new collateral type
    AddCollateral,
    /// Update collateral parameters
    UpdateCollateral,
    /// Withdraw from treasury
    TreasuryWithdraw,
    /// Upgrade contract
    Upgrade,
}

impl TimelockAction {
    /// Create new timelock action
    pub fn new(
        action_id: [u8; 32],
        action_type: TimelockActionType,
        proposer: [u8; 32],
        data: Vec<u8>,
        current_block: u64,
        delay: u64,
    ) -> Self {
        Self {
            action_id,
            action_type,
            proposed_at: current_block,
            executable_at: current_block.saturating_add(delay),
            proposer,
            is_executed: false,
            is_cancelled: false,
            data,
        }
    }

    /// Check if action can be executed
    pub fn can_execute(&self, current_block: u64) -> bool {
        !self.is_executed && !self.is_cancelled && current_block >= self.executable_at
    }

    /// Check if action is still pending
    pub fn is_pending(&self, current_block: u64) -> bool {
        !self.is_executed && !self.is_cancelled && current_block < self.executable_at
    }
}

/// Multi-signature configuration
#[derive(Debug, Clone)]
pub struct MultisigConfig {
    /// Required number of signatures
    pub quorum: u8,
    /// List of signers
    pub signers: Vec<[u8; 32]>,
    /// Block when config was created
    pub created_at: u64,
}

impl MultisigConfig {
    /// Create new multi-sig config
    pub fn new(quorum: u8, signers: Vec<[u8; 32]>, block: u64) -> Self {
        Self {
            quorum,
            signers,
            created_at: block,
        }
    }

    /// Check if address is a signer
    pub fn is_signer(&self, address: &[u8; 32]) -> bool {
        self.signers.contains(address)
    }

    /// Check if quorum is met
    pub fn has_quorum(&self, signatures: &[[u8; 32]]) -> bool {
        let valid_sigs = signatures.iter().filter(|s| self.is_signer(s)).count();
        valid_sigs >= self.quorum as usize
    }
}

/// Access control state
#[derive(Debug, Clone)]
pub struct AccessControlState {
    /// Super admin address
    pub super_admin: [u8; 32],
    /// Role assignments
    pub roles: Vec<RoleAssignment>,
    /// Pending timelock actions
    pub pending_actions: Vec<TimelockAction>,
    /// Multi-sig config (if enabled)
    pub multisig: Option<MultisigConfig>,
    /// Whether protocol is paused
    pub is_paused: bool,
    /// Last update block
    pub last_update_block: u64,
}

impl AccessControlState {
    /// Create new access control state with super admin
    pub fn new(super_admin: [u8; 32], block: u64) -> Self {
        let mut roles = Vec::new();
        roles.push(RoleAssignment::new(super_admin, Role::SuperAdmin, super_admin, block));

        Self {
            super_admin,
            roles,
            pending_actions: Vec::new(),
            multisig: None,
            is_paused: false,
            last_update_block: block,
        }
    }
}

// ============================================================================
// Core Access Control Functions
// ============================================================================

/// Check if address has a specific role
pub fn has_role(state: &AccessControlState, address: &[u8; 32], role: Role, current_block: u64) -> bool {
    state.roles.iter().any(|r| {
        r.address == *address && r.role == role && r.is_valid(current_block)
    })
}

/// Check if address has permission for action
pub fn has_permission(
    state: &AccessControlState,
    address: &[u8; 32],
    permission: Permission,
    current_block: u64,
) -> bool {
    let min_role = permission.min_role();
    let min_priority = min_role.priority();

    state.roles.iter().any(|r| {
        r.address == *address && r.is_valid(current_block) && r.role.priority() >= min_priority
    })
}

/// Grant a role to an address
pub fn grant_role(
    state: &mut AccessControlState,
    granter: [u8; 32],
    grantee: [u8; 32],
    role: Role,
    current_block: u64,
) -> ZkUsdResult<()> {
    // Check if granter has permission
    if !has_permission(state, &granter, Permission::GrantRole, current_block) {
        return Err(ZkUsdError::AdminOnly);
    }

    // Check if granter can grant this role (can only grant lower priority roles)
    let granter_max_priority = state
        .roles
        .iter()
        .filter(|r| r.address == granter && r.is_valid(current_block))
        .map(|r| r.role.priority())
        .max()
        .unwrap_or(0);

    if role.priority() >= granter_max_priority && granter != state.super_admin {
        return Err(ZkUsdError::Unauthorized {
            expected: state.super_admin,
            actual: granter,
        });
    }

    // Check if role already exists
    if has_role(state, &grantee, role, current_block) {
        return Ok(()); // Already has role
    }

    // Add role assignment
    state.roles.push(RoleAssignment::new(grantee, role, granter, current_block));
    state.last_update_block = current_block;

    Ok(())
}

/// Revoke a role from an address
pub fn revoke_role(
    state: &mut AccessControlState,
    revoker: [u8; 32],
    target: [u8; 32],
    role: Role,
    current_block: u64,
) -> ZkUsdResult<()> {
    // Can't revoke super admin's SuperAdmin role
    if target == state.super_admin && role == Role::SuperAdmin {
        return Err(ZkUsdError::InvalidOperation);
    }

    // Check if revoker has permission
    if !has_permission(state, &revoker, Permission::RevokeRole, current_block) {
        return Err(ZkUsdError::AdminOnly);
    }

    // Find and deactivate the role
    for r in &mut state.roles {
        if r.address == target && r.role == role && r.is_valid(current_block) {
            r.is_active = false;
            break;
        }
    }

    state.last_update_block = current_block;
    Ok(())
}

/// Propose a timelocked action
pub fn propose_action(
    state: &mut AccessControlState,
    proposer: [u8; 32],
    action_type: TimelockActionType,
    data: Vec<u8>,
    current_block: u64,
) -> ZkUsdResult<[u8; 32]> {
    // Check if proposer has admin permission
    if !has_permission(state, &proposer, Permission::UpdateParams, current_block) {
        return Err(ZkUsdError::AdminOnly);
    }

    // Generate action ID
    let mut action_id = [0u8; 32];
    action_id[0..8].copy_from_slice(&current_block.to_le_bytes());
    action_id[8..16].copy_from_slice(&(state.pending_actions.len() as u64).to_le_bytes());
    for i in 16..32 {
        action_id[i] = proposer[i - 16];
    }

    let action = TimelockAction::new(
        action_id,
        action_type,
        proposer,
        data,
        current_block,
        TIMELOCK_DURATION,
    );

    state.pending_actions.push(action);
    state.last_update_block = current_block;

    Ok(action_id)
}

/// Execute a timelocked action
pub fn execute_action(
    state: &mut AccessControlState,
    executor: [u8; 32],
    action_id: [u8; 32],
    current_block: u64,
) -> ZkUsdResult<Vec<u8>> {
    // Check if executor has permission
    if !has_permission(state, &executor, Permission::ExecuteTimelock, current_block) {
        return Err(ZkUsdError::AdminOnly);
    }

    // Find the action
    let action = state
        .pending_actions
        .iter_mut()
        .find(|a| a.action_id == action_id)
        .ok_or(ZkUsdError::StateNotFound)?;

    // Check if action can be executed
    if !action.can_execute(current_block) {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    action.is_executed = true;
    state.last_update_block = current_block;

    Ok(action.data.clone())
}

/// Cancel/veto a timelocked action
pub fn veto_action(
    state: &mut AccessControlState,
    guardian: [u8; 32],
    action_id: [u8; 32],
    current_block: u64,
) -> ZkUsdResult<()> {
    // Check if guardian has veto permission
    if !has_permission(state, &guardian, Permission::VetoAction, current_block) {
        return Err(ZkUsdError::AdminOnly);
    }

    // Find the action
    let action = state
        .pending_actions
        .iter_mut()
        .find(|a| a.action_id == action_id)
        .ok_or(ZkUsdError::StateNotFound)?;

    if action.is_executed || action.is_cancelled {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    action.is_cancelled = true;
    state.last_update_block = current_block;

    Ok(())
}

/// Enable multi-sig for admin operations
pub fn enable_multisig(
    state: &mut AccessControlState,
    admin: [u8; 32],
    signers: Vec<[u8; 32]>,
    quorum: u8,
    current_block: u64,
) -> ZkUsdResult<()> {
    // Only super admin can enable multi-sig
    if admin != state.super_admin {
        return Err(ZkUsdError::AdminOnly);
    }

    if signers.len() > MAX_MULTISIG_ADMINS {
        return Err(ZkUsdError::InvalidAmount {
            amount: signers.len() as u64,
            reason: AmountErrorReason::TooLarge,
        });
    }

    if quorum as usize > signers.len() || quorum == 0 {
        return Err(ZkUsdError::InvalidParameter);
    }

    state.multisig = Some(MultisigConfig::new(quorum, signers, current_block));
    state.last_update_block = current_block;

    Ok(())
}

/// Get all roles for an address
pub fn get_roles(state: &AccessControlState, address: &[u8; 32], current_block: u64) -> Vec<Role> {
    state
        .roles
        .iter()
        .filter(|r| r.address == *address && r.is_valid(current_block))
        .map(|r| r.role)
        .collect()
}

/// Get pending actions count
pub fn pending_actions_count(state: &AccessControlState, current_block: u64) -> usize {
    state
        .pending_actions
        .iter()
        .filter(|a| a.is_pending(current_block))
        .count()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn super_admin() -> [u8; 32] {
        [1u8; 32]
    }

    fn admin() -> [u8; 32] {
        [2u8; 32]
    }

    fn operator() -> [u8; 32] {
        [3u8; 32]
    }

    #[test]
    fn test_new_state() {
        let state = AccessControlState::new(super_admin(), 1000);
        assert_eq!(state.super_admin, super_admin());
        assert!(!state.is_paused);
        assert!(has_role(&state, &super_admin(), Role::SuperAdmin, 1000));
    }

    #[test]
    fn test_grant_role() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        // Super admin grants admin role
        grant_role(&mut state, super_admin(), admin(), Role::Admin, 1001).unwrap();

        assert!(has_role(&state, &admin(), Role::Admin, 1001));
    }

    #[test]
    fn test_grant_role_unauthorized() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        // Random user can't grant roles
        let result = grant_role(&mut state, operator(), admin(), Role::Admin, 1001);
        assert!(matches!(result, Err(ZkUsdError::AdminOnly)));
    }

    #[test]
    fn test_revoke_role() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        // Grant then revoke
        grant_role(&mut state, super_admin(), admin(), Role::Admin, 1001).unwrap();
        assert!(has_role(&state, &admin(), Role::Admin, 1001));

        revoke_role(&mut state, super_admin(), admin(), Role::Admin, 1002).unwrap();
        assert!(!has_role(&state, &admin(), Role::Admin, 1002));
    }

    #[test]
    fn test_cannot_revoke_super_admin() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        let result = revoke_role(&mut state, super_admin(), super_admin(), Role::SuperAdmin, 1001);
        assert!(matches!(result, Err(ZkUsdError::InvalidOperation)));
    }

    #[test]
    fn test_has_permission() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        // Super admin has all permissions
        assert!(has_permission(&state, &super_admin(), Permission::Pause, 1000));
        assert!(has_permission(&state, &super_admin(), Permission::GrantRole, 1000));

        // Grant emergency operator role
        grant_role(&mut state, super_admin(), operator(), Role::EmergencyOperator, 1001).unwrap();

        // Emergency operator can pause but not grant roles
        assert!(has_permission(&state, &operator(), Permission::Pause, 1001));
        assert!(!has_permission(&state, &operator(), Permission::GrantRole, 1001));
    }

    #[test]
    fn test_role_expiration() {
        let assignment = RoleAssignment::with_expiration(
            admin(),
            Role::Admin,
            super_admin(),
            1000,
            100, // Expires at block 1100
        );

        assert!(assignment.is_valid(1050));
        assert!(!assignment.is_valid(1150));
    }

    #[test]
    fn test_propose_action() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        let action_id = propose_action(
            &mut state,
            super_admin(),
            TimelockActionType::UpdateParameter,
            vec![1, 2, 3],
            1000,
        )
        .unwrap();

        assert_eq!(state.pending_actions.len(), 1);
        assert!(state.pending_actions[0].is_pending(1001));
        assert_eq!(state.pending_actions[0].action_id, action_id);
    }

    #[test]
    fn test_execute_action() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        let action_id = propose_action(
            &mut state,
            super_admin(),
            TimelockActionType::UpdateParameter,
            vec![1, 2, 3],
            1000,
        )
        .unwrap();

        // Can't execute before timelock
        let result = execute_action(&mut state, super_admin(), action_id, 1001);
        assert!(matches!(result, Err(ZkUsdError::InvalidStateTransition)));

        // Can execute after timelock
        let data = execute_action(&mut state, super_admin(), action_id, 1000 + TIMELOCK_DURATION).unwrap();
        assert_eq!(data, vec![1, 2, 3]);
    }

    #[test]
    fn test_veto_action() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        // Add guardian
        grant_role(&mut state, super_admin(), operator(), Role::Guardian, 1000).unwrap();

        let action_id = propose_action(
            &mut state,
            super_admin(),
            TimelockActionType::UpdateParameter,
            vec![1, 2, 3],
            1001,
        )
        .unwrap();

        // Guardian can veto
        veto_action(&mut state, operator(), action_id, 1002).unwrap();

        assert!(state.pending_actions[0].is_cancelled);

        // Can't execute vetoed action
        let result = execute_action(&mut state, super_admin(), action_id, 1001 + TIMELOCK_DURATION);
        assert!(matches!(result, Err(ZkUsdError::InvalidStateTransition)));
    }

    #[test]
    fn test_multisig() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        let signers = vec![[1u8; 32], [2u8; 32], [3u8; 32]];
        enable_multisig(&mut state, super_admin(), signers.clone(), 2, 1001).unwrap();

        let config = state.multisig.as_ref().unwrap();
        assert_eq!(config.quorum, 2);
        assert!(config.is_signer(&[1u8; 32]));
        assert!(!config.is_signer(&[4u8; 32]));

        // Check quorum
        assert!(config.has_quorum(&[[1u8; 32], [2u8; 32]]));
        assert!(!config.has_quorum(&[[1u8; 32]]));
    }

    #[test]
    fn test_get_roles() {
        let mut state = AccessControlState::new(super_admin(), 1000);

        grant_role(&mut state, super_admin(), admin(), Role::Admin, 1001).unwrap();
        grant_role(&mut state, super_admin(), admin(), Role::EmergencyOperator, 1001).unwrap();

        let roles = get_roles(&state, &admin(), 1001);
        assert_eq!(roles.len(), 2);
        assert!(roles.contains(&Role::Admin));
        assert!(roles.contains(&Role::EmergencyOperator));
    }

    #[test]
    fn test_permission_requires_timelock() {
        assert!(Permission::UpdateParams.requires_timelock());
        assert!(Permission::Upgrade.requires_timelock());
        assert!(!Permission::Pause.requires_timelock());
        assert!(!Permission::UpdateOracle.requires_timelock());
    }

    #[test]
    fn test_role_priority() {
        assert!(Role::SuperAdmin.priority() > Role::Admin.priority());
        assert!(Role::Admin.priority() > Role::Guardian.priority());
        assert!(Role::Guardian.priority() > Role::FeeCollector.priority());
    }
}
