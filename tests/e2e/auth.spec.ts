/**
 * 1A — Auth flows, as a parent experiences them.
 * Each test uses a unique per-run email (or a read-only seeded fixture),
 * so tests do not depend on each other's state.
 */
import { test, expect } from '@playwright/test';
import { uniqueEmail, signUpViaUI, logInViaUI, E2E_PASSWORD } from './helpers';
import { RETURNING_PARENT } from './setup/admin';

test.describe('Sign up', () => {
  test('new parent can create an account and lands on the parent dashboard', async ({ page }) => {
    const email = uniqueEmail('auth.signup');
    await signUpViaUI(page, { name: 'Sam Newparent', email });

    await expect(page).toHaveURL(/\/parent\/dashboard/);
    await expect(page.getByText(/Welcome back, Sam/)).toBeVisible({ timeout: 30_000 });
  });

  test('signing up with an already-registered email shows a friendly error', async ({ page }) => {
    await page.goto('/signup?sport=baseball');
    await page.getByLabel('Full Name').fill('Duplicate Person');
    await page.getByLabel('Email').fill(RETURNING_PARENT.email);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // .first(): toast text also lands in a screen-reader live region
    await expect(
      page.getByText('An account with this email already exists. Try logging in instead.').first()
    ).toBeVisible({ timeout: 15_000 });
    // Still on the signup page — no navigation happened
    await expect(page).toHaveURL(/\/signup/);
  });
});

test.describe('Log in', () => {
  test('login with correct credentials reaches the dashboard', async ({ page }) => {
    await logInViaUI(page, RETURNING_PARENT.email);
    await expect(page).toHaveURL(/\/parent\/dashboard/);
    await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 30_000 });
  });

  test('login with a wrong password shows a friendly error', async ({ page }) => {
    await page.goto('/login?sport=baseball');
    await page.getByLabel('Email').fill(RETURNING_PARENT.email);
    await page.getByLabel('Password').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // .first(): toast text also lands in a screen-reader live region
    await expect(
      page.getByText('Invalid email or password. Please try again.').first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Password reset', () => {
  test('requesting a reset link shows a confirmation screen', async ({ page }) => {
    await page.goto('/login?sport=baseball');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    await page.getByLabel('Email').fill(RETURNING_PARENT.email);
    await page.getByRole('button', { name: 'Send Reset Link' }).click();

    await expect(page.getByText('Check your email')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(RETURNING_PARENT.email)).toBeVisible();
  });
});

test.describe('Session persistence', () => {
  test('a logged-in parent stays logged in after a page refresh', async ({ page }) => {
    await logInViaUI(page, RETURNING_PARENT.email);
    await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 30_000 });

    await page.reload();

    // Still authenticated — dashboard renders, no bounce to /login
    await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/parent\/dashboard/);
  });
});
