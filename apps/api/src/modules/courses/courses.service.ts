import { Prisma } from '@prisma/client';
import type {
  AdminCourse,
  BulkStatusInput,
  BulkStatusResult,
  CatalogueCourse,
  CatalogueCycle,
  CourseCreateInput,
  CourseUpdateInput,
  Cycle,
  CycleCreateInput,
  CycleUpdateInput,
  Offering,
  OfferingUpsertInput,
} from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { prisma } from '../../core/db';
import { AppError } from '../../core/errors';
import { settings } from '../../core/settings';
import {
  APPLICATIONS_ORDER,
  cycleApplications,
  cycleEndInstant,
  isWindowOpen,
  windowInsideCycle,
  windowState,
} from './rules';

type OfferingRow = Prisma.CourseOfferingGetPayload<object>;
type CourseRow = Prisma.CourseGetPayload<object>;
type CycleRow = Prisma.TrainingCycleGetPayload<object>;

const day = (d: Date) => d.toISOString().slice(0, 10);

export function toCycle(c: CycleRow): Cycle {
  return { id: c.id, name: c.name, startsOn: day(c.startsOn), endsOn: day(c.endsOn) };
}

export function toOffering(o: OfferingRow, now = new Date()): Offering {
  return {
    courseId: o.courseId,
    cycleId: o.cycleId,
    enrollmentOpensAt: o.enrollmentOpensAt.toISOString(),
    enrollmentClosesAt: o.enrollmentClosesAt.toISOString(),
    isOpen: o.isOpen,
    windowState: windowState(o, now),
  };
}

type CourseUsage = AdminCourse['inUse'];
const NOT_USED: CourseUsage = { batches: 0, students: 0, openWindows: 0 };

function toAdminCourse(c: CourseRow, inUse: CourseUsage = NOT_USED): AdminCourse {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description,
    durationWeeks: c.durationWeeks,
    prerequisites: c.prerequisites,
    prerequisitesNeedReview: c.prerequisitesNeedReview,
    seatCapacity: c.seatCapacity,
    isActive: c.isActive,
    inUse,
  };
}

function uniqueConflict(err: unknown, code: string, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw AppError.conflict(code, message);
  }
  throw err;
}

// ─── Reads used by other modules (exported service functions, rule 5) ─────────

export interface CourseAvailability {
  courseId: string;
  title: string;
  isActive: boolean;
  offering: OfferingRow | null;
}

/** The courses, with their offering in this cycle, that an application may reference. */
export async function availability(
  cycleId: string,
  courseIds: string[],
): Promise<CourseAvailability[]> {
  const courses = await prisma().course.findMany({
    where: { id: { in: courseIds } },
    include: { offerings: { where: { cycleId } } },
  });
  return courses.map((c) => ({
    courseId: c.id,
    title: c.title,
    isActive: c.isActive,
    offering: c.offerings[0] ?? null,
  }));
}

export async function getCycle(cycleId: string): Promise<Cycle> {
  const cycle = await prisma().trainingCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw AppError.notFound('Training cycle not found');
  return toCycle(cycle);
}

/** Every cycle, newest first (Admin). */
export async function listCycles(): Promise<Cycle[]> {
  const cycles = await prisma().trainingCycle.findMany({ orderBy: { startsOn: 'desc' } });
  return cycles.map(toCycle);
}

/**
 * Cycles a student can choose from on the Courses page (BRQ-2.2): those offering at least one
 * active course that have not ended yet, newest first. Nothing is pre-selected for them.
 */
export async function catalogueCycles(now = new Date()): Promise<CatalogueCycle[]> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const active = { course: { isActive: true } };
  const cycles = await prisma().trainingCycle.findMany({
    where: { endsOn: { gte: today }, offerings: { some: active } },
    orderBy: { startsOn: 'desc' },
    include: { offerings: { where: active } },
  });
  // L7: say which cycles take applications, and list those first (stable within a state).
  return cycles
    .map(({ offerings, ...c }) => ({
      ...toCycle(c),
      applications: cycleApplications(offerings.map((o) => windowState(o, now))),
    }))
    .sort((a, b) => APPLICATIONS_ORDER[a.applications] - APPLICATIONS_ORDER[b.applications]);
}

async function defaultCycleId(): Promise<string | null> {
  const cycle = await prisma().trainingCycle.findFirst({
    where: { offerings: { some: {} } },
    orderBy: { startsOn: 'desc' },
    select: { id: true },
  });
  return cycle?.id ?? null;
}

// ─── Catalogue (BRQ-2.2) ──────────────────────────────────────────────────────

/**
 * Active courses offered in a cycle. Seats taken and batch capacity come from the caller
 * (enrollments and batches services), so this module never reads another module's tables.
 * Once a course has batches in the cycle, its seats are the places in those batches (S2):
 * the course's own capacity is only a plan until batches exist.
 */
export async function catalogue(
  cycleId: string | undefined,
  seatsTaken: (cycleId: string) => Promise<Map<string, number>>,
  batchCapacity: (cycleId: string) => Promise<Map<string, number>> = async () => new Map(),
): Promise<{ cycle: Cycle | null; courses: CatalogueCourse[] }> {
  const id = cycleId ?? (await defaultCycleId());
  if (!id) return { cycle: null, courses: [] };
  const cycle = await getCycle(id);
  const now = new Date();
  const [courses, taken] = await Promise.all([
    prisma().course.findMany({
      where: { isActive: true, offerings: { some: { cycleId: id } } },
      include: { offerings: { where: { cycleId: id } } },
      orderBy: { title: 'asc' },
    }),
    seatsTaken(id),
  ]);
  const inBatches = await batchCapacity(id);
  return {
    cycle,
    courses: courses.map((c) => {
      const capacity = inBatches.get(c.id) ?? c.seatCapacity;
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        durationWeeks: c.durationWeeks,
        prerequisites: c.prerequisites,
        seatCapacity: capacity,
        seatsRemaining: Math.max(0, capacity - (taken.get(c.id) ?? 0)),
        offering: c.offerings[0] ? toOffering(c.offerings[0], now) : null,
      };
    }),
  };
}

// ─── Admin: courses (BRQ-2.1) ─────────────────────────────────────────────────

/**
 * Every course with what deactivating it would affect (D4). Live batches come from the caller
 * (batches service), so this module never reads another module's tables.
 */
export async function listCourses(
  liveBatches: () => Promise<Map<string, { batches: number; students: number }>> = async () =>
    new Map(),
): Promise<AdminCourse[]> {
  const now = new Date();
  const [rows, batches] = await Promise.all([
    prisma().course.findMany({
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
      include: {
        offerings: { select: { isOpen: true, enrollmentOpensAt: true, enrollmentClosesAt: true } },
      },
    }),
    liveBatches(),
  ]);
  return rows.map(({ offerings, ...c }) =>
    toAdminCourse(c, {
      batches: batches.get(c.id)?.batches ?? 0,
      students: batches.get(c.id)?.students ?? 0,
      openWindows: offerings.filter((o) => isWindowOpen(o, now)).length,
    }),
  );
}

export async function createCourse(actor: Actor, input: CourseCreateInput): Promise<AdminCourse> {
  try {
    return await withAudit(actor, async (tx, log) => {
      const course = await tx.course.create({ data: input });
      await log({
        action: 'COURSE_CREATED',
        entity: 'Course',
        entityId: course.id,
        newValue: course,
      });
      return toAdminCourse(course);
    });
  } catch (err) {
    uniqueConflict(err, 'COURSE_CODE_TAKEN', 'A course with this code already exists');
  }
}

/** Updates fields; isActive=false is the soft delete (records keep pointing at the course). */
export async function updateCourse(
  actor: Actor,
  id: string,
  input: CourseUpdateInput,
): Promise<AdminCourse> {
  return withAudit(actor, async (tx, log) => {
    const before = await tx.course.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Course not found');
    const course = await tx.course.update({ where: { id }, data: input });
    const action =
      input.isActive === false && before.isActive
        ? 'COURSE_DEACTIVATED'
        : input.isActive === true && !before.isActive
          ? 'COURSE_REACTIVATED'
          : 'COURSE_UPDATED';
    await log({ action, entity: 'Course', entityId: id, oldValue: before, newValue: course });
    return toAdminCourse(course);
  });
}

/** Deactivates or reactivates several courses in one transaction; an unknown id rolls it back. */
export async function setCoursesActive(
  actor: Actor,
  input: BulkStatusInput,
): Promise<BulkStatusResult> {
  return withAudit(actor, async (tx, log) => {
    const before = await tx.course.findMany({ where: { id: { in: input.ids } } });
    if (before.length !== input.ids.length) throw AppError.notFound('Course not found');
    const changing = before.filter((c) => c.isActive !== input.isActive);
    if (changing.length === 0) return { updated: 0 };
    await tx.course.updateMany({
      where: { id: { in: changing.map((c) => c.id) } },
      data: { isActive: input.isActive },
    });
    await log.many(
      changing.map((c) => ({
        action: input.isActive ? 'COURSE_REACTIVATED' : 'COURSE_DEACTIVATED',
        entity: 'Course',
        entityId: c.id,
        oldValue: { isActive: c.isActive },
        newValue: { isActive: input.isActive },
      })),
    );
    return { updated: changing.length };
  });
}

const courseInUse = () =>
  AppError.conflict(
    'COURSE_IN_USE',
    'This course has been offered, applied for or taught, so it cannot be deleted. Deactivate it instead.',
  );

/**
 * Permanently removes a course that nothing refers to yet (e.g. created by mistake). Anything
 * with history keeps its row and can only be deactivated, so records never lose their course.
 */
export async function deleteCourse(actor: Actor, id: string): Promise<void> {
  try {
    await withAudit(actor, async (tx, log) => {
      const course = await tx.course.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              offerings: true,
              preferences: true,
              batches: true,
              competencies: true,
              materials: true,
            },
          },
        },
      });
      if (!course) throw AppError.notFound('Course not found');
      const { _count: uses, ...row } = course;
      if (Object.values(uses).some((n) => n > 0)) throw courseInUse();
      await tx.course.delete({ where: { id } });
      await log({ action: 'COURSE_DELETED', entity: 'Course', entityId: id, oldValue: row });
    });
  } catch (err) {
    // A reference added since the check (or one not counted above) still blocks the delete.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw courseInUse();
    }
    throw err;
  }
}

// ─── Admin: cycles ────────────────────────────────────────────────────────────

export async function createCycle(actor: Actor, input: CycleCreateInput): Promise<Cycle> {
  try {
    return await withAudit(actor, async (tx, log) => {
      const cycle = await tx.trainingCycle.create({
        data: {
          name: input.name,
          startsOn: new Date(input.startsOn),
          endsOn: new Date(input.endsOn),
        },
      });
      await log({
        action: 'CYCLE_CREATED',
        entity: 'TrainingCycle',
        entityId: cycle.id,
        newValue: cycle,
      });
      return toCycle(cycle);
    });
  } catch (err) {
    uniqueConflict(err, 'CYCLE_NAME_TAKEN', 'A cycle with this name already exists');
  }
}

/** Names of a cycle's batches that would fall outside new cycle dates (from the batches module). */
export type BatchesOutside = (cycleId: string, startsOn: Date, endsOn: Date) => Promise<string[]>;

export async function updateCycle(
  actor: Actor,
  id: string,
  input: CycleUpdateInput,
  batchesOutside: BatchesOutside,
): Promise<Cycle> {
  const offset = await settings.get('institution.utcOffsetMinutes');
  try {
    return await withAudit(actor, async (tx, log) => {
      const before = await tx.trainingCycle.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('Training cycle not found');
      const startsOn = input.startsOn ? new Date(input.startsOn) : before.startsOn;
      const endsOn = input.endsOn ? new Date(input.endsOn) : before.endsOn;
      if (endsOn < startsOn) {
        throw AppError.unprocessable('INVALID_DATES', 'The cycle must end on or after its start');
      }
      // L5 / L6: moving the dates must not leave batches or application windows outside them.
      const outside = await batchesOutside(id, startsOn, endsOn);
      if (outside.length) {
        throw AppError.conflict(
          'CYCLE_HAS_BATCHES_OUTSIDE',
          'Some batches would run outside the new cycle dates; change their dates first',
          outside.map((name) => ({ path: 'batch', message: name })),
        );
      }
      const lateWindows = await tx.courseOffering.findMany({
        where: { cycleId: id, enrollmentClosesAt: { gt: cycleEndInstant(endsOn, offset) } },
        select: { course: { select: { title: true } } },
      });
      if (lateWindows.length) {
        throw AppError.conflict(
          'CYCLE_HAS_WINDOWS_OUTSIDE',
          'Some application windows would close after the new end date; change them first',
          lateWindows.map((o) => ({ path: 'offering', message: o.course.title })),
        );
      }
      const cycle = await tx.trainingCycle.update({
        where: { id },
        data: { name: input.name, startsOn, endsOn },
      });
      await log({
        action: 'CYCLE_UPDATED',
        entity: 'TrainingCycle',
        entityId: id,
        oldValue: before,
        newValue: cycle,
      });
      return toCycle(cycle);
    });
  } catch (err) {
    uniqueConflict(err, 'CYCLE_NAME_TAKEN', 'A cycle with this name already exists');
  }
}

// ─── Admin: offerings and enrollment windows (BRQ-2.3) ─────────────────────────

export async function listOfferings(
  cycleId: string,
): Promise<Array<{ course: AdminCourse; offering: Offering | null }>> {
  await getCycle(cycleId);
  const now = new Date();
  const courses = await prisma().course.findMany({
    include: { offerings: { where: { cycleId } } },
    orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
  });
  return courses.map((c) => ({
    course: toAdminCourse(c),
    offering: c.offerings[0] ? toOffering(c.offerings[0], now) : null,
  }));
}

/** Offers a course in a cycle (or edits its window / open toggle). */
export async function upsertOffering(
  actor: Actor,
  cycleId: string,
  courseId: string,
  input: OfferingUpsertInput,
): Promise<Offering> {
  const offset = await settings.get('institution.utcOffsetMinutes');
  return withAudit(actor, async (tx, log) => {
    const [cycle, course] = await Promise.all([
      tx.trainingCycle.findUnique({ where: { id: cycleId }, select: { endsOn: true } }),
      tx.course.findUnique({ where: { id: courseId }, select: { id: true } }),
    ]);
    if (!cycle) throw AppError.notFound('Training cycle not found');
    if (!course) throw AppError.notFound('Course not found');
    if (!windowInsideCycle(new Date(input.enrollmentClosesAt), cycle.endsOn, offset)) {
      const last = cycle.endsOn.toISOString().slice(0, 10);
      throw AppError.unprocessable(
        'WINDOW_AFTER_CYCLE',
        `Applications must close by the end of the cycle (${last})`,
        [{ path: 'enrollmentClosesAt', message: last }],
      );
    }
    const data = {
      enrollmentOpensAt: new Date(input.enrollmentOpensAt),
      enrollmentClosesAt: new Date(input.enrollmentClosesAt),
      isOpen: input.isOpen,
    };
    const before = await tx.courseOffering.findUnique({
      where: { courseId_cycleId: { courseId, cycleId } },
    });
    const offering = await tx.courseOffering.upsert({
      where: { courseId_cycleId: { courseId, cycleId } },
      create: { courseId, cycleId, ...data },
      update: data,
    });
    await log({
      action: before ? 'OFFERING_UPDATED' : 'OFFERING_CREATED',
      entity: 'CourseOffering',
      entityId: offering.id,
      oldValue: before,
      newValue: offering,
    });
    return toOffering(offering);
  });
}

/** Active courses (admin dashboard, BRQ-9.1). */
export async function activeCourseCount(): Promise<number> {
  return prisma().course.count({ where: { isActive: true } });
}
