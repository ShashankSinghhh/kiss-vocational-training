import { Prisma } from '@prisma/client';
import type {
  BatchOutcome,
  CourseOutcome,
  OutcomeAnalytics,
  Paginated,
  PlacementCandidate,
  PlacementDto,
  PlacementInput,
  PlacementListQuery,
} from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { prisma } from '../../core/db';
import { AppError } from '../../core/errors';
import { paginated } from '../../core/http';
import { withJobLease } from '../../core/jobs';
import { settings } from '../../core/settings';
import * as batches from '../batches/batches.service';
import * as documents from '../documents/documents.service';
import * as enrollments from '../enrollments/enrollments.service';
import * as opportunities from '../opportunities/opportunities.service';
import { toCsv } from '../reports/csv';
import * as users from '../users/users.service';
import { addCounts, emptyCounts, figures, rate, type OutcomeCounts } from './rules';

export const REFRESH_JOB = 'analytics-refresh';
const LEASE_MS = 5 * 60_000;

interface BatchRow {
  batch_id: string;
  course_id: string;
  cycle_id: string;
  students: number;
  completed: number;
  not_completed: number;
  certified: number;
  marks_total: number;
  marks_present: number;
  marks_late: number;
  score_sum: number;
  score_count: number;
  placed: number;
}

interface CompetencyRow {
  course_id: string;
  students: number;
  competencies: number;
  verified: number;
}

const counts = (r: BatchRow): OutcomeCounts => ({
  students: r.students,
  completed: r.completed,
  notCompleted: r.not_completed,
  certified: r.certified,
  marksTotal: r.marks_total,
  marksPresent: r.marks_present,
  marksLate: r.marks_late,
  scoreSum: Number(r.score_sum),
  scoreCount: r.score_count,
  placed: r.placed,
});

/**
 * Refreshes the outcome views (nightly cron, or an admin's "Refresh now"). CONCURRENTLY keeps
 * them readable while they rebuild. Returns false when another refresh holds the lease.
 */
export async function refresh(): Promise<{
  refreshed: boolean;
  refreshedAt: string | null;
  missedRuns: number;
}> {
  const run = await withJobLease(
    REFRESH_JOB,
    LEASE_MS,
    async () => {
      await prisma().$executeRawUnsafe(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_batch_outcomes',
      );
      await prisma().$executeRawUnsafe(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_course_competency',
      );
      return true;
    },
    // A refresh rebuilds everything, so one run catches up any number of missed nights.
    { everyMs: 24 * 60 * 60_000 },
  );
  return {
    refreshed: run.ran,
    refreshedAt: await refreshedAt(),
    missedRuns: run.ran ? run.missedRuns : 0,
  };
}

async function refreshedAt(): Promise<string | null> {
  const lock = await prisma().jobLock.findUnique({ where: { name: REFRESH_JOB } });
  return lock?.lastRunAt?.toISOString() ?? null;
}

/**
 * GET /analytics/outcomes (F20): completion rate, average score, attendance and placements per
 * course and batch, and competency achievement per course, optionally for one cycle. Counts
 * come from the nightly views; rates are computed here so current settings apply.
 */
export async function outcomes(cycleId?: string): Promise<OutcomeAnalytics> {
  const cycle = cycleId ? Prisma.sql`WHERE cycle_id = ${cycleId}::uuid` : Prisma.empty;
  const [batchRows, competencyRows, summaries, late, at] = await Promise.all([
    prisma().$queryRaw<BatchRow[]>`SELECT * FROM analytics_batch_outcomes ${cycle}`,
    prisma().$queryRaw<CompetencyRow[]>`
      SELECT course_id, students, competencies, verified
      FROM analytics_course_competency ${cycle}`,
    batches.list(cycleId ? { cycleId } : {}),
    settings.get('attendance.lateCountsAsPresent'),
    refreshedAt(),
  ]);
  const info = new Map(summaries.map((b) => [b.id, b]));

  const batchOutcomes: BatchOutcome[] = [];
  const byCourse = new Map<string, { title: string; batches: number; counts: OutcomeCounts }>();
  let total = emptyCounts();
  for (const r of batchRows) {
    const b = info.get(r.batch_id);
    if (!b) continue; // created after the last refresh and not in this cycle's list
    const c = counts(r);
    batchOutcomes.push({
      batchId: b.id,
      batchName: b.name,
      courseId: b.courseId,
      courseTitle: b.courseTitle,
      cycleName: b.cycleName,
      status: b.status,
      ...figures(c, late),
    });
    const course = byCourse.get(b.courseId) ?? {
      title: b.courseTitle,
      batches: 0,
      counts: emptyCounts(),
    };
    course.batches++;
    course.counts = addCounts(course.counts, c);
    byCourse.set(b.courseId, course);
    total = addCounts(total, c);
  }

  // Competency achievement: verified pairs over students × competencies, summed per course.
  const achievement = new Map<
    string,
    { verified: number; possible: number; competencies: number }
  >();
  for (const r of competencyRows) {
    const a = achievement.get(r.course_id) ?? { verified: 0, possible: 0, competencies: 0 };
    a.verified += r.verified;
    a.possible += r.students * r.competencies;
    a.competencies = Math.max(a.competencies, r.competencies);
    achievement.set(r.course_id, a);
  }

  const courses: CourseOutcome[] = [...byCourse.entries()]
    .map(([courseId, c]) => {
      const a = achievement.get(courseId);
      return {
        courseId,
        courseTitle: c.title,
        batches: c.batches,
        competencies: a?.competencies ?? 0,
        competencyAchievement: a ? rate(a.verified, a.possible) : null,
        ...figures(c.counts, late),
      };
    })
    .sort((x, y) => x.courseTitle.localeCompare(y.courseTitle));

  batchOutcomes.sort(
    (x, y) => x.courseTitle.localeCompare(y.courseTitle) || x.batchName.localeCompare(y.batchName),
  );
  const certificatesSinceRefresh = await documents.issuedSince(at ? new Date(at) : null);
  return {
    refreshedAt: at,
    certificatesSinceRefresh,
    totals: figures(total, late),
    courses,
    batches: batchOutcomes,
  };
}

const pct = (v: number | null) => (v === null ? null : v);

/** The same figures as CSV: one row per course, then one per batch. */
export async function outcomesCsv(cycleId?: string): Promise<string> {
  const o = await outcomes(cycleId);
  const header = [
    'Level',
    'Course',
    'Batch',
    'Students',
    'Completed',
    'Not completed',
    'Certified',
    'Completion rate %',
    'Average score %',
    'Attendance %',
    'Competency achievement %',
    'Placed',
    'Placement rate %',
  ];
  const rows = [
    ...o.courses.map((c) => [
      'Course',
      c.courseTitle,
      null,
      c.students,
      c.completed,
      c.notCompleted,
      c.certified,
      pct(c.completionRate),
      pct(c.averageScore),
      pct(c.attendanceRate),
      pct(c.competencyAchievement),
      c.placed,
      pct(c.placementRate),
    ]),
    ...o.batches.map((b) => [
      'Batch',
      b.courseTitle,
      b.batchName,
      b.students,
      b.completed,
      b.notCompleted,
      b.certified,
      pct(b.completionRate),
      pct(b.averageScore),
      pct(b.attendanceRate),
      null,
      b.placed,
      pct(b.placementRate),
    ]),
  ];
  return toCsv(header, rows);
}

// ─── Placements (BRQ-20.3) ─────────────────────────────────────────────────────

const placementInclude = {
  opportunity: { select: { id: true, title: true } },
  recordedBy: { select: { fullName: true } },
} as const;
type PlacementRow = Prisma.PlacementOutcomeGetPayload<{ include: typeof placementInclude }>;

async function toPlacements(rows: PlacementRow[]): Promise<PlacementDto[]> {
  const facts = await Promise.all(rows.map((r) => enrollments.placementFacts(r.enrollmentId)));
  const places = await Promise.all(rows.map((r) => batches.placementOf(r.enrollmentId)));
  return rows.map((r, i) => ({
    id: r.id,
    enrollmentId: r.enrollmentId,
    student: {
      id: facts[i]?.studentId ?? '',
      fullName: facts[i]?.fullName ?? '',
      rollNo: facts[i]?.rollNo ?? '',
    },
    courseTitle: places[i]?.batch.courseTitle ?? '',
    batchName: places[i]?.batch.name ?? '',
    opportunity: r.opportunity,
    type: r.type,
    employer: r.employer,
    roleTitle: r.roleTitle,
    placedOn: r.placedOn.toISOString().slice(0, 10),
    monthlyIncome: r.monthlyIncome === null ? null : Number(r.monthlyIncome),
    notes: r.notes,
    recordedBy: r.recordedBy.fullName,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listPlacements(q: PlacementListQuery): Promise<Paginated<PlacementDto>> {
  const where: Prisma.PlacementOutcomeWhereInput = q.courseId
    ? { enrollment: { batchMembership: { batch: { courseId: q.courseId } } } }
    : {};
  const skip = (q.page - 1) * q.pageSize;
  const [rows, total] = await Promise.all([
    prisma().placementOutcome.findMany({
      where,
      orderBy: [{ placedOn: 'desc' }, { createdAt: 'desc' }],
      include: placementInclude,
      skip,
      take: q.pageSize,
    }),
    prisma().placementOutcome.count({ where }),
  ]);
  return paginated(await toPlacements(rows), total, {
    page: q.page,
    pageSize: q.pageSize,
    skip,
    take: q.pageSize,
  });
}

/** A student's finished trainings (completed or certified), found by roll number. */
export async function candidates(rollNo: string): Promise<PlacementCandidate[]> {
  const student = await users.studentByRollNo(rollNo);
  if (!student) return [];
  const places = await batches.placementsOf(student.id);
  const statuses = await enrollments.statusesOf(places.map((p) => p.enrollmentId));
  return places
    .filter((p) => ['COMPLETED', 'CERTIFIED'].includes(statuses.get(p.enrollmentId)?.status ?? ''))
    .map((p) => ({
      enrollmentId: p.enrollmentId,
      student,
      courseTitle: p.batch.courseTitle,
      batchName: p.batch.name,
      status: statuses.get(p.enrollmentId)!.status as PlacementCandidate['status'],
    }));
}

export async function createPlacement(actor: Actor, input: PlacementInput): Promise<PlacementDto> {
  const status = (await enrollments.statusesOf([input.enrollmentId])).get(input.enrollmentId);
  if (!status) throw AppError.notFound('Enrollment not found');
  if (!['COMPLETED', 'CERTIFIED'].includes(status.status)) {
    throw AppError.unprocessable(
      'NOT_FINISHED',
      'Placements are recorded for students who completed training',
      [{ path: 'enrollmentId', message: 'Training not completed' }],
    );
  }
  if (input.opportunityId) {
    if (!(await opportunities.exists(input.opportunityId))) {
      throw AppError.unprocessable('OPPORTUNITY_NOT_FOUND', 'Choose an existing opportunity', [
        { path: 'opportunityId', message: 'Unknown' },
      ]);
    }
  }
  const id = await withAudit(actor, async (tx, log) => {
    const p = await tx.placementOutcome.create({
      data: {
        enrollmentId: input.enrollmentId,
        opportunityId: input.opportunityId ?? null,
        type: input.type,
        employer: input.employer,
        roleTitle: input.roleTitle,
        placedOn: new Date(`${input.placedOn}T00:00:00Z`),
        monthlyIncome:
          input.monthlyIncome === undefined ? null : new Prisma.Decimal(input.monthlyIncome),
        notes: input.notes || null,
        recordedById: actor.userId!,
      },
    });
    await log({
      action: 'PLACEMENT_RECORDED',
      entity: 'PlacementOutcome',
      entityId: p.id,
      newValue: input,
    });
    return p.id;
  });
  const row = await prisma().placementOutcome.findUniqueOrThrow({
    where: { id },
    include: placementInclude,
  });
  return (await toPlacements([row]))[0]!;
}

export async function deletePlacement(actor: Actor, id: string): Promise<void> {
  const before = await prisma().placementOutcome.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Placement not found');
  await withAudit(actor, async (tx, log) => {
    await tx.placementOutcome.delete({ where: { id } });
    await log({
      action: 'PLACEMENT_DELETED',
      entity: 'PlacementOutcome',
      entityId: id,
      oldValue: { ...before, placedOn: before.placedOn.toISOString().slice(0, 10) },
    });
  });
}
