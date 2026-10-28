import { test, expect as baseExpect } from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD, expectNoSeriousA11yViolations, signIn } from './helpers';
import { setupActiveBatch, token } from './world';

const expect = baseExpect.configure({ timeout: 15_000 });

test.describe('Sprint 10: early intervention and the audit log', () => {
  test('marking an absence flags the student; the trainer agrees an action; the student sees it; the admin finds it in the audit log', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(150_000);
    const world = await setupActiveBatch(request);
    const [absent, present] = world.students;
    const T = { headers: { Authorization: await token(request, ACCOUNTS.TRAINER, SEED_PASSWORD) } };

    // The trainer marks the first session: one student absent (0 % attendance → High risk).
    const sessions = (await (
      await request.get(`/api/v1/batches/${world.batch.id}/sessions`, T)
    ).json()) as Array<{ id: string }>;
    const sheet = (await (
      await request.get(`/api/v1/sessions/${sessions[0]!.id}/attendance`, T)
    ).json()) as { rows: Array<{ studentId: string; fullName: string }> };
    const res = await request.put(`/api/v1/sessions/${sessions[0]!.id}/attendance`, {
      ...T,
      data: {
        entries: sheet.rows.map((r) => ({
          studentId: r.studentId,
          status: r.fullName === absent!.fullName ? 'ABSENT' : 'PRESENT',
        })),
      },
    });
    expect(res.ok()).toBeTruthy();

    // Trainer: the flag is there at once, with its reason (BRQ-11.1, 11.2).
    await signIn(page, ACCOUNTS.TRAINER);
    await page.getByRole('link', { name: 'At-risk students' }).first().click();
    await page.getByLabel('Batch').selectOption({ label: `${world.course.title} · Evening` });
    const link = page.getByRole('link', { name: `Open the flag for ${absent!.fullName}` });
    await expect(link).toBeVisible();
    await expect(
      page.getByRole('link', { name: `Open the flag for ${present!.fullName}` }),
    ).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: absent!.fullName })).toBeVisible();
    await expect(page.getByText('Attendance 0 % (below 75 %)').first()).toBeVisible();

    // Agree an extra session (BRQ-11.3).
    await page.getByRole('button', { name: 'Add action' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type').selectOption('EXTRA_SESSION');
    await dialog.getByLabel('Owner').selectOption({ label: 'Sushant Mohanty (Trainer)' });
    await dialog.getByLabel('Note (staff only)').fill('Staff-only note about the student');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Action recorded' })).toBeVisible();
    await expect(page.getByTestId('flag-timeline')).toContainText('Action agreed: Extra session');
    await expectNoSeriousA11yViolations(page);

    // Student: a supportive card with the agreed plan and no staff note (BRQ-11.5).
    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    await signIn(student, absent!.email, absent!.password);
    const card = student.getByTestId('my-risk-card');
    await expect(card).toContainText("Let's get you back on track");
    await expect(card).toContainText('Extra session with Sushant Mohanty');
    await expect(card).not.toContainText('Staff-only');
    await expect(card).not.toContainText('risk');
    await expectNoSeriousA11yViolations(student);
    await studentContext.close();

    // Admin: the audit log shows the flag being opened by the system and the action by the trainer.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, ACCOUNTS.ADMIN);
    await admin.goto('/admin/audit');
    await admin.getByLabel('Action').selectOption('INTERVENTION_ACTION_CREATED');
    const row = admin.getByRole('row').filter({ hasText: 'INTERVENTION_ACTION_CREATED' }).first();
    await expect(row).toContainText('Sushant Mohanty');
    await row.getByRole('button', { name: 'Show changes' }).click();
    await expect(admin.getByText('EXTRA_SESSION').first()).toBeVisible();
    await expectNoSeriousA11yViolations(admin);
    await adminContext.close();
  });
});
