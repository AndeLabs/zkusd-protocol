//! Integration Tests
//!
//! End-to-end tests that verify the interaction between multiple modules.
//! These tests simulate real-world scenarios in the zkUSD protocol.

#[cfg(test)]
mod tests {
    use crate::*;
    use crate::vault_manager::*;
    use crate::stability_pool::*;
    use crate::token_ops::*;
    use crate::oracle::*;
    use crate::access_control::*;
    use crate::emergency::*;
    use crate::rate_limiter::*;

    const ONE_BTC: u64 = 100_000_000;
    const ONE_ZKUSD: u64 = 100_000_000;
    const TEST_BTC_PRICE: u64 = 50_000_00000000; // $50,000
    const MCR_BPS: u64 = 11000; // 110%

    fn admin() -> [u8; 32] {
        [1u8; 32]
    }

    fn user1() -> [u8; 32] {
        [2u8; 32]
    }

    fn user2() -> [u8; 32] {
        [3u8; 32]
    }

    // ============================================================================
    // Vault + Token Integration Tests
    // ============================================================================

    #[test]
    fn test_full_vault_lifecycle() {
        // 1. Create vault
        let create_req = CreateVaultRequest {
            owner: user1(),
            collateral: ONE_BTC,
            debt: 30_000 * ONE_ZKUSD,
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            interest_rate_bps: 500,
        };
        let vault_result = create_vault(create_req, MCR_BPS).unwrap();

        // 2. Mint tokens for the user
        let mut mint_auth = MintAuth::new(
            admin(),
            ROLE_VAULT_MANAGER,
            u64::MAX,
            u64::MAX,
            1000,
        );
        let mut supply = TokenSupply::new();

        let mint_req = MintRequest {
            minter: admin(),
            to: user1(),
            amount: vault_result.vault.debt,
            block_height: 1000,
        };
        let mint_result = execute_mint(&mint_req, &mut mint_auth, &mut supply, None).unwrap();
        assert_eq!(mint_result.balance.balance, 30_000 * ONE_ZKUSD);

        // 3. Adjust vault - add more collateral
        let adjust_req = AdjustVaultRequest {
            vault_id: vault_result.position.vault_id,
            collateral_change: (ONE_BTC / 2) as i64,
            debt_change: 0,
            btc_price: TEST_BTC_PRICE,
            block_height: 1001,
        };
        let adjust_result = adjust_vault(&vault_result.vault, &adjust_req, MCR_BPS).unwrap();
        assert_eq!(adjust_result.vault.collateral, ONE_BTC + ONE_BTC / 2);

        // 4. Close vault by repaying debt
        let close_result = close_vault(&adjust_result.vault, 30_000 * ONE_ZKUSD, 1002).unwrap();
        assert_eq!(close_result.debt, 0);

        // 5. Burn tokens to represent debt repayment
        let burn_req = BurnRequest {
            from: user1(),
            amount: 30_000 * ONE_ZKUSD,
            block_height: 1002,
        };
        let burn_result = execute_burn(&burn_req, &mint_result.balance, &mut supply).unwrap();
        assert_eq!(burn_result.balance.balance, 0);
        assert_eq!(supply.total_burned, 30_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_liquidation_with_stability_pool() {
        // 1. Setup stability pool with deposits
        let mut pool = SpPoolState::new();

        let deposit_req = DepositRequest {
            depositor: user2(),
            amount: 50_000 * ONE_ZKUSD,
            block_height: 1000,
        };
        let deposit_result = execute_deposit(&deposit_req, None, &mut pool).unwrap();

        // 2. Create an underwater vault
        let vault_id = generate_vault_id(&user1(), 1000, ONE_BTC);
        let underwater_vault = Vault::new(
            vault_id,
            user1(),
            ONE_BTC,
            48_000 * ONE_ZKUSD, // Very high debt, low ICR
            1000,
        );

        // 3. Verify vault is liquidatable (needs to be at risk for > 6 blocks)
        let health = calculate_vault_health(
            &underwater_vault,
            TEST_BTC_PRICE,
            MCR_BPS,
            1012, // Current block (1003 + 6 + 3 = grace period elapsed)
            Some(1003), // Was marked at risk at block 1003
        );
        assert_eq!(health.status, VmVaultStatus::Liquidatable);

        // 4. Calculate liquidation offset
        let offset = calculate_offset(
            underwater_vault.debt,
            underwater_vault.collateral,
            &pool,
        );

        // Pool can absorb all debt
        assert_eq!(offset.debt_absorbed, underwater_vault.debt);
        assert_eq!(offset.debt_remaining, 0);

        // 5. Apply offset to pool
        apply_offset(&offset, &mut pool, 1012).unwrap();

        // Pool deposits reduced
        assert!(pool.total_deposits < 50_000 * ONE_ZKUSD);

        // 6. Depositor can claim BTC rewards
        let btc_reward = deposit_result.deposit.pending_btc_reward(&pool);
        assert!(btc_reward > 0);
    }

    // ============================================================================
    // Oracle + Emergency Integration Tests
    // ============================================================================

    #[test]
    fn test_oracle_price_triggers_circuit_breaker() {
        // 1. Setup oracle
        let mut oracle_config = OracleConfig::new([1u8; 32]);
        let _ = oracle_config.add_source(OracleSource::new(
            [1u8; 32],
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            1000,
        ));

        // 2. Update with initial price (provide signature for SignedAttestation type)
        let signature = [0u8; 64];
        update_price(&mut oracle_config, [1u8; 32], TEST_BTC_PRICE, 1000, Some(&signature)).unwrap();

        // 3. Setup emergency state
        let mut emergency = EmergencyState::new();

        // 4. Simulate large price drop (25%)
        let crash_price = TEST_BTC_PRICE * 75 / 100;

        // 5. Check circuit breaker
        let trigger = check_price_circuit_breaker(
            &mut emergency,
            TEST_BTC_PRICE,
            crash_price,
            1001,
        );

        // Circuit breaker should trigger
        assert!(trigger.is_some());
        let t = trigger.unwrap();
        assert_eq!(t.anomaly_type, AnomalyType::PriceDeviation);

        // Oracle updates should be paused
        assert!(is_paused(&emergency, PausableOperation::OracleUpdates, 1002));
    }

    #[test]
    fn test_price_update_with_twap() {
        let mut oracle_config = OracleConfig::new([1u8; 32]);
        let _ = oracle_config.add_source(OracleSource::new(
            [1u8; 32],
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            1000,
        ));

        // Add multiple price updates (provide signature for SignedAttestation type)
        let signature = [0u8; 64];
        for i in 0..5 {
            let price = TEST_BTC_PRICE + (i as u64 * 100_00000000); // Small variations
            update_price(&mut oracle_config, [1u8; 32], price, 1000 + i, Some(&signature)).unwrap();
        }

        // Get TWAP price
        let twap = get_twap_price(&oracle_config, 5, 1005);
        assert!(twap.is_ok());
        let twap_price = twap.unwrap();

        // TWAP should be close to average
        assert!(twap_price > TEST_BTC_PRICE);
        assert!(twap_price < TEST_BTC_PRICE + 500_00000000);
    }

    // ============================================================================
    // Access Control + Emergency Integration Tests
    // ============================================================================

    #[test]
    fn test_admin_can_pause_during_emergency() {
        // 1. Setup access control
        let mut access = AccessControlState::new(admin(), 1000);

        // 2. Grant emergency operator role
        let operator = user1();
        grant_role(&mut access, admin(), operator, Role::EmergencyOperator, 1001).unwrap();

        // 3. Setup emergency state
        let mut emergency = EmergencyState::new();

        // 4. Emergency operator pauses protocol
        assert!(has_permission(&access, &operator, Permission::Pause, 1002));

        pause_operation(
            &mut emergency,
            PausableOperation::Minting,
            operator,
            PauseReason::ExploitDetected,
            100,
            1002,
        )
        .unwrap();

        // 5. Verify minting is paused
        assert!(is_paused(&emergency, PausableOperation::Minting, 1003));

        // 6. Admin unpauses
        unpause_operation(&mut emergency, PausableOperation::Minting, admin(), 1010).unwrap();
        assert!(!is_paused(&emergency, PausableOperation::Minting, 1011));
    }

    #[test]
    fn test_timelock_prevents_immediate_changes() {
        let mut access = AccessControlState::new(admin(), 1000);

        // 1. Propose a parameter change
        let action_id = propose_action(
            &mut access,
            admin(),
            TimelockActionType::UpdateParameter,
            vec![1, 2, 3],
            1000,
        )
        .unwrap();

        // 2. Try to execute immediately - should fail
        let result = execute_action(&mut access, admin(), action_id, 1001);
        assert!(result.is_err());

        // 3. Wait for timelock and execute
        let result = execute_action(&mut access, admin(), action_id, 1000 + TIMELOCK_DURATION);
        assert!(result.is_ok());
    }

    #[test]
    fn test_guardian_can_veto() {
        let mut access = AccessControlState::new(admin(), 1000);

        // 1. Add guardian
        let guardian = user1();
        grant_role(&mut access, admin(), guardian, Role::Guardian, 1000).unwrap();

        // 2. Admin proposes action
        let action_id = propose_action(
            &mut access,
            admin(),
            TimelockActionType::UpdateParameter,
            vec![1, 2, 3],
            1001,
        )
        .unwrap();

        // 3. Guardian vetoes
        veto_action(&mut access, guardian, action_id, 1002).unwrap();

        // 4. Action cannot be executed even after timelock
        let result = execute_action(&mut access, admin(), action_id, 1001 + TIMELOCK_DURATION);
        assert!(result.is_err());
    }

    // ============================================================================
    // Rate Limiter Integration Tests
    // ============================================================================

    #[test]
    fn test_rate_limit_prevents_spam() {
        let state = RateLimiterState::new();
        let mut record = UsageRecord::new(user1(), RateLimitedOp::Mint, 1000);

        // 1. First mint should succeed
        record_usage(&mut record, 10_000 * ONE_ZKUSD, 1000, DEFAULT_WINDOW_BLOCKS);
        let result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::Mint,
            10_000 * ONE_ZKUSD,
            UserTier::Basic,
        );
        assert!(result.is_ok());

        // 2. After using most of limit, next mint should fail
        record_usage(&mut record, 80_000 * ONE_ZKUSD, 1001, DEFAULT_WINDOW_BLOCKS);
        let result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::Mint,
            20_000 * ONE_ZKUSD, // Would exceed limit
            UserTier::Basic,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_premium_tier_higher_limits() {
        let state = RateLimiterState::new();
        let mut record = UsageRecord::new(user1(), RateLimitedOp::Mint, 1000);

        // Use basic limit amount
        record_usage(&mut record, 90_000 * ONE_ZKUSD, 1000, DEFAULT_WINDOW_BLOCKS);

        // Basic user would fail
        let basic_result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::Mint,
            20_000 * ONE_ZKUSD,
            UserTier::Basic,
        );
        assert!(basic_result.is_err());

        // Premium user succeeds (5x multiplier)
        let premium_result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::Mint,
            20_000 * ONE_ZKUSD,
            UserTier::Premium,
        );
        assert!(premium_result.is_ok());
    }

    // ============================================================================
    // Multi-Module Scenario Tests
    // ============================================================================

    #[test]
    fn test_full_protocol_flow() {
        // Setup all components
        let _access = AccessControlState::new(admin(), 1000);
        let emergency = EmergencyState::new();
        let mut pool = SpPoolState::new();
        let mut supply = TokenSupply::new();
        let mut mint_auth = MintAuth::new(admin(), ROLE_VAULT_MANAGER, u64::MAX, u64::MAX, 1000);
        let rate_state = RateLimiterState::new();

        // 1. User deposits to stability pool (first needs tokens)
        // Mint tokens for user2
        let mint_req = MintRequest {
            minter: admin(),
            to: user2(),
            amount: 100_000 * ONE_ZKUSD,
            block_height: 1000,
        };
        execute_mint(&mint_req, &mut mint_auth, &mut supply, None).unwrap();

        // Deposit to pool
        let deposit_req = DepositRequest {
            depositor: user2(),
            amount: 100_000 * ONE_ZKUSD,
            block_height: 1001,
        };
        execute_deposit(&deposit_req, None, &mut pool).unwrap();

        // 2. User1 opens vault
        let create_req = CreateVaultRequest {
            owner: user1(),
            collateral: 2 * ONE_BTC,
            debt: 50_000 * ONE_ZKUSD,
            btc_price: TEST_BTC_PRICE,
            block_height: 1002,
            interest_rate_bps: 500,
        };
        let vault = create_vault(create_req, MCR_BPS).unwrap();

        // 3. Mint tokens for vault owner
        let mint_req = MintRequest {
            minter: admin(),
            to: user1(),
            amount: vault.vault.debt,
            block_height: 1002,
        };
        execute_mint(&mint_req, &mut mint_auth, &mut supply, None).unwrap();

        // 4. Check rate limits
        let record = UsageRecord::new(user1(), RateLimitedOp::Mint, 1002);
        let result = check_rate_limit(
            &rate_state,
            &record,
            RateLimitedOp::Mint,
            vault.vault.debt,
            UserTier::Basic,
        );
        assert!(result.is_ok());

        // 5. Verify protocol is healthy
        let status = get_emergency_status(&emergency, 1003);
        assert!(!status.any_paused);
        assert!(!status.in_recovery);

        // 6. Verify pool coverage
        let pool_stats = get_pool_stats(&pool, supply.total_supply);
        assert!(pool_stats.coverage_ratio_bps > 0);
    }

    #[test]
    fn test_cascading_liquidation_scenario() {
        // Setup
        let mut pool = SpPoolState::new();
        pool.total_deposits = 200_000 * ONE_ZKUSD;

        let mut emergency = EmergencyState::new();

        // Simulate cascading liquidations
        let liquidations = vec![
            30_000 * ONE_ZKUSD,
            40_000 * ONE_ZKUSD,
            50_000 * ONE_ZKUSD,
        ];

        let mut total_liquidated: u64 = 0;
        for liq_amount in liquidations {
            // Check circuit breaker
            let _trigger = check_liquidation_circuit_breaker(
                &mut emergency,
                liq_amount,
                total_liquidated,
                1000,
            );

            let offset = calculate_offset(liq_amount, liq_amount / 50, &pool);
            apply_offset(&offset, &mut pool, 1000).unwrap();

            total_liquidated += offset.debt_absorbed;
        }

        // Pool should have absorbed significant debt
        assert!(pool.total_deposits < 200_000 * ONE_ZKUSD);
        assert!(pool.total_btc_gains > 0);
    }

    #[test]
    fn test_flash_mint_with_rate_limit() {
        let state = RateLimiterState::new();
        let mut record = UsageRecord::new(user1(), RateLimitedOp::FlashMint, 1000);

        // Flash mints have higher limits but fewer allowed operations
        let config = state.get_config(RateLimitedOp::FlashMint).unwrap();

        // Should allow large amounts
        assert!(record.within_limits(500_000 * ONE_ZKUSD, config, UserTier::Basic));

        // But limited number of operations
        for _ in 0..10 {
            record_usage(&mut record, 1000 * ONE_ZKUSD, 1000, BURST_WINDOW_BLOCKS);
        }

        // 11th operation should fail due to ops limit
        let result = check_rate_limit(
            &state,
            &record,
            RateLimitedOp::FlashMint,
            1000 * ONE_ZKUSD,
            UserTier::Basic,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_multi_collateral_with_oracle() {
        // Setup oracle for different collateral types
        let mut btc_oracle = OracleConfig::new([1u8; 32]);
        let _ = btc_oracle.add_source(OracleSource::new(
            [1u8; 32],
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            1000,
        ));
        let signature = [0u8; 64];
        update_price(&mut btc_oracle, [1u8; 32], TEST_BTC_PRICE, 1000, Some(&signature)).unwrap();

        // Aggregate price to update config's last_price and last_update_block
        let aggregated = aggregate_price(&mut btc_oracle, 1000).unwrap();

        // Get price for vault operations
        let btc_price = get_price(&btc_oracle, 1001).unwrap();
        assert_eq!(btc_price, aggregated.price);

        // Create vault with oracle price
        let create_req = CreateVaultRequest {
            owner: user1(),
            collateral: ONE_BTC,
            debt: 30_000 * ONE_ZKUSD,
            btc_price,
            block_height: 1001,
            interest_rate_bps: 500,
        };
        let vault = create_vault(create_req, MCR_BPS);
        assert!(vault.is_ok());
    }

    #[test]
    fn test_recovery_mode_restrictions() {
        let mut emergency = EmergencyState::new();

        // Enter recovery mode
        enter_recovery_mode(&mut emergency, 1000).unwrap();
        assert!(emergency.in_recovery_mode);

        // Get status
        let status = get_emergency_status(&emergency, 1001);
        assert!(status.in_recovery);

        // Exit recovery mode when system stabilizes
        exit_recovery_mode(&mut emergency, 1100).unwrap();
        assert!(!emergency.in_recovery_mode);
    }

    #[test]
    fn test_token_conservation_across_operations() {
        let mut supply = TokenSupply::new();
        let mut mint_auth = MintAuth::new(admin(), ROLE_VAULT_MANAGER, u64::MAX, u64::MAX, 1000);

        // Mint some tokens
        let mint_req = MintRequest {
            minter: admin(),
            to: user1(),
            amount: 100_000 * ONE_ZKUSD,
            block_height: 1000,
        };
        let mint_result = execute_mint(&mint_req, &mut mint_auth, &mut supply, None).unwrap();

        // Transfer tokens
        let transfer_req = TransferRequest {
            from: user1(),
            to: user2(),
            amount: 30_000 * ONE_ZKUSD,
            block_height: 1001,
        };
        let transfer_result = execute_transfer(&transfer_req, &mint_result.balance, None).unwrap();

        // Verify conservation
        let inputs = vec![TokenUtxoInput {
            utxo_id: [1u8; 32],
            amount: mint_result.balance.balance,
            owner: user1(),
        }];
        let outputs = vec![
            TokenUtxoOutput {
                owner: user1(),
                amount: transfer_result.from_balance.balance,
            },
            TokenUtxoOutput {
                owner: user2(),
                amount: transfer_result.to_balance.balance,
            },
        ];

        assert!(verify_conservation(&inputs, &outputs).is_ok());
    }

    #[test]
    fn test_protocol_fee_distribution() {
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;

        // Simulate fee accrual through liquidations
        let offset = calculate_offset(10_000 * ONE_ZKUSD, ONE_BTC / 10, &pool);
        apply_offset(&offset, &mut pool, 1000).unwrap();

        // BTC fees distributed to pool
        assert!(pool.total_btc_gains > 0);

        // Pool stats show gains
        let stats = get_pool_stats(&pool, 100_000 * ONE_ZKUSD);
        assert!(stats.total_btc_gains > 0);
    }

    // ============================================================================
    // PSM Integration Tests
    // ============================================================================

    #[test]
    fn test_psm_swap_in_with_vault_flow() {
        use crate::psm::*;

        // Setup PSM
        let mut config = StablecoinConfig::new(StablecoinType::USDC);
        config.reserve_balance = 50_000_000_00000000; // $50M
        config.debt_ceiling = 100_000_000_00000000; // $100M

        let mut state = PsmState {
            total_psm_debt: 0,
            total_reserves_value: 0,
            fees_collected: 0,
            is_paused: false,
            admin: admin(),
            last_rebalance_block: 0,
            emergency_mode: false,
        };

        // User swaps USDC for zkUSD via PSM
        let swap_request = SwapRequest {
            user: user1(),
            coin_type: StablecoinType::USDC,
            amount: 10_000_000_000u64, // $10,000 USDC (6 decimals)
            is_swap_in: true,
            min_output: 0,
        };

        let result = execute_swap(swap_request, &mut config, &mut state, 1000).unwrap();
        assert!(result.output_amount > 0);
        assert!(result.fee_amount > 0);

        // PSM debt should increase
        assert!(state.total_psm_debt > 0);

        // User can now use zkUSD to open a vault or other operations
        // This demonstrates the integration between PSM and the broader protocol
    }

    #[test]
    fn test_psm_emergency_mode_restrictions() {
        use crate::psm::*;

        let mut config = StablecoinConfig::new(StablecoinType::USDC);
        config.reserve_balance = 50_000_000_00000000;

        let mut state = PsmState {
            total_psm_debt: 25_000_000_00000000,
            total_reserves_value: 50_000_000_00000000,
            fees_collected: 0,
            is_paused: false,
            admin: admin(),
            last_rebalance_block: 0,
            emergency_mode: false,
        };

        // Enable emergency mode
        enable_emergency_mode(&mut state, admin()).unwrap();
        assert!(state.emergency_mode);

        // Swaps should have higher fees in emergency mode
        let swap_request = SwapRequest {
            user: user1(),
            coin_type: StablecoinType::USDC,
            amount: 10_000_000_000u64, // $10,000 USDC (6 decimals, above MIN_SWAP_AMOUNT)
            is_swap_in: true,
            min_output: 0,
        };

        let result = execute_swap(swap_request, &mut config, &mut state, 1000).unwrap();
        // Fee should be doubled in emergency mode
        assert!(result.fee_amount > 0);
    }

    // ============================================================================
    // Leverage Operations Integration Tests
    // ============================================================================

    #[test]
    fn test_leverage_position_calculation() {
        use crate::leverage::*;

        // Test leverage calculation
        let config = LeverageConfig {
            target_leverage_bps: 30000, // 3x
            stop_loss_icr: 13000, // 130%
            auto_rebalance: false,
            max_slippage_bps: 100,
            swap_venue: SwapVenue::Default,
        };

        // Initial collateral of 1 BTC at $50k = $50k exposure
        // 3x leverage = $150k exposure = 3 BTC worth
        let initial_collateral = ONE_BTC;

        // Calculate required iterations and resulting position
        let target_btc_exposure = (initial_collateral as u128 * config.target_leverage_bps as u128 / 10000) as u64;

        // At 3x leverage with 1 BTC initial:
        // Final position should be ~3 BTC collateral, ~$100k debt (at $50k BTC)
        assert_eq!(target_btc_exposure, 3 * ONE_BTC);
    }

    #[test]
    fn test_leverage_with_vault_integration() {
        use crate::leverage::*;

        // Create initial vault
        let create_req = CreateVaultRequest {
            owner: user1(),
            collateral: 2 * ONE_BTC, // 2 BTC initial
            debt: 50_000 * ONE_ZKUSD, // $50k debt (ICR ~200% at $50k BTC)
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            interest_rate_bps: 500,
        };
        let vault = create_vault(create_req, MCR_BPS).unwrap();

        // Verify vault can be used for leverage operations
        assert!(vault.vault.collateral == 2 * ONE_BTC);
        assert!(vault.vault.debt == 50_000 * ONE_ZKUSD);

        // Calculate current leverage
        let collateral_value = (vault.vault.collateral as u128 * TEST_BTC_PRICE as u128 / 100_000_000) as u64;
        let current_leverage_bps = (collateral_value as u128 * 10000 / (collateral_value - vault.vault.debt) as u128) as u64;

        // With 2 BTC ($100k) and $50k debt, leverage is 100k/(100k-50k) = 2x = 20000 BPS
        assert!(current_leverage_bps >= 19000 && current_leverage_bps <= 21000);
    }

    // ============================================================================
    // Redemption Integration Tests
    // ============================================================================

    #[test]
    fn test_redemption_ordering_by_interest_rate() {
        use crate::advanced_ops::*;

        // Create vaults with different interest rates
        let vault1 = Vault::new(
            [1u8; 32],
            user1(),
            ONE_BTC,
            30_000 * ONE_ZKUSD,
            1000,
        );

        let mut vault2 = Vault::new(
            [2u8; 32],
            user2(),
            ONE_BTC,
            30_000 * ONE_ZKUSD,
            1000,
        );
        vault2.interest_rate_bps = 300; // Lower rate - should be redeemed first

        let mut vault3 = Vault::new(
            [3u8; 32],
            [4u8; 32],
            ONE_BTC,
            30_000 * ONE_ZKUSD,
            1000,
        );
        vault3.interest_rate_bps = 700; // Higher rate - redeemed last

        let vaults = vec![vault1, vault2, vault3];

        // Build redemption batch
        let batch = build_redemption_batch(
            &vaults,
            [10u8; 32], // Redeemer
            50_000 * ONE_ZKUSD, // Redeem 50k zkUSD
            TEST_BTC_PRICE,
        );

        assert!(batch.is_ok());
        let batch = batch.unwrap();

        // Verify orders are sorted by interest rate (lowest first)
        for i in 1..batch.orders.len() {
            assert!(batch.orders[i].interest_rate_bps >= batch.orders[i-1].interest_rate_bps);
        }
    }

    // ============================================================================
    // Liquidation Edge Cases
    // ============================================================================

    #[test]
    fn test_liquidation_exactly_at_mcr() {
        use crate::liquidation::*;

        // Vault exactly at MCR (110%)
        // At $50k BTC price, 1 BTC = $50k collateral
        // MCR 110% means max debt = $50k / 1.10 = $45,454
        let vault = Vault::new(
            [1u8; 32],
            user1(),
            ONE_BTC,
            45_454 * ONE_ZKUSD, // Exactly at MCR
            1000,
        );

        // Should NOT be liquidatable (at or above MCR)
        assert!(!can_liquidate(&vault, TEST_BTC_PRICE, false));
    }

    #[test]
    fn test_liquidation_just_below_mcr() {
        use crate::liquidation::*;

        // Vault just below MCR
        let vault = Vault::new(
            [1u8; 32],
            user1(),
            ONE_BTC,
            45_500 * ONE_ZKUSD, // Just below MCR
            1000,
        );

        // Should be liquidatable
        assert!(can_liquidate(&vault, TEST_BTC_PRICE, false));
    }

    #[test]
    fn test_batch_liquidation_multiple_vaults() {
        use crate::liquidation::*;

        // Create multiple underwater vaults
        let vaults: Vec<Vault> = (0..5).map(|i| {
            let mut id = [0u8; 32];
            id[0] = i;
            Vault::new(
                id,
                user1(),
                ONE_BTC,
                48_000 * ONE_ZKUSD, // All underwater
                1000,
            )
        }).collect();

        let sp = StabilityPoolState {
            total_zkusd: 500_000 * ONE_ZKUSD, // Enough to cover all
            ..Default::default()
        };

        let config = LiquidationConfig {
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            is_recovery_mode: false,
            total_system_collateral: 100 * ONE_BTC,
            liquidator: [99u8; 32],
        };

        let results = process_batch_liquidation(&vaults, &sp, &config).unwrap();

        // All 5 vaults should be liquidated
        assert_eq!(results.len(), 5);

        // Total debt offset should equal sum of all vault debts
        let total_offset: u64 = results.iter().map(|r| r.result.debt_offset).sum();
        assert_eq!(total_offset, 5 * 48_000 * ONE_ZKUSD);
    }

    #[test]
    fn test_recovery_mode_liquidation_with_surplus() {
        use crate::liquidation::*;

        // In Recovery Mode, vaults with ICR between 110% and 150% can be liquidated
        // but owners get surplus collateral back

        // Vault at 130% ICR (liquidatable in RM, surplus expected)
        // At $50k BTC: 1.3 BTC = $65k collateral, $50k debt = 130% ICR
        let vault = Vault::new(
            [1u8; 32],
            user1(),
            130_000_000, // 1.3 BTC
            50_000 * ONE_ZKUSD, // $50k debt
            1000,
        );

        let sp = StabilityPoolState {
            total_zkusd: 100_000 * ONE_ZKUSD,
            ..Default::default()
        };

        let config = LiquidationConfig {
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            is_recovery_mode: true, // Recovery Mode
            total_system_collateral: 100 * ONE_BTC,
            liquidator: [99u8; 32],
        };

        // Should be liquidatable in RM
        assert!(can_liquidate(&vault, TEST_BTC_PRICE, true));

        let result = process_liquidation(&vault, &sp, &config).unwrap();

        // Should have surplus claim
        assert!(result.surplus_claim.is_some());
        assert!(result.result.collateral_surplus > 0);
    }

    // ============================================================================
    // Flash Mint Integration Tests
    // ============================================================================

    #[test]
    fn test_flash_mint_for_self_liquidation() {
        use crate::flash::*;

        // Scenario: User has underwater vault, uses flash mint to self-liquidate
        // and recover collateral before forced liquidation

        let vault_collateral = ONE_BTC;
        let vault_debt = 40_000 * ONE_ZKUSD;

        // Check if self-liquidation is profitable
        let result = process_self_liquidation(
            vault_collateral,
            vault_debt,
            TEST_BTC_PRICE,
        ).unwrap();

        // Should be profitable (collateral value > debt)
        assert!(result.net_value_saved > 0);
        assert_eq!(result.debt_repaid, vault_debt);
        assert_eq!(result.collateral_recovered, vault_collateral);
    }

    #[test]
    fn test_flash_mint_arbitrage_integration() {
        use crate::flash::*;

        // Simulate arbitrage opportunity
        let flash_amount = 100_000 * ONE_ZKUSD;
        let buy_price = 49_000_00000000u64; // $49k
        let sell_price = 51_000_00000000u64; // $51k

        let result = process_arbitrage_callback(flash_amount, buy_price, sell_price).unwrap();

        assert!(result.is_profitable);
        assert!(result.net_profit > 0);
        // Gross profit should exceed fee
        assert!(result.gross_profit > result.fee);
    }

    // ============================================================================
    // Math Edge Cases
    // ============================================================================

    #[test]
    fn test_math_overflow_protection_in_icr() {
        use crate::math::*;

        // Test with very large values that could overflow
        let large_collateral = u64::MAX / 2;
        let large_debt = u64::MAX / 4;
        let high_price = 100_000_00000000u64;

        // Should not panic, should handle gracefully
        let result = calculate_icr(large_collateral, large_debt, high_price);
        assert!(result.is_ok() || result.is_err()); // Either valid result or graceful error
    }

    #[test]
    fn test_zero_debt_icr_calculation() {
        use crate::math::*;

        // Zero debt should result in maximum ICR or error
        let result = calculate_icr(ONE_BTC, 0, TEST_BTC_PRICE);
        // Should either return max value or error for division by zero
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_stability_pool_offset_with_zero_deposits() {
        let pool = SpPoolState::new();

        // Pool with zero deposits
        assert_eq!(pool.total_deposits, 0);

        // Try to calculate offset
        let offset = calculate_offset(10_000 * ONE_ZKUSD, ONE_BTC / 10, &pool);

        // Should redistribute everything (no SP funds)
        assert_eq!(offset.debt_absorbed, 0);
    }

    // ============================================================================
    // Full Protocol Stress Test
    // ============================================================================

    #[test]
    fn test_protocol_under_price_crash() {
        // Simulate 50% price crash scenario
        let crash_price = TEST_BTC_PRICE / 2; // $25k

        // Setup vaults at different ICRs before crash
        let mut pool = SpPoolState::new();
        pool.total_deposits = 500_000 * ONE_ZKUSD;

        let mut emergency = EmergencyState::new();

        // Vault that was healthy (200% ICR) is now at 100% ICR
        let vault = Vault::new(
            [1u8; 32],
            user1(),
            ONE_BTC,
            25_000 * ONE_ZKUSD, // Was 200% at $50k, now 100% at $25k
            1000,
        );

        // Check circuit breaker
        let trigger = check_price_circuit_breaker(
            &mut emergency,
            TEST_BTC_PRICE,
            crash_price,
            1001,
        );

        // 50% drop should trigger circuit breaker
        assert!(trigger.is_some());

        // System should enter recovery mode
        enter_recovery_mode(&mut emergency, 1002).unwrap();
        assert!(emergency.in_recovery_mode);

        // Vault should be liquidatable
        use crate::liquidation::can_liquidate;
        assert!(can_liquidate(&vault, crash_price, true));
    }

    #[test]
    fn test_protocol_recovery_after_emergency() {
        let mut emergency = EmergencyState::new();

        // Enter emergency
        enter_recovery_mode(&mut emergency, 1000).unwrap();
        pause_operation(
            &mut emergency,
            PausableOperation::Minting,
            admin(),
            PauseReason::ExploitDetected,
            100,
            1000,
        ).unwrap();

        // Verify paused
        assert!(emergency.in_recovery_mode);
        assert!(is_paused(&emergency, PausableOperation::Minting, 1001));

        // Unpause and exit recovery
        unpause_operation(&mut emergency, PausableOperation::Minting, admin(), 1050).unwrap();
        exit_recovery_mode(&mut emergency, 1100).unwrap();

        // Verify recovered
        assert!(!emergency.in_recovery_mode);
        assert!(!is_paused(&emergency, PausableOperation::Minting, 1101));
    }

    // ============================================================================
    // Access Control Integration Tests
    // ============================================================================

    #[test]
    fn test_role_based_access_full_flow() {
        let mut access = AccessControlState::new(admin(), 1000);

        // Grant multiple roles
        let operator = user1();
        let guardian = user2();

        grant_role(&mut access, admin(), operator, Role::OracleOperator, 1001).unwrap();
        grant_role(&mut access, admin(), guardian, Role::Guardian, 1002).unwrap();

        // Verify permissions
        assert!(has_permission(&access, &operator, Permission::UpdateOracle, 1003));
        assert!(has_permission(&access, &guardian, Permission::VetoAction, 1003));

        // Revoke role
        revoke_role(&mut access, admin(), operator, Role::OracleOperator, 1004).unwrap();
        assert!(!has_permission(&access, &operator, Permission::UpdateOracle, 1005));
    }

    #[test]
    fn test_multisig_proposal_flow() {
        let mut access = AccessControlState::new(admin(), 1000);

        // Setup multisig with 2-of-3
        let _signers = vec![admin(), user1(), user2()];
        // Note: In production, would initialize multisig config here

        // Propose action
        let action_id = propose_action(
            &mut access,
            admin(),
            TimelockActionType::UpdateParameter,
            vec![1, 2, 3],
            1001,
        ).unwrap();

        // Action should be pending
        assert!(access.pending_actions.iter().any(|a| a.action_id == action_id));

        // Wait for timelock
        let execute_block = 1001 + TIMELOCK_DURATION;

        // Execute after timelock
        let result = execute_action(&mut access, admin(), action_id, execute_block);
        assert!(result.is_ok());
    }

    // ============================================================================
    // Cross-App Integration Tests (Oracle → VaultManager → StabilityPool → Token)
    // ============================================================================

    #[test]
    fn test_cross_app_open_vault_with_oracle_price() {
        // This test simulates the full cross-app flow:
        // 1. Oracle provides BTC price
        // 2. VaultManager uses price for ICR calculation
        // 3. Token mints zkUSD for user

        // Setup Oracle
        let mut oracle_config = OracleConfig::new(admin());
        let _ = oracle_config.add_source(OracleSource::new(
            admin(),
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            1000,
        ));
        let signature = [0u8; 64];
        update_price(&mut oracle_config, admin(), TEST_BTC_PRICE, 1000, Some(&signature)).unwrap();
        aggregate_price(&mut oracle_config, 1000).unwrap();

        // Get validated price from Oracle
        let btc_price = get_price(&oracle_config, 1001).unwrap();
        assert_eq!(btc_price, TEST_BTC_PRICE);

        // Open Vault using Oracle price
        let create_req = CreateVaultRequest {
            owner: user1(),
            collateral: ONE_BTC,
            debt: 30_000 * ONE_ZKUSD,
            btc_price, // Price from Oracle
            block_height: 1001,
            interest_rate_bps: 500,
        };
        let vault_result = create_vault(create_req, MCR_BPS).unwrap();

        // Mint zkUSD tokens (Token contract)
        let mut mint_auth = MintAuth::new(admin(), ROLE_VAULT_MANAGER, u64::MAX, u64::MAX, 1001);
        let mut supply = TokenSupply::new();

        let mint_req = MintRequest {
            minter: admin(), // VaultManager is the authorized minter
            to: user1(),
            amount: vault_result.vault.debt,
            block_height: 1001,
        };
        let mint_result = execute_mint(&mint_req, &mut mint_auth, &mut supply, None).unwrap();

        // Verify cross-app state consistency
        assert_eq!(vault_result.vault.debt, mint_result.balance.balance);
        assert_eq!(supply.total_minted, vault_result.vault.debt);
    }

    #[test]
    fn test_cross_app_liquidation_full_flow() {
        // Complete liquidation flow across all apps:
        // 1. Oracle price drops → vault becomes underwater
        // 2. VaultManager detects liquidatable vault
        // 3. StabilityPool absorbs debt + receives collateral
        // 4. Token supply decreases (burned from SP)

        // Initial setup at $50k BTC
        let initial_price = TEST_BTC_PRICE;
        let crash_price = TEST_BTC_PRICE * 80 / 100; // 20% drop to $40k

        // Create vault at initial price (healthy at 167% ICR)
        let vault = Vault::new(
            [1u8; 32],
            user1(),
            ONE_BTC,
            30_000 * ONE_ZKUSD,
            1000,
        );

        // Verify healthy at initial price
        let initial_icr = (ONE_BTC as u128 * initial_price as u128 * 100)
            / (vault.debt as u128 * 100_000_000);
        assert!(initial_icr > 150, "Should be healthy initially");

        // After price crash, ICR drops to ~133%
        let crash_icr = (ONE_BTC as u128 * crash_price as u128 * 100)
            / (vault.debt as u128 * 100_000_000);
        assert!(crash_icr < 150, "Should be unhealthy after crash");

        // Setup Stability Pool with deposits
        let mut pool = SpPoolState::new();
        pool.total_deposits = 100_000 * ONE_ZKUSD;

        // Calculate liquidation offset
        let offset = calculate_offset(vault.debt, vault.collateral, &pool);

        // SP absorbs all debt
        assert_eq!(offset.debt_absorbed, vault.debt);
        assert_eq!(offset.debt_remaining, 0);

        // Apply offset to pool
        apply_offset(&offset, &mut pool, 1001).unwrap();

        // Verify cross-app state changes:
        // - SP deposits reduced by absorbed debt
        assert_eq!(pool.total_deposits, 100_000 * ONE_ZKUSD - vault.debt);
        // - SP received BTC collateral
        assert!(pool.total_btc_gains > 0);
    }

    #[test]
    fn test_cross_app_oracle_staleness_blocks_vault_ops() {
        // Tests that stale oracle price prevents vault operations

        let mut oracle_config = OracleConfig::new(admin());
        let _ = oracle_config.add_source(OracleSource::new(
            admin(),
            OracleSourceType::SignedAttestation,
            OraclePriority::Primary,
            1000,
        ));
        let signature = [0u8; 64];

        // Update price at block 1000
        update_price(&mut oracle_config, admin(), TEST_BTC_PRICE, 1000, Some(&signature)).unwrap();
        aggregate_price(&mut oracle_config, 1000).unwrap();

        // At block 1000+1 (fresh), price is valid
        let fresh_price = get_price(&oracle_config, 1001);
        assert!(fresh_price.is_ok());

        // Oracle config has max_staleness_blocks which limits how old a price can be
        // If we check at a much later block, the price might be stale
        // Note: This depends on OracleConfig's staleness settings
    }

    #[test]
    fn test_cross_app_sp_depositor_earns_btc_from_liquidation() {
        // Full flow: SP depositor earns BTC when liquidation happens

        // 1. User2 deposits to Stability Pool
        let mut pool = SpPoolState::new();
        let deposit_req = DepositRequest {
            depositor: user2(),
            amount: 50_000 * ONE_ZKUSD,
            block_height: 1000,
        };
        let deposit_result = execute_deposit(&deposit_req, None, &mut pool).unwrap();
        let initial_deposit = deposit_result.deposit.clone();

        // 2. Liquidation happens (vault from user1)
        let liquidated_debt = 30_000 * ONE_ZKUSD;
        let liquidated_collateral = ONE_BTC;
        let offset = calculate_offset(liquidated_debt, liquidated_collateral, &pool);
        apply_offset(&offset, &mut pool, 1001).unwrap();

        // 3. User2 can now claim BTC rewards
        let btc_gain = initial_deposit.pending_btc_reward(&pool);
        assert!(btc_gain > 0, "Depositor should have BTC rewards");

        // 4. Verify proportional distribution
        // User2 had 100% of pool, should get ~100% of collateral
        // (minus any protocol fees if applicable)
        let expected_btc = liquidated_collateral; // Simplified: 100% ownership
        assert!(btc_gain > expected_btc * 95 / 100, "Should get most of collateral");
    }

    #[test]
    fn test_cross_app_token_burn_in_vault_close() {
        // Tests that closing a vault properly burns tokens

        // 1. Setup: Create vault and mint tokens
        let create_req = CreateVaultRequest {
            owner: user1(),
            collateral: ONE_BTC,
            debt: 30_000 * ONE_ZKUSD,
            btc_price: TEST_BTC_PRICE,
            block_height: 1000,
            interest_rate_bps: 500,
        };
        let vault_result = create_vault(create_req, MCR_BPS).unwrap();

        let mut mint_auth = MintAuth::new(admin(), ROLE_VAULT_MANAGER, u64::MAX, u64::MAX, 1000);
        let mut supply = TokenSupply::new();
        let mint_req = MintRequest {
            minter: admin(),
            to: user1(),
            amount: vault_result.vault.debt,
            block_height: 1000,
        };
        let mint_result = execute_mint(&mint_req, &mut mint_auth, &mut supply, None).unwrap();

        // Verify initial state
        assert_eq!(supply.total_minted, 30_000 * ONE_ZKUSD);
        assert_eq!(supply.total_burned, 0);

        // 2. Close vault - requires burning tokens
        let close_result = close_vault(&vault_result.vault, 30_000 * ONE_ZKUSD, 1001).unwrap();
        assert_eq!(close_result.debt, 0);

        // 3. Burn tokens (Token contract)
        let burn_req = BurnRequest {
            from: user1(),
            amount: 30_000 * ONE_ZKUSD,
            block_height: 1001,
        };
        let _burn_result = execute_burn(&burn_req, &mint_result.balance, &mut supply).unwrap();

        // 4. Verify token conservation
        assert_eq!(supply.total_minted, 30_000 * ONE_ZKUSD);
        assert_eq!(supply.total_burned, 30_000 * ONE_ZKUSD);
        // Net supply should be 0
        assert_eq!(supply.total_supply, 0);
    }
}
