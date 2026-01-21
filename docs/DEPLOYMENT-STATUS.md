# zkUSD Deployment Status

Last Updated: 2026-01-21

## Current Status

### Contracts Ready for Deployment

All WASM contracts have been recompiled with improvements and their spells validated in mock mode:

| Contract | Current VK | Deployed VK | Status |
|----------|-----------|-------------|--------|
| Price Oracle | `98b2eeeb...c73d` | `98b2eeeb...c73d` | MATCHES |
| zkUSD Token | `ff936fc6...c128` | `e056dfec...75fe` | NEEDS REDEPLOY |
| Vault Manager | `833e8d5e...085f` | `d535fdc3...63bf` | NEEDS REDEPLOY |
| Stability Pool | `98ef9f08...08e9` | `ace28945...1752` | NEEDS REDEPLOY |

### Prover Status

The Charms v8 prover at `https://v8.charms.dev/spells/prove` is currently returning "unexecutable" errors for all proof requests. This affects both new contracts AND existing ones with matching VKs.

**Mock mode validation passes** for all contracts, confirming our spell structures and WASM validation logic are correct.

## What Has Been Completed

1. **Code Improvements**
   - Feature flags for mainnet/testnet in Rust constants
   - Changed `assert!()` to `Result` returns for better error handling
   - Multi-network configuration system (`packages/config`)
   - Multi-prover fallback in SDK
   - SDK error handling system (`packages/sdk/src/errors.ts`)

2. **WASM Compilation**
   - All contracts recompiled with `cargo build --target wasm32-wasip1 --release --features charms`
   - WASM files copied to `apps/web/public/wasm/`
   - VKs verified with `charms app vk`

3. **Deployment Scripts**
   - `scripts/deploy-contracts.ts` - Full deployment script with correct spell structures
   - `scripts/lib/bitcoin-signer.ts` - Bitcoin transaction signing utility
   - Spells validated in mock mode

4. **Demo Mode**
   - Enabled in `.env.local` for UI testing
   - `NEXT_PUBLIC_DEMO_MODE=true`

## Deployment Process (When Prover Available)

1. Run deployment script:
   ```bash
   npx tsx scripts/deploy-contracts.ts
   ```

2. Or use CLI directly:
   ```bash
   cat spell.json | charms spell prove \
     --prev-txs="..." \
     --app-bins="path/to/app.wasm" \
     --funding-utxo="txid:vout" \
     --funding-utxo-value=100000 \
     --change-address="tb1q..." \
     --fee-rate=5.0
   ```

3. Sign and broadcast the returned transactions

4. Update `packages/config/src/testnet4.ts` with new App IDs

5. Disable demo mode: `NEXT_PUBLIC_DEMO_MODE=false`

## Verified Spell Structures

All spells pass validation in mock mode:

### Token
```json
{
  "private_inputs": {
    "$TOKEN": {
      "op": 0,
      "authorized_minter": [/* 32-byte VM App ID */]
    }
  }
}
```

### Stability Pool
```json
{
  "private_inputs": {
    "$SP": {
      "op": 0,
      "zkusd_token_id": [/* 32 bytes */],
      "vault_manager_id": [/* 32 bytes */],
      "admin": [/* 32 bytes */]
    }
  }
}
```

### Vault Manager
```json
{
  "private_inputs": {
    "$VM": {
      "op": 0,
      "admin": [/* 32 bytes */],
      "zkusd_token_id": [/* 32 bytes */],
      "stability_pool_id": [/* 32 bytes */],
      "price_oracle_id": [/* 32 bytes */],
      "active_pool": [/* 32 bytes */],
      "default_pool": [/* 32 bytes */]
    }
  }
}
```

## Next Steps

1. Monitor Charms prover status
2. When prover is available, run deployment
3. Update configuration with new App IDs
4. Disable demo mode
5. Full end-to-end testing
