import { expect, test } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');

    // Check that the page title or heading contains zkUSD
    await expect(page.locator('h1')).toContainText(/Bitcoin|zkUSD/i);
  });

  test('should display protocol stats', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for BTC Price stat (one of the protocol stats)
    const btcPriceLabel = page.locator('text=BTC Price').first();
    await expect(btcPriceLabel).toBeVisible({ timeout: 10000 });

    // Check for Total Value Locked stat
    const tvlLabel = page.locator('text=Total Value Locked').first();
    await expect(tvlLabel).toBeVisible({ timeout: 10000 });
  });

  test('should display vault dashboard tabs', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for Open New Vault tab
    const openVaultTab = page.locator('button:has-text("Open New Vault")').first();
    await expect(openVaultTab).toBeVisible({ timeout: 10000 });

    // Check for My Vaults tab
    const myVaultsTab = page.locator('button:has-text("My Vaults")').first();
    await expect(myVaultsTab).toBeVisible({ timeout: 10000 });
  });

  test('should show connect wallet button in header', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for connect wallet button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await expect(connectButton).toBeVisible({ timeout: 10000 });
  });

  test('should display contract status section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for Contract Status heading
    const contractStatus = page.locator('text=Contract Status').first();
    await expect(contractStatus).toBeVisible({ timeout: 10000 });

    // Check for Price Oracle contract
    const priceOracle = page.locator('text=Price Oracle').first();
    await expect(priceOracle).toBeVisible({ timeout: 10000 });
  });

  test('should display How It Works section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for How It Works section
    const howItWorks = page.locator('text=How It Works').first();
    await expect(howItWorks).toBeVisible({ timeout: 10000 });
  });

  test('should display Protocol Parameters section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for Protocol Parameters section
    const protocolParams = page.locator('text=Protocol Parameters').first();
    await expect(protocolParams).toBeVisible({ timeout: 10000 });

    // Check for Min Collateral Ratio
    const minCR = page.locator('text=Min Collateral Ratio').first();
    await expect(minCR).toBeVisible({ timeout: 10000 });
  });
});
