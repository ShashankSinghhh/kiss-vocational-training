import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshots for docs/USER_GUIDE.md and docs/internal/DEMO.md, taken on a freshly seeded database so
 * they show demo data only (never test leftovers). Not part of CI.
 *
 *   createdb vtmp_docs, then migrate and seed it with DATABASE_URL pointing at it
 *   pnpm --filter @vtmp/web docs:screens
 */
const DOCS_DB =
  process.env.DOCS_DATABASE_URL ?? 'postgresql://vtmp:vtmp@localhost:5432/vtmp_docs?schema=public';

export default defineConfig({
  testDir: './docs-screens',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  projects: [
    { name: 'docs', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @vtmp/api dev',
      cwd: '../..',
      env: { DATABASE_URL: DOCS_DB, GLOBAL_RATE_LIMIT_PER_15MIN: '50000' },
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
