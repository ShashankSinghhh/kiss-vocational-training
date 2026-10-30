import type { AttendanceFigures, AttendanceStatus } from '@vtmp/shared';

/** BR-08 with setting attendance.lateCountsAsPresent: does this mark count as attended? */
export function isAttended(status: AttendanceStatus, lateCountsAsPresent: boolean): boolean {
  return status === 'PRESENT' || (status === 'LATE' && lateCountsAsPresent);
}

/**
 * BR-08: attended ÷ conducted × 100, to two decimals (half up). Integer arithmetic before the
 * single division keeps boundaries exact (e.g. 3 of 4 = 75.00, never 74.99999).
 * Null when nothing has been conducted yet: 0 % would wrongly flag a new student.
 */
export function attendancePercent(attended: number, conducted: number): number | null {
  if (conducted <= 0) return null;
  return Math.round((attended * 10_000) / conducted) / 100;
}

/** Absences in a row, counting back from the most recent conducted session (F11 input). */
export function consecutiveAbsences(
  newestFirst: readonly AttendanceStatus[],
  lateCountsAsPresent: boolean,
): number {
  let n = 0;
  for (const s of newestFirst) {
    if (isAttended(s, lateCountsAsPresent)) break;
    if (s === 'ABSENT') n++;
    else break; // LATE that doesn't count as present still isn't an absence.
  }
  return n;
}

/**
 * Figures for one student from their marks on conducted sessions, newest first. Sessions they
 * have no mark for (e.g. held before they joined the batch) are not counted. `unrecorded` is
 * passed through: sessions that ended but were never marked are reported, not guessed (L2).
 */
export function attendanceFigures(
  newestFirst: readonly AttendanceStatus[],
  lateCountsAsPresent: boolean,
  unrecorded = 0,
): AttendanceFigures {
  const attended = newestFirst.filter((s) => isAttended(s, lateCountsAsPresent)).length;
  return {
    attended,
    conducted: newestFirst.length,
    percent: attendancePercent(attended, newestFirst.length),
    absences: newestFirst.filter((s) => s === 'ABSENT').length,
    consecutiveAbsences: consecutiveAbsences(newestFirst, lateCountsAsPresent),
    unrecorded,
  };
}

/**
 * BR-06 / BRQ-5.2: trainers may edit for `hours` after the session was first marked; the
 * closing instant itself is already closed. L3: the window starts at the session's end at the
 * latest, so a session nobody marks closes `hours` after it ended instead of staying open for
 * ever. Marking during the session keeps the BR-06 start (the first marking).
 */
export function editWindow(
  firstMarkedAt: Date | null,
  endsAt: Date,
  now: Date,
  hours: number,
): { open: boolean; until: Date } {
  const start = firstMarkedAt && firstMarkedAt < endsAt ? firstMarkedAt : endsAt;
  const until = new Date(start.getTime() + hours * 3_600_000);
  return { open: now < until, until };
}
