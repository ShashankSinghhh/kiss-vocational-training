import { test, expect, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD, expectNoSeriousA11yViolations, signIn } from './helpers';
import { addCoTrainer, setupActiveBatch } from './world';

async function token(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('/api/v1/auth/login', { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return `Bearer ${((await res.json()) as { accessToken: string }).accessToken}`;
}

/**
 * Builds an isolated world through the API: a cycle, a course offered with an open window,
 * a batch with 2 seats and 3 approved applicants, so allocation places 2 and waitlists 1.
 */
async function setup(request: APIRequestContext) {
  const admin = await token(request, ACCOUNTS.ADMIN, SEED_PASSWORD);
  const h = { headers: { Authorization: admin } };
  const s = Date.now().toString(36);
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  const cycle = await (
    await request.post('/api/v1/admin/cycles', {
      ...h,
      data: { name: `E2E cycle ${s}`, startsOn: day(7), endsOn: day(90) },
    })
  ).json();
  const course = await (
    await request.post('/api/v1/admin/courses', {
      ...h,
      data: {
        code: `E2E-${s}`.slice(0, 20),
        title: `Welding ${s}`,
        description: 'Arc welding for e2e tests.',
        durationWeeks: 8,
        seatCapacity: 20,
      },
    })
  ).json();
  await request.put(`/api/v1/admin/cycles/${cycle.id}/offerings/${course.id}`, {
    ...h,
    data: {
      enrollmentOpensAt: new Date(Date.now() - 3_600_000).toISOString(),
      enrollmentClosesAt: new Date(Date.now() + 86_400_000).toISOString(),
      isOpen: true,
    },
  });
  const batch = await (
    await request.post('/api/v1/admin/batches', {
      ...h,
      data: {
        courseId: course.id,
        cycleId: cycle.id,
        name: 'Morning',
        capacity: 2,
        startDate: day(7),
        endDate: day(60),
        venue: `Workshop B ${s}`,
      },
    })
  ).json();

  const students = [];
  for (let i = 0; i < 3; i++) {
    const student = {
      email: `e2e-alloc-${s}-${i}@kiss-vtmp.test`,
      password: 'E2e-Alloc-Pass1',
      fullName: `Allocatee ${s} ${i}`,
    };
    const created = await request.post('/api/v1/admin/users', {
      ...h,
      data: { role: 'STUDENT', ...student, rollNo: `AL-${s}-${i}`, cgpa: 7 + i / 10 },
    });
    expect(created.status()).toBe(201);
    const auth = await token(request, student.email, student.password);
    const applied = await request.post('/api/v1/enrollments', {
      headers: { Authorization: auth },
      data: { cycleId: cycle.id, courseIds: [course.id] },
    });
    expect(applied.status()).toBe(201);
    const enrollment = await applied.json();
    expect(
      (await request.post(`/api/v1/admin/enrollments/${enrollment.id}/approve`, h)).ok(),
    ).toBeTruthy();
    students.push(student);
  }
  return { cycle, course, batch, students };
}

test.describe('Sprint 4: allocate → trainer sees roster', () => {
  test('admin previews and confirms allocation, sets up and activates the batch; trainer and student see it', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const { cycle, course, batch, students } = await setup(request);

    // Admin: preview, check numbers, confirm.
    await signIn(page, ACCOUNTS.ADMIN);
    await page.goto('/admin/batches/allocation');
    await page.getByLabel('Cycle').selectOption(cycle.id);
    await page.getByRole('button', { name: 'Run preview' }).click();
    await expect(page.getByText('This is a preview: nothing has changed yet.')).toBeVisible();
    await expect(page.getByTestId('stat-allocated')).toHaveText('2');
    await expect(page.getByTestId('stat-waitlisted')).toHaveText('1');
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Confirm allocation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm allocation' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Allocation confirmed: 2 placed, 1 waitlisted' }),
    ).toBeVisible();

    // Admin: open the batch, assign a trainer, schedule sessions, activate.
    await page.goto(`/admin/batches/${batch.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Morning');
    await expect(
      page.getByRole('table', { name: 'Students in this batch' }).getByRole('row'),
    ).toHaveCount(3);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('tab', { name: 'Trainers' }).click();
    await page
      .getByLabel('Trainer', { exact: true })
      .selectOption({ label: 'Sushant Mohanty — Electrical installation' });
    await page.getByRole('button', { name: 'Assign trainer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Trainer assigned' })).toBeVisible();

    // Many test batches share the seeded trainer at these times (see addCoTrainer).
    await addCoTrainer(request, batch.id);
    await page.reload();
    await page.getByRole('tab', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: 'Schedule sessions' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: /sessions scheduled/ })).toBeVisible();
    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByRole('table', { name: /^Sessions:/ })).toBeVisible();

    await page.getByRole('button', { name: 'Activate batch' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Activate batch' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Batch activated' })).toBeVisible();

    // Trainer: sees the batch and its roster.
    const trainerContext = await browser.newContext();
    const trainer = await trainerContext.newPage();
    await signIn(trainer, ACCOUNTS.TRAINER);
    await trainer.getByRole('link', { name: 'My batches' }).first().click();
    await trainer.getByRole('link', { name: `${course.title} · Morning` }).click();
    await expect(
      trainer.getByRole('table', { name: 'Students in this batch' }).getByRole('row'),
    ).toHaveCount(3);
    await expectNoSeriousA11yViolations(trainer);
    await trainerContext.close();

    // A placed student sees their batch on the dashboard.
    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    // Default priority rule is submission time, so the first applicant has a seat.
    await signIn(student, students[0]!.email, students[0]!.password);
    const card = student.getByTestId('student-batch-card');
    await expect(card).toContainText(`${course.title} · Morning`);
    await expect(card).toContainText('Sushant Mohanty');
    await expect(card).toContainText('Workshop B');
    await studentContext.close();
  });
});

test.describe('Round 2: a student leaves, then the batch is closed (L4, L1)', () => {
  test('admin withdraws a student mid-training and closes the batch once it is over', async ({
    page,
    request,
  }) => {
    const { batch, students, adminAuth } = await setupActiveBatch(request);
    const [leaver, stayer] = students as [(typeof students)[0], (typeof students)[0]];
    const headers = { Authorization: adminAuth };

    await signIn(page, ACCOUNTS.ADMIN);
    await page.goto(`/admin/batches/${batch.id}`);

    // Not yet: the end date is ahead and both students are still in training.
    await page.getByRole('button', { name: 'Close batch' }).click();
    const closing = page.getByRole('dialog', { name: 'Close Evening?' });
    await expect(closing.getByText(/can be closed after its end date/)).toBeVisible();
    await expect(closing.getByText('2 students still need a completion decision:')).toBeVisible();
    await expect(closing.getByRole('button', { name: 'Close batch' })).toBeDisabled();
    await expectNoSeriousA11yViolations(page);
    await closing.getByRole('button', { name: 'Cancel' }).click();

    // A student leaves: a reason is required, then the row says Withdrawn.
    await page.getByRole('button', { name: `Withdraw ${leaver.fullName}` }).click();
    const withdrawing = page.getByRole('dialog', {
      name: `Withdraw ${leaver.fullName} from training?`,
    });
    await withdrawing.getByRole('button', { name: 'Withdraw' }).click();
    await expect(withdrawing.getByText('Give a reason of at least 3 characters.')).toBeVisible();
    await withdrawing.getByLabel('Reason').fill('Moved to another district');
    await expectNoSeriousA11yViolations(page);
    await withdrawing.getByRole('button', { name: 'Withdraw' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `${leaver.fullName} was withdrawn` }),
    ).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(leaver.fullName) });
    await expect(row.getByText('Withdrawn')).toBeVisible();
    await expect(page.getByRole('button', { name: `Withdraw ${leaver.fullName}` })).toHaveCount(0);

    // Training is over and the other student has a decision: now it closes.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const ended = await request.patch(`/api/v1/admin/batches/${batch.id}`, {
      headers,
      data: { endDate: yesterday },
    });
    expect(ended.ok(), await ended.text()).toBeTruthy();
    const decided = await request.post(`/api/v1/completions/${stayer.enrollmentId}/not-completed`, {
      headers,
      data: { reason: 'Did not finish the practical' },
    });
    expect(decided.ok(), await decided.text()).toBeTruthy();

    await page.reload();
    await page.getByRole('button', { name: 'Close batch' }).click();
    await page
      .getByRole('dialog', { name: 'Close Evening?' })
      .getByRole('button', { name: 'Close batch' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Batch closed' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Closed');
    await expect(page.getByRole('button', { name: 'Close batch' })).toHaveCount(0);
  });
});
