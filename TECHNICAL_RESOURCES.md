# RECURSOS TECNICOS - BOS HACKATHON 2025

## DOCUMENTACION OFICIAL

### BitcoinOS
| Recurso | URL |
|---------|-----|
| Docs Principal | https://docs.bitcoinos.build |
| Tech Page | https://bitcoinos.build/tech |
| Ecosystem | https://bitcoinos.build/ecosystem |
| Blog | https://blog.bitcoinos.build |
| BitSNARK Quickstart | https://docs.bitcoinos.build/technical-documentation/quickstart |

### Charms Protocol
| Recurso | URL |
|---------|-----|
| Docs Principal | https://docs.charms.dev |
| Getting Started | https://docs.charms.dev/guides/charms-apps/get-started |
| Introduction | https://docs.charms.dev/guides/charms-apps/introduction |
| Whitepaper | https://charms.dev/Charms-whitepaper.pdf |
| Website | https://charms.dev |

### GitHub Repositories
| Repo | URL |
|------|-----|
| Charms Main | https://github.com/CharmsDev/charms |
| BitcoinOS | https://github.com/bitcoinOS/bitcoinOS |
| BitcoinOS Labs | https://github.com/BitcoinOS-Labs/BitcoinOS |

---

## INSTALACION Y SETUP

### Requisitos Previos

```bash
# Instalar Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verificar instalacion
rustc --version
cargo --version
```

### Instalar Charms CLI

```bash
# Instalar desde cargo
cargo install charms-cli

# Verificar version (actual: 0.10.0)
charms --version
```

### Sistema Operativo
- **Mac OS**: Soportado nativamente
- **Linux**: Soportado nativamente
- **Windows**: Usar WSL (Windows Subsystem for Linux)

---

## COMANDOS CHARMS CLI

### Crear Proyecto

```bash
# Crear nueva app
charms app new mi_token

# Estructura generada:
# mi_token/
# ├── Cargo.toml
# ├── src/
# │   └── lib.rs
# └── ...
```

### Compilar

```bash
# Construir app (genera WASM)
charms app build
```

### Verificar Spell

```bash
# Verificar que spell es valido
charms spell check mi_spell.yaml
```

### Generar Prueba

```bash
# Generar ZK proof (produccion)
charms spell prove mi_spell.yaml

# Generar proof mock (desarrollo - mas rapido)
charms spell prove mi_spell.yaml --mock
```

### Enviar Transaccion

```bash
# Ejecutar spell en blockchain
charms wallet cast
```

---

## ESTRUCTURA DE APP CHARMS

### Componentes

```
┌─────────────────────────────────────────┐
│           CHARMS APP                    │
├─────────────────────────────────────────┤
│  TAG: Tipo de app                       │
│    - N: NFT                             │
│    - T: Token fungible                  │
│    - Custom: Smart contract             │
│                                         │
│  IDENTITY: Hash 32 bytes                │
│    - Identificador unico de la app      │
│                                         │
│  APP_VK (Verification Key):             │
│    - Hash del modulo WASM               │
│    - Usado para verificar pruebas       │
└─────────────────────────────────────────┘
```

### Ejemplo de Contrato Basico

```rust
// src/lib.rs
use charms_sdk::*;

#[charms_spell]
pub fn validate(ctx: &SpellContext) -> bool {
    // Verificar condiciones

    // 1. Verificar suma de inputs == outputs
    let inputs_sum: u64 = ctx.inputs.iter()
        .map(|i| i.amount)
        .sum();
    let outputs_sum: u64 = ctx.outputs.iter()
        .map(|o| o.amount)
        .sum();

    if inputs_sum != outputs_sum {
        return false;
    }

    // 2. Verificar firmas validas
    if !ctx.verify_signatures() {
        return false;
    }

    // 3. Condiciones custom
    // ...

    true
}
```

### Spell YAML

```yaml
# mi_spell.yaml
version: "1"
app_id: "tu_app_id_aqui"

inputs:
  - utxo: "txid:vout"
    amount: 100000000  # satoshis

outputs:
  - address: "bc1q..."
    amount: 50000000
  - address: "bc1q..."
    amount: 50000000

# Parametros adicionales segun tu app
params:
  recipient: "bc1q..."
  condition: "after_block_850000"
```

---

## ZKVM Y PRUEBAS ZK

### SP1 zkVM

Charms usa SP1 v4.0.1 como zkVM:

```rust
// Las pruebas se generan automaticamente
// El desarrollador solo escribe la logica
// zkVM compila y genera proofs
```

### Flujo de Pruebas

```
1. Escribir logica en Rust
        |
        v
2. Compilar a WASM
        |
        v
3. zkVM ejecuta y genera proof
        |
        v
4. Proof incluido en Bitcoin witness
        |
        v
5. Cualquier cliente puede verificar
```

### Mock vs Real Proofs

```bash
# Desarrollo (rapido, sin ZK real)
charms spell prove --mock mi_spell.yaml

# Produccion (lento, ZK completo)
charms spell prove mi_spell.yaml
```

---

## SCROLLS API

### Concepto
API de confianza para crear "bovedas controladas por Charms"

### Funcionamiento

```
1. Scrolls genera direccion unica
        |
        v
2. Usuario deposita BTC
        |
        v
3. Solo se puede gastar con prueba Charms valida
        |
        v
4. Scrolls firma transaccion SI proof es valido
```

### Uso

```javascript
// Ejemplo conceptual
const vault = await scrolls.createVault({
  network: 'testnet',
  charmsApp: 'mi_app_id'
});

// vault.address -> direccion para depositar
// vault.spend() -> requiere proof valido
```

---

## CROSS-CHAIN BEAMING

### Proceso

```
BITCOIN                          CARDANO
   |                                |
   |  1. Crear placeholder         |
   |     output en Cardano ------->|
   |                                |
   |  2. Spell Bitcoin prueba      |
   |     transferencia a ese       |
   |     placeholder               |
   |                                |
   |  3. Spell Cardano verifica    |
   |     via Merkle proof + PoW    |
   |                                |
   |  4. Token aparece en         |
   |     Cardano nativamente       |
```

### Chains Soportadas

| Chain | Estado | Notas |
|-------|--------|-------|
| Bitcoin | Activo | Base |
| Cardano | Activo | Primera integracion |
| Litecoin | En desarrollo | LitVM |
| Dogecoin | Planeado | UTXO compatible |
| EVM chains | Via Grail | Bridge |

---

## STACK RECOMENDADO

### Backend

| Componente | Tecnologia | Uso |
|------------|------------|-----|
| Smart Contracts | Rust -> WASM | Logica Charms |
| API Server | Node.js / Rust | REST API |
| Database | PostgreSQL | Estado indexado |
| Cache | Redis | Performance |
| Queue | Bull/BullMQ | Tareas async |

### Frontend

| Componente | Tecnologia | Uso |
|------------|------------|-----|
| Framework | Next.js 14 | SSR/SSG |
| UI | TailwindCSS | Estilos |
| State | Zustand / Redux | Estado |
| Forms | React Hook Form | Formularios |

### Wallets Integration

| Wallet | Chain | Libreria |
|--------|-------|----------|
| Unisat | Bitcoin | @unisat/wallet-sdk |
| MetaMask | EVM | ethers.js / viem |
| Nami | Cardano | @cardano-sdk |
| Eternl | Cardano | @cardano-sdk |

### Testing

```bash
# Unit tests
cargo test

# Integration tests
npm run test:integration

# E2E tests
npx playwright test
```

---

## TESTNET Y DESARROLLO

### Bitcoin Testnet

```bash
# Obtener testnet BTC
# Faucet: https://testnet-faucet.mempool.co/
```

### Grail Testnet

Redes soportadas:
- Ethereum Holesky
- Base Sepolia
- Mode Sepolia
- Merlin Chain Testnet

---

## DEBUGGING

### Logs

```bash
# Ver logs de Charms CLI
RUST_LOG=debug charms spell prove mi_spell.yaml

# Ver transacciones
# Bitcoin Explorer: https://mempool.space/testnet
```

### Errores Comunes

| Error | Causa | Solucion |
|-------|-------|----------|
| Invalid proof | Logica incorrecta | Revisar predicados |
| UTXO not found | UTXO ya gastado | Verificar estado |
| Signature invalid | Keys incorrectas | Verificar firmas |

---

## EJEMPLOS DE REFERENCIA

### Bro Token
- URL: https://bro.charms.dev
- Descripcion: Token con emision programable
- Mecanismo: Mineria PoW para mintear

### Recursos Adicionales
- Discord del hackathon (mentores)
- Twitter: @BTC_OS, @CharmsDev
- Blog: https://blog.bitcoinos.build

---

## CHECKLIST DE DESARROLLO

### Setup Inicial
- [ ] Rust instalado
- [ ] Charms CLI instalado
- [ ] Cuenta testnet con BTC
- [ ] Wallet configurada

### Desarrollo
- [ ] App creada con `charms app new`
- [ ] Logica implementada en Rust
- [ ] Spell YAML configurado
- [ ] Tests pasando

### Integracion
- [ ] Backend conectado
- [ ] Frontend funcional
- [ ] Wallet integration
- [ ] Testnet deployment

### Pre-submission
- [ ] Demo grabado
- [ ] Documentacion completa
- [ ] GitHub repo publico
- [ ] README actualizado
