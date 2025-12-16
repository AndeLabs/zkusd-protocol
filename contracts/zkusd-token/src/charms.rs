//! Charms SDK Integration for zkUSD Token
//!
//! This module provides the bridge between the Charms SDK types and
//! the internal zkUSD token validation logic.
//!
//! ## Operations
//!
//! - **Initialize (0x00)**: First-time creation of token state
//! - **Transfer (0x01)**: Transfer tokens between addresses
//! - **Mint (0x02)**: Create new tokens (VaultManager only)
//! - **Burn (0x03)**: Destroy tokens (VaultManager only)

use charms_data::{App, Data, Transaction};
use crate::{TokenBalance, TokenContext, ZkUsdTokenState, validate};
use zkusd_common::{
    events::EventLog,
    types::{Address, TokenAction},
};

/// Token operation types encoded in witness data
const OP_INITIALIZE: u8 = 0x00;
const OP_TRANSFER: u8 = 0x01;
const OP_MINT: u8 = 0x02;
const OP_BURN: u8 = 0x03;

/// Validates a zkUSD token operation within a Charms transaction.
///
/// This function is called by the Charms runtime to validate token
/// operations. It extracts the operation from witness data and delegates
/// to the internal validation logic.
///
/// ## Operations
///
/// - **Initialize**: Creates initial token state (no input state required)
/// - **Transfer/Mint/Burn**: Requires existing token state
///
/// # Arguments
/// * `app` - The zkUSD Token app definition
/// * `tx` - The transaction being validated
/// * `x` - Public input data (expected to be empty or contain external data)
/// * `w` - Witness data containing the operation details
///
/// # Returns
/// `true` if the operation is valid, `false` otherwise
pub fn validate_token_operation(
    app: &App,
    tx: &Transaction,
    _x: &Data,
    w: &Data,
) -> bool {
    // Parse witness data - first check if it's an Initialize operation
    let witness = match parse_init_witness(w) {
        Some(init) => {
            // Handle Initialize specially (no input state required)
            let output_state = match extract_output_state(app, tx) {
                Some(s) => s,
                None => return false,
            };
            return validate_initialize(&output_state, &init.authorized_minter);
        }
        None => {
            // Not an Initialize, parse as regular operation
            match parse_witness(w) {
                Some(op) => op,
                None => return false,
            }
        }
    };

    // For regular operations, extract token state from transaction
    let (token_state, new_token_state) = match extract_token_states(app, tx) {
        Some(states) => states,
        None => return false,
    };

    // Extract token balances from inputs and outputs
    let (inputs, outputs) = match extract_balances(app, tx) {
        Some(balances) => balances,
        None => return false,
    };

    // Determine the caller app (for mint/burn authorization)
    let caller_app_id = extract_caller_app_id(tx);

    // Get signer from transaction (simplified - in production would use signatures)
    let signer = extract_signer(tx);

    // Build validation context
    let mut ctx = TokenContext {
        inputs,
        outputs,
        token_state,
        new_token_state,
        caller_app_id,
        signer,
        block_height: 0, // Would be extracted from tx context
        events: EventLog::new(),
    };

    // Validate the operation
    validate(&mut ctx, &witness).is_ok()
}

/// Witness structure for Initialize operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InitWitness {
    pub op: u8,
    /// VaultManager app_id that is authorized to mint/burn
    pub authorized_minter: Address,
}

/// Witness structure for token operations (serialized via serde)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenWitness {
    pub op: u8,
    pub from: Option<[u8; 32]>,
    pub to: Option<[u8; 32]>,
    pub amount: u64,
}

/// Parse witness data to check if it's an Initialize operation
fn parse_init_witness(w: &Data) -> Option<InitWitness> {
    if let Ok(init) = w.value::<InitWitness>() {
        if init.op == OP_INITIALIZE {
            return Some(init);
        }
    }
    None
}

/// Validate initialization of token state
fn validate_initialize(output: &ZkUsdTokenState, authorized_minter: &Address) -> bool {
    // Verify output state matches initialization parameters
    if output.authorized_minter != *authorized_minter {
        return false;
    }
    // Initial supply must be 0
    if output.total_supply != 0 {
        return false;
    }
    // Authorized minter cannot be zero address
    if *authorized_minter == [0u8; 32] {
        return false;
    }
    true
}

/// Extract only the output state (for Initialize operation)
fn extract_output_state(app: &App, tx: &Transaction) -> Option<ZkUsdTokenState> {
    tx.outs.iter()
        .find_map(|charms| {
            charms.get(app).and_then(|data| {
                deserialize_token_state(data)
            })
        })
}

/// Parse witness data to extract the token operation
fn parse_witness(w: &Data) -> Option<TokenAction> {
    // First try serde deserialization (preferred)
    if let Ok(witness) = w.value::<TokenWitness>() {
        return match witness.op {
            OP_TRANSFER => Some(TokenAction::Transfer {
                from: witness.from?,
                to: witness.to?,
                amount: witness.amount,
            }),
            OP_MINT => Some(TokenAction::Mint {
                to: witness.to?,
                amount: witness.amount,
            }),
            OP_BURN => Some(TokenAction::Burn {
                from: witness.from?,
                amount: witness.amount,
            }),
            _ => None,
        };
    }

    // Fallback: Try raw bytes (for backwards compatibility)
    let bytes = w.bytes();
    if bytes.is_empty() {
        return None;
    }

    // Note: bytes() returns CBOR serialized data, so we need to handle that
    // For raw byte format, the first byte after CBOR header indicates op type
    parse_raw_bytes_witness(&bytes)
}

/// Parse witness from raw bytes (fallback method)
fn parse_raw_bytes_witness(bytes: &[u8]) -> Option<TokenAction> {
    // This handles the raw byte format if serde fails
    // Format depends on CBOR encoding of the bytes
    if bytes.len() < 2 {
        return None;
    }

    // Try to find the op code in the byte stream
    // CBOR bytes are prefixed with length info
    let op_index = if bytes[0] >= 0x40 && bytes[0] < 0x58 {
        // Short byte string (0-23 bytes header)
        1
    } else if bytes[0] == 0x58 {
        // Byte string with 1-byte length
        2
    } else if bytes[0] == 0x59 {
        // Byte string with 2-byte length
        3
    } else {
        0
    };

    if bytes.len() <= op_index {
        return None;
    }

    let op_byte = bytes[op_index];
    let data_start = op_index + 1;

    match op_byte {
        OP_TRANSFER if bytes.len() >= data_start + 32 + 32 + 8 => {
            let mut from = [0u8; 32];
            let mut to = [0u8; 32];
            from.copy_from_slice(&bytes[data_start..data_start + 32]);
            to.copy_from_slice(&bytes[data_start + 32..data_start + 64]);
            let amount = u64::from_le_bytes(
                bytes[data_start + 64..data_start + 72].try_into().ok()?
            );
            Some(TokenAction::Transfer { from, to, amount })
        }
        OP_MINT if bytes.len() >= data_start + 32 + 8 => {
            let mut to = [0u8; 32];
            to.copy_from_slice(&bytes[data_start..data_start + 32]);
            let amount = u64::from_le_bytes(
                bytes[data_start + 32..data_start + 40].try_into().ok()?
            );
            Some(TokenAction::Mint { to, amount })
        }
        OP_BURN if bytes.len() >= data_start + 32 + 8 => {
            let mut from = [0u8; 32];
            from.copy_from_slice(&bytes[data_start..data_start + 32]);
            let amount = u64::from_le_bytes(
                bytes[data_start + 32..data_start + 40].try_into().ok()?
            );
            Some(TokenAction::Burn { from, amount })
        }
        _ => None,
    }
}

/// Extract token states from transaction
fn extract_token_states(app: &App, tx: &Transaction) -> Option<(ZkUsdTokenState, ZkUsdTokenState)> {
    // In Charms, token state is stored in a controller NFT (tag='n') with the same identity
    // The fungible token uses tag='t', but the state NFT uses tag='n'

    // Find input state (from refs or ins) - search by identity, allow tag='n' for state
    let input_state = tx.refs.iter()
        .chain(tx.ins.iter())
        .find_map(|(_, charms)| {
            for (charm_app, data) in charms.iter() {
                // Match NFT state with same identity (tag='n' instead of 't')
                if charm_app.tag == 'n' && charm_app.identity == app.identity {
                    if let Some(state) = deserialize_token_state(data) {
                        return Some(state);
                    }
                }
            }
            None
        });

    // Find output state - search by identity with tag='n'
    let output_state = tx.outs.iter()
        .find_map(|charms| {
            for (charm_app, data) in charms.iter() {
                // Match NFT state with same identity
                if charm_app.tag == 'n' && charm_app.identity == app.identity {
                    if let Some(state) = deserialize_token_state(data) {
                        return Some(state);
                    }
                }
            }
            None
        })?; // Output state is required

    // For first mint (no input state), create a default state with supply=0
    let input_state = input_state.unwrap_or_else(|| {
        // For first mint, we use the output state's authorized_minter as the default
        ZkUsdTokenState {
            authorized_minter: output_state.authorized_minter,
            total_supply: 0,
        }
    });

    Some((input_state, output_state))
}

/// Deserialize token state from CBOR data
fn deserialize_token_state(data: &Data) -> Option<ZkUsdTokenState> {
    // Try to deserialize using serde first (preferred method)
    if let Ok(state) = data.value::<ZkUsdTokenState>() {
        return Some(state);
    }

    // Fallback: parse raw bytes
    let bytes = data.bytes();

    // Format: [authorized_minter (32 bytes), total_supply (8 bytes)]
    if bytes.len() < 40 {
        return None;
    }

    let mut authorized_minter = [0u8; 32];
    authorized_minter.copy_from_slice(&bytes[0..32]);
    let total_supply = u64::from_le_bytes(bytes[32..40].try_into().ok()?);

    Some(ZkUsdTokenState {
        authorized_minter,
        total_supply,
    })
}

/// Extract token balances from transaction inputs and outputs
fn extract_balances(app: &App, tx: &Transaction) -> Option<(Vec<TokenBalance>, Vec<TokenBalance>)> {
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();

    // Note: app parameter has tag='n' (state NFT) when validating state
    // But balances are stored with tag='t' (fungible tokens)
    // So we need to search by identity but with tag='t'

    // Extract from inputs - look for tag='t' with same identity
    for (_, charms) in &tx.ins {
        for (charm_app, data) in charms.iter() {
            if charm_app.tag == 't' && charm_app.identity == app.identity {
                if let Some(balance) = deserialize_balance(data) {
                    inputs.push(balance);
                } else {
                    // Try parsing as raw u64 (simple fungible token)
                    if let Ok(amount) = data.value::<u64>() {
                        inputs.push(TokenBalance {
                            owner: [0u8; 32], // Owner not tracked in simple fungible
                            amount,
                        });
                    }
                }
            }
        }
    }

    // Extract from outputs - look for tag='t' with same identity
    for charms in &tx.outs {
        for (charm_app, data) in charms.iter() {
            if charm_app.tag == 't' && charm_app.identity == app.identity {
                if let Some(balance) = deserialize_balance(data) {
                    outputs.push(balance);
                } else {
                    // Try parsing as raw u64 (simple fungible token)
                    if let Ok(amount) = data.value::<u64>() {
                        outputs.push(TokenBalance {
                            owner: [0u8; 32], // Owner not tracked in simple fungible
                            amount,
                        });
                    }
                }
            }
        }
    }

    Some((inputs, outputs))
}

/// Deserialize a token balance from data
fn deserialize_balance(data: &Data) -> Option<TokenBalance> {
    // Try serde deserialization first
    if let Ok(balance) = data.value::<TokenBalance>() {
        return Some(balance);
    }

    // Fallback: parse raw bytes
    let bytes = data.bytes();

    // Format: [owner (32 bytes), amount (8 bytes)]
    if bytes.len() < 40 {
        return None;
    }

    let mut owner = [0u8; 32];
    owner.copy_from_slice(&bytes[0..32]);
    let amount = u64::from_le_bytes(bytes[32..40].try_into().ok()?);

    Some(TokenBalance { owner, amount })
}

/// Extract the caller app ID (for cross-contract calls)
fn extract_caller_app_id(tx: &Transaction) -> Option<[u8; 32]> {
    // In Charms, cross-contract calls are identified by which apps
    // are involved in the transaction. For now, we look for the
    // VaultManager app in the transaction.

    // This would need to be determined by the transaction structure
    // For simplicity, we check app_public_inputs for other apps
    for (app, _) in tx.app_public_inputs.iter() {
        // Return the first non-token app as the caller
        // In production, this would be more sophisticated
        return Some(app.identity.0);
    }
    None
}

/// Extract signer from transaction
fn extract_signer(tx: &Transaction) -> [u8; 32] {
    // In production, this would verify signatures and extract the signer
    // For now, we use a placeholder

    // Could extract from coin_ins or first input owner
    if let Some((_, charms)) = tx.ins.first() {
        for (_, data) in charms.iter() {
            if let Some(balance) = deserialize_balance(data) {
                return balance.owner;
            }
        }
    }

    [0u8; 32]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use charms_data::B32;

    #[allow(dead_code)]
    fn create_test_app() -> App {
        App {
            tag: 't',
            identity: B32([1u8; 32]),
            vk: B32([0u8; 32]),
        }
    }

    #[allow(dead_code)]
    fn create_empty_tx() -> Transaction {
        Transaction {
            ins: Vec::new(),
            refs: Vec::new(),
            outs: Vec::new(),
            coin_ins: None,
            coin_outs: None,
            prev_txs: BTreeMap::new(),
            app_public_inputs: BTreeMap::new(),
        }
    }

    #[test]
    fn test_parse_transfer_witness() {
        // Create witness using the structured format (preferred)
        let witness = TokenWitness {
            op: OP_TRANSFER,
            from: Some([1u8; 32]),
            to: Some([2u8; 32]),
            amount: 1000,
        };

        // Create Data from witness using serde
        let data = Data::from(&witness);
        let action = parse_witness(&data).unwrap();

        match action {
            TokenAction::Transfer { from, to, amount } => {
                assert_eq!(from, [1u8; 32]);
                assert_eq!(to, [2u8; 32]);
                assert_eq!(amount, 1000);
            }
            _ => panic!("Expected Transfer action"),
        }
    }

    #[test]
    fn test_deserialize_token_state() {
        // Create state directly using serde
        let state = ZkUsdTokenState {
            authorized_minter: [5u8; 32],
            total_supply: 50000,
        };

        let data = Data::from(&state);
        let parsed = deserialize_token_state(&data).unwrap();

        assert_eq!(parsed.authorized_minter, [5u8; 32]);
        assert_eq!(parsed.total_supply, 50000);
    }
}
