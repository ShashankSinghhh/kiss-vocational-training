/** Deterministic demo data so every developer and CI run gets the same seed. */

// Override with SEED_PASSWORD when seeding a public demo database.
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Password@123';
export const EMAIL_DOMAIN = 'kiss-vtmp.test';

export const ADMIN = { email: `admin@${EMAIL_DOMAIN}`, fullName: 'Portal Administrator' };

export const TRAINERS = [
  { n: 1, fullName: 'Sushant Mohanty', specialization: 'Electrical installation' },
  { n: 2, fullName: 'Priyanka Sahoo', specialization: 'Solar PV systems' },
  { n: 3, fullName: 'Ranjita Behera', specialization: 'Tailoring and garment making' },
  { n: 4, fullName: 'Debasis Nayak', specialization: 'Electrical maintenance' },
].map((t) => ({
  ...t,
  email: `trainer${t.n}@${EMAIL_DOMAIN}`,
  employeeCode: `TRN-${String(t.n).padStart(3, '0')}`,
}));

export const COURSES = [
  {
    code: 'ELEC-DOM',
    title: 'Electrician — Domestic',
    description:
      'Install, test and maintain household wiring, distribution boards and appliances safely.',
    durationWeeks: 12,
    prerequisites: 'Class 8 pass',
    seatCapacity: 40,
  },
  {
    code: 'SOLAR-PV',
    title: 'Solar PV Installer',
    description:
      'Survey sites, mount panels and wire grid-tied and off-grid solar photovoltaic systems.',
    durationWeeks: 10,
    prerequisites: 'Class 10 pass; basic electrical safety',
    seatCapacity: 30,
  },
  {
    code: 'TAIL-GMT',
    title: 'Tailoring & Garment Making',
    description:
      'Take measurements, draft patterns, cut and stitch garments on domestic and industrial machines.',
    durationWeeks: 12,
    prerequisites: null,
    seatCapacity: 35,
  },
] as const;

/**
 * The default students, in roll-number order: 40 different people, half women and half men,
 * with first names common in Odisha and surnames of the state's tribal communities (Santal,
 * Munda, Ho, Oraon, Kharia, Kondh, Saora, Bhuyan), as at KISS. Every full name is unique.
 * Students 021–030 form the seeded pilot batch and 031–040 have pending applications.
 */
export const STUDENT_NAMES = [
  'Sumitra Hembram',
  'Rabindra Majhi',
  'Sukanti Soren',
  'Biren Munda',
  'Lipika Tudu',
  'Jitendra Kisku',
  'Manjulata Oram',
  'Prakash Marandi',
  'Saraswati Naik',
  'Dambaru Sabar',
  'Basanti Murmu',
  'Ramesh Gamango',
  'Pramila Bhoi',
  'Santosh Hansdah',
  'Ritanjali Pradhan',
  'Bijay Kanhar',
  'Kalpana Besra',
  'Susanta Jani',
  'Puspanjali Dehury',
  'Lalit Tirkey',
  'Sanjukta Kujur',
  'Ajit Ekka',
  'Rinki Toppo',
  'Dhaneswar Mallick',
  'Anita Badaik',
  'Kartik Bodra',
  'Jamuna Purty',
  'Sudam Lakra',
  'Sabita Minz',
  'Prafulla Raika',
  'Rashmita Soren',
  'Nabin Murmu',
  'Laxmipriya Majhi',
  'Ganesh Tudu',
  'Kuni Munda',
  'Bhagaban Naik',
  'Sarojini Marandi',
  'Hemanta Oram',
  'Jharana Sabar',
  'Tapas Kisku',
] as const;

/** Small linear congruential generator: same sequence on every run. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

export interface SeedStudent {
  n: number;
  email: string;
  fullName: string;
  rollNo: string;
  cgpa: string;
  phone: string;
}

/**
 * Names beyond the list (the 500-student `--large` seed only): the list's first names paired
 * with its surnames in a fixed shuffled order, skipping pairs already used, so no name repeats.
 */
function extraNames(): string[] {
  const firsts = [...new Set(STUDENT_NAMES.map((n) => n.split(' ')[0]!))];
  const lasts = [...new Set(STUDENT_NAMES.map((n) => n.split(' ')[1]!))];
  const used = new Set<string>(STUDENT_NAMES);
  const pairs = firsts.flatMap((f) => lasts.map((l) => `${f} ${l}`)).filter((n) => !used.has(n));
  const rand = lcg(7);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
  }
  return pairs;
}

export function makeStudents(count: number): SeedStudent[] {
  const names = count > STUDENT_NAMES.length ? [...STUDENT_NAMES, ...extraNames()] : STUDENT_NAMES;
  if (count > names.length) throw new Error(`At most ${names.length} seed students have names`);
  const rand = lcg(2026);
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    // Two draws once picked the random names; kept so every student keeps the same CGPA.
    rand();
    rand();
    // CGPA spread 5.00–9.80 so the CGPA priority rule has something to sort.
    const cgpa = (5 + Math.round(rand() * 480) / 100).toFixed(2);
    return {
      n,
      email: `student${String(n).padStart(3, '0')}@${EMAIL_DOMAIN}`,
      fullName: names[i]!,
      rollNo: `KISS-VT-${String(n).padStart(4, '0')}`,
      cgpa,
      phone: `9${String(437000000 + n * 7919).padStart(9, '0')}`,
    };
  });
}
