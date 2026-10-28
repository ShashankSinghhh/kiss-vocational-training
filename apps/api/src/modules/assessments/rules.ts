import type { Grade } from '@vtmp/shared';

/**
 * T1: an assessment's date (YYYY-MM-DD) must fall within its batch's dates, both inclusive, so
 * a mandatory one can't be scheduled after the batch ends and block every student's completion.
 */
export function heldInsideBatch(heldOn: string, batch: { start: string; end: string }): boolean {
  return heldOn >= batch.start && heldOn <= batch.end;
}

export interface ScoredItem {
  marks: number;
  maxMarks: number;
  weightage: number;
}

/**
 * BRQ-6.4: Σ(marks ÷ max × weightage) ÷ Σ weightage × 100, to two decimals (half up).
 * Null when nothing is recorded yet.
 */
export function weightedAggregate(items: readonly ScoredItem[]): number | null {
  const totalWeight = items.reduce((s, i) => s + i.weightage, 0);
  if (items.length === 0 || totalWeight <= 0) return null;
  const weighted = items.reduce((s, i) => s + (i.marks / i.maxMarks) * i.weightage, 0);
  // toFixed-free rounding; the small epsilon absorbs binary noise like 84.99999999999.
  return Math.round(((weighted / totalWeight) * 100 + 1e-9) * 100) / 100;
}

export interface GradeBands {
  A: number;
  B: number;
  C: number;
  D: number;
}

/**
 * BR-11 with bands from setting grade.bands: A ≥ 85, B 70–84.99, C 55–69.99, D 40–54.99,
 * otherwise NOT_COMPLETED. Lower bounds are inclusive.
 */
export function gradeBand(aggregate: number, bands: GradeBands): Grade {
  if (aggregate >= bands.A) return 'A';
  if (aggregate >= bands.B) return 'B';
  if (aggregate >= bands.C) return 'C';
  if (aggregate >= bands.D) return 'D';
  return 'NOT_COMPLETED';
}

/** A single result as a percentage of its maximum (two decimals). */
export function resultPercent(marks: number, maxMarks: number): number {
  return Math.round((marks / maxMarks) * 10_000 + 1e-9) / 100;
}
