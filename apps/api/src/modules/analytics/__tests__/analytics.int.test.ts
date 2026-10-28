import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createLoginUser, createTrainedBatch } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';
import { issuedSince } from '../../documents/documents.service';

const app = createApp();
afterAll(() => disconnectPrisma());
const auth = async (email: string) => bearer((await login(app, email)).accessToken);

/**
 * One batch of four (4 sessions, one 50-mark assessment): two completed (one certified), one
 * not completed, one still in training; one attendance mark LATE.
 */
async function world() {
  const db = prisma();
  const w = await createTrainedBatch(db, [
    { attended: 4, marks: 45 },
    { attended: 4, marks: 40 },
    { attended: 2, marks: 15 },
    { attended: 3 },
  ]);
  const [a, b, c] = w.students;
  await db.enrollment.update({ where: { id: a!.enrollmentId }, data: { status: 'CERTIFIED' } });
  await db.enrollment.update({ where: { id: b!.enrollmentId }, data: { status: 'COMPLETED' } });
  await db.enrollment.update({ where: { id: c!.enrollmentId }, data: { status: 'NOT_COMPLETED' } });
  // One of student d's three attended marks becomes LATE.
  const late = await db.attendance.findFirst({
    where: { studentId: w.students[3]!.studentId, status: 'PRESENT' },
  });
  await db.attendance.update({ where: { id: late!.id }, data: { status: 'LATE' } });
  const admin = await createLoginUser(db, Role.ADMIN);
  return { ...w, A: await auth(admin.email) };
}

const refresh = (A: Record<string, string>) =>
  request(app).post('/api/v1/analytics/refresh').set(A).expect(200);

describe('outcome analytics (F20, BRQ-20.1–20.3)', () => {
  it('counts certificates issued since the figures were built, for the stale notice (D7)', async () => {
    const w = await world();
    const before = new Date(Date.now() - 1000);
    await prisma().certificate.create({
      data: {
        enrollmentId: w.students[0]!.enrollmentId,
        publicCode: `D7${Date.now().toString(36).toUpperCase()}`.slice(0, 16).padEnd(16, '0'),
        grade: 'A',
        aggregatePercent: 90,
        attendancePercent: 100,
        issuedById: w.trainer.id,
      },
    });
    expect(await issuedSince(before)).toBeGreaterThanOrEqual(1);
    expect(await issuedSince(new Date(Date.now() + 60_000))).toBe(0);
    const res = await request(app).get('/api/v1/analytics/outcomes').set(w.A).expect(200);
    expect(res.body.certificatesSinceRefresh).toEqual(expect.any(Number));
  });

  it('compares completion, score, attendance and placements for the batch and course', async () => {
    const w = await world();
    // A placement for the certified student.
    const placed = await request(app)
      .post('/api/v1/analytics/placements')
      .set(w.A)
      .send({
        enrollmentId: w.students[0]!.enrollmentId,
        type: 'JOB',
        employer: 'Odisha Power Co',
        roleTitle: 'Electrician helper',
        placedOn: '2027-04-01',
        monthlyIncome: 12000,
      })
      .expect(201);
    expect(placed.body).toMatchObject({
      student: { rollNo: w.students[0]!.user.student!.rollNo },
      courseTitle: w.course.title,
      monthlyIncome: 12000,
    });

    const r = await refresh(w.A);
    expect(r.body.refreshed).toBe(true);
    expect(r.body.refreshedAt).not.toBeNull();

    const res = await request(app)
      .get(`/api/v1/analytics/outcomes?cycleId=${w.cycle.id}`)
      .set(w.A)
      .expect(200);
    const batch = res.body.batches.find((x: { batchId: string }) => x.batchId === w.batch.id);
    expect(batch).toMatchObject({
      students: 4,
      completed: 2,
      notCompleted: 1,
      certified: 1,
      completionRate: 66.67, // 2 of the 3 who finished
      averageScore: 66.67, // (90 + 80 + 30) / 3
      // 4 + 4 + 2 + 3 attended of 16 marks; LATE counts as present by default.
      attendanceRate: 81.25,
      placed: 1,
      placementRate: 50,
    });
    const course = res.body.courses.find((x: { courseId: string }) => x.courseId === w.course.id);
    expect(course).toMatchObject({ batches: 1, students: 4, completionRate: 66.67, placed: 1 });
    expect(res.body.totals.students).toBe(4);

    const csv = await request(app)
      .get(`/api/v1/analytics/outcomes.csv?cycleId=${w.cycle.id}`)
      .set(w.A)
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(w.batch.name);
  });

  it('competency achievement is verified pairs over students × competencies (BRQ-20.2)', async () => {
    const w = await world();
    const db = prisma();
    const mk = (code: string) =>
      db.competency.create({
        data: { courseId: w.course.id, code, title: code, mode: 'PRACTICAL', requiredLevel: 2 },
      });
    const [c1, c2] = [await mk('A1'), await mk('A2')];
    // 3 of the 8 (4 students × 2 competencies) are verified; one revoked one doesn't count.
    const rate = async (studentId: string, competencyId: string, revoked = false) =>
      db.competencyRating.create({
        data: {
          studentId,
          competencyId,
          batchId: w.batch.id,
          level: 3,
          ratedById: w.trainer.id,
          verifiedAt: new Date(),
          verifiedById: w.trainer.id,
          ...(revoked
            ? { revokedAt: new Date(), revokedById: w.trainer.id, revokedReason: 'x' }
            : {}),
        },
      });
    await rate(w.students[0]!.studentId, c1.id);
    await rate(w.students[0]!.studentId, c2.id);
    await rate(w.students[1]!.studentId, c1.id);
    await rate(w.students[2]!.studentId, c1.id, true);
    await refresh(w.A);
    const res = await request(app)
      .get(`/api/v1/analytics/outcomes?cycleId=${w.cycle.id}`)
      .set(w.A)
      .expect(200);
    expect(res.body.courses[0]).toMatchObject({ competencies: 2, competencyAchievement: 37.5 });
  });

  it('placements: only for finished students, looked up by roll number, deletable with audit', async () => {
    const w = await world();
    const rollNo = w.students[0]!.user.student!.rollNo;
    const found = await request(app)
      .get(`/api/v1/analytics/placements/candidates?rollNo=${rollNo.toLowerCase()}`)
      .set(w.A)
      .expect(200);
    expect(found.body).toEqual([
      expect.objectContaining({ enrollmentId: w.students[0]!.enrollmentId, status: 'CERTIFIED' }),
    ]);
    const stillTraining = await request(app).post('/api/v1/analytics/placements').set(w.A).send({
      enrollmentId: w.students[3]!.enrollmentId,
      type: 'JOB',
      employer: 'X Ltd',
      roleTitle: 'Helper',
      placedOn: '2027-04-01',
    });
    expect(stillTraining.status).toBe(422);
    expect(stillTraining.body.error.code).toBe('NOT_FINISHED');

    const p = (
      await request(app)
        .post('/api/v1/analytics/placements')
        .set(w.A)
        .send({
          enrollmentId: w.students[1]!.enrollmentId,
          type: 'SELF_EMPLOYED',
          employer: 'Own repair shop',
          roleTitle: 'Electrician',
          placedOn: '2027-04-10',
        })
        .expect(201)
    ).body as { id: string };
    const list = await request(app)
      .get(`/api/v1/analytics/placements?courseId=${w.course.id}`)
      .set(w.A)
      .expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(p.id);
    await request(app).delete(`/api/v1/analytics/placements/${p.id}`).set(w.A).expect(204);
    const audit = await prisma().auditLog.findMany({
      where: { entity: 'PlacementOutcome', entityId: p.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((x) => x.action)).toEqual(['PLACEMENT_RECORDED', 'PLACEMENT_DELETED']);
  });

  it('is for admins only; the cron route needs the secret', async () => {
    const w = await world();
    const T = await auth(w.trainer.email);
    await request(app).get('/api/v1/analytics/outcomes').set(T).expect(403);
    await request(app).post('/api/v1/analytics/refresh').set(T).expect(403);
    await request(app).get('/api/v1/internal/jobs/analytics-refresh').expect(401);
    const cron = await request(app)
      .get('/api/v1/internal/jobs/analytics-refresh')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`)
      .expect(200);
    expect(cron.body).toHaveProperty('refreshed');
  });
});
