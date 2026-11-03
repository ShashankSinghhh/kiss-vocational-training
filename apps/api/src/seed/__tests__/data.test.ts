import { COURSES, PROGRAMMES, STUDENT_NAMES, TRAINERS, makeStudents } from '../data';

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

describe('seed data', () => {
  it('has 100 students with the listed names, in order', () => {
    const students = makeStudents();
    expect(students).toHaveLength(100);
    expect(students.map((s) => s.fullName)).toEqual([...STUDENT_NAMES]);
    expect(students[99]!.email).toBe('student100@kiss-vtmp.test');
  });

  it('repeats no name, first name or surname across students and trainers', () => {
    const people = [...STUDENT_NAMES, ...TRAINERS.map((t) => t.fullName)];
    expect(unique(people)).toBe(true);
    expect(unique(people.map((n) => n.split(' ')[0]!))).toBe(true);
    expect(unique(people.map((n) => n.split(' ')[1]!))).toBe(true);
  });

  it('every name is a first name and a surname, capitalised', () => {
    for (const name of STUDENT_NAMES) expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('has five programmes, each with a trainer and courses with unique codes', () => {
    expect(PROGRAMMES.map((p) => p.name)).toEqual([
      'Computer & Digital Skills',
      'Art, Craft & Handicrafts',
      'Manufacturing & Production',
      'Agriculture & Livelihood',
      'Professional & Life Skills',
    ]);
    expect(TRAINERS).toHaveLength(PROGRAMMES.length);
    expect(COURSES).toHaveLength(30);
    expect(unique(COURSES.map((c) => c.code))).toBe(true);
    for (const c of COURSES) expect(c.code).toMatch(/^[A-Za-z0-9-]{2,20}$/);
  });

  it('refuses more students than there are names', () => {
    expect(() => makeStudents(101)).toThrow();
  });
});
