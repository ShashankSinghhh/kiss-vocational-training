import request from 'supertest';
import { Role } from '@prisma/client';
import type { AttendanceStatus } from '@vtmp/shared';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { createActiveBatch, createLoginUser } from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';

const app = createApp();
afterAll(() => disconnectPrisma());

const auth = async (email: string) => bearer((await login(app, email)).accessToken);

async function world(opts?: { students?: number; sessions?: number }) {
  const w = await createActiveBatch(prisma(), opts);
  return { ...w, trainerAuth: await auth(w.trainer.email) };
}

const put = (
  sessionId: string,
  a: Record<string, string>,
  entries: Array<{ studentId: string; status: AttendanceStatus }>,
  reason?: string,
) =>
  request(app)
    .put(`/api/v1/sessions/${sessionId}/attendance`)
    .set(a)
    .send({ entries, ...(reason ? { reason } : {}) });

const all = (students: Array<{ studentId: string }>, status: AttendanceStatus = 'PRESENT') =>
  students.map((s) => ({ studentId: s.studentId, status }));

/** Moves the session's first marking into the past to test the 48 h window. */
async function markedAgo(sessionId: string, minutes: number) {
  await prisma().attendance.updateMany({
    where: { sessionId },
    data: { firstMarkedAt: new Date(Date.now() - minutes * 60_000) },
  });
}

describe('taking attendance (BRQ-5.1, BR-05, BR-06)', () => {
  it('the assigned trainer marks the whole roster; the session becomes CONDUCTED; audited', async () => {
    const w = await world();
    const sheet = await request(app)
      .get(`/api/v1/sessions/${w.sessions[0]!.id}/attendance`)
      .set(w.trainerAuth);
    expect(sheet.status).toBe(200);
    expect(sheet.body).toMatchObject({ canEdit: true, firstMarkedAt: null, lockedReason: null });
    expect(sheet.body.rows).toHaveLength(3);

    const res = await put(w.sessions[0]!.id, w.trainerAuth, [
      { studentId: w.students[0]!.studentId, status: 'PRESENT' },
      { studentId: w.students[1]!.studentId, status: 'LATE' },
      { studentId: w.students[2]!.studentId, status: 'ABSENT' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('CONDUCTED');
    expect(res.body.editableUntil).toEqual(expect.any(String));
    expect(
      await prisma().auditLog.count({
        where: { action: 'ATTENDANCE_MARKED', entityId: { startsWith: w.sessions[0]!.id } },
      }),
    ).toBe(3);
  });

  it('requires every student in the batch exactly once', async () => {
    const w = await world();
    const partial = await put(w.sessions[0]!.id, w.trainerAuth, all(w.students.slice(0, 2)));
    expect(partial.status).toBe(422);
    expect(partial.body.error.code).toBe('ROSTER_MISMATCH');
    const stranger = await createLoginUser(prisma(), Role.STUDENT);
    const extra = await put(w.sessions[0]!.id, w.trainerAuth, [
      ...all(w.students),
      { studentId: stranger.student!.id, status: 'PRESENT' },
    ]);
    expect(extra.body.error.code).toBe('ROSTER_MISMATCH');
  });

  it('a deactivated student drops off later sheets but stays where already marked (T2)', async () => {
    const w = await world({ sessions: 2 });
    const [first, second] = w.sessions;
    await put(first!.id, w.trainerAuth, all(w.students)).expect(200);
    const gone = w.students[2]!;
    await prisma().user.update({ where: { id: gone.user.id }, data: { isActive: false } });

    const later = await request(app)
      .get(`/api/v1/sessions/${second!.id}/attendance`)
      .set(w.trainerAuth);
    expect(later.body.rows.map((r: { studentId: string }) => r.studentId)).not.toContain(
      gone.studentId,
    );
    // Saving without them is fine now.
    expect((await put(second!.id, w.trainerAuth, all(w.students.slice(0, 2)))).status).toBe(200);
    // The earlier session still shows their mark.
    const earlier = await request(app)
      .get(`/api/v1/sessions/${first!.id}/attendance`)
      .set(w.trainerAuth);
    expect(earlier.body.rows).toHaveLength(3);
  });

  it('refuses sessions that have not started, cancelled sessions and inactive batches', async () => {
    const w = await world();
    const future = await prisma().trainingSession.create({
      data: {
        batchId: w.batch.id,
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
        venue: 'X',
      },
    });
    expect((await put(future.id, w.trainerAuth, all(w.students))).body.error.code).toBe(
      'SESSION_NOT_STARTED',
    );

    await prisma().trainingSession.update({
      where: { id: w.sessions[1]!.id },
      data: { status: 'CANCELLED' },
    });
    expect((await put(w.sessions[1]!.id, w.trainerAuth, all(w.students))).body.error.code).toBe(
      'SESSION_CANCELLED',
    );

    await prisma().batch.update({ where: { id: w.batch.id }, data: { status: 'PLANNED' } });
    expect((await put(w.sessions[0]!.id, w.trainerAuth, all(w.students))).body.error.code).toBe(
      'BATCH_NOT_ACTIVE',
    );
  });

  it('another trainer gets 403 and a student cannot open the sheet (TC-08)', async () => {
    const w = await world();
    const other = await createLoginUser(prisma(), Role.TRAINER);
    const otherAuth = await auth(other.email);
    expect((await put(w.sessions[0]!.id, otherAuth, all(w.students))).status).toBe(403);
    expect(
      (await request(app).get(`/api/v1/sessions/${w.sessions[0]!.id}/attendance`).set(otherAuth))
        .status,
    ).toBe(403);
    const studentAuth = await auth(w.students[0]!.user.email);
    expect(
      (await request(app).get(`/api/v1/sessions/${w.sessions[0]!.id}/attendance`).set(studentAuth))
        .status,
    ).toBe(403);
  });
});

describe('48-hour edit window (BR-06, BRQ-5.2)', () => {
  it('trainer may edit at 47h59; is refused at 48h01 (TC-11)', async () => {
    const w = await world();
    const sid = w.sessions[0]!.id;
    await put(sid, w.trainerAuth, all(w.students));

    await markedAgo(sid, 47 * 60 + 59);
    const ok = await put(sid, w.trainerAuth, all(w.students, 'LATE'));
    expect(ok.status).toBe(200);
    expect(
      await prisma().auditLog.count({
        where: { action: 'ATTENDANCE_EDITED', entityId: { startsWith: sid } },
      }),
    ).toBe(3);

    await markedAgo(sid, 48 * 60 + 1);
    const late = await put(sid, w.trainerAuth, all(w.students, 'ABSENT'));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('EDIT_WINDOW_CLOSED');
    const sheet = await request(app).get(`/api/v1/sessions/${sid}/attendance`).set(w.trainerAuth);
    expect(sheet.body).toMatchObject({ canEdit: false, lockedReason: 'WINDOW_CLOSED' });
  });

  it('L3: a session nobody marked closes to the trainer 48 h after it ended', async () => {
    const w = await world({ students: 1, sessions: 1 });
    const sid = w.sessions[0]!.id;
    const endsAt = new Date(Date.now() - (48 * 60 + 1) * 60_000);
    await prisma().trainingSession.update({
      where: { id: sid },
      data: { startsAt: new Date(endsAt.getTime() - 7_200_000), endsAt },
    });
    const late = await put(sid, w.trainerAuth, all(w.students));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('EDIT_WINDOW_CLOSED');
    const sheet = await request(app).get(`/api/v1/sessions/${sid}/attendance`).set(w.trainerAuth);
    expect(sheet.body).toMatchObject({ canEdit: false, lockedReason: 'WINDOW_CLOSED' });
    expect(new Date(sheet.body.editableUntil).getTime()).toBe(endsAt.getTime() + 48 * 3_600_000);
  });

  it('after the window only an admin may edit, with a reason, logged old → new (TC-12, BRQ-19.1)', async () => {
    const w = await world();
    const sid = w.sessions[0]!.id;
    await put(sid, w.trainerAuth, all(w.students));
    await markedAgo(sid, 49 * 60);
    const adminUser = await createLoginUser(prisma(), Role.ADMIN);
    const adminAuth = await auth(adminUser.email);

    const sheet = await request(app).get(`/api/v1/sessions/${sid}/attendance`).set(adminAuth);
    expect(sheet.body).toMatchObject({ canEdit: true, requiresReason: true });

    const entries = [
      { studentId: w.students[0]!.studentId, status: 'ABSENT' as const },
      ...all(w.students.slice(1)),
    ];
    const noReason = await put(sid, adminAuth, entries);
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const ok = await put(sid, adminAuth, entries, 'Medical certificate showed absence');
    expect(ok.status).toBe(200);
    const log = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'ATTENDANCE_OVERRIDDEN', entityId: `${sid}:${w.students[0]!.studentId}` },
    });
    expect(log).toMatchObject({
      userId: adminUser.id,
      oldValue: { status: 'PRESENT' },
      newValue: { status: 'ABSENT', reason: 'Medical certificate showed absence' },
    });
  });
});

describe('attendance figures (BR-08, BRQ-5.3)', () => {
  it('computes % to two decimals, absences and consecutive absences; LATE counts as present', async () => {
    const w = await world({ students: 2, sessions: 3 });
    const [a, b] = w.students as [(typeof w.students)[0], (typeof w.students)[0]];
    await put(w.sessions[0]!.id, w.trainerAuth, [
      { studentId: a.studentId, status: 'PRESENT' },
      { studentId: b.studentId, status: 'PRESENT' },
    ]);
    await put(w.sessions[1]!.id, w.trainerAuth, [
      { studentId: a.studentId, status: 'LATE' },
      { studentId: b.studentId, status: 'ABSENT' },
    ]);
    await put(w.sessions[2]!.id, w.trainerAuth, [
      { studentId: a.studentId, status: 'ABSENT' },
      { studentId: b.studentId, status: 'ABSENT' },
    ]);

    const summary = await request(app)
      .get(`/api/v1/batches/${w.batch.id}/attendance-summary`)
      .set(w.trainerAuth);
    expect(summary.status).toBe(200);
    const byId = Object.fromEntries(
      summary.body.map((r: { studentId: string }) => [r.studentId, r]),
    );
    expect(byId[a.studentId]).toMatchObject({
      attended: 2,
      conducted: 3,
      percent: 66.67,
      absences: 1,
      consecutiveAbsences: 1,
    });
    expect(byId[b.studentId]).toMatchObject({
      attended: 1,
      conducted: 3,
      percent: 33.33,
      absences: 2,
      consecutiveAbsences: 2,
    });

    const mine = await request(app)
      .get('/api/v1/students/me/attendance')
      .set(await auth(a.user.email));
    expect(mine.status).toBe(200);
    expect(mine.body[0].figures.percent).toBe(66.67);
    expect(mine.body[0].sessions.map((s: { attendance: string }) => s.attendance)).toEqual([
      'PRESENT',
      'LATE',
      'ABSENT',
    ]);
  });

  it("a student cannot read another student's attendance", async () => {
    const w = await world({ students: 2 });
    const res = await request(app)
      .get(`/api/v1/students/${w.students[1]!.studentId}/attendance`)
      .set(await auth(w.students[0]!.user.email));
    expect(res.status).toBe(403);
  });

  it("lists a trainer's own sessions", async () => {
    const w = await world();
    const res = await request(app).get('/api/v1/sessions/mine').set(w.trainerAuth);
    expect(res.status).toBe(200);
    expect(res.body.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining(w.sessions.map((s) => s.id)),
    );
    expect(res.body[0]).toMatchObject({ batchName: w.batch.name, rosterSize: 3 });
  });
});
