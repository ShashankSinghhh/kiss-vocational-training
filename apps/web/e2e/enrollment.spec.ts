import { test, expect, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD, expectNoSeriousA11yViolations, signIn } from './helpers';

/** Creates a fresh student through the admin API, so the flow can run again and again. */
async function newStudent(request: APIRequestContext) {
  const login = await request.post('/api/v1/auth/login', {
    data: { email: ACCOUNTS.ADMIN, password: SEED_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const student = {
    role: 'STUDENT',
    email: `e2e-apply-${s}@kiss-vtmp.test`,
    fullName: `Applicant ${s}`,
    password: 'E2e-Apply-Pass1',
    rollNo: `E2E-${s}`.slice(0, 40),
    cgpa: 7.9,
  };
  const res = await request.post('/api/v1/admin/users', {
    data: student,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.status()).toBe(201);
  return student;
}

test.describe('Sprint 3: apply → approve → see APPROVED', () => {
  test('a student applies, the admin approves, the student sees it at once', async ({
    page,
    browser,
    request,
  }) => {
    const student = await newStudent(request);

    // Student: browse the catalogue and apply for the first open course.
    await signIn(page, student.email, student.password);
    await page.getByRole('link', { name: 'Courses' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Courses');
    // No cycle is chosen for the student: they pick it themselves.
    const cycle = page.getByLabel('Training cycle');
    await expect(cycle).toHaveValue('');
    await expect(page.getByText('Choose a training cycle to see its courses')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Apply:/ })).toHaveCount(0);
    // L7: cycles taking applications come first and say so.
    await expect(cycle.locator('option').nth(1)).toContainText('applications open');
    await cycle.selectOption({ index: 1 });
    await expect(page).toHaveURL(/[?&]cycle=/);
    const cycleId = new URL(page.url()).searchParams.get('cycle');
    await expectNoSeriousA11yViolations(page);
    await page
      .getByRole('link', { name: /^Apply:/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Apply for training');
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(page).toHaveURL('/student/enrollment');
    const card = page.getByTestId('enrollment-card');
    await expect(card.getByText('Pending review').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Courses: the applied course says so, and no course offers a second application.
    await page.goto(`/student/courses?cycle=${cycleId}`);
    const applied = page.getByTestId('applied-badge');
    await expect(applied).toHaveCount(1);
    await expect(applied).toContainText('Applied · choice 1');
    await expect(applied).toContainText('Pending review');
    await expect(page.getByRole('link', { name: /^Apply:/ })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await page
      .getByRole('link', { name: /^View my application:/ })
      .first()
      .click();
    await expect(page).toHaveURL('/student/enrollment');

    // Admin: find the application and approve it.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, ACCOUNTS.ADMIN);
    await admin.getByRole('link', { name: 'Enrollments' }).first().click();
    await admin.getByLabel('Search by student name, email or roll number').fill(student.rollNo);
    await admin.getByRole('button', { name: `Approve ${student.fullName}` }).click();
    await expect(
      admin.getByRole('status').filter({ hasText: '1 application approved' }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(admin);
    await adminContext.close();

    // Student: the next page load shows APPROVED (BO-4) and an unread notification.
    await page.reload();
    await expect(card.getByText('Approved').first()).toBeVisible();
    await expect(page.getByTestId('notification-bell')).toContainText('1');
    await page.getByTestId('notification-bell').click();
    await expect(page.getByText('Application approved')).toBeVisible();
  });

  test('the student can change preferences and withdraw while pending', async ({
    page,
    request,
  }) => {
    const student = await newStudent(request);
    await signIn(page, student.email, student.password);
    // Without a chosen cycle the apply page sends the student to choose one.
    await page.goto('/student/enrollment/apply');
    await expect(page.getByRole('link', { name: 'Go to Courses' })).toBeVisible();
    await page.goto('/student/courses');
    await page.getByLabel('Training cycle').selectOption({ index: 1 });
    const cycleId = new URL(page.url()).searchParams.get('cycle');
    await page.goto(`/student/enrollment/apply?cycle=${cycleId}`);
    // Nothing chosen yet: submitting must explain why it can't go through.
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByRole('alert')).toHaveText('Choose at least one course');
    await page.getByLabel('Choice 1', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page).toHaveURL('/student/enrollment');

    await page.getByRole('link', { name: 'Change preferences' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Change your preferences');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page).toHaveURL('/student/enrollment');

    await page.getByRole('button', { name: 'Withdraw application' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByTestId('enrollment-card').getByText('Withdrawn').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Apply again' })).toBeVisible();
  });

  test('admin courses & cycles page is accessible and lists the seeded courses', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.ADMIN);
    await page.goto('/admin/courses');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Courses & cycles');
    await expect(page.getByRole('cell', { name: 'Solar PV Installer' }).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('admin tidies the course list: bulk deactivate, then delete an unused course', async ({
    page,
    request,
  }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: { email: ACCOUNTS.ADMIN, password: SEED_PASSWORD },
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const title = `Tidy ${s}`;
    for (const n of [1, 2]) {
      const res = await request.post('/api/v1/admin/courses', {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: {
          code: `T${n}-${s}`.slice(0, 20),
          title: `${title} ${n}`,
          description: 'Created by the clean-up test.',
          durationWeeks: 2,
          seatCapacity: 5,
        },
      });
      expect(res.status()).toBe(201);
    }

    await signIn(page, ACCOUNTS.ADMIN);
    await page.goto('/admin/courses');
    // The cycles table below lists active courses too, so look only at the courses table.
    const courses = page.getByRole('region', { name: 'All courses' });
    await page.getByLabel('Search by title or code').fill(title);
    await expect(courses.getByRole('row', { name: new RegExp(title) })).toHaveCount(2);
    await page.getByLabel('Select all courses shown').check();
    await expect(page.getByText('2 courses selected')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Deactivate selected' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '2 courses deactivated' }),
    ).toBeVisible();
    await expect(courses.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);

    await page.getByLabel('Status').selectOption({ label: 'Inactive courses' });
    await expect(courses.getByRole('row', { name: new RegExp(title) })).toHaveCount(2);
    await page.getByRole('button', { name: `Delete: ${title} 1` }).click();
    await page
      .getByRole('dialog', { name: `Delete ${title} 1?` })
      .getByRole('button', { name: 'Delete course' })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: `${title} 1 was deleted` }),
    ).toBeVisible();
    await expect(courses.getByRole('row', { name: new RegExp(title) })).toHaveCount(1);
  });
});
