import { cycleEndInstant, isWindowOpen, windowInsideCycle, windowState } from '../rules';

const opens = new Date('2026-11-01T00:00:00.000Z');
const closes = new Date('2026-11-15T00:00:00.000Z');
const offering = (isOpen = true) => ({
  isOpen,
  enrollmentOpensAt: opens,
  enrollmentClosesAt: closes,
});

describe('windowState (BR-02, BRQ-2.3)', () => {
  it('is NOT_OFFERED without an offering', () => {
    expect(windowState(null, opens)).toBe('NOT_OFFERED');
  });

  it('is UPCOMING one millisecond before it opens and OPEN at the opening instant', () => {
    expect(windowState(offering(), new Date(opens.getTime() - 1))).toBe('UPCOMING');
    expect(windowState(offering(), opens)).toBe('OPEN');
  });

  it('is OPEN one millisecond before it closes and CLOSED at the closing instant', () => {
    expect(windowState(offering(), new Date(closes.getTime() - 1))).toBe('OPEN');
    expect(windowState(offering(), closes)).toBe('CLOSED');
  });

  it('is CLOSED inside the dates when the admin toggle is off', () => {
    expect(windowState(offering(false), new Date('2026-11-05T00:00:00Z'))).toBe('CLOSED');
    expect(isWindowOpen(offering(false), new Date('2026-11-05T00:00:00Z'))).toBe(false);
  });
});

describe('windowInsideCycle (L6)', () => {
  const endsOn = new Date('2027-09-30'); // stored as UTC midnight
  const IST = 330;

  it('the cycle ends at midnight after its last day, institution time', () => {
    expect(cycleEndInstant(endsOn, IST)).toEqual(new Date('2027-09-30T18:30:00.000Z'));
  });

  it('a window may close up to that instant, not a minute later', () => {
    expect(windowInsideCycle(new Date('2027-09-30T18:30:00.000Z'), endsOn, IST)).toBe(true);
    expect(windowInsideCycle(new Date('2027-09-30T18:31:00.000Z'), endsOn, IST)).toBe(false);
  });
});
