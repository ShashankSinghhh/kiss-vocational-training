import { existsSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { config } from '../../../core/config';
import { disconnectPrisma, prisma } from '../../../core/db';
import { setStorageForTests } from '../../../core/storage';
import { createActiveBatch, createAdmin, createLoginUser, uid } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';
import { PUBLIC_CODE_PATTERN } from '../../documents/code';

const app = createApp();
afterAll(() => disconnectPrisma());
afterEach(() => setStorageForTests(undefined));

const auth = async (email: string) => bearer((await login(app, email)).accessToken);

type World = Awaited<ReturnType<typeof world>>;

/**
 * An active batch with 4 conducted sessions and one mandatory assessment out of 50. Each
 * student's attendance count, marks and recommendation are set per test.
 */
async function world() {
  const db = prisma();
  const w = await createActiveBatch(db, { students: 2, sessions: 4 });
  await db.trainingSession.updateMany({
    where: { id: { in: w.sessions.map((s) => s.id) } },
    data: { status: 'CONDUCTED' },
  });
  const assessment = await db.assessment.create({
    data: {
      batchId: w.batch.id,
      title: 'Final practical',
      mode: 'PRACTICAL',
      maxMarks: 50,
      weightage: 1,
      isMandatory: true,
      createdById: w.trainer.id,
    },
  });
  const admin = await createLoginUser(db, Role.ADMIN);
  return { ...w, assessment, admin, adminAuth: await auth(admin.email) };
}

async function setStudent(
  w: World,
  i: number,
  o: { attended: number; marks?: number; recommended?: boolean },
) {
  const db = prisma();
  const s = w.students[i]!;
  await db.attendance.createMany({
    data: w.sessions.map((session, k) => ({
      sessionId: session.id,
      studentId: s.studentId,
      status: k < o.attended ? 'PRESENT' : 'ABSENT',
      markedById: w.trainer.id,
    })),
  });
  if (o.marks !== undefined) {
    await db.assessmentResult.create({
      data: {
        assessmentId: w.assessment.id,
        studentId: s.studentId,
        marks: o.marks,
        recordedById: w.trainer.id,
      },
    });
  }
  if (o.recommended !== undefined) {
    await db.evaluation.create({
      data: {
        enrollmentId: s.enrollmentId,
        remarks: 'Final evaluation',
        recommended: o.recommended,
        evaluatedById: w.trainer.id,
      },
    });
  }
  return s;
}

const approve = (w: World, enrollmentId: string, key = `k-${uid()}`) =>
  request(app)
    .post(`/api/v1/completions/${enrollmentId}/approve`)
    .set(w.adminAuth)
    .set('Idempotency-Key', key)
    .send();

const storedFile = (key: string) =>
  path.join(path.resolve(config().STORAGE_LOCAL_DIR), ...key.split('/'));

describe('completion queue (BRQ-9.4)', () => {
  it('shows every student with the computed checks and reasons; admin only', async () => {
    const w = await world();
    await setStudent(w, 0, { attended: 3, marks: 40, recommended: true }); // 75 %, 80 %
    await setStudent(w, 1, { attended: 2 }); // 50 %, no marks, no evaluation

    const res = await request(app)
      .get('/api/v1/completions/queue')
      .query({ batchId: w.batch.id })
      .set(w.adminAuth);
    expect(res.status).toBe(200);
    const byId = new Map((res.body as Array<{ studentId: string }>).map((r) => [r.studentId, r]));
    expect(byId.get(w.students[0]!.studentId)).toMatchObject({
      status: 'ACTIVE',
      eligible: true,
      attendancePercent: 75,
      aggregate: 80,
      grade: 'B',
      certificate: null,
    });
    expect(byId.get(w.students[1]!.studentId)).toMatchObject({
      eligible: false,
      checks: [
        { rule: 'ATTENDANCE', passed: false, actual: 50, required: 75 },
        { rule: 'SESSIONS_RECORDED', passed: true, actual: 0, required: 0 },
        { rule: 'MANDATORY_ASSESSMENTS', passed: false, actual: 0, required: 1 },
        { rule: 'AGGREGATE', passed: false, actual: null, required: 40 },
        { rule: 'RECOMMENDATION', passed: false, actual: null, required: true },
      ],
    });
    // T1: the admin sees which mandatory assessment still lacks marks.
    const mandatory = (
      byId.get(w.students[1]!.studentId) as unknown as {
        checks: Array<{ rule: string; missing?: string[] }>;
      }
    ).checks.find((c) => c.rule === 'MANDATORY_ASSESSMENTS');
    expect(mandatory?.missing).toHaveLength(1);

    // TC-15: students and trainers can't reach the admin queue.
    const studentAuth = await auth(w.students[0]!.user.email);
    expect(
      (
        await request(app)
          .get('/api/v1/completions/queue')
          .query({ batchId: w.batch.id })
          .set(studentAuth)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/completions/${w.students[0]!.enrollmentId}/approve`)
          .set(await auth(w.trainer.email))
          .set('Idempotency-Key', uid())
          .send()
      ).status,
    ).toBe(403);
  });
});

describe('approve → certificate (TAD §8.1)', () => {
  it('ineligible → 409 NOT_ELIGIBLE with the failing checks, and nothing is saved', async () => {
    const w = await world();
    // 2 of 4 = 50 %; marks and recommendation fine.
    const s = await setStudent(w, 0, { attended: 2, marks: 45, recommended: true });

    const res = await approve(w, s.enrollmentId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
    expect(res.body.error.details).toEqual([{ path: 'ATTENDANCE', message: '50 / 75' }]);

    const db = prisma();
    expect(await db.certificate.count({ where: { enrollmentId: s.enrollmentId } })).toBe(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } })).status).toBe(
      'ACTIVE',
    );
    expect(
      await db.auditLog.count({ where: { entity: 'Enrollment', entityId: s.enrollmentId } }),
    ).toBe(0);
  });

  it('not recommended → 409 even with perfect figures', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 4, marks: 50, recommended: false });
    const res = await approve(w, s.enrollmentId);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'RECOMMENDATION', message: 'false / true' }]);
  });

  it('L2: a session that ended without being marked blocks completion until it is marked', async () => {
    const w = await world();
    const db = prisma();
    const s = await setStudent(w, 0, { attended: 4, marks: 50, recommended: true });
    // The student joined before training started; one more session has ended, never marked.
    await db.batchStudent.update({
      where: { enrollmentId: s.enrollmentId },
      data: { allocatedAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    const endsAt = new Date(Date.now() - 3_600_000);
    await db.trainingSession.create({
      data: {
        batchId: w.batch.id,
        startsAt: new Date(endsAt.getTime() - 7_200_000),
        endsAt,
        venue: 'Lab 1',
      },
    });

    const res = await approve(w, s.enrollmentId);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'SESSIONS_RECORDED', message: '1 / 0' }]);
    const summary = await request(app)
      .get(`/api/v1/batches/${w.batch.id}/attendance-summary`)
      .set(w.adminAuth);
    expect(
      summary.body.find((r: { studentId: string }) => r.studentId === s.studentId),
    ).toMatchObject({ percent: 100, unrecorded: 1 });
  });

  it('TC-16: eligible → COMPLETED and certificate in one step, then PDF stored and CERTIFIED (BRQ-7.3)', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 3, marks: 44, recommended: true }); // 75 %, 88 %

    const res = await approve(w, s.enrollmentId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      enrollmentId: s.enrollmentId,
      status: 'CERTIFIED',
      certificate: { status: 'VALID', rendered: true },
    });
    expect(res.body.certificate.publicCode).toMatch(PUBLIC_CODE_PATTERN);

    const db = prisma();
    const cert = await db.certificate.findUniqueOrThrow({ where: { id: res.body.certificate.id } });
    expect(cert).toMatchObject({ grade: 'A', status: 'VALID', issuedById: w.admin.id });
    expect(Number(cert.aggregatePercent)).toBe(88);
    expect(Number(cert.attendancePercent)).toBe(75);
    expect(cert.pdfObjectKey).toBe(`certificates/${cert.id}.pdf`);
    expect(existsSync(storedFile(cert.pdfObjectKey!))).toBe(true);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } })).status).toBe(
      'CERTIFIED',
    );

    const actions = (
      await db.auditLog.findMany({
        where: { entityId: { in: [s.enrollmentId, cert.id] } },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'ENROLLMENT_COMPLETED',
      'CERTIFICATE_ISSUED',
      'CERTIFICATE_RENDERED',
      'ENROLLMENT_CERTIFIED',
    ]);
    const notes = await db.notification.findMany({
      where: { userId: w.students[0]!.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(notes.map((n) => n.type)).toEqual(['TRAINING_COMPLETED', 'CERTIFICATE_ISSUED']);

    // The register lists it, searchable by code.
    const list = await request(app)
      .get('/api/v1/certificates')
      .query({ q: cert.publicCode })
      .set(w.adminAuth);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      publicCode: cert.publicCode,
      studentName: w.students[0]!.user.fullName,
      grade: 'A',
      rendered: true,
    });
  });

  it('a replayed Idempotency-Key returns the same result; a new key gets 409; one certificate', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 4, marks: 30, recommended: true });
    const first = await approve(w, s.enrollmentId, 'same-key-1');
    const replay = await approve(w, s.enrollmentId, 'same-key-1');
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const again = await approve(w, s.enrollmentId, 'another-key');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_COMPLETED');
    expect(await prisma().certificate.count({ where: { enrollmentId: s.enrollmentId } })).toBe(1);
  });

  it('render failure leaves COMPLETED; the admin retries and it becomes CERTIFIED', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 4, marks: 25, recommended: true });
    setStorageForTests({
      put: () => Promise.reject(new Error('storage down')),
      get: () => Promise.resolve(null),
      stat: () => Promise.resolve(null),
      uploadTarget: () => Promise.reject(new Error('storage down')),
      signedUrl: () => Promise.reject(new Error('storage down')),
    });

    const res = await approve(w, s.enrollmentId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', certificate: { rendered: false } });
    const id = res.body.certificate.id as string;
    expect(
      (await request(app).get(`/api/v1/certificates/${id}/download`).set(w.adminAuth)).body.error
        .code,
    ).toBe('CERTIFICATE_NOT_RENDERED');

    setStorageForTests(undefined);
    const retry = await request(app).post(`/api/v1/certificates/${id}/render`).set(w.adminAuth);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: 'CERTIFIED', certificate: { rendered: true } });
    // Retrying again is harmless.
    expect(
      (await request(app).post(`/api/v1/certificates/${id}/render`).set(w.adminAuth)).body.status,
    ).toBe('CERTIFIED');
  });

  it('TC-17: the student downloads their own PDF; other students and trainers get 403', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 4, marks: 40, recommended: true });
    const id = (await approve(w, s.enrollmentId)).body.certificate.id as string;

    const own = await request(app)
      .get(`/api/v1/certificates/${id}/download`)
      .set(await auth(w.students[0]!.user.email))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.headers['content-disposition']).toMatch(/^attachment; filename="certificate-/);
    expect((own.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const mine = await request(app)
      .get('/api/v1/students/me/certificates')
      .set(await auth(w.students[0]!.user.email));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ id, rendered: true });

    for (const email of [w.students[1]!.user.email, w.trainer.email]) {
      expect(
        (
          await request(app)
            .get(`/api/v1/certificates/${id}/download`)
            .set(await auth(email))
        ).status,
      ).toBe(403);
    }
    expect(
      (await request(app).get(`/api/v1/certificates/${id}/download`).set(w.adminAuth)).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v1/certificates/00000000-0000-4000-8000-000000000000/download')
          .set(w.adminAuth)
      ).status,
    ).toBe(404);
  });
});

describe('not completed', () => {
  it('records the reason; the student is no longer in training; approve can revisit it', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 1, marks: 10, recommended: false });
    const res = await request(app)
      .post(`/api/v1/completions/${s.enrollmentId}/not-completed`)
      .set(w.adminAuth)
      .set('Idempotency-Key', uid())
      .send({ reason: 'Attendance below 75 %' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enrollmentId: s.enrollmentId,
      status: 'NOT_COMPLETED',
      reason: 'Attendance below 75 %',
    });
    const e = await prisma().enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } });
    expect(e).toMatchObject({ status: 'NOT_COMPLETED', reason: 'Attendance below 75 %' });

    const twice = await request(app)
      .post(`/api/v1/completions/${s.enrollmentId}/not-completed`)
      .set(w.adminAuth)
      .set('Idempotency-Key', uid())
      .send({ reason: 'Again' });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('NOT_IN_TRAINING');

    expect(
      (
        await request(app)
          .post(`/api/v1/completions/${s.enrollmentId}/not-completed`)
          .set(w.adminAuth)
          .set('Idempotency-Key', uid())
          .send({ reason: 'x' })
      ).status,
    ).toBe(422);
  });

  it('a public code collision is impossible by schema: codes are unique in the database', async () => {
    const w = await world();
    const s = await setStudent(w, 0, { attended: 4, marks: 50, recommended: true });
    const code = (await approve(w, s.enrollmentId)).body.certificate.publicCode as string;
    const other = await setStudent(w, 1, { attended: 4, marks: 50, recommended: true });
    const admin = await createAdmin(prisma());
    await expect(
      prisma().certificate.create({
        data: {
          enrollmentId: other.enrollmentId,
          publicCode: code,
          grade: 'A',
          aggregatePercent: 100,
          attendancePercent: 100,
          issuedById: admin.id,
        },
      }),
    ).rejects.toThrow();
  });
});
