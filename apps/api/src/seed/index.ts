import bcrypt from 'bcrypt';
import { Role, type PrismaClient } from '@prisma/client';
import { audit } from '../core/audit';
import { SETTINGS, SETTING_KEYS } from '../core/settings/registry';
import { ADMIN, COURSES, SEED_PASSWORD, TRAINERS, makeStudents } from './data';
import { seedCompetencies } from './competency';
import { seedOpportunities } from './opportunities';
import { seedCompletionReadiness, seedTraining } from './training';

/**
 * Students from this number on get a pending application, so the admin review screen has data.
 * Students before it stay free to apply in demos and end-to-end tests.
 */
export const APPLICANTS_FROM = 31;

/**
 * One pending application per applicant with 1–3 ranked preferences, rotating through the
 * courses. Skips students who already have an application in the cycle. Each new application
 * gets its ENROLLMENT_SUBMITTED audit row, like one made through the API.
 */
async function seedApplications(
  prisma: PrismaClient,
  cycleId: string,
  students: ReturnType<typeof makeStudents>,
): Promise<number> {
  const courses = await prisma.course.findMany({
    where: { code: { in: COURSES.map((c) => c.code) } },
    orderBy: { code: 'asc' },
    select: { id: true },
  });
  const applicants = students.filter((s) => s.n >= APPLICANTS_FROM && s.n <= DEFAULT_STUDENTS);
  const rows = await prisma.student.findMany({
    where: { rollNo: { in: applicants.map((s) => s.rollNo) } },
    select: { id: true, rollNo: true, enrollments: { where: { cycleId }, select: { id: true } } },
  });
  let created = 0;
  for (const [i, student] of rows.entries()) {
    if (student.enrollments.length > 0) continue;
    const count = (i % 3) + 1;
    const courseIds = Array.from(
      { length: count },
      (_, k) => courses[(i + k) % courses.length]!.id,
    );
    await prisma.$transaction(async (tx) => {
      const e = await tx.enrollment.create({
        data: {
          studentId: student.id,
          cycleId,
          submittedAt: new Date(Date.now() - (rows.length - i) * 60_000),
          preferences: {
            create: courseIds.map((courseId, rank) => ({ courseId, rank: rank + 1 })),
          },
        },
      });
      await audit.record(tx, {
        userId: null,
        action: 'ENROLLMENT_SUBMITTED',
        entity: 'Enrollment',
        entityId: e.id,
        newValue: { status: 'PENDING', courseIds, by: 'seed' },
      });
    });
    created++;
  }
  return created;
}

export const DEFAULT_STUDENTS = 40;
export const LARGE_STUDENTS = 500;
const BCRYPT_COST = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedOptions {
  /** Seed 500 students instead of 40 (BO-3 allocation timing test). */
  large?: boolean;
  log?: (message: string) => void;
}

/**
 * Idempotent: every write is an upsert or createMany(skipDuplicates), so running it again only
 * fills in what is missing. It never overwrites a Setting an admin has changed.
 */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions = {}) {
  const log = opts.log ?? (() => undefined);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_COST);

  // Settings: insert defaults only for keys that have no row yet.
  const settings = await prisma.setting.createMany({
    data: SETTING_KEYS.map((key) => ({ key, value: SETTINGS[key].default as never })),
    skipDuplicates: true,
  });
  log(`settings: ${settings.count} added (${SETTING_KEYS.length} defined)`);

  await prisma.user.upsert({
    where: { email: ADMIN.email },
    create: { email: ADMIN.email, fullName: ADMIN.fullName, role: Role.ADMIN, passwordHash },
    update: {},
  });
  log('admin: 1');

  for (const t of TRAINERS) {
    await prisma.user.upsert({
      where: { email: t.email },
      create: {
        email: t.email,
        fullName: t.fullName,
        role: Role.TRAINER,
        passwordHash,
        trainer: { create: { employeeCode: t.employeeCode, specialization: t.specialization } },
      },
      update: {},
    });
  }
  log(`trainers: ${TRAINERS.length}`);

  const students = makeStudents(opts.large ? LARGE_STUDENTS : DEFAULT_STUDENTS);
  await prisma.user.createMany({
    data: students.map((s) => ({
      email: s.email,
      fullName: s.fullName,
      role: Role.STUDENT,
      passwordHash,
    })),
    skipDuplicates: true,
  });
  const users = await prisma.user.findMany({
    where: { email: { in: students.map((s) => s.email) } },
    select: { id: true, email: true, fullName: true },
  });
  // A database seeded before the names were made unique gets them now (only these accounts).
  const renamed = students.filter(
    (s) => users.find((u) => u.email === s.email)?.fullName !== s.fullName,
  );
  for (const s of renamed) {
    await prisma.user.update({ where: { email: s.email }, data: { fullName: s.fullName } });
  }
  if (renamed.length) log(`students renamed: ${renamed.length}`);
  const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));
  await prisma.student.createMany({
    data: students.map((s) => ({
      userId: userIdByEmail.get(s.email)!,
      rollNo: s.rollNo,
      cgpa: s.cgpa,
      phone: s.phone,
    })),
    skipDuplicates: true,
  });
  log(`students: ${students.length}`);

  const now = new Date();
  const year = now.getUTCFullYear();
  const cycle = await prisma.trainingCycle.upsert({
    where: { name: `${year}-${String(year + 1).slice(2)} Cycle 1` },
    create: {
      name: `${year}-${String(year + 1).slice(2)} Cycle 1`,
      startsOn: new Date(now.getTime() + 35 * DAY_MS),
      endsOn: new Date(now.getTime() + 35 * DAY_MS + 16 * 7 * DAY_MS),
    },
    update: {},
  });
  log(`cycle: ${cycle.name}`);

  for (const c of COURSES) {
    const course = await prisma.course.upsert({
      where: { code: c.code },
      create: { ...c },
      update: {},
    });
    const existing = await prisma.courseOffering.findUnique({
      where: { courseId_cycleId: { courseId: course.id, cycleId: cycle.id } },
    });
    if (!existing) {
      await prisma.courseOffering.create({
        data: {
          courseId: course.id,
          cycleId: cycle.id,
          enrollmentOpensAt: new Date(now.getTime() - DAY_MS),
          enrollmentClosesAt: new Date(now.getTime() + 30 * DAY_MS),
          isOpen: true,
        },
      });
    } else if (existing.enrollmentClosesAt < now) {
      // Keep the demo usable: a re-seed reopens a window that has lapsed on a dev machine.
      await prisma.courseOffering.update({
        where: { id: existing.id },
        data: { enrollmentClosesAt: new Date(now.getTime() + 30 * DAY_MS), isOpen: true },
      });
    }
  }
  log(`courses: ${COURSES.length} with open enrollment windows`);

  const applications = await seedApplications(prisma, cycle.id, students);
  log(`applications: ${applications} added (students ${APPLICANTS_FROM}+ have one pending)`);

  // One planned batch per course with a matching trainer, ready for an allocation demo.
  const trainerFor: Record<string, string> = {
    'ELEC-DOM': TRAINERS[0]!.employeeCode,
    'SOLAR-PV': TRAINERS[1]!.employeeCode,
    'TAIL-GMT': TRAINERS[2]!.employeeCode,
  };
  let batches = 0;
  for (const c of COURSES) {
    const course = await prisma.course.findUniqueOrThrow({ where: { code: c.code } });
    const exists = await prisma.batch.findUnique({
      where: { courseId_cycleId_name: { courseId: course.id, cycleId: cycle.id, name: 'Batch A' } },
    });
    if (exists) continue;
    const trainer = await prisma.trainer.findUniqueOrThrow({
      where: { employeeCode: trainerFor[c.code]! },
    });
    await prisma.batch.create({
      data: {
        courseId: course.id,
        cycleId: cycle.id,
        name: 'Batch A',
        capacity: 15,
        startDate: cycle.startsOn,
        endDate: cycle.endsOn,
        venue: `${c.title.split(' ')[0]} workshop`,
        trainers: { create: { trainerId: trainer.id } },
      },
    });
    batches++;
  }
  log(`batches: ${batches} added ("Batch A" per course, trainer assigned, no students yet)`);

  await seedTraining(prisma, log);
  await seedCompletionReadiness(prisma, log);
  await seedCompetencies(prisma, log);
  await seedOpportunities(prisma, log);

  // F20: rebuild the outcome views so a fresh database shows figures straight away (production
  // refreshes them nightly).
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW analytics_batch_outcomes');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW analytics_course_competency');
  // Record it as the refresh job does, so the page shows "Last refreshed" instead of "never".
  await prisma.$executeRaw`
    INSERT INTO job_locks (name, run_id, locked_until, last_run_at, last_success_at, last_result)
    VALUES ('analytics-refresh', gen_random_uuid(), now(), now(), now(), '{"ok":true,"result":true}')
    ON CONFLICT (name) DO UPDATE
      SET last_run_at = now(), last_success_at = now(), last_result = EXCLUDED.last_result
      WHERE job_locks.locked_until < now()`;
  log('analytics: outcome views refreshed');

  return { students: students.length, trainers: TRAINERS.length, courses: COURSES.length };
}
