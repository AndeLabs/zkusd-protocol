//! zkUSD Common Library
//!
//! Bitcoin UTXO-native implementation.
//!
//! Shared types, constants, and utilities for all zkUSD contracts.
//! This module provides the foundation for the entire protocol.
//!
//! ## IMPORTANT: This is Bitcoin, NOT Ethereum
//!
//! zkUSD uses **Charms protocol** on Bitcoin. All implementations follow:
//! - **UTXO model**: Consume inputs, create outputs (not account balances)
//! - **Spells**: Atomic state transitions (not function calls with callbacks)
//! - **Client-side validation**: ZK proofs for state validity
//! - **Single-use seals**: Double-spend prevention via UTXO consumption
//!
//! See `/docs/UTXO_NATIVE_DESIGN.md` for detailed design patterns.
//!
//! ## Key Innovations (UTXO-Native)
//!
//! - **Soft Liquidation**: LLAMMA-inspired gradual liquidation with reversibility
//! - **Vault Sharding**: Split large vaults for parallel processing
//! - **Redemption by Interest Rate**: Fairer redemption ordering (Liquity V2 style)
//! - **Insurance Charms**: Tradeable liquidation protection tokens
//! - **Batch Operations**: Process multiple operations atomically
//! - **Staked zkUSD**: Yield-bearing stablecoin via protocol fee distribution
//! - **Atomic Rescue**: Third-party vault rescue mechanism
//! - **Fee Prediction**: Deterministic fee estimation (eUTXO advantage)
//! - **Flash Minting**: Atomic mint-use-repay in single transaction (UTXO atomicity)
//! - **Leverage Looping**: Atomic leveraged positions with stop-loss protection
//! - **zkGOV Governance**: Decentralized governance with staking and delegation
//! - **Peg Stability Module**: 1:1 stablecoin swaps for peg maintenance
//! - **Multi-Collateral**: Support for multiple collateral types with risk parameters
//! - **Lightning Integration**: Lightning Network channels and submarine swaps
//! - **Cross-chain Beaming**: ZK-proven asset transfers across chains
//! - **Stress Testing**: Simulation framework for protocol resilience testing
//! - **Oracle System**: Multi-source price aggregation with TWAP and circuit breakers
//! - **Vault Manager**: Comprehensive vault lifecycle and registry management
//! - **Stability Pool**: Debt absorption and liquidation reward distribution
//! - **Token Operations**: zkUSD minting, burning, and transfer operations
//! - **Access Control**: Role-based permissions and multi-sig support
//! - **Emergency Module**: Circuit breakers and pause mechanisms
//! - **Rate Limiter**: Operation rate limiting and abuse prevention
//!
//! This crate is `no_std` compatible for WASM compilation when built
//! with the `no_std` feature enabled.

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;

// Re-export Vec for submodules based on feature
#[cfg(not(feature = "std"))]
pub use alloc::vec::Vec;
#[cfg(feature = "std")]
pub use std::vec::Vec;

pub mod constants;
pub mod errors;
pub mod types;
pub mod math;
pub mod events;
pub mod liquidation;
pub mod advanced_ops;
pub mod flash;
pub mod charms_ops;
pub mod leverage;
pub mod governance;
pub mod psm;
pub mod multicollateral;
pub mod lightning;
pub mod beaming;
pub mod stress;
pub mod oracle;
pub mod vault_manager;
pub mod stability_pool;
pub mod token_ops;
pub mod access_control;
pub mod emergency;
pub mod rate_limiter;

#[cfg(test)]
mod integration_tests;

// Re-exports for convenience
pub use constants::*;
pub use errors::*;
pub use types::*;
pub use math::*;
pub use events::*;
pub use liquidation::*;
pub use advanced_ops::*;
pub use flash::{
    FlashOperationType, FlashRequest, FlashResult, FlashMintState,
    FlashCallback, ArbitrageResult, SelfLiquidationResult, FlashMintSpell,
    initiate_flash_mint, complete_flash_mint, process_arbitrage_callback,
    process_self_liquidation, validate_callback_execution, CallbackProof,
    CallbackValidation, IntermediateOutput, VaultModification,
    FlashBorrowState, initiate_flash_borrow, complete_flash_borrow,
    FlashComboSpell, ComboFlashResult,
};
pub use charms_ops::*;
pub use leverage::*;
pub use governance::*;
pub use psm::*;
pub use multicollateral::*;
pub use lightning::*;
pub use beaming::*;
pub use stress::*;
pub use oracle::*;
pub use vault_manager::*;
pub use stability_pool::*;
pub use token_ops::*;
pub use access_control::*;
pub use emergency::*;
pub use rate_limiter::*;
