import type { Eligibility, EligibilityCheck } from '@vtmp/shared';

export interface CompletionFacts {
  /** Two decimals (BR-08); null when no session has been conducted. */
  attendancePercent: number | null;
  mandatoryTotal: number;
  mandatoryRecorded: number;
  /** Titles of the mandatory assessments still without marks (shown to the admin, T1). */
  mandatoryMissing?: string[];
  /** Weighted aggregate over recorded assessments; null when nothing is recorded. */
  aggregate: number | null;
  /** Trainer's final recommendation; null when not evaluated yet. */
  recommended: boolean | null;
}

export interface CompletionThresholds {
  minAttendancePercent: number;
  minAggregatePercent: number;
}

/**
 * BR-09: a student may complete only with attendance ≥ minimum, every mandatory assessment
 * recorded, aggregate ≥ minimum and a trainer recommendation. Every check is reported, passed
 * or not, so the admin sees all the reasons at once (BRQ-9.4). Bounds are inclusive.
 */
export function eligibility(facts: CompletionFacts, t: CompletionThresholds): Eligibility {
  const checks: EligibilityCheck[] = [
    {
      rule: 'ATTENDANCE',
      passed: facts.attendancePercent !== null && facts.attendancePercent >= t.minAttendancePercent,
      actual: facts.attendancePercent,
      required: t.minAttendancePercent,
    },
    {
      rule: 'MANDATORY_ASSESSMENTS',
      passed: facts.mandatoryRecorded >= facts.mandatoryTotal,
      actual: facts.mandatoryRecorded,
      required: facts.mandatoryTotal,
      ...(facts.mandatoryMissing?.length ? { missing: facts.mandatoryMissing } : {}),
    },
    {
      rule: 'AGGREGATE',
      passed: facts.aggregate !== null && facts.aggregate >= t.minAggregatePercent,
      actual: facts.aggregate,
      required: t.minAggregatePercent,
    },
    {
      rule: 'RECOMMENDATION',
      passed: facts.recommended === true,
      actual: facts.recommended,
      required: true,
    },
  ];
  return { eligible: checks.every((c) => c.passed), checks };
}
