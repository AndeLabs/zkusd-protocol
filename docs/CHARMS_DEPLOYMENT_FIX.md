# Charms Spell Deployment: UTXO Conflict Fix

## Problem
When running `charms spell prove`, the generated commit_tx and spell_tx both tried to spend the same UTXO, causing `submitpackage` to reject with "conflict-in-package" error.

## Root Cause
The spell YAML file had the funding UTXO in the `ins:` field, AND the same UTXO was passed via `--funding-utxo` CLI parameter.

This caused:
- **commit_tx** to spend the funding UTXO (from `--funding-utxo`)
- **spell_tx** to ALSO spend the same UTXO (from `ins:` in YAML)

## Solution
Use **TWO DIFFERENT UTXOs**:
1. `ins:` in YAML → UTXO that will be "enchanted" (receives the charm output)
2. `--funding-utxo` → SEPARATE UTXO to pay for commit/reveal transaction fees

## Example

### Incorrect (causes conflict):
```yaml
# spell.yaml
ins:
  - utxo_id: abc123:0  # Same UTXO!
    charms: {}
```
```bash
charms spell prove --funding-utxo "abc123:0" ...  # Same UTXO!
```

### Correct (uses separate UTXOs):
```yaml
# spell.yaml
ins:
  - utxo_id: d879b31e32d91fee25c699fbb16c3b45beaed80f7fadb37c1a7e441e4c925014:0
    charms: {}
```
```bash
charms spell prove \
  --funding-utxo "6647d620194e9c189aef85bda6214630b2077c091d0729b599de6abd94771e75:1" \
  ...
```

## Deployment Commands Used

```bash
# 1. Build the app with charms
cd contracts/price-oracle && charms app build

# 2. Get VK and app_id
charms app vk target/wasm32-wasip1/release/zkusd-price-oracle-app.wasm

# 3. Get raw transactions for prev-txs
bitcoin-cli -testnet4 getrawtransaction <txid_of_ins_utxo>
bitcoin-cli -testnet4 getrawtransaction <txid_of_funding_utxo>

# 4. Run prove with SEPARATE UTXOs
charms spell prove \
  --spell spells/deploy-oracle-v2.yaml \
  --prev-txs "<raw_tx_1>,<raw_tx_2>" \
  --app-bins target/wasm32-wasip1/release/zkusd-price-oracle-app.wasm \
  --funding-utxo "<DIFFERENT_UTXO_from_ins>" \
  --funding-utxo-value <value_in_sats> \
  --change-address "<your_address>" \
  --fee-rate 10.0 \
  --mock

# 5. Sign both transactions
bitcoin-cli -testnet4 signrawtransactionwithwallet "<commit_tx_hex>"
bitcoin-cli -testnet4 signrawtransactionwithwallet "<spell_tx_hex>"

# 6. Submit as package (enables CPFP)
bitcoin-cli -testnet4 submitpackage '["<signed_commit>", "<signed_spell>"]'
```

## Successful Deployment

- **Commit TX:** `bc93a741890d3e8e6350a142f9dea094c340fb9b9e7e334f2752d0950305e00a`
- **Spell TX:** `7668520962053535367e4454d33f70f8069b8490675fd72b40ae3d3707f71ec5`
- **Oracle NFT ID:** `n/b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32/b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32`

## Date
December 14, 2025
