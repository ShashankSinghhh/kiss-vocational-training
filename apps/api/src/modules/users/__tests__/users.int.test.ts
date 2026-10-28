import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import {
  createBatch,
  createLoginUser,
  createOpenCycle,
  TEST_PASSWORD,
  uid,
} from '../../../../test/fixtures';
import { bearer, cookie, login } from '../../../../test/http';

// Fresh app per test: each has its own in-memory rate-limit store.
let app = createApp();
beforeEach(() => {
  app = createApp();
});
afterAll(() => disconnectPrisma());

async function signedIn(role: Role) {
  const user = await createLoginUser(prisma(), role);
  const session = await login(app, user.email);
  return { user, ...session };
}

describe('role-based access to /admin/users (TC-15)', () => {
  it('returns 401 without a token', async () => {
    expect((await request(app).get('/api/v1/admin/users')).status).toBe(401);
  });

  it.each([Role.STUDENT, Role.TRAINER])('returns 403 for a %s', async (role) => {
    const { accessToken } = await signedIn(role);
    const res = await request(app).get('/api/v1/admin/users').set(bearer(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for a student trying to create an admin', async () => {
    const { accessToken } = await signedIn(Role.STUDENT);
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(accessToken))
      .send({
        role: 'ADMIN',
        email: `x-${uid()}@test.local`,
        fullName: 'Evil',
        password: 'Password1!',
      });
    expect(res.status).toBe(403);
  });
});

describe('admin user management', () => {
  it('lists with search and pagination meta', async () => {
    const { accessToken } = await signedIn(Role.ADMIN);
    const target = await createLoginUser(prisma(), Role.STUDENT);
    const res = await request(app)
      .get('/api/v1/admin/users')
      .query({ q: target.student!.rollNo, pageSize: 5 })
      .set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
    expect(res.body.data[0]).toMatchObject({ id: target.id, rollNo: target.student!.rollNo });
    expect(res.body.data[0]).not.toHaveProperty('passwordHash');
  });

  it('rejects pageSize above 100', async () => {
    const { accessToken } = await signedIn(Role.ADMIN);
    const res = await request(app).get('/api/v1/admin/users?pageSize=101').set(bearer(accessToken));
    expect(res.status).toBe(422);
  });

  it('creates a student who can then sign in, and audits it without the password', async () => {
    const { accessToken } = await signedIn(Role.ADMIN);
    const s = uid();
    const body = {
      role: 'STUDENT',
      email: `new-${s}@test.local`,
      fullName: 'New Student',
      password: 'Initial-Pass-9',
      rollNo: `R-${s}`,
      cgpa: 7.25,
    };
    const res = await request(app).post('/api/v1/admin/users').set(bearer(accessToken)).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: 'STUDENT', rollNo: `R-${s}`, isActive: true });

    expect((await login(app, body.email, body.password)).res.status).toBe(200);
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'USER_CREATED', entityId: res.body.id },
    });
    expect(JSON.stringify(audit.newValue)).not.toContain('Initial-Pass-9');
  });

  it('requires role-specific fields', async () => {
    const { accessToken } = await signedIn(Role.ADMIN);
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(accessToken))
      .send({
        role: 'TRAINER',
        email: `t-${uid()}@test.local`,
        fullName: 'No Code',
        password: 'Password-123',
      });
    expect(res.status).toBe(422);
  });

  it('returns 409 for a duplicate email or roll number', async () => {
    const { accessToken } = await signedIn(Role.ADMIN);
    const existing = await createLoginUser(prisma(), Role.STUDENT);
    const base = { role: 'STUDENT', fullName: 'Dup', password: 'Password-123', cgpa: 6 };

    const dupEmail = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(accessToken))
      .send({ ...base, email: existing.email, rollNo: `R-${uid()}` });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');

    const dupRoll = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(accessToken))
      .send({ ...base, email: `d-${uid()}@test.local`, rollNo: existing.student!.rollNo });
    expect(dupRoll.status).toBe(409);
    expect(dupRoll.body.error.code).toBe('ROLL_NO_TAKEN');
  });

  it('deactivates a user: sessions revoked, login refused, change audited', async () => {
    const admin = await signedIn(Role.ADMIN);
    const victim = await signedIn(Role.TRAINER);

    const res = await request(app)
      .patch(`/api/v1/admin/users/${victim.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookie(victim.refreshToken!))).status,
    ).toBe(401);
    expect((await login(app, victim.user.email)).res.status).toBe(401);
    expect(
      await prisma().auditLog.count({
        where: { action: 'USER_DEACTIVATED', entityId: victim.user.id },
      }),
    ).toBe(1);

    const back = await request(app)
      .patch(`/api/v1/admin/users/${victim.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: true });
    expect(back.status).toBe(200);
    expect((await login(app, victim.user.email)).res.status).toBe(200);
  });

  it('does not let an admin deactivate themselves', async () => {
    const admin = await signedIn(Role.ADMIN);
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('returns 404 for an unknown user', async () => {
    const admin = await signedIn(Role.ADMIN);
    const res = await request(app)
      .patch('/api/v1/admin/users/00000000-0000-4000-8000-000000000000')
      .set(bearer(admin.accessToken))
      .send({ fullName: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

describe('admin user clean-up', () => {
  it('deactivates several users at once: sessions revoked, each change audited', async () => {
    const admin = await signedIn(Role.ADMIN);
    const a = await signedIn(Role.STUDENT);
    const b = await createLoginUser(prisma(), Role.TRAINER);
    const res = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set(bearer(admin.accessToken))
      .send({ ids: [a.user.id, b.id], isActive: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(
      await prisma().refreshToken.count({ where: { userId: a.user.id, revokedAt: null } }),
    ).toBe(0);
    expect(
      await prisma().auditLog.count({
        where: { action: 'USER_DEACTIVATED', entityId: { in: [a.user.id, b.id] } },
      }),
    ).toBe(2);
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: a.user.email, password: TEST_PASSWORD });
    expect(relogin.status).toBe(401);

    const back = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set(bearer(admin.accessToken))
      .send({ ids: [a.user.id, b.id], isActive: true });
    expect(back.body).toEqual({ updated: 2 });
  });

  it('refuses a bulk deactivation that includes the admin themselves', async () => {
    const admin = await signedIn(Role.ADMIN);
    const other = await createLoginUser(prisma(), Role.STUDENT);
    const res = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set(bearer(admin.accessToken))
      .send({ ids: [other.id, admin.user.id], isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
    expect((await prisma().user.findUniqueOrThrow({ where: { id: other.id } })).isActive).toBe(
      true,
    );
  });

  it('deletes an account with no history and audits it', async () => {
    const admin = await signedIn(Role.ADMIN);
    const created = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        role: 'STUDENT',
        email: `mistake-${uid()}@test.local`,
        fullName: 'Created By Mistake',
        password: 'Mistake-Pass-1',
        rollNo: `M-${uid()}`,
        cgpa: 7,
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const del = await request(app)
      .delete(`/api/v1/admin/users/${id}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(204);
    expect(await prisma().user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma().student.findFirst({ where: { userId: id } })).toBeNull();
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'USER_DELETED', entityId: id },
    });
    expect(audit.userId).toBe(admin.user.id);
    expect(JSON.stringify(audit.oldValue)).not.toMatch(/password/i);
  });

  it('refuses to delete an account with history, or the admin themselves', async () => {
    const admin = await signedIn(Role.ADMIN);
    // The admin has acted (created a user), so their audit rows keep them.
    const other = await signedIn(Role.ADMIN);
    await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(other.accessToken))
      .send({
        role: 'TRAINER',
        email: `t-${uid()}@test.local`,
        fullName: 'Some Trainer',
        password: 'Trainer-Pass-1',
        employeeCode: `E-${uid()}`,
      });
    const inUse = await request(app)
      .delete(`/api/v1/admin/users/${other.user.id}`)
      .set(bearer(admin.accessToken));
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('USER_IN_USE');
    expect(await prisma().user.findUnique({ where: { id: other.user.id } })).not.toBeNull();

    const self = await request(app)
      .delete(`/api/v1/admin/users/${admin.user.id}`)
      .set(bearer(admin.accessToken));
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('CANNOT_DELETE_SELF');
  });

  it('refuses to delete a user whose decisions would otherwise be erased', async () => {
    const admin = await signedIn(Role.ADMIN);
    const decider = await createLoginUser(prisma(), Role.ADMIN);
    const { cycle } = await createOpenCycle(prisma(), 1);
    const student = await createLoginUser(prisma(), Role.STUDENT);
    // Written straight to the table: no audit row, so only the SET NULL reference holds it.
    await prisma().enrollment.create({
      data: {
        studentId: student.student!.id,
        cycleId: cycle.id,
        status: 'APPROVED',
        decidedById: decider.id,
        decidedAt: new Date(),
      },
    });
    const res = await request(app)
      .delete(`/api/v1/admin/users/${decider.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_IN_USE');
  });
});

describe('admin password reset', () => {
  it('sets a new password: old one stops working, sessions end, lock cleared, audited', async () => {
    const admin = await signedIn(Role.ADMIN);
    const target = await signedIn(Role.STUDENT);
    await prisma().user.update({
      where: { id: target.user.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) },
    });
    const res = await request(app)
      .post(`/api/v1/admin/users/${target.user.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ password: 'Fresh-Start-9' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.user.id, lockedUntil: null });
    expect(JSON.stringify(res.body)).not.toMatch(/Fresh-Start-9|passwordHash/);

    expect(
      await prisma().refreshToken.count({ where: { userId: target.user.id, revokedAt: null } }),
    ).toBe(0);
    const old = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: target.user.email, password: TEST_PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: target.user.email, password: 'Fresh-Start-9' });
    expect(fresh.status).toBe(200);

    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'USER_PASSWORD_RESET', entityId: target.user.id },
    });
    expect(audit.userId).toBe(admin.user.id);
    expect(JSON.stringify(audit)).not.toMatch(/Fresh-Start-9/);
  });

  it('refuses short passwords, the admin themselves, unknown users and non-admins', async () => {
    const admin = await signedIn(Role.ADMIN);
    const target = await createLoginUser(prisma(), Role.TRAINER);
    const path = `/api/v1/admin/users/${target.id}/password`;
    const short = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .send({ password: 'short' });
    expect(short.status).toBe(422);
    const self = await request(app)
      .post(`/api/v1/admin/users/${admin.user.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ password: 'Fresh-Start-9' });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('CANNOT_RESET_OWN_PASSWORD');
    const unknown = await request(app)
      .post('/api/v1/admin/users/00000000-0000-4000-8000-000000000000/password')
      .set(bearer(admin.accessToken))
      .send({ password: 'Fresh-Start-9' });
    expect(unknown.status).toBe(404);
    const student = await signedIn(Role.STUDENT);
    const forbidden = await request(app)
      .post(path)
      .set(bearer(student.accessToken))
      .send({ password: 'Fresh-Start-9' });
    expect(forbidden.status).toBe(403);
  });
});

describe('password set by an admin must be changed (A3) and unlocking (A2)', () => {
  it('a new account asked to change its password can do nothing else until it does', async () => {
    const admin = await signedIn(Role.ADMIN);
    const email = `first-${uid()}@test.local`;
    const created = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        role: 'STUDENT',
        email,
        fullName: 'First Timer',
        password: 'Office-Gave-1',
        rollNo: `F-${uid()}`,
        cgpa: 7,
        mustChangePassword: true,
      });
    expect(created.status).toBe(201);
    const session = await login(app, email, 'Office-Gave-1');
    const auth = bearer(session.accessToken);

    const me = await request(app).get('/api/v1/auth/me').set(auth);
    expect(me.body.mustChangePassword).toBe(true);
    expect((await request(app).get('/api/v1/notifications/me').set(auth)).status).toBe(200);
    const blocked = await request(app).get('/api/v1/dashboard/student').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app)
      .post('/api/v1/users/me/password')
      .set(auth)
      .send({ currentPassword: 'Office-Gave-1', newPassword: 'My-Own-Pass-2' });
    expect(changed.status).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set(auth)).body.mustChangePassword).toBe(
      false,
    );
    expect((await request(app).get('/api/v1/dashboard/student').set(auth)).status).toBe(200);
  });

  it('a reset asks for a new password by default, unless the admin says not to', async () => {
    const admin = await signedIn(Role.ADMIN);
    const a = await createLoginUser(prisma(), Role.STUDENT);
    const b = await createLoginUser(prisma(), Role.STUDENT);
    await request(app)
      .post(`/api/v1/admin/users/${a.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ password: 'Fresh-Start-9' })
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/users/${b.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ password: 'Fresh-Start-9', mustChangePassword: false })
      .expect(200);
    const flags = await prisma().user.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, mustChangePassword: true },
    });
    expect(flags.find((u) => u.id === a.id)!.mustChangePassword).toBe(true);
    expect(flags.find((u) => u.id === b.id)!.mustChangePassword).toBe(false);
  });

  it('unlocks a locked account at once and audits it', async () => {
    const admin = await signedIn(Role.ADMIN);
    const target = await createLoginUser(prisma(), Role.TRAINER);
    await prisma().user.update({
      where: { id: target.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) },
    });
    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: TEST_PASSWORD });
    expect(locked.status).toBe(401);

    const res = await request(app)
      .post(`/api/v1/admin/users/${target.id}/unlock`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.lockedUntil).toBeNull();
    const ok = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: TEST_PASSWORD });
    expect(ok.status).toBe(200);
    expect(
      await prisma().auditLog.count({ where: { action: 'USER_UNLOCKED', entityId: target.id } }),
    ).toBe(1);
  });
});

describe('deactivating a trainer a batch still needs (D3)', () => {
  it('refuses while they are the only trainer of a planned batch, allows once another is assigned', async () => {
    const admin = await signedIn(Role.ADMIN);
    const only = await createLoginUser(prisma(), Role.TRAINER);
    const other = await createLoginUser(prisma(), Role.TRAINER);
    const { cycle, courses } = await createOpenCycle(prisma(), 1);
    const batch = await createBatch(prisma(), cycle.id, courses[0]!.id, 10);
    await prisma().trainerAssignment.create({
      data: { batchId: batch.id, trainerId: only.trainer!.id },
    });

    const single = await request(app)
      .patch(`/api/v1/admin/users/${only.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false });
    expect(single.status).toBe(409);
    expect(single.body.error.code).toBe('TRAINER_STILL_NEEDED');
    expect(single.body.error.details[0].message).toContain(batch.name);
    const bulk = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set(bearer(admin.accessToken))
      .send({ ids: [only.id], isActive: false });
    expect(bulk.status).toBe(409);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: only.id } })).isActive).toBe(true);

    await prisma().trainerAssignment.create({
      data: { batchId: batch.id, trainerId: other.trainer!.id },
    });
    const ok = await request(app)
      .patch(`/api/v1/admin/users/${only.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false });
    expect(ok.status).toBe(200);
  });
});

describe('PATCH /users/me (BRQ-1.3)', () => {
  it('updates name, locale and phone', async () => {
    const { accessToken, user } = await signedIn(Role.STUDENT);
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ fullName: 'Renamed Student', locale: 'or', phone: '9437000000' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fullName: 'Renamed Student',
      locale: 'or',
      student: { phone: '9437000000' },
    });
    expect(
      await prisma().auditLog.count({
        where: { action: 'USER_PROFILE_UPDATED', entityId: user.id },
      }),
    ).toBe(1);
  });

  it('refuses attempts to change role or email (privilege escalation)', async () => {
    const { accessToken } = await signedIn(Role.STUDENT);
    for (const body of [{ role: 'ADMIN' }, { email: 'boss@test.local' }]) {
      const res = await request(app).patch('/api/v1/users/me').set(bearer(accessToken)).send(body);
      expect(res.status).toBe(422);
    }
  });
});

describe('POST /users/me/password', () => {
  it('rejects a wrong current password', async () => {
    const { accessToken } = await signedIn(Role.STUDENT);
    const res = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'wrong', newPassword: 'Brand-New-Pass-1' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const { accessToken } = await signedIn(Role.STUDENT);
    const res = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(422);
  });

  it('rejects passwords without both a letter and a digit (A4)', async () => {
    const { accessToken } = await signedIn(Role.STUDENT);
    for (const newPassword of ['aaaaaaaa', '12345678', '!!!!!!!!']) {
      const res = await request(app)
        .post('/api/v1/users/me/password')
        .set(bearer(accessToken))
        .send({ currentPassword: TEST_PASSWORD, newPassword });
      expect(res.status).toBe(422);
    }
    const ok = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'ପାସୱାର୍ଡ2026' });
    expect(ok.status).toBe(204);
  });

  it('changes the password and signs out other sessions only', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const here = await login(app, user.email);
    const elsewhere = await login(app, user.email);

    const res = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(here.accessToken))
      .set(cookie(here.refreshToken!))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Brand-New-Pass-1' });
    expect(res.status).toBe(204);

    expect((await login(app, user.email)).res.status).toBe(401);
    expect((await login(app, user.email, 'Brand-New-Pass-1')).res.status).toBe(200);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookie(here.refreshToken!))).status,
    ).toBe(200);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookie(elsewhere.refreshToken!))).status,
    ).toBe(401);
  });
});
