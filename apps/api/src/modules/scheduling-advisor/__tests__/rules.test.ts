import {
  capacityLevel,
  clashesFor,
  overlaps,
  sameVenue,
  type BookedSlot,
} from '../../batches/rules';

const at = (hhmm: string) => new Date(`2027-01-05T${hhmm}:00Z`);
const slot = (from: string, to: string, over: Partial<BookedSlot> = {}): BookedSlot => ({
  startsAt: at(from),
  endsAt: at(to),
  venue: 'Workshop A',
  explicitTrainerId: null,
  trainerIds: [],
  ...over,
});

describe('overlaps (BR-20: startA < endB && startB < endA)', () => {
  it('back-to-back sessions do not clash; one minute of overlap does', () => {
    expect(overlaps(slot('10:00', '12:00'), slot('12:00', '14:00'))).toBe(false);
    expect(overlaps(slot('12:00', '14:00'), slot('10:00', '12:00'))).toBe(false);
    expect(overlaps(slot('10:00', '12:00'), slot('11:59', '14:00'))).toBe(true);
  });

  it('containment and identical times clash', () => {
    expect(overlaps(slot('10:00', '14:00'), slot('11:00', '12:00'))).toBe(true);
    expect(overlaps(slot('10:00', '12:00'), slot('10:00', '12:00'))).toBe(true);
  });
});

describe('sameVenue', () => {
  it('ignores case and extra spaces', () => {
    expect(sameVenue('Workshop  A', ' workshop a ')).toBe(true);
    expect(sameVenue('Workshop A', 'Workshop B')).toBe(false);
  });
});

describe('clashesFor (BRQ-14.2)', () => {
  const T1 = 'trainer-1';
  it('the same venue at overlapping times is a hard clash', () => {
    const c = clashesFor(slot('10:00', '12:00'), [slot('11:00', '13:00')]);
    expect(c).toEqual([expect.objectContaining({ kind: 'VENUE', hard: true })]);
  });

  it('nothing when the times only touch', () => {
    expect(clashesFor(slot('10:00', '12:00'), [slot('12:00', '13:00')])).toEqual([]);
  });

  it('the same trainer certainly teaching both is a hard clash; one of several assigned is soft', () => {
    const mine = slot('10:00', '12:00', {
      venue: 'Lab 1',
      explicitTrainerId: T1,
      trainerIds: [T1],
    });
    const named = slot('11:00', '12:30', {
      venue: 'Lab 2',
      explicitTrainerId: T1,
      trainerIds: [T1],
    });
    // T3: the batch's only trainer teaches every session that names nobody.
    const soleTrainer = slot('11:00', '12:30', { venue: 'Lab 3', trainerIds: [T1] });
    const oneOfTwo = slot('11:00', '12:30', { venue: 'Lab 4', trainerIds: [T1, 'trainer-2'] });
    expect(clashesFor(mine, [named])).toEqual([
      expect.objectContaining({ kind: 'TRAINER', hard: true, trainerId: T1 }),
    ]);
    expect(clashesFor(mine, [soleTrainer])).toEqual([
      expect.objectContaining({ kind: 'TRAINER', hard: true, trainerId: T1 }),
    ]);
    expect(clashesFor(mine, [oneOfTwo])).toEqual([
      expect.objectContaining({ kind: 'TRAINER', hard: false, trainerId: T1 }),
    ]);
  });
});

describe('capacityLevel (BRQ-14.1)', () => {
  it('warns from 90 % and flags anything over capacity', () => {
    expect(capacityLevel(17, 20, 90)).toEqual({ percent: 85, level: 'OK' });
    expect(capacityLevel(18, 20, 90)).toEqual({ percent: 90, level: 'NEAR' });
    expect(capacityLevel(20, 20, 90)).toEqual({ percent: 100, level: 'NEAR' });
    expect(capacityLevel(21, 20, 90)).toEqual({ percent: 105, level: 'OVER' });
  });
});
