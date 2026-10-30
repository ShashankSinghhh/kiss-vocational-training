import { STUDENT_NAMES, makeStudents } from '../data';
import { DEFAULT_STUDENTS, LARGE_STUDENTS } from '../index';

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

describe('seed student names', () => {
  it('the default students are the 40 listed names, none repeated', () => {
    const students = makeStudents(DEFAULT_STUDENTS);
    expect(students).toHaveLength(40);
    expect(students.map((s) => s.fullName)).toEqual([...STUDENT_NAMES]);
    expect(unique(STUDENT_NAMES)).toBe(true);
  });

  it('every name is a first name and a surname, capitalised', () => {
    for (const name of STUDENT_NAMES) expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('the 500-student seed repeats no name and keeps the first 40', () => {
    const names = makeStudents(LARGE_STUDENTS).map((s) => s.fullName);
    expect(unique(names)).toBe(true);
    expect(names.slice(0, 40)).toEqual([...STUDENT_NAMES]);
  });

  it('CGPAs stay what they were before the names changed', () => {
    // The first three students' CGPAs under the old random-name seed.
    expect(makeStudents(3).map((s) => s.cgpa)).toEqual(['5.18', '7.32', '5.79']);
  });
});
