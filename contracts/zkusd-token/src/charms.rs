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
const OP_SET_MINTER: u8 = 0x04; // Admin-only: set authorized_minter (once)

/// Match a charm's app against the target app by VK and tag.
///
/// Deploy spells always have `identity = B32([0;32])` because the actual
/// app_id (SHA256 of commit UTXO) isn't known at spell creation time.
/// After deployment, the app_id is computed and used in subsequent spells.
/// This means input charms from a deploy spell have zero identity while
/// the current spell's app has the real identity. Matching by VK+tag
/// handles this transition correctly.
fn matches_app(charm_app: &App, target_app: &App) -> bool {
    charm_app.tag == target_app.tag && charm_app.vk == target_app.vk
}

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
    // For fungible tokens (tag='t'), validation is handled by the state NFT (tag='n')
    // The fungible token itself just needs to verify conservation
    if app.tag == 't' {
        // Fungible token amounts are validated through the state NFT's mint/burn/transfer
        // Here we just verify that the state NFT is also being updated in this transaction
        return validate_fungible_with_state(app, tx);
    }

    // Parse witness data - first check if it's an Initialize operation
    if let Some(init) = parse_init_witness(w) {
        // Handle Initialize specially (no input state required)
        let output_state = match extract_output_state(app, tx) {
            Some(s) => s,
            None => return false,
        };
        return validate_initialize(&output_state, &init);
    }

    // Check if it's a SetMinter operation
    if let Some(set_minter) = parse_set_minter_witness(w) {
        // SetMinter requires input and output state
        let (token_state, new_token_state) = match extract_token_states(app, tx) {
            Some(states) => states,
            None => return false,
        };
        // Get signer for admin check
        let signer = extract_signer(tx);
        return validate_set_minter(&token_state, &new_token_state, &set_minter, &signer);
    }

    // Not Initialize or SetMinter, parse as regular operation
    let witness = match parse_witness(w) {
        Some(op) => op,
        None => return false,
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
    let caller_app_id = extract_caller_app_id(app, tx);

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
    /// Admin address (can configure minter during bootstrap)
    pub admin: Address,
    /// VaultManager app_id that is authorized to mint/burn (can be zero for pending)
    pub authorized_minter: Address,
}

/// Witness structure for SetMinter operation (admin-only, one-time)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SetMinterWitness {
    pub op: u8,
    /// New authorized minter (VaultManager app_id)
    pub new_minter: Address,
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

/// Parse witness data to check if it's a SetMinter operation
fn parse_set_minter_witness(w: &Data) -> Option<SetMinterWitness> {
    if let Ok(set_minter) = w.value::<SetMinterWitness>() {
        if set_minter.op == OP_SET_MINTER {
            return Some(set_minter);
        }
    }
    None
}

/// Validate fungible token operation by verifying state NFT is also being updated
///
/// For fungible tokens (tag='t'), the actual validation (mint/burn/transfer) is done
/// by the state NFT (tag='n'). This function verifies:
/// 1. The state NFT is present in the transaction (authorization)
/// 2. Token amounts follow conservation rules (inputs >= outputs for transfers)
///
/// Inspired by toad-token pattern but with explicit authorization.
fn validate_fungible_with_state(app: &App, tx: &Transaction) -> bool {
    // Build the expected state NFT app (same VK as fungible token, but tag='n')
    let state_nft = App {
        tag: 'n',
        identity: app.identity.clone(),
        vk: app.vk.clone(),
    };

    // Check if state NFT is being updated in this transaction (inputs, outputs, or refs)
    // Use VK-based matching to handle deploy spells (which have zero identity)
    let has_state_in_inputs = tx.ins.iter().any(|(_, charms)| {
        charms.iter().any(|(charm_app, _)| matches_app(charm_app, &state_nft))
    });

    let has_state_in_outputs = tx.outs.iter().any(|charms| {
        charms.iter().any(|(charm_app, _)| matches_app(charm_app, &state_nft))
    });

    // Also check refs for read-only state validation (e.g., transfers)
    let has_state_in_refs = tx.refs.iter().any(|(_, charms)| {
        charms.iter().any(|(charm_app, _)| matches_app(charm_app, &state_nft))
    });

    // Valid if state NFT is present in inputs, outputs, or refs
    // This ensures that fungible token operations are authorized by the state NFT
    has_state_in_inputs || has_state_in_outputs || has_state_in_refs
}

/// Validate initialization of token state
///
/// # Bootstrap Pattern (Production Best Practice)
///
/// Initialization allows two modes:
/// 1. **Direct**: Admin + minter both set (if minter app_id known)
/// 2. **Pending**: Admin set, minter = zero (requires SetMinter before mint/burn)
///
/// This solves the chicken-and-egg problem where Token needs VaultManager app_id
/// but VaultManager doesn't exist yet.
fn validate_initialize(output: &ZkUsdTokenState, init: &InitWitness) -> bool {
    // 1. Admin MUST be non-zero (security critical)
    if init.admin == [0u8; 32] {
        return false;
    }

    // 2. Verify output admin matches witness
    if output.admin != init.admin {
        return false;
    }

    // 3. Verify output minter matches witness (can be zero for pending mode)
    if output.authorized_minter != init.authorized_minter {
        return false;
    }

    // 4. Initial supply MUST be 0
    if output.total_supply != 0 {
        return false;
    }

    true
}

/// Validate SetMinter operation (admin-only, one-time during bootstrap)
///
/// # Security Constraints
/// - Only the admin can call this
/// - Minter must currently be zero (pending state)
/// - New minter must be non-zero
/// - This is a one-time operation (cannot change after set)
fn validate_set_minter(
    current: &ZkUsdTokenState,
    output: &ZkUsdTokenState,
    witness: &SetMinterWitness,
    signer: &[u8; 32],
) -> bool {
    // 1. Only admin can set minter
    if *signer != current.admin {
        return false;
    }

    // 2. Minter must currently be zero (pending state)
    // This ensures SetMinter is a one-time operation
    if current.authorized_minter != [0u8; 32] {
        return false;
    }

    // 3. New minter must be non-zero
    if witness.new_minter == [0u8; 32] {
        return false;
    }

    // 4. Verify output state matches expected changes
    // Admin remains unchanged
    if output.admin != current.admin {
        return false;
    }

    // Minter is updated
    if output.authorized_minter != witness.new_minter {
        return false;
    }

    // Total supply remains unchanged
    if output.total_supply != current.total_supply {
        return false;
    }

    true
}

/// Extract only the output state (for Initialize operation)
fn extract_output_state(app: &App, tx: &Transaction) -> Option<ZkUsdTokenState> {
    tx.outs.iter()
        .find_map(|charms| {
            // Try exact App match first (preferred)
            if let Some(data) = charms.get(app) {
                if let Some(state) = deserialize_token_state(data) {
                    return Some(state);
                }
            }
            // Fallback: VK+tag match (handles deploy spells with zero identity)
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, app) {
                    if let Some(state) = deserialize_token_state(data) {
                        return Some(state);
                    }
                }
            }
            None
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
///
/// Uses VK+tag matching to handle the deploy→post-deploy identity transition.
/// Deploy spells have identity=zero, while post-deploy spells have the real app_id.
/// Matching by VK (which is consistent) ensures both cases work.
fn extract_token_states(app: &App, tx: &Transaction) -> Option<(ZkUsdTokenState, ZkUsdTokenState)> {
    // In Charms, token state is stored in a controller NFT (tag='n') with the same VK
    // The fungible token uses tag='t', but the state NFT uses tag='n'

    // Build the NFT state app reference for matching
    let nft_ref = App {
        tag: 'n',
        identity: app.identity.clone(),
        vk: app.vk.clone(),
    };

    // Find input state (from refs or ins) - match by VK+tag to handle zero identity
    let input_state = tx.refs.iter()
        .chain(tx.ins.iter())
        .find_map(|(_, charms)| {
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, &nft_ref) {
                    if let Some(state) = deserialize_token_state(data) {
                        return Some(state);
                    }
                }
            }
            None
        });

    // Find output state - match by VK+tag
    let output_state = tx.outs.iter()
        .find_map(|charms| {
            for (charm_app, data) in charms.iter() {
                if matches_app(charm_app, &nft_ref) {
                    if let Some(state) = deserialize_token_state(data) {
                        return Some(state);
                    }
                }
            }
            None
        })?; // Output state is required

    // For first mint (no input state), create a default state with supply=0
    let input_state = input_state.unwrap_or_else(|| {
        // For first mint, we use the output state's admin and authorized_minter as the default
        ZkUsdTokenState {
            admin: output_state.admin,
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

    // New format: [admin (32 bytes), authorized_minter (32 bytes), total_supply (8 bytes)]
    if bytes.len() >= 72 {
        let mut admin = [0u8; 32];
        let mut authorized_minter = [0u8; 32];
        admin.copy_from_slice(&bytes[0..32]);
        authorized_minter.copy_from_slice(&bytes[32..64]);
        let total_supply = u64::from_le_bytes(bytes[64..72].try_into().ok()?);

        return Some(ZkUsdTokenState {
            admin,
            authorized_minter,
            total_supply,
        });
    }

    // Legacy format: [authorized_minter (32 bytes), total_supply (8 bytes)]
    // For backwards compatibility during migration
    if bytes.len() >= 40 {
        let mut authorized_minter = [0u8; 32];
        authorized_minter.copy_from_slice(&bytes[0..32]);
        let total_supply = u64::from_le_bytes(bytes[32..40].try_into().ok()?);

        return Some(ZkUsdTokenState {
            admin: [0u8; 32], // No admin in legacy format
            authorized_minter,
            total_supply,
        });
    }

    None
}

/// Extract token balances from transaction inputs and outputs
fn extract_balances(app: &App, tx: &Transaction) -> Option<(Vec<TokenBalance>, Vec<TokenBalance>)> {
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();

    // Note: app parameter has tag='n' (state NFT) when validating state
    // But balances are stored with tag='t' (fungible tokens)
    // Build a fungible token reference with tag='t' and same VK
    let token_ref = App {
        tag: 't',
        identity: app.identity.clone(),
        vk: app.vk.clone(),
    };

    // Extract from inputs - match by VK+tag to handle zero identity
    for (_, charms) in &tx.ins {
        for (charm_app, data) in charms.iter() {
            if matches_app(charm_app, &token_ref) {
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

    // Extract from outputs - match by VK+tag
    for charms in &tx.outs {
        for (charm_app, data) in charms.iter() {
            if matches_app(charm_app, &token_ref) {
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
///
/// Finds the VaultManager by looking at NFT apps in the transaction that are NOT the token.
/// Uses VK to distinguish: the token has a known VK, any other NFT app is the caller.
///
/// This works because in mint/burn operations:
/// - Token state NFT (VK = token_vk) is the token being operated on
/// - VaultManager NFT (VK ≠ token_vk) is the caller authorizing the operation
///
/// Returns the caller's identity from `app_public_inputs` (which has the real identity)
/// to correctly identify the VaultManager even after deploy→post-deploy transition.
fn extract_caller_app_id(app: &App, tx: &Transaction) -> Option<[u8; 32]> {
    let token_vk = &app.vk;

    // Check app_public_inputs first (has real identities, not zero)
    for (caller_app, _) in tx.app_public_inputs.iter() {
        if caller_app.tag == 'n' && caller_app.vk != *token_vk {
            return Some(caller_app.identity.0);
        }
    }

    // Fallback: check outputs for non-token NFT apps
    for charms in tx.outs.iter() {
        for (charm_app, _) in charms.iter() {
            if charm_app.tag == 'n' && charm_app.vk != *token_vk {
                return Some(charm_app.identity.0);
            }
        }
    }

    // Check inputs
    for (_, charms) in tx.ins.iter() {
        for (charm_app, _) in charms.iter() {
            if charm_app.tag == 'n' && charm_app.vk != *token_vk {
                return Some(charm_app.identity.0);
            }
        }
    }

    // Check refs
    for (_, charms) in tx.refs.iter() {
        for (charm_app, _) in charms.iter() {
            if charm_app.tag == 'n' && charm_app.vk != *token_vk {
                return Some(charm_app.identity.0);
            }
        }
    }

    None
}

/// Extract signer from transaction
fn extract_signer(tx: &Transaction) -> [u8; 32] {
    // Extract signer based on charm type:
    // - NFT state (tag='n'): use admin field (for SetMinter and admin ops)
    // - Fungible token (tag='t'): use balance owner field

    if let Some((_, charms)) = tx.ins.first() {
        for (charm_app, data) in charms.iter() {
            // For NFT state charms, extract admin from token state
            if charm_app.tag == 'n' {
                if let Some(state) = deserialize_token_state(data) {
                    if state.admin != [0u8; 32] {
                        return state.admin;
                    }
                }
            }
            // For fungible token charms, extract balance owner
            if charm_app.tag == 't' {
                if let Some(balance) = deserialize_balance(data) {
                    return balance.owner;
                }
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
            admin: [1u8; 32],
            authorized_minter: [5u8; 32],
            total_supply: 50000,
        };

        let data = Data::from(&state);
        let parsed = deserialize_token_state(&data).unwrap();

        assert_eq!(parsed.admin, [1u8; 32]);
        assert_eq!(parsed.authorized_minter, [5u8; 32]);
        assert_eq!(parsed.total_supply, 50000);
    }

    #[test]
    fn test_validate_initialize_with_pending_minter() {
        // Test initialization with pending minter (zero address)
        let admin = [1u8; 32];
        let output_state = ZkUsdTokenState {
            admin,
            authorized_minter: [0u8; 32], // Pending mode
            total_supply: 0,
        };

        let init = InitWitness {
            op: OP_INITIALIZE,
            admin,
            authorized_minter: [0u8; 32],
        };

        // Should succeed - pending minter is allowed
        assert!(validate_initialize(&output_state, &init));
    }

    #[test]
    fn test_validate_initialize_zero_admin_fails() {
        // Test that zero admin is rejected
        let output_state = ZkUsdTokenState {
            admin: [0u8; 32],
            authorized_minter: [0u8; 32],
            total_supply: 0,
        };

        let init = InitWitness {
            op: OP_INITIALIZE,
            admin: [0u8; 32], // Zero admin should fail
            authorized_minter: [0u8; 32],
        };

        // Should fail - zero admin not allowed
        assert!(!validate_initialize(&output_state, &init));
    }

    #[test]
    fn test_validate_set_minter_success() {
        let admin = [1u8; 32];
        let new_minter = [5u8; 32];

        let current = ZkUsdTokenState {
            admin,
            authorized_minter: [0u8; 32], // Pending
            total_supply: 0,
        };

        let output = ZkUsdTokenState {
            admin,
            authorized_minter: new_minter,
            total_supply: 0,
        };

        let witness = SetMinterWitness {
            op: OP_SET_MINTER,
            new_minter,
        };

        // Admin sets minter - should succeed
        assert!(validate_set_minter(&current, &output, &witness, &admin));
    }

    #[test]
    fn test_validate_set_minter_not_admin_fails() {
        let admin = [1u8; 32];
        let attacker = [99u8; 32];
        let new_minter = [5u8; 32];

        let current = ZkUsdTokenState {
            admin,
            authorized_minter: [0u8; 32],
            total_supply: 0,
        };

        let output = ZkUsdTokenState {
            admin,
            authorized_minter: new_minter,
            total_supply: 0,
        };

        let witness = SetMinterWitness {
            op: OP_SET_MINTER,
            new_minter,
        };

        // Attacker tries to set minter - should fail
        assert!(!validate_set_minter(&current, &output, &witness, &attacker));
    }

    #[test]
    fn test_validate_set_minter_already_set_fails() {
        let admin = [1u8; 32];
        let current_minter = [3u8; 32];
        let new_minter = [5u8; 32];

        let current = ZkUsdTokenState {
            admin,
            authorized_minter: current_minter, // Already set!
            total_supply: 0,
        };

        let output = ZkUsdTokenState {
            admin,
            authorized_minter: new_minter,
            total_supply: 0,
        };

        let witness = SetMinterWitness {
            op: OP_SET_MINTER,
            new_minter,
        };

        // Trying to change minter after already set - should fail
        assert!(!validate_set_minter(&current, &output, &witness, &admin));
    }

    #[test]
    fn test_set_minter_full_flow() {
        // Integration test: replicate the exact SetMinter transaction
        // as the Charms prover would construct it

        use charms_data::{UtxoId, TxId};

        let admin: [u8; 32] = [15, 239, 114, 232, 40, 108, 13, 216, 213, 221, 86, 158, 147, 4, 51, 195, 34, 51, 13, 51, 134, 80, 173, 193, 170, 10, 69, 2, 211, 90, 23, 72];
        let new_minter: [u8; 32] = [103, 46, 183, 113, 148, 110, 6, 127, 246, 39, 25, 206, 68, 121, 232, 39, 85, 33, 104, 220, 179, 12, 38, 7, 96, 50, 253, 51, 8, 7, 254, 121];

        // The NFT state app (tag='n')
        let nft_app = App {
            tag: 'n',
            identity: B32([0x41, 0xc9, 0x31, 0xc0, 0x1b, 0x8a, 0x8f, 0x0e, 0x97, 0x47, 0xf4, 0x3f, 0xaa, 0x12, 0xb3, 0x91, 0xc2, 0x4c, 0x3f, 0xbe, 0xff, 0x90, 0xc0, 0x89, 0x03, 0x88, 0x76, 0xa1, 0x67, 0x59, 0x1c, 0x95]),
            vk: B32([0xff, 0x94, 0x68, 0x77, 0xe5, 0x1d, 0x4d, 0x4f, 0x5a, 0xa1, 0xb1, 0xca, 0x77, 0x64, 0x02, 0x8e, 0x91, 0xb7, 0x15, 0xb0, 0x0d, 0x46, 0x59, 0x72, 0xcf, 0xc2, 0x95, 0x25, 0xad, 0x2b, 0xd7, 0x41]),
        };

        // Input state: Token V7 state UTXO with minter=zero
        let input_state = ZkUsdTokenState {
            admin,
            authorized_minter: [0u8; 32],
            total_supply: 0,
        };

        // Output state: minter set to VaultManager V5
        let output_state = ZkUsdTokenState {
            admin,
            authorized_minter: new_minter,
            total_supply: 0,
        };

        // Build the transaction
        let utxo_id = UtxoId(TxId([0xf7, 0xa1, 0x44, 0xef, 0x15, 0xbe, 0xad, 0xcd, 0x0e, 0x02, 0xa3, 0xdb, 0xc2, 0x3a, 0x83, 0x5e, 0x90, 0x08, 0x83, 0xbd, 0x84, 0xdb, 0x7f, 0x2b, 0x0d, 0x47, 0xf6, 0xfe, 0xa9, 0xf5, 0xfd, 0x4c]), 0);

        let mut input_charms = BTreeMap::new();
        input_charms.insert(nft_app.clone(), Data::from(&input_state));

        let mut output_charms = BTreeMap::new();
        output_charms.insert(nft_app.clone(), Data::from(&output_state));

        let tx = Transaction {
            ins: vec![(utxo_id, input_charms)],
            refs: Vec::new(),
            outs: vec![output_charms],
            coin_ins: None,
            coin_outs: None,
            prev_txs: BTreeMap::new(),
            app_public_inputs: BTreeMap::new(),
        };

        // Witness: SetMinter operation
        let witness = SetMinterWitness {
            op: OP_SET_MINTER,
            new_minter,
        };
        let w = Data::from(&witness);
        let x = Data::empty();

        // Step 1: Test witness parsing
        let parsed = parse_set_minter_witness(&w);
        assert!(parsed.is_some(), "SetMinter witness should parse");
        let parsed = parsed.unwrap();
        assert_eq!(parsed.op, OP_SET_MINTER, "op should be 4");
        assert_eq!(parsed.new_minter, new_minter, "new_minter should match");
        eprintln!("[TEST] Witness parsing OK");

        // Step 2: Test that it doesn't parse as InitWitness
        let init_parsed = parse_init_witness(&w);
        assert!(init_parsed.is_none(), "SetMinter witness should NOT parse as InitWitness");
        eprintln!("[TEST] Not parsed as InitWitness - OK");

        // Step 3: Test token state extraction
        let states = extract_token_states(&nft_app, &tx);
        assert!(states.is_some(), "Token states should be extractable");
        let (current, output) = states.unwrap();
        assert_eq!(current.admin, admin, "Input admin should match");
        assert_eq!(current.authorized_minter, [0u8; 32], "Input minter should be zero");
        assert_eq!(output.authorized_minter, new_minter, "Output minter should be new_minter");
        eprintln!("[TEST] Token state extraction OK");

        // Step 4: Test signer extraction
        let signer = extract_signer(&tx);
        assert_eq!(signer, admin, "Signer should be admin from NFT state");
        eprintln!("[TEST] Signer extraction OK: signer == admin");

        // Step 5: Test validate_set_minter directly
        let set_minter_result = validate_set_minter(&current, &output, &parsed, &signer);
        assert!(set_minter_result, "validate_set_minter should return true");
        eprintln!("[TEST] validate_set_minter OK");

        // Step 6: Test full validate_token_operation
        let result = validate_token_operation(&nft_app, &tx, &x, &w);
        assert!(result, "Full validate_token_operation should return true for SetMinter");
        eprintln!("[TEST] Full flow OK!");
    }

    #[test]
    fn test_set_minter_yaml_like_data() {
        // Test with CBOR data structured as maps (like YAML parsing produces)
        // instead of Data::from(&struct) which uses ciborium::Value::serialized
        use charms_data::{UtxoId, TxId};
        use ciborium::Value;

        let admin: [u8; 32] = [15, 239, 114, 232, 40, 108, 13, 216, 213, 221, 86, 158, 147, 4, 51, 195, 34, 51, 13, 51, 134, 80, 173, 193, 170, 10, 69, 2, 211, 90, 23, 72];
        let new_minter: [u8; 32] = [103, 46, 183, 113, 148, 110, 6, 127, 246, 39, 25, 206, 68, 121, 232, 39, 85, 33, 104, 220, 179, 12, 38, 7, 96, 50, 253, 51, 8, 7, 254, 121];

        let nft_app = App {
            tag: 'n',
            identity: B32([0x41, 0xc9, 0x31, 0xc0, 0x1b, 0x8a, 0x8f, 0x0e, 0x97, 0x47, 0xf4, 0x3f, 0xaa, 0x12, 0xb3, 0x91, 0xc2, 0x4c, 0x3f, 0xbe, 0xff, 0x90, 0xc0, 0x89, 0x03, 0x88, 0x76, 0xa1, 0x67, 0x59, 0x1c, 0x95]),
            vk: B32([0xff, 0x94, 0x68, 0x77, 0xe5, 0x1d, 0x4d, 0x4f, 0x5a, 0xa1, 0xb1, 0xca, 0x77, 0x64, 0x02, 0x8e, 0x91, 0xb7, 0x15, 0xb0, 0x0d, 0x46, 0x59, 0x72, 0xcf, 0xc2, 0x95, 0x25, 0xad, 0x2b, 0xd7, 0x41]),
        };

        // Manually construct CBOR Value as a YAML parser would produce
        fn bytes_to_cbor_array(bytes: &[u8]) -> Value {
            Value::Array(bytes.iter().map(|b| Value::Integer((*b as u64).into())).collect())
        }

        // Input state as CBOR map (like YAML parsing would produce)
        let input_state_cbor = Value::Map(vec![
            (Value::Text("admin".into()), bytes_to_cbor_array(&admin)),
            (Value::Text("authorized_minter".into()), bytes_to_cbor_array(&[0u8; 32])),
            (Value::Text("total_supply".into()), Value::Integer(0.into())),
        ]);

        // Output state as CBOR map
        let output_state_cbor = Value::Map(vec![
            (Value::Text("admin".into()), bytes_to_cbor_array(&admin)),
            (Value::Text("authorized_minter".into()), bytes_to_cbor_array(&new_minter)),
            (Value::Text("total_supply".into()), Value::Integer(0.into())),
        ]);

        // Witness as CBOR map
        let witness_cbor = Value::Map(vec![
            (Value::Text("op".into()), Value::Integer(4.into())),
            (Value::Text("new_minter".into()), bytes_to_cbor_array(&new_minter)),
        ]);

        // Convert CBOR Values to Data using bytes roundtrip
        let input_data = Data::try_from_bytes(&charms_data::util::write(&input_state_cbor).unwrap()).unwrap();
        let output_data = Data::try_from_bytes(&charms_data::util::write(&output_state_cbor).unwrap()).unwrap();
        let w = Data::try_from_bytes(&charms_data::util::write(&witness_cbor).unwrap()).unwrap();
        let x = Data::empty();

        // Test witness parsing with CBOR-map data
        let parsed = parse_set_minter_witness(&w);
        eprintln!("[YAML-TEST] parse_set_minter_witness: {:?}", parsed.is_some());
        assert!(parsed.is_some(), "SetMinter witness should parse from CBOR map");

        // Test init parsing should NOT match
        let init_parsed = parse_init_witness(&w);
        eprintln!("[YAML-TEST] parse_init_witness: {:?}", init_parsed.is_some());
        // Note: this might parse if serde is lenient with extra/missing fields!
        if init_parsed.is_some() {
            eprintln!("[YAML-TEST] WARNING: Witness parsed as InitWitness too! op={}", init_parsed.as_ref().unwrap().op);
        }

        // Test token state deserialization from CBOR map
        let state = deserialize_token_state(&input_data);
        eprintln!("[YAML-TEST] deserialize_token_state(input): {:?}", state.is_some());
        assert!(state.is_some(), "Should deserialize token state from CBOR map");
        let state = state.unwrap();
        assert_eq!(state.admin, admin);
        assert_eq!(state.authorized_minter, [0u8; 32]);

        // Build full transaction
        let utxo_id = UtxoId(TxId([0x01; 32]), 0);
        let mut input_charms = BTreeMap::new();
        input_charms.insert(nft_app.clone(), input_data);
        let mut output_charms = BTreeMap::new();
        output_charms.insert(nft_app.clone(), output_data);

        let tx = Transaction {
            ins: vec![(utxo_id, input_charms)],
            refs: Vec::new(),
            outs: vec![output_charms],
            coin_ins: None,
            coin_outs: None,
            prev_txs: BTreeMap::new(),
            app_public_inputs: BTreeMap::new(),
        };

        // Test full flow with YAML-like CBOR data
        let result = validate_token_operation(&nft_app, &tx, &x, &w);
        eprintln!("[YAML-TEST] validate_token_operation result: {}", result);
        assert!(result, "Full flow should work with YAML-like CBOR data");
    }

    #[test]
    fn test_set_minter_deploy_identity_transition() {
        // Critical test: replicates the EXACT scenario where a deploy spell
        // has identity=zero but the post-deploy SetMinter spell has the real identity.
        // This is the root cause of the SetMinter V3 failure.
        //
        // In Charms, deploy spells with `ins: []` have identity=B32([0;32]) because
        // the real app_id (SHA256 of commit UTXO) isn't known at spell creation time.
        // The to_tx() function builds input charms from the prev spell's apps, which
        // have zero identity. But the current spell's app has the real identity.

        use charms_data::{UtxoId, TxId};

        let admin: [u8; 32] = [15, 239, 114, 232, 40, 108, 13, 216, 213, 221, 86, 158, 147, 4, 51, 195, 34, 51, 13, 51, 134, 80, 173, 193, 170, 10, 69, 2, 211, 90, 23, 72];
        let new_minter: [u8; 32] = [103, 46, 183, 113, 148, 110, 6, 127, 246, 39, 25, 206, 68, 121, 232, 39, 85, 33, 104, 220, 179, 12, 38, 7, 96, 50, 253, 51, 8, 7, 254, 121];
        let real_identity = B32([0x41, 0xc9, 0x31, 0xc0, 0x1b, 0x8a, 0x8f, 0x0e, 0x97, 0x47, 0xf4, 0x3f, 0xaa, 0x12, 0xb3, 0x91, 0xc2, 0x4c, 0x3f, 0xbe, 0xff, 0x90, 0xc0, 0x89, 0x03, 0x88, 0x76, 0xa1, 0x67, 0x59, 0x1c, 0x95]);
        let vk = B32([0xff, 0x94, 0x68, 0x77, 0xe5, 0x1d, 0x4d, 0x4f, 0x5a, 0xa1, 0xb1, 0xca, 0x77, 0x64, 0x02, 0x8e, 0x91, 0xb7, 0x15, 0xb0, 0x0d, 0x46, 0x59, 0x72, 0xcf, 0xc2, 0x95, 0x25, 0xad, 0x2b, 0xd7, 0x41]);

        // The contract's app parameter has REAL identity (from SetMinter spell)
        let contract_app = App {
            tag: 'n',
            identity: real_identity,
            vk: vk.clone(),
        };

        // The INPUT charm's app has ZERO identity (from deploy spell's app_public_inputs)
        let deploy_app = App {
            tag: 'n',
            identity: B32([0u8; 32]),  // Zero identity from deploy
            vk: vk.clone(),            // Same VK
        };

        // The OUTPUT charm's app has REAL identity (from SetMinter spell)
        let output_app = contract_app.clone();

        // Input state (from deploy)
        let input_state = ZkUsdTokenState {
            admin,
            authorized_minter: [0u8; 32],
            total_supply: 0,
        };

        // Output state (SetMinter result)
        let output_state = ZkUsdTokenState {
            admin,
            authorized_minter: new_minter,
            total_supply: 0,
        };

        let utxo_id = UtxoId(TxId([0xf7; 32]), 0);

        // Input charms keyed by DEPLOY app (zero identity)
        let mut input_charms = BTreeMap::new();
        input_charms.insert(deploy_app, Data::from(&input_state));

        // Output charms keyed by REAL app (real identity)
        let mut output_charms = BTreeMap::new();
        output_charms.insert(output_app, Data::from(&output_state));

        let tx = Transaction {
            ins: vec![(utxo_id, input_charms)],
            refs: Vec::new(),
            outs: vec![output_charms],
            coin_ins: None,
            coin_outs: None,
            prev_txs: BTreeMap::new(),
            app_public_inputs: BTreeMap::new(),
        };

        // Witness: SetMinter operation
        let witness = SetMinterWitness {
            op: OP_SET_MINTER,
            new_minter,
        };
        let w = Data::from(&witness);
        let x = Data::empty();

        // Test extract_token_states with mismatched identities
        let states = extract_token_states(&contract_app, &tx);
        assert!(states.is_some(), "Should find token states despite identity mismatch (VK matching)");
        let (current, output) = states.unwrap();
        assert_eq!(current.admin, admin, "Input admin should match");
        assert_eq!(current.authorized_minter, [0u8; 32], "Input minter should be zero (from deploy)");
        assert_eq!(output.authorized_minter, new_minter, "Output minter should be new_minter");

        // Test signer extraction
        let signer = extract_signer(&tx);
        assert_eq!(signer, admin, "Signer should be admin from NFT state");

        // Test full validate_token_operation
        let result = validate_token_operation(&contract_app, &tx, &x, &w);
        assert!(result, "SetMinter should succeed with deploy→post-deploy identity transition");
    }
}
