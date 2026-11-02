import { Role } from '@prisma/client';
import { createApp } from '../../app';
import { hashPassword } from '../../core/auth';
import { disconnectPrisma, prisma } from '../../core/db';
import { createLoginUser, uid } from '../../../test/fixtures';
import { login } from '../../../test/http';
import { resetSeedPasswords, unlockAdmins } from '../resetPasswords';

afterAll(() => disconnectPrisma());

describe('seed --reset-passwords', () => {
  it('resets seeded accounts only, unlocks them, signs them out and audits it', async () => {
    const app = createApp();
    const seeded = await prisma().user.create({
      data: {
        email: `seed-${uid()}@kiss-vtmp.test`,
        fullName: 'Seeded Trainer',
        role: Role.TRAINER,
        passwordHash: await hashPassword('Old-Demo-Pass-1'),
        failedLoginCount: 3,
        lockedUntil: new Date(Date.now() + 60_000),
      },
    });
    const real = await createLoginUser(prisma(), Role.STUDENT); // @test.local, not seeded
    const realBefore = await prisma().user.findUniqueOrThrow({ where: { id: real.id } });
    await prisma().refreshToken.create({
      data: {
        userId: seeded.id,
        tokenHash: `test-${uid()}`,
        familyId: '00000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const count = await resetSeedPasswords(prisma(), 'Fresh-Demo-Pass-2');
    expect(count).toBeGreaterThanOrEqual(1);

    expect((await login(app, seeded.email, 'Old-Demo-Pass-1')).res.status).toBe(401);
    expect((await login(app, seeded.email, 'Fresh-Demo-Pass-2')).res.status).toBe(200);
    const realAfter = await prisma().user.findUniqueOrThrow({ where: { id: real.id } });
    expect(realAfter.passwordHash).toBe(realBefore.passwordHash);

    expect(
      await prisma().refreshToken.count({
        where: { userId: seeded.id, tokenHash: { startsWith: 'test-' }, revokedAt: null },
      }),
    ).toBe(0);
    const entry = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'USER_PASSWORD_RESET', entityId: seeded.id },
    });
    expect(JSON.stringify(entry)).not.toContain('Fresh-Demo-Pass-2');
    // Response status already proves the unlock; double-check the columns.
    const row = await prisma().user.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.lockedUntil).toBeNull();
  });

  it('rejects passwords shorter than 8 characters', async () => {
    await expect(resetSeedPasswords(prisma(), 'short')).rejects.toThrow(/8/);
  });

  it('gives seeded admins their own password when one is passed (security review, low)', async () => {
    const app = createApp();
    const make = (role: Role) =>
      prisma().user.create({
        data: {
          email: `seed-${role.toLowerCase()}-${uid()}@kiss-vtmp.test`,
          fullName: `Seeded ${role}`,
          role,
          passwordHash: 'x',
        },
      });
    const admin = await make(Role.ADMIN);
    const trainer = await make(Role.TRAINER);

    await resetSeedPasswords(prisma(), 'Shared-Demo-Pass-3', undefined, 'Admin-Only-Pass-4');

    expect((await login(app, admin.email, 'Shared-Demo-Pass-3')).res.status).toBe(401);
    expect((await login(app, admin.email, 'Admin-Only-Pass-4')).res.status).toBe(200);
    expect((await login(app, trainer.email, 'Shared-Demo-Pass-3')).res.status).toBe(200);
    expect((await login(app, trainer.email, 'Admin-Only-Pass-4')).res.status).toBe(401);
    await expect(
      resetSeedPasswords(prisma(), 'Same-Pass-55', undefined, 'Same-Pass-55'),
    ).rejects.toThrow(/differ/);
  });
});

describe('seed --unlock-admins (security review, low)', () => {
  it('unlocks locked admins only, without touching passwords, and audits it', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60_000);
    const admin = await createLoginUser(prisma(), Role.ADMIN);
    const student = await createLoginUser(prisma(), Role.STUDENT);
    await prisma().user.updateMany({
      where: { id: { in: [admin.id, student.id] } },
      data: { lockedUntil, failedLoginCount: 0 },
    });

    expect(await unlockAdmins(prisma())).toBeGreaterThanOrEqual(1);

    const a = await prisma().user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(a.lockedUntil).toBeNull();
    expect(a.passwordHash).toBe(admin.passwordHash);
    expect((await login(createApp(), admin.email)).res.status).toBe(200);
    const s = await prisma().user.findUniqueOrThrow({ where: { id: student.id } });
    expect(s.lockedUntil).not.toBeNull();
    expect(
      await prisma().auditLog.count({
        where: { action: 'USER_UNLOCKED', entityId: admin.id, userId: null },
      }),
    ).toBe(1);
  });
});
