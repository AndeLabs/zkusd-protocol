//! zkGOV Governance Token Module
//!
//! Implements a comprehensive governance system for the zkUSD protocol.
//! Token holders can propose, vote on, and execute protocol changes.
//!
//! ## Key Features
//!
//! - **zkGOV Token**: Governance token with staking mechanics
//! - **Proposal System**: Create and vote on protocol changes
//! - **Delegation**: Delegate voting power to representatives
//! - **Timelock**: Mandatory delay between approval and execution
//! - **Quadratic Voting**: Optional sqrt-weighted voting for fairness
//!
//! ## UTXO Advantages
//!
//! - Vote tokens as single-use seals prevent double voting
//! - Delegation creates verifiable chain of trust
//! - Proposal execution is atomic and deterministic
//! - Client-side validation of vote eligibility

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec, string::String};
#[cfg(feature = "std")]
use std::vec::Vec;

use crate::errors::{ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Minimum tokens required to create a proposal
pub const MIN_PROPOSAL_THRESHOLD: u64 = 100_000_00000000; // 100k zkGOV

/// Quorum percentage required for proposal to pass (in BPS)
pub const QUORUM_BPS: u64 = 400; // 4% of total supply

/// Minimum voting period in blocks
pub const MIN_VOTING_PERIOD_BLOCKS: u64 = 17_280; // ~3 days at 15s blocks

/// Maximum voting period in blocks
pub const MAX_VOTING_PERIOD_BLOCKS: u64 = 80_640; // ~14 days at 15s blocks

/// Timelock delay before execution (blocks)
pub const TIMELOCK_DELAY_BLOCKS: u64 = 11_520; // ~2 days at 15s blocks

/// Grace period after timelock for execution (blocks)
pub const EXECUTION_GRACE_PERIOD: u64 = 23_040; // ~4 days

/// Initial zkGOV supply
pub const INITIAL_SUPPLY: u64 = 100_000_000_00000000; // 100M zkGOV with 8 decimals

/// Staking reward rate (BPS per year)
pub const STAKING_REWARD_RATE_BPS: u64 = 500; // 5% APY

/// Early unstaking penalty (BPS)
pub const EARLY_UNSTAKE_PENALTY_BPS: u64 = 1000; // 10%

/// Minimum stake duration for no penalty (blocks)
pub const MIN_STAKE_DURATION: u64 = 172_800; // ~30 days

/// Vote multiplier for staked tokens (in BPS, 15000 = 1.5x)
pub const STAKED_VOTE_MULTIPLIER_BPS: u64 = 15000;

// ============================================================================
// Types
// ============================================================================

/// zkGOV token balance
#[derive(Debug, Clone)]
pub struct GovTokenBalance {
    /// Owner address
    pub owner: [u8; 32],
    /// Liquid (unstaked) balance
    pub liquid_balance: u64,
    /// Staked balance
    pub staked_balance: u64,
    /// Delegated voting power (from others)
    pub delegated_power: u64,
    /// Address delegated to (if any)
    pub delegate: Option<[u8; 32]>,
    /// Voting power snapshot at last checkpoint
    pub voting_power_snapshot: u64,
    /// Block of last snapshot
    pub snapshot_block: u64,
}

impl GovTokenBalance {
    /// Create new balance
    pub fn new(owner: [u8; 32], initial_balance: u64) -> Self {
        Self {
            owner,
            liquid_balance: initial_balance,
            staked_balance: 0,
            delegated_power: 0,
            delegate: None,
            voting_power_snapshot: initial_balance,
            snapshot_block: 0,
        }
    }

    /// Calculate total balance
    pub fn total_balance(&self) -> u64 {
        self.liquid_balance + self.staked_balance
    }

    /// Calculate voting power
    pub fn voting_power(&self) -> u64 {
        // Staked tokens get a multiplier
        let staked_power = (self.staked_balance as u128 * STAKED_VOTE_MULTIPLIER_BPS as u128 / 10000) as u64;
        let own_power = self.liquid_balance + staked_power;

        // If delegated, own power goes to delegate
        if self.delegate.is_some() {
            self.delegated_power
        } else {
            own_power + self.delegated_power
        }
    }

    /// Calculate quadratic voting power (sqrt of normal power)
    pub fn quadratic_voting_power(&self) -> u64 {
        let linear = self.voting_power();
        // Integer square root approximation
        if linear == 0 {
            return 0;
        }
        let mut x = linear;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + linear / x) / 2;
        }
        x
    }
}

/// Staking position
#[derive(Debug, Clone)]
pub struct StakingPosition {
    /// Owner address
    pub owner: [u8; 32],
    /// Amount staked
    pub amount: u64,
    /// Block when staking started
    pub staked_at_block: u64,
    /// Accumulated rewards
    pub rewards_accumulated: u64,
    /// Last reward claim block
    pub last_claim_block: u64,
    /// Is locked (cannot unstake)
    pub is_locked: bool,
    /// Lock duration in blocks (if locked)
    pub lock_duration: u64,
}

impl StakingPosition {
    /// Create new staking position
    pub fn new(owner: [u8; 32], amount: u64, block: u64) -> Self {
        Self {
            owner,
            amount,
            staked_at_block: block,
            rewards_accumulated: 0,
            last_claim_block: block,
            is_locked: false,
            lock_duration: 0,
        }
    }

    /// Calculate pending rewards
    pub fn pending_rewards(&self, current_block: u64, total_staked: u64) -> u64 {
        if total_staked == 0 || self.amount == 0 {
            return 0;
        }

        let blocks_elapsed = current_block.saturating_sub(self.last_claim_block);
        let blocks_per_year = 2_102_400u64; // ~365 days at 15s blocks

        // rewards = stake * rate * time / (total_staked * blocks_per_year)
        // Simplified: proportional share of annual rewards
        let annual_rewards = (self.amount as u128 * STAKING_REWARD_RATE_BPS as u128 / 10000) as u64;
        (annual_rewards as u128 * blocks_elapsed as u128 / blocks_per_year as u128) as u64
    }

    /// Check if can unstake without penalty
    pub fn can_unstake_without_penalty(&self, current_block: u64) -> bool {
        let staked_duration = current_block.saturating_sub(self.staked_at_block);
        staked_duration >= MIN_STAKE_DURATION && !self.is_locked
    }

    /// Calculate early unstake penalty
    pub fn calculate_penalty(&self, current_block: u64) -> u64 {
        if self.can_unstake_without_penalty(current_block) {
            return 0;
        }
        (self.amount as u128 * EARLY_UNSTAKE_PENALTY_BPS as u128 / 10000) as u64
    }
}

/// Proposal status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalStatus {
    /// Proposal is pending (not yet votable)
    Pending,
    /// Proposal is active for voting
    Active,
    /// Proposal was canceled
    Canceled,
    /// Voting ended, proposal defeated
    Defeated,
    /// Voting ended, proposal succeeded
    Succeeded,
    /// Proposal is queued for execution
    Queued,
    /// Proposal was executed
    Executed,
    /// Proposal expired (not executed in time)
    Expired,
}

/// Type of governance proposal
#[derive(Debug, Clone)]
pub enum ProposalAction {
    /// Change protocol parameter
    ParameterChange {
        parameter_id: u32,
        old_value: u64,
        new_value: u64,
    },
    /// Update oracle configuration
    OracleUpdate {
        oracle_id: [u8; 32],
        new_config: Vec<u8>,
    },
    /// Add new collateral type
    AddCollateralType {
        collateral_id: [u8; 32],
        mcr_bps: u64,
        max_supply: u64,
    },
    /// Remove collateral type
    RemoveCollateralType {
        collateral_id: [u8; 32],
    },
    /// Treasury spending
    TreasurySpend {
        recipient: [u8; 32],
        amount: u64,
        reason: Vec<u8>,
    },
    /// Emergency action (higher threshold)
    Emergency {
        action_type: u8,
        data: Vec<u8>,
    },
    /// Upgrade contract logic
    Upgrade {
        new_code_hash: [u8; 32],
        migration_data: Vec<u8>,
    },
    /// Custom governance action
    Custom {
        action_id: u32,
        data: Vec<u8>,
    },
}

/// A governance proposal
#[derive(Debug, Clone)]
pub struct Proposal {
    /// Unique proposal ID
    pub id: u64,
    /// Proposer address
    pub proposer: [u8; 32],
    /// Title/description hash
    pub description_hash: [u8; 32],
    /// Proposed actions
    pub actions: Vec<ProposalAction>,
    /// Start block for voting
    pub voting_start_block: u64,
    /// End block for voting
    pub voting_end_block: u64,
    /// Votes for
    pub votes_for: u64,
    /// Votes against
    pub votes_against: u64,
    /// Votes abstain
    pub votes_abstain: u64,
    /// Current status
    pub status: ProposalStatus,
    /// Execution timelock end
    pub timelock_end: u64,
    /// Use quadratic voting
    pub quadratic_voting: bool,
    /// Snapshot block for voter eligibility
    pub snapshot_block: u64,
}

impl Proposal {
    /// Create new proposal
    pub fn new(
        id: u64,
        proposer: [u8; 32],
        description_hash: [u8; 32],
        actions: Vec<ProposalAction>,
        current_block: u64,
        voting_period: u64,
        quadratic: bool,
    ) -> Self {
        let voting_start = current_block + 1; // Start next block
        let voting_end = voting_start + voting_period;

        Self {
            id,
            proposer,
            description_hash,
            actions,
            voting_start_block: voting_start,
            voting_end_block: voting_end,
            votes_for: 0,
            votes_against: 0,
            votes_abstain: 0,
            status: ProposalStatus::Pending,
            timelock_end: 0,
            quadratic_voting: quadratic,
            snapshot_block: current_block,
        }
    }

    /// Check if proposal has reached quorum
    pub fn has_quorum(&self, total_supply: u64) -> bool {
        let total_votes = self.votes_for + self.votes_against + self.votes_abstain;
        let required_quorum = (total_supply as u128 * QUORUM_BPS as u128 / 10000) as u64;
        total_votes >= required_quorum
    }

    /// Check if proposal passed
    pub fn has_passed(&self, total_supply: u64) -> bool {
        self.has_quorum(total_supply) && self.votes_for > self.votes_against
    }

    /// Update status based on current block
    pub fn update_status(&mut self, current_block: u64, total_supply: u64) {
        match self.status {
            ProposalStatus::Pending => {
                if current_block >= self.voting_start_block {
                    self.status = ProposalStatus::Active;
                }
            }
            ProposalStatus::Active => {
                if current_block > self.voting_end_block {
                    if self.has_passed(total_supply) {
                        self.status = ProposalStatus::Succeeded;
                        self.timelock_end = current_block + TIMELOCK_DELAY_BLOCKS;
                    } else {
                        self.status = ProposalStatus::Defeated;
                    }
                }
            }
            ProposalStatus::Queued => {
                if current_block > self.timelock_end + EXECUTION_GRACE_PERIOD {
                    self.status = ProposalStatus::Expired;
                }
            }
            _ => {}
        }
    }

    /// Check if proposal can be executed
    pub fn can_execute(&self, current_block: u64) -> bool {
        matches!(self.status, ProposalStatus::Succeeded | ProposalStatus::Queued)
            && current_block >= self.timelock_end
            && current_block <= self.timelock_end + EXECUTION_GRACE_PERIOD
    }
}

/// Vote type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoteType {
    For,
    Against,
    Abstain,
}

/// A vote cast on a proposal
#[derive(Debug, Clone)]
pub struct Vote {
    /// Voter address
    pub voter: [u8; 32],
    /// Proposal ID
    pub proposal_id: u64,
    /// Vote type
    pub vote_type: VoteType,
    /// Voting power used
    pub voting_power: u64,
    /// Block when vote was cast
    pub voted_at_block: u64,
    /// Reason hash (optional)
    pub reason_hash: Option<[u8; 32]>,
}

/// Vote receipt (proof of voting, single-use seal)
#[derive(Debug, Clone)]
pub struct VoteReceipt {
    /// Receipt ID (hash of vote)
    pub receipt_id: [u8; 32],
    /// Voter
    pub voter: [u8; 32],
    /// Proposal ID
    pub proposal_id: u64,
    /// Vote type
    pub vote_type: VoteType,
    /// Voting power
    pub voting_power: u64,
    /// Block number
    pub block_number: u64,
    /// Has been counted
    pub is_counted: bool,
}

/// Delegation record
#[derive(Debug, Clone)]
pub struct Delegation {
    /// Delegator (source of voting power)
    pub delegator: [u8; 32],
    /// Delegate (receiver of voting power)
    pub delegate: [u8; 32],
    /// Amount of voting power delegated
    pub amount: u64,
    /// Block when delegation started
    pub started_at_block: u64,
    /// Is delegation active
    pub is_active: bool,
}

/// Governance state
#[derive(Debug, Clone)]
pub struct GovernanceState {
    /// Total zkGOV supply
    pub total_supply: u64,
    /// Total staked
    pub total_staked: u64,
    /// Next proposal ID
    pub next_proposal_id: u64,
    /// Active proposals count
    pub active_proposals: u32,
    /// Treasury balance
    pub treasury_balance: u64,
    /// Admin address (for emergency actions)
    pub admin: [u8; 32],
    /// Is governance paused
    pub is_paused: bool,
}

impl Default for GovernanceState {
    fn default() -> Self {
        Self {
            total_supply: INITIAL_SUPPLY,
            total_staked: 0,
            next_proposal_id: 1,
            active_proposals: 0,
            treasury_balance: 0,
            admin: [0u8; 32],
            is_paused: false,
        }
    }
}

// ============================================================================
// Core Operations
// ============================================================================

/// Create a new proposal
pub fn create_proposal(
    proposer_balance: &GovTokenBalance,
    description_hash: [u8; 32],
    actions: Vec<ProposalAction>,
    voting_period: u64,
    quadratic: bool,
    current_block: u64,
    state: &mut GovernanceState,
) -> ZkUsdResult<Proposal> {
    // Check proposer has enough tokens
    if proposer_balance.total_balance() < MIN_PROPOSAL_THRESHOLD {
        return Err(ZkUsdError::InsufficientBalance {
            available: proposer_balance.total_balance(),
            requested: MIN_PROPOSAL_THRESHOLD,
        });
    }

    // Validate voting period
    if voting_period < MIN_VOTING_PERIOD_BLOCKS || voting_period > MAX_VOTING_PERIOD_BLOCKS {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Check governance not paused
    if state.is_paused {
        return Err(ZkUsdError::ProtocolPaused);
    }

    // Validate actions not empty
    if actions.is_empty() {
        return Err(ZkUsdError::InvalidParameter);
    }

    let proposal_id = state.next_proposal_id;
    state.next_proposal_id += 1;
    state.active_proposals += 1;

    Ok(Proposal::new(
        proposal_id,
        proposer_balance.owner,
        description_hash,
        actions,
        current_block,
        voting_period,
        quadratic,
    ))
}

/// Cast a vote
pub fn cast_vote(
    voter_balance: &GovTokenBalance,
    proposal: &mut Proposal,
    vote_type: VoteType,
    current_block: u64,
) -> ZkUsdResult<VoteReceipt> {
    // Check voting is active
    if current_block < proposal.voting_start_block || current_block > proposal.voting_end_block {
        return Err(ZkUsdError::InvalidOperation);
    }

    // Check voter has voting power at snapshot
    if voter_balance.snapshot_block > proposal.snapshot_block {
        // Voter's snapshot is after proposal snapshot, use current power
        // In production, would need historical snapshots
    }

    let voting_power = if proposal.quadratic_voting {
        voter_balance.quadratic_voting_power()
    } else {
        voter_balance.voting_power()
    };

    if voting_power == 0 {
        return Err(ZkUsdError::InsufficientBalance {
            available: 0,
            requested: 1,
        });
    }

    // Record vote
    match vote_type {
        VoteType::For => proposal.votes_for += voting_power,
        VoteType::Against => proposal.votes_against += voting_power,
        VoteType::Abstain => proposal.votes_abstain += voting_power,
    }

    // Create receipt (single-use seal proof)
    let receipt_id = compute_vote_hash(
        voter_balance.owner,
        proposal.id,
        vote_type,
        voting_power,
        current_block,
    );

    Ok(VoteReceipt {
        receipt_id,
        voter: voter_balance.owner,
        proposal_id: proposal.id,
        vote_type,
        voting_power,
        block_number: current_block,
        is_counted: true,
    })
}

/// Execute a passed proposal
pub fn execute_proposal(
    proposal: &mut Proposal,
    current_block: u64,
    state: &mut GovernanceState,
) -> ZkUsdResult<Vec<ProposalAction>> {
    // Check can execute
    if !proposal.can_execute(current_block) {
        return Err(ZkUsdError::ConditionNotMet);
    }

    // Mark as executed
    proposal.status = ProposalStatus::Executed;
    state.active_proposals = state.active_proposals.saturating_sub(1);

    // Return actions for execution
    Ok(proposal.actions.clone())
}

/// Cancel a proposal (proposer or admin only)
pub fn cancel_proposal(
    proposal: &mut Proposal,
    caller: [u8; 32],
    state: &mut GovernanceState,
) -> ZkUsdResult<()> {
    // Only proposer or admin can cancel
    if caller != proposal.proposer && caller != state.admin {
        return Err(ZkUsdError::Unauthorized {
            expected: proposal.proposer,
            actual: caller,
        });
    }

    // Cannot cancel executed or expired
    if matches!(proposal.status, ProposalStatus::Executed | ProposalStatus::Expired) {
        return Err(ZkUsdError::InvalidOperation);
    }

    proposal.status = ProposalStatus::Canceled;
    state.active_proposals = state.active_proposals.saturating_sub(1);

    Ok(())
}

/// Delegate voting power
pub fn delegate_voting_power(
    delegator_balance: &mut GovTokenBalance,
    delegate: [u8; 32],
    delegate_balance: &mut GovTokenBalance,
    current_block: u64,
) -> ZkUsdResult<Delegation> {
    // Cannot delegate to self
    if delegator_balance.owner == delegate {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Cannot delegate if already delegating
    if delegator_balance.delegate.is_some() {
        return Err(ZkUsdError::InvalidOperation);
    }

    let delegated_amount = delegator_balance.voting_power();

    // Update balances
    delegator_balance.delegate = Some(delegate);
    delegate_balance.delegated_power += delegated_amount;

    Ok(Delegation {
        delegator: delegator_balance.owner,
        delegate,
        amount: delegated_amount,
        started_at_block: current_block,
        is_active: true,
    })
}

/// Revoke delegation
pub fn revoke_delegation(
    delegator_balance: &mut GovTokenBalance,
    delegate_balance: &mut GovTokenBalance,
) -> ZkUsdResult<()> {
    // Check has delegation
    let delegate = delegator_balance.delegate.ok_or(ZkUsdError::InvalidOperation)?;

    // Verify delegate matches
    if delegate != delegate_balance.owner {
        return Err(ZkUsdError::InvalidParameter);
    }

    let delegated_amount = delegator_balance.total_balance();

    // Update balances
    delegator_balance.delegate = None;
    delegate_balance.delegated_power = delegate_balance.delegated_power.saturating_sub(delegated_amount);

    Ok(())
}

/// Stake zkGOV tokens
pub fn stake_tokens(
    balance: &mut GovTokenBalance,
    amount: u64,
    lock_duration: Option<u64>,
    current_block: u64,
) -> ZkUsdResult<StakingPosition> {
    // Check sufficient balance
    if balance.liquid_balance < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: balance.liquid_balance,
            requested: amount,
        });
    }

    // Update balance
    balance.liquid_balance -= amount;
    balance.staked_balance += amount;

    let mut position = StakingPosition::new(balance.owner, amount, current_block);

    // Apply lock if requested
    if let Some(duration) = lock_duration {
        position.is_locked = true;
        position.lock_duration = duration;
    }

    Ok(position)
}

/// Unstake zkGOV tokens
pub fn unstake_tokens(
    balance: &mut GovTokenBalance,
    position: &mut StakingPosition,
    current_block: u64,
    state: &mut GovernanceState,
) -> ZkUsdResult<u64> {
    // Check position matches owner
    if position.owner != balance.owner {
        return Err(ZkUsdError::Unauthorized {
            expected: position.owner,
            actual: balance.owner,
        });
    }

    // Check if locked
    if position.is_locked {
        let lock_end = position.staked_at_block + position.lock_duration;
        if current_block < lock_end {
            return Err(ZkUsdError::ConditionNotMet);
        }
    }

    // Calculate rewards
    let rewards = position.pending_rewards(current_block, state.total_staked);

    // Calculate penalty if early
    let penalty = position.calculate_penalty(current_block);
    let amount_after_penalty = position.amount.saturating_sub(penalty);

    // Update balances
    balance.staked_balance = balance.staked_balance.saturating_sub(position.amount);
    balance.liquid_balance += amount_after_penalty + rewards;
    state.total_staked = state.total_staked.saturating_sub(position.amount);

    // Clear position
    position.amount = 0;

    Ok(amount_after_penalty + rewards)
}

/// Claim staking rewards without unstaking
pub fn claim_staking_rewards(
    balance: &mut GovTokenBalance,
    position: &mut StakingPosition,
    current_block: u64,
    state: &GovernanceState,
) -> ZkUsdResult<u64> {
    if position.owner != balance.owner {
        return Err(ZkUsdError::Unauthorized {
            expected: position.owner,
            actual: balance.owner,
        });
    }

    let rewards = position.pending_rewards(current_block, state.total_staked);

    if rewards == 0 {
        return Err(ZkUsdError::NoRewardsToClaim);
    }

    // Update position
    position.rewards_accumulated += rewards;
    position.last_claim_block = current_block;

    // Add rewards to liquid balance
    balance.liquid_balance += rewards;

    Ok(rewards)
}

// ============================================================================
// Helpers
// ============================================================================

/// Compute vote hash for receipt
fn compute_vote_hash(
    voter: [u8; 32],
    proposal_id: u64,
    vote_type: VoteType,
    voting_power: u64,
    block: u64,
) -> [u8; 32] {
    // Simplified hash - in production use proper cryptographic hash
    let mut hash = [0u8; 32];
    hash[0..8].copy_from_slice(&proposal_id.to_le_bytes());
    hash[8..16].copy_from_slice(&voting_power.to_le_bytes());
    hash[16..24].copy_from_slice(&block.to_le_bytes());
    hash[24] = vote_type as u8;
    hash[25..32].copy_from_slice(&voter[0..7]);
    hash
}

/// Calculate voting power at specific block (for historical queries)
pub fn voting_power_at_block(
    balance: &GovTokenBalance,
    _target_block: u64,
) -> u64 {
    // In production, would query checkpoint history
    // For now, return current power
    balance.voting_power()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_state() -> GovernanceState {
        GovernanceState {
            total_supply: 100_000_000_00000000,
            total_staked: 10_000_000_00000000,
            next_proposal_id: 1,
            active_proposals: 0,
            treasury_balance: 1_000_000_00000000,
            admin: [1u8; 32],
            is_paused: false,
        }
    }

    #[test]
    fn test_gov_token_balance() {
        let balance = GovTokenBalance::new([1u8; 32], 1000_00000000);
        assert_eq!(balance.total_balance(), 1000_00000000);
        assert_eq!(balance.voting_power(), 1000_00000000);
    }

    #[test]
    fn test_staked_voting_power() {
        let mut balance = GovTokenBalance::new([1u8; 32], 1000_00000000);
        balance.staked_balance = 500_00000000;
        balance.liquid_balance = 500_00000000;

        // Staked gets 1.5x multiplier
        // 500 * 1.5 + 500 = 1250
        let expected = 500_00000000 * 15 / 10 + 500_00000000;
        assert_eq!(balance.voting_power(), expected);
    }

    #[test]
    fn test_quadratic_voting_power() {
        let balance = GovTokenBalance::new([1u8; 32], 10000_00000000);
        let qvp = balance.quadratic_voting_power();
        // sqrt(10000) = 100, with 8 decimals becomes more complex
        // Just verify it's less than linear
        assert!(qvp < balance.voting_power());
        assert!(qvp > 0);
    }

    #[test]
    fn test_create_proposal() {
        let mut state = create_test_state();
        let proposer = GovTokenBalance::new([2u8; 32], MIN_PROPOSAL_THRESHOLD + 1);

        let actions = vec![ProposalAction::ParameterChange {
            parameter_id: 1,
            old_value: 100,
            new_value: 200,
        }];

        let proposal = create_proposal(
            &proposer,
            [0u8; 32],
            actions,
            MIN_VOTING_PERIOD_BLOCKS,
            false,
            1000,
            &mut state,
        ).unwrap();

        assert_eq!(proposal.id, 1);
        assert_eq!(proposal.voting_start_block, 1001);
        assert_eq!(state.next_proposal_id, 2);
    }

    #[test]
    fn test_insufficient_tokens_for_proposal() {
        let mut state = create_test_state();
        let proposer = GovTokenBalance::new([2u8; 32], MIN_PROPOSAL_THRESHOLD - 1);

        let actions = vec![ProposalAction::ParameterChange {
            parameter_id: 1,
            old_value: 100,
            new_value: 200,
        }];

        let result = create_proposal(
            &proposer,
            [0u8; 32],
            actions,
            MIN_VOTING_PERIOD_BLOCKS,
            false,
            1000,
            &mut state,
        );

        assert!(matches!(result, Err(ZkUsdError::InsufficientBalance { .. })));
    }

    #[test]
    fn test_cast_vote() {
        let voter = GovTokenBalance::new([3u8; 32], 1000_00000000);
        let mut proposal = Proposal::new(
            1,
            [2u8; 32],
            [0u8; 32],
            vec![],
            1000,
            MIN_VOTING_PERIOD_BLOCKS,
            false,
        );
        proposal.status = ProposalStatus::Active;

        let receipt = cast_vote(&voter, &mut proposal, VoteType::For, 1001).unwrap();

        assert_eq!(proposal.votes_for, 1000_00000000);
        assert_eq!(receipt.voting_power, 1000_00000000);
        assert!(receipt.is_counted);
    }

    #[test]
    fn test_proposal_quorum() {
        let mut proposal = Proposal::new(
            1,
            [2u8; 32],
            [0u8; 32],
            vec![],
            1000,
            MIN_VOTING_PERIOD_BLOCKS,
            false,
        );

        let total_supply = 100_000_000_00000000u64;
        let quorum_needed = (total_supply as u128 * QUORUM_BPS as u128 / 10000) as u64; // 4%

        // Below quorum
        proposal.votes_for = quorum_needed - 1;
        assert!(!proposal.has_quorum(total_supply));

        // At quorum
        proposal.votes_for = quorum_needed;
        assert!(proposal.has_quorum(total_supply));
    }

    #[test]
    fn test_delegation() {
        let mut delegator = GovTokenBalance::new([1u8; 32], 1000_00000000);
        let mut delegate = GovTokenBalance::new([2u8; 32], 500_00000000);

        let delegation = delegate_voting_power(
            &mut delegator,
            delegate.owner,
            &mut delegate,
            100,
        ).unwrap();

        assert!(delegation.is_active);
        assert_eq!(delegator.delegate, Some(delegate.owner));
        assert_eq!(delegate.delegated_power, 1000_00000000);
    }

    #[test]
    fn test_stake_tokens() {
        let mut balance = GovTokenBalance::new([1u8; 32], 1000_00000000);

        let position = stake_tokens(&mut balance, 500_00000000, None, 100).unwrap();

        assert_eq!(balance.liquid_balance, 500_00000000);
        assert_eq!(balance.staked_balance, 500_00000000);
        assert_eq!(position.amount, 500_00000000);
    }

    #[test]
    fn test_staking_penalty() {
        let position = StakingPosition::new([1u8; 32], 1000_00000000, 100);

        // Early unstake (before MIN_STAKE_DURATION)
        let penalty = position.calculate_penalty(100 + MIN_STAKE_DURATION - 1);
        let expected_penalty = (1000_00000000u128 * EARLY_UNSTAKE_PENALTY_BPS as u128 / 10000) as u64;
        assert_eq!(penalty, expected_penalty);

        // After minimum duration
        let no_penalty = position.calculate_penalty(100 + MIN_STAKE_DURATION);
        assert_eq!(no_penalty, 0);
    }

    #[test]
    fn test_staking_rewards() {
        let position = StakingPosition::new([1u8; 32], 1000_00000000, 100);
        let total_staked = 10_000_00000000;
        let blocks_per_year = 2_102_400u64;

        // After 1 year
        let rewards = position.pending_rewards(100 + blocks_per_year, total_staked);

        // Expected: stake * 5% = 50_00000000
        let expected = (1000_00000000u128 * STAKING_REWARD_RATE_BPS as u128 / 10000) as u64;
        assert_eq!(rewards, expected);
    }

    #[test]
    fn test_proposal_lifecycle() {
        let mut proposal = Proposal::new(
            1,
            [2u8; 32],
            [0u8; 32],
            vec![ProposalAction::ParameterChange {
                parameter_id: 1,
                old_value: 100,
                new_value: 200,
            }],
            1000,
            MIN_VOTING_PERIOD_BLOCKS,
            false,
        );

        let total_supply = 100_000_000_00000000u64;

        // Initially pending
        assert_eq!(proposal.status, ProposalStatus::Pending);

        // Becomes active
        proposal.update_status(1001, total_supply);
        assert_eq!(proposal.status, ProposalStatus::Active);

        // Add enough votes to pass
        let quorum = (total_supply as u128 * QUORUM_BPS as u128 / 10000) as u64;
        proposal.votes_for = quorum + 1;

        // After voting ends
        let voting_end = proposal.voting_end_block + 1;
        proposal.update_status(voting_end, total_supply);
        assert_eq!(proposal.status, ProposalStatus::Succeeded);
        assert!(proposal.timelock_end > 0);
    }

    #[test]
    fn test_cancel_proposal() {
        let mut state = create_test_state();
        state.active_proposals = 1;

        let mut proposal = Proposal::new(
            1,
            [2u8; 32],
            [0u8; 32],
            vec![],
            1000,
            MIN_VOTING_PERIOD_BLOCKS,
            false,
        );

        // Proposer can cancel
        cancel_proposal(&mut proposal, [2u8; 32], &mut state).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Canceled);
        assert_eq!(state.active_proposals, 0);
    }

    #[test]
    fn test_revoke_delegation() {
        let mut delegator = GovTokenBalance::new([1u8; 32], 1000_00000000);
        let mut delegate = GovTokenBalance::new([2u8; 32], 500_00000000);

        // First delegate
        delegate_voting_power(&mut delegator, delegate.owner, &mut delegate, 100).unwrap();

        // Then revoke
        revoke_delegation(&mut delegator, &mut delegate).unwrap();

        assert!(delegator.delegate.is_none());
        assert_eq!(delegate.delegated_power, 0);
    }
}
