# zkUSD Protocol Deployment Guide

This guide walks you through deploying the zkUSD protocol to Bitcoin Testnet4.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Building the Contracts](#building-the-contracts)
4. [Deployment to Testnet4](#deployment-to-testnet4)
5. [Protocol Initialization](#protocol-initialization)
6. [Verification](#verification)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

1. **Rust** (1.75 or later)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   rustup update
   ```

2. **Bitcoin Core v28+** (for Testnet4 support)
   - Download from: https://bitcoincore.org/en/download/
   - Testnet4 requires Bitcoin Core v28 or later

3. **Charms CLI**
   ```bash
   cargo install charms-sdk
   ```

4. **WASM target** (for building deployable contracts)
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

5. **wasm-opt** (optional, for optimization)
   ```bash
   cargo install wasm-opt
   # or: npm install -g binaryen
   ```

### Verify Installation

```bash
rustc --version          # Should be 1.75+
bitcoind --version       # Should be v28+
charms --version         # Should be 0.10+
```

---

## Environment Setup

### 1. Clone the Repository

```bash
git clone https://github.com/zkusd/zkusd-protocol
cd zkusd-protocol
```

### 2. Setup Testnet4 Environment

Run the setup script:

```bash
./scripts/setup-testnet4.sh
```

This will:
- Check prerequisites
- Generate `~/.bitcoin/bitcoin.conf` for Testnet4
- Create `.env.testnet4` environment file

### 3. Start Bitcoin Node

```bash
# Start Bitcoin Core in Testnet4 mode
bitcoind -testnet4 -daemon

# Check sync status
bitcoin-cli -testnet4 getblockchaininfo
```

Wait for the node to sync. Testnet4 is small, so this should take ~15-30 minutes.

### 4. Create Wallet

```bash
# Create wallet
bitcoin-cli -testnet4 createwallet "zkusd"

# Get address for receiving test BTC
bitcoin-cli -testnet4 getnewaddress "" bech32m
```

### 5. Get Test BTC

Use one of these faucets:
- https://mempool.space/testnet4/faucet
- https://faucet.testnet4.dev/
- https://coinfaucet.eu/en/btc-testnet4/

### 6. Load Environment

```bash
source .env.testnet4
```

---

## Building the Contracts

### Standard Build (for testing)

```bash
# Using Make
make build

# Or directly
./scripts/build.sh release
```

### WASM Build (for deployment)

```bash
# Using Make
make build-wasm

# Or directly
./scripts/build-wasm.sh
```

This produces WASM files in `target/wasm/`:
- `zkusd_token.wasm`
- `zkusd_vault_manager.wasm`
- `zkusd_stability_pool.wasm`
- `zkusd_price_oracle.wasm`

### Run Tests

```bash
# All tests
make test

# Verbose output
make test-verbose

# Specific module
cargo test --release -p zkusd-common integration_tests
```

---

## Deployment to Testnet4

### 1. Deploy Contracts

```bash
./scripts/deploy.sh --network testnet4
```

This deploys contracts in order:
1. Price Oracle (no dependencies)
2. zkUSD Token
3. Stability Pool
4. Vault Manager

Each deployment:
- Builds the contract with Charms
- Generates a Verification Key (VK)
- Saves VK to `deployments/testnet4/`

### 2. Verify Deployment

```bash
ls -la deployments/testnet4/
```

You should see:
```
price-oracle.vk
zkusd-token.vk
stability-pool.vk
vault-manager.vk
```

---

## Protocol Initialization

### 1. Initialize Protocol

```bash
./scripts/init-protocol.sh
```

This:
- Sets initial BTC price in oracle
- Configures protocol parameters
- Sets up admin roles
- Generates configuration files

### 2. Review Configuration

```bash
cat deployments/testnet4/protocol-config.json
```

Default parameters:
- **MCR**: 110% (Minimum Collateral Ratio)
- **CCR**: 150% (Critical Collateral Ratio)
- **Min Debt**: 2,000 zkUSD
- **Borrowing Fee**: 0.5%

### 3. Update Admin Addresses

Edit `deployments/testnet4/roles.json` with your actual addresses:

```json
{
    "super_admin": "<your_admin_pubkey>",
    "oracle_operator": "<oracle_operator_pubkey>",
    "emergency_operator": "<emergency_operator_pubkey>",
    "guardian": null,
    "fee_collector": "<fee_collector_pubkey>"
}
```

---

## Verification

### Check Protocol Status

```bash
./scripts/zkusd-cli.sh status
# or
make status
```

### Verify Contracts on Mempool

Each deployment creates transactions visible on:
- https://mempool.space/testnet4

Search for your transaction IDs or addresses.

### Test Operations

```bash
# Check oracle price
./scripts/zkusd-cli.sh oracle price

# Simulate vault opening
./scripts/zkusd-cli.sh vault open 1.0 30000
```

---

## Troubleshooting

### Bitcoin Node Issues

**Node not syncing:**
```bash
# Check status
bitcoin-cli -testnet4 getblockchaininfo

# Check peers
bitcoin-cli -testnet4 getpeerinfo | grep addr
```

**No peers:**
- Testnet4 is new, may have fewer nodes
- Add seeds manually if needed

### Build Errors

**WASM target missing:**
```bash
rustup target add wasm32-unknown-unknown
```

**Charms SDK version mismatch:**
```bash
cargo update
cargo install charms-sdk --force
```

### Deployment Errors

**Insufficient funds:**
- Get more tBTC from faucets
- Wait for confirmations

**Transaction rejected:**
- Check fee rates on mempool.space
- Increase fee if needed

**"conflict-in-package" error:**
- **CRITICAL**: This happens when the spell's `ins:` UTXO is the SAME as `--funding-utxo`
- You MUST use TWO DIFFERENT UTXOs:
  - `ins:` in YAML → UTXO that receives the charm
  - `--funding-utxo` → SEPARATE UTXO to pay fees
- See: `docs/CHARMS_DEPLOYMENT_FIX.md` for full explanation
- Use the deployment helper script: `./scripts/deploy-spell.sh`

### Common Error Messages

| Error | Solution |
|-------|----------|
| `ProtocolPaused` | Protocol is paused, check emergency status |
| `BelowMinimum` | Amount below minimum (e.g., 2000 zkUSD) |
| `InsufficientCollateral` | Need more BTC collateral for ICR |
| `OracleStale` | Oracle price too old, update needed |
| `conflict-in-package` | Use DIFFERENT UTXOs for `ins:` and `--funding-utxo` |
| `bad-txns-spends-conflicting-tx` | Same as above - UTXOs must be different |

---

## Network Reference

### Testnet4 Details

| Property | Value |
|----------|-------|
| Network Magic | `0x1c163f28` |
| Default Port | `48333` |
| RPC Port | `48332` |
| Address Prefix | `tb1` (bech32) |
| BIP-94 Status | Final |

### Useful Links

- **Mempool Explorer**: https://mempool.space/testnet4
- **Faucet**: https://mempool.space/testnet4/faucet
- **Charms Docs**: https://docs.charms.dev
- **Bitcoin Core**: https://bitcoincore.org

---

## Next Steps

After successful deployment:

1. **Monitor** the protocol using the CLI
2. **Test** vault operations with small amounts
3. **Document** your deployment addresses and VKs
4. **Backup** your admin keys securely

For production deployment (mainnet):
- Full security audit required
- Multi-sig admin setup recommended
- Gradual rollout with limits
- Insurance/emergency fund setup

---

## Support

- GitHub Issues: https://github.com/zkusd/zkusd-protocol/issues
- Documentation: See `/docs` folder
- Charms Discord: https://discord.gg/charms
