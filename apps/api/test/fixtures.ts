import { randomUUID } from 'node:crypto';
import { Prisma, Role, type PrismaClient } from '@prisma/client';

/** Integration tests share one database, so every fixture gets a unique suffix. */
export function uid(): string {
  return randomUUID().slice(0, 8);
}

export async function createStudent(db: PrismaClient) {
  const s = uid();
  const user = await db.user.create({
    data: {
      email: `student-${s}@test.local`,
      fullName: `Test Student ${s}`,
      role: Role.STUDENT,
      passwordHash: 'not-a-real-hash',
      student: { create: { rollNo: `T-${s}`, cgpa: new Prisma.Decimal('7.50') } },
    },
    include: { student: true },
  });
  return { user, student: user.student! };
}

export async function createAdmin(db: PrismaClient) {
  const s = uid();
  return db.user.create({
    data: {
      email: `admin-${s}@test.local`,
      fullName: `Test Admin ${s}`,
      role: Role.ADMIN,
      passwordHash: 'not-a-real-hash',
    },
  });
}

export const TEST_PASSWORD = 'Correct-Horse-1';

/** A user who can actually sign in (real bcrypt hash at test cost). */
export async function createLoginUser(
  db: PrismaClient,
  role: Role,
  opts: { isActive?: boolean } = {},
) {
  const s = uid();
  const { hashPassword } = await import('../src/core/auth/password');
  return db.user.create({
    data: {
      email: `${role.toLowerCase()}-${s}@test.local`,
      fullName: `Test ${role} ${s}`,
      role,
      isActive: opts.isActive ?? true,
      passwordHash: await hashPassword(TEST_PASSWORD),
      ...(role === Role.STUDENT
        ? { student: { create: { rollNo: `T-${s}`, cgpa: new Prisma.Decimal('8.10') } } }
        : {}),
      ...(role === Role.TRAINER ? { trainer: { create: { employeeCode: `E-${s}` } } } : {}),
    },
    include: { student: true, trainer: true },
  });
}

const HOUR = 60 * 60 * 1000;

/**
 * A fresh cycle with `count` active courses whose enrollment windows are open now. Each course
 * also gets a unique code so tests can run against a shared database.
 */
export async function createOpenCycle(db: PrismaClient, count = 3) {
  const s = uid();
  const cycle = await db.trainingCycle.create({
    data: { name: `Open ${s}`, startsOn: new Date('2027-01-04'), endsOn: new Date('2027-04-30') },
  });
  const courses = [];
  for (let i = 0; i < count; i++) {
    courses.push(
      await db.course.create({
        data: {
          code: `O${i}-${s}`,
          title: `Open course ${i} ${s}`,
          description: 'Course with an open enrollment window',
          durationWeeks: 8,
          seatCapacity: 10,
          offerings: {
            create: {
              cycleId: cycle.id,
              isOpen: true,
              enrollmentOpensAt: new Date(Date.now() - HOUR),
              enrollmentClosesAt: new Date(Date.now() + 24 * HOUR),
            },
          },
        },
      }),
    );
  }
  return { cycle, courses };
}

/** Moves a course's window in a cycle: 'closed' (ended an hour ago), 'off' (toggle), 'upcoming'. */
export async function setWindow(
  db: PrismaClient,
  cycleId: string,
  courseId: string,
  state: 'closed' | 'off' | 'upcoming' | 'open',
) {
  const now = Date.now();
  const data = {
    closed: {
      isOpen: true,
      enrollmentOpensAt: new Date(now - 2 * HOUR),
      enrollmentClosesAt: new Date(now - HOUR),
    },
    off: {
      isOpen: false,
      enrollmentOpensAt: new Date(now - HOUR),
      enrollmentClosesAt: new Date(now + HOUR),
    },
    upcoming: {
      isOpen: true,
      enrollmentOpensAt: new Date(now + HOUR),
      enrollmentClosesAt: new Date(now + 2 * HOUR),
    },
    open: {
      isOpen: true,
      enrollmentOpensAt: new Date(now - HOUR),
      enrollmentClosesAt: new Date(now + 24 * HOUR),
    },
  }[state];
  await db.courseOffering.update({ where: { courseId_cycleId: { courseId, cycleId } }, data });
}

/**
 * Approved applications created straight in the database (fast, for allocation tests).
 * prefs[i] are course ids in rank order; submission times are 1 minute apart in array order.
 */
export async function createApprovedApplicants(
  db: PrismaClient,
  cycleId: string,
  prefs: string[][],
  opts: { cgpa?: (i: number) => number; status?: 'APPROVED' | 'WAITLISTED' } = {},
) {
  const s = uid();
  const base = Date.now() - prefs.length * 60_000;
  const emails = prefs.map((_, i) => `app-${s}-${i}@test.local`);
  await db.user.createMany({
    data: emails.map((email, i) => ({
      email,
      fullName: `Applicant ${s} ${i}`,
      role: Role.STUDENT,
      passwordHash: 'not-a-real-hash',
    })),
  });
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const userId = new Map(users.map((u) => [u.email, u.id]));
  await db.student.createMany({
    data: emails.map((email, i) => ({
      userId: userId.get(email)!,
      rollNo: `A-${s}-${i}`,
      cgpa: new Prisma.Decimal((opts.cgpa?.(i) ?? 7).toFixed(2)),
    })),
  });
  const students = await db.student.findMany({
    where: { rollNo: { startsWith: `A-${s}-` } },
    select: { id: true, rollNo: true, userId: true },
  });
  const byRoll = new Map(students.map((st) => [st.rollNo, st]));
  const enrollmentIds: string[] = [];
  for (const [i, courseIds] of prefs.entries()) {
    const st = byRoll.get(`A-${s}-${i}`)!;
    const e = await db.enrollment.create({
      data: {
        studentId: st.id,
        cycleId,
        status: opts.status ?? 'APPROVED',
        submittedAt: new Date(base + i * 60_000),
        preferences: { create: courseIds.map((courseId, r) => ({ courseId, rank: r + 1 })) },
      },
    });
    enrollmentIds.push(e.id);
  }
  return enrollmentIds;
}

export async function createBatch(
  db: PrismaClient,
  cycleId: string,
  courseId: string,
  capacity: number,
  name = `B-${uid()}`,
) {
  return db.batch.create({
    data: {
      cycleId,
      courseId,
      name,
      capacity,
      startDate: new Date('2027-01-04'),
      endDate: new Date('2027-03-31'),
      venue: `Workshop A ${uid()}`,
    },
  });
}

/**
 * An ACTIVE batch with an assigned trainer, `students` placed (enrollments ACTIVE, all able to
 * sign in) and `sessions` scheduled in the past, a few hours apart, so attendance can be taken.
 */
export async function createActiveBatch(
  db: PrismaClient,
  opts: { students?: number; sessions?: number } = {},
) {
  const { cycle, courses } = await createOpenCycle(db, 1);
  const batch = await db.batch.create({
    data: {
      cycleId: cycle.id,
      courseId: courses[0]!.id,
      name: `Active ${uid()}`,
      capacity: 30,
      startDate: new Date(Date.now() - 30 * 86_400_000),
      endDate: new Date(Date.now() + 60 * 86_400_000),
      venue: `Workshop C ${uid()}`,
      status: 'ACTIVE',
    },
  });
  const trainer = await createLoginUser(db, Role.TRAINER);
  await db.trainerAssignment.create({
    data: { batchId: batch.id, trainerId: trainer.trainer!.id },
  });
  const students = [];
  for (let i = 0; i < (opts.students ?? 3); i++) {
    const s = await createLoginUser(db, Role.STUDENT);
    const e = await db.enrollment.create({
      data: {
        studentId: s.student!.id,
        cycleId: cycle.id,
        status: 'ACTIVE',
        preferences: { create: { courseId: courses[0]!.id, rank: 1 } },
      },
    });
    await db.batchStudent.create({
      data: { batchId: batch.id, enrollmentId: e.id, studentId: s.student!.id },
    });
    students.push({ user: s, studentId: s.student!.id, enrollmentId: e.id });
  }
  const sessions = [];
  const n = opts.sessions ?? 3;
  for (let i = 0; i < n; i++) {
    // Three hours apart, the last ending an hour ago: all within the 48 h window (L3).
    const startsAt = new Date(Date.now() - (n - i) * 3 * 3_600_000);
    sessions.push(
      await db.trainingSession.create({
        data: {
          batchId: batch.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 7_200_000),
          venue: batch.venue,
        },
      }),
    );
  }
  return { cycle, course: courses[0]!, batch, trainer, students, sessions };
}

/**
 * createActiveBatch plus conducted sessions, one mandatory assessment out of 50, and per student
 * an attendance count, marks and a recommendation (undefined = not recorded).
 */
export async function createTrainedBatch(
  db: PrismaClient,
  plan: Array<{ attended: number; marks?: number; recommended?: boolean }>,
  sessions = 4,
) {
  const w = await createActiveBatch(db, { students: plan.length, sessions });
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
  for (const [i, o] of plan.entries()) {
    const s = w.students[i]!;
    await db.attendance.createMany({
      data: w.sessions.map((session, k) => ({
        sessionId: session.id,
        studentId: s.studentId,
        status: k < o.attended ? ('PRESENT' as const) : ('ABSENT' as const),
        markedById: w.trainer.id,
      })),
    });
    if (o.marks !== undefined) {
      await db.assessmentResult.create({
        data: {
          assessmentId: assessment.id,
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
  }
  return { ...w, assessment };
}

export async function createCycleCourseBatch(db: PrismaClient) {
  const s = uid();
  const cycle = await db.trainingCycle.create({
    data: { name: `Cycle ${s}`, startsOn: new Date('2027-01-04'), endsOn: new Date('2027-04-30') },
  });
  const course = await db.course.create({
    data: {
      code: `C-${s}`,
      title: `Course ${s}`,
      description: 'Test course',
      durationWeeks: 10,
      seatCapacity: 30,
    },
  });
  const batch = await db.batch.create({
    data: {
      courseId: course.id,
      cycleId: cycle.id,
      name: `Batch ${s}`,
      capacity: 25,
      startDate: new Date('2027-01-04'),
      endDate: new Date('2027-03-31'),
      venue: `Workshop A ${uid()}`,
    },
  });
  return { cycle, course, batch };
}
