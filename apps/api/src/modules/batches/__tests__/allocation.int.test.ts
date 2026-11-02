import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import {
  createApprovedApplicants,
  createBatch,
  createLoginUser,
  createOpenCycle,
} from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
let admin: Record<string, string>;

// These tests read or change data across the whole shared test database (every cycle, waitlist or
// session), so their time grows with it. 1–2 s normally; on a large local database right after a
// restart, or behind the analytics refresh other suites start, they have passed 5 s.
jest.setTimeout(30_000);

beforeAll(async () => {
  const user = await createLoginUser(prisma(), Role.ADMIN);
  admin = bearer((await login(app, user.email)).accessToken);
});
afterAll(() => disconnectPrisma());

const preview = (cycleId: string) =>
  request(app).post('/api/v1/admin/allocations/preview').set(admin).send({ cycleId });
const confirm = (previewId: string, key?: string) => {
  const r = request(app).post('/api/v1/admin/allocations/confirm').set(admin);
  if (key) r.set('Idempotency-Key', key);
  return r.send({ previewId });
};

describe('allocation preview → confirm (BRQ-4.2, BR-03, BR-04)', () => {
  it('previews without changing anything, respecting capacity and preference rank', async () => {
    const { cycle, courses } = await createOpenCycle(prisma(), 2);
    const [elec, solar] = courses.map((c) => c.id) as [string, string];
    const b1 = await createBatch(prisma(), cycle.id, elec, 2);
    const b2 = await createBatch(prisma(), cycle.id, solar, 1);
    const ids = await createApprovedApplicants(prisma(), cycle.id, [
      [elec],
      [elec, solar],
      [elec, solar],
      [solar],
    ]);

    const res = await preview(cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ applicants: 4, allocated: 3, waitlisted: 1 });
    // SOLAR's single seat goes to the applicant who ranked it first (rank before priority).
    expect(
      res.body.assignments.find((a: { enrollmentId: string }) => a.enrollmentId === ids[3]),
    ).toMatchObject({ batchId: b2.id, rank: 1 });
    expect(res.body.waitlist.map((w: { enrollmentId: string }) => w.enrollmentId)).toEqual([
      ids[2],
    ]);
    const fill = Object.fromEntries(
      res.body.batches.map((b: { batchId: string; added: number }) => [b.batchId, b.added]),
    );
    expect(fill).toEqual({ [b1.id]: 2, [b2.id]: 1 });

    expect(await prisma().batchStudent.count({ where: { batchId: { in: [b1.id, b2.id] } } })).toBe(
      0,
    );
    expect(
      await prisma().enrollment.count({ where: { id: { in: ids }, status: 'APPROVED' } }),
    ).toBe(4);
  });

  it('confirms in one transaction: memberships, statuses, audit and notifications', async () => {
    const { cycle, courses } = await createOpenCycle(prisma(), 1);
    const b = await createBatch(prisma(), cycle.id, courses[0]!.id, 2);
    const ids = await createApprovedApplicants(prisma(), cycle.id, [
      [courses[0]!.id],
      [courses[0]!.id],
      [courses[0]!.id],
    ]);
    const p = await preview(cycle.id);

    const res = await confirm(p.body.previewId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ allocated: 2, waitlisted: 1 });
    expect(await prisma().batchStudent.count({ where: { batchId: b.id } })).toBe(2);
    const statuses = await prisma().enrollment.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, reason: true },
    });
    expect(statuses.filter((s) => s.status === 'ALLOCATED')).toHaveLength(2);
    expect(statuses.find((s) => s.status === 'WAITLISTED')!.reason).toMatch(/No seat/);
    expect(
      await prisma().auditLog.count({
        where: { action: 'ALLOCATION_CONFIRMED', entityId: cycle.id },
      }),
    ).toBe(1);
    expect(
      await prisma().auditLog.count({
        where: { action: 'ENROLLMENT_ALLOCATED', entityId: { in: ids } },
      }),
    ).toBe(2);
    expect(
      await prisma().notification.count({
        where: {
          type: { in: ['ENROLLMENT_ALLOCATED', 'ENROLLMENT_WAITLISTED'] },
          data: { path: ['cycleName'], equals: cycle.name },
        },
      }),
    ).toBe(3);
  });

  it('refuses a stale preview (409 PREVIEW_STALE) and changes nothing', async () => {
    const { cycle, courses } = await createOpenCycle(prisma(), 1);
    const b = await createBatch(prisma(), cycle.id, courses[0]!.id, 5);
    await createApprovedApplicants(prisma(), cycle.id, [[courses[0]!.id]]);
    const p = await preview(cycle.id);

    // Someone else changes the batch after the preview.
    await prisma().batch.update({ where: { id: b.id }, data: { capacity: 6 } });
    const res = await confirm(p.body.previewId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PREVIEW_STALE');
    expect(await prisma().batchStudent.count({ where: { batchId: b.id } })).toBe(0);

    // A new applicant also makes it stale.
    const p2 = await preview(cycle.id);
    await createApprovedApplicants(prisma(), cycle.id, [[courses[0]!.id]]);
    expect((await confirm(p2.body.previewId)).body.error.code).toBe('PREVIEW_STALE');
  });

  it('replays an idempotent retry and refuses a second confirm of the same preview', async () => {
    const { cycle, courses } = await createOpenCycle(prisma(), 1);
    await createBatch(prisma(), cycle.id, courses[0]!.id, 5);
    await createApprovedApplicants(prisma(), cycle.id, [[courses[0]!.id], [courses[0]!.id]]);
    const p = await preview(cycle.id);
    const key = `alloc-${p.body.previewId}`;

    const first = await confirm(p.body.previewId, key);
    const retry = await confirm(p.body.previewId, key);
    expect(first.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);

    const again = await confirm(p.body.previewId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PREVIEW_ALREADY_CONFIRMED');
  });

  it('refuses an expired preview', async () => {
    const { cycle, courses } = await createOpenCycle(prisma(), 1);
    await createBatch(prisma(), cycle.id, courses[0]!.id, 5);
    await createApprovedApplicants(prisma(), cycle.id, [[courses[0]!.id]]);
    const p = await preview(cycle.id);
    await prisma().allocationPreview.update({
      where: { id: p.body.previewId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await confirm(p.body.previewId)).body.error.code).toBe('PREVIEW_EXPIRED');
  });

  it('is admin-only', async () => {
    const trainer = await createLoginUser(prisma(), Role.TRAINER);
    const auth = bearer((await login(app, trainer.email)).accessToken);
    const res = await request(app)
      .post('/api/v1/admin/allocations/preview')
      .set(auth)
      .send({ cycleId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(403);
  });

  it('previews and confirms 500 applicants, preview in under 5 s (BO-3)', async () => {
    const { cycle, courses } = await createOpenCycle(prisma(), 3);
    const c = courses.map((x) => x.id);
    for (const id of c) {
      await createBatch(prisma(), cycle.id, id, 60);
      await createBatch(prisma(), cycle.id, id, 60);
    }
    await createApprovedApplicants(
      prisma(),
      cycle.id,
      Array.from({ length: 500 }, (_, i) => [c[i % 3]!, c[(i + 1) % 3]!, c[(i + 2) % 3]!]),
      { cgpa: (i) => 5 + (i % 50) / 10 },
    );

    const started = Date.now();
    const p = await preview(cycle.id);
    const ms = Date.now() - started;
    expect(p.status).toBe(200);
    expect(ms).toBeLessThan(5000);
    expect(p.body.stats).toMatchObject({ applicants: 500, allocated: 360, waitlisted: 140 });

    const res = await confirm(p.body.previewId);
    expect(res.status).toBe(200);
    expect(res.body.allocated).toBe(360);
  }, 60_000);
});
