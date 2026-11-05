import type { PrismaClient } from '@prisma/client';
import { audit } from '../core/audit';
import * as completion from '../modules/completion/completion.service';
import * as documents from '../modules/documents/documents.service';
import * as intervention from '../modules/intervention/intervention.service';
import { ADMIN, PROGRAMMES, TRAINERS, makeStudents } from './data';

/**
 * A demo cycle that replicates the current curriculum (every programme, course and batch) with
 * a term of history, so every feature has data to show: five finished batches with each
 * completion outcome (certified A–D, low attendance, failed, not recommended, withdrawn, a
 * batch blocked by one unmarked session, a revoked and a reissued certificate), five running
 * batches with a session today and students at every risk level, and an application queue
 * with rejected, waitlisted, pending and withdrawn applications. Students 001–005 stay free for
 * the live apply demo. Certificates go through the real approval (grade, PDF, QR code).
 */
export const DEMO_CYCLE = 'Demo Cycle 2026';

const DAY = 24 * 60 * 60 * 1000;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SESSION_MS = 3 * 60 * 60 * 1000;
/** 10:00 IST in UTC. */
const START_UTC = { h: 4, m: 30 };

const FINISHED = ['CDS-COMP', 'ACH-TERRA', 'MFG-TAILOR', 'AGL-FISH', 'PLS-SOFT'];
const RUNNING = ['CDS-DIGI', 'ACH-EMBROID', 'MFG-BAKERY', 'AGL-NATURAL', 'PLS-MEDATT'];
/** In this batch the trainer forgot to mark the last session, so nobody can complete yet. */
const UNMARKED_BATCH = 'PLS-SOFT';

/** Finished batches: per seat, the target attendance, aggregate % and outcome. */
const FINISHED_SEATS = [
  { att: 0.97, pct: 91, rec: true, end: 'approve' }, // A
  { att: 0.93, pct: 77, rec: true, end: 'approve' }, // B
  { att: 0.9, pct: 62, rec: true, end: 'approve' }, // C
  { att: 0.86, pct: 47, rec: true, end: 'approve' }, // D
  { att: 0.95, pct: 86, rec: true, end: 'approve' }, // A (revoked / reissued in two batches)
  { att: 0.64, pct: 68, rec: true, end: 'lowAttendance' },
  { att: 0.88, pct: 31, rec: true, end: 'failed' },
  { att: 0.9, pct: 66, rec: false, end: 'queue' }, // not recommended: waits in the queue
  { att: 0.9, pct: 70, rec: true, end: 'withdrawn' },
] as const;

/** Running batches: per seat, the attendance so far and marks %. */
const RUNNING_SEATS = [
  { att: 0.96, pct: 88 },
  { att: 0.93, pct: 79 },
  { att: 0.91, pct: 72 },
  { att: 0.9, pct: 64 },
  { att: 0.78, pct: 70 }, // medium risk: attendance just under 80 %
  { att: 0.62, pct: 58 }, // high risk: attendance under 75 %
  { att: 0.9, pct: 66, lastAbsent: 3 }, // three absences in a row
  { att: 0.92, pct: 32 }, // low marks
] as const;

const ASSESSMENTS = [
  { title: 'Basics quiz', mode: 'THEORY', maxMarks: 20, weightage: 1, at: 0.2 },
  { title: 'Practical task', mode: 'PRACTICAL', maxMarks: 50, weightage: 2, at: 0.55 },
  { title: 'Final assessment', mode: 'THEORY', maxMarks: 100, weightage: 3, at: 0.95 },
] as const;

/** Deterministic 0–1 value for (a, b), so every run makes the same data. */
const hash = (a: number, b: number) => ((((a * 7919 + b * 104729) % 1000) + 1000) % 1000) / 1000;

export async function seedDemoCycle(prisma: PrismaClient, log: (m: string) => void) {
  if (await prisma.trainingCycle.findUnique({ where: { name: DEMO_CYCLE } })) {
    log(`demo: "${DEMO_CYCLE}" already exists (remove it first with --remove-demo-cycle)`);
    return;
  }
  const now = new Date();
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  const actor = { userId: admin.id };
  const trainerUsers = await prisma.user.findMany({
    where: { email: { in: TRAINERS.map((t) => t.email) } },
    include: { trainer: true },
  });
  const trainerFor = (code: string) => {
    const i = PROGRAMMES.findIndex((p) => p.courses.some((c) => c.code === code));
    const u = trainerUsers.find((t) => t.email === TRAINERS[i]!.email)!;
    return { userId: u.id, trainerId: u.trainer!.id };
  };
  const courses = await prisma.course.findMany({
    where: { code: { in: PROGRAMMES.flatMap((p) => p.courses.map((c) => c.code)) } },
  });
  const course = (code: string) => courses.find((c) => c.code === code)!;
  const seeded = makeStudents();
  const studentRows = await prisma.student.findMany({
    where: { rollNo: { in: seeded.map((s) => s.rollNo) } },
    select: { id: true, rollNo: true },
  });
  const studentId = (n: number) => studentRows.find((s) => s.rollNo === seeded[n - 1]!.rollNo)!.id;

  const cycleStart = d('2026-07-01');
  const finishedStart = d('2026-07-06');
  const finishedEnd = d('2026-10-30');
  const runningStart = d('2026-10-05');
  const runningEnd = d('2026-11-27');

  const plan: Array<{ enrollmentId: string; seat: (typeof FINISHED_SEATS)[number]; code: string }> =
    [];

  await prisma.$transaction(
    async (tx) => {
      const cycle = await tx.trainingCycle.create({
        data: { name: DEMO_CYCLE, startsOn: cycleStart, endsOn: d('2026-11-30') },
      });
      for (const c of courses) {
        await tx.courseOffering.create({
          data: {
            courseId: c.id,
            cycleId: cycle.id,
            enrollmentOpensAt: d('2026-06-01'),
            enrollmentClosesAt: d('2026-06-25'),
            isOpen: false,
          },
        });
      }

      const enrol = async (
        n: number,
        code: string,
        status: 'ACTIVE' | 'REJECTED' | 'WAITLISTED' | 'PENDING' | 'WITHDRAWN',
        reason: string | null = null,
      ) =>
        tx.enrollment.create({
          data: {
            studentId: studentId(n),
            cycleId: cycle.id,
            status,
            reason,
            submittedAt: new Date(d('2026-06-10').getTime() + n * 60_000),
            decidedAt: status === 'PENDING' ? null : d('2026-06-26'),
            decidedById: status === 'PENDING' || status === 'WITHDRAWN' ? null : admin.id,
            preferences: { create: { courseId: course(code).id, rank: 1 } },
          },
        });

      // All 30 batches; the ones not run this cycle are closed with nobody in them.
      let next = 6;
      for (const p of PROGRAMMES) {
        for (const c of p.courses) {
          const finished = FINISHED.includes(c.code);
          const running = RUNNING.includes(c.code);
          const t = trainerFor(c.code);
          const start = running ? runningStart : finishedStart;
          const end = running ? runningEnd : finishedEnd;
          const batch = await tx.batch.create({
            data: {
              courseId: course(c.code).id,
              cycleId: cycle.id,
              name: 'Batch A',
              capacity: c.seatCapacity,
              startDate: start,
              endDate: end,
              venue: `${p.name} block`,
              status: finished || running ? 'ACTIVE' : 'CLOSED',
              trainers: { create: { trainerId: t.trainerId } },
            },
          });
          if (!finished && !running) continue;

          const seats = finished ? FINISHED_SEATS : RUNNING_SEATS;
          const placed: Array<{ studentId: string; enrollmentId: string; seat: number }> = [];
          for (let i = 0; i < seats.length; i++) {
            const n = next++;
            const seat = seats[i]!;
            const withdrawn =
              finished && (seat as (typeof FINISHED_SEATS)[number]).end === 'withdrawn';
            const e = await enrol(
              n,
              c.code,
              withdrawn ? 'WITHDRAWN' : 'ACTIVE',
              withdrawn ? 'Left the programme to join family work' : null,
            );
            await tx.batchStudent.create({
              data: {
                batchId: batch.id,
                enrollmentId: e.id,
                studentId: studentId(n),
                allocatedAt: d('2026-06-28'),
              },
            });
            placed.push({ studentId: studentId(n), enrollmentId: e.id, seat: i });
            if (finished) {
              plan.push({
                enrollmentId: e.id,
                seat: seat as (typeof FINISHED_SEATS)[number],
                code: c.code,
              });
            }
          }

          // Sessions: Mon/Wed/Thu, 10:00–13:00 IST. Past ones conducted and marked.
          const days: Date[] = [];
          for (let t0 = start.getTime(); t0 <= end.getTime(); t0 += DAY) {
            const wd = new Date(t0).getUTCDay();
            if (wd === 1 || wd === 3 || wd === 4) days.push(new Date(t0));
          }
          const past = days.filter((x) => x.getTime() + 8 * 3600_000 < now.getTime());
          const withdrawAt = d('2026-08-20').getTime();
          for (const [k, day] of days.entries()) {
            const startsAt = new Date(day);
            startsAt.setUTCHours(START_UTC.h, START_UTC.m);
            const ended = startsAt.getTime() + SESSION_MS < now.getTime();
            const unmarked = c.code === UNMARKED_BATCH && k === days.length - 1;
            const s = await tx.trainingSession.create({
              data: {
                batchId: batch.id,
                trainerId: t.trainerId,
                startsAt,
                endsAt: new Date(startsAt.getTime() + SESSION_MS),
                venue: `${p.name} block`,
                topic: `Module ${Math.floor(k / 6) + 1}`,
                status: ended && !unmarked ? 'CONDUCTED' : 'SCHEDULED',
              },
            });
            if (!ended || unmarked) continue;
            const markedAt = new Date(startsAt.getTime() + SESSION_MS);
            const rows = placed
              .filter((pl) => {
                const seat = seats[pl.seat] as { end?: string };
                return !(finished && seat.end === 'withdrawn' && day.getTime() > withdrawAt);
              })
              .map((pl) => {
                const seat = seats[pl.seat] as { att: number; lastAbsent?: number };
                const fromEnd = past.length - 1 - k;
                const absent =
                  (seat.lastAbsent !== undefined && fromEnd >= 0 && fromEnd < seat.lastAbsent) ||
                  hash(pl.seat + next, k) > seat.att;
                return {
                  sessionId: s.id,
                  studentId: pl.studentId,
                  status: absent ? 'ABSENT' : hash(k, pl.seat) > 0.93 ? 'LATE' : 'PRESENT',
                  markedById: t.userId,
                  firstMarkedAt: markedAt,
                  markedAt,
                } as const;
              });
            await tx.attendance.createMany({ data: rows });
          }

          // Assessments: held ones have marks; a running batch's final is still to come.
          const span = end.getTime() - start.getTime();
          for (const a of ASSESSMENTS) {
            const heldOn = new Date(start.getTime() + a.at * span);
            const held = heldOn.getTime() < now.getTime();
            const created = await tx.assessment.create({
              data: {
                batchId: batch.id,
                title: a.title,
                mode: a.mode,
                maxMarks: a.maxMarks,
                weightage: a.weightage,
                isMandatory: true,
                heldOn: held ? heldOn : null,
                createdById: t.userId,
              },
            });
            if (!held) continue;
            const rows = placed
              .filter((pl) => {
                const seat = seats[pl.seat] as { end?: string };
                return !(finished && seat.end === 'withdrawn' && heldOn.getTime() > withdrawAt);
              })
              .map((pl) => {
                const pct =
                  (seats[pl.seat] as { pct: number }).pct + (hash(pl.seat, a.weightage) - 0.5) * 4;
                return {
                  assessmentId: created.id,
                  studentId: pl.studentId,
                  marks: Math.round(Math.min(100, Math.max(0, pct)) * a.maxMarks) / 100,
                  recordedById: t.userId,
                };
              });
            await tx.assessmentResult.createMany({ data: rows });
          }

          if (finished) {
            await tx.evaluation.createMany({
              data: placed
                .filter((pl) => FINISHED_SEATS[pl.seat]!.end !== 'withdrawn')
                .map((pl) => ({
                  enrollmentId: pl.enrollmentId,
                  recommended: FINISHED_SEATS[pl.seat]!.rec,
                  remarks: FINISHED_SEATS[pl.seat]!.rec
                    ? 'Works carefully and completes tasks independently.'
                    : 'Needs more supervised practice before working alone.',
                  evaluatedById: t.userId,
                  evaluatedAt: finishedEnd,
                })),
            });
          }
        }
      }

      // The application queue: rejected, waitlisted, pending review, withdrawn by the student.
      await enrol(91, 'CDS-COMP', 'REJECTED', 'All seats were filled by earlier applicants');
      await enrol(92, 'PLS-DRIVE', 'REJECTED', 'Applicants must be at least 18 years old');
      await enrol(93, 'CDS-COMP', 'WAITLISTED');
      await enrol(94, 'ACH-TERRA', 'WAITLISTED');
      await enrol(95, 'MFG-TAILOR', 'WAITLISTED');
      await enrol(96, 'PLS-MEDATT', 'PENDING');
      await enrol(97, 'PLS-MEDATT', 'PENDING');
      await enrol(98, 'PLS-MPRIDE', 'PENDING');
      await enrol(99, 'AGL-ANIMAL', 'WITHDRAWN');
      await enrol(100, 'MFG-FOOD', 'WITHDRAWN');

      await audit.record(tx, {
        userId: admin.id,
        action: 'SEED_DEMO_CYCLE',
        entity: 'TrainingCycle',
        entityId: cycle.id,
        newValue: { students: 95, by: 'seed' },
      });
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
  log(`demo: "${DEMO_CYCLE}" created (30 batches, 10 with students, 95 students)`);

  // Decisions through the app itself: grades, certificates with PDF and QR, audit rows.
  let certified = 0;
  const certs = new Map<string, string>();
  for (const p of plan) {
    if (p.code === UNMARKED_BATCH) continue;
    if (p.seat.end === 'approve') {
      const r = await completion.approve(actor, p.enrollmentId);
      if (r.certificate) certs.set(`${p.code}:${p.seat.pct}`, r.certificate.id);
      certified++;
    } else if (p.seat.end === 'lowAttendance') {
      await completion.markNotCompleted(actor, p.enrollmentId, 'Attendance below 75 %');
    } else if (p.seat.end === 'failed') {
      await completion.markNotCompleted(actor, p.enrollmentId, 'Aggregate below 40 %');
    }
  }
  log(`demo: ${certified} certificates issued, 6 students marked Not completed`);

  const revoked = certs.get('ACH-TERRA:86');
  if (revoked) {
    await documents.revokeCertificate(actor, revoked, 'Issued with a misspelt name');
    try {
      await documents.reissueCertificate(actor, revoked);
    } catch {
      // Without Blob access the new PDF can't be stored; the admin can retry it on the site.
      log('demo: reissued certificate saved, its PDF could not be stored (retry it on the site)');
    }
  }
  const revokedOnly = certs.get('MFG-TAILOR:86');
  if (revokedOnly) {
    await documents.revokeCertificate(
      actor,
      revokedOnly,
      'Practical assessment found to be copied',
    );
  }
  log('demo: 1 certificate revoked and reissued, 1 revoked');

  const risk = await intervention.evaluateAll();
  log(`demo: risk check run (${JSON.stringify(risk).slice(0, 120)})`);
}

/** Removes the demo cycle and everything in it. Audit rows stay (the log is insert-only). */
export async function removeDemoCycle(prisma: PrismaClient, log: (m: string) => void) {
  const cycle = await prisma.trainingCycle.findUnique({ where: { name: DEMO_CYCLE } });
  if (!cycle) {
    log('demo: nothing to remove');
    return;
  }
  const batches = (await prisma.batch.findMany({ where: { cycleId: cycle.id } })).map((b) => b.id);
  const enrollments = (await prisma.enrollment.findMany({ where: { cycleId: cycle.id } })).map(
    (e) => e.id,
  );
  await prisma.$transaction(
    async (tx) => {
      const inBatch = { batchId: { in: batches } };
      const flags = (await tx.riskFlag.findMany({ where: inBatch })).map((f) => f.id);
      await tx.interventionAction.deleteMany({ where: { flagId: { in: flags } } });
      await tx.riskFlag.deleteMany({ where: inBatch });
      await tx.certificate.updateMany({
        where: { enrollmentId: { in: enrollments } },
        data: { supersededById: null },
      });
      await tx.certificate.deleteMany({ where: { enrollmentId: { in: enrollments } } });
      await tx.performanceReport.deleteMany({ where: { enrollmentId: { in: enrollments } } });
      await tx.evaluation.deleteMany({ where: { enrollmentId: { in: enrollments } } });
      await tx.assessmentResult.deleteMany({ where: { assessment: inBatch } });
      await tx.assessment.deleteMany({ where: inBatch });
      await tx.attendance.deleteMany({ where: { session: inBatch } });
      await tx.trainingSession.deleteMany({ where: inBatch });
      await tx.progress.deleteMany({ where: inBatch });
      await tx.batchStudent.deleteMany({ where: inBatch });
      await tx.trainerAssignment.deleteMany({ where: inBatch });
      await tx.batch.deleteMany({ where: { id: { in: batches } } });
      await tx.enrollmentPreference.deleteMany({ where: { enrollmentId: { in: enrollments } } });
      await tx.enrollment.deleteMany({ where: { id: { in: enrollments } } });
      await tx.allocationPreview.deleteMany({ where: { cycleId: cycle.id } });
      await tx.courseOffering.deleteMany({ where: { cycleId: cycle.id } });
      await tx.trainingCycle.delete({ where: { id: cycle.id } });
    },
    { timeout: 120_000 },
  );
  log(`demo: "${DEMO_CYCLE}" removed`);
}
