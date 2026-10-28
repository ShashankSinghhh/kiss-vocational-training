import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import {
  createActiveBatch,
  createApprovedApplicants,
  createBatch,
  createLoginUser,
  createOpenCycle,
  uid,
} from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';
import { closeBlocker } from '../rules';

const app = createApp();
let admin: Record<string, string>;
beforeAll(async () => {
  const user = await createLoginUser(prisma(), Role.ADMIN);
  admin = bearer((await login(app, user.email)).accessToken);
});
afterAll(() => disconnectPrisma());

const auth = async (email: string) => bearer((await login(app, email)).accessToken);
const withdraw = (batchId: string, enrollmentId: string, reason = 'Left for a job') =>
  request(app)
    .post(`/api/v1/admin/batches/${batchId}/students/${enrollmentId}/withdraw`)
    .set(admin)
    .set('Idempotency-Key', `k-${uid()}`)
    .send({ reason });
const close = (batchId: string) =>
  request(app)
    .post(`/api/v1/admin/batches/${batchId}/close`)
    .set(admin)
    .set('Idempotency-Key', `k-${uid()}`)
    .send();

describe('closeBlocker (L1)', () => {
  it('needs an active batch, a passed end date and no undecided students', () => {
    expect(closeBlocker('PLANNED', '2027-01-31', '2027-02-01', 0)).toBe('INVALID_BATCH_STATUS');
    expect(closeBlocker('CLOSED', '2027-01-31', '2027-02-01', 0)).toBe('INVALID_BATCH_STATUS');
    // The end date itself is still a training day.
    expect(closeBlocker('ACTIVE', '2027-01-31', '2027-01-31', 0)).toBe('BATCH_NOT_ENDED');
    expect(closeBlocker('ACTIVE', '2027-01-31', '2027-02-01', 1)).toBe('STUDENTS_UNDECIDED');
    expect(closeBlocker('ACTIVE', '2027-01-31', '2027-02-01', 0)).toBeNull();
  });
});

describe('withdraw from training (L4)', () => {
  it('from a running batch: WITHDRAWN with the reason, kept on the roster, seat freed, off the sheet', async () => {
    const db = prisma();
    const w = await createActiveBatch(db, { students: 2, sessions: 2 });
    const [leaver, stayer] = w.students as [(typeof w.students)[0], (typeof w.students)[0]];

    // Both had a mark on one assessment before the student left.
    const assessment = await db.assessment.create({
      data: {
        batchId: w.batch.id,
        title: 'Unit test',
        mode: 'THEORY',
        maxMarks: 20,
        weightage: 1,
        createdById: w.trainer.id,
      },
    });
    await db.assessmentResult.createMany({
      data: [leaver, stayer].map((s) => ({
        assessmentId: assessment.id,
        studentId: s.studentId,
        marks: 15,
        recordedById: w.trainer.id,
      })),
    });

    const res = await withdraw(w.batch.id, leaver.enrollmentId);
    expect(res.status).toBe(200);
    expect(res.body.enrolled).toBe(1);
    const row = res.body.roster.find(
      (r: { enrollmentId: string }) => r.enrollmentId === leaver.enrollmentId,
    );
    expect(row.enrollmentStatus).toBe('WITHDRAWN');
    const e = await db.enrollment.findUniqueOrThrow({ where: { id: leaver.enrollmentId } });
    expect(e).toMatchObject({ status: 'WITHDRAWN', reason: 'Left for a job' });
    expect(
      await db.auditLog.count({
        where: { action: 'BATCH_STUDENT_WITHDRAWN', entityId: w.batch.id },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { userId: leaver.user.id, type: 'TRAINING_WITHDRAWN' },
      }),
    ).toBe(1);

    // The attendance sheet no longer asks for the student, and the summary leaves them out.
    const trainerAuth = await auth(w.trainer.email);
    const sheet = await request(app)
      .get(`/api/v1/sessions/${w.sessions[0]!.id}/attendance`)
      .set(trainerAuth);
    expect(sheet.body.rows.map((r: { studentId: string }) => r.studentId)).toEqual([
      stayer.studentId,
    ]);
    const saved = await request(app)
      .put(`/api/v1/sessions/${w.sessions[0]!.id}/attendance`)
      .set(trainerAuth)
      .send({ entries: [{ studentId: stayer.studentId, status: 'PRESENT' }] });
    expect(saved.status).toBe(200);
    const summary = await request(app)
      .get(`/api/v1/batches/${w.batch.id}/attendance-summary`)
      .set(trainerAuth);
    expect(summary.body.map((r: { studentId: string }) => r.studentId)).toEqual([stayer.studentId]);

    // Mark entry counts only the students still in the batch.
    const list = await request(app)
      .get(`/api/v1/batches/${w.batch.id}/assessments`)
      .set(trainerAuth);
    expect(list.body[0]).toMatchObject({ recorded: 1, rosterSize: 1 });

    // Done once: a second withdrawal or a move is refused.
    const again = await withdraw(w.batch.id, leaver.enrollmentId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_IN_TRAINING');
  });

  it('from a planned batch: the seat is given up and the student leaves the roster', async () => {
    const db = prisma();
    const { cycle, courses } = await createOpenCycle(db, 1);
    const b = await createBatch(db, cycle.id, courses[0]!.id, 2);
    const [e1] = await createApprovedApplicants(db, cycle.id, [[courses[0]!.id]]);
    await request(app).post(`/api/v1/admin/batches/${b.id}/students`).set(admin).send({
      enrollmentId: e1,
    });

    const res = await withdraw(b.id, e1!);
    expect(res.status).toBe(200);
    expect(res.body.roster).toHaveLength(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: e1! } })).status).toBe(
      'WITHDRAWN',
    );
  });

  it('needs a reason and is admin-only', async () => {
    const w = await createActiveBatch(prisma(), { students: 1, sessions: 1 });
    const s = w.students[0]!;
    expect((await withdraw(w.batch.id, s.enrollmentId, '')).status).toBe(422);
    const trainer = await request(app)
      .post(`/api/v1/admin/batches/${w.batch.id}/students/${s.enrollmentId}/withdraw`)
      .set(await auth(w.trainer.email))
      .set('Idempotency-Key', `k-${uid()}`)
      .send({ reason: 'Left' });
    expect(trainer.status).toBe(403);
  });
});

describe('close a batch (L1)', () => {
  it('refuses before the end date and while students are undecided, then closes', async () => {
    const db = prisma();
    const w = await createActiveBatch(db, { students: 2, sessions: 1 });
    const [done, leaver] = w.students as [(typeof w.students)[0], (typeof w.students)[0]];

    const early = await close(w.batch.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('BATCH_NOT_ENDED');

    await db.batch.update({
      where: { id: w.batch.id },
      data: { endDate: new Date(Date.now() - 2 * 86_400_000) },
    });
    const undecided = await close(w.batch.id);
    expect(undecided.status).toBe(409);
    expect(undecided.body.error.code).toBe('STUDENTS_UNDECIDED');
    expect(undecided.body.error.details).toHaveLength(2);

    await request(app)
      .post(`/api/v1/completions/${done.enrollmentId}/not-completed`)
      .set(admin)
      .send({ reason: 'Attendance below 75 %' });
    await withdraw(w.batch.id, leaver.enrollmentId);

    const closed = await close(w.batch.id);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(
      await db.auditLog.count({ where: { action: 'BATCH_CLOSED', entityId: w.batch.id } }),
    ).toBe(1);
    // Closed for good: no new sessions, and it can't be closed twice.
    expect((await close(w.batch.id)).body.error.code).toBe('INVALID_BATCH_STATUS');
    const session = await request(app)
      .post(`/api/v1/admin/batches/${w.batch.id}/sessions`)
      .set(admin)
      .send({
        kind: 'single',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(session.status).toBe(409);
  });
});
