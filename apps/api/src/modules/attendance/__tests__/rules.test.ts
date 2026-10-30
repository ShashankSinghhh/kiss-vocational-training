import type { AttendanceStatus } from '@vtmp/shared';
import {
  attendanceFigures,
  attendancePercent,
  consecutiveAbsences,
  editWindow,
  isAttended,
} from '../rules';

describe('attendancePercent (BR-08)', () => {
  it('is attended ÷ conducted × 100 to two decimals', () => {
    expect(attendancePercent(3, 4)).toBe(75);
    expect(attendancePercent(2, 3)).toBe(66.67);
    expect(attendancePercent(1, 3)).toBe(33.33);
    expect(attendancePercent(0, 5)).toBe(0);
    expect(attendancePercent(7, 7)).toBe(100);
  });

  it('rounds half up and keeps boundaries exact', () => {
    // 1/8 = 12.5 → 12.50 ; 299/400 = 74.75 ; 2999/4000 = 74.975 → 74.98
    expect(attendancePercent(1, 8)).toBe(12.5);
    expect(attendancePercent(299, 400)).toBe(74.75);
    expect(attendancePercent(2999, 4000)).toBe(74.98);
    // 74.99 vs 75.00 — the BR-09 threshold must not be crossed by float noise.
    expect(attendancePercent(7499, 10000)).toBe(74.99);
    expect(attendancePercent(75, 100)).toBe(75);
  });

  it('is null before any session is conducted', () => {
    expect(attendancePercent(0, 0)).toBeNull();
  });
});

describe('isAttended / consecutiveAbsences', () => {
  it('counts LATE as attended only when the setting says so', () => {
    expect(isAttended('LATE', true)).toBe(true);
    expect(isAttended('LATE', false)).toBe(false);
    expect(isAttended('ABSENT', true)).toBe(false);
  });

  it('counts absences back from the latest session until an attended one', () => {
    const s: AttendanceStatus[] = ['ABSENT', 'ABSENT', 'ABSENT', 'PRESENT', 'ABSENT'];
    expect(consecutiveAbsences(s, true)).toBe(3);
    expect(consecutiveAbsences(['PRESENT', 'ABSENT'], true)).toBe(0);
    expect(consecutiveAbsences(['ABSENT', 'LATE', 'ABSENT'], true)).toBe(1);
    expect(consecutiveAbsences(['ABSENT', 'LATE', 'ABSENT'], false)).toBe(1);
  });

  it('builds the figures for one student', () => {
    expect(attendanceFigures(['ABSENT', 'LATE', 'PRESENT', 'ABSENT'], true)).toEqual({
      attended: 2,
      conducted: 4,
      percent: 50,
      absences: 2,
      consecutiveAbsences: 1,
      unrecorded: 0,
    });
    expect(attendanceFigures([], true)).toMatchObject({ percent: null, conducted: 0 });
    // L2: unmarked sessions are reported beside the percentage, never folded into it.
    expect(attendanceFigures(['PRESENT'], true, 2)).toMatchObject({
      percent: 100,
      conducted: 1,
      unrecorded: 2,
    });
  });
});

describe('editWindow (BR-06, BRQ-5.2, L3)', () => {
  const first = new Date('2027-01-05T10:00:00Z');
  const at = (minutes: number) => new Date(first.getTime() + minutes * 60_000);
  // The session ends an hour after the first marking.
  const ends = at(60);

  it('is open at 47h59 and closed at 48h00 and 48h01 after the first marking', () => {
    expect(editWindow(first, ends, at(47 * 60 + 59), 48).open).toBe(true);
    expect(editWindow(first, ends, at(48 * 60), 48).open).toBe(false);
    expect(editWindow(first, ends, at(48 * 60 + 1), 48).open).toBe(false);
    expect(editWindow(first, ends, at(0), 48).until).toEqual(at(48 * 60));
  });

  it('L3: an unmarked session closes 48 h after it ended', () => {
    expect(editWindow(null, ends, at(60 + 47 * 60 + 59), 48).open).toBe(true);
    expect(editWindow(null, ends, at(60 + 48 * 60), 48)).toEqual({
      open: false,
      until: at(60 + 48 * 60),
    });
  });

  it('L3: marking late does not restart the window', () => {
    const late = at(60 + 40 * 60);
    expect(editWindow(late, ends, at(60 + 48 * 60), 48).open).toBe(false);
  });
});
