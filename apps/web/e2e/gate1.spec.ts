import {
  test,
  expect as baseExpect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD, expectNoSeriousA11yViolations, signIn } from './helpers';
import { addCoTrainer, token } from './world';

// The longest journey in the suite: pages load lazily, and on the dev server (or a cold
// serverless start) the first visit to a page can take a few seconds.
const expect = baseExpect.configure({ timeout: 20_000 });

/**
 * Only the raw material is made through the API: a course, a cycle, a batch (three days ago to
 * yesterday, so its sessions have happened) and a student account. Every workflow step after
 * that goes through the UI, by the role that owns it.
 */
async function rawMaterial(request: APIRequestContext) {
  const h = { headers: { Authorization: await token(request, ACCOUNTS.ADMIN, SEED_PASSWORD) } };
  const s = Date.now().toString(36);
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const ok = async <T>(res: Promise<APIResponse>): Promise<T> => {
    const r = await res;
    expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text()}`).toBeTruthy();
    return (await r.json()) as T;
  };
  const cycle = await ok<{ id: string; name: string }>(
    request.post('/api/v1/admin/cycles', {
      ...h,
      data: { name: `Gate 1 ${s}`, startsOn: day(-10), endsOn: day(60) },
    }),
  );
  const course = await ok<{ id: string; title: string }>(
    request.post('/api/v1/admin/courses', {
      ...h,
      data: {
        code: `G1-${s}`.slice(0, 20),
        title: `Motor rewinding ${s}`,
        description: 'Gate 1 end-to-end course.',
        durationWeeks: 4,
        seatCapacity: 10,
      },
    }),
  );
  const batch = await ok<{ id: string; name: string }>(
    request.post('/api/v1/admin/batches', {
      ...h,
      data: {
        courseId: course.id,
        cycleId: cycle.id,
        name: 'Gate batch',
        capacity: 3,
        startDate: day(-3),
        endDate: day(-1),
        venue: `Workshop G ${s}`,
      },
    }),
  );
  const student = {
    email: `e2e-gate-${s}@kiss-vtmp.test`,
    password: 'E2e-Gate1-Pass1',
    fullName: `Gate Student ${s}`,
    rollNo: `G1-${s}`,
  };
  await ok(
    request.post('/api/v1/admin/users', {
      ...h,
      data: { role: 'STUDENT', ...student, cgpa: 8.2 },
    }),
  );
  return { cycle, course, batch, student };
}

const toast = (page: Page, text: string | RegExp) =>
  expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();

test.describe('GATE 1: Release 1 workflow end to end', () => {
  test('window → apply → approve → allocate → train → complete → certificate and report', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const { cycle, course, batch, student } = await rawMaterial(request);
    const batchLabel = `${course.title} · ${batch.name}`;

    // 1. Admin opens the enrollment window for the course in the cycle (BRQ-2.3).
    await signIn(page, ACCOUNTS.ADMIN);
    await page.goto('/admin/courses');
    await page.getByLabel('Cycle', { exact: true }).selectOption({ label: cycle.name });
    await page.getByRole('button', { name: `Enrollment window: ${course.title}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(page, 'Window saved');

    // 2. The student applies for it (BRQ-3.1).
    const studentContext = await browser.newContext();
    const sp = await studentContext.newPage();
    await signIn(sp, student.email, student.password);
    await sp.goto(`/student/courses?cycle=${cycle.id}`);
    await sp.getByRole('link', { name: new RegExp(`^Apply.*: ${course.title}$`) }).click();
    await sp.getByRole('button', { name: 'Submit application' }).click();
    await expect(sp).toHaveURL('/student/enrollment');
    await expect(
      sp.getByTestId('enrollment-card').getByText('Pending review').first(),
    ).toBeVisible();

    // 3. Admin approves it (BRQ-3.3).
    await page.goto('/admin/enrollments');
    await page.getByLabel('Cycle', { exact: true }).selectOption({ label: cycle.name });
    await page.getByLabel('Search by student name, email or roll number').fill(student.rollNo);
    await page.getByRole('button', { name: `Approve ${student.fullName}` }).click();
    await toast(page, '1 application approved');

    // 4. Allocation preview → confirm (BRQ-4.2).
    await page.goto('/admin/batches/allocation');
    await page.getByLabel('Cycle').selectOption(cycle.id);
    await page.getByRole('button', { name: 'Run preview' }).click();
    await expect(page.getByTestId('stat-allocated')).toHaveText('1');
    await page.getByRole('button', { name: 'Confirm allocation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm allocation' }).click();
    await toast(page, 'Allocation confirmed: 1 placed, 0 waitlisted');

    // 5. Trainer, sessions (default Mon/Wed/Fri over the batch dates), activation (BRQ-4.3).
    await page.goto(`/admin/batches/${batch.id}`);
    await page.getByRole('tab', { name: 'Trainers' }).click();
    await page
      .getByLabel('Trainer', { exact: true })
      .selectOption({ label: 'Sushant Mohanty — Electrical installation' });
    await page.getByRole('button', { name: 'Assign trainer' }).click();
    await toast(page, 'Trainer assigned');
    // Many test batches share the seeded trainer at these times (see addCoTrainer).
    await addCoTrainer(request, batch.id);
    await page.reload();
    await page.getByRole('tab', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: 'Schedule sessions' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(page, /sessions? scheduled/);
    await page.getByRole('button', { name: 'Activate batch' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Activate batch' }).click();
    await toast(page, 'Batch activated');

    // 6. Trainer marks every session (BRQ-5.1), enters marks (BRQ-6.2) and evaluates (BRQ-6.3).
    const trainerContext = await browser.newContext();
    const tp = await trainerContext.newPage();
    await signIn(tp, ACCOUNTS.TRAINER);
    await tp.goto('/trainer/sessions');
    const take = tp.getByRole('link', { name: new RegExp(`^Take attendance for ${batchLabel}`) });
    await expect(take.first()).toBeVisible();
    let marked = 0;
    while ((await take.count()) > 0) {
      await take.first().click();
      await tp.getByRole('button', { name: 'Mark all present' }).click();
      await tp.getByRole('button', { name: 'Save attendance' }).click();
      await toast(tp, 'Attendance saved');
      marked++;
      await tp.goto('/trainer/sessions');
      await expect(tp.getByRole('heading', { level: 1 })).toHaveText('Sessions');
    }
    expect(marked).toBeGreaterThanOrEqual(1);

    await tp.goto(`/trainer/assessments?batch=${batch.id}`);
    await tp.getByRole('button', { name: 'Add assessment' }).click();
    const form = tp.getByRole('dialog');
    await form.getByLabel('Title').fill('Rewinding practical');
    await form.getByLabel('Type').selectOption('PRACTICAL');
    await form.getByLabel('Maximum marks').fill('50');
    await form.getByLabel('Weightage').fill('1');
    await form.getByRole('button', { name: 'Save' }).click();
    await toast(tp, 'Assessment saved');
    await tp.getByRole('link', { name: 'Enter marks for Rewinding practical' }).click();
    await tp.getByLabel(`Marks for ${student.fullName}`, { exact: true }).fill('46');
    await tp.getByRole('button', { name: 'Save marks' }).click();
    await toast(tp, 'Marks saved');

    await tp.goto(`/trainer/batches/${batch.id}`);
    await tp.getByRole('tab', { name: 'Evaluations' }).click();
    await tp.getByRole('button', { name: `Evaluate ${student.fullName}` }).click();
    await tp.getByRole('dialog').getByLabel('Remarks').fill('Rewinds motors safely and neatly.');
    await tp.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(tp, 'Evaluation saved');
    await trainerContext.close();

    // 7. Admin approves completion: all four BR-09 checks pass (BRQ-7.1, 7.2).
    await page.goto(`/admin/completions?batch=${batch.id}`);
    const row = page
      .getByRole('table', { name: 'Completion queue' })
      .getByRole('row', { name: new RegExp(student.fullName) });
    await expect(row).toContainText('Attendance 100.00 %');
    await expect(row).toContainText('Aggregate 92.00 %');
    await page.getByRole('button', { name: `Approve completion for ${student.fullName}` }).click();
    await toast(page, `${student.fullName} completed: certificate`);
    await expect(row).toContainText('Certified');

    // The admin dashboard reflects it (BRQ-9.1, 9.2).
    await page.goto('/admin');
    await expect(page.getByTestId('tile-completion')).toBeVisible();
    await expect(page.getByTestId('chart-trend')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // 8. The student downloads the certificate and the performance report (BRQ-7.2, 8.1).
    await sp.goto('/student');
    const figures = sp.getByTestId('student-figures');
    await expect(figures).toContainText('Certified');
    await expect(figures).toContainText('92.00 %');
    const card = sp.getByTestId('certificate-card');
    await expect(card).toContainText('Grade A');
    const [certificate] = await Promise.all([
      sp.waitForEvent('download'),
      card.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(certificate.suggestedFilename()).toMatch(/^certificate-[0-9A-HJKMNP-TV-Z]{16}\.pdf$/);
    const [report] = await Promise.all([
      sp.waitForEvent('download'),
      figures.getByRole('button', { name: 'Download performance report' }).click(),
    ]);
    expect(report.suggestedFilename()).toBe(
      `performance-report-${student.rollNo.toLowerCase()}.pdf`,
    );
    await expectNoSeriousA11yViolations(sp);
    await studentContext.close();
  });
});
