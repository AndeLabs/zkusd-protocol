# zkUSD Protocol Makefile
# Convenient shortcuts for common development tasks

.PHONY: all build build-wasm test clean deploy init cli help setup-testnet4 wallet balance deploy-light

# Default target
all: build test

# Build all contracts
build:
	@echo "Building zkUSD contracts..."
	@./scripts/build.sh release

# Build in debug mode
build-debug:
	@./scripts/build.sh debug

# Build WASM for Charms deployment
build-wasm:
	@./scripts/build-wasm.sh

# Run all tests
test:
	@echo "Running tests..."
	@cargo test --release

# Run tests with output
test-verbose:
	@cargo test --release -- --nocapture

# Run specific test module
test-%:
	@cargo test --release -p zkusd-common $*

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@cargo clean
	@rm -rf deployments/

# Setup testnet4 environment
setup-testnet4:
	@./scripts/setup-testnet4.sh

# Generate new wallet
wallet:
	@python3 ./scripts/generate-wallet.py

# Check wallet balance
balance:
	@./scripts/check-balance.sh

# Deploy to testnet4 (full - requires Bitcoin Core)
deploy:
	@./scripts/deploy.sh --network testnet4

# Deploy to testnet4 (light - no Bitcoin Core needed)
deploy-light:
	@./scripts/deploy-light.sh

# Deploy to signet
deploy-signet:
	@./scripts/deploy.sh --network signet

# Initialize protocol
init:
	@./scripts/init-protocol.sh

# Run CLI
cli:
	@./scripts/zkusd-cli.sh $(filter-out $@,$(MAKECMDGOALS))

# Protocol status
status:
	@./scripts/zkusd-cli.sh status

# Format code
fmt:
	@cargo fmt --all

# Check formatting
fmt-check:
	@cargo fmt --all -- --check

# Run clippy
lint:
	@cargo clippy --all-targets --all-features -- -D warnings

# Generate docs
docs:
	@cargo doc --no-deps --open

# Check everything before commit
check: fmt-check lint test
	@echo "All checks passed!"

# Development setup
dev-setup:
	@echo "Setting up development environment..."
	@rustup update
	@rustup component add rustfmt clippy
	@echo "Done!"

# Show contract sizes
sizes:
	@echo "Contract sizes (release build):"
	@ls -lh target/release/*.rlib 2>/dev/null || echo "Run 'make build' first"

# Quick rebuild and test
quick: build test

# Help
help:
	@echo "zkUSD Protocol - Available Commands"
	@echo ""
	@echo "Build & Test:"
	@echo "  make build          - Build all contracts (release)"
	@echo "  make build-debug    - Build all contracts (debug)"
	@echo "  make test           - Run all tests"
	@echo "  make test-verbose   - Run tests with output"
	@echo "  make clean          - Clean build artifacts"
	@echo ""
	@echo "Wallet:"
	@echo "  make wallet         - Generate new testnet4 wallet"
	@echo "  make balance        - Check wallet balance"
	@echo ""
	@echo "Deployment:"
	@echo "  make setup-testnet4 - Setup testnet4 environment"
	@echo "  make deploy-light   - Deploy to testnet4 (no Bitcoin Core)"
	@echo "  make deploy         - Deploy to testnet4 (full)"
	@echo "  make deploy-signet  - Deploy to signet"
	@echo "  make init           - Initialize protocol"
	@echo ""
	@echo "Development:"
	@echo "  make fmt            - Format code"
	@echo "  make lint           - Run clippy"
	@echo "  make check          - Run all checks"
	@echo "  make docs           - Generate documentation"
	@echo "  make dev-setup      - Setup dev environment"
	@echo ""
	@echo "CLI:"
	@echo "  make cli <command>  - Run CLI command"
	@echo "  make status         - Show protocol status"
	@echo ""
	@echo "Examples:"
	@echo "  make cli vault open 1.0 30000"
	@echo "  make cli oracle price"

# Catch-all for cli arguments
%:
	@:
