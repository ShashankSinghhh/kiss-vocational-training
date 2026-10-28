import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createLoginUser, TEST_PASSWORD } from '../../../../test/fixtures';
import { bearer, cookie, login, rawSetCookie } from '../../../../test/http';

// Fresh app per test: each has its own in-memory rate-limit store.
let app = createApp();
beforeEach(() => {
  app = createApp();
});
afterAll(() => disconnectPrisma());

describe('POST /auth/login (TC-01)', () => {
  it('signs in, returns an access token and sets an httpOnly SameSite=Strict refresh cookie', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const { res, accessToken, refreshToken } = await login(app, user.email);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      expiresIn: 900,
      user: { id: user.id, role: 'STUDENT', student: { rollNo: user.student!.rollNo } },
    });
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));
    const setCookie = rawSetCookie(res);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
    // The refresh token must never appear in the JSON body.
    expect(JSON.stringify(res.body)).not.toContain(refreshToken!);
  });

  it('treats email case-insensitively', async () => {
    const user = await createLoginUser(prisma(), Role.TRAINER);
    const { res } = await login(app, user.email.toUpperCase());
    expect(res.status).toBe(200);
  });

  it('gives the same generic error for wrong password, unknown email and inactive account', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const inactive = await createLoginUser(prisma(), Role.STUDENT, { isActive: false });

    const wrong = await login(app, user.email, 'wrong-password');
    const unknown = await login(app, 'nobody@test.local');
    const disabled = await login(app, inactive.email);

    for (const { res } of [wrong, unknown, disabled]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: expect.stringContaining('Invalid email or password'),
      });
    }
  });

  it('locks the account after 5 failures, even for the right password (TC-02)', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    for (let i = 0; i < 4; i++) {
      expect((await login(app, user.email, 'nope')).res.status).toBe(401);
    }
    // Fifth failure triggers the lock.
    expect((await login(app, user.email, 'nope')).res.status).toBe(401);

    // Locked: even the right password gets the same answer as an unknown email (A5).
    const locked = await login(app, user.email, TEST_PASSWORD);
    expect(locked.res.status).toBe(401);
    expect(locked.res.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await login(app, `nobody-${user.email}`, TEST_PASSWORD);
    expect(unknown.res.body).toEqual(locked.res.body);

    const row = await prisma().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(
      await prisma().auditLog.count({ where: { action: 'USER_LOCKED', entityId: user.id } }),
    ).toBe(1);
  });

  it('resets the failure count after a successful login', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    for (let i = 0; i < 4; i++) await login(app, user.email, 'nope');
    expect((await login(app, user.email)).res.status).toBe(200);
    for (let i = 0; i < 4; i++) await login(app, user.email, 'nope');
    expect((await login(app, user.email)).res.status).toBe(200);
  });

  it('rejects malformed input with 422', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });
});

describe('access tokens', () => {
  it('GET /auth/me returns the signed-in user', async () => {
    const user = await createLoginUser(prisma(), Role.TRAINER);
    const { accessToken } = await login(app, user.email);
    const res = await request(app).get('/api/v1/auth/me').set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      role: 'TRAINER',
      trainer: { id: user.trainer!.id },
    });
  });

  it('rejects a missing token with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an expired token with 401 TOKEN_EXPIRED', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const expired = jwt.sign({ role: 'STUDENT' }, process.env.JWT_SECRET!, {
      subject: user.id,
      issuer: 'kiss-vtmp',
      audience: 'kiss-vtmp-web',
      expiresIn: -10,
    });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects forged and unsigned tokens', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const forged = jwt.sign({ role: 'ADMIN' }, 'some-other-secret-that-is-long-enough!', {
      subject: user.id,
      issuer: 'kiss-vtmp',
      audience: 'kiss-vtmp-web',
    });
    const unsigned = jwt.sign({ role: 'ADMIN', sub: user.id }, '', { algorithm: 'none' });
    for (const token of [forged, unsigned, 'garbage']) {
      const res = await request(app).get('/api/v1/auth/me').set(bearer(token));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    }
  });

  it('stops accepting a token as soon as the account is deactivated', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const { accessToken } = await login(app, user.email);
    await prisma().user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(accessToken));
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const first = await login(app, user.email);

    const res = await request(app).post('/api/v1/auth/refresh').set(cookie(first.refreshToken!));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    const next = /vtmp_rt=([^;]+)/.exec(rawSetCookie(res))![1];
    expect(next).not.toBe(first.refreshToken);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const first = await login(app, user.email);
    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .set(cookie(first.refreshToken!));
    const second = /vtmp_rt=([^;]+)/.exec(rawSetCookie(rotated))![1]!;

    const reuse = await request(app).post('/api/v1/auth/refresh').set(cookie(first.refreshToken!));
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate newer token is now dead too.
    const after = await request(app).post('/api/v1/auth/refresh').set(cookie(second));
    expect(after.status).toBe(401);
  });

  it('leaves other login sessions alone when one family is revoked', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const phone = await login(app, user.email);
    const laptop = await login(app, user.email);
    await request(app).post('/api/v1/auth/refresh').set(cookie(phone.refreshToken!));
    await request(app).post('/api/v1/auth/refresh').set(cookie(phone.refreshToken!)); // reuse
    const res = await request(app).post('/api/v1/auth/refresh').set(cookie(laptop.refreshToken!));
    expect(res.status).toBe(200);
  });

  it('rejects a missing or unknown cookie', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set(cookie('made-up'))).status).toBe(
      401,
    );
  });

  it('stores only a hash of the refresh token', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    const { refreshToken } = await login(app, user.email);
    const rows = await prisma().refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(refreshToken);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const user = await createLoginUser(prisma(), Role.ADMIN);
    const { refreshToken } = await login(app, user.email);
    const res = await request(app).post('/api/v1/auth/logout').set(cookie(refreshToken!));
    expect(res.status).toBe(204);
    expect(rawSetCookie(res)).toMatch(/vtmp_rt=;/);
    const again = await request(app).post('/api/v1/auth/refresh').set(cookie(refreshToken!));
    expect(again.status).toBe(401);
  });
});

describe('per-IP limit on failed sign-ins', () => {
  it('answers 429 RATE_LIMITED after auth.ipRateLimitPer15Min failed attempts', async () => {
    for (let i = 0; i < 50; i++) {
      await request(app).post('/api/v1/auth/login').send({});
    }
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not count successful sign-ins', async () => {
    const user = await createLoginUser(prisma(), Role.STUDENT);
    for (let i = 0; i < 55; i++) {
      expect((await login(app, user.email)).res.status).toBe(200);
    }
  });
});
