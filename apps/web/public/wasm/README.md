# zkUSD Contract WASM Files

> **Last Updated**: 2026-01-25
> **Charms Version**: 9 (v0.11.1 SDK)

## Current Files

| File | Contract | VK | Status | Notes |
|------|----------|----|----|-------|
| `zkusd-token-app.wasm` | Token | `9d9f07fc...` | **Current Source** | Rebuild before deploy |
| `zkusd-token-app-deployed.wasm` | Token | `ff936fc6...` | Deployed (testnet4) | Out of sync with source |
| `zkusd-vault-manager-app.wasm` | VaultManager | `a2359b5a...` | **Current Source** | Same as deployed |
| `vault-manager-v2-app.wasm` | VaultManager V2 | `a2359b5a...` | Deployed (testnet4) | Same as current |
| `zkusd-stability-pool-app.wasm` | StabilityPool | `54f84ff2...` | Deployed (testnet4) | Verify VK |
| `zkusd-price-oracle-app.wasm` | PriceOracle | `98b2eeeb...` | Deployed (testnet4) | Verify VK |

## Build Instructions

```bash
# From project root
./scripts/deploy/build-all.sh --verify --copy

# Or individual contract
cd contracts/zkusd-token
cargo build --release --target wasm32-wasip1 --features charms --bin zkusd-token-app
```

## Verify VK

```bash
charms app vk <wasm_file>
```

## Important Notes

1. **Always rebuild before deploying** - VK is derived from WASM content
2. **Use `wasm32-wasip1` target** - NOT `wasm32-unknown-unknown`
3. **Requires `--features charms`** for binary builds
4. **VK mismatch = deployment failure** - Ensure VK matches expected
