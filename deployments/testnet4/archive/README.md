# Archived Deployment Spells

> **Archived On**: 2026-01-25
> **Network**: testnet4

## What's Here

These are spell YAML files from previous deployment attempts and experiments.
They contain valuable reference data but should NOT be reused directly.

### Why Archived

1. **UTXOs are stale** - Referenced UTXOs have been spent
2. **VKs may mismatch** - Contract code has changed
3. **Structure evolved** - Spell format has been refined

### Successful Deployments

The following spells WORKED and their state is in `deployment-config.json`:

- VaultManager V2: `deploy-vault-manager-v2-fixed.yaml` (2026-01-25)
- (Others were experiments that didn't complete)

### Reference Value

- State structure examples
- Byte array formats for addresses/IDs
- Operation witness formats

## Creating New Spells

Use `/scripts/deploy/deploy-contract.sh` or create manually in `/deployments/testnet4/pending/`
