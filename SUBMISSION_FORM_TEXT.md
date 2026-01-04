# Para copiar en el formulario de submission

## Submission Details (Campo de texto detallado)

zkUSD is a fully decentralized, Bitcoin-native stablecoin protocol built entirely with Charms. Users deposit BTC as collateral and mint USD-pegged stablecoins through Collateralized Debt Positions (CDPs) without bridges, custodians, or leaving Bitcoin's security model.

**✅ HACKATHON REQUIREMENTS MET**

**1. SDK First - Complete Charms Integration:**
- 4 deployed Charms apps on Bitcoin Testnet4 (all live and functional)
- Price Oracle (App ID: 8aa4f505...991b1ef2) - Block 113548
- zkUSD Token (App ID: a6b3570c...72455c82) - Fungible + NFT state
- Vault Manager (App ID: 3ce7c8f6...1cf878d0) - CDP management
- Stability Pool (App ID: c11c5451...f8a067bf) - Liquidation pool
- Every contract compiled to WASM with full ZK proof validation
- Cross-app validation using Charms app_id system
- Complete spell-based transaction composition
- See contracts/*/src/charms.rs for SDK integration details

**2. Working UI - Functional Front-End:**
- Production-ready Next.js 15 + React 19 application
- Wallet integration (Unisat, Xverse)
- Open vault, adjust collateral/debt, deposit to stability pool
- Real-time statistics (ICR, TCR, debt tracking)
- Mobile responsive design (2025 best practices)
- Full transaction flow with ZK proof generation
- Location: apps/web/ directory

**3. Core Feature Complete:**
✅ Vault creation with BTC collateral (110% minimum ratio)
✅ zkUSD minting and burning
✅ Liquidation mechanism via Stability Pool
✅ Price oracle integration with staleness checks
✅ Cross-contract atomic validation
✅ Recovery mode when Total CR < 150%

**ADVANCED FEATURES (implemented):**
⚡ Flash Minting - UTXO-native flash loans without callbacks
🛟 Atomic Vault Rescue - Permission-less rescue of underwater vaults
🛡️ Insurance Charms - Tradable NFT liquidation protection

**🚀 NOVEL INNOVATIONS**

**1. Flash Minting Without Callbacks:**
Unlike Ethereum flash loans, zkUSD's flash mints are atomically validated in a single UTXO transaction. No callback complexity - all validation happens in one Bitcoin transaction. Enables self-liquidation, arbitrage, collateral swaps (contracts/common/src/charms_ops.rs)

**2. Atomic Vault Rescue:**
Third parties can rescue underwater vaults without owner permission in a single atomic transaction. Rescuer provides collateral + debt repayment, receives up to 5% discount. Only possible with UTXO model - permission-less intervention that benefits both parties.

**3. Insurance Charms (Tradable NFTs):**
First-ever tradable liquidation protection as NFT charms. Buy coverage, trade on secondary markets, auto-trigger when ICR drops. First DeFi insurance as transferable NFT charms.

**COMPARISON:**
vs MakerDAI/Liquity: ✅ Native Bitcoin, ✅ UTXO-based, ✅ No re-entrancy risk
vs Mezo: ✅ Flash mints (atomic), ✅ Atomic rescue (NEW), ✅ Insurance NFTs (NEW)

**🌍 ECOSYSTEM CONTRIBUTION**

zkUSD is positioned to contribute battle-tested primitives to the Charms ecosystem (like OpenZeppelin for Ethereum):
- charms-std/ directory contains proof-of-concept extraction
- Flash mint primitives ready for reuse
- CDP patterns from VaultManager
- Lending patterns from StabilityPool
- Novel atomic rescue and insurance NFT patterns
- Next step: Submit CHIP to CharmsDev/charms
- First production DeFi protocol to contribute reusable patterns to Charms

**TECHNICAL ARCHITECTURE:**
- 4 Charms apps with cross-contract validation in single Bitcoin transaction
- Each vault = independent UTXO (parallel processing, no state contention)
- Client-side validation (privacy-preserving)
- TypeScript SDK with spell builder
- ZK proof generation for every state transition
- Complete integration pattern documented

**USE CASE:**
Solving real problem: BTC holders want liquidity without selling (lose upside, taxable) or bridges (custodian risk). zkUSD: Native Bitcoin, keep your BTC, mint stablecoins.

**DEPLOYMENT EVIDENCE:**
All contracts live on Bitcoin Testnet4 starting Block 113548. Full transaction IDs and verification keys in spells/DEPLOYMENT_STATUS.md

**TECH STACK:**
Contracts: Rust → WASM32-WASIP1, charms-sdk
Frontend: Next.js 15, React 19, TailwindCSS, Zustand
SDK: TypeScript, custom Charms client, ZK prover

**DOCUMENTATION:**
- Main README: Comprehensive overview
- DEPLOYMENT_STATUS.md: Live contracts
- TRANSACTION_FLOW_ANALYSIS.md: UX flow
- charms-std/: Ecosystem contribution
- Extensive code comments

zkUSD isn't just a hackathon project - it's the foundation for DeFi on Bitcoin via Charms, with novel innovations and ecosystem contribution ready.

---

## Link to Code
https://github.com/AndeLabs/zkusd-protocol

---

## Link to Demo Video
[PENDIENTE - Necesitas grabar y subir a YouTube/Loom]

Sugerencias para el video:
1. Intro (30 seg): Qué es zkUSD y el problema que resuelve
2. Demo UI (2 min): Mostrar abrir vault, mint zkUSD, ajustar collateral
3. Charms Integration (1 min): Mostrar los 4 contratos desplegados en Testnet4
4. Innovations (1 min): Explicar flash mints, atomic rescue, insurance NFTs
5. Ecosystem Contribution (30 seg): charms-std/ y visión futura
Total: ~5 minutos

---

## Live Demo Link
[PENDIENTE - Agrega tu URL de Vercel deployment]

Ejemplo: https://zkusd-protocol.vercel.app

Si no lo tienes desplegado aún:
```bash
cd apps/web
vercel deploy --prod
```

---

## Link to Presentation (OPCIONAL)
[Si tienes slides, agrégalo aquí - puede ayudar]

Herramientas sugeridas:
- Google Slides
- Pitch.com
- Canva

---

## CHECKLIST ANTES DE SUBMITIR:

[ ] GitHub repo público y accesible
[ ] Video demo grabado y subido (YouTube, Loom, etc.)
[ ] App desplegada en Vercel con URL funcional
[ ] README.md actualizado (✅ ya lo tienes)
[ ] Deployment evidence visible (✅ tienes DEPLOYMENT_STATUS.md)
[ ] Código limpio sin TODOs críticos
[ ] .env.example incluido si es necesario

---

## PRÓXIMOS PASOS INMEDIATOS:

1. **Demo Video** (CRÍTICO - es requerido):
   - Graba pantalla mostrando la UI funcionando
   - Explica las innovaciones (flash mints, atomic rescue, insurance)
   - Muestra los contratos desplegados en Bitcoin Testnet4
   - 4-5 minutos máximo
   - Sube a YouTube (puede ser unlisted)

2. **Deploy a Vercel** (CRÍTICO - es requerido):
   ```bash
   cd apps/web
   vercel deploy --prod
   ```
   - Copia la URL que te da Vercel

3. **Verificar GitHub**:
   - Asegúrate que el repo sea público
   - Que tenga el último commit con los READMEs limpios

4. **Opcional - Presentation Deck**:
   - Slides de 5-10 páginas
   - Problem → Solution → Tech → Innovation → Impact

¿Tienes el video demo ya grabado? ¿Está desplegada la app en Vercel?
