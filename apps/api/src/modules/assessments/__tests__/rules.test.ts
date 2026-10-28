import { gradeBand, heldInsideBatch, resultPercent, weightedAggregate } from '../rules';

const bands = { A: 85, B: 70, C: 55, D: 40 };

describe('weightedAggregate (BRQ-6.4)', () => {
  it('weights each result by its weightage', () => {
    // 40/50 (80 %) × 30 + 18/20 (90 %) × 70 → (24 + 63) / 100 = 87.00
    expect(
      weightedAggregate([
        { marks: 40, maxMarks: 50, weightage: 30 },
        { marks: 18, maxMarks: 20, weightage: 70 },
      ]),
    ).toBe(87);
  });

  it('rounds to two decimals', () => {
    expect(weightedAggregate([{ marks: 2, maxMarks: 3, weightage: 1 }])).toBe(66.67);
    expect(weightedAggregate([{ marks: 1, maxMarks: 3, weightage: 1 }])).toBe(33.33);
  });

  it('is exact at the band boundaries despite binary floating point', () => {
    expect(weightedAggregate([{ marks: 85, maxMarks: 100, weightage: 1 }])).toBe(85);
    expect(weightedAggregate([{ marks: 17, maxMarks: 20, weightage: 3 }])).toBe(85);
    expect(weightedAggregate([{ marks: 0.7, maxMarks: 1, weightage: 10 }])).toBe(70);
  });

  it('is null when nothing is recorded', () => {
    expect(weightedAggregate([])).toBeNull();
  });
});

describe('gradeBand (BR-11)', () => {
  it.each([
    [100, 'A'],
    [85, 'A'],
    [84.99, 'B'],
    [70, 'B'],
    [69.99, 'C'],
    [55, 'C'],
    [54.99, 'D'],
    [40, 'D'],
    [39.99, 'NOT_COMPLETED'],
    [0, 'NOT_COMPLETED'],
  ] as const)('%s → %s', (aggregate, grade) => {
    expect(gradeBand(aggregate, bands)).toBe(grade);
  });

  it('follows changed bands from settings', () => {
    expect(gradeBand(80, { A: 80, B: 65, C: 50, D: 35 })).toBe('A');
  });
});

describe('resultPercent', () => {
  it('is marks ÷ max to two decimals', () => {
    expect(resultPercent(17, 20)).toBe(85);
    expect(resultPercent(1, 3)).toBe(33.33);
  });
});

describe('assessment date inside the batch (T1)', () => {
  const batch = { start: '2026-09-30', end: '2026-12-23' };
  it.each([
    ['2026-09-29', false],
    ['2026-09-30', true],
    ['2026-11-15', true],
    ['2026-12-23', true],
    ['2026-12-24', false],
  ])('%s → %s', (day, inside) => {
    expect(heldInsideBatch(day, batch)).toBe(inside);
  });
});
