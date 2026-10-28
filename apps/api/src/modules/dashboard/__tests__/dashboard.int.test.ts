import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createLoginUser, createTrainedBatch, uid } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';
import { completionRate } from '../../reports/rules';

const app = createApp();
afterAll(() => disconnectPrisma());
const auth = async (email: string) => bearer((await login(app, email)).accessToken);

async function approve(enrollmentId: string) {
  const admin = await createLoginUser(prisma(), Role.ADMIN);
  const A = await auth(admin.email);
  await request(app)
    .post(`/api/v1/completions/${enrollmentId}/approve`)
    .set(A)
    .set('Idempotency-Key', uid())
    .send()
    .expect(201);
  return A;
}

describe('dashboards (BRQ-9.1–9.3)', () => {
  it('admin: counts, funnel for a cycle, completion rate, grades and attendance trend', async () => {
    const w = await createTrainedBatch(prisma(), [
      { attended: 4, marks: 45, recommended: true },
      { attended: 1 },
    ]);
    const A = await approve(w.students[0]!.enrollmentId);

    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .query({ cycleId: w.cycle.id })
      .set(A);
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.counts.students).toBeGreaterThanOrEqual(2);
    expect(d.counts.trainers).toBeGreaterThanOrEqual(1);
    expect(d.counts.courses).toBeGreaterThanOrEqual(1);
    expect(d.counts.batches.ACTIVE).toBeGreaterThanOrEqual(1);
    const funnel = Object.fromEntries(
      (d.enrollmentFunnel as Array<{ status: string; count: number }>).map((f) => [
        f.status,
        f.count,
      ]),
    );
    expect(funnel).toMatchObject({ ACTIVE: 1, CERTIFIED: 1, PENDING: 0 });
    expect(d.completion).toEqual({
      completed: 1,
      notCompleted: 0,
      inTraining: 1,
      ratePercent: completionRate(1, 0),
    });
    expect(d.grades.map((g: { grade: string }) => g.grade)).toEqual(['A', 'B', 'C', 'D']);
    expect(d.grades[0].count).toBeGreaterThanOrEqual(1);
    expect(d.attendanceTrend.length).toBeGreaterThanOrEqual(1);
    const week = d.attendanceTrend.at(-1);
    expect(week.marks).toBeGreaterThan(0);
    expect(week.percent).toBeGreaterThan(0);
    expect(week.percent).toBeLessThanOrEqual(100);
    expect(d.minAttendancePercent).toBe(75);
  });

  it('trainer: active batches, pending attendance and students below the minimum', async () => {
    const db = prisma();
    const w = await createTrainedBatch(db, [{ attended: 4 }, { attended: 1 }]);
    // A session that started an hour ago and has no marks yet.
    const pending = await db.trainingSession.create({
      data: {
        batchId: w.batch.id,
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
        venue: 'Workshop C',
      },
    });
    const res = await request(app)
      .get('/api/v1/dashboard/trainer')
      .set(await auth(w.trainer.email));
    expect(res.status).toBe(200);
    expect(res.body.activeBatches).toBe(1);
    expect(res.body.students).toBe(2);
    expect(res.body.pendingAttendance.map((s: { id: string }) => s.id)).toEqual([pending.id]);
    expect(res.body.minAttendancePercent).toBe(75);
    expect(res.body.lowAttendance).toEqual([
      expect.objectContaining({ studentId: w.students[1]!.studentId, percent: 25 }),
    ]);
  });

  it('student: own application, live figures, then the certificate', async () => {
    const w = await createTrainedBatch(prisma(), [{ attended: 3, marks: 40, recommended: true }]);
    const S = await auth(w.students[0]!.user.email);
    const before = await request(app).get('/api/v1/dashboard/student').set(S);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      enrollment: { id: w.students[0]!.enrollmentId, status: 'ACTIVE' },
      training: {
        enrollmentId: w.students[0]!.enrollmentId,
        batchId: w.batch.id,
        attendancePercent: 75,
        aggregate: 80,
        projectedGrade: 'B',
        minAttendancePercent: 75,
      },
      certificate: null,
    });

    await approve(w.students[0]!.enrollmentId);
    const after = await request(app).get('/api/v1/dashboard/student').set(S);
    expect(after.body.enrollment.status).toBe('CERTIFIED');
    expect(after.body.certificate).toMatchObject({ status: 'VALID', rendered: true });
  });

  it('student: the headline stays on the training in progress after a later application (S4)', async () => {
    const w = await createTrainedBatch(prisma(), [{ attended: 3, marks: 40, recommended: true }]);
    const s = w.students[0]!;
    // A pending application for a later, non-overlapping cycle, submitted afterwards.
    const later = await prisma().trainingCycle.create({
      data: {
        name: `Later ${uid()}`,
        startsOn: new Date('2028-01-03'),
        endsOn: new Date('2028-04-28'),
      },
    });
    await prisma().enrollment.create({
      data: { studentId: s.studentId, cycleId: later.id, submittedAt: new Date(Date.now() + 1000) },
    });
    const res = await request(app)
      .get('/api/v1/dashboard/student')
      .set(await auth(s.user.email));
    expect(res.body.enrollment).toMatchObject({ id: s.enrollmentId, status: 'ACTIVE' });
  });

  it('each role reaches only its own dashboard (BRQ-1.2)', async () => {
    const db = prisma();
    const student = await createLoginUser(db, Role.STUDENT);
    const trainer = await createLoginUser(db, Role.TRAINER);
    const S = await auth(student.email);
    const T = await auth(trainer.email);
    expect((await request(app).get('/api/v1/dashboard/admin').set(S)).status).toBe(403);
    expect((await request(app).get('/api/v1/dashboard/trainer').set(S)).status).toBe(403);
    expect((await request(app).get('/api/v1/dashboard/admin').set(T)).status).toBe(403);
    expect((await request(app).get('/api/v1/dashboard/student').set(T)).status).toBe(403);
    expect((await request(app).get('/api/v1/dashboard/student')).status).toBe(401);
    const empty = await request(app).get('/api/v1/dashboard/student').set(S);
    expect(empty.body).toEqual({
      enrollment: null,
      training: null,
      nextSession: null,
      certificate: null,
    });
  });
});
