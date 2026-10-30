import {
  ENROLLMENT_STATUSES,
  type AdminDashboard,
  type DashboardSession,
  type StudentDashboard,
  type TrainerDashboard,
} from '@vtmp/shared';
import { settings } from '../../core/settings';
import * as attendance from '../attendance/attendance.service';
import { attendancePercent } from '../attendance/rules';
import * as batches from '../batches/batches.service';
import * as courses from '../courses/courses.service';
import * as documents from '../documents/documents.service';
import * as enrollments from '../enrollments/enrollments.service';
import { completionRate } from '../reports/rules';
import * as training from '../training/training.service';
import * as users from '../users/users.service';

const TREND_WEEKS = 8;
const PENDING_LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * BRQ-9.1, BRQ-9.2: counts, enrollment funnel, completion rate, grades and the weekly
 * attendance trend. Every figure is aggregated in SQL by the module that owns the data.
 */
export async function admin(cycleId?: string, now = new Date()): Promise<AdminDashboard> {
  const offset = await settings.get('institution.utcOffsetMinutes');
  const [people, courseCount, batchCounts, funnel, grades, trend, minimum, ended] =
    await Promise.all([
      users.activeCounts(),
      courses.activeCourseCount(),
      batches.statusCounts(),
      enrollments.statusCounts(cycleId),
      documents.gradeDistribution(),
      attendance.weeklyTrend(TREND_WEEKS),
      settings.get('attendance.minPercent'),
      batches.endedActive(institutionDay(now, offset)),
    ]);
  const count = (s: (typeof ENROLLMENT_STATUSES)[number]) => funnel.get(s) ?? 0;
  const completed = count('COMPLETED') + count('CERTIFIED');
  const notCompleted = count('NOT_COMPLETED');
  return {
    counts: {
      students: people.students,
      courses: courseCount,
      trainers: people.trainers,
      batches: batchCounts,
    },
    enrollmentFunnel: ENROLLMENT_STATUSES.map((status) => ({ status, count: count(status) })),
    completion: {
      completed,
      notCompleted,
      inTraining: count('ACTIVE'),
      ratePercent: completionRate(completed, notCompleted),
    },
    grades: (['A', 'B', 'C', 'D'] as const).map((grade) => ({
      grade,
      count: grades.get(grade) ?? 0,
    })),
    attendanceTrend: trend.map((w) => ({
      weekStart: w.weekStart,
      percent: attendancePercent(w.attended, w.marks),
      marks: w.marks,
    })),
    minAttendancePercent: minimum,
    endedBatches: ended,
  };
}

/** The calendar day (YYYY-MM-DD) of an instant in institution time. */
function institutionDay(d: Date, offsetMinutes: number): string {
  return new Date(d.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** BRQ-9.3: the trainer's own figures — batches, today's sessions, what still needs marking. */
export async function trainer(
  user: { role: 'TRAINER'; trainerId: string },
  now = new Date(),
): Promise<TrainerDashboard> {
  const [mine, offset, minimum] = await Promise.all([
    batches.mine({ role: 'TRAINER', studentId: null, trainerId: user.trainerId }),
    settings.get('institution.utcOffsetMinutes'),
    settings.get('attendance.minPercent'),
  ]);
  const active = mine.filter((b) => b.status === 'ACTIVE');
  const activeIds = new Set(active.map((b) => b.id));
  const sessions = await attendance.mySessions(
    user.trainerId,
    new Date(now.getTime() - PENDING_LOOKBACK_DAYS * DAY_MS),
    new Date(now.getTime() + 2 * DAY_MS),
  );
  const today = institutionDay(now, offset);
  const toDto = (s: (typeof sessions)[number]): DashboardSession => ({
    id: s.id,
    batchId: s.batchId,
    batchName: s.batchName,
    courseTitle: s.courseTitle,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    venue: s.venue,
    topic: s.topic,
    marked: s.marked,
    rosterSize: s.rosterSize,
  });

  const summaries = await Promise.all(
    active.map(async (b) => ({ b, rows: await attendance.batchSummary(b.id) })),
  );
  return {
    activeBatches: active.length,
    students: active.reduce((s, b) => s + b.enrolled, 0),
    todaySessions: sessions
      .filter(
        (s) => s.status !== 'CANCELLED' && institutionDay(new Date(s.startsAt), offset) === today,
      )
      .map(toDto),
    pendingAttendance: sessions
      .filter(
        (s) =>
          activeIds.has(s.batchId) &&
          s.status !== 'CANCELLED' &&
          new Date(s.startsAt) <= now &&
          s.marked < s.rosterSize,
      )
      .reverse()
      .map(toDto),
    minAttendancePercent: minimum,
    lowAttendance: summaries
      .flatMap(({ b, rows }) =>
        rows
          .filter((r) => r.percent !== null && r.percent < minimum)
          .map((r) => ({
            batchId: b.id,
            batchName: b.name,
            courseTitle: b.courseTitle,
            studentId: r.studentId,
            rollNo: r.rollNo,
            fullName: r.fullName,
            percent: r.percent!,
          })),
      )
      .sort((a, z) => a.percent - z.percent),
  };
}

/** BRQ-9.3: the student's own figures — application, live training figures, next session, certificate. */
export async function student(studentId: string): Promise<StudentDashboard> {
  const [applications, placements, mine, trainings, certificates, minimum] = await Promise.all([
    enrollments.mine(studentId),
    batches.placementsOf(studentId),
    batches.mine({ role: 'STUDENT', studentId, trainerId: null }),
    training.forStudent(studentId),
    documents.forStudent(studentId),
    settings.get('attendance.minPercent'),
  ]);
  // S4: the headline stays on the training in progress (then a batch place) even after the
  // student applies for a later cycle; My enrollment lists every application.
  const latest =
    applications.find((e) => e.status === 'ACTIVE') ??
    applications.find((e) => e.status === 'ALLOCATED') ??
    applications[0];
  const current = trainings[0];
  const placement = placements[0];
  const next = mine.find((b) => b.nextSession)?.nextSession ?? null;
  const certificate = certificates.find((c) => c.status === 'VALID');
  return {
    enrollment: latest
      ? { id: latest.id, status: latest.status, cycleName: latest.cycleName, reason: latest.reason }
      : null,
    training:
      current && placement
        ? {
            enrollmentId: placement.enrollmentId,
            batchId: current.batch.id,
            batchName: current.batch.name,
            courseTitle: current.batch.courseTitle,
            attendancePercent: current.attendance.percent,
            minAttendancePercent: minimum,
            aggregate: current.aggregate,
            projectedGrade: current.projectedGrade,
          }
        : null,
    nextSession: next
      ? { startsAt: next.startsAt, endsAt: next.endsAt, venue: next.venue, topic: next.topic }
      : null,
    certificate: certificate
      ? {
          id: certificate.id,
          publicCode: certificate.publicCode,
          status: certificate.status,
          issuedAt: certificate.issuedAt,
          rendered: certificate.rendered,
          courseTitle: certificate.courseTitle,
        }
      : null,
  };
}
