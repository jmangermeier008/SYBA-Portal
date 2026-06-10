import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load Firebase service account + Stripe test keys for global setup/teardown
// and in-test Firestore assertions. The Next.js dev server loads .env.local itself.
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/setup/global-setup.ts',
  globalTeardown: './tests/e2e/setup/global-teardown.ts',
  // Stripe-hosted checkout pages are slow; full registration flows need headroom.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // Tests are isolated via unique per-run emails, but they share one live
  // Firestore project and one dev server — keep concurrency low for stability.
  fullyParallel: true,
  workers: 2,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:9002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Turbopack compiles routes on first hit — first navigations are slow.
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:9002',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
