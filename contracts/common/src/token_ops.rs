//! Token Operations Module
//!
//! Handles zkUSD token operations including minting, burning, and transfers.
//! All operations are designed for UTXO atomicity and client-side validation.
//!
//! ## Key Features
//!
//! - **Mint Authorization**: Only authorized contracts can mint
//! - **Burn on Repay**: Tokens burned when debt is repaid
//! - **UTXO Transfers**: Atomic token transfers
//! - **Conservation**: Total inputs = Total outputs
//! - **Supply Tracking**: Track total supply changes

use crate::{Vec, ZkUsdError, ZkUsdResult};
use crate::errors::AmountErrorReason;
use crate::constants::token as token_config;

// ============================================================================
// Constants
// ============================================================================

/// Minimum transfer amount (1 zkUSD = 100_000_000)
pub const MIN_TRANSFER_AMOUNT: u64 = token_config::ONE;

/// Maximum supply (10 billion zkUSD - fits in u64)
/// 10_000_000_000 * 100_000_000 = 10^18 < u64::MAX
pub const MAX_SUPPLY: u64 = 10_000_000_000 * token_config::ONE;

/// Mint authorization roles
pub const ROLE_VAULT_MANAGER: u8 = 1;
pub const ROLE_STABILITY_POOL: u8 = 2;
pub const ROLE_FLASH_MINTER: u8 = 3;
pub const ROLE_PSM: u8 = 4;
pub const ROLE_GOVERNANCE: u8 = 5;

// ============================================================================
// Types
// ============================================================================

/// Token balance entry
#[derive(Debug, Clone)]
pub struct TokenBalance {
    /// Owner address
    pub owner: [u8; 32],
    /// Balance amount
    pub balance: u64,
    /// Block when last updated
    pub last_updated: u64,
}

impl TokenBalance {
    /// Create new balance entry
    pub fn new(owner: [u8; 32], balance: u64, block: u64) -> Self {
        Self {
            owner,
            balance,
            last_updated: block,
        }
    }

    /// Check if balance is sufficient for operation
    pub fn has_sufficient(&self, amount: u64) -> bool {
        self.balance >= amount
    }
}

/// Token supply state
#[derive(Debug, Clone, Default)]
pub struct TokenSupply {
    /// Total supply of zkUSD
    pub total_supply: u64,
    /// Total minted (cumulative)
    pub total_minted: u64,
    /// Total burned (cumulative)
    pub total_burned: u64,
    /// Number of holders
    pub holder_count: u64,
    /// Last block supply was updated
    pub last_update_block: u64,
}

impl TokenSupply {
    /// Create new supply tracker
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if mint would exceed max supply
    pub fn can_mint(&self, amount: u64) -> bool {
        self.total_supply.saturating_add(amount) <= MAX_SUPPLY
    }

    /// Calculate circulating supply
    pub fn circulating(&self) -> u64 {
        self.total_minted.saturating_sub(self.total_burned)
    }
}

/// Mint authorization entry
#[derive(Debug, Clone)]
pub struct MintAuth {
    /// Contract address authorized to mint
    pub contract: [u8; 32],
    /// Role type
    pub role: u8,
    /// Maximum mint per transaction
    pub max_mint_per_tx: u64,
    /// Maximum cumulative mint
    pub max_cumulative_mint: u64,
    /// Current cumulative mint amount
    pub cumulative_minted: u64,
    /// Block when authorization was granted
    pub authorized_at: u64,
    /// Whether authorization is active
    pub is_active: bool,
}

impl MintAuth {
    /// Create new mint authorization
    pub fn new(
        contract: [u8; 32],
        role: u8,
        max_per_tx: u64,
        max_cumulative: u64,
        block: u64,
    ) -> Self {
        Self {
            contract,
            role,
            max_mint_per_tx: max_per_tx,
            max_cumulative_mint: max_cumulative,
            cumulative_minted: 0,
            authorized_at: block,
            is_active: true,
        }
    }

    /// Check if can mint amount
    pub fn can_mint(&self, amount: u64) -> bool {
        self.is_active
            && amount <= self.max_mint_per_tx
            && self.cumulative_minted.saturating_add(amount) <= self.max_cumulative_mint
    }
}

/// Transfer request
#[derive(Debug, Clone)]
pub struct TransferRequest {
    /// Sender address
    pub from: [u8; 32],
    /// Recipient address
    pub to: [u8; 32],
    /// Amount to transfer
    pub amount: u64,
    /// Block height
    pub block_height: u64,
}

/// Mint request
#[derive(Debug, Clone)]
pub struct MintRequest {
    /// Contract requesting mint
    pub minter: [u8; 32],
    /// Recipient address
    pub to: [u8; 32],
    /// Amount to mint
    pub amount: u64,
    /// Block height
    pub block_height: u64,
}

/// Burn request
#[derive(Debug, Clone)]
pub struct BurnRequest {
    /// Address burning tokens
    pub from: [u8; 32],
    /// Amount to burn
    pub amount: u64,
    /// Block height
    pub block_height: u64,
}

/// Transfer result
#[derive(Debug, Clone)]
pub struct TransferResult {
    /// Updated sender balance
    pub from_balance: TokenBalance,
    /// Updated recipient balance
    pub to_balance: TokenBalance,
    /// Transfer amount (confirmed)
    pub amount: u64,
}

/// Mint result
#[derive(Debug, Clone)]
pub struct MintResult {
    /// Updated recipient balance
    pub balance: TokenBalance,
    /// Amount minted
    pub amount: u64,
    /// New total supply
    pub new_supply: u64,
}

/// Burn result
#[derive(Debug, Clone)]
pub struct BurnResult {
    /// Updated balance
    pub balance: TokenBalance,
    /// Amount burned
    pub amount: u64,
    /// New total supply
    pub new_supply: u64,
}

/// Batch transfer entry
#[derive(Debug, Clone)]
pub struct BatchTransfer {
    /// Recipient address
    pub to: [u8; 32],
    /// Amount to transfer
    pub amount: u64,
}

/// UTXO token input
#[derive(Debug, Clone)]
pub struct TokenUtxoInput {
    /// UTXO identifier
    pub utxo_id: [u8; 32],
    /// Token amount in this UTXO
    pub amount: u64,
    /// Owner address
    pub owner: [u8; 32],
}

/// UTXO token output
#[derive(Debug, Clone)]
pub struct TokenUtxoOutput {
    /// Recipient address
    pub owner: [u8; 32],
    /// Token amount
    pub amount: u64,
}

// ============================================================================
// Core Token Functions
// ============================================================================

/// Validate transfer request
pub fn validate_transfer(request: &TransferRequest) -> ZkUsdResult<()> {
    if request.amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    if request.from == request.to {
        return Err(ZkUsdError::InvalidInput {
            param: "to",
            reason: "Cannot transfer to self",
        });
    }

    Ok(())
}

/// Execute a token transfer
pub fn execute_transfer(
    request: &TransferRequest,
    from_balance: &TokenBalance,
    to_balance: Option<&TokenBalance>,
) -> ZkUsdResult<TransferResult> {
    validate_transfer(request)?;

    // Check sufficient balance
    if from_balance.balance < request.amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: from_balance.balance,
            requested: request.amount,
        });
    }

    // Calculate new balances
    let new_from_balance = TokenBalance::new(
        request.from,
        from_balance.balance.saturating_sub(request.amount),
        request.block_height,
    );

    let existing_to = to_balance.map(|b| b.balance).unwrap_or(0);
    let new_to_balance = TokenBalance::new(
        request.to,
        existing_to.saturating_add(request.amount),
        request.block_height,
    );

    Ok(TransferResult {
        from_balance: new_from_balance,
        to_balance: new_to_balance,
        amount: request.amount,
    })
}

/// Validate mint request
pub fn validate_mint(
    request: &MintRequest,
    auth: &MintAuth,
    supply: &TokenSupply,
) -> ZkUsdResult<()> {
    // Check authorization
    if request.minter != auth.contract {
        return Err(ZkUsdError::MintUnauthorized {
            caller: request.minter,
        });
    }

    if !auth.is_active {
        return Err(ZkUsdError::MintUnauthorized {
            caller: request.minter,
        });
    }

    // Check limits
    if !auth.can_mint(request.amount) {
        return Err(ZkUsdError::InvalidAmount {
            amount: request.amount,
            reason: AmountErrorReason::TooLarge,
        });
    }

    // Check max supply
    if !supply.can_mint(request.amount) {
        return Err(ZkUsdError::InvalidAmount {
            amount: request.amount,
            reason: AmountErrorReason::TooLarge,
        });
    }

    if request.amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    Ok(())
}

/// Execute a mint operation
pub fn execute_mint(
    request: &MintRequest,
    auth: &mut MintAuth,
    supply: &mut TokenSupply,
    existing_balance: Option<&TokenBalance>,
) -> ZkUsdResult<MintResult> {
    validate_mint(request, auth, supply)?;

    // Update authorization tracking
    auth.cumulative_minted = auth.cumulative_minted.saturating_add(request.amount);

    // Update supply
    supply.total_supply = supply.total_supply.saturating_add(request.amount);
    supply.total_minted = supply.total_minted.saturating_add(request.amount);
    supply.last_update_block = request.block_height;

    // Update or create balance
    let existing = existing_balance.map(|b| b.balance).unwrap_or(0);
    if existing == 0 && existing_balance.is_none() {
        supply.holder_count += 1;
    }

    let balance = TokenBalance::new(
        request.to,
        existing.saturating_add(request.amount),
        request.block_height,
    );

    Ok(MintResult {
        balance,
        amount: request.amount,
        new_supply: supply.total_supply,
    })
}

/// Validate burn request
pub fn validate_burn(request: &BurnRequest, balance: &TokenBalance) -> ZkUsdResult<()> {
    if request.amount == 0 {
        return Err(ZkUsdError::ZeroAmount);
    }

    if balance.balance < request.amount {
        return Err(ZkUsdError::InsufficientBalance {
            available: balance.balance,
            requested: request.amount,
        });
    }

    Ok(())
}

/// Execute a burn operation
pub fn execute_burn(
    request: &BurnRequest,
    balance: &TokenBalance,
    supply: &mut TokenSupply,
) -> ZkUsdResult<BurnResult> {
    validate_burn(request, balance)?;

    // Update supply
    supply.total_supply = supply.total_supply.saturating_sub(request.amount);
    supply.total_burned = supply.total_burned.saturating_add(request.amount);
    supply.last_update_block = request.block_height;

    // Update balance
    let new_balance = balance.balance.saturating_sub(request.amount);
    if new_balance == 0 {
        supply.holder_count = supply.holder_count.saturating_sub(1);
    }

    let updated_balance = TokenBalance::new(request.from, new_balance, request.block_height);

    Ok(BurnResult {
        balance: updated_balance,
        amount: request.amount,
        new_supply: supply.total_supply,
    })
}

/// Execute batch transfers from single sender
pub fn execute_batch_transfer(
    from: [u8; 32],
    transfers: &[BatchTransfer],
    from_balance: &TokenBalance,
    block_height: u64,
) -> ZkUsdResult<Vec<TransferResult>> {
    // Calculate total amount
    let total: u64 = transfers.iter().map(|t| t.amount).sum();

    if from_balance.balance < total {
        return Err(ZkUsdError::InsufficientBalance {
            available: from_balance.balance,
            requested: total,
        });
    }

    let mut results = Vec::new();
    let mut remaining = from_balance.balance;

    for transfer in transfers {
        if transfer.amount == 0 {
            continue;
        }

        remaining = remaining.saturating_sub(transfer.amount);

        results.push(TransferResult {
            from_balance: TokenBalance::new(from, remaining, block_height),
            to_balance: TokenBalance::new(transfer.to, transfer.amount, block_height),
            amount: transfer.amount,
        });
    }

    Ok(results)
}

/// Verify UTXO token conservation (inputs = outputs)
pub fn verify_conservation(
    inputs: &[TokenUtxoInput],
    outputs: &[TokenUtxoOutput],
) -> ZkUsdResult<()> {
    let total_input: u64 = inputs.iter().map(|i| i.amount).sum();
    let total_output: u64 = outputs.iter().map(|o| o.amount).sum();

    if total_input != total_output {
        return Err(ZkUsdError::ConservationViolated {
            inputs: total_input,
            outputs: total_output,
        });
    }

    Ok(())
}

/// Create authorization for a contract
pub fn create_mint_auth(
    contract: [u8; 32],
    role: u8,
    max_per_tx: u64,
    max_cumulative: u64,
    block: u64,
) -> MintAuth {
    MintAuth::new(contract, role, max_per_tx, max_cumulative, block)
}

/// Revoke mint authorization
pub fn revoke_mint_auth(auth: &mut MintAuth) {
    auth.is_active = false;
}

/// Get token metadata
#[derive(Debug, Clone)]
pub struct TokenInfo {
    /// Token name
    pub name: &'static str,
    /// Token symbol
    pub symbol: &'static str,
    /// Decimal places
    pub decimals: u8,
    /// Total supply
    pub total_supply: u64,
    /// Max supply
    pub max_supply: u64,
}

/// Get token information
pub fn get_token_info(supply: &TokenSupply) -> TokenInfo {
    TokenInfo {
        name: token_config::NAME,
        symbol: token_config::SYMBOL,
        decimals: token_config::DECIMALS,
        total_supply: supply.total_supply,
        max_supply: MAX_SUPPLY,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_ZKUSD: u64 = 100_000_000;

    fn test_owner() -> [u8; 32] {
        [1u8; 32]
    }

    fn test_recipient() -> [u8; 32] {
        [2u8; 32]
    }

    fn test_minter() -> [u8; 32] {
        [3u8; 32]
    }

    #[test]
    fn test_transfer() {
        let from_balance = TokenBalance::new(test_owner(), 1000 * ONE_ZKUSD, 1000);

        let request = TransferRequest {
            from: test_owner(),
            to: test_recipient(),
            amount: 100 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_transfer(&request, &from_balance, None).unwrap();

        assert_eq!(result.from_balance.balance, 900 * ONE_ZKUSD);
        assert_eq!(result.to_balance.balance, 100 * ONE_ZKUSD);
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let from_balance = TokenBalance::new(test_owner(), 50 * ONE_ZKUSD, 1000);

        let request = TransferRequest {
            from: test_owner(),
            to: test_recipient(),
            amount: 100 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_transfer(&request, &from_balance, None);
        assert!(matches!(result, Err(ZkUsdError::InsufficientBalance { .. })));
    }

    #[test]
    fn test_transfer_to_self() {
        let from_balance = TokenBalance::new(test_owner(), 1000 * ONE_ZKUSD, 1000);

        let request = TransferRequest {
            from: test_owner(),
            to: test_owner(),
            amount: 100 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_transfer(&request, &from_balance, None);
        assert!(matches!(result, Err(ZkUsdError::InvalidInput { .. })));
    }

    #[test]
    fn test_mint() {
        let mut auth = MintAuth::new(
            test_minter(),
            ROLE_VAULT_MANAGER,
            1_000_000 * ONE_ZKUSD,
            100_000_000 * ONE_ZKUSD,
            1000,
        );
        let mut supply = TokenSupply::new();

        let request = MintRequest {
            minter: test_minter(),
            to: test_recipient(),
            amount: 10_000 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_mint(&request, &mut auth, &mut supply, None).unwrap();

        assert_eq!(result.balance.balance, 10_000 * ONE_ZKUSD);
        assert_eq!(supply.total_supply, 10_000 * ONE_ZKUSD);
        assert_eq!(auth.cumulative_minted, 10_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_mint_unauthorized() {
        let mut auth = MintAuth::new(
            test_minter(),
            ROLE_VAULT_MANAGER,
            1_000_000 * ONE_ZKUSD,
            100_000_000 * ONE_ZKUSD,
            1000,
        );
        let mut supply = TokenSupply::new();

        let request = MintRequest {
            minter: test_owner(), // Wrong minter
            to: test_recipient(),
            amount: 10_000 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_mint(&request, &mut auth, &mut supply, None);
        assert!(matches!(result, Err(ZkUsdError::MintUnauthorized { .. })));
    }

    #[test]
    fn test_mint_exceeds_limit() {
        let mut auth = MintAuth::new(
            test_minter(),
            ROLE_VAULT_MANAGER,
            100 * ONE_ZKUSD, // Low limit
            100_000_000 * ONE_ZKUSD,
            1000,
        );
        let mut supply = TokenSupply::new();

        let request = MintRequest {
            minter: test_minter(),
            to: test_recipient(),
            amount: 1_000 * ONE_ZKUSD, // Exceeds per-tx limit
            block_height: 1001,
        };

        let result = execute_mint(&request, &mut auth, &mut supply, None);
        assert!(matches!(result, Err(ZkUsdError::InvalidAmount { .. })));
    }

    #[test]
    fn test_burn() {
        let balance = TokenBalance::new(test_owner(), 1000 * ONE_ZKUSD, 1000);
        let mut supply = TokenSupply::new();
        supply.total_supply = 1000 * ONE_ZKUSD;

        let request = BurnRequest {
            from: test_owner(),
            amount: 300 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_burn(&request, &balance, &mut supply).unwrap();

        assert_eq!(result.balance.balance, 700 * ONE_ZKUSD);
        assert_eq!(supply.total_supply, 700 * ONE_ZKUSD);
        assert_eq!(supply.total_burned, 300 * ONE_ZKUSD);
    }

    #[test]
    fn test_burn_insufficient() {
        let balance = TokenBalance::new(test_owner(), 100 * ONE_ZKUSD, 1000);
        let mut supply = TokenSupply::new();
        supply.total_supply = 100 * ONE_ZKUSD;

        let request = BurnRequest {
            from: test_owner(),
            amount: 300 * ONE_ZKUSD,
            block_height: 1001,
        };

        let result = execute_burn(&request, &balance, &mut supply);
        assert!(matches!(result, Err(ZkUsdError::InsufficientBalance { .. })));
    }

    #[test]
    fn test_batch_transfer() {
        let from_balance = TokenBalance::new(test_owner(), 1000 * ONE_ZKUSD, 1000);

        let transfers = vec![
            BatchTransfer {
                to: test_recipient(),
                amount: 100 * ONE_ZKUSD,
            },
            BatchTransfer {
                to: [3u8; 32],
                amount: 200 * ONE_ZKUSD,
            },
        ];

        let results = execute_batch_transfer(test_owner(), &transfers, &from_balance, 1001).unwrap();

        assert_eq!(results.len(), 2);
        // Final from_balance should be 700
        assert_eq!(results[1].from_balance.balance, 700 * ONE_ZKUSD);
    }

    #[test]
    fn test_conservation() {
        let inputs = vec![
            TokenUtxoInput {
                utxo_id: [1u8; 32],
                amount: 100 * ONE_ZKUSD,
                owner: test_owner(),
            },
            TokenUtxoInput {
                utxo_id: [2u8; 32],
                amount: 50 * ONE_ZKUSD,
                owner: test_owner(),
            },
        ];

        let outputs = vec![
            TokenUtxoOutput {
                owner: test_recipient(),
                amount: 120 * ONE_ZKUSD,
            },
            TokenUtxoOutput {
                owner: test_owner(),
                amount: 30 * ONE_ZKUSD,
            },
        ];

        assert!(verify_conservation(&inputs, &outputs).is_ok());
    }

    #[test]
    fn test_conservation_violation() {
        let inputs = vec![TokenUtxoInput {
            utxo_id: [1u8; 32],
            amount: 100 * ONE_ZKUSD,
            owner: test_owner(),
        }];

        let outputs = vec![TokenUtxoOutput {
            owner: test_recipient(),
            amount: 120 * ONE_ZKUSD, // More than input
        }];

        let result = verify_conservation(&inputs, &outputs);
        assert!(matches!(result, Err(ZkUsdError::ConservationViolated { .. })));
    }

    #[test]
    fn test_revoke_auth() {
        let mut auth = MintAuth::new(
            test_minter(),
            ROLE_VAULT_MANAGER,
            1_000_000 * ONE_ZKUSD,
            100_000_000 * ONE_ZKUSD,
            1000,
        );

        assert!(auth.is_active);
        revoke_mint_auth(&mut auth);
        assert!(!auth.is_active);
        assert!(!auth.can_mint(100 * ONE_ZKUSD));
    }

    #[test]
    fn test_token_info() {
        let mut supply = TokenSupply::new();
        supply.total_supply = 1_000_000 * ONE_ZKUSD;

        let info = get_token_info(&supply);

        assert_eq!(info.name, "zkUSD");
        assert_eq!(info.symbol, "zkUSD");
        assert_eq!(info.decimals, 8);
        assert_eq!(info.total_supply, 1_000_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_supply_tracking() {
        let mut supply = TokenSupply::new();

        // Mint
        supply.total_supply = supply.total_supply.saturating_add(1000 * ONE_ZKUSD);
        supply.total_minted = supply.total_minted.saturating_add(1000 * ONE_ZKUSD);

        // Burn
        supply.total_supply = supply.total_supply.saturating_sub(300 * ONE_ZKUSD);
        supply.total_burned = supply.total_burned.saturating_add(300 * ONE_ZKUSD);

        assert_eq!(supply.circulating(), 700 * ONE_ZKUSD);
        assert_eq!(supply.total_minted, 1000 * ONE_ZKUSD);
        assert_eq!(supply.total_burned, 300 * ONE_ZKUSD);
    }

    #[test]
    fn test_max_supply() {
        let mut supply = TokenSupply::new();
        supply.total_supply = MAX_SUPPLY - 100 * ONE_ZKUSD;

        assert!(supply.can_mint(100 * ONE_ZKUSD));
        assert!(!supply.can_mint(101 * ONE_ZKUSD));
    }
}
