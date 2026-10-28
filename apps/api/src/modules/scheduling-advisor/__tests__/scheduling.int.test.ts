import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createBatch, createLoginUser, createOpenCycle } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
afterAll(() => disconnectPrisma());
const auth = async (email: string) => bearer((await login(app, email)).accessToken);

/** Two batches in one cycle (2027 dates), an admin, and a trainer assigned to the first batch. */
async function world() {
  const db = prisma();
  const { cycle, courses } = await createOpenCycle(db, 2);
  const a = await createBatch(db, cycle.id, courses[0]!.id, 10);
  const b = await createBatch(db, cycle.id, courses[1]!.id, 10);
  const admin = await createLoginUser(db, Role.ADMIN);
  const trainer = await createLoginUser(db, Role.TRAINER);
  await db.trainerAssignment.create({ data: { batchId: a.id, trainerId: trainer.trainer!.id } });
  return { a, b, trainer, A: await auth(admin.email) };
}

const single = (startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) => ({
  kind: 'single',
  startsAt,
  endsAt,
  ...extra,
});

describe('session creation blocks hard clashes (BR-20, BRQ-14.2)', () => {
  it('refuses the same venue at overlapping times, but allows back-to-back sessions', async () => {
    const w = await world();
    const path = (id: string) => `/api/v1/admin/batches/${id}/sessions`;
    await request(app)
      .post(path(w.a.id))
      .set(w.A)
      .send(single('2027-01-05T04:30:00Z', '2027-01-05T06:30:00Z'))
      .expect(201);

    // Batch B books batch A's venue for an overlapping hour.
    const clash = await request(app)
      .post(path(w.b.id))
      .set(w.A)
      .send(single('2027-01-05T05:30:00Z', '2027-01-05T07:30:00Z', { venue: w.a.venue }));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CLASH');
    expect(clash.body.error.details[0].message).toContain(w.a.name);

    // end == start is not a clash.
    await request(app)
      .post(path(w.b.id))
      .set(w.A)
      .send(single('2027-01-05T06:30:00Z', '2027-01-05T08:30:00Z', { venue: w.a.venue }))
      .expect(201);
  });

  it('refuses a trainer named on two overlapping sessions; nothing is saved', async () => {
    const w = await world();
    const db = prisma();
    await db.trainerAssignment.create({
      data: { batchId: w.b.id, trainerId: w.trainer.trainer!.id },
    });
    const trainerId = w.trainer.trainer!.id;
    await request(app)
      .post(`/api/v1/admin/batches/${w.a.id}/sessions`)
      .set(w.A)
      .send(single('2027-01-06T04:30:00Z', '2027-01-06T06:30:00Z', { trainerId }))
      .expect(201);
    const before = await db.trainingSession.count({ where: { batchId: w.b.id } });
    const res = await request(app)
      .post(`/api/v1/admin/batches/${w.b.id}/sessions`)
      .set(w.A)
      .send(single('2027-01-06T05:00:00Z', '2027-01-06T07:00:00Z', { trainerId }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_CLASH');
    expect(await db.trainingSession.count({ where: { batchId: w.b.id } })).toBe(before);
  });

  it('cancelled sessions no longer block the slot', async () => {
    const w = await world();
    const created = await request(app)
      .post(`/api/v1/admin/batches/${w.a.id}/sessions`)
      .set(w.A)
      .send(single('2027-01-07T04:30:00Z', '2027-01-07T06:30:00Z'))
      .expect(201);
    await request(app)
      .patch(`/api/v1/admin/batches/${w.a.id}/sessions/${created.body[0].id}`)
      .set(w.A)
      .send({ status: 'CANCELLED' })
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/batches/${w.b.id}/sessions`)
      .set(w.A)
      .send(single('2027-01-07T04:30:00Z', '2027-01-07T06:30:00Z', { venue: w.a.venue }))
      .expect(201);
  });
});

describe('POST /scheduling/check (F14)', () => {
  it('reports capacity, clashes with suggested free slots, and free trainers (BRQ-14.1–14.3)', async () => {
    const w = await world();
    const db = prisma();
    // Batch A teaches 10:00–12:00 IST on 2027-01-11 at its venue (trainer through assignment).
    await db.trainingSession.create({
      data: {
        batchId: w.a.id,
        startsAt: new Date('2027-01-11T04:30:00Z'),
        endsAt: new Date('2027-01-11T06:30:00Z'),
        venue: w.a.venue,
      },
    });
    const res = await request(app)
      .post('/api/v1/scheduling/check')
      .set(w.A)
      .send({
        batches: [
          {
            batchId: w.b.id,
            addStudents: 9,
            sessions: [
              {
                startsAt: '2027-01-11T05:30:00Z',
                endsAt: '2027-01-11T07:30:00Z',
                venue: w.a.venue,
              },
            ],
          },
          { batchId: w.a.id, addStudents: 11 },
        ],
      })
      .expect(200);
    const [b, a] = res.body.batches;

    expect(b.capacity).toMatchObject({ capacity: 10, projected: 9, percent: 90, level: 'NEAR' });
    expect(a.capacity).toMatchObject({ projected: 11, level: 'OVER' });

    expect(b.clashes).toEqual([
      expect.objectContaining({
        kind: 'VENUE',
        hard: true,
        session: expect.objectContaining({ proposed: true }),
        with: expect.objectContaining({ batchId: w.a.id, batchName: w.a.name }),
      }),
    ]);
    // Suggested slots are free and the same length (2 h).
    expect(b.suggestions.slots.length).toBeGreaterThan(0);
    for (const s of b.suggestions.slots) {
      const len = new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime();
      expect(len).toBe(2 * 3_600_000);
      const overlapsA =
        new Date(s.startsAt) < new Date('2027-01-11T06:30:00Z') &&
        new Date('2027-01-11T04:30:00Z') < new Date(s.endsAt);
      expect(overlapsA).toBe(false);
    }
    // Batch B has no trainer, so free trainers are suggested; the busy one is not among them.
    expect(b.trainers).toEqual([]);
    expect(b.suggestions.trainers.length).toBeGreaterThan(0);
    expect(a.trainers.map((t: { id: string }) => t.id)).toEqual([w.trainer.trainer!.id]);
  });

  it("the batch's only trainer busy elsewhere blocks (T3); one of two assigned only warns", async () => {
    const w = await world();
    const db = prisma();
    await db.trainerAssignment.create({
      data: { batchId: w.b.id, trainerId: w.trainer.trainer!.id },
    });
    await db.trainingSession.create({
      data: {
        batchId: w.a.id,
        startsAt: new Date('2027-01-12T04:30:00Z'),
        endsAt: new Date('2027-01-12T06:30:00Z'),
        venue: w.a.venue,
      },
    });
    const check = () =>
      request(app)
        .post('/api/v1/scheduling/check')
        .set(w.A)
        .send({
          batches: [
            {
              batchId: w.b.id,
              sessions: [{ startsAt: '2027-01-12T05:00:00Z', endsAt: '2027-01-12T07:00:00Z' }],
            },
          ],
        })
        .expect(200);
    const save = () =>
      request(app)
        .post(`/api/v1/admin/batches/${w.b.id}/sessions`)
        .set(w.A)
        .send(single('2027-01-12T05:00:00Z', '2027-01-12T07:00:00Z'));

    // Same sole trainer on both batches: they would teach two sessions at once.
    expect((await check()).body.batches[0].clashes).toEqual([
      expect.objectContaining({ kind: 'TRAINER', hard: true }),
    ]);
    const refused = await save();
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SCHEDULE_CLASH');

    // With a second trainer on batch B either could teach it: a warning, and saving works.
    const second = await createLoginUser(db, Role.TRAINER);
    await db.trainerAssignment.create({ data: { batchId: w.b.id, trainerId: second.trainer!.id } });
    expect((await check()).body.batches[0].clashes).toEqual([
      expect.objectContaining({ kind: 'TRAINER', hard: false }),
    ]);
    expect((await save()).status).toBe(201);
  });

  it('is for admins only, and validates input', async () => {
    const w = await world();
    const T = await auth(w.trainer.email);
    await request(app)
      .post('/api/v1/scheduling/check')
      .set(T)
      .send({ batches: [{ batchId: w.a.id }] })
      .expect(403);
    const bad = await request(app)
      .post('/api/v1/scheduling/check')
      .set(w.A)
      .send({
        batches: [
          {
            batchId: w.a.id,
            sessions: [{ startsAt: '2027-01-12T07:00:00Z', endsAt: '2027-01-12T06:00:00Z' }],
          },
        ],
      });
    expect(bad.status).toBe(422);
  });
});
