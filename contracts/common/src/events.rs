//! Protocol Events for zkUSD
//!
//! Events are emitted during contract execution and can be indexed
//! off-chain for building UIs, analytics, and notifications.
//! Inspired by Soroban's event system.

use crate::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use crate::types::{Address, VaultId};

/// Event types for indexing and filtering
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum EventType {
    // Vault Events (0x01 - 0x1F)
    VaultOpened = 0x01,
    VaultClosed = 0x02,
    CollateralAdded = 0x03,
    CollateralWithdrawn = 0x04,
    DebtMinted = 0x05,
    DebtRepaid = 0x06,
    VaultLiquidated = 0x07,

    // Stability Pool Events (0x20 - 0x3F)
    StabilityDeposit = 0x20,
    StabilityWithdrawal = 0x21,
    BtcRewardClaimed = 0x22,
    LiquidationOffset = 0x23,

    // Token Events (0x40 - 0x5F)
    TokenTransfer = 0x40,
    TokenMint = 0x41,
    TokenBurn = 0x42,

    // Oracle Events (0x60 - 0x7F)
    PriceUpdated = 0x60,
    OracleOperatorChanged = 0x61,

    // Protocol Events (0x80 - 0x9F)
    ProtocolPaused = 0x80,
    ProtocolUnpaused = 0x81,
    AdminChanged = 0x82,
    RecoveryModeEntered = 0x83,
    RecoveryModeExited = 0x84,
    Redemption = 0x85,

    // Advanced Operation Events (0xA0 - 0xBF)
    FlashMint = 0xA0,
    VaultRescued = 0xA1,
    InsurancePurchased = 0xA2,
    InsuranceTriggered = 0xA3,
}

/// Main event enum containing all possible protocol events
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum ZkUsdEvent {
    // ============ Vault Events ============

    /// Emitted when a new vault is opened
    VaultOpened {
        vault_id: VaultId,
        owner: Address,
        collateral: u64,
        debt: u64,
        fee: u64,
        block_height: u64,
    },

    /// Emitted when a vault is closed
    VaultClosed {
        vault_id: VaultId,
        owner: Address,
        collateral_returned: u64,
        debt_repaid: u64,
        block_height: u64,
    },

    /// Emitted when collateral is added to a vault
    CollateralAdded {
        vault_id: VaultId,
        amount: u64,
        new_collateral: u64,
        new_icr: u64,
        block_height: u64,
    },

    /// Emitted when collateral is withdrawn from a vault
    CollateralWithdrawn {
        vault_id: VaultId,
        amount: u64,
        new_collateral: u64,
        new_icr: u64,
        block_height: u64,
    },

    /// Emitted when additional debt is minted
    DebtMinted {
        vault_id: VaultId,
        amount: u64,
        fee: u64,
        new_debt: u64,
        new_icr: u64,
        block_height: u64,
    },

    /// Emitted when debt is repaid
    DebtRepaid {
        vault_id: VaultId,
        amount: u64,
        new_debt: u64,
        new_icr: u64,
        block_height: u64,
    },

    /// Emitted when a vault is liquidated
    VaultLiquidated {
        vault_id: VaultId,
        owner: Address,
        liquidator: Address,
        debt_absorbed: u64,
        collateral_seized: u64,
        collateral_to_sp: u64,
        collateral_to_liquidator: u64,
        block_height: u64,
    },

    // ============ Stability Pool Events ============

    /// Emitted when zkUSD is deposited to stability pool
    StabilityDeposit {
        depositor: Address,
        amount: u64,
        new_deposit: u64,
        pool_total: u64,
        block_height: u64,
    },

    /// Emitted when zkUSD is withdrawn from stability pool
    StabilityWithdrawal {
        depositor: Address,
        zkusd_withdrawn: u64,
        compounded_amount: u64,
        block_height: u64,
    },

    /// Emitted when BTC rewards are claimed
    BtcRewardClaimed {
        depositor: Address,
        btc_amount: u64,
        block_height: u64,
    },

    /// Emitted when stability pool absorbs liquidation
    LiquidationOffset {
        debt_offset: u64,
        collateral_gained: u64,
        new_pool_total: u64,
        block_height: u64,
    },

    // ============ Token Events ============

    /// Emitted on token transfer
    TokenTransfer {
        from: Address,
        to: Address,
        amount: u64,
        block_height: u64,
    },

    /// Emitted when tokens are minted
    TokenMint {
        to: Address,
        amount: u64,
        new_total_supply: u64,
        block_height: u64,
    },

    /// Emitted when tokens are burned
    TokenBurn {
        from: Address,
        amount: u64,
        new_total_supply: u64,
        block_height: u64,
    },

    // ============ Oracle Events ============

    /// Emitted when BTC price is updated
    PriceUpdated {
        old_price: u64,
        new_price: u64,
        source: u8,
        block_height: u64,
    },

    /// Emitted when oracle operator changes
    OracleOperatorChanged {
        old_operator: Address,
        new_operator: Address,
        block_height: u64,
    },

    // ============ Protocol Events ============

    /// Emitted when protocol is paused
    ProtocolPaused {
        by: Address,
        block_height: u64,
    },

    /// Emitted when protocol is unpaused
    ProtocolUnpaused {
        by: Address,
        block_height: u64,
    },

    /// Emitted when admin is changed
    AdminChanged {
        old_admin: Address,
        new_admin: Address,
        block_height: u64,
    },

    /// Emitted when system enters Recovery Mode
    RecoveryModeEntered {
        tcr: u64,
        block_height: u64,
    },

    /// Emitted when system exits Recovery Mode
    RecoveryModeExited {
        tcr: u64,
        block_height: u64,
    },

    /// Emitted on redemption
    Redemption {
        redeemer: Address,
        zkusd_redeemed: u64,
        btc_received: u64,
        fee_paid: u64,
        vaults_affected: u32,
        block_height: u64,
    },

    // ============ Advanced Operation Events ============

    /// Emitted on flash mint
    FlashMint {
        minter: Address,
        amount: u64,
        fee: u64,
        block_height: u64,
    },

    /// Emitted when a vault is rescued by a third party
    VaultRescued {
        vault_id: VaultId,
        owner: Address,
        rescuer: Address,
        collateral_added: u64,
        debt_repaid: u64,
        rescuer_reward: u64,
        new_icr: u64,
        block_height: u64,
    },

    /// Emitted when insurance is purchased for a vault
    InsurancePurchased {
        vault_id: VaultId,
        owner: Address,
        coverage_btc: u64,
        premium: u64,
        trigger_icr: u64,
        block_height: u64,
    },

    /// Emitted when insurance protection is triggered
    InsuranceTriggered {
        insurance_id: [u8; 32],
        vault_id: VaultId,
        owner: Address,
        collateral_added: u64,
        new_icr: u64,
        block_height: u64,
    },
}

impl ZkUsdEvent {
    /// Get the event type for filtering
    pub fn event_type(&self) -> EventType {
        match self {
            Self::VaultOpened { .. } => EventType::VaultOpened,
            Self::VaultClosed { .. } => EventType::VaultClosed,
            Self::CollateralAdded { .. } => EventType::CollateralAdded,
            Self::CollateralWithdrawn { .. } => EventType::CollateralWithdrawn,
            Self::DebtMinted { .. } => EventType::DebtMinted,
            Self::DebtRepaid { .. } => EventType::DebtRepaid,
            Self::VaultLiquidated { .. } => EventType::VaultLiquidated,
            Self::StabilityDeposit { .. } => EventType::StabilityDeposit,
            Self::StabilityWithdrawal { .. } => EventType::StabilityWithdrawal,
            Self::BtcRewardClaimed { .. } => EventType::BtcRewardClaimed,
            Self::LiquidationOffset { .. } => EventType::LiquidationOffset,
            Self::TokenTransfer { .. } => EventType::TokenTransfer,
            Self::TokenMint { .. } => EventType::TokenMint,
            Self::TokenBurn { .. } => EventType::TokenBurn,
            Self::PriceUpdated { .. } => EventType::PriceUpdated,
            Self::OracleOperatorChanged { .. } => EventType::OracleOperatorChanged,
            Self::ProtocolPaused { .. } => EventType::ProtocolPaused,
            Self::ProtocolUnpaused { .. } => EventType::ProtocolUnpaused,
            Self::AdminChanged { .. } => EventType::AdminChanged,
            Self::RecoveryModeEntered { .. } => EventType::RecoveryModeEntered,
            Self::RecoveryModeExited { .. } => EventType::RecoveryModeExited,
            Self::Redemption { .. } => EventType::Redemption,
            Self::FlashMint { .. } => EventType::FlashMint,
            Self::VaultRescued { .. } => EventType::VaultRescued,
            Self::InsurancePurchased { .. } => EventType::InsurancePurchased,
            Self::InsuranceTriggered { .. } => EventType::InsuranceTriggered,
        }
    }

    /// Get the block height when event occurred
    pub fn block_height(&self) -> u64 {
        match self {
            Self::VaultOpened { block_height, .. } => *block_height,
            Self::VaultClosed { block_height, .. } => *block_height,
            Self::CollateralAdded { block_height, .. } => *block_height,
            Self::CollateralWithdrawn { block_height, .. } => *block_height,
            Self::DebtMinted { block_height, .. } => *block_height,
            Self::DebtRepaid { block_height, .. } => *block_height,
            Self::VaultLiquidated { block_height, .. } => *block_height,
            Self::StabilityDeposit { block_height, .. } => *block_height,
            Self::StabilityWithdrawal { block_height, .. } => *block_height,
            Self::BtcRewardClaimed { block_height, .. } => *block_height,
            Self::LiquidationOffset { block_height, .. } => *block_height,
            Self::TokenTransfer { block_height, .. } => *block_height,
            Self::TokenMint { block_height, .. } => *block_height,
            Self::TokenBurn { block_height, .. } => *block_height,
            Self::PriceUpdated { block_height, .. } => *block_height,
            Self::OracleOperatorChanged { block_height, .. } => *block_height,
            Self::ProtocolPaused { block_height, .. } => *block_height,
            Self::ProtocolUnpaused { block_height, .. } => *block_height,
            Self::AdminChanged { block_height, .. } => *block_height,
            Self::RecoveryModeEntered { block_height, .. } => *block_height,
            Self::RecoveryModeExited { block_height, .. } => *block_height,
            Self::Redemption { block_height, .. } => *block_height,
            Self::FlashMint { block_height, .. } => *block_height,
            Self::VaultRescued { block_height, .. } => *block_height,
            Self::InsurancePurchased { block_height, .. } => *block_height,
            Self::InsuranceTriggered { block_height, .. } => *block_height,
        }
    }

    /// Serialize event to bytes for storage/transmission
    pub fn to_bytes(&self) -> Vec<u8> {
        borsh::to_vec(self).unwrap_or_default()
    }

    /// Deserialize event from bytes
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        borsh::from_slice(bytes).ok()
    }
}

/// Event log for collecting multiple events during execution
#[derive(Debug, Clone, Default)]
pub struct EventLog {
    events: Vec<ZkUsdEvent>,
}

impl EventLog {
    /// Create a new empty event log
    pub fn new() -> Self {
        Self { events: Vec::new() }
    }

    /// Emit an event (add to log)
    pub fn emit(&mut self, event: ZkUsdEvent) {
        self.events.push(event);
    }

    /// Get all events
    pub fn events(&self) -> &[ZkUsdEvent] {
        &self.events
    }

    /// Take ownership of all events
    pub fn into_events(self) -> Vec<ZkUsdEvent> {
        self.events
    }

    /// Filter events by type
    pub fn filter_by_type(&self, event_type: EventType) -> Vec<&ZkUsdEvent> {
        self.events
            .iter()
            .filter(|e| e.event_type() == event_type)
            .collect()
    }

    /// Check if any events were emitted
    pub fn has_events(&self) -> bool {
        !self.events.is_empty()
    }

    /// Get number of events
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Clear all events
    pub fn clear(&mut self) {
        self.events.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_type() {
        let event = ZkUsdEvent::VaultOpened {
            vault_id: [1u8; 32],
            owner: [2u8; 32],
            collateral: 100_000_000,
            debt: 50_000_00000000,
            fee: 250_00000000,
            block_height: 100,
        };

        assert_eq!(event.event_type(), EventType::VaultOpened);
        assert_eq!(event.block_height(), 100);
    }

    #[test]
    fn test_event_serialization() {
        let event = ZkUsdEvent::TokenTransfer {
            from: [1u8; 32],
            to: [2u8; 32],
            amount: 1000_00000000,
            block_height: 200,
        };

        let bytes = event.to_bytes();
        let restored = ZkUsdEvent::from_bytes(&bytes).unwrap();

        assert_eq!(event, restored);
    }

    #[test]
    fn test_event_log() {
        let mut log = EventLog::new();

        log.emit(ZkUsdEvent::VaultOpened {
            vault_id: [1u8; 32],
            owner: [2u8; 32],
            collateral: 100_000_000,
            debt: 50_000_00000000,
            fee: 250_00000000,
            block_height: 100,
        });

        log.emit(ZkUsdEvent::TokenMint {
            to: [2u8; 32],
            amount: 50_000_00000000,
            new_total_supply: 50_000_00000000,
            block_height: 100,
        });

        assert_eq!(log.len(), 2);
        assert!(log.has_events());

        let vault_events = log.filter_by_type(EventType::VaultOpened);
        assert_eq!(vault_events.len(), 1);
    }
}
