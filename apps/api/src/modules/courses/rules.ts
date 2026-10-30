import type { CycleApplications, WindowState } from '@vtmp/shared';

export interface WindowFacts {
  isOpen: boolean;
  enrollmentOpensAt: Date;
  enrollmentClosesAt: Date;
}

/**
 * BR-02 / BRQ-2.3: a course accepts applications only while the admin toggle is on AND now is
 * inside [opensAt, closesAt). Closing time is exclusive, so 23:59:59.999 is open and the closing
 * instant itself is closed.
 */
export function windowState(offering: WindowFacts | null | undefined, now: Date): WindowState {
  if (!offering) return 'NOT_OFFERED';
  if (!offering.isOpen) return 'CLOSED';
  if (now < offering.enrollmentOpensAt) return 'UPCOMING';
  if (now >= offering.enrollmentClosesAt) return 'CLOSED';
  return 'OPEN';
}

export function isWindowOpen(offering: WindowFacts | null | undefined, now: Date): boolean {
  return windowState(offering, now) === 'OPEN';
}

/**
 * L6: the instant a cycle ends, i.e. midnight after its last day at the institution. A cycle's
 * dates are calendar days stored as UTC midnight.
 */
export function cycleEndInstant(endsOn: Date, utcOffsetMinutes: number): Date {
  return new Date(endsOn.getTime() + 86_400_000 - utcOffsetMinutes * 60_000);
}

/**
 * L6: an application window must close by the end of its cycle: applying for a training that
 * is over makes no sense. Opening after the cycle has started stays allowed, because late
 * applicants can still be placed in a running batch.
 */
export function windowInsideCycle(
  enrollmentClosesAt: Date,
  cycleEndsOn: Date,
  utcOffsetMinutes: number,
): boolean {
  return enrollmentClosesAt <= cycleEndInstant(cycleEndsOn, utcOffsetMinutes);
}

/**
 * L7: a cycle takes applications if any of its courses' windows is open, will once one opens,
 * and is closed otherwise (a running cycle students may still look at).
 */
export function cycleApplications(states: readonly WindowState[]): CycleApplications {
  if (states.includes('OPEN')) return 'OPEN';
  if (states.includes('UPCOMING')) return 'UPCOMING';
  return 'CLOSED';
}

/** L7: open cycles first in the picker, then upcoming, then closed. */
export const APPLICATIONS_ORDER: Record<CycleApplications, number> = {
  OPEN: 0,
  UPCOMING: 1,
  CLOSED: 2,
};
