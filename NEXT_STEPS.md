# zkUSD - Próximos Pasos

**Estado Actual**: Contratos desplegados y confirmados en Bitcoin Testnet4
**Última Actualización**: 15 Diciembre 2024

---

## Estado del Deployment

| Componente | Estado | Confirmaciones | UTXO |
|------------|--------|----------------|------|
| zkUSD Token | Deployed | 13 | `4ec30b1...e8713e:0` |
| Vault Manager | Deployed | 30 | `a6dfdfa...55a7a9:0` |
| Stability Pool | Deployed | 30 | `ea78d29...f7194c:0` |
| Price Oracle | Pendiente | - | - |

---

## Próximos Pasos (En Orden)

### 1. Desplegar Price Oracle (PENDIENTE)

El Price Oracle aún no está desplegado. Es necesario para que los vaults funcionen.

```bash
# 1. Crear spell de deployment para Oracle
# Usar template: spells/deploy-oracle.yaml

# 2. Ejecutar deployment
./scripts/deploy-spell.sh \
  spells/deploy-oracle.yaml \
  target/wasm32-wasip1/release/zkusd-price-oracle-app.wasm \
  "<oracle_utxo>" \
  "<funding_utxo>" \
  <funding_value>
```

**Datos necesarios para Oracle:**
- Precio inicial BTC: ~$104,000 = `10400000000000` (8 decimals)
- Admin pubkey para updates

---

### 2. Probar Open Vault (Primera Operación)

Una vez que Oracle esté desplegado:

```bash
# Generar spell de open vault
./scripts/generate-spell.sh open-vault /tmp/test-vault.yaml \
  --collateral=50000000 \
  --debt=2500000000000 \
  --collateral-utxo="7f0152ad9d97244f60e3fb680d35bd3268fa7634e5bf61055d4f28d6ad0e4420:3" \
  --owner-address="tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"

# Ver el spell generado
cat /tmp/test-vault.yaml

# Ejecutar deployment
./scripts/deploy-spell.sh \
  /tmp/test-vault.yaml \
  target/wasm32-wasip1/release/zkusd-vault-manager-app.wasm \
  "7f0152ad9d97244f60e3fb680d35bd3268fa7634e5bf61055d4f28d6ad0e4420:3" \
  "7f0152ad9d97244f60e3fb680d35bd3268fa7634e5bf61055d4f28d6ad0e4420:5" \
  60000
```

**Valores de ejemplo:**
- Collateral: 0.5 BTC (50,000,000 sats)
- Debt: 25,000 zkUSD (2,500,000,000,000 base)
- ICR = (0.5 * $104,000) / $25,000 = 208% (seguro)

---

### 3. Probar Flujo Completo

```
Open Vault → Mint zkUSD → Deposit SP → Liquidation → Withdraw SP
```

#### Paso 1: Open Vault
```bash
./scripts/run-operation.sh open-vault 0.5 25000
```

#### Paso 2: Transfer zkUSD (opcional)
```bash
./scripts/run-operation.sh transfer tb1q... 5000
```

#### Paso 3: Deposit to Stability Pool
```bash
./scripts/run-operation.sh deposit-sp 10000
```

#### Paso 4: Simular Liquidación
1. Actualizar precio del Oracle a valor bajo
2. Vault se vuelve under-collateralized
3. Ejecutar liquidación

```bash
# Bajar precio para hacer vault liquidable
./scripts/run-operation.sh update-oracle 40000  # $40k BTC

# Liquidar
./scripts/run-operation.sh liquidate <vault_utxo>
```

#### Paso 5: Withdraw + Claim Rewards
```bash
./scripts/run-operation.sh withdraw-sp 10000
```

---

## Archivos Creados

### Configuración
- `deployments/testnet4/deployment-config.json` - Config centralizado con UTXOs

### Spells Operacionales (en `spells/ops/`)
| Archivo | Operación |
|---------|-----------|
| `open-vault-template.yaml` | Crear vault |
| `close-vault-template.yaml` | Cerrar vault |
| `adjust-vault-template.yaml` | Ajustar vault |
| `stability-deposit-template.yaml` | Depositar en SP |
| `withdraw-sp-template.yaml` | Retirar de SP |
| `liquidate-template.yaml` | Liquidar vault |
| `transfer-zkusd-template.yaml` | Transferir zkUSD |
| `redeem-template.yaml` | Redimir zkUSD |
| `update-oracle-template.yaml` | Actualizar precio |

### Scripts
| Script | Uso |
|--------|-----|
| `run-operation.sh` | CLI interactivo para operaciones |
| `generate-spell.sh` | Genera spells desde templates |
| `deploy-spell.sh` | Deploy helper con validaciones |

---

## UTXOs Disponibles para Pruebas

```
UTXO                                                          | BTC      | Sats
-------------------------------------------------------------|----------|--------
ea78d29a8fcd...7194c:2                                        | 0.00183  | 183,305
4ec30b16e45b...713e:1                                         | 0.00115  | 114,525
7f0152ad9d97...4420:5                                         | 0.00060  | 60,000
7f0152ad9d97...4420:3                                         | 0.00060  | 60,000
```

**Total disponible**: ~417,830 sats (~0.00418 BTC)

---

## Comandos de Verificación

```bash
# Ver UTXOs disponibles
bitcoin-cli -testnet4 listunspent 0

# Ver estado de TX
bitcoin-cli -testnet4 gettransaction <txid>

# Ver spell en una TX
charms tx show-spell --tx $(bitcoin-cli -testnet4 getrawtransaction <txid>)

# Ver VK de un WASM
charms app vk target/wasm32-wasip1/release/<app>.wasm
```

---

## Problemas Conocidos

1. **"conflict-in-package"**: Usar UTXOs diferentes para `ins:` y `--funding-utxo`
2. **"unexecutable"**: Reintentar - problema temporal del prover
3. **UTXO no encontrado**: Esperar confirmaciones o usar `--prev-txs`

---

## Mejoras Futuras (Backlog)

- [ ] Indexer para tracking de vaults en tiempo real
- [ ] Frontend web para interacción con el protocolo
- [ ] Bot de liquidaciones automáticas
- [ ] Integración con oracle externo (Chainlink/DIA)
- [ ] Multi-collateral support
- [ ] Tests automatizados end-to-end
