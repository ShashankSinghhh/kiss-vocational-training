import { test, expect } from '@playwright/test';
import { ACCOUNTS, ADMIN_PASSWORD, expectNoSeriousA11yViolations, signIn } from './helpers';
import { token } from './world';

test.describe('Sprint 12: Odia and Hindi (F16, BRQ-16.1)', () => {
  test('the login page is fully in Odia, with the Odia font loaded on demand', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('language-switcher').selectOption('or');
    await expect(page.getByRole('heading', { level: 1, name: 'ସାଇନ୍ ଇନ୍ କରନ୍ତୁ' })).toBeVisible();
    await expect(page.getByLabel('ଇମେଲ୍')).toBeVisible();
    // The Noto Sans Oriya face is registered only after choosing Odia.
    await expect
      .poll(() =>
        page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Noto Sans Oriya'))),
      )
      .toBe(true);
    await expectNoSeriousA11yViolations(page);
  });

  test("a student's language is saved to their profile and follows them to another device", async ({
    browser,
    request,
  }) => {
    const s = Date.now().toString(36);
    const admin = await token(request, ACCOUNTS.ADMIN, ADMIN_PASSWORD);
    const student = {
      email: `e2e-lang-${s}@kiss-vtmp.test`,
      password: 'E2e-Lang-Pass1',
      fullName: `Bhasha ${s}`,
    };
    const created = await request.post('/api/v1/admin/users', {
      headers: { Authorization: admin },
      data: { role: 'STUDENT', ...student, rollNo: `LG-${s}`, cgpa: 7.5 },
    });
    expect(created.ok()).toBeTruthy();

    // Device 1: sign in in English, switch to Hindi.
    const first = await browser.newContext();
    const p1 = await first.newPage();
    await signIn(p1, student.email, student.password);
    await p1.getByTestId('language-switcher').selectOption('hi');
    await expect(p1.getByRole('heading', { level: 1 })).toContainText('स्वागत है');
    await first.close();

    // Device 2 (nothing remembered locally): after sign-in the profile's Hindi is applied.
    const second = await browser.newContext();
    const p2 = await second.newPage();
    await signIn(p2, student.email, student.password);
    await expect(p2.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(p2.getByRole('heading', { level: 1 })).toContainText('स्वागत है');
    await second.close();
  });
});
