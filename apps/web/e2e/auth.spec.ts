import { test, expect } from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD, expectNoSeriousA11yViolations, signIn } from './helpers';

const DASHBOARD = { ADMIN: '/admin', TRAINER: '/trainer', STUDENT: '/student' } as const;

test.describe('sign in (BRQ-1.1, BRQ-1.2)', () => {
  for (const role of ['ADMIN', 'TRAINER', 'STUDENT'] as const) {
    test(`${role.toLowerCase()} lands on their own dashboard`, async ({ page }) => {
      await signIn(page, ACCOUNTS[role]);
      await expect(page).toHaveURL(DASHBOARD[role]);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome,');
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('wrong password shows a generic error', async ({ page }) => {
    await signIn(page, ACCOUNTS.STUDENT, 'not-the-password', { expectSuccess: false });
    await expect(page.getByRole('alert')).toHaveText(/^Wrong email or password/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('empty form shows field errors without calling the API', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Enter your password')).toBeVisible();
  });

  test('a student cannot open admin pages', async ({ page }) => {
    await signIn(page, ACCOUNTS.STUDENT);
    await expect(page).toHaveURL('/student');
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "You don't have access to this page",
    );
    await page.getByRole('link', { name: 'Go to my dashboard' }).click();
    await expect(page).toHaveURL('/student');
  });

  test('returns to the requested page after signing in', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile/);
    await page.getByLabel('Email').fill(ACCOUNTS.TRAINER);
    await page.getByLabel('Password').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/profile');
  });

  test('the session survives a reload and ends on sign out', async ({ page }) => {
    await signIn(page, ACCOUNTS.TRAINER);
    await expect(page).toHaveURL('/trainer');
    await page.reload();
    await expect(page).toHaveURL('/trainer');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome,');

    await page
      .getByRole('button', { expanded: false })
      .filter({ hasText: /Trainer/ })
      .click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/trainer');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('admin user management', () => {
  test('admin creates a student who can then sign in, and deactivates them', async ({
    page,
    browser,
  }) => {
    const suffix = Date.now().toString(36);
    const email = `e2e-${suffix}@kiss-vtmp.test`;

    await signIn(page, ACCOUNTS.ADMIN);
    await page.getByRole('link', { name: 'Users' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Users');
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user' });
    await dialog.getByLabel('Full name').fill('E2E Student');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Initial password').fill('E2e-Start-Pass1');
    await dialog.getByLabel('Roll number').fill(`E2E-${suffix}`);
    await dialog.getByLabel('CGPA').fill('7.4');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'E2E Student was added' }),
    ).toBeVisible();

    // The new account works in a separate browser context, after choosing its own password.
    const other = await browser.newContext();
    const studentPage = await other.newPage();
    await signIn(studentPage, email, 'E2e-Start-Pass1', { expectSuccess: false });
    await expect(studentPage).toHaveURL('/profile/password');
    await expect(studentPage.getByRole('status')).toContainText('set by the training office');
    await studentPage.goto('/student/courses');
    await expect(studentPage).toHaveURL('/profile/password');
    await studentPage.getByLabel('Current password').fill('E2e-Start-Pass1');
    await studentPage.getByLabel(/^New password/).fill('E2e-Own-Pass-3');
    await studentPage.getByLabel('Confirm new password').fill('E2e-Own-Pass-3');
    await studentPage.getByRole('button', { name: 'Change password' }).click();
    await expect(studentPage).toHaveURL('/student');
    await other.close();

    await page.getByLabel('Search by name, email, roll number or employee code').fill(email);
    const row = page.getByRole('row', { name: /E2E Student/ });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: /Deactivate/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'E2E Student was deactivated' }),
    ).toBeVisible();
    // The list shows active accounts by default, so the account moves to the Inactive filter.
    await expect(row).toHaveCount(0);
    await page.getByLabel('Status').selectOption({ label: 'Inactive' });
    await expect(row.getByText('Inactive')).toBeVisible();

    // The device remembers the filter on the next visit.
    await page.reload();
    await expect(page.getByLabel('Status')).toHaveValue('false');
    await page.getByLabel('Status').selectOption({ label: 'Active' });
  });

  test('admin resets a forgotten password; only the new one works', async ({ page, browser }) => {
    const suffix = Date.now().toString(36);
    const email = `e2e-forgot-${suffix}@kiss-vtmp.test`;
    await signIn(page, ACCOUNTS.ADMIN);
    await page.getByRole('link', { name: 'Users' }).first().click();
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user' });
    await dialog.getByLabel('Full name').fill('Forgetful Student');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Initial password').fill('E2e-Start-Pass1');
    await dialog.getByLabel('Roll number').fill(`FGT-${suffix}`);
    await dialog.getByLabel('CGPA').fill('7.1');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel('Search by name, email, roll number or employee code').fill(email);
    const row = page.getByRole('row', { name: /Forgetful Student/ });
    await row.getByRole('button', { name: 'Reset password: Forgetful Student' }).click();
    const reset = page.getByRole('dialog', { name: 'Reset the password for Forgetful Student?' });
    await reset.getByLabel('New password').fill('short');
    await reset.getByRole('button', { name: 'Set new password' }).click();
    await expect(reset.getByText('Use at least 8 characters')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await reset.getByLabel('New password').fill('E2e-Fresh-Pass2');
    await reset.getByRole('button', { name: 'Set new password' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'New password set for Forgetful Student' }),
    ).toBeVisible();

    const other = await browser.newContext();
    const studentPage = await other.newPage();
    await signIn(studentPage, email, 'E2e-Fresh-Pass2', { expectSuccess: false });
    await expect(studentPage).toHaveURL('/profile/password');
    await other.close();
  });

  test('admin deletes an account created by mistake', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const email = `e2e-mistake-${suffix}@kiss-vtmp.test`;
    await signIn(page, ACCOUNTS.ADMIN);
    await page.getByRole('link', { name: 'Users' }).first().click();
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user' });
    await dialog.getByLabel('Full name').fill('Mistaken Entry');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Initial password').fill('E2e-Start-Pass1');
    await dialog.getByLabel('Roll number').fill(`DEL-${suffix}`);
    await dialog.getByLabel('CGPA').fill('6.5');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel('Search by name, email, roll number or employee code').fill(email);
    const row = page.getByRole('row', { name: /Mistaken Entry/ });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Delete: Mistaken Entry' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Mistaken Entry?' });
    await expectNoSeriousA11yViolations(page);
    await confirm.getByRole('button', { name: 'Delete account' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Mistaken Entry was deleted' }),
    ).toBeVisible();
    await page.getByLabel('Status').selectOption({ label: 'Any status' });
    await expect(row).toHaveCount(0);

    // An account with history is kept: the seeded trainer can only be deactivated.
    await page
      .getByLabel('Search by name, email, roll number or employee code')
      .fill(ACCOUNTS.TRAINER);
    const trainer = page.getByRole('row').filter({ hasText: ACCOUNTS.TRAINER });
    await expect(trainer).toHaveCount(1);
    await trainer.getByRole('button', { name: /^Delete:/ }).click();
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'cannot be deleted. Deactivate it instead.' }),
    ).toBeVisible();
    await expect(trainer).toHaveCount(1);
  });
});
