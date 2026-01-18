import { expect, test } from '@playwright/test';

test.describe('Open Vault Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Inject mock Unisat wallet
    await page.addInitScript(() => {
      (window as any).unisat = {
        requestAccounts: async () => ['tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq'],
        getAccounts: async () => ['tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq'],
        getNetwork: async () => 'testnet',
        switchNetwork: async () => {},
        getBalance: async () => ({
          confirmed: 10000000, // 0.1 BTC
          unconfirmed: 0,
          total: 10000000,
        }),
        getPublicKey: async () => '02abc123def456789',
        signPsbt: async (psbtHex: string) => psbtHex + 'signed',
        pushPsbt: async (psbtHex: string) => 'mocktxid' + Date.now(),
        on: () => {},
        removeListener: () => {},
      };
    });
  });

  test('should display the Open Vault form on page load', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The Open New Vault tab should be active by default
    const openVaultTab = page.locator('button:has-text("Open New Vault")');
    await expect(openVaultTab).toBeVisible({ timeout: 10000 });

    // Form elements should be visible
    const collateralLabel = page.locator('text=Collateral (BTC)').first();
    await expect(collateralLabel).toBeVisible({ timeout: 10000 });
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    // Remove the mock wallet
    await page.addInitScript(() => {
      delete (window as any).unisat;
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should show "Connect your wallet" message
    const connectPrompt = page.locator('text=Connect your wallet').first();
    await expect(connectPrompt).toBeVisible({ timeout: 10000 });
  });

  test('should show Max button after wallet connection', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Should show Max balance button
    const maxButton = page.locator('text=/Max.*BTC/').first();
    await expect(maxButton).toBeVisible({ timeout: 10000 });
  });

  test('should calculate collateral ratio when values are entered', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Enter collateral amount
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('0.01');

    // Wait a moment for calculations
    await page.waitForTimeout(500);

    // Enter debt amount
    const debtInput = page.locator('input[type="number"]').nth(1);
    await debtInput.fill('500');

    await page.waitForTimeout(500);

    // Should show collateral ratio
    const crLabel = page.locator('text=Collateral Ratio').first();
    await expect(crLabel).toBeVisible({ timeout: 5000 });
  });

  test('should show warning for low collateral ratio', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Enter small collateral
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('0.001');

    await page.waitForTimeout(500);

    // Enter high debt to make ratio too low
    const debtInput = page.locator('input[type="number"]').nth(1);
    await debtInput.fill('100');

    await page.waitForTimeout(500);

    // Should show warning about collateral ratio
    const warning = page.locator('text=/must be at least.*%/i').first();
    await expect(warning).toBeVisible({ timeout: 5000 });
  });

  test('should show minimum debt warning', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Enter collateral
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('0.01');

    await page.waitForTimeout(500);

    // Enter debt below minimum
    const debtInput = page.locator('input[type="number"]').nth(1);
    await debtInput.fill('1');

    await page.waitForTimeout(500);

    // Should show minimum debt warning
    const warning = page.locator('text=/Minimum debt/i').first();
    await expect(warning).toBeVisible({ timeout: 5000 });
  });

  test('should enable Open Vault button with valid inputs', async ({ page }) => {
    // Mock API calls
    await page.route('**/mempool.space/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/blocks/tip/height')) {
        await route.fulfill({ status: 200, body: '100000' });
      } else if (url.includes('/v1/fees/recommended')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            fastestFee: 20,
            halfHourFee: 15,
            hourFee: 10,
            economyFee: 5,
            minimumFee: 1,
          }),
        });
      } else if (url.includes('/utxo')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              txid: 'abc123def456789012345678901234567890123456789012345678901234567890',
              vout: 0,
              value: 10000000,
              status: { confirmed: true },
            },
          ]),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(2000);

    // Enter valid collateral
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('0.01');

    await page.waitForTimeout(500);

    // Enter valid debt
    const debtInput = page.locator('input[type="number"]').nth(1);
    await debtInput.fill('500');

    await page.waitForTimeout(1000);

    // Open Vault button should be visible
    const openVaultButton = page.locator('button:has-text("Open Vault")');
    await expect(openVaultButton).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to My Vaults tab', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click My Vaults tab
    const myVaultsTab = page.locator('button:has-text("My Vaults")');
    await myVaultsTab.click();

    await page.waitForTimeout(500);

    // Should show My Vaults content
    // When not connected, it should prompt to connect wallet
    const content = page.locator('text=/connect.*wallet|No vaults found|Your vaults/i').first();
    await expect(content).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Open Vault - Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    // Inject mock wallet with confirmed UTXO
    await page.addInitScript(() => {
      (window as any).unisat = {
        requestAccounts: async () => ['tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq'],
        getAccounts: async () => ['tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq'],
        getNetwork: async () => 'testnet',
        switchNetwork: async () => {},
        getBalance: async () => ({
          confirmed: 10000000,
          unconfirmed: 0,
          total: 10000000,
        }),
        getPublicKey: async () => '02abc123def456789',
        signPsbt: async (psbtHex: string) => psbtHex + 'signed',
        pushPsbt: async (psbtHex: string) => 'mocktxid' + Date.now(),
        on: () => {},
        removeListener: () => {},
      };
    });
  });

  test('should show insufficient balance warning', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Enter more collateral than balance (0.1 BTC = 10M sats, but enter more)
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('1.0');

    await page.waitForTimeout(500);

    // Should show insufficient balance warning
    const warning = page.locator('text=/Insufficient balance/i').first();
    await expect(warning).toBeVisible({ timeout: 5000 });
  });

  test('should show liquidation price when valid inputs are entered', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Enter collateral
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('0.01');

    await page.waitForTimeout(500);

    // Enter debt
    const debtInput = page.locator('input[type="number"]').nth(1);
    await debtInput.fill('500');

    await page.waitForTimeout(500);

    // Should show liquidation price
    const liqPriceLabel = page.locator('text=Liquidation Price').first();
    await expect(liqPriceLabel).toBeVisible({ timeout: 5000 });
  });

  test('should show opening fee calculation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Enter collateral and debt
    const collateralInput = page.locator('input[type="number"]').first();
    await collateralInput.fill('0.01');

    const debtInput = page.locator('input[type="number"]').nth(1);
    await debtInput.fill('500');

    await page.waitForTimeout(500);

    // Should show opening fee
    const feeLabel = page.locator('text=Opening Fee').first();
    await expect(feeLabel).toBeVisible({ timeout: 5000 });
  });
});
