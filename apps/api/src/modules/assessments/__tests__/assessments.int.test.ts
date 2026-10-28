import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createActiveBatch, createLoginUser } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
afterAll(() => disconnectPrisma());

const auth = async (email: string) => bearer((await login(app, email)).accessToken);

async function world() {
  const w = await createActiveBatch(prisma(), { students: 2, sessions: 2 });
  return { ...w, trainerAuth: await auth(w.trainer.email) };
}

async function newAssessment(
  w: Awaited<ReturnType<typeof world>>,
  body: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post(`/api/v1/batches/${w.batch.id}/assessments`)
    .set(w.trainerAuth)
    .send({
      title: 'Wiring test',
      mode: 'PRACTICAL',
      maxMarks: 50,
      weightage: 30,
      isMandatory: true,
      ...body,
    });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

const saveMarks = (
  id: string,
  a: Record<string, string>,
  results: Array<{ studentId: string; marks: number }>,
) => request(app).put(`/api/v1/assessments/${id}/results`).set(a).send({ results });

describe('assessments (BRQ-6.1)', () => {
  it('the batch trainer creates, lists and edits; another trainer gets 403', async () => {
    const w = await world();
    const a = await newAssessment(w);
    const list = await request(app)
      .get(`/api/v1/batches/${w.batch.id}/assessments`)
      .set(w.trainerAuth);
    expect(list.body[0]).toMatchObject({
      id: a.id,
      maxMarks: 50,
      weightage: 30,
      isMandatory: true,
      recorded: 0,
      rosterSize: 2,
    });

    const other = await createLoginUser(prisma(), Role.TRAINER);
    const otherAuth = await auth(other.email);
    expect(
      (
        await request(app)
          .post(`/api/v1/batches/${w.batch.id}/assessments`)
          .set(otherAuth)
          .send({ title: 'X', mode: 'THEORY', maxMarks: 10, weightage: 1, isMandatory: false })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/v1/assessments/${a.id}`)
          .set(otherAuth)
          .send({ title: 'Hijack' })
      ).status,
    ).toBe(403);

    const edited = await request(app)
      .patch(`/api/v1/assessments/${a.id}`)
      .set(w.trainerAuth)
      .send({ weightage: 40 });
    expect(edited.body.weightage).toBe(40);
  });

  it('validates max marks and weightage', async () => {
    const w = await world();
    const bad = await request(app)
      .post(`/api/v1/batches/${w.batch.id}/assessments`)
      .set(w.trainerAuth)
      .send({ title: 'Zero', mode: 'THEORY', maxMarks: 0, weightage: 10, isMandatory: false });
    expect(bad.status).toBe(422);
  });

  it('keeps the date within the batch dates, on create and on edit (T1)', async () => {
    const w = await world();
    const after = new Date(w.batch.endDate.getTime() + 86_400_000).toISOString().slice(0, 10);
    const res = await request(app)
      .post(`/api/v1/batches/${w.batch.id}/assessments`)
      .set(w.trainerAuth)
      .send({
        title: 'Late quiz',
        mode: 'THEORY',
        maxMarks: 10,
        weightage: 1,
        isMandatory: true,
        heldOn: after,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('HELD_OUTSIDE_BATCH');

    const lastDay = w.batch.endDate.toISOString().slice(0, 10);
    const a = await newAssessment(w, { heldOn: lastDay });
    const moved = await request(app)
      .patch(`/api/v1/assessments/${a.id}`)
      .set(w.trainerAuth)
      .send({ heldOn: after });
    expect(moved.status).toBe(422);
  });
});

describe('marks (BRQ-6.2, BR-07)', () => {
  it('rejects marks above max (TC-10) or below 0, saving nothing', async () => {
    const w = await world();
    const a = await newAssessment(w);
    const res = await saveMarks(a.id, w.trainerAuth, [
      { studentId: w.students[0]!.studentId, marks: 40 },
      { studentId: w.students[1]!.studentId, marks: 50.5 },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MARKS_OUT_OF_RANGE');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ path: w.students[1]!.studentId }),
    ]);
    expect(await prisma().assessmentResult.count({ where: { assessmentId: a.id } })).toBe(0);
    expect(
      (await saveMarks(a.id, w.trainerAuth, [{ studentId: w.students[0]!.studentId, marks: -1 }]))
        .status,
    ).toBe(422);
  });

  it('saves marks within range, audits corrections old → new, and allows the maximum', async () => {
    const w = await world();
    const a = await newAssessment(w);
    const s0 = w.students[0]!.studentId;
    const first = await saveMarks(a.id, w.trainerAuth, [{ studentId: s0, marks: 50 }]);
    expect(first.status).toBe(200);
    expect(first.body.rows.find((r: { studentId: string }) => r.studentId === s0).marks).toBe(50);
    expect(first.body.assessment.recorded).toBe(1);

    await saveMarks(a.id, w.trainerAuth, [{ studentId: s0, marks: 42.5 }]);
    const log = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'RESULT_UPDATED', entityId: `${a.id}:${s0}` },
    });
    expect(log.oldValue).toMatchObject({ marks: 50 });
    expect(log.newValue).toMatchObject({ marks: 42.5 });
  });

  it('refuses lowering max below a result, and deleting an assessment with marks', async () => {
    const w = await world();
    const a = await newAssessment(w);
    await saveMarks(a.id, w.trainerAuth, [{ studentId: w.students[0]!.studentId, marks: 45 }]);
    const lower = await request(app)
      .patch(`/api/v1/assessments/${a.id}`)
      .set(w.trainerAuth)
      .send({ maxMarks: 40 });
    expect(lower.body.error.code).toBe('MAX_BELOW_RESULTS');
    expect(
      (await request(app).delete(`/api/v1/assessments/${a.id}`).set(w.trainerAuth)).body.error.code,
    ).toBe('HAS_RESULTS');
    const empty = await newAssessment(w, { title: 'Spare' });
    expect(
      (await request(app).delete(`/api/v1/assessments/${empty.id}`).set(w.trainerAuth)).status,
    ).toBe(204);
  });
});

describe('progress and evaluation (BRQ-6.3)', () => {
  it('records batch-wide and per-student milestones', async () => {
    const w = await world();
    await request(app)
      .post(`/api/v1/batches/${w.batch.id}/progress`)
      .set(w.trainerAuth)
      .send({ milestone: 'Module 1 complete' });
    await request(app).post(`/api/v1/batches/${w.batch.id}/progress`).set(w.trainerAuth).send({
      studentId: w.students[0]!.studentId,
      milestone: 'Wired a DB unaided',
      note: 'Neat work',
    });
    const list = await request(app)
      .get(`/api/v1/batches/${w.batch.id}/progress`)
      .set(w.trainerAuth);
    expect(list.body.map((p: { milestone: string }) => p.milestone)).toEqual([
      'Wired a DB unaided',
      'Module 1 complete',
    ]);
  });

  it('the batch trainer records and updates an evaluation; others are refused', async () => {
    const w = await world();
    const path = `/api/v1/enrollments/${w.students[0]!.enrollmentId}/evaluation`;
    const saved = await request(app)
      .put(path)
      .set(w.trainerAuth)
      .send({ remarks: 'Ready for certification', recommended: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ recommended: true });
    const updated = await request(app)
      .put(path)
      .set(w.trainerAuth)
      .send({ remarks: 'Needs more practice', recommended: false });
    expect(updated.body.recommended).toBe(false);
    expect(
      await prisma().auditLog.count({
        where: { action: 'EVALUATION_UPDATED', entityId: w.students[0]!.enrollmentId },
      }),
    ).toBe(1);

    const other = await createLoginUser(prisma(), Role.TRAINER);
    expect(
      (
        await request(app)
          .put(path)
          .set(await auth(other.email))
          .send({ remarks: 'xx x', recommended: true })
      ).status,
    ).toBe(403);
    const student = await auth(w.students[0]!.user.email);
    expect(
      (await request(app).put(path).set(student).send({ remarks: 'Me me me', recommended: true }))
        .status,
    ).toBe(403);

    await prisma().enrollment.update({
      where: { id: w.students[1]!.enrollmentId },
      data: { status: 'ALLOCATED' },
    });
    const notActive = await request(app)
      .put(`/api/v1/enrollments/${w.students[1]!.enrollmentId}/evaluation`)
      .set(w.trainerAuth)
      .send({ remarks: 'Too early', recommended: false });
    expect(notActive.body.error.code).toBe('NOT_IN_TRAINING');
  });
});

describe('My training (BRQ-5.3, BRQ-6.4, BO-4)', () => {
  it('shows live attendance, results, weighted aggregate and projected grade', async () => {
    const w = await world();
    const s0 = w.students[0]!;
    // Attendance: 1 of 2 sessions → 50 %.
    for (const [i, status] of (['PRESENT', 'ABSENT'] as const).entries()) {
      await request(app)
        .put(`/api/v1/sessions/${w.sessions[i]!.id}/attendance`)
        .set(w.trainerAuth)
        .send({
          entries: w.students.map((s) => ({
            studentId: s.studentId,
            status: s === s0 ? status : 'PRESENT',
          })),
        });
    }
    // 40/50 (80 %) × 30 + 18/20 (90 %) × 70 → 87.00 → A
    const a1 = await newAssessment(w, { maxMarks: 50, weightage: 30 });
    const a2 = await newAssessment(w, {
      title: 'Theory',
      mode: 'THEORY',
      maxMarks: 20,
      weightage: 70,
    });
    await saveMarks(a1.id, w.trainerAuth, [{ studentId: s0.studentId, marks: 40 }]);
    await saveMarks(a2.id, w.trainerAuth, [{ studentId: s0.studentId, marks: 18 }]);

    const res = await request(app)
      .get('/api/v1/students/me/training')
      .set(await auth(s0.user.email));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      attendance: { percent: 50, attended: 1, conducted: 2 },
      minAttendancePercent: 75,
      aggregate: 87,
      projectedGrade: 'A',
    });
    expect(res.body[0].results.map((r: { percent: number }) => r.percent)).toEqual([80, 90]);

    // Trainer of the batch may view; another student may not.
    expect(
      (await request(app).get(`/api/v1/students/${s0.studentId}/training`).set(w.trainerAuth))
        .status,
    ).toBe(200);
    const other = await auth(w.students[1]!.user.email);
    expect(
      (await request(app).get(`/api/v1/students/${s0.studentId}/training`).set(other)).status,
    ).toBe(403);
  });
});
