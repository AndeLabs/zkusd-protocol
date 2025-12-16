# zkUSD Deployment Status - Bitcoin Testnet4

**Fecha**: 15 Diciembre 2024
**Red**: Bitcoin Testnet4
**Charms Version**: 8
**Last Updated**: 15 Dec 2024 11:30 UTC

---

## Estado General

| Contrato | Estado | Bloque |
|----------|--------|--------|
| Price Oracle | ✅ Confirmado | 113548 |
| zkUSD Token | ✅ Confirmado | ~113500 |
| Vault Manager | ✅ Confirmado | ~113470 |
| Stability Pool | ✅ Confirmado | ~113470 |

---

## Contratos Desplegados

### 1. Price Oracle ✅ Confirmado
- **VK**: `b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32`
- **App ID**: `8aa4f505cb3e6f7f8d7f553e517dc0c161fd662ce56ce9412ad5dd00991b1ef2`
- **Spell TX**: `e4aeedcc32c72a2e09e29744b7ab5c10224dca8a8a5374a98363b4ad9602b977`
- **Block**: 113548
- **App Reference**: `n/8aa4f505cb3e6f7f8d7f553e517dc0c161fd662ce56ce9412ad5dd00991b1ef2/b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32`
- **Estado Inicial**:
  - `price`: 10,400,000,000,000 ($104,000.00 con 8 decimales)
  - `source`: Mock
  - `confidence`: 100
  - `is_active`: true

### 2. zkUSD Token
- **VK**: `7d1a06745a94adf1195fb9f2f987cb48b8c46b814f53167c619c9175cd406903`
- **App ID**: `a6b3570c84064d72dc6687d0309154469efa6a427fd3c1691e656d6172455c82`
- **Spell TX**: `4ec30b16e45b20341586e690f282314d24a5696dde50b80ef02905b1fae8713e`
- **App Reference**: `t/a6b3570c84064d72dc6687d0309154469efa6a427fd3c1691e656d6172455c82/7d1a06745a94adf1195fb9f2f987cb48b8c46b814f53167c619c9175cd406903`
- **Estado Inicial**:
  - `authorized_minter`: VaultManager VK
  - `total_supply`: 0

### 3. Vault Manager
- **VK**: `56ff2636c4d11caeed8a90a608e7c067928e5368f3166d495b85be90af659c44`
- **App ID**: `3ce7c8f65b55f2e66f25370f951abfc49af6980d63969f9368f0b5bb1cf878d0`
- **Spell TX**: `a6dfdfaa1834eca1203f871f535aa33d2d197518c485e1d7c6dac4ad1b55a7a9`
- **App Reference**: `n/3ce7c8f65b55f2e66f25370f951abfc49af6980d63969f9368f0b5bb1cf878d0/56ff2636c4d11caeed8a90a608e7c067928e5368f3166d495b85be90af659c44`
- **Estado Inicial**:
  - `total_collateral`: 0
  - `total_debt`: 0
  - `active_vault_count`: 0
  - `base_rate`: 50 (0.5%)
  - `is_paused`: false

### 4. Stability Pool
- **VK**: `ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752`
- **App ID**: `c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf`
- **Spell TX**: `ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c`
- **App Reference**: `n/c11c5451c834f54ed56227b3fb48d366de2c139c2a0f559aeebfb45af8a067bf/ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752`
- **Estado Inicial**:
  - `total_zkusd`: 0
  - `total_btc`: 0
  - `product_p`: 1000000000000000000 (1e18)
  - `depositor_count`: 0

---

## Arquitectura de Operaciones

### Estructura de Archivos

```
/Users/munay/dev/zkUSD/
├── contracts/
│   ├── common/src/                     # Tipos y lógica compartida
│   ├── zkusd-token/src/charms.rs       # Token + Initialize
│   ├── stability-pool/src/charms.rs    # SP + Initialize
│   ├── vault-manager/src/charms.rs     # VM + Initialize
│   └── price-oracle/src/charms.rs      # Oracle
│
├── deployments/
│   └── testnet4/
│       └── deployment-config.json      # Configuración centralizada
│
├── spells/
│   ├── ops/                            # Templates operacionales
│   │   ├── open-vault-template.yaml
│   │   ├── stability-deposit-template.yaml
│   │   ├── liquidate-template.yaml
│   │   ├── transfer-zkusd-template.yaml
│   │   └── update-oracle-template.yaml
│   │
│   ├── deploy-*.yaml                   # Spells de deployment (usados)
│   └── DEPLOYMENT_STATUS.md            # Este archivo
│
├── scripts/
│   ├── run-operation.sh                # CLI para operaciones
│   ├── deploy-spell.sh                 # Deploy helper
│   └── zkusd-cli.sh                    # CLI general
│
└── target/wasm32-wasip1/release/
    ├── zkusd-token-app.wasm
    ├── zkusd-stability-pool-app.wasm
    ├── zkusd-vault-manager-app.wasm
    └── zkusd-price-oracle-app.wasm
```

---

## Flujos de Operación

### 1. Abrir Vault (Open Vault)

```bash
# Usar el script interactivo
./scripts/run-operation.sh open-vault 1.0 50000

# O manualmente:
# 1. Preparar spell desde template
# 2. Reemplazar variables
# 3. Ejecutar deploy-spell.sh
```

**Flujo UTXO:**
```
IN:  [BTC collateral UTXO]
OUT: [Vault NFT charm] + [zkUSD tokens] + [BTC change]
```

**Requisitos:**
- ICR >= 110% (MCR)
- Deuda mínima: 200 zkUSD
- 2 UTXOs diferentes (collateral + funding)

### 2. Depositar en Stability Pool

```bash
./scripts/run-operation.sh deposit-sp 10000
```

**Flujo UTXO:**
```
IN:  [zkUSD UTXO] + [SP state UTXO]
OUT: [Updated SP state] + [Depositor NFT] + [zkUSD change]
```

### 3. Liquidar Vault

```bash
./scripts/run-operation.sh liquidate <vault_utxo>
```

**Condiciones:**
- Vault ICR < 110% (MCR)
- Stability Pool tiene suficiente zkUSD

**Flujo UTXO:**
```
IN:  [Underwater Vault] + [SP state]
OUT: [Liquidated Vault (status=3)] + [Updated SP] + [Liquidator bonus] + [Gas comp]
```

### 4. Transferir zkUSD

```bash
./scripts/run-operation.sh transfer tb1q... 500
```

**Flujo UTXO:**
```
IN:  [zkUSD UTXO]
OUT: [zkUSD to recipient] + [zkUSD change to sender]
```

### 5. Actualizar Oracle

```bash
./scripts/run-operation.sh update-oracle 104500
```

**Permiso:** Solo admin/operador

---

## Verificar Transacciones

### Comprobar confirmaciones
```bash
# Token deployment
bitcoin-cli -testnet4 gettransaction 4ec30b16e45b20341586e690f282314d24a5696dde50b80ef02905b1fae8713e

# Vault Manager deployment
bitcoin-cli -testnet4 gettransaction a6dfdfaa1834eca1203f871f535aa33d2d197518c485e1d7c6dac4ad1b55a7a9

# Stability Pool deployment
bitcoin-cli -testnet4 gettransaction ea78d29a8fcd3f5892d4422dc5ef2c914a5d0ed51076f9d92f212d64c0f7194c
```

### Ver contenido de spell
```bash
charms tx show-spell --tx $(bitcoin-cli -testnet4 getrawtransaction <txid>)
```

---

## Cross-App References

```
Token.authorized_minter = VaultManager.VK (56ff2636...)
VaultManager.zkusd_token_id = Token.VK (7d1a0674...)
VaultManager.stability_pool_id = StabilityPool.VK (ace28945...)
VaultManager.price_oracle_id = Oracle.VK (b44db07a...)
StabilityPool.zkusd_token_id = Token.VK (7d1a0674...)
StabilityPool.vault_manager_id = VaultManager.VK (56ff2636...)
```

---

## Parámetros del Protocolo

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| MCR | 110% | Minimum Collateral Ratio |
| CCR | 150% | Critical Collateral Ratio |
| Min Debt | 200 zkUSD | Deuda mínima por vault |
| Gas Compensation | 200 zkUSD | Compensación al liquidador |
| Liquidation Bonus | 0.5% | Bonus en colateral |
| Redemption Fee Floor | 0.5% | Fee mínimo de redención |

---

## Comandos Útiles

```bash
# Ver VK de un WASM
charms app vk target/wasm32-wasip1/release/zkusd-token-app.wasm

# Listar UTXOs disponibles
bitcoin-cli -testnet4 listunspent 0

# Generar App ID (SHA256 del UTXO input)
echo -n "txid:vout" | sha256sum

# Probar spell (mock)
charms spell prove --spell spell.yaml --mock ...

# Broadcast transacción
bitcoin-cli -testnet4 sendrawtransaction "hex"
```

---

## Próximos Pasos

### Pruebas de Integración
- [ ] Flujo completo: Depositar BTC -> Mint zkUSD -> Deposit en SP
- [ ] Liquidación de vault bajo-colateralizado
- [ ] Redención de zkUSD por BTC
- [ ] Withdraw de SP con BTC gains

### Mejoras Pendientes
- [ ] Indexer para rastrear state de vaults
- [ ] Frontend web para interacción
- [ ] Monitoreo de liquidaciones automático
- [ ] Integración con oracle externo (Chainlink)

---

## VK Versions

Los contratos tienen dos versiones de VKs:

### Deployed (con debug output)
Estos son los VKs de los contratos actualmente desplegados en testnet4:
```
VaultManager: 56ff2636c4d11caeed8a90a608e7c067928e5368f3166d495b85be90af659c44
Token:        7d1a06745a94adf1195fb9f2f987cb48b8c46b814f53167c619c9175cd406903
Oracle:       b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32
StabilityPool: ace2894585f8820a3b230ab57a24df35de1dd4b7234d9d38bde78fa643871752
```

### Production (sin debug output)
Estos VKs son para un nuevo deployment limpio:
```
VaultManager: 3a6a02f4fe4b4b61f03018cabb7995240799fac45323ff766f9ecc3398bb7874
Token:        355518c664be1dd7f9f9c283feb2c48adf3baa45c88e04324fb52fc11d625235
Oracle:       b44db07ac1697704ea7170f4e857c50c4545f0de00dfcc11835dc6efb0c27c32
```

**Nota**: Para usar los contratos existentes, usa `DEPLOY_MODE=DEPLOYED` en los scripts.
Para un nuevo deployment limpio, usa `DEPLOY_MODE=PRODUCTION`.

---

## Notas Técnicas

### Formato de App en Charms
- **NFT (singleton state)**: `n/{app_id}/{vk}`
- **Fungible token**: `t/{app_id}/{vk}`

### UTXO Separation Rule
**CRÍTICO**: Siempre usar UTXOs diferentes para `ins:` y `--funding-utxo`.
Usar el mismo UTXO causa error "conflict-in-package".

### Problemas Conocidos
- El prover remoto a veces retorna "unexecutable" - reintentar suele funcionar
- Los UTXOs sin confirmar pueden usarse en cadena (útil para desarrollo)
- Usar `--prev-txs` para transacciones que crean los UTXOs de input
