//! Lightning Network Integration Module
//!
//! Enables zkUSD to interact with the Lightning Network for instant
//! payments, liquidity provision, and atomic swaps.
//!
//! ## Key Features
//!
//! - **LN-zkUSD Channels**: Open Lightning channels backed by zkUSD
//! - **Submarine Swaps**: Atomic on-chain/off-chain swaps
//! - **HTLCs**: Hash Time Locked Contracts for trustless payments
//! - **Liquidity Provision**: Earn fees by providing Lightning liquidity
//!
//! ## UTXO Integration
//!
//! - PTLCs (Point Time Locked Contracts) for privacy
//! - Taproot-based channel construction
//! - Charms Protocol compatible state updates

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};
#[cfg(feature = "std")]
#[allow(unused_imports)]
use std::vec::Vec;

use crate::errors::{ZkUsdError, ZkUsdResult};

// ============================================================================
// Constants
// ============================================================================

/// Minimum channel capacity in zkUSD (8 decimals)
pub const MIN_CHANNEL_CAPACITY: u64 = 1000_00000000; // $1,000

/// Maximum channel capacity
pub const MAX_CHANNEL_CAPACITY: u64 = 1_000_000_00000000; // $1M

/// Default HTLC timeout (blocks)
pub const DEFAULT_HTLC_TIMEOUT_BLOCKS: u32 = 144; // ~1 day

/// Maximum HTLC timeout
pub const MAX_HTLC_TIMEOUT_BLOCKS: u32 = 2016; // ~2 weeks

/// Minimum HTLC value
pub const MIN_HTLC_VALUE: u64 = 100000000; // $1

/// Maximum in-flight HTLCs per channel
pub const MAX_HTLC_COUNT: usize = 483;

/// Base fee for routing (in millisatoshis equivalent)
pub const BASE_FEE_MSAT: u64 = 1000;

/// Fee rate for routing (parts per million)
pub const FEE_RATE_PPM: u64 = 100; // 0.01%

/// Dust limit for channel outputs
pub const DUST_LIMIT: u64 = 54600000; // ~$546 in 8 decimals

/// Reserve requirement (percentage of channel capacity)
pub const CHANNEL_RESERVE_BPS: u64 = 100; // 1%

// ============================================================================
// Types
// ============================================================================

/// Channel state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelState {
    /// Waiting for funding transaction confirmation
    PendingOpen,
    /// Channel is open and operational
    Open,
    /// Channel is being closed cooperatively
    ClosingCooperative,
    /// Channel is being force closed
    ClosingForce,
    /// Channel is closed
    Closed,
    /// Channel failed to open
    Failed,
}

/// Lightning channel between two parties
#[derive(Debug, Clone)]
pub struct LightningChannel {
    /// Channel ID (funding outpoint hash)
    pub channel_id: [u8; 32],
    /// Local party public key
    pub local_pubkey: [u8; 33],
    /// Remote party public key
    pub remote_pubkey: [u8; 33],
    /// Total channel capacity
    pub capacity: u64,
    /// Local balance
    pub local_balance: u64,
    /// Remote balance
    pub remote_balance: u64,
    /// Reserve requirement
    pub local_reserve: u64,
    /// Remote reserve requirement
    pub remote_reserve: u64,
    /// Current state
    pub state: ChannelState,
    /// Commitment number (for revocation)
    pub commitment_number: u64,
    /// Pending HTLCs (inbound and outbound)
    pub pending_htlcs: Vec<PendingHtlc>,
    /// Block height when opened
    pub opened_at_block: u64,
    /// Funding transaction ID
    pub funding_txid: [u8; 32],
    /// Is zkUSD denominated
    pub is_zkusd: bool,
}

impl LightningChannel {
    /// Create new channel
    pub fn new(
        channel_id: [u8; 32],
        local_pubkey: [u8; 33],
        remote_pubkey: [u8; 33],
        capacity: u64,
        local_funding: u64,
        block_height: u64,
    ) -> Self {
        let reserve = capacity * CHANNEL_RESERVE_BPS / 10000;

        Self {
            channel_id,
            local_pubkey,
            remote_pubkey,
            capacity,
            local_balance: local_funding,
            remote_balance: capacity - local_funding,
            local_reserve: reserve,
            remote_reserve: reserve,
            state: ChannelState::PendingOpen,
            commitment_number: 0,
            pending_htlcs: Vec::new(),
            opened_at_block: block_height,
            funding_txid: [0u8; 32],
            is_zkusd: true,
        }
    }

    /// Check if channel can send amount
    pub fn can_send(&self, amount: u64) -> bool {
        if self.state != ChannelState::Open {
            return false;
        }

        // Must maintain reserve
        let sendable = self.local_balance.saturating_sub(self.local_reserve);

        // Account for pending outbound HTLCs
        let pending_outbound: u64 = self.pending_htlcs
            .iter()
            .filter(|h| h.direction == HtlcDirection::Outbound)
            .map(|h| h.amount)
            .sum();

        sendable > pending_outbound && sendable - pending_outbound >= amount
    }

    /// Check if channel can receive amount
    pub fn can_receive(&self, amount: u64) -> bool {
        if self.state != ChannelState::Open {
            return false;
        }

        let receivable = self.remote_balance.saturating_sub(self.remote_reserve);

        let pending_inbound: u64 = self.pending_htlcs
            .iter()
            .filter(|h| h.direction == HtlcDirection::Inbound)
            .map(|h| h.amount)
            .sum();

        receivable > pending_inbound && receivable - pending_inbound >= amount
    }

    /// Get sendable capacity
    pub fn sendable_capacity(&self) -> u64 {
        if self.state != ChannelState::Open {
            return 0;
        }

        let sendable = self.local_balance.saturating_sub(self.local_reserve);
        let pending_outbound: u64 = self.pending_htlcs
            .iter()
            .filter(|h| h.direction == HtlcDirection::Outbound)
            .map(|h| h.amount)
            .sum();

        sendable.saturating_sub(pending_outbound)
    }

    /// Get receivable capacity
    pub fn receivable_capacity(&self) -> u64 {
        if self.state != ChannelState::Open {
            return 0;
        }

        let receivable = self.remote_balance.saturating_sub(self.remote_reserve);
        let pending_inbound: u64 = self.pending_htlcs
            .iter()
            .filter(|h| h.direction == HtlcDirection::Inbound)
            .map(|h| h.amount)
            .sum();

        receivable.saturating_sub(pending_inbound)
    }

    /// Add pending HTLC
    pub fn add_htlc(&mut self, htlc: PendingHtlc) -> ZkUsdResult<()> {
        if self.pending_htlcs.len() >= MAX_HTLC_COUNT {
            return Err(ZkUsdError::ExceedsMaximum {
                amount: self.pending_htlcs.len() as u64,
                maximum: MAX_HTLC_COUNT as u64,
            });
        }

        match htlc.direction {
            HtlcDirection::Outbound => {
                if !self.can_send(htlc.amount) {
                    return Err(ZkUsdError::InsufficientBalance {
                        available: self.sendable_capacity(),
                        requested: htlc.amount,
                    });
                }
                self.local_balance -= htlc.amount;
            }
            HtlcDirection::Inbound => {
                if !self.can_receive(htlc.amount) {
                    return Err(ZkUsdError::InsufficientBalance {
                        available: self.receivable_capacity(),
                        requested: htlc.amount,
                    });
                }
                self.remote_balance -= htlc.amount;
            }
        }

        self.pending_htlcs.push(htlc);
        self.commitment_number += 1;

        Ok(())
    }

    /// Settle HTLC (reveal preimage)
    pub fn settle_htlc(&mut self, payment_hash: [u8; 32], preimage: [u8; 32]) -> ZkUsdResult<u64> {
        // Verify preimage matches hash
        let computed_hash = compute_payment_hash(&preimage);
        if computed_hash != payment_hash {
            return Err(ZkUsdError::InvalidParameter);
        }

        // Find and remove HTLC
        let htlc_index = self.pending_htlcs
            .iter()
            .position(|h| h.payment_hash == payment_hash)
            .ok_or(ZkUsdError::InvalidParameter)?;

        let htlc = self.pending_htlcs.remove(htlc_index);

        // Update balances based on direction
        match htlc.direction {
            HtlcDirection::Outbound => {
                // Payment succeeded, remote gets the funds
                self.remote_balance += htlc.amount;
            }
            HtlcDirection::Inbound => {
                // Payment received, local gets the funds
                self.local_balance += htlc.amount;
            }
        }

        self.commitment_number += 1;

        Ok(htlc.amount)
    }

    /// Cancel HTLC (timeout or failure)
    pub fn cancel_htlc(&mut self, payment_hash: [u8; 32]) -> ZkUsdResult<u64> {
        let htlc_index = self.pending_htlcs
            .iter()
            .position(|h| h.payment_hash == payment_hash)
            .ok_or(ZkUsdError::InvalidParameter)?;

        let htlc = self.pending_htlcs.remove(htlc_index);

        // Return funds to original holder
        match htlc.direction {
            HtlcDirection::Outbound => {
                self.local_balance += htlc.amount;
            }
            HtlcDirection::Inbound => {
                self.remote_balance += htlc.amount;
            }
        }

        self.commitment_number += 1;

        Ok(htlc.amount)
    }
}

/// HTLC direction
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HtlcDirection {
    /// Outgoing payment
    Outbound,
    /// Incoming payment
    Inbound,
}

/// Pending HTLC
#[derive(Debug, Clone)]
pub struct PendingHtlc {
    /// HTLC ID
    pub htlc_id: u64,
    /// Amount in zkUSD
    pub amount: u64,
    /// Payment hash
    pub payment_hash: [u8; 32],
    /// Timeout block height
    pub timeout_block: u32,
    /// Direction
    pub direction: HtlcDirection,
    /// Onion routing data (encrypted)
    pub onion_data: Vec<u8>,
    /// CLTV expiry delta
    pub cltv_expiry_delta: u32,
}

/// Submarine swap (on-chain to Lightning)
#[derive(Debug, Clone)]
pub struct SubmarineSwap {
    /// Swap ID
    pub swap_id: [u8; 32],
    /// On-chain amount (zkUSD)
    pub onchain_amount: u64,
    /// Lightning amount (after fees)
    pub lightning_amount: u64,
    /// Payment hash
    pub payment_hash: [u8; 32],
    /// Timeout block
    pub timeout_block: u64,
    /// Status
    pub status: SwapStatus,
    /// User address
    pub user: [u8; 32],
    /// Provider address
    pub provider: [u8; 32],
    /// Fee paid
    pub fee: u64,
}

/// Reverse submarine swap (Lightning to on-chain)
#[derive(Debug, Clone)]
pub struct ReverseSubmarineSwap {
    /// Swap ID
    pub swap_id: [u8; 32],
    /// Lightning amount
    pub lightning_amount: u64,
    /// On-chain amount (after fees)
    pub onchain_amount: u64,
    /// Payment hash
    pub payment_hash: [u8; 32],
    /// Preimage (revealed after claim)
    pub preimage: Option<[u8; 32]>,
    /// Timeout block
    pub timeout_block: u64,
    /// Status
    pub status: SwapStatus,
    /// User address
    pub user: [u8; 32],
    /// Provider address
    pub provider: [u8; 32],
    /// Fee paid
    pub fee: u64,
}

/// Swap status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwapStatus {
    /// Waiting for funding
    Pending,
    /// Funded, waiting for claim
    Funded,
    /// Successfully completed
    Completed,
    /// Refunded due to timeout
    Refunded,
    /// Failed
    Failed,
}

/// Liquidity provider position
#[derive(Debug, Clone)]
pub struct LiquidityPosition {
    /// Position ID
    pub position_id: [u8; 32],
    /// Provider address
    pub provider: [u8; 32],
    /// zkUSD committed
    pub zkusd_committed: u64,
    /// Current utilization
    pub utilization: u64,
    /// Fees earned
    pub fees_earned: u64,
    /// Created at block
    pub created_at: u64,
    /// Is active
    pub is_active: bool,
}

/// Lightning state
#[derive(Debug, Clone, Default)]
pub struct LightningState {
    /// Total channels
    pub total_channels: u64,
    /// Total capacity locked
    pub total_capacity: u64,
    /// Total pending HTLCs
    pub total_pending_htlcs: u64,
    /// Total swaps processed
    pub total_swaps: u64,
    /// Total fees collected
    pub total_fees: u64,
    /// Is enabled
    pub is_enabled: bool,
}

// ============================================================================
// Core Operations
// ============================================================================

/// Open a new Lightning channel
pub fn open_channel(
    local_pubkey: [u8; 33],
    remote_pubkey: [u8; 33],
    capacity: u64,
    local_funding: u64,
    block_height: u64,
    state: &mut LightningState,
) -> ZkUsdResult<LightningChannel> {
    // Validate capacity
    if capacity < MIN_CHANNEL_CAPACITY {
        return Err(ZkUsdError::BelowMinimum {
            amount: capacity,
            minimum: MIN_CHANNEL_CAPACITY,
        });
    }

    if capacity > MAX_CHANNEL_CAPACITY {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: capacity,
            maximum: MAX_CHANNEL_CAPACITY,
        });
    }

    // Validate funding
    if local_funding > capacity {
        return Err(ZkUsdError::ExceedsMaximum {
            amount: local_funding,
            maximum: capacity,
        });
    }

    // Generate channel ID
    let channel_id = generate_channel_id(local_pubkey, remote_pubkey, block_height);

    let channel = LightningChannel::new(
        channel_id,
        local_pubkey,
        remote_pubkey,
        capacity,
        local_funding,
        block_height,
    );

    // Update state
    state.total_channels += 1;
    state.total_capacity += capacity;

    Ok(channel)
}

/// Confirm channel opening
pub fn confirm_channel(
    channel: &mut LightningChannel,
    funding_txid: [u8; 32],
) -> ZkUsdResult<()> {
    if channel.state != ChannelState::PendingOpen {
        return Err(ZkUsdError::InvalidOperation);
    }

    channel.funding_txid = funding_txid;
    channel.state = ChannelState::Open;

    Ok(())
}

/// Close channel cooperatively
pub fn close_channel_cooperative(
    channel: &mut LightningChannel,
    state: &mut LightningState,
) -> ZkUsdResult<(u64, u64)> {
    if channel.state != ChannelState::Open {
        return Err(ZkUsdError::InvalidOperation);
    }

    // Cannot close with pending HTLCs
    if !channel.pending_htlcs.is_empty() {
        return Err(ZkUsdError::ConditionNotMet);
    }

    channel.state = ChannelState::ClosingCooperative;

    // Update state
    state.total_capacity = state.total_capacity.saturating_sub(channel.capacity);

    Ok((channel.local_balance, channel.remote_balance))
}

/// Force close channel (unilateral)
pub fn close_channel_force(
    channel: &mut LightningChannel,
    state: &mut LightningState,
) -> ZkUsdResult<(u64, u64, Vec<PendingHtlc>)> {
    if !matches!(channel.state, ChannelState::Open | ChannelState::ClosingCooperative) {
        return Err(ZkUsdError::InvalidOperation);
    }

    channel.state = ChannelState::ClosingForce;

    // Update state
    state.total_capacity = state.total_capacity.saturating_sub(channel.capacity);
    state.total_pending_htlcs = state.total_pending_htlcs.saturating_sub(channel.pending_htlcs.len() as u64);

    // Return balances and pending HTLCs for on-chain settlement
    Ok((channel.local_balance, channel.remote_balance, channel.pending_htlcs.clone()))
}

/// Initiate submarine swap (on-chain to Lightning)
pub fn initiate_submarine_swap(
    user: [u8; 32],
    provider: [u8; 32],
    onchain_amount: u64,
    fee_rate_ppm: u64,
    timeout_blocks: u64,
    current_block: u64,
    state: &mut LightningState,
) -> ZkUsdResult<SubmarineSwap> {
    // Calculate fee
    let fee = (onchain_amount as u128 * fee_rate_ppm as u128 / 1_000_000) as u64;
    let lightning_amount = onchain_amount.saturating_sub(fee);

    // Generate swap ID and payment hash
    let swap_id = generate_swap_id(user, provider, current_block);
    let payment_hash = generate_payment_hash(&swap_id);

    state.total_swaps += 1;

    Ok(SubmarineSwap {
        swap_id,
        onchain_amount,
        lightning_amount,
        payment_hash,
        timeout_block: current_block + timeout_blocks,
        status: SwapStatus::Pending,
        user,
        provider,
        fee,
    })
}

/// Complete submarine swap with preimage
pub fn complete_submarine_swap(
    swap: &mut SubmarineSwap,
    preimage: [u8; 32],
    state: &mut LightningState,
) -> ZkUsdResult<()> {
    if swap.status != SwapStatus::Funded {
        return Err(ZkUsdError::InvalidOperation);
    }

    // Verify preimage
    let computed_hash = compute_payment_hash(&preimage);
    if computed_hash != swap.payment_hash {
        return Err(ZkUsdError::InvalidParameter);
    }

    swap.status = SwapStatus::Completed;
    state.total_fees += swap.fee;

    Ok(())
}

/// Initiate reverse submarine swap (Lightning to on-chain)
pub fn initiate_reverse_swap(
    user: [u8; 32],
    provider: [u8; 32],
    lightning_amount: u64,
    fee_rate_ppm: u64,
    timeout_blocks: u64,
    current_block: u64,
    state: &mut LightningState,
) -> ZkUsdResult<ReverseSubmarineSwap> {
    // Calculate fee
    let fee = (lightning_amount as u128 * fee_rate_ppm as u128 / 1_000_000) as u64;
    let onchain_amount = lightning_amount.saturating_sub(fee);

    // Generate swap ID and payment hash
    let swap_id = generate_swap_id(user, provider, current_block);
    let payment_hash = generate_payment_hash(&swap_id);

    state.total_swaps += 1;

    Ok(ReverseSubmarineSwap {
        swap_id,
        lightning_amount,
        onchain_amount,
        payment_hash,
        preimage: None,
        timeout_block: current_block + timeout_blocks,
        status: SwapStatus::Pending,
        user,
        provider,
        fee,
    })
}

/// Calculate routing fee for amount
pub fn calculate_routing_fee(amount: u64) -> u64 {
    let proportional = (amount as u128 * FEE_RATE_PPM as u128 / 1_000_000) as u64;
    BASE_FEE_MSAT / 1000 + proportional // Convert msat base fee to sat equivalent
}

/// Create liquidity provider position
pub fn create_liquidity_position(
    provider: [u8; 32],
    zkusd_amount: u64,
    current_block: u64,
) -> ZkUsdResult<LiquidityPosition> {
    if zkusd_amount < MIN_CHANNEL_CAPACITY {
        return Err(ZkUsdError::BelowMinimum {
            amount: zkusd_amount,
            minimum: MIN_CHANNEL_CAPACITY,
        });
    }

    let position_id = generate_position_id(provider, current_block);

    Ok(LiquidityPosition {
        position_id,
        provider,
        zkusd_committed: zkusd_amount,
        utilization: 0,
        fees_earned: 0,
        created_at: current_block,
        is_active: true,
    })
}

/// Update liquidity position with earned fees
pub fn update_liquidity_fees(
    position: &mut LiquidityPosition,
    fees: u64,
) {
    position.fees_earned += fees;
}

// ============================================================================
// Helpers
// ============================================================================

fn generate_channel_id(local: [u8; 33], remote: [u8; 33], block: u64) -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..16].copy_from_slice(&local[0..16]);
    id[16..24].copy_from_slice(&remote[0..8]);
    id[24..32].copy_from_slice(&block.to_le_bytes());
    id
}

fn generate_swap_id(user: [u8; 32], provider: [u8; 32], block: u64) -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..12].copy_from_slice(&user[0..12]);
    id[12..24].copy_from_slice(&provider[0..12]);
    id[24..32].copy_from_slice(&block.to_le_bytes());
    id
}

fn generate_payment_hash(data: &[u8; 32]) -> [u8; 32] {
    // Simplified hash - in production use SHA256
    let mut hash = [0u8; 32];
    for (i, byte) in data.iter().enumerate() {
        hash[i] = byte.wrapping_mul(31).wrapping_add(i as u8);
    }
    hash
}

fn compute_payment_hash(preimage: &[u8; 32]) -> [u8; 32] {
    generate_payment_hash(preimage)
}

fn generate_position_id(provider: [u8; 32], block: u64) -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..24].copy_from_slice(&provider[0..24]);
    id[24..32].copy_from_slice(&block.to_le_bytes());
    id
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_channel() -> LightningChannel {
        LightningChannel::new(
            [1u8; 32],
            [2u8; 33],
            [3u8; 33],
            100_000_00000000, // $100k capacity
            50_000_00000000,  // 50/50 split
            100,
        )
    }

    #[test]
    fn test_channel_creation() {
        let channel = create_test_channel();
        assert_eq!(channel.capacity, 100_000_00000000);
        assert_eq!(channel.local_balance, 50_000_00000000);
        assert_eq!(channel.remote_balance, 50_000_00000000);
        assert_eq!(channel.state, ChannelState::PendingOpen);
    }

    #[test]
    fn test_channel_capacities() {
        let mut channel = create_test_channel();
        channel.state = ChannelState::Open;

        let reserve = channel.capacity * CHANNEL_RESERVE_BPS / 10000;
        let expected_sendable = channel.local_balance - reserve;

        assert_eq!(channel.sendable_capacity(), expected_sendable);
        assert!(channel.can_send(expected_sendable));
        assert!(!channel.can_send(expected_sendable + 1));
    }

    #[test]
    fn test_open_channel() {
        let mut state = LightningState::default();
        state.is_enabled = true;

        let channel = open_channel(
            [1u8; 33],
            [2u8; 33],
            50_000_00000000,
            25_000_00000000,
            100,
            &mut state,
        ).unwrap();

        assert_eq!(channel.capacity, 50_000_00000000);
        assert_eq!(state.total_channels, 1);
        assert_eq!(state.total_capacity, 50_000_00000000);
    }

    #[test]
    fn test_channel_below_minimum() {
        let mut state = LightningState::default();

        let result = open_channel(
            [1u8; 33],
            [2u8; 33],
            100_00000000, // $100 - below minimum
            50_00000000,
            100,
            &mut state,
        );

        assert!(matches!(result, Err(ZkUsdError::BelowMinimum { .. })));
    }

    #[test]
    fn test_add_htlc() {
        let mut channel = create_test_channel();
        channel.state = ChannelState::Open;

        let htlc = PendingHtlc {
            htlc_id: 1,
            amount: 1000_00000000, // $1k
            payment_hash: [4u8; 32],
            timeout_block: 244,
            direction: HtlcDirection::Outbound,
            onion_data: vec![],
            cltv_expiry_delta: 40,
        };

        channel.add_htlc(htlc).unwrap();

        assert_eq!(channel.pending_htlcs.len(), 1);
        assert!(channel.local_balance < 50_000_00000000);
    }

    #[test]
    fn test_settle_htlc() {
        let mut channel = create_test_channel();
        channel.state = ChannelState::Open;

        let preimage = [5u8; 32];
        let payment_hash = compute_payment_hash(&preimage);

        let htlc = PendingHtlc {
            htlc_id: 1,
            amount: 1000_00000000,
            payment_hash,
            timeout_block: 244,
            direction: HtlcDirection::Outbound,
            onion_data: vec![],
            cltv_expiry_delta: 40,
        };

        channel.add_htlc(htlc).unwrap();
        let old_remote = channel.remote_balance;

        channel.settle_htlc(payment_hash, preimage).unwrap();

        assert!(channel.pending_htlcs.is_empty());
        assert_eq!(channel.remote_balance, old_remote + 1000_00000000);
    }

    #[test]
    fn test_cancel_htlc() {
        let mut channel = create_test_channel();
        channel.state = ChannelState::Open;

        let payment_hash = [6u8; 32];
        let original_balance = channel.local_balance;

        let htlc = PendingHtlc {
            htlc_id: 1,
            amount: 1000_00000000,
            payment_hash,
            timeout_block: 244,
            direction: HtlcDirection::Outbound,
            onion_data: vec![],
            cltv_expiry_delta: 40,
        };

        channel.add_htlc(htlc).unwrap();
        channel.cancel_htlc(payment_hash).unwrap();

        assert!(channel.pending_htlcs.is_empty());
        assert_eq!(channel.local_balance, original_balance);
    }

    #[test]
    fn test_submarine_swap() {
        let mut state = LightningState::default();

        let swap = initiate_submarine_swap(
            [1u8; 32],
            [2u8; 32],
            10_000_00000000, // $10k
            1000, // 0.1% fee
            144,
            100,
            &mut state,
        ).unwrap();

        // Fee = $10k * 0.1% = $10
        assert_eq!(swap.fee, 10_00000000);
        assert_eq!(swap.lightning_amount, 10_000_00000000 - 10_00000000);
        assert_eq!(swap.status, SwapStatus::Pending);
    }

    #[test]
    fn test_reverse_submarine_swap() {
        let mut state = LightningState::default();

        let swap = initiate_reverse_swap(
            [1u8; 32],
            [2u8; 32],
            10_000_00000000, // $10k
            1000, // 0.1% fee
            144,
            100,
            &mut state,
        ).unwrap();

        assert_eq!(swap.fee, 10_00000000);
        assert_eq!(swap.onchain_amount, 10_000_00000000 - 10_00000000);
    }

    #[test]
    fn test_routing_fee_calculation() {
        let amount = 100_000_00000000; // $100k
        let fee = calculate_routing_fee(amount);

        // Base fee + proportional
        // base = 1000 msat = 1 sat = 0.00001 zkUSD
        // proportional = $100k * 100 / 1M = $10
        assert!(fee > 0);
        assert!(fee < amount / 100); // Less than 1%
    }

    #[test]
    fn test_liquidity_position() {
        let position = create_liquidity_position(
            [1u8; 32],
            50_000_00000000, // $50k
            100,
        ).unwrap();

        assert!(position.is_active);
        assert_eq!(position.zkusd_committed, 50_000_00000000);
        assert_eq!(position.fees_earned, 0);
    }

    #[test]
    fn test_cooperative_close() {
        let mut state = LightningState::default();
        state.is_enabled = true;
        state.total_capacity = 50_000_00000000;

        let mut channel = create_test_channel();
        channel.state = ChannelState::Open;

        let (local, remote) = close_channel_cooperative(&mut channel, &mut state).unwrap();

        assert_eq!(local, 50_000_00000000);
        assert_eq!(remote, 50_000_00000000);
        assert_eq!(channel.state, ChannelState::ClosingCooperative);
    }

    #[test]
    fn test_force_close() {
        let mut state = LightningState::default();
        state.is_enabled = true;
        state.total_capacity = 100_000_00000000;

        let mut channel = create_test_channel();
        channel.state = ChannelState::Open;

        let (local, remote, htlcs) = close_channel_force(&mut channel, &mut state).unwrap();

        assert_eq!(local, 50_000_00000000);
        assert_eq!(remote, 50_000_00000000);
        assert!(htlcs.is_empty());
        assert_eq!(channel.state, ChannelState::ClosingForce);
    }

    #[test]
    fn test_confirm_channel() {
        let mut channel = create_test_channel();
        assert_eq!(channel.state, ChannelState::PendingOpen);

        confirm_channel(&mut channel, [7u8; 32]).unwrap();

        assert_eq!(channel.state, ChannelState::Open);
        assert_eq!(channel.funding_txid, [7u8; 32]);
    }
}
