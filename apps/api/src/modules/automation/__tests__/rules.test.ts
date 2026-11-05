import { takesLatePlacements, waitlistOrder } from '../../batches/rules';
import { analyticsStale, daysBefore, noticeWindowStart, readyToClose } from '../rules';

describe('noticeWindowStart', () => {
  it('starts at the last success, or one day back on the first run', () => {
    const now = new Date('2027-01-10T03:00:00Z');
    const last = new Date('2027-01-08T03:00:00Z');
    expect(noticeWindowStart(last, now)).toEqual(last);
    expect(noticeWindowStart(null, now)).toEqual(new Date('2027-01-09T03:00:00Z'));
  });
});

describe('readyToClose (A1, BR-25)', () => {
  const ended = [
    { id: 'a', endDate: '2027-01-03', undecided: 0 },
    { id: 'b', endDate: '2027-01-04', undecided: 0 },
    { id: 'c', endDate: '2027-01-01', undecided: 1 },
  ];
  it('takes batches ended at least the grace days ago with nobody undecided', () => {
    expect(daysBefore('2027-01-10', 7)).toBe('2027-01-03');
    expect(readyToClose(ended, '2027-01-10', 7).map((b) => b.id)).toEqual(['a']);
    expect(readyToClose(ended, '2027-01-11', 7).map((b) => b.id)).toEqual(['a', 'b']);
    expect(readyToClose(ended, '2027-01-04', 0).map((b) => b.id)).toEqual(['a', 'b']);
  });
});

describe('analyticsStale (A8)', () => {
  const now = new Date('2027-01-10T10:00:00Z');
  it('is stale at the limit, fresh a minute before, and stale when never refreshed', () => {
    expect(analyticsStale(new Date('2027-01-10T09:50:00Z'), now, 10)).toBe(true);
    expect(analyticsStale(new Date('2027-01-10T09:51:00Z'), now, 10)).toBe(false);
    expect(analyticsStale(null, now, 10)).toBe(true);
  });
});

describe('waitlistOrder (A2, BR-04)', () => {
  const c = (id: string, rank: number, submittedAt: string, status = 'WAITLISTED') => ({
    enrollmentId: id,
    status,
    submittedAt,
    rankForCourse: rank,
  });
  it('waitlisted only, the course ranked higher first, then the priority rule', () => {
    const list = [
      c('second-choice-early', 2, '2027-01-01T00:00:00Z'),
      c('first-choice-late', 1, '2027-01-05T00:00:00Z'),
      c('first-choice-early', 1, '2027-01-02T00:00:00Z'),
      c('approved', 1, '2027-01-01T00:00:00Z', 'APPROVED'),
    ];
    expect(waitlistOrder(list, 'SUBMISSION_TIME')).toEqual([
      'first-choice-early',
      'first-choice-late',
      'second-choice-early',
    ]);
  });
});

describe('takesLatePlacements (A2)', () => {
  it('planned always; running up to the late days; closed never', () => {
    expect(takesLatePlacements('PLANNED', '2027-02-01', '2027-01-10', 7)).toBe(true);
    expect(takesLatePlacements('ACTIVE', '2027-01-03', '2027-01-10', 7)).toBe(true);
    expect(takesLatePlacements('ACTIVE', '2027-01-02', '2027-01-10', 7)).toBe(false);
    expect(takesLatePlacements('CLOSED', '2027-01-09', '2027-01-10', 7)).toBe(false);
  });
});
