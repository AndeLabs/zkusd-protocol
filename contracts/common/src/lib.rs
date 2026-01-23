//! zkUSD Common Library
//!
//! Shared types, constants, and utilities for zkUSD protocol on Bitcoin.
//!
//! ## Core Modules
//!
//! - **constants**: Protocol parameters
//! - **types**: Core data structures (Vault, PriceData, etc.)
//! - **errors**: Error handling
//! - **events**: Event logging
//! - **math**: Financial calculations (ICR, TCR, fees)
//! - **liquidation**: Liquidation logic
//! - **charms_ops**: UTXO-native operations
//! - **oracle**: Price oracle utilities
//! - **vault_manager**: Vault lifecycle
//! - **stability_pool**: Debt absorption
//! - **token_ops**: Token minting/burning

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;

#[cfg(not(feature = "std"))]
pub use alloc::vec::Vec;
#[cfg(feature = "std")]
pub use std::vec::Vec;

// Core modules
pub mod constants;
pub mod errors;
pub mod types;
pub mod math;
pub mod events;
pub mod liquidation;
pub mod charms_ops;
pub mod oracle;
pub mod vault_manager;
pub mod stability_pool;
pub mod token_ops;
pub mod validation;

#[cfg(test)]
mod tests;

// Re-exports
pub use constants::*;
pub use errors::*;
pub use types::*;
pub use math::*;
pub use events::*;
pub use liquidation::*;
pub use charms_ops::*;
pub use oracle::*;
pub use vault_manager::*;
pub use stability_pool::*;
pub use token_ops::*;
pub use validation::*;
