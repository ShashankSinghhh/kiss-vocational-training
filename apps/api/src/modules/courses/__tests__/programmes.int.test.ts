import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createLoginUser, createOpenCycle, uid } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
afterAll(() => disconnectPrisma());

async function auth(role: Role) {
  const user = await createLoginUser(prisma(), role);
  return { user, auth: bearer((await login(app, user.email)).accessToken) };
}

describe('programmes: groups of courses', () => {
  it('creates and renames a programme, auditing each change, and refuses a duplicate name', async () => {
    const admin = await auth(Role.ADMIN);
    const name = `Crafts ${uid()}`;
    const created = await request(app)
      .post('/api/v1/admin/programmes')
      .set(admin.auth)
      .send({ name, sortOrder: 20 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name, sortOrder: 20 });

    const dup = await request(app).post('/api/v1/admin/programmes').set(admin.auth).send({ name });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PROGRAMME_NAME_TAKEN');

    const renamed = await request(app)
      .patch(`/api/v1/admin/programmes/${created.body.id}`)
      .set(admin.auth)
      .send({ name: `${name} & Arts` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe(`${name} & Arts`);

    const empty = await request(app)
      .patch(`/api/v1/admin/programmes/${created.body.id}`)
      .set(admin.auth)
      .send({});
    expect(empty.status).toBe(422);

    const actions = await prisma().auditLog.findMany({
      where: { entity: 'Programme', entityId: created.body.id },
      select: { action: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((a) => a.action)).toEqual(['PROGRAMME_CREATED', 'PROGRAMME_UPDATED']);
  });

  it('files a course under a programme and shows it to students in the catalogue', async () => {
    const admin = await auth(Role.ADMIN);
    const student = await auth(Role.STUDENT);
    const { cycle, courses } = await createOpenCycle(prisma(), 1);
    const programme = await request(app)
      .post('/api/v1/admin/programmes')
      .set(admin.auth)
      .send({ name: `Digital ${uid()}` });

    const filed = await request(app)
      .patch(`/api/v1/admin/courses/${courses[0]!.id}`)
      .set(admin.auth)
      .send({ programmeId: programme.body.id });
    expect(filed.status).toBe(200);
    expect(filed.body.programme).toEqual({ id: programme.body.id, name: programme.body.name });

    const catalogue = await request(app)
      .get('/api/v1/courses')
      .query({ cycleId: cycle.id })
      .set(student.auth);
    expect(catalogue.body.courses[0].programme).toMatchObject({ id: programme.body.id });
    expect(catalogue.body.maxPreferences).toEqual(expect.any(Number));

    const list = await request(app).get('/api/v1/programmes').set(student.auth);
    expect(list.status).toBe(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(programme.body.id);

    const unfiled = await request(app)
      .patch(`/api/v1/admin/courses/${courses[0]!.id}`)
      .set(admin.auth)
      .send({ programmeId: null });
    expect(unfiled.body.programme).toBeNull();
  });

  it('refuses a programme that does not exist (422 PROGRAMME_NOT_FOUND)', async () => {
    const admin = await auth(Role.ADMIN);
    const res = await request(app)
      .post('/api/v1/admin/courses')
      .set(admin.auth)
      .send({
        code: `x-${uid()}`.slice(0, 20),
        title: 'Orphan course',
        description: 'A course naming a missing programme.',
        durationWeeks: 4,
        prerequisites: null,
        seatCapacity: 10,
        programmeId: '00000000-0000-4000-8000-000000000000',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PROGRAMME_NOT_FOUND');
  });

  it('lets only admins change programmes', async () => {
    const student = await auth(Role.STUDENT);
    const trainer = await auth(Role.TRAINER);
    for (const who of [student, trainer]) {
      const res = await request(app)
        .post('/api/v1/admin/programmes')
        .set(who.auth)
        .send({ name: `Nope ${uid()}` });
      expect(res.status).toBe(403);
    }
    expect((await request(app).get('/api/v1/programmes')).status).toBe(401);
  });
});
