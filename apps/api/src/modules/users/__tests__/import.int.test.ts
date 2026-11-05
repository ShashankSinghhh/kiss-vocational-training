import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createLoginUser, uid } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
let A: Record<string, string>;
beforeAll(async () => {
  const admin = await createLoginUser(prisma(), Role.ADMIN);
  A = bearer((await login(app, admin.email)).accessToken);
});
afterAll(() => disconnectPrisma());

const importCsv = (csv: string, dryRun: boolean) =>
  request(app)
    .post('/api/v1/admin/users/import')
    .set(A)
    .send({ csv, password: 'Welcome2026', dryRun });

describe('student import from CSV (A5, BRQ-1.5)', () => {
  it('a dry run reports every problem by row and creates nothing', async () => {
    const s = uid();
    const existing = await createLoginUser(prisma(), Role.STUDENT);
    const csv = [
      'email,fullName,rollNo,phone',
      `ok-${s}@kiss.test,Sumitra Hembram,IMP-${s}-1,9437000001`,
      `not-an-email,Rabindra Majhi,IMP-${s}-2,`,
      `dup-${s}@kiss.test,Lipika Tudu,IMP-${s}-1,12345`,
      `${existing.email},Biren Munda,IMP-${s}-4,`,
    ].join('\n');
    const res = await importCsv(csv, true).expect(200);
    expect(res.body).toMatchObject({ valid: 1, invalid: 3, created: 0 });
    const errs = (line: number) =>
      res.body.rows.find((r: { line: number }) => r.line === line).errors;
    expect(errs(2)).toEqual([]);
    expect(errs(3)).toEqual([{ field: 'email', code: 'INVALID' }]);
    expect(errs(4)).toEqual(
      expect.arrayContaining([
        { field: 'phone', code: 'INVALID' },
        { field: 'rollNo', code: 'DUPLICATE_IN_FILE' },
      ]),
    );
    expect(errs(5)).toEqual([{ field: 'email', code: 'EMAIL_TAKEN' }]);
    expect(await prisma().student.count({ where: { rollNo: { startsWith: `IMP-${s}` } } })).toBe(0);
    // Not a dry run, but with errors: still nothing is created.
    expect((await importCsv(csv, false).expect(200)).body.created).toBe(0);
  });

  it('imports clean rows in one go: students must change the shared password, each audited', async () => {
    // An old spreadsheet with a CGPA column still imports: the column is ignored.
    const s = uid();
    const csv = [
      'Roll No,Name,Email,CGPA',
      `IMP-${s}-1,Kalpana Besra,a-${s}@kiss.test,8.2`,
      `IMP-${s}-2,"Mallick, Dhaneswar",b-${s}@kiss.test,6.9`,
    ].join('\r\n');
    const res = await importCsv(csv, false).expect(200);
    expect(res.body).toMatchObject({ valid: 2, invalid: 0, created: 2 });
    const users = await prisma().user.findMany({
      where: { email: { in: [`a-${s}@kiss.test`, `b-${s}@kiss.test`] } },
      include: { student: true },
      orderBy: { email: 'asc' },
    });
    expect(users.map((u) => [u.fullName, u.student?.rollNo, u.mustChangePassword])).toEqual([
      ['Kalpana Besra', `IMP-${s}-1`, true],
      ['Mallick, Dhaneswar', `IMP-${s}-2`, true],
    ]);
    expect(
      await prisma().auditLog.count({
        where: { action: 'USER_CREATED', entityId: { in: users.map((u) => u.id) } },
      }),
    ).toBe(2);
    // The shared password works, and the first thing asked is to change it.
    const signIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `a-${s}@kiss.test`, password: 'Welcome2026' })
      .expect(200);
    expect(signIn.body.user.mustChangePassword).toBe(true);
  });

  it('refuses a file without the required columns, and is admin-only', async () => {
    const bad = await importCsv('email,name\nx@kiss.test,Somebody', true);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('IMPORT_BAD_HEADER');
    const student = await createLoginUser(prisma(), Role.STUDENT);
    const S = bearer((await login(app, student.email)).accessToken);
    expect(
      (
        await request(app)
          .post('/api/v1/admin/users/import')
          .set(S)
          .send({ csv: 'a', password: 'Welcome2026', dryRun: true })
      ).status,
    ).toBe(403);
  });
});
