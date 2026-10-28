import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AllocationPreview } from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { prisma, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { settings } from '../../core/settings';
import * as enrollments from '../enrollments/enrollments.service';
import { allocate } from './rules';

interface Snapshot {
  applicants: enrollments.AllocationApplicant[];
  batches: Array<{
    id: string;
    name: string;
    courseId: string;
    courseTitle: string;
    capacity: number;
    status: string;
    members: number;
  }>;
}

/** Everything the allocation depends on, read in one consistent pass. */
async function snapshot(client: Tx, cycleId: string): Promise<Snapshot> {
  const [applicants, batches] = await Promise.all([
    enrollments.approvedApplicants(cycleId),
    client.batch.findMany({
      where: { cycleId, status: { in: ['PLANNED', 'ACTIVE'] } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        courseId: true,
        capacity: true,
        status: true,
        course: { select: { title: true } },
        _count: {
          select: { students: { where: { enrollment: { status: { not: 'WITHDRAWN' } } } } },
        },
      },
    }),
  ]);
  return {
    applicants,
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      courseId: b.courseId,
      courseTitle: b.course.title,
      capacity: b.capacity,
      status: b.status,
      members: b._count.students,
    })),
  };
}

/**
 * Hash of every input that could change the outcome: approved applications (and when they last
 * changed), batch capacities, statuses and current members, and the priority rule.
 */
function fingerprint(s: Snapshot, rule: string): string {
  const h = createHash('sha256').update(rule);
  for (const a of [...s.applicants].sort((x, y) => x.enrollmentId.localeCompare(y.enrollmentId))) {
    h.update(
      `|a:${a.enrollmentId}:${a.updatedAt.toISOString()}:${a.preferences.join(',')}:${a.cgpa}`,
    );
  }
  for (const b of [...s.batches].sort((x, y) => x.id.localeCompare(y.id))) {
    h.update(`|b:${b.id}:${b.capacity}:${b.status}:${b.members}`);
  }
  return h.digest('hex');
}

/**
 * Runs the allocation engine on current data WITHOUT changing anything and stores the result
 * for confirm (BRQ-4.2). Previews expire after allocation.previewTtlMinutes.
 */
export async function preview(
  actor: Actor & { userId: string },
  cycleId: string,
): Promise<AllocationPreview> {
  const cycle = await prisma().trainingCycle.findUnique({
    where: { id: cycleId },
    select: { id: true },
  });
  if (!cycle) throw AppError.notFound('Training cycle not found');
  const { 'allocation.priorityRule': rule, 'allocation.previewTtlMinutes': ttl } =
    await settings.getMany(['allocation.priorityRule', 'allocation.previewTtlMinutes'] as const);

  const started = performance.now();
  const snap = await snapshot(prisma(), cycleId);
  const result = allocate(
    snap.applicants.map((a) => ({
      enrollmentId: a.enrollmentId,
      preferences: a.preferences,
      submittedAt: a.submittedAt,
      cgpa: a.cgpa,
    })),
    snap.batches.map((b) => ({
      batchId: b.id,
      courseId: b.courseId,
      name: b.name,
      free: b.capacity - b.members,
    })),
    rule,
  );
  const elapsedMs = Math.round(performance.now() - started);

  const byId = new Map(snap.applicants.map((a) => [a.enrollmentId, a]));
  const added = new Map<string, number>();
  for (const x of result.assignments) added.set(x.batchId, (added.get(x.batchId) ?? 0) + 1);

  const warnings: string[] = [];
  const coursesWithBatches = new Set(snap.batches.map((b) => b.courseId));
  const wantedCourses = new Set(snap.applicants.flatMap((a) => a.preferences));
  const uncovered = [...wantedCourses].filter((c) => !coursesWithBatches.has(c));
  if (uncovered.length) warnings.push(`NO_BATCH_FOR_COURSE:${uncovered.length}`);
  if (result.waitlist.length) warnings.push(`WAITLIST:${result.waitlist.length}`);
  if (snap.applicants.length === 0) warnings.push('NO_APPLICANTS');

  const dto: Omit<AllocationPreview, 'previewId' | 'expiresAt'> = {
    cycleId,
    priorityRule: rule,
    assignments: result.assignments.map((x) => ({
      ...x,
      studentName: byId.get(x.enrollmentId)!.fullName,
      rollNo: byId.get(x.enrollmentId)!.rollNo,
    })),
    waitlist: result.waitlist.map((id) => ({
      enrollmentId: id,
      studentName: byId.get(id)!.fullName,
      rollNo: byId.get(id)!.rollNo,
    })),
    batches: snap.batches.map((b) => ({
      batchId: b.id,
      batchName: b.name,
      courseId: b.courseId,
      courseTitle: b.courseTitle,
      capacity: b.capacity,
      existing: b.members,
      added: added.get(b.id) ?? 0,
    })),
    stats: {
      applicants: result.stats.applicants,
      allocated: result.stats.allocated,
      waitlisted: result.stats.waitlisted,
      byRank: Object.fromEntries(Object.entries(result.stats.byRank).map(([k, v]) => [k, v])),
      elapsedMs,
    },
    warnings,
  };

  const expiresAt = new Date(Date.now() + ttl * 60_000);
  const stored = await prisma().allocationPreview.create({
    data: {
      cycleId,
      createdById: actor.userId,
      fingerprint: fingerprint(snap, rule),
      result: dto as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
  });
  return { previewId: stored.id, expiresAt: expiresAt.toISOString(), ...dto };
}

export interface ConfirmResult {
  previewId: string;
  allocated: number;
  waitlisted: number;
}

/**
 * Applies a preview in ONE transaction (NFR-05): batch memberships are bulk-inserted,
 * allocated applications → ALLOCATED, unplaced → WAITLISTED, all audited and notified.
 * Refuses (409 PREVIEW_STALE) if anything the preview depended on has changed.
 */
export async function confirm(
  actor: Actor & { userId: string },
  previewId: string,
): Promise<ConfirmResult> {
  const stored = await prisma().allocationPreview.findUnique({ where: { id: previewId } });
  if (!stored) throw AppError.notFound('Allocation preview not found');
  if (stored.confirmedAt)
    throw AppError.conflict('PREVIEW_ALREADY_CONFIRMED', 'This preview was already confirmed');
  if (stored.expiresAt <= new Date()) {
    throw AppError.conflict('PREVIEW_EXPIRED', 'This preview has expired. Run a new preview.');
  }
  const plan = stored.result as unknown as Omit<AllocationPreview, 'previewId' | 'expiresAt'>;

  return withAudit(
    actor,
    async (tx, log) => {
      // Lock the cycle's batches, then re-check the inputs inside the transaction.
      await tx.$queryRaw`SELECT id FROM batches WHERE cycle_id = ${stored.cycleId}::uuid FOR UPDATE`;
      const rule = await settings.get('allocation.priorityRule');
      if (fingerprint(await snapshot(tx, stored.cycleId), rule) !== stored.fingerprint) {
        throw AppError.conflict(
          'PREVIEW_STALE',
          'Applications or batches changed since this preview. Run a new preview.',
        );
      }
      const claimed = await tx.allocationPreview.updateMany({
        where: { id: previewId, confirmedAt: null },
        data: { confirmedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw AppError.conflict('PREVIEW_ALREADY_CONFIRMED', 'This preview was already confirmed');
      }

      const facts = new Map(
        (await enrollments.approvedApplicants(stored.cycleId)).map((a) => [a.enrollmentId, a]),
      );
      await tx.batchStudent.createMany({
        data: plan.assignments.map((x) => ({
          batchId: x.batchId,
          enrollmentId: x.enrollmentId,
          studentId: facts.get(x.enrollmentId)!.studentId,
        })),
      });
      const batchInfo = new Map(plan.batches.map((b) => [b.batchId, b]));
      const statusOf = new Map(
        (
          await tx.batch.findMany({
            where: { id: { in: plan.batches.map((b) => b.batchId) } },
            select: { id: true, status: true },
          })
        ).map((b) => [b.id, b.status]),
      );
      const cycle = await tx.trainingCycle.findUniqueOrThrow({
        where: { id: stored.cycleId },
        select: { name: true },
      });

      await enrollments.changeStatuses(tx, log, [
        ...plan.assignments.map((x) => {
          const b = batchInfo.get(x.batchId)!;
          return {
            enrollmentId: x.enrollmentId,
            from: ['APPROVED'] as const,
            to: statusOf.get(x.batchId) === 'ACTIVE' ? ('ACTIVE' as const) : ('ALLOCATED' as const),
            notify: {
              userId: facts.get(x.enrollmentId)!.userId,
              type: 'ENROLLMENT_ALLOCATED' as const,
              title: 'You have a batch',
              body: `${b.courseTitle}, ${b.batchName}`,
              data: { courseTitle: b.courseTitle, batchName: b.batchName, cycleName: cycle.name },
            },
          };
        }),
        ...plan.waitlist.map((w) => ({
          enrollmentId: w.enrollmentId,
          from: ['APPROVED'] as const,
          to: 'WAITLISTED' as const,
          reason: 'No seat was available in your chosen courses',
          notify: {
            userId: facts.get(w.enrollmentId)!.userId,
            type: 'ENROLLMENT_WAITLISTED' as const,
            title: 'Application waitlisted',
            body: `${cycle.name}: no seat was available in your chosen courses`,
            data: { cycleName: cycle.name },
          },
        })),
      ]);

      await log({
        action: 'ALLOCATION_CONFIRMED',
        entity: 'TrainingCycle',
        entityId: stored.cycleId,
        newValue: {
          previewId,
          allocated: plan.assignments.length,
          waitlisted: plan.waitlist.length,
          priorityRule: plan.priorityRule,
        },
      });
      return { previewId, allocated: plan.assignments.length, waitlisted: plan.waitlist.length };
    },
    { timeoutMs: 60_000 },
  );
}
