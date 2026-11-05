import type { EnrollmentStatus, ReviewAction, ScreeningReason } from '@vtmp/shared';

export const REVIEW_TARGET: Record<ReviewAction, EnrollmentStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  WAITLIST: 'WAITLISTED',
};

/**
 * Admin review transitions (BRQ-3.3). A pending application can go anywhere; a waitlisted one
 * can be approved or rejected later. Everything else is already decided or past review.
 */
const ALLOWED: Partial<Record<EnrollmentStatus, ReviewAction[]>> = {
  PENDING: ['APPROVE', 'REJECT', 'WAITLIST'],
  WAITLISTED: ['APPROVE', 'REJECT'],
};

export function canReview(from: EnrollmentStatus, action: ReviewAction): boolean {
  return ALLOWED[from]?.includes(action) ?? false;
}

/**
 * Preference count against the configured limit (setting enrollment.maxPreferences, ≤ 3).
 * Distinctness and the hard 1–3 bounds are checked by the shared Zod schema.
 */
export function preferenceCountProblem(courseIds: readonly string[], max: number): string | null {
  if (courseIds.length === 0) return 'Choose at least one course';
  if (courseIds.length > max) return `Choose at most ${max} course${max === 1 ? '' : 's'}`;
  return null;
}

/** A student may edit or withdraw only while PENDING and every chosen course's window is open. */
export function isEditable(status: EnrollmentStatus, allWindowsOpen: boolean): boolean {
  return status === 'PENDING' && allWindowsOpen;
}

/**
 * BRQ-3.3 / BRQ-3.5 automatic approval: the reasons an application must wait for a person, in the
 * admin's rules (Settings). No reasons means it is approved automatically. Academic marks are
 * never a reason: vocational training is open to every student.
 */
export function screen(
  application: {
    courses: ReadonlyArray<{ title: string; prerequisites: string | null }>;
  },
  rules: { manualIfPrerequisites: boolean },
): ScreeningReason[] {
  const reasons: ScreeningReason[] = [];
  if (rules.manualIfPrerequisites) {
    for (const c of application.courses) {
      const prerequisites = c.prerequisites?.trim();
      if (prerequisites)
        reasons.push({ code: 'HAS_PREREQUISITES', course: c.title, prerequisites });
    }
  }
  return reasons;
}

/**
 * Statuses that hold a student's place in a cycle's training: approved, placed in a batch, or
 * training now. Pending, waitlisted and finished ones don't.
 */
export const COMMITTED_STATUSES: readonly EnrollmentStatus[] = ['APPROVED', 'ALLOCATED', 'ACTIVE'];

/**
 * Two training cycles overlap when each starts on or before the day the other ends (dates are
 * YYYY-MM-DD, both ends inclusive). A student committed to one can't train in the other (BR-23).
 */
export function cyclesOverlap(
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string },
): boolean {
  return a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
}
