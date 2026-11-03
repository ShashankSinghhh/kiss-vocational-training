import { PrismaClient } from '@prisma/client';
import { runSeed } from '../apps/api/src/seed';
import { resetSeedPasswords, unlockAdmins } from '../apps/api/src/seed/resetPasswords';

/**
 * Usage:
 *   pnpm db:seed                      clean starting data (idempotent; fills in what is missing)
 *   pnpm db:seed --reset-passwords    set SEED_PASSWORD on every seeded account; with
 *                                     SEED_ADMIN_PASSWORD, the admins get that one instead
 *   pnpm db:seed --unlock-admins      unlock every locked admin account (passwords unchanged)
 */
async function main() {
  const prisma = new PrismaClient();
  const started = Date.now();
  const log = (m: string) => console.log(`  ${m}`);
  try {
    if (process.argv.includes('--reset-passwords')) {
      const password = process.env.SEED_PASSWORD;
      // Refuse the documented default: resetting a public demo to it would undo the point.
      if (!password || password === 'Password@123') {
        throw new Error('Set SEED_PASSWORD to the new demo password (not the default).');
      }
      const adminPassword = process.env.SEED_ADMIN_PASSWORD || undefined;
      if (adminPassword === 'Password@123') {
        throw new Error('Set SEED_ADMIN_PASSWORD to a new admin password (not the default).');
      }
      if (!adminPassword) {
        log('note: SEED_ADMIN_PASSWORD is not set, so the admins get the demo password too');
      }
      await resetSeedPasswords(prisma, password, log, adminPassword);
    } else if (process.argv.includes('--unlock-admins')) {
      await unlockAdmins(prisma, log);
    } else {
      await runSeed(prisma, { log });
    }
    console.log(`Seed complete in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
