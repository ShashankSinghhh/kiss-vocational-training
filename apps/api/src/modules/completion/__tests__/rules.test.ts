import { eligibility, type CompletionFacts } from '../rules';

const t = { minAttendancePercent: 75, minAggregatePercent: 40 };
const ok: CompletionFacts = {
  attendancePercent: 90,
  unrecordedSessions: 0,
  mandatoryTotal: 2,
  mandatoryRecorded: 2,
  aggregate: 70,
  recommended: true,
};
const check = (facts: Partial<CompletionFacts>, rule: string) =>
  eligibility({ ...ok, ...facts }, t).checks.find((c) => c.rule === rule)!;

describe('eligibility (BR-09)', () => {
  it('passes when every condition holds and reports all five checks in order', () => {
    const r = eligibility(ok, t);
    expect(r.eligible).toBe(true);
    expect(r.checks.map((c) => c.rule)).toEqual([
      'ATTENDANCE',
      'SESSIONS_RECORDED',
      'MANDATORY_ASSESSMENTS',
      'AGGREGATE',
      'RECOMMENDATION',
    ]);
  });

  it('TC-13: attendance 74.99 % is not eligible', () => {
    const r = eligibility({ ...ok, attendancePercent: 74.99 }, t);
    expect(r.eligible).toBe(false);
    expect(check({ attendancePercent: 74.99 }, 'ATTENDANCE')).toEqual({
      rule: 'ATTENDANCE',
      passed: false,
      actual: 74.99,
      required: 75,
    });
  });

  it('TC-14: attendance 75.00 % is eligible', () => {
    expect(eligibility({ ...ok, attendancePercent: 75 }, t).eligible).toBe(true);
  });

  it('no conducted sessions (null attendance) fails', () => {
    expect(check({ attendancePercent: null }, 'ATTENDANCE').passed).toBe(false);
  });

  it('L2: one session that ended without being marked fails; none passes', () => {
    expect(check({ unrecordedSessions: 1 }, 'SESSIONS_RECORDED')).toEqual({
      rule: 'SESSIONS_RECORDED',
      passed: false,
      actual: 1,
      required: 0,
    });
    expect(eligibility({ ...ok, unrecordedSessions: 1 }, t).eligible).toBe(false);
    expect(check({ unrecordedSessions: 0 }, 'SESSIONS_RECORDED').passed).toBe(true);
  });

  it('aggregate 39.99 % fails and 40.00 % passes', () => {
    expect(check({ aggregate: 39.99 }, 'AGGREGATE').passed).toBe(false);
    expect(check({ aggregate: 40 }, 'AGGREGATE').passed).toBe(true);
    expect(check({ aggregate: null }, 'AGGREGATE').passed).toBe(false);
  });

  it('a missing mandatory assessment fails; none mandatory passes', () => {
    expect(check({ mandatoryRecorded: 1 }, 'MANDATORY_ASSESSMENTS')).toMatchObject({
      passed: false,
      actual: 1,
      required: 2,
    });
    expect(check({ mandatoryTotal: 0, mandatoryRecorded: 0 }, 'MANDATORY_ASSESSMENTS').passed).toBe(
      true,
    );
  });

  it('no evaluation or "not recommended" fails', () => {
    expect(check({ recommended: null }, 'RECOMMENDATION').passed).toBe(false);
    expect(check({ recommended: false }, 'RECOMMENDATION').passed).toBe(false);
  });

  it('reports every failing check at once', () => {
    const r = eligibility(
      {
        attendancePercent: 50,
        unrecordedSessions: 2,
        mandatoryTotal: 1,
        mandatoryRecorded: 0,
        aggregate: 10,
        recommended: false,
      },
      t,
    );
    expect(r.eligible).toBe(false);
    expect(r.checks.every((c) => !c.passed)).toBe(true);
  });

  it('uses the configured thresholds', () => {
    expect(
      eligibility({ ...ok, attendancePercent: 79 }, { ...t, minAttendancePercent: 80 }).eligible,
    ).toBe(false);
  });
});
