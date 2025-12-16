//! Cross-chain Beaming Module
//!
//! Enables zkUSD to move between Bitcoin and other chains using
//! client-side validation, ZK proofs, and atomic swaps.
//!
//! ## Key Features
//!
//! - **Beam Out**: Lock zkUSD on Bitcoin, mint on target chain
//! - **Beam In**: Burn on source chain, unlock on Bitcoin
//! - **ZK Bridges**: Prove state transitions across chains
//! - **Atomic Cross-chain Swaps**: Exchange zkUSD across chains
//!
//! ## Supported Chains
//!
//! - Bitcoin (home chain)
//! - Ethereum / EVM chains
//! - Solana
//! - Cosmos ecosystem
//! - Other UTXO chains
//!
//! ## Security Model
//!
//! - Client-side validation for origin proofs
//! - ZK-SNARKs for state transition validity
//! - Time-locked escrows for safety
//! - Multi-sig federation fallback

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};
#[cfg(feature = "std")]
#[allow(unused_imports)]
use std::vec::Vec;

use crate::errors::{ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Minimum beam amount
pub const MIN_BEAM_AMOUNT: u64 = 100_00000000; // $100

/// Maximum beam amount per transaction
pub const MAX_BEAM_AMOUNT: u64 = 10_000_000_00000000; // $10M

/// Beam fee base (BPS)
pub const BEAM_FEE_BPS: u64 = 30; // 0.3%

/// Challenge period for incoming beams (blocks)
pub const CHALLENGE_PERIOD_BLOCKS: u64 = 144; // ~1 day on Bitcoin

/// Timeout for beam operations (blocks)
pub const BEAM_TIMEOUT_BLOCKS: u64 = 1008; // ~1 week

/// Maximum pending beams per user
pub const MAX_PENDING_BEAMS: usize = 10;

// ============================================================================
// Types
// ============================================================================

/// Supported chains for beaming
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Chain {
    /// Bitcoin mainnet (home chain)
    Bitcoin,
    /// Ethereum mainnet
    Ethereum,
    /// Arbitrum
    ArbitrumOne,
    /// Optimism
    Optimism,
    /// Base
    Base,
    /// Polygon
    Polygon,
    /// Solana
    Solana,
    /// Cosmos Hub
    CosmosHub,
    /// Osmosis
    Osmosis,
    /// Stacks
    Stacks,
    /// Liquid Network
    Liquid,
    /// Custom chain
    Custom { chain_id: u32 },
}

impl Chain {
    /// Get chain ID
    pub fn chain_id(&self) -> u32 {
        match self {
            Chain::Bitcoin => 0,
            Chain::Ethereum => 1,
            Chain::ArbitrumOne => 42161,
            Chain::Optimism => 10,
            Chain::Base => 8453,
            Chain::Polygon => 137,
            Chain::Solana => 1399811149,
            Chain::CosmosHub => 118,
            Chain::Osmosis => 119,
            Chain::Stacks => 1,
            Chain::Liquid => 1776,
            Chain::Custom { chain_id } => *chain_id,
        }
    }

    /// Get finality blocks (how many confirmations needed)
    pub fn finality_blocks(&self) -> u32 {
        match self {
            Chain::Bitcoin => 6,
            Chain::Ethereum => 12,
            Chain::ArbitrumOne => 1,
            Chain::Optimism => 1,
            Chain::Base => 1,
            Chain::Polygon => 128,
            Chain::Solana => 32,
            Chain::CosmosHub => 1,
            Chain::Osmosis => 1,
            Chain::Stacks => 6,
            Chain::Liquid => 2,
            Chain::Custom { .. } => 12, // Conservative default
        }
    }

    /// Get bridge type
    pub fn bridge_type(&self) -> BridgeType {
        match self {
            Chain::Bitcoin => BridgeType::Native,
            Chain::Ethereum | Chain::ArbitrumOne | Chain::Optimism | Chain::Base | Chain::Polygon => {
                BridgeType::Evm
            }
            Chain::Solana => BridgeType::Svm,
            Chain::CosmosHub | Chain::Osmosis => BridgeType::Ibc,
            Chain::Stacks => BridgeType::Clarity,
            Chain::Liquid => BridgeType::Federated,
            Chain::Custom { .. } => BridgeType::Custom,
        }
    }
}

/// Bridge implementation type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeType {
    /// Native Bitcoin (no bridge needed)
    Native,
    /// EVM-compatible chains
    Evm,
    /// Solana VM
    Svm,
    /// Inter-Blockchain Communication
    Ibc,
    /// Stacks Clarity
    Clarity,
    /// Federated sidechain (e.g., Liquid)
    Federated,
    /// Custom bridge
    Custom,
}

/// Beam direction
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeamDirection {
    /// From Bitcoin to another chain
    Outbound,
    /// From another chain to Bitcoin
    Inbound,
}

/// Beam status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeamStatus {
    /// Beam initiated, waiting for confirmations
    Pending,
    /// Funds locked on source chain
    Locked,
    /// ZK proof submitted
    ProofSubmitted,
    /// In challenge period
    Challenging,
    /// Beam completed successfully
    Completed,
    /// Beam failed or timed out
    Failed,
    /// Beam cancelled by user
    Cancelled,
    /// Funds refunded after timeout
    Refunded,
}

/// Beam request (outbound from Bitcoin)
#[derive(Debug, Clone)]
pub struct BeamOutRequest {
    /// Unique beam ID
    pub beam_id: [u8; 32],
    /// User address on Bitcoin
    pub bitcoin_address: [u8; 32],
    /// Recipient address on target chain
    pub target_address: Vec<u8>,
    /// Target chain
    pub target_chain: Chain,
    /// Amount to beam
    pub amount: u64,
    /// Fee paid
    pub fee: u64,
    /// Created at block
    pub created_at_block: u64,
    /// Timeout block
    pub timeout_block: u64,
    /// Current status
    pub status: BeamStatus,
    /// Lock transaction ID
    pub lock_txid: Option<[u8; 32]>,
    /// ZK proof (if submitted)
    pub zk_proof: Option<Vec<u8>>,
}

/// Beam request (inbound to Bitcoin)
#[derive(Debug, Clone)]
pub struct BeamInRequest {
    /// Unique beam ID
    pub beam_id: [u8; 32],
    /// Source chain
    pub source_chain: Chain,
    /// Sender address on source chain
    pub source_address: Vec<u8>,
    /// Recipient on Bitcoin
    pub bitcoin_recipient: [u8; 32],
    /// Amount being beamed
    pub amount: u64,
    /// Fee to pay
    pub fee: u64,
    /// Burn transaction ID on source chain
    pub burn_txid: Vec<u8>,
    /// Block height of burn on source chain
    pub burn_block: u64,
    /// Created at Bitcoin block
    pub created_at_block: u64,
    /// Challenge end block
    pub challenge_end_block: u64,
    /// Current status
    pub status: BeamStatus,
    /// ZK proof of burn
    pub zk_proof: Option<Vec<u8>>,
    /// Challenger (if any)
    pub challenger: Option<[u8; 32]>,
}

/// ZK Proof for cross-chain state transition
#[derive(Debug, Clone)]
pub struct BeamProof {
    /// Proof type
    pub proof_type: ProofType,
    /// Serialized proof data
    pub proof_data: Vec<u8>,
    /// Public inputs
    pub public_inputs: Vec<u8>,
    /// Verification key hash
    pub vk_hash: [u8; 32],
}

/// Types of ZK proofs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProofType {
    /// Groth16
    Groth16,
    /// PLONK
    Plonk,
    /// STARK
    Stark,
    /// Halo2
    Halo2,
    /// SP1 (Succinct)
    Sp1,
}

/// Beaming configuration
#[derive(Debug, Clone)]
pub struct BeamingConfig {
    /// Is beaming enabled
    pub enabled: bool,
    /// Supported target chains
    pub supported_chains: Vec<Chain>,
    /// Fee rate (BPS)
    pub fee_bps: u64,
    /// Minimum amount
    pub min_amount: u64,
    /// Maximum amount
    pub max_amount: u64,
    /// Challenge period blocks
    pub challenge_period: u64,
    /// Timeout blocks
    pub timeout: u64,
}

impl Default for BeamingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            supported_chains: vec![
                Chain::Ethereum,
                Chain::ArbitrumOne,
                Chain::Optimism,
                Chain::Solana,
                Chain::Liquid,
            ],
            fee_bps: BEAM_FEE_BPS,
            min_amount: MIN_BEAM_AMOUNT,
            max_amount: MAX_BEAM_AMOUNT,
            challenge_period: CHALLENGE_PERIOD_BLOCKS,
            timeout: BEAM_TIMEOUT_BLOCKS,
        }
    }
}

/// Beaming state
#[derive(Debug, Clone, Default)]
pub struct BeamingState {
    /// Total beamed out
    pub total_beamed_out: u64,
    /// Total beamed in
    pub total_beamed_in: u64,
    /// Currently locked (pending outbound)
    pub currently_locked: u64,
    /// Pending inbound amount
    pub pending_inbound: u64,
    /// Total fees collected
    pub fees_collected: u64,
    /// Total beams processed
    pub total_beams: u64,
    /// Failed beams count
    pub failed_beams: u64,
}

/// Challenge submission
#[derive(Debug, Clone)]
pub struct Challenge {
    /// Beam ID being challenged
    pub beam_id: [u8; 32],
    /// Challenger address
    pub challenger: [u8; 32],
    /// Challenge reason
    pub reason: ChallengeReason,
    /// Supporting evidence
    pub evidence: Vec<u8>,
    /// Submitted at block
    pub submitted_at: u64,
    /// Bond amount (slashed if invalid)
    pub bond: u64,
}

/// Reasons for challenging a beam
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeReason {
    /// Invalid ZK proof
    InvalidProof,
    /// Amount mismatch
    AmountMismatch,
    /// Burn never happened
    BurnNotFound,
    /// Double spend attempt
    DoubleSpend,
    /// Invalid destination
    InvalidDestination,
}

// ============================================================================
// Core Operations
// ============================================================================

/// Initiate outbound beam (Bitcoin -> other chain)
pub fn initiate_beam_out(
    user: [u8; 32],
    target_chain: Chain,
    target_address: Vec<u8>,
    amount: u64,
    config: &BeamingConfig,
    current_block: u64,
    state: &mut BeamingState,
) -> ZkUsdResult<BeamOutRequest> {
    // Validate config
    if !config.enabled {
        return Err(ZkUsdError::ProtocolPaused);
    }

    // Check chain is supported
    if !config.supported_chains.contains(&target_chain) {
        return Err(ZkUsdError::InvalidParameter);
    }

    // Validate amount
    if amount < config.min_amount {
        return Err(ZkUsdError::BelowMinimum {
            amount,
            minimum: config.min_amount,
        });
    }

    if amount > config.max_amount {
        return Err(ZkUsdError::ExceedsMaximum {
            amount,
            maximum: config.max_amount,
        });
    }

    // Calculate fee
    let fee = (amount as u128 * config.fee_bps as u128 / 10000) as u64;

    // Generate beam ID
    let beam_id = generate_beam_id(user, target_chain, current_block);

    // Update state
    state.currently_locked += amount;
    state.total_beams += 1;

    Ok(BeamOutRequest {
        beam_id,
        bitcoin_address: user,
        target_address,
        target_chain,
        amount,
        fee,
        created_at_block: current_block,
        timeout_block: current_block + config.timeout,
        status: BeamStatus::Pending,
        lock_txid: None,
        zk_proof: None,
    })
}

/// Confirm funds locked for outbound beam
pub fn confirm_beam_lock(
    beam: &mut BeamOutRequest,
    lock_txid: [u8; 32],
) -> ZkUsdResult<()> {
    if beam.status != BeamStatus::Pending {
        return Err(ZkUsdError::InvalidOperation);
    }

    beam.lock_txid = Some(lock_txid);
    beam.status = BeamStatus::Locked;

    Ok(())
}

/// Submit ZK proof for outbound beam
pub fn submit_beam_out_proof(
    beam: &mut BeamOutRequest,
    proof: BeamProof,
) -> ZkUsdResult<()> {
    if beam.status != BeamStatus::Locked {
        return Err(ZkUsdError::InvalidOperation);
    }

    // In production, would verify the ZK proof here
    let _is_valid = verify_beam_proof(&proof, beam.amount, &beam.target_address);

    beam.zk_proof = Some(proof.proof_data);
    beam.status = BeamStatus::ProofSubmitted;

    Ok(())
}

/// Complete outbound beam (after proof verification)
pub fn complete_beam_out(
    beam: &mut BeamOutRequest,
    state: &mut BeamingState,
) -> ZkUsdResult<()> {
    if beam.status != BeamStatus::ProofSubmitted {
        return Err(ZkUsdError::InvalidOperation);
    }

    beam.status = BeamStatus::Completed;
    state.currently_locked -= beam.amount;
    state.total_beamed_out += beam.amount;
    state.fees_collected += beam.fee;

    Ok(())
}

/// Initiate inbound beam (other chain -> Bitcoin)
pub fn initiate_beam_in(
    source_chain: Chain,
    source_address: Vec<u8>,
    bitcoin_recipient: [u8; 32],
    amount: u64,
    burn_txid: Vec<u8>,
    burn_block: u64,
    config: &BeamingConfig,
    current_block: u64,
    state: &mut BeamingState,
) -> ZkUsdResult<BeamInRequest> {
    // Validate config
    if !config.enabled {
        return Err(ZkUsdError::ProtocolPaused);
    }

    // Calculate fee
    let fee = (amount as u128 * config.fee_bps as u128 / 10000) as u64;

    // Generate beam ID
    let beam_id = generate_beam_id(bitcoin_recipient, source_chain, current_block);

    // Update state
    state.pending_inbound += amount;
    state.total_beams += 1;

    Ok(BeamInRequest {
        beam_id,
        source_chain,
        source_address,
        bitcoin_recipient,
        amount,
        fee,
        burn_txid,
        burn_block,
        created_at_block: current_block,
        challenge_end_block: current_block + config.challenge_period,
        status: BeamStatus::Pending,
        zk_proof: None,
        challenger: None,
    })
}

/// Submit ZK proof for inbound beam
pub fn submit_beam_in_proof(
    beam: &mut BeamInRequest,
    proof: BeamProof,
) -> ZkUsdResult<()> {
    if beam.status != BeamStatus::Pending {
        return Err(ZkUsdError::InvalidOperation);
    }

    // Verify proof (simplified - in production would do full verification)
    let _is_valid = verify_burn_proof(&proof, beam.amount, &beam.burn_txid);

    beam.zk_proof = Some(proof.proof_data);
    beam.status = BeamStatus::ProofSubmitted;

    Ok(())
}

/// Enter challenge period for inbound beam
pub fn enter_challenge_period(
    beam: &mut BeamInRequest,
    current_block: u64,
) -> ZkUsdResult<()> {
    if beam.status != BeamStatus::ProofSubmitted {
        return Err(ZkUsdError::InvalidOperation);
    }

    beam.status = BeamStatus::Challenging;
    beam.challenge_end_block = current_block + CHALLENGE_PERIOD_BLOCKS;

    Ok(())
}

/// Submit a challenge
pub fn submit_challenge(
    beam: &mut BeamInRequest,
    challenger: [u8; 32],
    reason: ChallengeReason,
    evidence: Vec<u8>,
    bond: u64,
    current_block: u64,
) -> ZkUsdResult<Challenge> {
    if beam.status != BeamStatus::Challenging {
        return Err(ZkUsdError::InvalidOperation);
    }

    if current_block > beam.challenge_end_block {
        return Err(ZkUsdError::ConditionNotMet);
    }

    beam.challenger = Some(challenger);

    Ok(Challenge {
        beam_id: beam.beam_id,
        challenger,
        reason,
        evidence,
        submitted_at: current_block,
        bond,
    })
}

/// Complete inbound beam after challenge period
pub fn complete_beam_in(
    beam: &mut BeamInRequest,
    current_block: u64,
    state: &mut BeamingState,
) -> ZkUsdResult<u64> {
    // Must be past challenge period
    if current_block < beam.challenge_end_block {
        return Err(ZkUsdError::ConditionNotMet);
    }

    // Must not have active challenge
    if beam.challenger.is_some() {
        return Err(ZkUsdError::InvalidOperation);
    }

    if !matches!(beam.status, BeamStatus::Challenging | BeamStatus::ProofSubmitted) {
        return Err(ZkUsdError::InvalidOperation);
    }

    let payout = beam.amount - beam.fee;

    beam.status = BeamStatus::Completed;
    state.pending_inbound -= beam.amount;
    state.total_beamed_in += beam.amount;
    state.fees_collected += beam.fee;

    Ok(payout)
}

/// Cancel beam (before lock)
pub fn cancel_beam_out(
    beam: &mut BeamOutRequest,
    state: &mut BeamingState,
) -> ZkUsdResult<u64> {
    if beam.status != BeamStatus::Pending {
        return Err(ZkUsdError::InvalidOperation);
    }

    beam.status = BeamStatus::Cancelled;
    state.currently_locked -= beam.amount;

    Ok(beam.amount)
}

/// Refund timed out beam
pub fn refund_beam_out(
    beam: &mut BeamOutRequest,
    current_block: u64,
    state: &mut BeamingState,
) -> ZkUsdResult<u64> {
    if current_block < beam.timeout_block {
        return Err(ZkUsdError::ConditionNotMet);
    }

    if !matches!(beam.status, BeamStatus::Pending | BeamStatus::Locked | BeamStatus::ProofSubmitted) {
        return Err(ZkUsdError::InvalidOperation);
    }

    beam.status = BeamStatus::Refunded;
    state.currently_locked -= beam.amount;
    state.failed_beams += 1;

    Ok(beam.amount)
}

/// Calculate beam fee
pub fn calculate_beam_fee(amount: u64, fee_bps: u64) -> u64 {
    (amount as u128 * fee_bps as u128 / 10000) as u64
}

// ============================================================================
// Helpers
// ============================================================================

fn generate_beam_id(user: [u8; 32], chain: Chain, block: u64) -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..20].copy_from_slice(&user[0..20]);
    id[20..24].copy_from_slice(&chain.chain_id().to_le_bytes());
    id[24..32].copy_from_slice(&block.to_le_bytes());
    id
}

fn verify_beam_proof(_proof: &BeamProof, _amount: u64, _target: &[u8]) -> bool {
    // Simplified - in production would verify ZK proof
    true
}

fn verify_burn_proof(_proof: &BeamProof, _amount: u64, _burn_tx: &[u8]) -> bool {
    // Simplified - in production would verify burn proof
    true
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> BeamingConfig {
        BeamingConfig::default()
    }

    #[test]
    fn test_chain_properties() {
        assert_eq!(Chain::Bitcoin.chain_id(), 0);
        assert_eq!(Chain::Ethereum.chain_id(), 1);
        assert_eq!(Chain::ArbitrumOne.chain_id(), 42161);

        assert_eq!(Chain::Bitcoin.finality_blocks(), 6);
        assert_eq!(Chain::Ethereum.finality_blocks(), 12);
    }

    #[test]
    fn test_bridge_types() {
        assert_eq!(Chain::Bitcoin.bridge_type(), BridgeType::Native);
        assert_eq!(Chain::Ethereum.bridge_type(), BridgeType::Evm);
        assert_eq!(Chain::Solana.bridge_type(), BridgeType::Svm);
        assert_eq!(Chain::CosmosHub.bridge_type(), BridgeType::Ibc);
    }

    #[test]
    fn test_initiate_beam_out() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let beam = initiate_beam_out(
            [1u8; 32],
            Chain::Ethereum,
            vec![2u8; 20], // ETH address
            10_000_00000000, // $10k
            &config,
            100,
            &mut state,
        ).unwrap();

        assert_eq!(beam.status, BeamStatus::Pending);
        assert_eq!(beam.amount, 10_000_00000000);
        assert!(beam.fee > 0);
        assert_eq!(state.currently_locked, 10_000_00000000);
    }

    #[test]
    fn test_beam_below_minimum() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let result = initiate_beam_out(
            [1u8; 32],
            Chain::Ethereum,
            vec![2u8; 20],
            10_00000000, // $10 - below minimum
            &config,
            100,
            &mut state,
        );

        assert!(matches!(result, Err(ZkUsdError::BelowMinimum { .. })));
    }

    #[test]
    fn test_beam_unsupported_chain() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let result = initiate_beam_out(
            [1u8; 32],
            Chain::Custom { chain_id: 99999 },
            vec![2u8; 20],
            1000_00000000,
            &config,
            100,
            &mut state,
        );

        assert!(matches!(result, Err(ZkUsdError::InvalidParameter)));
    }

    #[test]
    fn test_confirm_beam_lock() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let mut beam = initiate_beam_out(
            [1u8; 32],
            Chain::Ethereum,
            vec![2u8; 20],
            1000_00000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        confirm_beam_lock(&mut beam, [3u8; 32]).unwrap();

        assert_eq!(beam.status, BeamStatus::Locked);
        assert_eq!(beam.lock_txid, Some([3u8; 32]));
    }

    #[test]
    fn test_complete_beam_out() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let mut beam = initiate_beam_out(
            [1u8; 32],
            Chain::Ethereum,
            vec![2u8; 20],
            1000_00000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        confirm_beam_lock(&mut beam, [3u8; 32]).unwrap();

        let proof = BeamProof {
            proof_type: ProofType::Groth16,
            proof_data: vec![1, 2, 3],
            public_inputs: vec![],
            vk_hash: [4u8; 32],
        };

        submit_beam_out_proof(&mut beam, proof).unwrap();
        complete_beam_out(&mut beam, &mut state).unwrap();

        assert_eq!(beam.status, BeamStatus::Completed);
        assert_eq!(state.currently_locked, 0);
        assert!(state.total_beamed_out > 0);
    }

    #[test]
    fn test_initiate_beam_in() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let beam = initiate_beam_in(
            Chain::Ethereum,
            vec![1u8; 20],
            [2u8; 32],
            1000_00000000,
            vec![3u8; 32], // ETH tx hash
            1000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        assert_eq!(beam.status, BeamStatus::Pending);
        assert_eq!(state.pending_inbound, 1000_00000000);
    }

    #[test]
    fn test_beam_in_complete_lifecycle() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let mut beam = initiate_beam_in(
            Chain::Ethereum,
            vec![1u8; 20],
            [2u8; 32],
            1000_00000000,
            vec![3u8; 32],
            1000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        let proof = BeamProof {
            proof_type: ProofType::Plonk,
            proof_data: vec![1, 2, 3],
            public_inputs: vec![],
            vk_hash: [4u8; 32],
        };

        submit_beam_in_proof(&mut beam, proof).unwrap();
        enter_challenge_period(&mut beam, 100).unwrap();

        // Wait for challenge period
        let challenge_end = beam.challenge_end_block + 1;
        let payout = complete_beam_in(&mut beam, challenge_end, &mut state).unwrap();

        assert!(payout < 1000_00000000); // Fee deducted
        assert_eq!(beam.status, BeamStatus::Completed);
    }

    #[test]
    fn test_cancel_beam() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let mut beam = initiate_beam_out(
            [1u8; 32],
            Chain::Ethereum,
            vec![2u8; 20],
            1000_00000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        let refund = cancel_beam_out(&mut beam, &mut state).unwrap();

        assert_eq!(refund, 1000_00000000);
        assert_eq!(beam.status, BeamStatus::Cancelled);
        assert_eq!(state.currently_locked, 0);
    }

    #[test]
    fn test_refund_timeout() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let mut beam = initiate_beam_out(
            [1u8; 32],
            Chain::Ethereum,
            vec![2u8; 20],
            1000_00000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        // Before timeout - should fail
        let timeout = beam.timeout_block;
        let result = refund_beam_out(&mut beam, timeout - 1, &mut state);
        assert!(matches!(result, Err(ZkUsdError::ConditionNotMet)));

        // After timeout - should succeed
        let refund = refund_beam_out(&mut beam, timeout, &mut state).unwrap();
        assert_eq!(refund, 1000_00000000);
        assert_eq!(beam.status, BeamStatus::Refunded);
    }

    #[test]
    fn test_challenge_submission() {
        let config = create_test_config();
        let mut state = BeamingState::default();

        let mut beam = initiate_beam_in(
            Chain::Ethereum,
            vec![1u8; 20],
            [2u8; 32],
            1000_00000000,
            vec![3u8; 32],
            1000000,
            &config,
            100,
            &mut state,
        ).unwrap();

        let proof = BeamProof {
            proof_type: ProofType::Plonk,
            proof_data: vec![],
            public_inputs: vec![],
            vk_hash: [0u8; 32],
        };

        submit_beam_in_proof(&mut beam, proof).unwrap();
        enter_challenge_period(&mut beam, 100).unwrap();

        let challenge = submit_challenge(
            &mut beam,
            [5u8; 32],
            ChallengeReason::InvalidProof,
            vec![],
            100_00000000,
            105,
        ).unwrap();

        assert_eq!(challenge.reason, ChallengeReason::InvalidProof);
        assert_eq!(beam.challenger, Some([5u8; 32]));
    }

    #[test]
    fn test_fee_calculation() {
        let amount = 10_000_00000000u64; // $10k
        let fee = calculate_beam_fee(amount, BEAM_FEE_BPS);
        // 0.3% of $10k = $30
        assert_eq!(fee, 30_00000000);
    }
}
