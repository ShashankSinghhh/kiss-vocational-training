import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../../../app';
import { disconnectPrisma, prisma } from '../../../core/db';
import { settings, type SettingKey } from '../../../core/settings';
import {
  createActiveBatch,
  createApprovedApplicants,
  createBatch,
  createLoginUser,
  createOpenCycle,
  uid,
} from '../../../../test/fixtures';
import { bearer, login } from '../../../../test/http';
import { DAILY_JOB, refreshAnalyticsAfterCertificate, runDaily } from '../automation.service';

const app = createApp();
let admin: Awaited<ReturnType<typeof createLoginUser>>;
let A: Record<string, string>;
// These tests read or change data across the whole shared test database (every cycle, waitlist or
// session), so their time grows with it. 1–2 s normally; on a large local database right after a
// restart, or behind the analytics refresh other suites start, they have passed 5 s.
jest.setTimeout(30_000);

beforeAll(async () => {
  admin = await createLoginUser(prisma(), Role.ADMIN);
  A = bearer((await login(app, admin.email)).accessToken);
});
afterAll(() => disconnectPrisma());

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
/**
 * The previous run "succeeded" at `lastSuccessAt` (default 5 s ago) and holds no lease, so the
 * next run's once-only notices cover just the time since: the shared test database is full of
 * other tests' cycles and students, which a one-day look-back would notify by the thousand.
 */
const freshJob = (lastSuccessAt = new Date(Date.now() - 5_000)) =>
  prisma().jobLock.upsert({
    where: { name: DAILY_JOB },
    create: { name: DAILY_JOB, runId: randomUUID(), lockedUntil: daysAgo(1), lastSuccessAt },
    update: { lockedUntil: daysAgo(1), lastSuccessAt },
  });
const notified = (userId: string, type: string) =>
  prisma().notification.findMany({ where: { userId, type } });

/** Runs fn with some settings changed, then puts every one back to its default. */
async function withSettings(values: Partial<Record<SettingKey, unknown>>, fn: () => Promise<void>) {
  const actor = { userId: admin.id };
  try {
    for (const [k, v] of Object.entries(values)) await settings.set(actor, k as SettingKey, v);
    await fn();
  } finally {
    for (const k of Object.keys(values)) {
      await prisma().setting.deleteMany({ where: { key: k } });
    }
    await settings.seedDefaults();
  }
}

describe('Automation page API (A1–A9)', () => {
  it('shows the settings and last run, changes them with audit rows, and is admin-only', async () => {
    const res = await request(app).get('/api/v1/admin/automation').set(A).expect(200);
    expect(res.body.settings).toMatchObject({
      autoCloseBatches: true,
      autoCloseAfterDays: 7,
      autoPromoteWaitlist: false,
      reminders: true,
      notices: true,
    });
    const changed = await request(app)
      .put('/api/v1/admin/automation')
      .set(A)
      .send({ ...res.body.settings, pendingReminderDays: 5 });
    expect(changed.status).toBe(200);
    expect(changed.body.pendingReminderDays).toBe(5);
    expect(
      await prisma().auditLog.count({
        where: { action: 'SETTING_UPDATED', entityId: 'automation.pendingReminderDays' },
      }),
    ).toBeGreaterThan(0);
    await request(app)
      .put('/api/v1/admin/automation')
      .set(A)
      .send({ ...res.body.settings, pendingReminderDays: 3 })
      .expect(200);
    expect(
      (
        await request(app)
          .put('/api/v1/admin/automation')
          .set(A)
          .send({ ...res.body.settings, autoCloseAfterDays: -1 })
      ).status,
    ).toBe(422);

    const trainer = await createLoginUser(prisma(), Role.TRAINER);
    const T = bearer((await login(app, trainer.email)).accessToken);
    expect((await request(app).get('/api/v1/admin/automation').set(T)).status).toBe(403);
  });

  it('Run now runs every step once and records the run', async () => {
    await freshJob();
    const res = await request(app)
      .post('/api/v1/admin/automation/run')
      .set(A)
      .set('Idempotency-Key', `k-${uid()}`)
      .expect(200);
    expect(res.body.ran).toBe(true);
    expect(res.body.result.steps.map((s: { step: string }) => s.step)).toEqual([
      'autoApproval',
      'waitlist',
      'autoClose',
      'reminders',
      'notices',
      'placementFollowUp',
    ]);
    const status = await request(app).get('/api/v1/admin/automation').set(A).expect(200);
    expect(status.body.lastRun.ranAt).toBe(res.body.result.ranAt);
  });
});

describe('A1: ready batches close automatically (BRQ-4.7, BR-25)', () => {
  it('closes a batch ended more than 7 days ago with every student decided, not a recent one', async () => {
    const db = prisma();
    const old = await createActiveBatch(db, { students: 1, sessions: 1 });
    const recent = await createActiveBatch(db, { students: 1, sessions: 1 });
    for (const w of [old, recent]) {
      await db.enrollment.update({
        where: { id: w.students[0]!.enrollmentId },
        data: { status: 'NOT_COMPLETED', reason: 'Left early' },
      });
    }
    await db.batch.update({ where: { id: old.batch.id }, data: { endDate: daysAgo(8) } });
    await db.batch.update({ where: { id: recent.batch.id }, data: { endDate: daysAgo(3) } });

    await freshJob();
    const run = await runDaily();
    expect(run.ran).toBe(true);
    const status = async (id: string) =>
      (await db.batch.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(old.batch.id)).toBe('CLOSED');
    expect(await status(recent.batch.id)).toBe('ACTIVE');
    expect(await notified(old.trainer.id, 'BATCH_CLOSED')).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { action: 'BATCH_CLOSED', entityId: old.batch.id, userId: null },
      }),
    ).toBe(1);
  });
});

describe('A7: automatic approval re-runs when its rules change (BRQ-3.5, BRQ-3.6)', () => {
  it('switching it on approves applications already waiting', async () => {
    const db = prisma();
    const { cycle, courses } = await createOpenCycle(db, 1);
    await db.course.update({
      where: { id: courses[0]!.id },
      data: { prerequisitesNeedReview: false },
    });
    const [e] = await createApprovedApplicants(db, cycle.id, [[courses[0]!.id]], {
      status: 'APPROVED',
    });
    await db.enrollment.update({ where: { id: e! }, data: { status: 'PENDING' } });
    try {
      await request(app)
        .put('/api/v1/admin/enrollments/auto-approval')
        .set(A)
        .send({ enabled: true, minCgpa: 0, manualIfPrerequisites: true })
        .expect(200);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: e! } })).status).toBe(
        'APPROVED',
      );
    } finally {
      await request(app)
        .put('/api/v1/admin/enrollments/auto-approval')
        .set(A)
        .send({ enabled: false, minCgpa: 0, manualIfPrerequisites: true });
    }
  });
});

describe('A2: a freed seat goes to the waitlist (BRQ-4.8, BR-04)', () => {
  it('withdrawing a student places the waitlisted applicant who ranked the course highest', async () => {
    const db = prisma();
    const { cycle, courses } = await createOpenCycle(db, 2);
    const [course, other] = [courses[0]!.id, courses[1]!.id];
    const b = await createBatch(db, cycle.id, course, 1);
    const [placed] = await createApprovedApplicants(db, cycle.id, [[course]]);
    // Earlier submission but second choice, then later submission but first choice.
    const [secondChoice, firstChoice] = await createApprovedApplicants(
      db,
      cycle.id,
      [
        [other, course],
        [course, other],
      ],
      { status: 'WAITLISTED' },
    );
    await request(app)
      .post(`/api/v1/admin/batches/${b.id}/students`)
      .set(A)
      .send({ enrollmentId: placed })
      .expect(200);

    await withSettings({ 'automation.autoPromoteWaitlist': true }, async () => {
      const res = await request(app)
        .post(`/api/v1/admin/batches/${b.id}/students/${placed}/withdraw`)
        .set(A)
        .set('Idempotency-Key', `k-${uid()}`)
        .send({ reason: 'Moved away' })
        .expect(200);
      expect(res.body.roster.map((r: { enrollmentId: string }) => r.enrollmentId)).toEqual([
        firstChoice,
      ]);
    });
    const status = async (id: string) =>
      (await db.enrollment.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(firstChoice!)).toBe('ALLOCATED');
    expect(await status(secondChoice!)).toBe('WAITLISTED');
  });

  it('does nothing while the switch is off (the default)', async () => {
    const db = prisma();
    const { cycle, courses } = await createOpenCycle(db, 1);
    const b = await createBatch(db, cycle.id, courses[0]!.id, 1);
    const [placed] = await createApprovedApplicants(db, cycle.id, [[courses[0]!.id]]);
    const [waiting] = await createApprovedApplicants(db, cycle.id, [[courses[0]!.id]], {
      status: 'WAITLISTED',
    });
    await request(app)
      .post(`/api/v1/admin/batches/${b.id}/students`)
      .set(A)
      .send({ enrollmentId: placed });
    await request(app)
      .delete(`/api/v1/admin/batches/${b.id}/students/${placed}`)
      .set(A)
      .expect(200);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: waiting! } })).status).toBe(
      'WAITLISTED',
    );
  });
});

describe('A3: daily reminders (BRQ-9.5)', () => {
  it('reminds the trainer of a session that ended unmarked, and admins of old applications', async () => {
    const db = prisma();
    const w = await createActiveBatch(db, { students: 1, sessions: 1 });
    const { cycle, courses } = await createOpenCycle(db, 1);
    const [e] = await createApprovedApplicants(db, cycle.id, [[courses[0]!.id]]);
    await db.enrollment.update({
      where: { id: e! },
      data: { status: 'PENDING', submittedAt: daysAgo(5) },
    });

    await freshJob();
    await runDaily();
    const reminder = await notified(w.trainer.id, 'REMINDER_ATTENDANCE');
    expect(reminder).toHaveLength(1);
    expect(reminder[0]!.data).toMatchObject({ count: '1' });
    expect(await notified(admin.id, 'REMINDER_PENDING_APPLICATIONS')).not.toHaveLength(0);
  });
});

describe('A4: notices to students (BRQ-9.6)', () => {
  it('tells the batch when a coming session is cancelled', async () => {
    const db = prisma();
    const w = await createActiveBatch(db, { students: 2, sessions: 1 });
    const startsAt = new Date(Date.now() + 2 * DAY);
    const s = await db.trainingSession.create({
      data: {
        batchId: w.batch.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 7_200_000),
        venue: 'Lab',
      },
    });
    await request(app)
      .patch(`/api/v1/admin/batches/${w.batch.id}/sessions/${s.id}`)
      .set(A)
      .send({ status: 'CANCELLED' })
      .expect(200);
    for (const st of w.students) {
      expect(await notified(st.user.id, 'SESSION_CANCELLED')).toHaveLength(1);
    }
    expect(await notified(w.trainer.id, 'SESSION_CANCELLED')).toHaveLength(1);
  });

  it('tells students without an application that a window opened, once', async () => {
    const db = prisma();
    const { cycle } = await createOpenCycle(db, 1);
    await db.courseOffering.updateMany({
      where: { cycleId: cycle.id },
      data: { enrollmentOpensAt: new Date(Date.now() - 2_000) },
    });
    const student = await createLoginUser(db, Role.STUDENT);

    await freshJob();
    await runDaily();
    const first = await notified(student.id, 'APPLICATIONS_OPEN');
    expect(
      first.filter((n) => (n.data as { cycleName?: string }).cycleName === cycle.name),
    ).toHaveLength(1);
    // The next run starts where this one ended: no second notice.
    await runDaily(new Date(Date.now() + 60_000));
    const again = await notified(student.id, 'APPLICATIONS_OPEN');
    expect(
      again.filter((n) => (n.data as { cycleName?: string }).cycleName === cycle.name),
    ).toHaveLength(1);
    // Every active student without an application gets the notice, and the shared test database
    // holds tens of thousands of them, so this test needs more than the default 5 s.
  }, 120_000);

  it('warns a student 7 days before a passport link expires', async () => {
    const db = prisma();
    const student = await createLoginUser(db, Role.STUDENT);
    await db.passportShare.create({
      data: {
        studentId: student.student!.id,
        tokenHash: `hash-${uid()}`,
        expiresAt: new Date(Date.now() + 7 * DAY - 2_000),
      },
    });
    await freshJob();
    await runDaily();
    expect(await notified(student.id, 'PASSPORT_LINK_EXPIRING')).toHaveLength(1);
  });
});

describe('A9: placement follow-up (BRQ-20.5)', () => {
  it('asks the admins about a placement that started 90 days ago', async () => {
    const db = prisma();
    const w = await createActiveBatch(db, { students: 1, sessions: 1 });
    const today = new Date(new Date().toISOString().slice(0, 10));
    const employer = `Employer ${uid()}`;
    await db.placementOutcome.create({
      data: {
        enrollmentId: w.students[0]!.enrollmentId,
        type: 'JOB',
        employer,
        roleTitle: 'Electrician',
        placedOn: new Date(today.getTime() - 90 * DAY),
        recordedById: admin.id,
      },
    });
    // From just before today's midnight (UTC), with student notices off for speed.
    await freshJob(new Date(today.getTime() - 1_000));
    await withSettings({ 'automation.notices': false }, async () => {
      await runDaily();
    });
    const asked = (await notified(admin.id, 'PLACEMENT_FOLLOW_UP')).filter(
      (n) => (n.data as { employer?: string }).employer === employer,
    );
    expect(asked).toHaveLength(1);
    // The run also covers placements other test runs created today and the reminders over the
    // shared test database, so it needs more than the default 5 s.
  }, 120_000);
});

describe('A8: analytics refresh after certificates (BRQ-20.4)', () => {
  it('refreshes when the figures are older than the limit, not right after a refresh', async () => {
    await prisma().jobLock.updateMany({
      where: { name: 'analytics-refresh' },
      data: { lastSuccessAt: daysAgo(1) },
    });
    expect(await refreshAnalyticsAfterCertificate()).toBe(true);
    expect(await refreshAnalyticsAfterCertificate()).toBe(false);
  });
});
