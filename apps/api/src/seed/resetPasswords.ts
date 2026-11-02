import bcrypt from 'bcrypt';
import { Role, type PrismaClient } from '@prisma/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@vtmp/shared';
import { audit } from '../core/audit';
import { EMAIL_DOMAIN } from './data';

const BCRYPT_COST = 12;

function checkLength(password: string, what: string) {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`${what} must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`);
  }
}

/**
 * Sets one new password on every seeded account (emails @kiss-vtmp.test: admin, trainers,
 * students), clears login locks and signs those accounts out everywhere. With `adminPassword`,
 * the seeded admins get that one instead, so the demo password shared with examiners doesn't
 * open the admin account. Each change is audit-logged in the same transaction. Accounts with
 * real emails are never touched.
 */
export async function resetSeedPasswords(
  prisma: PrismaClient,
  password: string,
  log: (message: string) => void = () => undefined,
  adminPassword?: string,
): Promise<number> {
  checkLength(password, 'The new password');
  if (adminPassword !== undefined) {
    checkLength(adminPassword, 'The admin password');
    if (adminPassword === password) {
      throw new Error('The admin password must differ from the demo password');
    }
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const adminHash = adminPassword ? await bcrypt.hash(adminPassword, BCRYPT_COST) : passwordHash;
  const where = { email: { endsWith: `@${EMAIL_DOMAIN}` } };

  const count = await prisma.$transaction(
    async (tx) => {
      const users = await tx.user.findMany({ where, select: { id: true, role: true } });
      const admins = users.filter((u) => u.role === Role.ADMIN).map((u) => u.id);
      const others = users.filter((u) => u.role !== Role.ADMIN).map((u) => u.id);
      const reset = { failedLoginCount: 0, lockedUntil: null };
      await tx.user.updateMany({
        where: { id: { in: others } },
        data: { passwordHash, ...reset },
      });
      await tx.user.updateMany({
        where: { id: { in: admins } },
        data: { passwordHash: adminHash, ...reset },
      });
      const ids = users.map((u) => u.id);
      await tx.refreshToken.updateMany({
        where: { userId: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // System action (no acting user). Never log password material.
      for (const u of users) {
        await audit.record(tx, {
          userId: null,
          action: 'USER_PASSWORD_RESET',
          entity: 'User',
          entityId: u.id,
          newValue: {
            by: 'seed --reset-passwords',
            ...(adminPassword && u.role === Role.ADMIN ? { separateAdminPassword: true } : {}),
          },
        });
      }
      return ids.length;
    },
    { timeout: 60_000 },
  );
  log(
    `passwords reset: ${count} seeded accounts (signed out everywhere)` +
      (adminPassword ? '; admins got the separate admin password' : ''),
  );
  return count;
}

/**
 * Unlocks every locked admin account, seeded or real (`pnpm db:seed --unlock-admins`). Anyone
 * who knows an admin's email can lock it with wrong passwords (auth.maxFailedLogins), and the
 * only person who can press Unlock in the portal is another admin, so the owner needs a way in
 * that doesn't wait for the lock to expire. Passwords and sessions are left alone; each unlock
 * is audited.
 */
export async function unlockAdmins(
  prisma: PrismaClient,
  log: (message: string) => void = () => undefined,
): Promise<number> {
  const count = await prisma.$transaction(async (tx) => {
    const locked = await tx.user.findMany({
      where: {
        role: Role.ADMIN,
        OR: [{ lockedUntil: { gt: new Date() } }, { failedLoginCount: { gt: 0 } }],
      },
      select: { id: true, lockedUntil: true, failedLoginCount: true },
    });
    for (const u of locked) {
      await tx.user.update({
        where: { id: u.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await audit.record(tx, {
        userId: null,
        action: 'USER_UNLOCKED',
        entity: 'User',
        entityId: u.id,
        oldValue: {
          lockedUntil: u.lockedUntil?.toISOString() ?? null,
          failedLoginCount: u.failedLoginCount,
        },
        newValue: { by: 'seed --unlock-admins' },
      });
    }
    return locked.length;
  });
  log(`admins unlocked: ${count}`);
  return count;
}
