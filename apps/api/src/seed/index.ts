import bcrypt from 'bcrypt';
import { Role, type PrismaClient } from '@prisma/client';
import { SETTINGS, SETTING_KEYS } from '../core/settings/registry';
import {
  ADMIN,
  COURSES,
  PROGRAMMES,
  SEED_ADMIN_PASSWORD,
  SEED_PASSWORD,
  TRAINERS,
  makeStudents,
} from './data';

const BCRYPT_COST = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** Classes start this long after seeding, so the application window has time to run. */
const CLASSES_START_IN_DAYS = 35;
/** The cycle is long enough for the longest course (24 weeks). */
const CYCLE_WEEKS = 26;

/**
 * Settings this deployment uses instead of the registry default: at KISS a student applies for
 * one course (chosen within a programme), not three ranked ones.
 */
const SETTING_OVERRIDES: Partial<Record<(typeof SETTING_KEYS)[number], unknown>> = {
  'enrollment.maxPreferences': 1,
};

export interface SeedOptions {
  log?: (message: string) => void;
}

/**
 * A clean starting database: settings, the admin, one trainer per programme, 100 students,
 * one training cycle open for applications, the programmes and their courses, and one planned
 * batch per course with its trainer. No applications, marks or certificates.
 *
 * Idempotent: every write is an upsert or createMany(skipDuplicates), so running it again only
 * fills in what is missing. It never overwrites a Setting an admin has changed.
 */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions = {}) {
  const log = opts.log ?? (() => undefined);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_COST);

  // Settings: insert defaults only for keys that have no row yet.
  const settings = await prisma.setting.createMany({
    data: SETTING_KEYS.map((key) => ({
      key,
      value: (key in SETTING_OVERRIDES ? SETTING_OVERRIDES[key] : SETTINGS[key].default) as never,
    })),
    skipDuplicates: true,
  });
  log(`settings: ${settings.count} added (${SETTING_KEYS.length} defined)`);

  await prisma.user.upsert({
    where: { email: ADMIN.email },
    create: {
      email: ADMIN.email,
      fullName: ADMIN.fullName,
      role: Role.ADMIN,
      passwordHash:
        SEED_ADMIN_PASSWORD === SEED_PASSWORD
          ? passwordHash
          : await bcrypt.hash(SEED_ADMIN_PASSWORD, BCRYPT_COST),
    },
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

  const students = makeStudents();
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
    select: { id: true, email: true },
  });
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
  const name = `${year}-${String(year + 1).slice(2)} Training Cycle`;
  const startsOn = new Date(now.getTime() + CLASSES_START_IN_DAYS * DAY_MS);
  const cycle = await prisma.trainingCycle.upsert({
    where: { name },
    create: { name, startsOn, endsOn: new Date(startsOn.getTime() + CYCLE_WEEKS * WEEK_MS) },
    update: {},
  });
  log(`cycle: ${cycle.name}`);

  let batches = 0;
  for (const [i, p] of PROGRAMMES.entries()) {
    const programme = await prisma.programme.upsert({
      where: { name: p.name },
      create: { name: p.name, sortOrder: (i + 1) * 10 },
      update: {},
    });
    const trainer = await prisma.trainer.findUniqueOrThrow({
      where: { employeeCode: TRAINERS[i]!.employeeCode },
    });
    for (const c of p.courses) {
      const course = await prisma.course.upsert({
        where: { code: c.code },
        create: { ...c, programmeId: programme.id },
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

      // One planned batch per course, its programme's trainer assigned, no students yet.
      const batchName = 'Batch A';
      const batch = await prisma.batch.findUnique({
        where: {
          courseId_cycleId_name: { courseId: course.id, cycleId: cycle.id, name: batchName },
        },
      });
      if (batch) continue;
      await prisma.batch.create({
        data: {
          courseId: course.id,
          cycleId: cycle.id,
          name: batchName,
          capacity: c.seatCapacity,
          startDate: cycle.startsOn,
          endDate: new Date(cycle.startsOn.getTime() + c.durationWeeks * WEEK_MS),
          venue: `${p.name} block`,
          trainers: { create: { trainerId: trainer.id } },
        },
      });
      batches++;
    }
  }
  log(`programmes: ${PROGRAMMES.length}`);
  log(`courses: ${COURSES.length} with open enrollment windows`);
  log(`batches: ${batches} added ("Batch A" per course, trainer assigned, no students yet)`);

  // F20: build the outcome views so the analytics page works straight away (they stay empty
  // until batches complete; production refreshes them nightly).
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

  return {
    students: students.length,
    trainers: TRAINERS.length,
    programmes: PROGRAMMES.length,
    courses: COURSES.length,
  };
}
