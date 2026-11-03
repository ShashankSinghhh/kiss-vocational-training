import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

/**
 * Screenshots for the user guide, taken on a freshly seeded database (vtmp_docs). The clean
 * seed has no training activity, so this retakes the screens it can show with real data:
 * the public pages, choosing a cycle, programme and course, and the admin's course setup.
 * Screens that need a running batch (attendance, marks, certificates, passport) keep the
 * images taken on the earlier pilot data.
 */
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'screenshots');
const PASSWORD = 'Password@123'; // the local seed password; this runs on vtmp_docs only
const ADMIN = 'admin@kiss-vtmp.test';
const TRAINER = 'trainer1@kiss-vtmp.test';
const STUDENT = 'student001@kiss-vtmp.test';

test.describe.configure({ mode: 'serial' });
mkdirSync(OUT, { recursive: true });

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** Opens a page, waits until it has settled, and saves a JPEG for the guide. */
async function shot(page: Page, name: string, path?: string) {
  if (path) await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 70 });
}

test('public pages', async ({ page }) => {
  await shot(page, 'public-home', '/');
  await page.screenshot({
    path: join(OUT, 'public-home-full.jpg'),
    type: 'jpeg',
    quality: 70,
    fullPage: true,
  });
  await shot(page, 'public-login', '/login');
});

test('student', async ({ page }) => {
  await signIn(page, STUDENT);
  await shot(page, 'student-dashboard', '/student');
  await page.goto('/student/courses');
  await page.getByLabel('Training cycle').selectOption({ index: 1 });
  await expect(page.getByRole('heading', { name: 'Choose a programme' })).toBeVisible();
  await shot(page, 'student-courses');
  await page.getByRole('button', { name: /^Computer & Digital Skills/ }).click();
  await expect(page.getByRole('heading', { name: 'Computer Training' })).toBeVisible();
  await shot(page, 'student-programme-courses');
  await page.getByRole('link', { name: 'Apply: Computer Training' }).click();
  await shot(page, 'student-apply');
});

test('trainer', async ({ page }) => {
  await signIn(page, TRAINER);
  await shot(page, 'trainer-dashboard', '/trainer');
});

test('admin', async ({ page }) => {
  await signIn(page, ADMIN);
  await shot(page, 'admin-dashboard', '/admin');
  await shot(page, 'admin-courses', '/admin/courses');
  await shot(page, 'admin-batches', '/admin/batches');
});

test('phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, STUDENT);
  await page.goto('/student/courses');
  await page.getByLabel('Training cycle').selectOption({ index: 1 });
  await shot(page, 'phone-student-courses');
});
