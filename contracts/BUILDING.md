# Building zkUSD Contracts for Charms

## IMPORTANT: Use the Correct WASM Target

Charms requires WASM compiled with `wasm32-wasip1` target, **NOT** `wasm32-unknown-unknown`.

### Correct Way to Build (Use This)

```bash
# Use the charms CLI to build - it automatically uses the correct target
cd contracts/stability-pool
charms app build

# Or build all contracts
for dir in zkusd-token stability-pool vault-manager price-oracle; do
  (cd contracts/$dir && charms app build)
done
```

The output will be in `./target/wasm32-wasip1/release/<contract-name>.wasm`

### WRONG Way (Do NOT Use)

```bash
# This will NOT work with Charms prover!
cargo build --release --target wasm32-unknown-unknown --features charms
```

Using `wasm32-unknown-unknown` will result in errors like:
- `internal error: entered unreachable code: we should have a main function`
- HTTP 502 errors from the prover

## Verification

After building, verify the VK matches expected values:

```bash
charms app vk target/wasm32-wasip1/release/zkusd-stability-pool-app.wasm
```

Expected VKs (as of Jan 2026):
- Token: `ff936fc6c59a5997e4d429bd806c834bbb8d05fc5ea425997539bec1f79ec128`
- Stability Pool: `98ef9f08108227ab28aab842a9370cb0ec0e289b8dba21a319ec106927ea08e9`
- Vault Manager V5: `8b3834c2f233d1abc6b1473833f4addd113873e21624a6ddf419406c09e1fa42`
- Price Oracle: `98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d`

## Vault Manager Version History
- V3 (deployed): `833e8d5ec3f31d6cd0a9346d08d12916abd52c3c12ff8eb9f14ebeb265b3085f`
- V4 (btc_inputs fix): `3b981bfd64228b2020484d271b0a15c03dec9717c9f0edde3a44155296b303b0`
- V5 (current): `8b3834c2f233d1abc6b1473833f4addd113873e21624a6ddf419406c09e1fa42`
  - btc_inputs check fix for Charms v8
  - validate_close_vault Charms v8 compatibility
  - Liquidation safe_sub to prevent underflow

## Copy to Web App

After building, copy the WASM files to the web app:

```bash
cp target/wasm32-wasip1/release/zkusd-*-app.wasm apps/web/public/wasm/
```
