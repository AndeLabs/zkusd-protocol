import { expect, test } from '@playwright/test';

test.describe('Wallet Connection', () => {
  test.beforeEach(async ({ page }) => {
    // Inject mock Unisat wallet before page loads
    await page.addInitScript(() => {
      (window as any).unisat = {
        requestAccounts: async () => ['tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq'],
        getAccounts: async () => ['tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq'],
        getNetwork: async () => 'testnet',
        switchNetwork: async () => {},
        getBalance: async () => ({
          confirmed: 1000000,
          unconfirmed: 0,
          total: 1000000,
        }),
        getPublicKey: async () => '02abc123def456789',
        signPsbt: async (psbtHex: string) => psbtHex + 'signed',
        pushPsbt: async (psbtHex: string) => 'mocktxid123456789',
        on: () => {},
        removeListener: () => {},
      };
    });
  });

  test('should show wallet options when clicking connect', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click connect button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    // Should show wallet options dropdown
    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await expect(unisatOption).toBeVisible({ timeout: 5000 });
  });

  test('should connect with Unisat wallet', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click connect button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    // Click Unisat option
    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    // Wait for connection
    await page.waitForTimeout(1500);

    // Should show truncated address or balance (the connect button should disappear)
    // After connecting, the header shows balance/address instead of Connect
    const walletInfo = page.locator('text=/BTC|tb1q/').first();
    await expect(walletInfo).toBeVisible({ timeout: 10000 });
  });

  test('should display balance after connection', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Should show balance in the form (Max button shows balance)
    const maxButton = page.locator('text=/Max.*BTC/').first();
    await expect(maxButton).toBeVisible({ timeout: 10000 });
  });

  test('should persist wallet type in localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Check localStorage
    const walletType = await page.evaluate(() => localStorage.getItem('zkusd_wallet_type'));
    expect(walletType).toBe('unisat');
  });

  test('should auto-reconnect on page reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    const unisatOption = page.locator('button:has-text("Unisat")').first();
    await unisatOption.click();

    await page.waitForTimeout(1500);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.waitForTimeout(2000);

    // Should still be connected (Max button should show balance)
    const maxButton = page.locator('text=/Max.*BTC/').first();
    await expect(maxButton).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Wallet Connection - No Wallet Installed', () => {
  test('should still show connect dropdown when no wallet installed', async ({ page }) => {
    // Don't inject mock wallet
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click connect button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    // Should still show options
    await page.waitForTimeout(500);

    // Options should be visible (even if they won't work)
    const dropdown = page.locator('button:has-text("Unisat"), button:has-text("Xverse")').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
  });
});
