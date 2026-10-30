import { Prisma } from '@prisma/client';
import type {
  BatchCreateInput,
  BatchDetail,
  BatchStatus,
  BatchSummary,
  BatchUpdateInput,
  Candidate,
  EndedBatch,
  EnrollmentStatus,
  Role,
  RosterEntry,
  SessionCreateInput,
  SessionDto,
  TrainerOption,
} from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { prisma, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { settings } from '../../core/settings';
import * as enrollments from '../enrollments/enrollments.service';
import { clashesFor, closeBlocker, insideCycle, type BookedSlot } from './rules';
import { expandRecurring, MAX_GENERATED_SESSIONS } from './sessionsSchedule';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * L4: a student who withdrew mid-training stays on the roster (their record is kept) but no
 * longer holds a seat, so counts of members use this filter.
 */
const SEATED = {
  enrollment: { status: { not: 'WITHDRAWN' } },
} satisfies Prisma.BatchStudentWhereInput;

// ─── Mapping ───────────────────────────────────────────────────────────────────

const sessionInclude = { trainer: { select: { user: { select: { fullName: true } } } } } as const;
type SessionRow = Prisma.TrainingSessionGetPayload<{ include: typeof sessionInclude }>;

export function toSession(s: SessionRow): SessionDto {
  return {
    id: s.id,
    batchId: s.batchId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    venue: s.venue,
    topic: s.topic,
    status: s.status,
    trainerId: s.trainerId,
    trainerName: s.trainer?.user.fullName ?? null,
  };
}

const batchInclude = (now: Date) =>
  ({
    course: { select: { code: true, title: true } },
    cycle: { select: { name: true } },
    trainers: {
      orderBy: { assignedAt: 'asc' },
      select: { trainer: { select: { id: true, user: { select: { fullName: true } } } } },
    },
    _count: { select: { students: { where: SEATED } } },
    sessions: {
      where: { status: 'SCHEDULED', startsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 1,
      include: sessionInclude,
    },
  }) satisfies Prisma.BatchInclude;

type BatchRow = Prisma.BatchGetPayload<{ include: ReturnType<typeof batchInclude> }>;

function toSummary(b: BatchRow): BatchSummary {
  return {
    id: b.id,
    name: b.name,
    courseId: b.courseId,
    courseCode: b.course.code,
    courseTitle: b.course.title,
    cycleId: b.cycleId,
    cycleName: b.cycle.name,
    capacity: b.capacity,
    enrolled: b._count.students,
    startDate: day(b.startDate),
    endDate: day(b.endDate),
    venue: b.venue,
    status: b.status,
    trainers: b.trainers.map((t) => ({ id: t.trainer.id, fullName: t.trainer.user.fullName })),
    nextSession: b.sessions[0] ? toSession(b.sessions[0]) : null,
  };
}

async function loadBatch(client: Tx, id: string): Promise<BatchRow> {
  const b = await client.batch.findUnique({ where: { id }, include: batchInclude(new Date()) });
  if (!b) throw AppError.notFound('Batch not found');
  return b;
}

/** Row lock so concurrent placements cannot overfill a batch (BR-03). */
async function lockBatch(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<
    { id: string; capacity: number; status: BatchStatus; cycle_id: string; course_id: string }[]
  >`
    SELECT id, capacity, status::text AS status, cycle_id, course_id
    FROM batches WHERE id = ${id}::uuid FOR UPDATE`;
  const b = rows[0];
  if (!b) throw AppError.notFound('Batch not found');
  const members = await tx.batchStudent.count({ where: { batchId: id, ...SEATED } });
  return { ...b, members };
}

// ─── Reads ─────────────────────────────────────────────────────────────────────

export async function list(filters: {
  cycleId?: string;
  courseId?: string;
  status?: BatchStatus;
}): Promise<BatchSummary[]> {
  const rows = await prisma().batch.findMany({
    where: filters,
    include: batchInclude(new Date()),
    orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
  });
  return rows.map(toSummary);
}

export async function detail(id: string, viewerRole: Role): Promise<BatchDetail> {
  const b = await loadBatch(prisma(), id);
  let roster: RosterEntry[] | null = null;
  if (viewerRole !== 'STUDENT') {
    const members = await prisma().batchStudent.findMany({
      where: { batchId: id },
      orderBy: { student: { rollNo: 'asc' } },
      select: {
        enrollmentId: true,
        allocatedAt: true,
        enrollment: { select: { status: true } },
        student: {
          select: {
            id: true,
            rollNo: true,
            phone: true,
            cgpa: true,
            user: { select: { fullName: true, email: true } },
          },
        },
      },
    });
    roster = members.map((m) => ({
      enrollmentId: m.enrollmentId,
      studentId: m.student.id,
      rollNo: m.student.rollNo,
      fullName: m.student.user.fullName,
      email: m.student.user.email,
      phone: m.student.phone,
      cgpa: m.student.cgpa.toFixed(2),
      enrollmentStatus: m.enrollment.status,
      allocatedAt: m.allocatedAt.toISOString(),
    }));
  }
  return { ...toSummary(b), roster };
}

/** Student: the batches they are placed in. Trainer: their assigned batches (BR-05). */
export async function mine(user: {
  role: Role;
  studentId: string | null;
  trainerId: string | null;
}): Promise<BatchSummary[]> {
  const where: Prisma.BatchWhereInput =
    user.role === 'STUDENT'
      ? { students: { some: { studentId: user.studentId ?? '' } } }
      : user.role === 'TRAINER'
        ? { trainers: { some: { trainerId: user.trainerId ?? '' } } }
        : {};
  const rows = await prisma().batch.findMany({
    where,
    include: batchInclude(new Date()),
    orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
  });
  return rows.map(toSummary);
}

/** Batch names and statuses by id (lists in other modules). */
export async function namesOf(
  ids: string[],
): Promise<Map<string, { id: string; name: string; status: BatchStatus }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma().batch.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, status: true },
  });
  return new Map(rows.map((b) => [b.id, b]));
}

/** A batch's course and status (F18 checks competencies against the course). */
export async function courseOf(
  batchId: string,
): Promise<{ courseId: string; status: BatchStatus } | null> {
  return prisma().batch.findUnique({
    where: { id: batchId },
    select: { courseId: true, status: true },
  });
}

/** Each member's enrollment status, by student (e.g. F11 evaluates only those in training). */
export async function memberStatuses(batchId: string): Promise<Map<string, EnrollmentStatus>> {
  const rows = await prisma().batchStudent.findMany({
    where: { batchId },
    select: { studentId: true, enrollment: { select: { status: true } } },
  });
  return new Map(rows.map((r) => [r.studentId, r.enrollment.status]));
}

/** Ids of batches in a status (e.g. the daily F11 run over ACTIVE batches). */
export async function idsByStatus(status: BatchStatus): Promise<string[]> {
  const rows = await prisma().batch.findMany({ where: { status }, select: { id: true } });
  return rows.map((b) => b.id);
}

/** Ids of the batches a trainer is assigned to (BR-05 scoping). */
export async function idsForTrainer(trainerId: string): Promise<string[]> {
  const rows = await prisma().trainerAssignment.findMany({
    where: { trainerId },
    select: { batchId: true },
  });
  return rows.map((r) => r.batchId);
}

/** The user accounts of a batch's trainers (action owners, notices). */
export async function trainerUsers(
  batchId: string,
): Promise<Array<{ id: string; fullName: string }>> {
  const rows = await prisma().trainerAssignment.findMany({
    where: { batchId, trainer: { user: { isActive: true } } },
    select: { trainer: { select: { user: { select: { id: true, fullName: true } } } } },
  });
  return rows.map((r) => r.trainer.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function sessions(batchId: string): Promise<SessionDto[]> {
  const rows = await prisma().trainingSession.findMany({
    where: { batchId },
    orderBy: { startsAt: 'asc' },
    include: sessionInclude,
  });
  return rows.map(toSession);
}

export async function trainers(): Promise<TrainerOption[]> {
  const rows = await prisma().trainer.findMany({
    where: { user: { isActive: true } },
    orderBy: { user: { fullName: 'asc' } },
    select: {
      id: true,
      employeeCode: true,
      specialization: true,
      user: { select: { fullName: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    fullName: t.user.fullName,
    employeeCode: t.employeeCode,
    specialization: t.specialization,
  }));
}

export async function candidates(batchId: string): Promise<Candidate[]> {
  const b = await prisma().batch.findUnique({
    where: { id: batchId },
    select: { cycleId: true, courseId: true },
  });
  if (!b) throw AppError.notFound('Batch not found');
  return enrollments.candidatesForCourse(b.cycleId, b.courseId);
}

/** Students placed in batches, per course, in a cycle (for the catalogue's seats). */
export async function membersByCourse(cycleId: string): Promise<Map<string, number>> {
  const rows = await prisma().$queryRaw<{ course_id: string; n: number }[]>`
    SELECT b.course_id, COUNT(*)::int AS n
    FROM batch_students bs JOIN batches b ON b.id = bs.batch_id
    JOIN enrollments e ON e.id = bs.enrollment_id
    WHERE b.cycle_id = ${cycleId}::uuid AND e.status <> 'WITHDRAWN'
    GROUP BY b.course_id`;
  return new Map(rows.map((r) => [r.course_id, Number(r.n)]));
}

/**
 * L8: ACTIVE batches that ended before `today` (YYYY-MM-DD), oldest first, with how many of
 * their students are still in training (no completion decision yet).
 */
export async function endedActive(today: string): Promise<EndedBatch[]> {
  const rows = await prisma().batch.findMany({
    where: { status: 'ACTIVE', endDate: { lt: new Date(today) } },
    orderBy: [{ endDate: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      endDate: true,
      course: { select: { title: true } },
      _count: {
        select: {
          students: { where: { enrollment: { status: { in: ['ALLOCATED', 'ACTIVE'] } } } },
        },
      },
    },
  });
  return rows.map((b) => ({
    batchId: b.id,
    batchName: b.name,
    courseTitle: b.course.title,
    endDate: day(b.endDate),
    undecided: b._count.students,
  }));
}

/** L5: names of a cycle's batches that would not fit between these dates (cycle edits). */
export async function batchesOutsideDates(
  cycleId: string,
  startsOn: Date,
  endsOn: Date,
): Promise<string[]> {
  const rows = await prisma().batch.findMany({
    where: { cycleId, OR: [{ startDate: { lt: startsOn } }, { endDate: { gt: endsOn } }] },
    orderBy: { name: 'asc' },
    select: { name: true, course: { select: { title: true } } },
  });
  return rows.map((b) => `${b.course.title} · ${b.name}`);
}

/** D4: per course, planned or running batches and the students placed in them. */
export async function liveBatchesByCourse(): Promise<
  Map<string, { batches: number; students: number }>
> {
  const rows = await prisma().batch.findMany({
    where: { status: { in: ['PLANNED', 'ACTIVE'] } },
    select: { courseId: true, _count: { select: { students: { where: SEATED } } } },
  });
  const out = new Map<string, { batches: number; students: number }>();
  for (const r of rows) {
    const c = out.get(r.courseId) ?? { batches: 0, students: 0 };
    out.set(r.courseId, { batches: c.batches + 1, students: c.students + r._count.students });
  }
  return out;
}

/** S2: total capacity of each course's batches in a cycle (closed batches don't take anyone). */
export async function capacityByCourse(cycleId: string): Promise<Map<string, number>> {
  const rows = await prisma().batch.groupBy({
    by: ['courseId'],
    where: { cycleId, status: { not: 'CLOSED' } },
    _sum: { capacity: true },
  });
  return new Map(rows.map((r) => [r.courseId, r._sum.capacity ?? 0]));
}

// ─── Admin: batches (BRQ-4.1) ──────────────────────────────────────────────────

/** L5: 422 BATCH_OUTSIDE_CYCLE unless the batch's dates fall within its cycle's. */
function assertInsideCycle(
  startDate: Date,
  endDate: Date,
  cycle: { startsOn: Date; endsOn: Date },
): void {
  const c = { startsOn: day(cycle.startsOn), endsOn: day(cycle.endsOn) };
  if (!insideCycle({ startDate: day(startDate), endDate: day(endDate) }, c)) {
    throw AppError.unprocessable(
      'BATCH_OUTSIDE_CYCLE',
      `The batch must run within its cycle (${c.startsOn} to ${c.endsOn})`,
      [
        { path: 'startDate', message: c.startsOn },
        { path: 'endDate', message: c.endsOn },
      ],
    );
  }
}

export async function create(actor: Actor, input: BatchCreateInput): Promise<BatchSummary> {
  try {
    return await withAudit(actor, async (tx, log) => {
      const [course, cycle] = await Promise.all([
        tx.course.findUnique({ where: { id: input.courseId }, select: { isActive: true } }),
        tx.trainingCycle.findUnique({
          where: { id: input.cycleId },
          select: { startsOn: true, endsOn: true },
        }),
      ]);
      if (!course) throw AppError.notFound('Course not found');
      if (!cycle) throw AppError.notFound('Training cycle not found');
      if (!course.isActive)
        throw AppError.conflict('COURSE_INACTIVE', 'This course is deactivated');
      assertInsideCycle(new Date(input.startDate), new Date(input.endDate), cycle);
      const b = await tx.batch.create({
        data: {
          ...input,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
        },
      });
      await log({ action: 'BATCH_CREATED', entity: 'Batch', entityId: b.id, newValue: b });
      return toSummary(await loadBatch(tx, b.id));
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict(
        'BATCH_NAME_TAKEN',
        'This course already has a batch with that name in the cycle',
      );
    }
    throw err;
  }
}

export async function update(
  actor: Actor,
  id: string,
  input: BatchUpdateInput,
): Promise<BatchSummary> {
  return withAudit(actor, async (tx, log) => {
    const locked = await lockBatch(tx, id);
    if (locked.status === 'CLOSED')
      throw AppError.conflict('BATCH_CLOSED', 'Closed batches cannot change');
    if (input.capacity !== undefined && input.capacity < locked.members) {
      throw AppError.conflict(
        'CAPACITY_BELOW_ENROLLED',
        `Capacity cannot be below the ${locked.members} students already in the batch`,
      );
    }
    const before = await tx.batch.findUniqueOrThrow({
      where: { id },
      include: { cycle: { select: { startsOn: true, endsOn: true } } },
    });
    const startDate = input.startDate ? new Date(input.startDate) : before.startDate;
    const endDate = input.endDate ? new Date(input.endDate) : before.endDate;
    if (endDate < startDate)
      throw AppError.unprocessable('INVALID_DATES', 'The batch must end on or after its start');
    const { cycle, ...beforeRow } = before;
    if (input.startDate || input.endDate) assertInsideCycle(startDate, endDate, cycle);
    const b = await tx.batch.update({
      where: { id },
      data: { name: input.name, capacity: input.capacity, venue: input.venue, startDate, endDate },
    });
    await log({
      action: 'BATCH_UPDATED',
      entity: 'Batch',
      entityId: id,
      oldValue: beforeRow,
      newValue: b,
    });
    return toSummary(await loadBatch(tx, id));
  });
}

/** PLANNED → ACTIVE; its students' enrollments ALLOCATED → ACTIVE. Needs a trainer. */
export async function activate(actor: Actor, id: string): Promise<BatchSummary> {
  return withAudit(
    actor,
    async (tx, log) => {
      const locked = await lockBatch(tx, id);
      if (locked.status !== 'PLANNED') {
        throw AppError.conflict(
          'INVALID_BATCH_STATUS',
          `Only planned batches can be activated (this one is ${locked.status})`,
        );
      }
      const trainerCount = await tx.trainerAssignment.count({ where: { batchId: id } });
      if (trainerCount === 0)
        throw AppError.conflict('NO_TRAINER', 'Assign at least one trainer before activating');
      await tx.batch.update({ where: { id }, data: { status: 'ACTIVE' } });
      await log({
        action: 'BATCH_ACTIVATED',
        entity: 'Batch',
        entityId: id,
        oldValue: { status: 'PLANNED' },
        newValue: { status: 'ACTIVE' },
      });
      const members = await tx.batchStudent.findMany({
        where: { batchId: id },
        select: { enrollmentId: true, student: { select: { userId: true } } },
      });
      const b = await tx.batch.findUniqueOrThrow({
        where: { id },
        select: { name: true, course: { select: { title: true } } },
      });
      await enrollments.changeStatuses(
        tx,
        log,
        members.map((m) => ({
          enrollmentId: m.enrollmentId,
          from: ['ALLOCATED', 'ACTIVE'],
          to: 'ACTIVE' as EnrollmentStatus,
          notify: {
            userId: m.student.userId,
            type: 'BATCH_ACTIVATED' as const,
            title: 'Training has started',
            body: `${b.course.title}, ${b.name}`,
            data: { courseTitle: b.course.title, batchName: b.name },
          },
        })),
      );
      return toSummary(await loadBatch(tx, id));
    },
    { timeoutMs: 30_000 },
  );
}

/** Today's calendar date at the institution, YYYY-MM-DD. */
async function institutionToday(now = new Date()): Promise<string> {
  const offset = await settings.get('institution.utcOffsetMinutes');
  return day(new Date(now.getTime() + offset * 60_000));
}

/**
 * L1: ACTIVE → CLOSED once the batch has ended and every student has a decision (completed,
 * not completed or withdrawn). A closed batch takes no attendance, marks or new students and
 * drops out of "active" lists; its records stay readable.
 */
export async function close(actor: Actor, id: string): Promise<BatchSummary> {
  const today = await institutionToday();
  return withAudit(actor, async (tx, log) => {
    const locked = await lockBatch(tx, id);
    const batch = await tx.batch.findUniqueOrThrow({ where: { id }, select: { endDate: true } });
    const undecided = await tx.batchStudent.findMany({
      where: { batchId: id, enrollment: { status: { in: ['ALLOCATED', 'ACTIVE'] } } },
      orderBy: { student: { rollNo: 'asc' } },
      select: { student: { select: { rollNo: true, user: { select: { fullName: true } } } } },
    });
    const blocker = closeBlocker(locked.status, day(batch.endDate), today, undecided.length);
    if (blocker === 'INVALID_BATCH_STATUS') {
      throw AppError.conflict(
        'INVALID_BATCH_STATUS',
        `Only active batches can be closed (this one is ${locked.status})`,
      );
    }
    if (blocker === 'BATCH_NOT_ENDED') {
      throw AppError.conflict(
        'BATCH_NOT_ENDED',
        `The batch can be closed after its end date (${day(batch.endDate)})`,
      );
    }
    if (blocker === 'STUDENTS_UNDECIDED') {
      throw AppError.conflict(
        'STUDENTS_UNDECIDED',
        `${undecided.length} student(s) still need a completion decision`,
        undecided.map((u) => ({
          path: u.student.rollNo,
          message: u.student.user.fullName,
        })),
      );
    }
    await tx.batch.update({ where: { id }, data: { status: 'CLOSED' } });
    await log({
      action: 'BATCH_CLOSED',
      entity: 'Batch',
      entityId: id,
      oldValue: { status: 'ACTIVE' },
      newValue: { status: 'CLOSED' },
    });
    return toSummary(await loadBatch(tx, id));
  });
}

// ─── Admin: placing students (BRQ-4.4, BR-03) ──────────────────────────────────

const placedStatus = (batchStatus: BatchStatus): EnrollmentStatus =>
  batchStatus === 'ACTIVE' ? 'ACTIVE' : 'ALLOCATED';

/** Places an APPROVED or WAITLISTED applicant in a batch ("promote from waitlist"). */
export async function addStudent(
  actor: Actor,
  batchId: string,
  enrollmentId: string,
): Promise<BatchDetail> {
  const facts = await enrollments.placementFacts(enrollmentId);
  if (!facts) throw AppError.notFound('Application not found');
  if (facts.status !== 'APPROVED' && facts.status !== 'WAITLISTED') {
    throw AppError.conflict(
      'NOT_PLACEABLE',
      `Only approved or waitlisted applications can be placed (this one is ${facts.status})`,
    );
  }
  await withAudit(actor, async (tx, log) => {
    const b = await lockBatch(tx, batchId);
    if (b.status === 'CLOSED') throw AppError.conflict('BATCH_CLOSED', 'This batch is closed');
    if (await tx.batchStudent.findUnique({ where: { enrollmentId } })) {
      throw AppError.conflict('ALREADY_PLACED', 'This student is already in a batch');
    }
    if (facts.cycleId !== b.cycle_id)
      throw AppError.conflict('WRONG_CYCLE', 'The application is for a different cycle');
    if (!facts.preferences.includes(b.course_id)) {
      throw AppError.conflict('COURSE_NOT_PREFERRED', 'The student did not choose this course');
    }
    if (b.members >= b.capacity) throw AppError.conflict('BATCH_FULL', 'This batch is full');
    await tx.batchStudent.create({ data: { batchId, enrollmentId, studentId: facts.studentId } });
    await log({
      action: 'BATCH_STUDENT_ADDED',
      entity: 'Batch',
      entityId: batchId,
      newValue: { enrollmentId, studentId: facts.studentId },
    });
    const course = await tx.course.findUniqueOrThrow({
      where: { id: b.course_id },
      select: { title: true },
    });
    const batch = await tx.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { name: true },
    });
    await enrollments.changeStatuses(tx, log, [
      {
        enrollmentId,
        from: ['APPROVED', 'WAITLISTED'],
        to: placedStatus(b.status),
        reason: null,
        notify: {
          userId: facts.userId,
          type: 'ENROLLMENT_ALLOCATED',
          title: 'You have a batch',
          body: `${course.title}, ${batch.name}`,
          data: { courseTitle: course.title, batchName: batch.name, cycleName: facts.cycleName },
        },
      },
    ]);
  });
  return detail(batchId, 'ADMIN');
}

/** Takes an ALLOCATED student out of a planned batch; the application returns to APPROVED. */
export async function removeStudent(
  actor: Actor,
  batchId: string,
  enrollmentId: string,
): Promise<BatchDetail> {
  await withAudit(actor, async (tx, log) => {
    const b = await lockBatch(tx, batchId);
    const member = await tx.batchStudent.findUnique({ where: { enrollmentId } });
    if (!member || member.batchId !== batchId)
      throw AppError.notFound('This student is not in the batch');
    if (b.status !== 'PLANNED') {
      throw AppError.conflict(
        'BATCH_NOT_PLANNED',
        'Students can only be removed before the batch starts',
      );
    }
    await tx.batchStudent.delete({ where: { enrollmentId } });
    await log({
      action: 'BATCH_STUDENT_REMOVED',
      entity: 'Batch',
      entityId: batchId,
      oldValue: { enrollmentId, studentId: member.studentId },
    });
    await enrollments.changeStatuses(tx, log, [
      { enrollmentId, from: ['ALLOCATED'], to: 'APPROVED' },
    ]);
  });
  return detail(batchId, 'ADMIN');
}

/**
 * L4: a student leaves training. From a planned batch the seat is simply given up (membership
 * removed, ALLOCATED → WITHDRAWN). From a running batch the membership stays, so attendance and
 * marks so far remain on record, but the student no longer holds a seat, is left off sheets and
 * risk checks, and the application becomes WITHDRAWN with the reason. Audited and notified.
 */
export async function withdrawStudent(
  actor: Actor,
  batchId: string,
  enrollmentId: string,
  reason: string,
): Promise<BatchDetail> {
  const facts = await enrollments.placementFacts(enrollmentId);
  if (!facts) throw AppError.notFound('Application not found');
  await withAudit(actor, async (tx, log) => {
    const b = await lockBatch(tx, batchId);
    const member = await tx.batchStudent.findUnique({ where: { enrollmentId } });
    if (!member || member.batchId !== batchId)
      throw AppError.notFound('This student is not in the batch');
    if (b.status === 'CLOSED') throw AppError.conflict('BATCH_CLOSED', 'This batch is closed');
    const from = placedStatus(b.status);
    if (facts.status !== from) {
      throw AppError.conflict(
        'NOT_IN_TRAINING',
        `Only a student in training can be withdrawn (this one is ${facts.status})`,
      );
    }
    if (b.status === 'PLANNED') await tx.batchStudent.delete({ where: { enrollmentId } });
    const batch = await tx.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { name: true, course: { select: { title: true } } },
    });
    await log({
      action: 'BATCH_STUDENT_WITHDRAWN',
      entity: 'Batch',
      entityId: batchId,
      oldValue: { enrollmentId, studentId: member.studentId, status: from },
      newValue: { status: 'WITHDRAWN', reason, keptOnRoster: b.status === 'ACTIVE' },
    });
    await enrollments.changeStatuses(tx, log, [
      {
        enrollmentId,
        from: [from],
        to: 'WITHDRAWN',
        reason,
        notify: {
          userId: facts.userId,
          type: 'TRAINING_WITHDRAWN',
          title: 'Withdrawn from training',
          body: `${batch.course.title}, ${batch.name}: ${reason}`,
          data: { courseTitle: batch.course.title, batchName: batch.name, reason },
        },
      },
    ]);
  });
  return detail(batchId, 'ADMIN');
}

/** Moves a student to another batch in the same cycle and one of their chosen courses (TC-07). */
export async function moveStudent(
  actor: Actor,
  fromBatchId: string,
  enrollmentId: string,
  toBatchId: string,
): Promise<BatchDetail> {
  if (fromBatchId === toBatchId)
    throw AppError.unprocessable('SAME_BATCH', 'Choose a different batch');
  const facts = await enrollments.placementFacts(enrollmentId);
  if (!facts) throw AppError.notFound('Application not found');
  if (facts.status !== 'ALLOCATED' && facts.status !== 'ACTIVE') {
    throw AppError.conflict(
      'NOT_IN_TRAINING',
      `Only a student in training can be moved (this one is ${facts.status})`,
    );
  }
  await withAudit(actor, async (tx, log) => {
    // Lock in a stable order so two opposite moves cannot deadlock.
    const [first, second] = [fromBatchId, toBatchId].sort();
    const locks = {
      [first!]: await lockBatch(tx, first!),
      [second!]: await lockBatch(tx, second!),
    };
    const from = locks[fromBatchId]!;
    const to = locks[toBatchId]!;
    const member = await tx.batchStudent.findUnique({ where: { enrollmentId } });
    if (!member || member.batchId !== fromBatchId)
      throw AppError.notFound('This student is not in the batch');
    if (to.status === 'CLOSED')
      throw AppError.conflict('BATCH_CLOSED', 'The target batch is closed');
    if (to.cycle_id !== from.cycle_id)
      throw AppError.conflict('WRONG_CYCLE', 'Batches are in different cycles');
    if (!facts.preferences.includes(to.course_id)) {
      throw AppError.conflict('COURSE_NOT_PREFERRED', 'The student did not choose that course');
    }
    if (to.members >= to.capacity)
      throw AppError.conflict('BATCH_FULL', 'The target batch is full');
    await tx.batchStudent.update({
      where: { enrollmentId },
      data: { batchId: toBatchId, allocatedAt: new Date() },
    });
    await log({
      action: 'BATCH_STUDENT_MOVED',
      entity: 'Enrollment',
      entityId: enrollmentId,
      oldValue: { batchId: fromBatchId },
      newValue: { batchId: toBatchId },
    });
    const target = placedStatus(to.status);
    if (target !== facts.status) {
      await enrollments.changeStatuses(tx, log, [
        { enrollmentId, from: ['ALLOCATED', 'ACTIVE'], to: target },
      ]);
    }
  });
  return detail(toBatchId, 'ADMIN');
}

// ─── Admin: trainers (BRQ-4.3) ─────────────────────────────────────────────────

export async function assignTrainer(
  actor: Actor,
  batchId: string,
  trainerId: string,
): Promise<BatchDetail> {
  await withAudit(actor, async (tx, log) => {
    const b = await lockBatch(tx, batchId);
    if (b.status === 'CLOSED') throw AppError.conflict('BATCH_CLOSED', 'This batch is closed');
    const trainer = await tx.trainer.findUnique({
      where: { id: trainerId },
      select: { user: { select: { isActive: true } } },
    });
    if (!trainer || !trainer.user.isActive) throw AppError.notFound('Trainer not found');
    const exists = await tx.trainerAssignment.findUnique({
      where: { batchId_trainerId: { batchId, trainerId } },
    });
    if (exists) throw AppError.conflict('ALREADY_ASSIGNED', 'This trainer is already assigned');
    await tx.trainerAssignment.create({ data: { batchId, trainerId } });
    await log({
      action: 'TRAINER_ASSIGNED',
      entity: 'Batch',
      entityId: batchId,
      newValue: { trainerId },
    });
  });
  return detail(batchId, 'ADMIN');
}

export async function unassignTrainer(
  actor: Actor,
  batchId: string,
  trainerId: string,
): Promise<BatchDetail> {
  await withAudit(actor, async (tx, log) => {
    const b = await lockBatch(tx, batchId);
    const removed = await tx.trainerAssignment.deleteMany({ where: { batchId, trainerId } });
    if (removed.count === 0) throw AppError.notFound('This trainer is not assigned to the batch');
    if (b.status === 'ACTIVE' && (await tx.trainerAssignment.count({ where: { batchId } })) === 0) {
      throw AppError.conflict('LAST_TRAINER', 'An active batch must keep at least one trainer');
    }
    await log({
      action: 'TRAINER_UNASSIGNED',
      entity: 'Batch',
      entityId: batchId,
      oldValue: { trainerId },
    });
  });
  return detail(batchId, 'ADMIN');
}

// ─── Admin: sessions (BRQ-4.3) ─────────────────────────────────────────────────

// ─── Scheduling clashes (BR-20, BRQ-14.2) ──────────────────────────────────────

export interface Booking extends BookedSlot {
  id: string;
  batchId: string;
  batchName: string;
  trainerNames: Map<string, string>;
}

/**
 * Sessions (not cancelled) overlapping [from, to) that use one of these venues or trainers, with
 * the trainers who teach each one (named on the session, else the batch's assigned trainers).
 * Pass the transaction client to read inside a locked transaction.
 */
export async function bookingsOverlapping(
  db: Tx | ReturnType<typeof prisma>,
  window: { from: Date; to: Date },
  filter: { venues: string[]; trainerIds: string[]; excludeSessionIds?: string[] },
): Promise<Booking[]> {
  const venues = [...new Set(filter.venues.map((v) => v.trim()).filter(Boolean))];
  const trainerIds = [...new Set(filter.trainerIds)];
  if (venues.length === 0 && trainerIds.length === 0) return [];
  const rows = await db.trainingSession.findMany({
    where: {
      status: { not: 'CANCELLED' },
      startsAt: { lt: window.to },
      endsAt: { gt: window.from },
      ...(filter.excludeSessionIds?.length ? { id: { notIn: filter.excludeSessionIds } } : {}),
      OR: [
        ...venues.map((v) => ({ venue: { equals: v, mode: 'insensitive' as const } })),
        ...(trainerIds.length
          ? [
              { trainerId: { in: trainerIds } },
              { trainerId: null, batch: { trainers: { some: { trainerId: { in: trainerIds } } } } },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      batchId: true,
      startsAt: true,
      endsAt: true,
      venue: true,
      trainerId: true,
      trainer: { select: { user: { select: { fullName: true } } } },
      batch: {
        select: {
          name: true,
          trainers: {
            select: {
              trainerId: true,
              trainer: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
      },
    },
  });
  return rows.map((r) => {
    const names = new Map<string, string>();
    if (r.trainerId) names.set(r.trainerId, r.trainer?.user.fullName ?? '');
    else for (const t of r.batch.trainers) names.set(t.trainerId, t.trainer.user.fullName);
    return {
      id: r.id,
      batchId: r.batchId,
      batchName: r.batch.name,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      venue: r.venue,
      explicitTrainerId: r.trainerId,
      trainerIds: [...names.keys()],
      trainerNames: names,
    };
  });
}

/** Trainers assigned to a batch (ids and names), for the scheduling advisor. */
export async function assignedTrainers(
  batchId: string,
): Promise<Array<{ id: string; fullName: string }>> {
  const rows = await prisma().trainerAssignment.findMany({
    where: { batchId },
    select: { trainerId: true, trainer: { select: { user: { select: { fullName: true } } } } },
  });
  return rows.map((r) => ({ id: r.trainerId, fullName: r.trainer.user.fullName }));
}

/** A batch's sessions that have not been cancelled and have not ended yet. */
export async function upcomingSessions(
  batchId: string,
  now = new Date(),
): Promise<
  Array<{ id: string; startsAt: Date; endsAt: Date; venue: string; trainerId: string | null }>
> {
  return prisma().trainingSession.findMany({
    where: { batchId, status: { not: 'CANCELLED' }, endsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, endsAt: true, venue: true, trainerId: true },
  });
}

/** Capacity facts for the scheduling advisor (BRQ-14.1). */
export async function capacityOf(
  batchIds: string[],
): Promise<
  Map<
    string,
    { name: string; capacity: number; enrolled: number; courseTitle: string; venue: string }
  >
> {
  const rows = await prisma().batch.findMany({
    where: { id: { in: batchIds } },
    select: {
      id: true,
      name: true,
      capacity: true,
      venue: true,
      course: { select: { title: true } },
      _count: { select: { students: { where: SEATED } } },
    },
  });
  return new Map(
    rows.map((b) => [
      b.id,
      {
        name: b.name,
        capacity: b.capacity,
        enrolled: b._count.students,
        courseTitle: b.course.title,
        venue: b.venue,
      },
    ]),
  );
}

export async function createSessions(
  actor: Actor,
  batchId: string,
  input: SessionCreateInput,
): Promise<SessionDto[]> {
  const batch = await prisma().batch.findUnique({ where: { id: batchId } });
  if (!batch) throw AppError.notFound('Batch not found');
  if (batch.status === 'CLOSED') throw AppError.conflict('BATCH_CLOSED', 'This batch is closed');

  let slots: Array<{ startsAt: Date; endsAt: Date }>;
  if (input.kind === 'single') {
    slots = [{ startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) }];
  } else {
    const offset = await settings.get('institution.utcOffsetMinutes');
    try {
      slots = expandRecurring(input, offset);
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'TOO_MANY_SESSIONS') {
        throw AppError.unprocessable(
          'TOO_MANY_SESSIONS',
          `A schedule can create at most ${MAX_GENERATED_SESSIONS} sessions`,
        );
      }
      throw AppError.unprocessable('INVALID_TIMES', 'The session must end after it starts');
    }
  }
  if (slots.length === 0)
    throw AppError.unprocessable('NO_SESSIONS', 'No dates match this schedule');

  // Sessions must fall within the batch's dates (start date 00:00 to end date 23:59 local).
  const offset = await settings.get('institution.utcOffsetMinutes');
  const windowStart = new Date(batch.startDate.getTime() - offset * 60_000);
  const windowEnd = new Date(batch.endDate.getTime() + 86_400_000 - offset * 60_000);
  for (const s of slots) {
    if (s.endsAt <= s.startsAt)
      throw AppError.unprocessable('INVALID_TIMES', 'The session must end after it starts');
    if (s.startsAt < windowStart || s.endsAt > windowEnd) {
      throw AppError.unprocessable(
        'OUTSIDE_BATCH_DATES',
        'Sessions must fall within the batch dates',
      );
    }
  }
  if (input.trainerId) {
    const assigned = await prisma().trainerAssignment.findUnique({
      where: { batchId_trainerId: { batchId, trainerId: input.trainerId } },
    });
    if (!assigned)
      throw AppError.unprocessable('TRAINER_NOT_ASSIGNED', 'Assign the trainer to the batch first');
  }

  const venue = input.venue ?? batch.venue;
  // Who teaches the new sessions: the named trainer, else everyone assigned to the batch (T3).
  const teachers = input.trainerId
    ? [input.trainerId]
    : (
        await prisma().trainerAssignment.findMany({
          where: { batchId },
          select: { trainerId: true },
        })
      ).map((a) => a.trainerId);
  return withAudit(actor, async (tx, log) => {
    // BR-20: serialise scheduling so two admins can't book the same slot at once, then refuse
    // hard clashes (same venue, or the same trainer named on both sessions).
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('schedule'))`;
    const window = {
      from: new Date(Math.min(...slots.map((x) => x.startsAt.getTime()))),
      to: new Date(Math.max(...slots.map((x) => x.endsAt.getTime()))),
    };
    const booked = await bookingsOverlapping(tx, window, {
      venues: [venue],
      trainerIds: teachers,
    });
    const explicit = input.trainerId ?? null;
    const hard = slots.flatMap((slot, i) =>
      clashesFor({ ...slot, venue, explicitTrainerId: explicit, trainerIds: teachers }, booked)
        .filter((c) => c.hard)
        .map((c) => ({ i, c })),
    );
    if (hard.length) {
      throw AppError.conflict(
        'SCHEDULE_CLASH',
        hard[0]!.c.kind === 'VENUE'
          ? `${venue} is already booked by ${hard[0]!.c.other.batchName} at that time`
          : `The trainer already teaches ${hard[0]!.c.other.batchName} at that time`,
        hard.slice(0, 20).map(({ i, c }) => ({
          path: `sessions[${i}]`,
          message: `${c.kind} clash with ${c.other.batchName} ${c.other.startsAt.toISOString()}–${c.other.endsAt.toISOString()}${
            c.kind === 'VENUE' ? ` at ${c.other.venue}` : ''
          }`,
        })),
      );
    }
    await tx.trainingSession.createMany({
      data: slots.map((s) => ({
        batchId,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        venue,
        topic: input.topic ?? null,
        trainerId: input.trainerId ?? null,
      })),
    });
    await log({
      action: 'SESSIONS_SCHEDULED',
      entity: 'Batch',
      entityId: batchId,
      newValue: { count: slots.length, first: slots[0]!.startsAt, last: slots.at(-1)!.startsAt },
    });
    const created = await tx.trainingSession.findMany({
      where: { batchId, startsAt: { in: slots.map((s) => s.startsAt) } },
      orderBy: { startsAt: 'asc' },
      include: sessionInclude,
    });
    return created.map(toSession);
  });
}

export async function cancelSession(
  actor: Actor,
  batchId: string,
  sessionId: string,
): Promise<SessionDto> {
  return withAudit(actor, async (tx, log) => {
    const s = await tx.trainingSession.findUnique({ where: { id: sessionId } });
    if (!s || s.batchId !== batchId) throw AppError.notFound('Session not found');
    if (s.status !== 'SCHEDULED') {
      throw AppError.conflict('SESSION_NOT_SCHEDULED', 'Only scheduled sessions can be cancelled');
    }
    const updated = await tx.trainingSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED' },
      include: sessionInclude,
    });
    await log({
      action: 'SESSION_CANCELLED',
      entity: 'TrainingSession',
      entityId: sessionId,
      oldValue: { status: s.status },
      newValue: { status: 'CANCELLED' },
    });
    return toSession(updated);
  });
}

/** A student's batch placements, newest cycle first (for the training summary). */
export async function placementsOf(studentId: string) {
  const rows = await prisma().batchStudent.findMany({
    where: { studentId },
    orderBy: { batch: { startDate: 'desc' } },
    select: {
      enrollmentId: true,
      batch: {
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          course: { select: { title: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    enrollmentId: r.enrollmentId,
    batch: {
      id: r.batch.id,
      name: r.batch.name,
      status: r.batch.status,
      courseTitle: r.batch.course.title,
      startDate: day(r.batch.startDate),
      endDate: day(r.batch.endDate),
    },
  }));
}

/** The batch an application is placed in (completion, certificates), or null. */
export async function placementOf(enrollmentId: string) {
  const r = await prisma().batchStudent.findUnique({
    where: { enrollmentId },
    select: {
      studentId: true,
      batch: {
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          course: { select: { title: true } },
        },
      },
    },
  });
  if (!r) return null;
  return {
    studentId: r.studentId,
    batch: {
      id: r.batch.id,
      name: r.batch.name,
      status: r.batch.status,
      courseTitle: r.batch.course.title,
      startDate: day(r.batch.startDate),
      endDate: day(r.batch.endDate),
    },
  };
}

/** Batches per status (admin dashboard, BRQ-9.1). */
export async function statusCounts(): Promise<Record<BatchStatus, number>> {
  const rows = await prisma().batch.groupBy({ by: ['status'], _count: { _all: true } });
  const counts: Record<BatchStatus, number> = { PLANNED: 0, ACTIVE: 0, CLOSED: 0 };
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}

/**
 * D3: planned or running batches whose ONLY trainer is one of these users. Deactivating such a
 * trainer would leave the batch with nobody able to mark attendance or record marks.
 */
export async function batchesOnlyTaughtBy(
  userIds: string[],
): Promise<Array<{ userId: string; trainerName: string; batch: string }>> {
  if (userIds.length === 0) return [];
  const rows = await prisma().trainerAssignment.findMany({
    where: {
      trainer: { userId: { in: userIds } },
      batch: { status: { in: ['PLANNED', 'ACTIVE'] } },
    },
    select: {
      trainer: { select: { userId: true, user: { select: { fullName: true } } } },
      batch: {
        select: {
          name: true,
          course: { select: { title: true } },
          _count: { select: { trainers: true } },
        },
      },
    },
  });
  return rows
    .filter((r) => r.batch._count.trainers === 1)
    .map((r) => ({
      userId: r.trainer.userId,
      trainerName: r.trainer.user.fullName,
      batch: `${r.batch.course.title} · ${r.batch.name}`,
    }));
}
