import { BulkReviewSchema, PreferencesSchema, type EnrollmentStatus } from '@vtmp/shared';
import { canReview, cyclesOverlap, isEditable, preferenceCountProblem, screen } from '../rules';

const a = '6f1c2a3e-1b2c-4d5e-8f90-123456789a01';
const b = '6f1c2a3e-1b2c-4d5e-8f90-123456789a02';
const c = '6f1c2a3e-1b2c-4d5e-8f90-123456789a03';
const d = '6f1c2a3e-1b2c-4d5e-8f90-123456789a04';

describe('preference validation (BRQ-3.1)', () => {
  it('accepts 1–3 distinct courses', () => {
    expect(PreferencesSchema.safeParse([a]).success).toBe(true);
    expect(PreferencesSchema.safeParse([a, b, c]).success).toBe(true);
  });

  it('rejects none, more than three, and duplicates', () => {
    expect(PreferencesSchema.safeParse([]).success).toBe(false);
    expect(PreferencesSchema.safeParse([a, b, c, d]).success).toBe(false);
    expect(PreferencesSchema.safeParse([a, b, a]).success).toBe(false);
  });

  it('honours a lower configured limit (enrollment.maxPreferences)', () => {
    expect(preferenceCountProblem([a, b], 2)).toBeNull();
    expect(preferenceCountProblem([a, b, c], 2)).toMatch(/at most 2/);
    expect(preferenceCountProblem([a, b], 1)).toMatch(/at most 1 course$/);
  });
});

describe('review transitions (BRQ-3.3)', () => {
  const statuses: EnrollmentStatus[] = [
    'PENDING',
    'APPROVED',
    'REJECTED',
    'WAITLISTED',
    'ALLOCATED',
    'ACTIVE',
    'COMPLETED',
    'NOT_COMPLETED',
    'CERTIFIED',
    'WITHDRAWN',
  ];

  it('lets pending go anywhere and waitlisted be approved or rejected', () => {
    expect(canReview('PENDING', 'APPROVE')).toBe(true);
    expect(canReview('PENDING', 'REJECT')).toBe(true);
    expect(canReview('PENDING', 'WAITLIST')).toBe(true);
    expect(canReview('WAITLISTED', 'APPROVE')).toBe(true);
    expect(canReview('WAITLISTED', 'REJECT')).toBe(true);
    expect(canReview('WAITLISTED', 'WAITLIST')).toBe(false);
  });

  it('refuses every action on decided or later statuses', () => {
    for (const s of statuses.filter((x) => x !== 'PENDING' && x !== 'WAITLISTED')) {
      for (const action of ['APPROVE', 'REJECT', 'WAITLIST'] as const) {
        expect(canReview(s, action)).toBe(false);
      }
    }
  });

  it('requires a reason to reject in bulk', () => {
    expect(BulkReviewSchema.safeParse({ ids: [a], action: 'REJECT' }).success).toBe(false);
    expect(
      BulkReviewSchema.safeParse({ ids: [a], action: 'REJECT', reason: 'Prerequisite missing' })
        .success,
    ).toBe(true);
    expect(BulkReviewSchema.safeParse({ ids: [a, a], action: 'APPROVE' }).success).toBe(false);
  });
});

describe('isEditable', () => {
  it('only while pending and every window is open', () => {
    expect(isEditable('PENDING', true)).toBe(true);
    expect(isEditable('PENDING', false)).toBe(false);
    expect(isEditable('APPROVED', true)).toBe(false);
  });
});

describe('automatic approval screening (BRQ-3.3, BRQ-3.5)', () => {
  const plain = { title: 'Tailoring', prerequisites: null };
  const withPre = { title: 'Electrician', prerequisites: 'Class 10 maths' };
  const rules = { manualIfPrerequisites: true };

  it('passes an application that meets every rule', () => {
    expect(screen({ courses: [plain] }, rules)).toEqual([]);
  });
  it('holds courses with prerequisites for a person, unless that rule is off', () => {
    expect(screen({ courses: [plain, withPre] }, rules)).toEqual([
      { code: 'HAS_PREREQUISITES', course: 'Electrician', prerequisites: 'Class 10 maths' },
    ]);
    expect(screen({ courses: [{ title: 'X', prerequisites: '  ' }] }, rules)).toEqual([]);
    expect(screen({ courses: [withPre] }, { ...rules, manualIfPrerequisites: false })).toEqual([]);
  });
  it('lists one reason per course with prerequisites', () => {
    expect(screen({ courses: [withPre, withPre] }, rules).map((r) => r.code)).toEqual([
      'HAS_PREREQUISITES',
      'HAS_PREREQUISITES',
    ]);
  });
});

describe('overlapping cycles (BR-23)', () => {
  const pilot = { startsOn: '2026-09-30', endsOn: '2026-12-23' };
  it.each([
    ['starts inside the other', { startsOn: '2026-12-02', endsOn: '2027-03-24' }, true],
    ['starts on the last day (inclusive)', { startsOn: '2026-12-23', endsOn: '2027-03-24' }, true],
    ['starts the day after', { startsOn: '2026-12-24', endsOn: '2027-03-24' }, false],
    ['ends the day before', { startsOn: '2026-06-01', endsOn: '2026-09-29' }, false],
    ['ends on the first day (inclusive)', { startsOn: '2026-06-01', endsOn: '2026-09-30' }, true],
    ['contains the other', { startsOn: '2026-09-01', endsOn: '2027-01-31' }, true],
  ])('%s → %s', (_label, other, expected) => {
    expect(cyclesOverlap(pilot, other)).toBe(expected);
    expect(cyclesOverlap(other, pilot)).toBe(expected);
  });
});
