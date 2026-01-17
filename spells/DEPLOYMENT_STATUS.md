# zkUSD Deployment Status - Bitcoin Testnet4

**Network**: Bitcoin Testnet4
**Charms Version**: 8
**Last Updated**: January 2026
**Status**: V2 Deployed & Confirmed

---

## Estado General

| Contrato | Estado | Bloque | TX |
|----------|--------|--------|-----|
| Price Oracle | Confirmed | 115650 | `03e362aa...` |
| zkUSD Token | Confirmed | 115703 | `458771b3...` |
| Vault Manager | Confirmed | 115703 | `b6de6d2f...` |
| Stability Pool | Confirmed | 113513 | `ea78d29a...` |

---

## Contratos Desplegados (V2)

### 1. Price Oracle
- **App ID**: `26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5`
- **VK**: `98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d`
- **Spell TX**: `03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4`
- **State UTXO**: `03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4:0`
- **Explorer**: https://mempool.space/testnet4/tx/03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4
- **App Reference**: `n/26186d7c27bb28748d1ec89ba1fb60125d8a256dfd9a978296aa59f8c7e9e8b5/98b2eeeb37501c9f6f815913c80935bd46b9328512570ef067c3d02379f4c73d`

### 2. zkUSD Token
- **App ID**: `eb6bae049ef366de081886f4f712be6e3eb991c92729aae4d9fab680a29ad540`
- **VK**: `e056dfec9aea81d33caed5470c51c2f86bb6551aced4c570b66cbdc3594275fe`
- **Spell TX**: `458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423`
- **State UTXO**: `458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423:0`
- **Explorer**: https://mempool.space/testnet4/tx/458771b330d2a61ba52b5567b5e2579366dcd9f9aca2749f00acdc468f03b423
- **App Reference (NFT)**: `n/eb6bae049ef366de081886f4f712be6e3eb991c92729aae4d9fab680a29ad540/e056dfec9aea81d33caed5470c51c2f86bb6551aced4c570b66cbdc3594275fe`
- **App Reference (Fungible)**: `t/eb6bae049ef366de081886f4f712be6e3eb991c92729aae4d9fab680a29ad540/e056dfec9aea81d33caed5470c51c2f86bb6551aced4c570b66cbdc3594275fe`

### 3. Vault Manager
- **App ID**: `c1c47ab32a707f9fad3f57aa09c58020d0c5ce43f24ee5fd0c22be41114cd490`
- **VK**: `d535fdc354e87af6e750bfe957a4a90e467eba1457f37f05c858beaf09e763bf`
- **Spell TX**: `b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3`
- **State UTXO**: `b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3:0`
- **Explorer**: https://mempool.space/testnet4/tx/b6de6d2f414cf2b1182dd8e0640918574a282652d9fcbee3293418575590faa3
- **App Reference**: `n/c1c47ab32a707f9fad3f57aa09c58020d0c5ce43f24ee5fd0c22be41114cd490/d535fdc354e87af6e750bfe957a4a90e467eba1457f37f05c858beaf09e763bf`

### 4. Stability Pool
- **App ID**: `c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf`
- **VK**: `ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752`
- **Spell TX**: `ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c`
- **State UTXO**: `ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c:0`
- **Explorer**: https://mempool.space/testnet4/tx/ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c
- **App Reference**: `n/c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf/ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752`

---

## Cross-Contract References

Los contratos se referencian entre sí usando App IDs:

```
Token.authorized_minter = VaultManager.AppID (c1c47ab3...)
VaultManager.zkusd_token_id = Token.AppID (eb6bae04...)
VaultManager.stability_pool_id = StabilityPool.AppID (c11c5451...)
VaultManager.oracle_id = Oracle.AppID (26186d7c...)
```

---

## Protocol Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| MCR | 110% | Minimum Collateral Ratio |
| CCR | 150% | Critical Collateral Ratio |
| Min Debt | 10 zkUSD | Minimum debt per vault |
| Gas Compensation | 2 zkUSD | Liquidator compensation |
| Liquidation Bonus | 0.5% | Bonus on collateral |
| Redemption Fee Floor | 0.5% | Minimum redemption fee |

---

## Addresses

- **Admin**: `d54fa831ac19574c5503f1cbd505934a0bab3cee`
- **Output Address**: `tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq`

---

## Configuration Files

- **Full Config**: `deployments/testnet4/deployment-config.json`
- **SDK Config**: `packages/config/src/testnet4.ts`

---

## Verify Transactions

```bash
# Check any transaction status
curl -s "https://mempool.space/testnet4/api/tx/<txid>/status"

# Example: Check Oracle
curl -s "https://mempool.space/testnet4/api/tx/03e362aacd811cbe8cd33a8f6a70d6fb568a39029fc6a31bc83f3d4ab8276cf4/status"
```

---

## App Reference Format

- **NFT (singleton state)**: `n/{app_id}/{vk}`
- **Fungible token**: `t/{app_id}/{vk}`

---

## Development Notes

- All contracts use Charms SDK v0.10
- Cross-references use App IDs (not VKs)
- State UTXOs are the first output (index 0) of spell transactions
