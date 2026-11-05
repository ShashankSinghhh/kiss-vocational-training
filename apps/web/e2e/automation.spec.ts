import { test, expect } from '@playwright/test';
import { ACCOUNTS, expectNoSeriousA11yViolations, signIn } from './helpers';

test.describe('Round 2 automation (A1–A9)', () => {
  test('the admin changes an automation setting and runs the daily jobs now', async ({ page }) => {
    await signIn(page, ACCOUNTS.ADMIN);
    await page.getByRole('link', { name: 'Automation' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automation');
    await expectNoSeriousA11yViolations(page);

    // A setting saves (and is put back afterwards).
    const days = page.getByLabel('Days after the end date');
    await days.fill('95');
    await expect(page.getByText('Enter a number from 0 to 90.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await days.fill('10');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Automation settings saved' }),
    ).toBeVisible();
    await days.fill('7');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByLabel('Days after the end date')).toHaveValue('7');

    // Run now: every step is listed with what it did.
    await page.getByRole('button', { name: 'Run now' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: /The daily run finished|A run is already going/ }),
    ).toBeVisible();
    const steps = page.getByRole('table', { name: 'What the last run did' });
    await expect(steps.getByText('Finished batches closed')).toBeVisible();
    await expect(steps.getByText('Notices to students')).toBeVisible();
  });

  test('the admin imports students from a CSV after checking it (A5)', async ({ page }) => {
    const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await signIn(page, ACCOUNTS.ADMIN);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Import students' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import students from a CSV file' });
    const upload = (csv: string) =>
      dialog.getByLabel('CSV file').setInputFiles({
        name: 'students.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
    await dialog.getByLabel('First password for every student').fill('Welcome2026');

    // A file with a problem is reported by line, and nothing can be imported.
    await upload(`email,fullName,rollNo\nbad-email,Sabita Minz,IMP-${s}-0\n`);
    await dialog.getByRole('button', { name: 'Check file' }).click();
    await expect(
      dialog.getByText('0 rows are ready and 1 have problems.', { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText('email is not valid')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // A clean file is checked, then imported.
    await upload(
      [
        'email,fullName,rollNo',
        `imp-${s}-1@kiss-vtmp.test,Rinki Toppo,IMP-${s}-1`,
        `imp-${s}-2@kiss-vtmp.test,Sudam Lakra,IMP-${s}-2`,
      ].join('\n'),
    );
    await dialog.getByRole('button', { name: 'Check file' }).click();
    await expect(dialog.getByText('2 students are ready to import.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Import 2 students' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 students imported' })).toBeVisible();
    await page.getByLabel('Search by name, email, roll number or employee code').fill(`IMP-${s}`);
    await expect(page.getByText('Rinki Toppo')).toBeVisible();
  });
});
