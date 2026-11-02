import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Seeded dev/CI accounts (see README). Never real credentials. */
export const SEED_PASSWORD = process.env.E2E_PASSWORD ?? 'Password@123';
/** The admin's own password when the demo seeds one (SEED_ADMIN_PASSWORD); else the shared one. */
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || SEED_PASSWORD;
export const ACCOUNTS = {
  ADMIN: 'admin@kiss-vtmp.test',
  TRAINER: 'trainer1@kiss-vtmp.test',
  STUDENT: 'student001@kiss-vtmp.test',
} as const;

// Against a deployed site, never fall back to the documented default password: every failed
// attempt counts toward the 5-failure account lockout on the live demo accounts.
if (process.env.E2E_BASE_URL && !process.env.E2E_PASSWORD) {
  throw new Error('E2E_PASSWORD must be set when E2E_BASE_URL points at a deployed site');
}

/**
 * Signs in through the login form. By default it waits until the app leaves /login and, if the
 * form shows an error instead, fails with that message (e.g. wrong password vs account locked)
 * so CI logs say why. The password itself is never printed.
 */
export async function signIn(
  page: Page,
  email: string,
  password = email === ACCOUNTS.ADMIN ? ADMIN_PASSWORD : SEED_PASSWORD,
  { expectSuccess = true }: { expectSuccess?: boolean } = {},
) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (!expectSuccess) return;

  // Generous timeout: on the deployed site the first request may hit a cold function.
  const leftLogin = await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    .then(
      () => true,
      () => false,
    );
  if (!leftLogin) {
    const alert = page.getByRole('alert');
    const reason = (await alert.isVisible())
      ? await alert.innerText()
      : 'no error shown, still on /login';
    throw new Error(`Sign-in failed for ${email}: ${reason}`);
  }
}

export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}
