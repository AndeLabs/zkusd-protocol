//! zkUSD Token Contract
//!
//! Fungible token implementation for the zkUSD stablecoin.
//! Only authorized contracts (VaultManager) can mint/burn.
//!
//! This module is compatible with `no_std` environments when the
//! `std` feature is disabled (for WASM compilation with Charms SDK).
//!
//! ## Charms Integration
//!
//! When compiled with the `charms` feature, this crate provides a Charms
//! app entry point via the `charms` module.

use std::vec::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

#[cfg(feature = "charms")]
pub mod charms;

use zkusd_common::{
    constants::token,
    errors::{ZkUsdError, ZkUsdResult},
    events::{EventLog, ZkUsdEvent},
    types::{Address, AppId, TokenAction},
};

// ============ Token State ============

/// zkUSD Token state stored in charm data
/// Note: TokenMetadata is static and accessed via constants, not stored in state
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct ZkUsdTokenState {
    /// Authorized minter (VaultManager app_id)
    pub authorized_minter: AppId,
    /// Total supply tracking
    pub total_supply: u64,
}

// NOTE: Default trait intentionally NOT implemented to force explicit initialization
// with a valid authorized_minter address. This prevents security vulnerabilities
// from using a zero address as the minter.

impl ZkUsdTokenState {
    /// Create new token state with authorized minter
    pub fn new(authorized_minter: AppId) -> Self {
        Self {
            authorized_minter,
            total_supply: 0,
        }
    }

    /// Get token name
    pub fn name() -> &'static str {
        token::NAME
    }

    /// Get token symbol
    pub fn symbol() -> &'static str {
        token::SYMBOL
    }

    /// Get token decimals
    pub fn decimals() -> u8 {
        token::DECIMALS
    }
}

// ============ Token Balance (per UTXO) ============

/// Token balance held in a UTXO
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct TokenBalance {
    /// Owner address
    pub owner: Address,
    /// Amount of zkUSD (8 decimals)
    pub amount: u64,
}

impl TokenBalance {
    pub fn new(owner: Address, amount: u64) -> Self {
        Self { owner, amount }
    }
}

// ============ Validation Context ============

/// Context for validating token operations
/// This simulates what Charms SpellContext would provide
pub struct TokenContext {
    /// Input token balances being spent
    pub inputs: Vec<TokenBalance>,
    /// Output token balances being created
    pub outputs: Vec<TokenBalance>,
    /// Current token state (from controller NFT)
    pub token_state: ZkUsdTokenState,
    /// New token state (updated controller NFT)
    pub new_token_state: ZkUsdTokenState,
    /// Caller app_id (for mint/burn authorization)
    pub caller_app_id: Option<AppId>,
    /// Signer address
    pub signer: Address,
    /// Current block height
    pub block_height: u64,
    /// Event log for emitting events
    pub events: EventLog,
}

// ============ Validation Functions ============

/// Main validation entry point for token operations
pub fn validate(ctx: &mut TokenContext, action: &TokenAction) -> ZkUsdResult<()> {
    match action {
        TokenAction::Transfer { from, to, amount } => {
            validate_transfer(ctx, from, to, *amount)
        }
        TokenAction::Mint { to, amount } => {
            validate_mint(ctx, to, *amount)
        }
        TokenAction::Burn { from, amount } => {
            validate_burn(ctx, from, *amount)
        }
    }
}

/// Validate a transfer operation
fn validate_transfer(
    ctx: &mut TokenContext,
    from: &Address,
    to: &Address,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Calculate total inputs from sender
    let sender_input_total: u64 = ctx.inputs
        .iter()
        .filter(|i| &i.owner == from)
        .map(|i| i.amount)
        .sum();

    // 3. Sender must have enough balance
    if sender_input_total < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: sender_input_total,
            requested: amount,
        });
    }

    // 4. Calculate total outputs
    let total_inputs: u64 = ctx.inputs.iter().map(|i| i.amount).sum();
    let total_outputs: u64 = ctx.outputs.iter().map(|o| o.amount).sum();

    // 5. Conservation: inputs must equal outputs (no creation/destruction)
    if total_inputs != total_outputs {
        return Err(ZkUsdError::ConservationViolated {
            inputs: total_inputs,
            outputs: total_outputs,
        });
    }

    // 6. Verify recipient receives the amount
    let recipient_output: u64 = ctx.outputs
        .iter()
        .filter(|o| &o.owner == to)
        .map(|o| o.amount)
        .sum();

    if recipient_output < amount {
        return Err(ZkUsdError::InvalidAmount {
            amount: recipient_output,
            reason: zkusd_common::errors::AmountErrorReason::TooSmall,
        });
    }

    // 7. Verify signer is the sender
    if ctx.signer != *from {
        return Err(ZkUsdError::Unauthorized {
            expected: *from,
            actual: ctx.signer,
        });
    }

    // 8. Emit transfer event
    ctx.events.emit(ZkUsdEvent::TokenTransfer {
        from: *from,
        to: *to,
        amount,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate a mint operation (only from authorized minter)
fn validate_mint(
    ctx: &mut TokenContext,
    to: &Address,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Caller must be authorized minter (VaultManager)
    let caller = ctx.caller_app_id.ok_or(ZkUsdError::MintUnauthorized {
        caller: [0u8; 32],
    })?;

    if caller != ctx.token_state.authorized_minter {
        return Err(ZkUsdError::MintUnauthorized { caller });
    }

    // 3. Calculate input/output totals
    let total_inputs: u64 = ctx.inputs.iter().map(|i| i.amount).sum();
    let total_outputs: u64 = ctx.outputs.iter().map(|o| o.amount).sum();

    // 4. Outputs must be exactly inputs + minted amount
    if total_outputs != total_inputs + amount {
        return Err(ZkUsdError::ConservationViolated {
            inputs: total_inputs,
            outputs: total_outputs,
        });
    }

    // 5. Verify recipient receives the minted amount
    // For simple fungible tokens (owner=[0;32]), we skip the recipient check
    // since the owner is implicit in UTXO ownership
    let is_simple_fungible = ctx.outputs.iter().all(|o| o.owner == [0u8; 32]);

    if !is_simple_fungible {
        let recipient_output: u64 = ctx.outputs
            .iter()
            .filter(|o| &o.owner == to)
            .map(|o| o.amount)
            .sum();

        let recipient_input: u64 = ctx.inputs
            .iter()
            .filter(|i| &i.owner == to)
            .map(|i| i.amount)
            .sum();

        if recipient_output < recipient_input + amount {
            return Err(ZkUsdError::InvalidAmount {
                amount: recipient_output,
                reason: zkusd_common::errors::AmountErrorReason::TooSmall,
            });
        }
    }

    // 6. Update total supply in new state
    let new_supply = ctx.token_state.total_supply
        .checked_add(amount)
        .ok_or(ZkUsdError::Overflow)?;

    if ctx.new_token_state.total_supply != new_supply {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 7. Emit mint event
    ctx.events.emit(ZkUsdEvent::TokenMint {
        to: *to,
        amount,
        new_total_supply: new_supply,
        block_height: ctx.block_height,
    });

    Ok(())
}

/// Validate a burn operation (repaying debt)
fn validate_burn(
    ctx: &mut TokenContext,
    from: &Address,
    amount: u64,
) -> ZkUsdResult<()> {
    // 1. Amount must be positive
    if amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    // 2. Caller must be authorized (VaultManager for debt repayment)
    let caller = ctx.caller_app_id.ok_or(ZkUsdError::BurnUnauthorized {
        caller: [0u8; 32],
    })?;

    if caller != ctx.token_state.authorized_minter {
        return Err(ZkUsdError::BurnUnauthorized { caller });
    }

    // 3. Calculate totals
    let total_inputs: u64 = ctx.inputs.iter().map(|i| i.amount).sum();
    let total_outputs: u64 = ctx.outputs.iter().map(|o| o.amount).sum();

    // 4. Inputs must exceed outputs by burn amount
    if total_inputs != total_outputs + amount {
        return Err(ZkUsdError::ConservationViolated {
            inputs: total_inputs,
            outputs: total_outputs,
        });
    }

    // 5. Burner must have had the tokens
    let burner_input: u64 = ctx.inputs
        .iter()
        .filter(|i| &i.owner == from)
        .map(|i| i.amount)
        .sum();

    if burner_input < amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: burner_input,
            requested: amount,
        });
    }

    // 6. Update total supply
    let new_supply = ctx.token_state.total_supply
        .checked_sub(amount)
        .ok_or(ZkUsdError::Underflow)?;

    if ctx.new_token_state.total_supply != new_supply {
        return Err(ZkUsdError::InvalidStateTransition);
    }

    // 7. Emit burn event
    ctx.events.emit(ZkUsdEvent::TokenBurn {
        from: *from,
        amount,
        new_total_supply: new_supply,
        block_height: ctx.block_height,
    });

    Ok(())
}

// ============ Helper Functions ============

/// Get token name
pub fn get_name() -> &'static str {
    token::NAME
}

/// Get token symbol
pub fn get_symbol() -> &'static str {
    token::SYMBOL
}

/// Get token decimals
pub fn get_decimals() -> u8 {
    token::DECIMALS
}

/// Format amount for display (adds decimal point)
pub fn format_amount(amount: u64) -> (u64, u64) {
    let whole = amount / token::ONE;
    let fractional = amount % token::ONE;
    (whole, fractional)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_context() -> TokenContext {
        TokenContext {
            inputs: Vec::new(),
            outputs: Vec::new(),
            token_state: ZkUsdTokenState::new([1u8; 32]),
            new_token_state: ZkUsdTokenState::new([1u8; 32]),
            caller_app_id: None,
            signer: [0u8; 32],
            block_height: 100,
            events: EventLog::new(),
        }
    }

    #[test]
    fn test_transfer_success() {
        let mut ctx = create_test_context();
        let alice = [1u8; 32];
        let bob = [2u8; 32];

        ctx.signer = alice;
        ctx.inputs.push(TokenBalance::new(alice, 1000));
        ctx.outputs.push(TokenBalance::new(bob, 600));
        ctx.outputs.push(TokenBalance::new(alice, 400)); // change

        let action = TokenAction::Transfer {
            from: alice,
            to: bob,
            amount: 600,
        };

        let result = validate(&mut ctx, &action);
        assert!(result.is_ok());
        assert_eq!(ctx.events.len(), 1);
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let mut ctx = create_test_context();
        let alice = [1u8; 32];
        let bob = [2u8; 32];

        ctx.signer = alice;
        ctx.inputs.push(TokenBalance::new(alice, 500));
        ctx.outputs.push(TokenBalance::new(bob, 1000));

        let action = TokenAction::Transfer {
            from: alice,
            to: bob,
            amount: 1000,
        };

        let result = validate(&mut ctx, &action);
        assert!(matches!(result, Err(ZkUsdError::InsufficientBalance { .. })));
    }

    #[test]
    fn test_mint_authorized() {
        let mut ctx = create_test_context();
        let vault_manager = [1u8; 32];
        let user = [2u8; 32];

        ctx.caller_app_id = Some(vault_manager);
        ctx.token_state.authorized_minter = vault_manager;
        ctx.token_state.total_supply = 0;
        ctx.new_token_state.total_supply = 1000;

        ctx.outputs.push(TokenBalance::new(user, 1000));

        let action = TokenAction::Mint {
            to: user,
            amount: 1000,
        };

        let result = validate(&mut ctx, &action);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mint_unauthorized() {
        let mut ctx = create_test_context();
        let vault_manager = [1u8; 32];
        let attacker = [99u8; 32];
        let user = [2u8; 32];

        ctx.caller_app_id = Some(attacker);
        ctx.token_state.authorized_minter = vault_manager;

        let action = TokenAction::Mint {
            to: user,
            amount: 1000,
        };

        let result = validate(&mut ctx, &action);
        assert!(matches!(result, Err(ZkUsdError::MintUnauthorized { .. })));
    }

    #[test]
    fn test_burn_success() {
        let mut ctx = create_test_context();
        let vault_manager = [1u8; 32];
        let user = [2u8; 32];

        ctx.caller_app_id = Some(vault_manager);
        ctx.token_state.authorized_minter = vault_manager;
        ctx.token_state.total_supply = 10000;
        ctx.new_token_state.total_supply = 9000;

        ctx.inputs.push(TokenBalance::new(user, 5000));
        ctx.outputs.push(TokenBalance::new(user, 4000));

        let action = TokenAction::Burn {
            from: user,
            amount: 1000,
        };

        let result = validate(&mut ctx, &action);
        assert!(result.is_ok());
    }

    #[test]
    fn test_conservation_violation() {
        let mut ctx = create_test_context();
        let alice = [1u8; 32];
        let bob = [2u8; 32];

        ctx.signer = alice;
        ctx.inputs.push(TokenBalance::new(alice, 1000));
        ctx.outputs.push(TokenBalance::new(bob, 1500)); // More than input!

        let action = TokenAction::Transfer {
            from: alice,
            to: bob,
            amount: 1500,
        };

        let result = validate(&mut ctx, &action);
        // Should fail due to insufficient balance or conservation
        assert!(result.is_err());
    }
}
