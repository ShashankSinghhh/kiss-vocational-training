import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createLoginUser, uid } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
let admin: Record<string, string>;
beforeAll(async () => {
  const user = await createLoginUser(prisma(), Role.ADMIN);
  admin = bearer((await login(app, user.email)).accessToken);
});
afterAll(() => disconnectPrisma());

/** A cycle from 1 June to 30 September 2027 with one active course. */
async function world() {
  const cycle = await request(app)
    .post('/api/v1/admin/cycles')
    .set(admin)
    .send({ name: `Cycle ${uid()}`, startsOn: '2027-06-01', endsOn: '2027-09-30' });
  expect(cycle.status).toBe(201);
  const course = await prisma().course.create({
    data: {
      code: `CD-${uid()}`.slice(0, 20),
      title: `Masonry ${uid()}`,
      description: 'Brick and block work',
      durationWeeks: 8,
      seatCapacity: 20,
    },
  });
  return { cycleId: cycle.body.id as string, courseId: course.id };
}

const newBatch = (w: { cycleId: string; courseId: string }, startDate: string, endDate: string) =>
  request(app)
    .post('/api/v1/admin/batches')
    .set(admin)
    .send({
      courseId: w.courseId,
      cycleId: w.cycleId,
      name: `B-${uid()}`,
      capacity: 10,
      startDate,
      endDate,
      venue: 'Yard 2',
    });

describe('batch dates inside the cycle (L5)', () => {
  it('creates a batch on the cycle bounds and refuses one that starts early or ends late', async () => {
    const w = await world();
    expect((await newBatch(w, '2027-06-01', '2027-09-30')).status).toBe(201);
    const early = await newBatch(w, '2027-05-31', '2027-07-31');
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('BATCH_OUTSIDE_CYCLE');
    expect((await newBatch(w, '2027-07-01', '2027-10-01')).body.error.code).toBe(
      'BATCH_OUTSIDE_CYCLE',
    );
  });

  it('refuses an edit that moves the batch outside, and a cycle edit that leaves it outside', async () => {
    const w = await world();
    const b = await newBatch(w, '2027-06-07', '2027-08-29');
    const moved = await request(app)
      .patch(`/api/v1/admin/batches/${b.body.id}`)
      .set(admin)
      .send({ endDate: '2027-10-15' });
    expect(moved.status).toBe(422);
    expect(moved.body.error.code).toBe('BATCH_OUTSIDE_CYCLE');

    const shrunk = await request(app)
      .patch(`/api/v1/admin/cycles/${w.cycleId}`)
      .set(admin)
      .send({ endsOn: '2027-08-15' });
    expect(shrunk.status).toBe(409);
    expect(shrunk.body.error.code).toBe('CYCLE_HAS_BATCHES_OUTSIDE');
    expect(shrunk.body.error.details).toHaveLength(1);
    // Still room for the batch: fine.
    const ok = await request(app)
      .patch(`/api/v1/admin/cycles/${w.cycleId}`)
      .set(admin)
      .send({ endsOn: '2027-08-31' });
    expect(ok.status).toBe(200);
  });
});

describe('application windows close by the end of the cycle (L6)', () => {
  const offer = (w: { cycleId: string; courseId: string }, closes: string) =>
    request(app).put(`/api/v1/admin/cycles/${w.cycleId}/offerings/${w.courseId}`).set(admin).send({
      enrollmentOpensAt: '2027-05-01T03:30:00.000Z',
      enrollmentClosesAt: closes,
      isOpen: true,
    });

  it('accepts a window closing at midnight after the last day (IST), refuses one later', async () => {
    const w = await world();
    // 30 September 2027 ends at 1 October 00:00 IST = 30 September 18:30 UTC.
    expect((await offer(w, '2027-09-30T18:30:00.000Z')).status).toBe(200);
    const late = await offer(w, '2027-09-30T18:31:00.000Z');
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('WINDOW_AFTER_CYCLE');
    // A window that opens after the cycle starts is fine: late applicants can still be placed.
    const lateOpen = await request(app)
      .put(`/api/v1/admin/cycles/${w.cycleId}/offerings/${w.courseId}`)
      .set(admin)
      .send({
        enrollmentOpensAt: '2027-06-10T03:30:00.000Z',
        enrollmentClosesAt: '2027-06-20T18:30:00.000Z',
        isOpen: true,
      });
    expect(lateOpen.status).toBe(200);
  });

  it('a cycle edit may not end the cycle before an open window closes', async () => {
    const w = await world();
    await offer(w, '2027-09-15T18:30:00.000Z');
    const shrunk = await request(app)
      .patch(`/api/v1/admin/cycles/${w.cycleId}`)
      .set(admin)
      .send({ endsOn: '2027-09-10' });
    expect(shrunk.status).toBe(409);
    expect(shrunk.body.error.code).toBe('CYCLE_HAS_WINDOWS_OUTSIDE');
  });
});
