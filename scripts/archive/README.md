# Archived Scripts

> **Archived On**: 2026-01-25
> **Reason**: Reorganizing deployment infrastructure for production

## What's Here

These scripts were used during early development and experimentation.
They are kept for reference but should NOT be used for new deployments.

### Old Deployment Scripts
- `deploy-*.ts/sh` - Early deployment attempts
- `redeploy-*.sh` - Redeployment scripts for specific versions

### Old Wallet/Transaction Scripts
- `generate-wallet*.py` - Wallet generation (use standard tools instead)
- `sign-and-broadcast.py` - Manual signing (use charms CLI instead)
- `build_reveal_tx.py` - Low-level transaction building

### Old Testing/Monitoring
- `test-*.sh/ts` - Old test scripts
- `monitor.sh` - Basic monitoring (replaced with proper tooling)
- `indexer.sh` - Prototype indexer

### Old CLI Tools
- `zkusd-cli.sh` - Interactive CLI prototype
- `zkusd-menu.sh` - Menu-based interface

## New Location

Use scripts from `/scripts/deploy/` instead:
- `build-all.sh` - Build all contracts
- `deploy-contract.sh` - Deploy single contract
- (more coming)

## Can I Delete These?

Yes, after confirming you don't need any reference material.
Keep the archive until you're confident the new system is complete.
