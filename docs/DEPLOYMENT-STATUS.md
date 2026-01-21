# zkUSD Deployment Status

Last Updated: 2026-01-21

## Current Status: DEPLOYED

All zkUSD contracts are **live on Bitcoin Testnet4** with V3 deployment.

### Deployed Contracts

| Contract | App ID | VK | Status |
|----------|--------|-----|--------|
| Price Oracle | `26186d7c...e8b5` | `98b2eeeb...c73d` | Confirmed |
| zkUSD Token | `7ff62ba4...cef1` | `ff936fc6...c128` | Confirmed |
| Stability Pool | `00153749...dc6b` | `98ef9f08...08e9` | Confirmed |
| Vault Manager | `ca8ab2dc...1fa9` | `833e8d5e...085f` | Confirmed |

### Transaction IDs

| Contract | Spell TX | Explorer |
|----------|----------|----------|
| Price Oracle | `03e362aa...6cf4` | [View](https://mempool.space/testnet4/tx/03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4) |
| zkUSD Token | `6cef9848...d988` | [View](https://mempool.space/testnet4/tx/6cef9848281616baeeb2d7d0fd77f8504222182ff18637bd1ea69c842957d988) |
| Stability Pool | `20d41c6e...560c` | [View](https://mempool.space/testnet4/tx/20d41c6e5b4df501f6394392a56a534730bc84794da1f8adabe5dc6084ee560c) |
| Vault Manager | `aac009d1...3f02` | [View](https://mempool.space/testnet4/tx/aac009d17665311d94ec0accf48aad8db6a06c54cc383bb8933c28eb92b03f02) |

## Build Requirements

**CRITICAL**: Always use `charms app build` to compile contracts!

```bash
# Correct way (uses wasm32-wasip1 automatically)
cd contracts/stability-pool
charms app build

# NEVER use wasm32-unknown-unknown - causes UnreachableCodeReached error!
```

See `contracts/BUILDING.md` for detailed instructions.

## Configuration Files

| Purpose | Path |
|---------|------|
| Full Deployment Config | `deployments/testnet4/deployment-config.json` |
| SDK Config | `packages/config/src/testnet4.ts` |
| Credentials & Keys | `deployments/testnet4/CREDENTIALS.md` |
| WASM Binaries | `apps/web/public/wasm/` |

## API Endpoints

| Service | URL |
|---------|-----|
| Charms Prover | `https://v8.charms.dev/spells/prove` |
| Mempool Explorer | `https://mempool.space/testnet4` |
| Mempool API | `https://mempool.space/testnet4/api` |

## Web App Configuration

Demo mode is **disabled** - real transactions enabled:

```env
# apps/web/.env.local
NEXT_PUBLIC_DEMO_MODE=false
```
