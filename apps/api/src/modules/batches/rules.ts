import type { AllocationPriorityRule, BatchStatus } from '@vtmp/shared';

export interface Applicant {
  enrollmentId: string;
  /** Course ids in preference order; index 0 = rank 1. */
  preferences: readonly string[];
  submittedAt: Date;
  cgpa: number;
}

export interface BatchSlot {
  batchId: string;
  courseId: string;
  name: string;
  /** Seats still free (capacity minus students already in the batch). */
  free: number;
}

export interface AllocationResult {
  assignments: Array<{ enrollmentId: string; batchId: string; courseId: string; rank: number }>;
  waitlist: string[];
  stats: {
    applicants: number;
    allocated: number;
    waitlisted: number;
    byRank: Record<number, number>;
  };
}

/**
 * Priority order within a preference rank (BR-04): earliest submission first, or highest CGPA
 * first with earliest submission breaking ties. The enrollment id makes the order total, so
 * the same input always yields the same allocation.
 */
export function compareByPriority(rule: AllocationPriorityRule) {
  return (a: Applicant, b: Applicant): number => {
    if (rule === 'CGPA' && a.cgpa !== b.cgpa) return b.cgpa - a.cgpa;
    const t = a.submittedAt.getTime() - b.submittedAt.getTime();
    if (t !== 0) return t;
    return a.enrollmentId < b.enrollmentId ? -1 : a.enrollmentId > b.enrollmentId ? 1 : 0;
  };
}

/**
 * Allocation engine (BRQ-4.2, BR-03, BR-04), O(n log n + n·p):
 * 1. Sort applicants once by the priority rule.
 * 2. Pass r = 1..p: each still-unplaced applicant, in priority order, claims a seat in their
 *    rank-r course, in that course's batch with the most free seats (ties by name), so batches
 *    of one course fill evenly.
 * 3. No batch ever exceeds its free seats (BR-03); whoever is left is waitlisted.
 * Rank comes first: every first choice is considered before any second choice.
 */
export function allocate(
  applicants: readonly Applicant[],
  batches: readonly BatchSlot[],
  rule: AllocationPriorityRule,
): AllocationResult {
  const ordered = [...applicants].sort(compareByPriority(rule));
  const free = new Map(batches.map((b) => [b.batchId, Math.max(0, b.free)]));
  const byCourse = new Map<string, BatchSlot[]>();
  for (const b of batches) {
    const list = byCourse.get(b.courseId) ?? [];
    list.push(b);
    byCourse.set(b.courseId, list);
  }

  const placed = new Map<string, { batchId: string; courseId: string; rank: number }>();
  const maxRank = Math.max(0, ...applicants.map((a) => a.preferences.length));

  for (let r = 0; r < maxRank; r++) {
    for (const a of ordered) {
      if (placed.has(a.enrollmentId)) continue;
      const courseId = a.preferences[r];
      if (!courseId) continue;
      let best: BatchSlot | undefined;
      for (const b of byCourse.get(courseId) ?? []) {
        const f = free.get(b.batchId)!;
        if (f <= 0) continue;
        const bestFree = best ? free.get(best.batchId)! : -1;
        if (f > bestFree || (f === bestFree && b.name < best!.name)) best = b;
      }
      if (best) {
        free.set(best.batchId, free.get(best.batchId)! - 1);
        placed.set(a.enrollmentId, { batchId: best.batchId, courseId, rank: r + 1 });
      }
    }
  }

  const assignments = ordered
    .filter((a) => placed.has(a.enrollmentId))
    .map((a) => ({ enrollmentId: a.enrollmentId, ...placed.get(a.enrollmentId)! }));
  const waitlist = ordered.filter((a) => !placed.has(a.enrollmentId)).map((a) => a.enrollmentId);
  const byRank: Record<number, number> = {};
  for (const x of assignments) byRank[x.rank] = (byRank[x.rank] ?? 0) + 1;

  return {
    assignments,
    waitlist,
    stats: {
      applicants: applicants.length,
      allocated: assignments.length,
      waitlisted: waitlist.length,
      byRank,
    },
  };
}

// ─── Scheduling (BR-20, BRQ-14.2) ─────────────────────────────────────────────

export interface TimedSlot {
  startsAt: Date;
  endsAt: Date;
}

/** BR-20 overlap test: startA < endB && startB < endA. A session ending as another starts is fine. */
export function overlaps(a: TimedSlot, b: TimedSlot): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Venues compare case- and space-insensitively ("Workshop  A" is "workshop a"). */
export function sameVenue(a: string, b: string): boolean {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

export interface BookedSlot extends TimedSlot {
  venue: string;
  /** Trainer named on the session itself, if any. */
  explicitTrainerId: string | null;
  /** Who teaches it: the named trainer, otherwise every trainer assigned to the batch. */
  trainerIds: readonly string[];
}

export interface SlotClash<T extends BookedSlot> {
  kind: 'VENUE' | 'TRAINER';
  /**
   * Hard clashes block saving: the same venue, or the same trainer certainly teaching both
   * sessions (named on it, or the batch's only trainer). When a batch has several trainers and
   * the session names none, any of them might teach it, so that clash is a soft warning.
   */
  hard: boolean;
  other: T;
  trainerId?: string;
}

/** The trainer who certainly teaches a session: the one named on it, or the batch's only one. */
function definiteTrainer(s: BookedSlot): string | null {
  return s.explicitTrainerId ?? (s.trainerIds.length === 1 ? s.trainerIds[0]! : null);
}

/** Every clash between one slot and a set of other bookings (BR-20). */
export function clashesFor<T extends BookedSlot>(
  slot: BookedSlot,
  others: readonly T[],
): Array<SlotClash<T>> {
  const out: Array<SlotClash<T>> = [];
  for (const other of others) {
    if (!overlaps(slot, other)) continue;
    if (sameVenue(slot.venue, other.venue)) out.push({ kind: 'VENUE', hard: true, other });
    for (const t of slot.trainerIds) {
      if (!other.trainerIds.includes(t)) continue;
      const hard = definiteTrainer(slot) === t && definiteTrainer(other) === t;
      out.push({ kind: 'TRAINER', hard, other, trainerId: t });
    }
  }
  return out;
}

/** BRQ-14.1: how full a batch is or will be. Bounds: ≥ warnAt % is NEAR, over 100 % is OVER. */
export function capacityLevel(
  projected: number,
  capacity: number,
  warnAtPercent: number,
): { percent: number; level: 'OK' | 'NEAR' | 'OVER' } {
  const percent = capacity > 0 ? Math.round((projected * 10_000) / capacity) / 100 : 100;
  const level = projected > capacity ? 'OVER' : percent >= warnAtPercent ? 'NEAR' : 'OK';
  return { percent, level };
}

export type CloseBlocker = 'INVALID_BATCH_STATUS' | 'BATCH_NOT_ENDED' | 'STUDENTS_UNDECIDED';

/**
 * L1: a running batch may be closed from the day after its end date, once no student is still
 * waiting for a completion decision. Dates are institution calendar days (YYYY-MM-DD).
 */
export function closeBlocker(
  status: BatchStatus,
  endDate: string,
  today: string,
  undecided: number,
): CloseBlocker | null {
  if (status !== 'ACTIVE') return 'INVALID_BATCH_STATUS';
  if (today <= endDate) return 'BATCH_NOT_ENDED';
  if (undecided > 0) return 'STUDENTS_UNDECIDED';
  return null;
}

/**
 * L5: a batch runs inside its training cycle (both dates inclusive). Calendar days as
 * YYYY-MM-DD, so plain string comparison is a date comparison.
 */
export function insideCycle(
  batch: { startDate: string; endDate: string },
  cycle: { startsOn: string; endsOn: string },
): boolean {
  return batch.startDate >= cycle.startsOn && batch.endDate <= cycle.endsOn;
}
