import { allocate, type Applicant, type BatchSlot } from '../rules';

const t0 = new Date('2026-11-01T09:00:00Z').getTime();
const app = (id: string, prefs: string[], minute: number): Applicant => ({
  enrollmentId: id,
  preferences: prefs,
  submittedAt: new Date(t0 + minute * 60_000),
});
const batch = (batchId: string, courseId: string, free: number, name = batchId): BatchSlot => ({
  batchId,
  courseId,
  name,
  free,
});
const where = (r: ReturnType<typeof allocate>, id: string) =>
  r.assignments.find((a) => a.enrollmentId === id);

describe('allocate (BRQ-4.2, BR-03, BR-04)', () => {
  it('never exceeds capacity and waitlists the overflow (BR-03)', () => {
    const r = allocate(
      [app('a', ['ELEC'], 1), app('b', ['ELEC'], 2), app('c', ['ELEC'], 3)],
      [batch('E1', 'ELEC', 2)],
      'SUBMISSION_TIME',
    );
    expect(r.assignments.map((x) => x.enrollmentId)).toEqual(['a', 'b']);
    expect(r.waitlist).toEqual(['c']);
    expect(r.stats).toMatchObject({ applicants: 3, allocated: 2, waitlisted: 1 });
  });

  it('considers every first choice before any second choice (rank first)', () => {
    // b submitted earlier, but SOLAR is only b's 2nd choice; c ranks SOLAR first.
    const r = allocate(
      [app('a', ['ELEC'], 1), app('b', ['ELEC', 'SOLAR'], 2), app('c', ['SOLAR'], 3)],
      [batch('E1', 'ELEC', 1), batch('S1', 'SOLAR', 1)],
      'SUBMISSION_TIME',
    );
    expect(where(r, 'a')).toMatchObject({ batchId: 'E1', rank: 1 });
    expect(where(r, 'c')).toMatchObject({ batchId: 'S1', rank: 1 });
    expect(r.waitlist).toEqual(['b']);
  });

  it('falls back to rank 2 and 3 when earlier choices are full', () => {
    const r = allocate(
      [
        app('a', ['ELEC'], 1),
        app('b', ['ELEC', 'SOLAR', 'TAIL'], 2),
        app('c', ['ELEC', 'SOLAR', 'TAIL'], 3),
      ],
      [batch('E1', 'ELEC', 1), batch('S1', 'SOLAR', 1), batch('T1', 'TAIL', 1)],
      'SUBMISSION_TIME',
    );
    expect(where(r, 'b')).toMatchObject({ courseId: 'SOLAR', rank: 2 });
    expect(where(r, 'c')).toMatchObject({ courseId: 'TAIL', rank: 3 });
    expect(r.stats.byRank).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it('SUBMISSION_TIME: earliest application wins the last seat', () => {
    const r = allocate(
      [app('late', ['ELEC'], 10), app('early', ['ELEC'], 1)],
      [batch('E1', 'ELEC', 1)],
      'SUBMISSION_TIME',
    );
    expect(r.assignments.map((x) => x.enrollmentId)).toEqual(['early']);
  });

  it('breaks complete ties by enrollment id, so results are deterministic', () => {
    const r1 = allocate(
      [app('b', ['E'], 1), app('a', ['E'], 1)],
      [batch('E1', 'E', 1)],
      'SUBMISSION_TIME',
    );
    const r2 = allocate(
      [app('a', ['E'], 1), app('b', ['E'], 1)],
      [batch('E1', 'E', 1)],
      'SUBMISSION_TIME',
    );
    expect(r1.assignments[0]!.enrollmentId).toBe('a');
    expect(r2).toEqual(r1);
  });

  it('spreads students over batches of the same course (most free seats first)', () => {
    const apps = Array.from({ length: 6 }, (_, i) => app(`s${i}`, ['ELEC'], i));
    const r = allocate(
      apps,
      [batch('A', 'ELEC', 3, 'Batch A'), batch('B', 'ELEC', 3, 'Batch B')],
      'SUBMISSION_TIME',
    );
    const counts = r.assignments.reduce<Record<string, number>>(
      (m, x) => ({ ...m, [x.batchId]: (m[x.batchId] ?? 0) + 1 }),
      {},
    );
    expect(counts).toEqual({ A: 3, B: 3 });
  });

  it('respects seats already taken (free < capacity) and courses without batches', () => {
    const r = allocate(
      [app('a', ['ELEC', 'NOBATCH'], 1), app('b', ['ELEC'], 2)],
      [batch('E1', 'ELEC', 0)],
      'SUBMISSION_TIME',
    );
    expect(r.assignments).toEqual([]);
    expect(r.waitlist).toEqual(['a', 'b']);
  });

  it('allocates 500 applicants across 3 courses in well under 5 s (BO-3)', () => {
    const courses = ['ELEC', 'SOLAR', 'TAIL'];
    const apps = Array.from({ length: 500 }, (_, i) =>
      app(`e${i}`, [courses[i % 3]!, courses[(i + 1) % 3]!, courses[(i + 2) % 3]!], i),
    );
    const batches = courses.flatMap((c) => [batch(`${c}-1`, c, 60), batch(`${c}-2`, c, 60)]);
    const started = performance.now();
    const r = allocate(apps, batches, 'SUBMISSION_TIME');
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(5000);
    expect(r.stats.allocated).toBe(360);
    expect(r.stats.waitlisted).toBe(140);
    for (const b of batches) {
      expect(r.assignments.filter((x) => x.batchId === b.batchId).length).toBeLessThanOrEqual(60);
    }
  });
});
