import { Prisma } from '@prisma/client';
import type {
  AdminEnrollmentQuery,
  AdminEnrollmentRow,
  AutoApproval,
  AutoApproveRunResult,
  Enrollment,
  EnrollmentHistoryEntry,
  EnrollmentStatus,
  MyEnrollment,
  NotificationType,
  Paginated,
  ReviewAction,
} from '@vtmp/shared';
import { audit, withAudit, type Actor, type AuditFn } from '../../core/audit';
import { prisma, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { paginated, parsePagination } from '../../core/http';
import { settings } from '../../core/settings';
import * as coursesService from '../courses/courses.service';
import { isWindowOpen } from '../courses/rules';
import { notify } from '../notifications/notifications.service';
import {
  COMMITTED_STATUSES,
  REVIEW_TARGET,
  canReview,
  cyclesOverlap,
  isEditable,
  preferenceCountProblem,
  screen,
} from './rules';

export interface StudentActor extends Actor {
  userId: string;
  studentId: string;
}

// ─── Mapping ───────────────────────────────────────────────────────────────────

const enrollmentInclude = {
  cycle: { select: { name: true } },
  preferences: {
    orderBy: { rank: 'asc' },
    include: {
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          isActive: true,
          prerequisites: true,
          prerequisitesNeedReview: true,
          offerings: {
            select: {
              cycleId: true,
              isOpen: true,
              enrollmentOpensAt: true,
              enrollmentClosesAt: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.EnrollmentInclude;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ include: typeof enrollmentInclude }>;

function allWindowsOpen(e: EnrollmentRow, now: Date): boolean {
  return e.preferences.every((p) => {
    const offering = p.course.offerings.find((o) => o.cycleId === e.cycleId);
    return p.course.isActive && isWindowOpen(offering, now);
  });
}

function toDto(e: EnrollmentRow, now = new Date()): Enrollment {
  return {
    id: e.id,
    cycleId: e.cycleId,
    cycleName: e.cycle.name,
    status: e.status,
    reason: e.reason,
    submittedAt: e.submittedAt.toISOString(),
    decidedAt: e.decidedAt?.toISOString() ?? null,
    preferences: e.preferences.map((p) => ({
      rank: p.rank,
      courseId: p.course.id,
      courseCode: p.course.code,
      courseTitle: p.course.title,
    })),
    editable: isEditable(e.status, allWindowsOpen(e, now)),
  };
}

/** Status timeline from the audit trail (BRQ-3.4): every logged change that set a status. */
async function historyOf(enrollmentId: string): Promise<EnrollmentHistoryEntry[]> {
  const rows = await audit.history('Enrollment', enrollmentId);
  return rows.flatMap((r) => {
    const v = r.newValue as { status?: EnrollmentStatus; reason?: string | null } | null;
    return v?.status
      ? [{ status: v.status, reason: v.reason ?? null, at: r.createdAt.toISOString() }]
      : [];
  });
}

// ─── Course availability (BR-02) ───────────────────────────────────────────────

/** Every chosen course must exist, be active and have its window open right now. */
async function assertWindowsOpen(cycleId: string, courseIds: string[]): Promise<void> {
  const found = await coursesService.availability(cycleId, courseIds);
  const now = new Date();
  for (const id of courseIds) {
    const course = found.find((c) => c.courseId === id);
    if (!course) {
      throw AppError.unprocessable('UNKNOWN_COURSE', 'One of the chosen courses does not exist', [
        { path: 'courseIds', message: id },
      ]);
    }
    if (!course.isActive || !isWindowOpen(course.offering, now)) {
      throw AppError.conflict(
        'ENROLLMENT_WINDOW_CLOSED',
        `Enrollment for "${course.title}" is not open in this cycle`,
      );
    }
  }
}

async function assertPreferenceCount(courseIds: string[]): Promise<void> {
  const max = await settings.get('enrollment.maxPreferences');
  const problem = preferenceCountProblem(courseIds, max);
  if (problem) {
    throw AppError.unprocessable('TOO_MANY_PREFERENCES', problem, [
      { path: 'courseIds', message: problem },
    ]);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const duplicate = () =>
  AppError.conflict(
    'DUPLICATE_ENROLLMENT',
    'You already have an active application for this training cycle',
  );

// ─── Automatic approval (BRQ-3.3) ─────────────────────────────────────────────

/** The admin's automatic approval switch and rules (Settings, CLAUDE.md rule 4). */
export async function autoApproval(): Promise<AutoApproval> {
  const s = await settings.getMany([
    'enrollment.autoApprove',
    'enrollment.autoApproveMinCgpa',
    'enrollment.autoApproveManualIfPrerequisites',
  ]);
  return {
    enabled: s['enrollment.autoApprove'],
    minCgpa: s['enrollment.autoApproveMinCgpa'],
    manualIfPrerequisites: s['enrollment.autoApproveManualIfPrerequisites'],
  };
}

/** PUT /admin/enrollments/auto-approval: each changed setting is stored with its audit row. */
export async function setAutoApproval(actor: Actor, input: AutoApproval): Promise<AutoApproval> {
  const before = await autoApproval();
  if (before.enabled !== input.enabled) {
    await settings.set(actor, 'enrollment.autoApprove', input.enabled);
  }
  if (before.minCgpa !== input.minCgpa) {
    await settings.set(actor, 'enrollment.autoApproveMinCgpa', input.minCgpa);
  }
  if (before.manualIfPrerequisites !== input.manualIfPrerequisites) {
    await settings.set(
      actor,
      'enrollment.autoApproveManualIfPrerequisites',
      input.manualIfPrerequisites,
    );
  }
  return autoApproval();
}

const coursesOf = (e: EnrollmentRow) =>
  e.preferences.map((p) => ({
    title: p.course.title,
    // D2: prerequisites every applicant meets (e.g. "Class 8 pass") don't need a person.
    prerequisites: p.course.prerequisitesNeedReview ? p.course.prerequisites : null,
  }));

const AUTO_APPROVED = {
  type: 'ENROLLMENT_APPROVED' as const,
  title: 'Application approved',
};

/**
 * Inside the student's own transaction: approves a just-submitted (or edited) application that
 * meets every automatic approval rule, with its audit row and the student's notification.
 * Returns the row unchanged when the switch is off or a rule holds it for a person.
 */
async function approveIfEligible(
  tx: Tx,
  log: AuditFn,
  row: EnrollmentRow,
  facts: { cgpa: number; userId: string; rules: AutoApproval },
): Promise<EnrollmentRow> {
  if (!facts.rules.enabled) return row;
  if (screen({ cgpa: facts.cgpa, courses: coursesOf(row) }, facts.rules).length > 0) return row;
  const changed = await tx.enrollment.updateMany({
    where: { id: row.id, status: 'PENDING' },
    data: { status: 'APPROVED', reason: null, decidedAt: new Date(), decidedById: null },
  });
  if (changed.count !== 1) return row;
  await log({
    action: 'ENROLLMENT_APPROVED',
    entity: 'Enrollment',
    entityId: row.id,
    oldValue: { status: 'PENDING' },
    newValue: { status: 'APPROVED', by: 'AUTO_APPROVAL' },
  });
  await notify(tx, [
    {
      userId: facts.userId,
      ...AUTO_APPROVED,
      body: `Your application for ${row.cycle.name} was updated.`,
      data: { cycleName: row.cycle.name },
      link: '/student/enrollment',
    },
  ]);
  return tx.enrollment.findUniqueOrThrow({ where: { id: row.id }, include: enrollmentInclude });
}

/** Facts about the applying student, read before any transaction (one pooled connection). */
async function applicantFacts(studentId: string) {
  const [rules, student] = await Promise.all([
    autoApproval(),
    prisma().student.findUniqueOrThrow({
      where: { id: studentId },
      select: { cgpa: true, userId: true },
    }),
  ]);
  return { rules, cgpa: Number(student.cgpa), userId: student.userId };
}

/**
 * POST /admin/enrollments/auto-approve: applies the rules to every application of a cycle
 * still pending (e.g. right after switching automatic approval on), whether or not the switch
 * is on. One set-based update, so thousands of rows fit in a serverless request.
 */
export async function runAutoApproval(
  actor: Actor,
  cycleId: string,
): Promise<AutoApproveRunResult> {
  const cycle = await coursesService.getCycle(cycleId);
  const rules = await autoApproval();
  const pending = await prisma().enrollment.findMany({
    where: { cycleId, status: 'PENDING' },
    include: { ...enrollmentInclude, student: { select: { cgpa: true, userId: true } } },
  });
  // Students accepted for an overlapping training wait for a person (approving them is refused).
  const clashes = await overlappingTraining(
    prisma(),
    pending.map((e) => e.studentId),
    cycle,
  );
  const eligible = pending.filter(
    (e) =>
      !clashes.has(e.studentId) &&
      screen({ cgpa: Number(e.student.cgpa), courses: coursesOf(e) }, rules).length === 0,
  );
  if (eligible.length === 0) return { approved: 0, stillPending: pending.length };

  const approved = await withAudit(
    actor,
    async (tx, log) => {
      // Only rows still pending now: a concurrent manual decision wins.
      const done = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE enrollments
        SET status = 'APPROVED', reason = NULL, decided_at = now(),
            decided_by_id = ${actor.userId}::uuid, updated_at = now()
        WHERE id = ANY(${eligible.map((e) => e.id)}::uuid[]) AND status = 'PENDING'
        RETURNING id`;
      const ids = new Set(done.map((d) => d.id));
      const rows = eligible.filter((e) => ids.has(e.id));
      await log.many(
        rows.map((e) => ({
          action: 'ENROLLMENT_APPROVED',
          entity: 'Enrollment',
          entityId: e.id,
          oldValue: { status: 'PENDING' },
          newValue: { status: 'APPROVED', by: 'AUTO_APPROVAL_RUN' },
        })),
      );
      await notify(
        tx,
        rows.map((e) => ({
          userId: e.student.userId,
          ...AUTO_APPROVED,
          body: `Your application for ${e.cycle.name} was updated.`,
          data: { cycleName: e.cycle.name },
          link: '/student/enrollment',
        })),
      );
      return rows.length;
    },
    { timeoutMs: 30_000 },
  );
  return { approved, stillPending: pending.length - approved };
}

// ─── Overlapping trainings ─────────────────────────────────────────────────────

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Students already committed (approved, allocated or in training) to ANOTHER cycle whose dates
 * overlap this one: studentId → that cycle's name. BR-01 limits one application per cycle;
 * this stops one student being placed in two trainings that run at the same time.
 */
async function overlappingTraining(
  client: Tx,
  studentIds: string[],
  cycle: { id: string; startsOn: string; endsOn: string },
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const committed = await client.enrollment.findMany({
    where: {
      studentId: { in: studentIds },
      cycleId: { not: cycle.id },
      status: { in: [...COMMITTED_STATUSES] },
    },
    select: { studentId: true, cycle: { select: { name: true, startsOn: true, endsOn: true } } },
  });
  const out = new Map<string, string>();
  for (const e of committed) {
    const other = { startsOn: day(e.cycle.startsOn), endsOn: day(e.cycle.endsOn) };
    if (cyclesOverlap(cycle, other)) out.set(e.studentId, e.cycle.name);
  }
  return out;
}

const overlapping = (details: Array<{ path: string; message: string }>) =>
  AppError.conflict(
    'OVERLAPPING_TRAINING',
    details.length === 1
      ? `Already accepted for ${details[0]!.message}, which runs at the same time`
      : 'Some students are already accepted for a training that runs at the same time',
    details,
  );

// ─── Student actions (BRQ-3.1, 3.2, 3.4) ───────────────────────────────────────

export async function submit(
  actor: StudentActor,
  input: { cycleId: string; courseIds: string[] },
): Promise<Enrollment> {
  const cycle = await coursesService.getCycle(input.cycleId);
  await assertPreferenceCount(input.courseIds);
  await assertWindowsOpen(input.cycleId, input.courseIds);
  const clash = (await overlappingTraining(prisma(), [actor.studentId], cycle)).get(
    actor.studentId,
  );
  if (clash) throw overlapping([{ path: 'cycleId', message: clash }]);
  const facts = await applicantFacts(actor.studentId);
  try {
    return await withAudit(actor, async (tx, log) => {
      const created = await tx.enrollment.create({
        data: {
          studentId: actor.studentId,
          cycleId: input.cycleId,
          preferences: {
            create: input.courseIds.map((courseId, i) => ({ courseId, rank: i + 1 })),
          },
        },
        include: enrollmentInclude,
      });
      await log({
        action: 'ENROLLMENT_SUBMITTED',
        entity: 'Enrollment',
        entityId: created.id,
        newValue: { status: created.status, courseIds: input.courseIds },
      });
      return toDto(await approveIfEligible(tx, log, created, facts));
    });
  } catch (err) {
    // BR-01 is enforced by the partial unique index; map its violation to the business error.
    if (isUniqueViolation(err)) throw duplicate();
    throw err;
  }
}

async function loadForStudent(actor: StudentActor, id: string): Promise<EnrollmentRow> {
  const e = await prisma().enrollment.findUnique({ where: { id }, include: enrollmentInclude });
  if (!e) throw AppError.notFound('Application not found');
  if (e.studentId !== actor.studentId) throw AppError.forbidden();
  return e;
}

function assertEditable(e: EnrollmentRow): void {
  if (e.status !== 'PENDING') {
    throw AppError.conflict('ENROLLMENT_NOT_EDITABLE', 'Only pending applications can be changed');
  }
  if (!allWindowsOpen(e, new Date())) {
    throw AppError.conflict(
      'ENROLLMENT_WINDOW_CLOSED',
      'The enrollment window has closed, so this application can no longer be changed',
    );
  }
}

export async function updatePreferences(
  actor: StudentActor,
  id: string,
  courseIds: string[],
): Promise<Enrollment> {
  const before = await loadForStudent(actor, id);
  assertEditable(before);
  await assertPreferenceCount(courseIds);
  await assertWindowsOpen(before.cycleId, courseIds);
  const facts = await applicantFacts(actor.studentId);
  return withAudit(actor, async (tx, log) => {
    // Guard against a concurrent review: only replace preferences while still pending.
    const still = await tx.enrollment.updateMany({
      where: { id, status: 'PENDING' },
      data: { updatedAt: new Date() },
    });
    if (still.count === 0) {
      throw AppError.conflict(
        'ENROLLMENT_NOT_EDITABLE',
        'Only pending applications can be changed',
      );
    }
    await tx.enrollmentPreference.deleteMany({ where: { enrollmentId: id } });
    await tx.enrollmentPreference.createMany({
      data: courseIds.map((courseId, i) => ({ enrollmentId: id, courseId, rank: i + 1 })),
    });
    const updated = await tx.enrollment.findUniqueOrThrow({
      where: { id },
      include: enrollmentInclude,
    });
    await log({
      action: 'ENROLLMENT_UPDATED',
      entity: 'Enrollment',
      entityId: id,
      oldValue: { courseIds: before.preferences.map((p) => p.course.id) },
      newValue: { courseIds },
    });
    return toDto(await approveIfEligible(tx, log, updated, facts));
  });
}

export async function withdraw(actor: StudentActor, id: string): Promise<Enrollment> {
  const before = await loadForStudent(actor, id);
  assertEditable(before);
  return withAudit(actor, async (tx, log) => {
    const result = await tx.enrollment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'WITHDRAWN', decidedAt: new Date() },
    });
    if (result.count === 0) {
      throw AppError.conflict(
        'ENROLLMENT_NOT_EDITABLE',
        'Only pending applications can be changed',
      );
    }
    await log({
      action: 'ENROLLMENT_WITHDRAWN',
      entity: 'Enrollment',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status: 'WITHDRAWN', reason: null },
    });
    return toDto(
      await tx.enrollment.findUniqueOrThrow({ where: { id }, include: enrollmentInclude }),
    );
  });
}

/** The student's applications across cycles, newest first, each with its status timeline. */
export async function mine(studentId: string): Promise<MyEnrollment[]> {
  const rows = await prisma().enrollment.findMany({
    where: { studentId },
    include: enrollmentInclude,
    orderBy: { submittedAt: 'desc' },
  });
  const now = new Date();
  return Promise.all(rows.map(async (e) => ({ ...toDto(e, now), history: await historyOf(e.id) })));
}

// ─── Admin review (BRQ-3.3, BR-12) ─────────────────────────────────────────────

export async function adminList(
  query: AdminEnrollmentQuery,
): Promise<Paginated<AdminEnrollmentRow>> {
  const page = parsePagination(query);
  const q = query.q;
  const where: Prisma.EnrollmentWhereInput = {
    ...(query.cycleId ? { cycleId: query.cycleId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.courseId ? { preferences: { some: { courseId: query.courseId } } } : {}),
    ...(q
      ? {
          student: {
            OR: [
              { rollNo: { contains: q, mode: 'insensitive' } },
              { user: { fullName: { contains: q, mode: 'insensitive' } } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
  };
  const include = {
    ...enrollmentInclude,
    student: {
      select: {
        id: true,
        rollNo: true,
        cgpa: true,
        user: { select: { fullName: true, email: true } },
      },
    },
  } satisfies Prisma.EnrollmentInclude;
  const [rows, total] = await prisma().$transaction([
    // Newest first, so the latest applications are at the top of the review queue.
    prisma().enrollment.findMany({
      where,
      include,
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma().enrollment.count({ where }),
  ]);
  const now = new Date();
  const rules = await autoApproval();
  return paginated(
    rows.map((e) => ({
      ...toDto(e, now),
      // While automatic approval is on: why this one waits for a person.
      needsReview:
        rules.enabled && e.status === 'PENDING'
          ? screen({ cgpa: Number(e.student.cgpa), courses: coursesOf(e) }, rules)
          : null,
      student: {
        id: e.student.id,
        rollNo: e.student.rollNo,
        fullName: e.student.user.fullName,
        email: e.student.user.email,
        cgpa: e.student.cgpa.toFixed(2),
      },
    })),
    total,
    page,
  );
}

const NOTIFICATION: Record<ReviewAction, { type: NotificationType; title: string }> = {
  APPROVE: { type: 'ENROLLMENT_APPROVED', title: 'Application approved' },
  REJECT: { type: 'ENROLLMENT_REJECTED', title: 'Application not approved' },
  WAITLIST: { type: 'ENROLLMENT_WAITLISTED', title: 'Application waitlisted' },
};

/**
 * Approves, rejects or waitlists one or many applications in ONE transaction: any unknown id
 * or invalid transition rolls back the whole batch (TC-05). Each change writes an audit row and
 * an in-app notification for the student in the same transaction.
 */
export async function review(
  actor: Actor,
  ids: string[],
  action: ReviewAction,
  reason?: string,
): Promise<Enrollment[]> {
  if (action === 'REJECT' && !reason) {
    throw AppError.unprocessable('REASON_REQUIRED', 'A reason is required to reject');
  }
  const target = REVIEW_TARGET[action];
  const storedReason = action === 'APPROVE' ? null : (reason ?? null);

  return withAudit(
    actor,
    async (tx, log) => {
      const rows = await tx.enrollment.findMany({
        where: { id: { in: ids } },
        include: {
          cycle: { select: { name: true, startsOn: true, endsOn: true } },
          student: { select: { rollNo: true, userId: true } },
        },
      });
      const missing = ids.filter((id) => !rows.some((r) => r.id === id));
      if (missing.length) {
        throw new AppError(404, 'NOT_FOUND', `Application not found: ${missing.join(', ')}`);
      }
      const invalid = rows.filter((r) => !canReview(r.status, action));
      if (invalid.length) {
        const list = invalid.map((r) => `${r.student.rollNo} (${r.status})`).join(', ');
        throw AppError.conflict(
          'INVALID_STATUS_TRANSITION',
          `Cannot ${action.toLowerCase()}: ${list}`,
        );
      }
      if (action === 'APPROVE') {
        // No student approved into a training that overlaps one they're already accepted for.
        const details: Array<{ path: string; message: string }> = [];
        for (const cycleId of new Set(rows.map((r) => r.cycleId))) {
          const inCycle = rows.filter((r) => r.cycleId === cycleId);
          const c = inCycle[0]!.cycle;
          const clashes = await overlappingTraining(
            tx,
            inCycle.map((r) => r.studentId),
            { id: cycleId, startsOn: day(c.startsOn), endsOn: day(c.endsOn) },
          );
          for (const r of inCycle) {
            const other = clashes.get(r.studentId);
            if (other) details.push({ path: r.student.rollNo, message: other });
          }
        }
        if (details.length) throw overlapping(details);
      }

      const decidedAt = new Date();
      for (const r of rows) {
        // Conditional update: a concurrent change to the same row aborts the whole batch.
        const changed = await tx.enrollment.updateMany({
          where: { id: r.id, status: r.status },
          data: { status: target, reason: storedReason, decidedAt, decidedById: actor.userId },
        });
        if (changed.count !== 1) {
          throw AppError.conflict(
            'CONCURRENT_UPDATE',
            `Application ${r.student.rollNo} changed while being reviewed`,
          );
        }
        await log({
          action: `ENROLLMENT_${target}`,
          entity: 'Enrollment',
          entityId: r.id,
          oldValue: { status: r.status, reason: r.reason },
          newValue: { status: target, reason: storedReason },
        });
      }

      await notify(
        tx,
        rows.map((r) => ({
          userId: r.student.userId,
          type: NOTIFICATION[action].type,
          title: NOTIFICATION[action].title,
          body: storedReason
            ? `${r.cycle.name}: ${storedReason}`
            : `Your application for ${r.cycle.name} was updated.`,
          data: { cycleName: r.cycle.name, ...(storedReason ? { reason: storedReason } : {}) },
          link: '/student/enrollment',
        })),
      );

      const updated = await tx.enrollment.findMany({
        where: { id: { in: ids } },
        include: enrollmentInclude,
      });
      const now = new Date();
      // Keep the caller's order in the response.
      return ids.map((id) =>
        toDto(
          updated.find((u) => u.id === id)!,
          now,
        ),
      );
    },
    { timeoutMs: 30_000 },
  );
}

// ─── For the catalogue (courses module asks; it never reads these tables) ──────

/**
 * Approved applications not yet placed in a batch, counted against their first preference.
 * The catalogue adds real batch membership (batches module) to get seats taken.
 */
export async function approvedFirstChoice(cycleId: string): Promise<Map<string, number>> {
  const rows = await prisma().$queryRaw<{ course_id: string; taken: number }[]>`
    SELECT p.course_id, COUNT(*)::int AS taken
    FROM enrollments e
    JOIN enrollment_preferences p ON p.enrollment_id = e.id AND p.rank = 1
    WHERE e.cycle_id = ${cycleId}::uuid AND e.status = 'APPROVED'
    GROUP BY p.course_id`;
  return new Map(rows.map((r) => [r.course_id, Number(r.taken)]));
}

// ─── For the batches module (allocation, placement) ─────────────────────────────
// Batches never reads enrollment tables; it asks through these functions (CLAUDE.md rule 5).

export interface AllocationApplicant {
  enrollmentId: string;
  studentId: string;
  userId: string;
  rollNo: string;
  fullName: string;
  cgpa: number;
  submittedAt: Date;
  updatedAt: Date;
  /** Course ids in rank order. */
  preferences: string[];
}

/** APPROVED applications in a cycle: the input to the allocation engine. */
export async function approvedApplicants(cycleId: string): Promise<AllocationApplicant[]> {
  const rows = await prisma().enrollment.findMany({
    where: { cycleId, status: 'APPROVED' },
    select: {
      id: true,
      submittedAt: true,
      updatedAt: true,
      preferences: { orderBy: { rank: 'asc' }, select: { courseId: true } },
      student: {
        select: {
          id: true,
          rollNo: true,
          cgpa: true,
          user: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    enrollmentId: r.id,
    studentId: r.student.id,
    userId: r.student.user.id,
    rollNo: r.student.rollNo,
    fullName: r.student.user.fullName,
    cgpa: Number(r.student.cgpa),
    submittedAt: r.submittedAt,
    updatedAt: r.updatedAt,
    preferences: r.preferences.map((p) => p.courseId),
  }));
}

export interface PlacementFacts {
  id: string;
  studentId: string;
  userId: string;
  cycleId: string;
  cycleName: string;
  status: EnrollmentStatus;
  reason: string | null;
  preferences: string[];
  rollNo: string;
  fullName: string;
  /** Optional Odia-script name for the certificate (BRQ-16.2). */
  nameOdia: string | null;
}

export async function placementFacts(enrollmentId: string): Promise<PlacementFacts | null> {
  const e = await prisma().enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      studentId: true,
      cycleId: true,
      status: true,
      reason: true,
      cycle: { select: { name: true } },
      preferences: { orderBy: { rank: 'asc' }, select: { courseId: true } },
      student: {
        select: { rollNo: true, nameOdia: true, user: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!e) return null;
  return {
    id: e.id,
    studentId: e.studentId,
    userId: e.student.user.id,
    cycleId: e.cycleId,
    cycleName: e.cycle.name,
    status: e.status,
    reason: e.reason,
    preferences: e.preferences.map((p) => p.courseId),
    rollNo: e.student.rollNo,
    fullName: e.student.user.fullName,
    nameOdia: e.student.nameOdia,
  };
}

/** Current status and reason of several applications (completion queue). */
export async function statusesOf(
  enrollmentIds: string[],
): Promise<Map<string, { status: EnrollmentStatus; reason: string | null }>> {
  const rows = await prisma().enrollment.findMany({
    where: { id: { in: enrollmentIds } },
    select: { id: true, status: true, reason: true },
  });
  return new Map(rows.map((r) => [r.id, { status: r.status, reason: r.reason }]));
}

/** APPROVED or WAITLISTED applicants in a cycle who listed this course (for manual placement). */
export async function candidatesForCourse(cycleId: string, courseId: string) {
  const rows = await prisma().enrollment.findMany({
    where: {
      cycleId,
      status: { in: ['APPROVED', 'WAITLISTED'] },
      preferences: { some: { courseId } },
    },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      preferences: { select: { courseId: true, rank: true } },
      student: { select: { rollNo: true, cgpa: true, user: { select: { fullName: true } } } },
    },
  });
  return rows.map((r) => ({
    enrollmentId: r.id,
    status: r.status,
    rollNo: r.student.rollNo,
    fullName: r.student.user.fullName,
    cgpa: r.student.cgpa.toFixed(2),
    submittedAt: r.submittedAt.toISOString(),
    rankForCourse: r.preferences.find((p) => p.courseId === courseId)?.rank ?? 0,
  }));
}

export interface StatusChange {
  enrollmentId: string;
  from: readonly EnrollmentStatus[];
  to: EnrollmentStatus;
  reason?: string | null;
  /** Optional notification for the student. */
  notify?: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data: Record<string, string>;
  };
}

/**
 * Status changes requested by the batches module, inside ITS transaction (set-based, so a
 * 500-student allocation stays a handful of queries). Every row must currently be in one of its
 * expected `from` statuses; rows are updated with that status as a condition, so a concurrent
 * change makes the counts disagree and aborts the whole transaction (409 CONCURRENT_UPDATE).
 * Audit rows and notifications are written in the same transaction.
 */
export async function changeStatuses(tx: Tx, log: AuditFn, changes: StatusChange[]): Promise<void> {
  if (changes.length === 0) return;
  const before = new Map(
    (
      await tx.enrollment.findMany({
        where: { id: { in: changes.map((c) => c.enrollmentId) } },
        select: { id: true, status: true, reason: true },
      })
    ).map((e) => [e.id, e]),
  );
  const stale = () =>
    AppError.conflict(
      'CONCURRENT_UPDATE',
      'An application changed while this action was running. Refresh and try again.',
    );

  // Group identical updates: same current status, target status and reason.
  const groups = new Map<string, { from: EnrollmentStatus; c: StatusChange; ids: string[] }>();
  for (const c of changes) {
    const b = before.get(c.enrollmentId);
    if (!b || !c.from.includes(b.status)) throw stale();
    const key = `${b.status}|${c.to}|${c.reason === undefined ? ' ' : (c.reason ?? '')}`;
    const g = groups.get(key) ?? { from: b.status, c, ids: [] };
    g.ids.push(c.enrollmentId);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const updated = await tx.enrollment.updateMany({
      where: { id: { in: g.ids }, status: g.from },
      data: { status: g.c.to, ...(g.c.reason !== undefined ? { reason: g.c.reason } : {}) },
    });
    if (updated.count !== g.ids.length) throw stale();
  }

  await log.many(
    changes.map((c) => {
      const b = before.get(c.enrollmentId)!;
      return {
        action: `ENROLLMENT_${c.to}`,
        entity: 'Enrollment',
        entityId: c.enrollmentId,
        oldValue: { status: b.status, reason: b.reason },
        newValue: { status: c.to, reason: c.reason === undefined ? b.reason : c.reason },
      };
    }),
  );
  await notify(
    tx,
    changes.flatMap((c) => (c.notify ? [{ ...c.notify, link: '/student' }] : [])),
  );
}

/** Applications per status (dashboard funnel), optionally for one cycle. */
export async function statusCounts(cycleId?: string): Promise<Map<EnrollmentStatus, number>> {
  const rows = await prisma().enrollment.groupBy({
    by: ['status'],
    where: cycleId ? { cycleId } : {},
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.status, r._count._all]));
}
