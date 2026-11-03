/** Deterministic seed data so every developer and CI run gets the same database. */

// Override with SEED_PASSWORD when seeding a public demo database.
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Password@123';
// Admin accounts can have their own password (SEED_ADMIN_PASSWORD), so sharing the demo password
// with examiners doesn't hand out admin access. Without it, admins use SEED_PASSWORD.
export const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? SEED_PASSWORD;
export const EMAIL_DOMAIN = 'kiss-vtmp.test';

export const ADMIN = { email: `admin@${EMAIL_DOMAIN}`, fullName: 'Portal Administrator' };

/** One trainer per programme, in programme order (trainer1 teaches the first programme). */
export const TRAINERS = [
  { n: 1, fullName: 'Naitik Modi', specialization: 'Computer and digital skills' },
  { n: 2, fullName: 'Debmalya Pal', specialization: 'Traditional crafts of Odisha' },
  { n: 3, fullName: 'Rupesh Kashyap', specialization: 'Manufacturing and production' },
  { n: 4, fullName: 'Archi Jana', specialization: 'Agriculture and rural livelihoods' },
  { n: 5, fullName: 'Arpan Dubey', specialization: 'Professional and life skills' },
].map((t) => ({
  ...t,
  email: `trainer${t.n}@${EMAIL_DOMAIN}`,
  employeeCode: `TRN-${String(t.n).padStart(3, '0')}`,
}));

export interface SeedCourse {
  code: string;
  title: string;
  description: string;
  durationWeeks: number;
  prerequisites: string | null;
  seatCapacity: number;
}

/**
 * The programmes students choose from, in the order they are listed, each with its courses.
 * Every course runs in one batch per cycle, taught by its programme's trainer.
 */
export const PROGRAMMES: ReadonlyArray<{ name: string; courses: readonly SeedCourse[] }> = [
  {
    name: 'Computer & Digital Skills',
    courses: [
      {
        code: 'CDS-COMP',
        title: 'Computer Training',
        description:
          'Use a computer with confidence: typing, files and folders, word processing, spreadsheets, e-mail and safe use of the internet.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'CDS-IBM',
        title: 'IBM Training',
        description:
          'IBM SkillsBuild learning paths in IT fundamentals, data and cloud basics, with workplace professional skills.',
        durationWeeks: 16,
        prerequisites: 'Basic computer use',
        seatCapacity: 30,
      },
      {
        code: 'CDS-DIGI',
        title: 'Digital Skills Training',
        description:
          'Smartphone and online services for daily life and work: digital payments, government portals, online forms and staying safe from fraud.',
        durationWeeks: 8,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'CDS-ENTR',
        title: 'Entrepreneurship Training',
        description:
          'Plan a small business with digital tools: idea, costing, simple bookkeeping on a computer, online selling and social-media marketing.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 30,
      },
    ],
  },
  {
    name: 'Art, Craft & Handicrafts',
    courses: [
      {
        code: 'ACH-TERRA',
        title: 'Terracotta',
        description:
          'Prepare clay, hand-build and wheel-throw pieces, decorate and fire terracotta ware in the Odisha tradition.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-WOOD',
        title: 'Wood Carving',
        description:
          'Select and season wood, use carving tools safely and carve decorative panels, toys and figures.',
        durationWeeks: 16,
        prerequisites: null,
        seatCapacity: 20,
      },
      {
        code: 'ACH-GRASS',
        title: 'Golden Grass Work',
        description:
          'Harvest and treat golden grass (kaincha) and weave baskets, mats, boxes and decorative items.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-COIR',
        title: 'Coir Work',
        description:
          'Extract and spin coconut fibre and make ropes, mats, bags and handicraft products from coir.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-PAPIER',
        title: 'Papier-Mâché',
        description:
          'Make papier-mâché pulp, mould masks, toys and decorative pieces, and finish them with paint.',
        durationWeeks: 8,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-APPLIQUE',
        title: 'Appliqué Work',
        description:
          'Cut and stitch coloured fabric motifs in the Pipili appliqué style for canopies, bags and wall hangings.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-EMBROID',
        title: 'Embroidery',
        description:
          'Hand and machine embroidery stitches, motif tracing and finishing for garments and household linen.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-PAINT',
        title: 'Painting',
        description:
          'Drawing, colour and composition, with Pattachitra and Saura painting on cloth, paper and walls.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'ACH-TRIBAL',
        title: 'Tribal Art',
        description:
          'Tribal art forms of Odisha, including Saura idital and Dhokra-inspired designs, made into saleable products.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 25,
      },
    ],
  },
  {
    name: 'Manufacturing & Production',
    courses: [
      {
        code: 'MFG-APPAREL',
        title: 'Apparel Making',
        description:
          'Industrial sewing machines, garment construction and quality checks on an apparel production line.',
        durationWeeks: 16,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'MFG-TAILOR',
        title: 'Tailoring',
        description:
          'Take measurements, draft patterns, cut and stitch garments on domestic and industrial machines.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'MFG-KNIT',
        title: 'Knitting',
        description:
          'Hand and machine knitting of sweaters, caps and scarves, reading patterns and finishing.',
        durationWeeks: 8,
        prerequisites: null,
        seatCapacity: 25,
      },
      {
        code: 'MFG-CHEM',
        title: 'Chemical Production',
        description:
          'Safe small-scale production of phenyl, detergent, soap and other cleaning products, with packaging and labelling.',
        durationWeeks: 8,
        prerequisites: 'Class 8 pass',
        seatCapacity: 20,
      },
      {
        code: 'MFG-WATER',
        title: 'Mineral Water Production',
        description:
          'Water treatment and purification, bottling plant operation, hygiene and quality testing.',
        durationWeeks: 8,
        prerequisites: 'Class 8 pass',
        seatCapacity: 20,
      },
      {
        code: 'MFG-FOOD',
        title: 'Food Processing',
        description:
          'Make pickles, jams, sauces and dried products; food safety, preservation, packaging and FSSAI basics.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'MFG-BAKERY',
        title: 'Bakery',
        description:
          'Bake bread, buns, biscuits and cakes; oven operation, hygiene, costing and packaging.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 25,
      },
    ],
  },
  {
    name: 'Agriculture & Livelihood',
    courses: [
      {
        code: 'AGL-ANIMAL',
        title: 'Animal Husbandry',
        description:
          'Rear cattle, goats and poultry: feeding, housing, vaccination, common diseases and record keeping.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'AGL-COMPOSITE',
        title: 'Composite Farming',
        description:
          'Combine crops, livestock and fish on one farm so each supports the others, with year-round planning.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'AGL-FISH',
        title: 'Pisciculture (Fish Farming)',
        description:
          'Pond preparation, stocking, feeding, water quality, disease control and harvesting of fish.',
        durationWeeks: 10,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'AGL-NATURAL',
        title: 'Natural Farming',
        description:
          'Grow crops without chemicals: soil health, natural inputs such as jeevamrut, mulching, seed saving and pest control.',
        durationWeeks: 12,
        prerequisites: null,
        seatCapacity: 30,
      },
      {
        code: 'AGL-RENEW',
        title: 'Renewable Energy',
        description:
          'Solar lights, pumps and home systems: installation, safe wiring, maintenance and simple repairs.',
        durationWeeks: 12,
        prerequisites: 'Class 8 pass',
        seatCapacity: 25,
      },
    ],
  },
  {
    name: 'Professional & Life Skills',
    courses: [
      {
        code: 'PLS-MEDATT',
        title: 'Medical Attendant',
        description:
          'Patient care, hygiene, vital signs, first aid and supporting nurses in hospitals and homes.',
        durationWeeks: 24,
        prerequisites: 'Class 10 pass; at least 18 years old',
        seatCapacity: 25,
      },
      {
        code: 'PLS-DRIVE',
        title: 'Driving',
        description:
          'Light motor vehicle driving, road rules, vehicle care and preparation for the driving licence test.',
        durationWeeks: 8,
        prerequisites: 'At least 18 years old',
        seatCapacity: 20,
      },
      {
        code: 'PLS-MPRIDE',
        title: 'Mahindra Pride Programme',
        description:
          'Mahindra Pride Classroom: English, communication, digital literacy and interview skills for jobs.',
        durationWeeks: 12,
        prerequisites: 'Class 10 pass',
        seatCapacity: 30,
      },
      {
        code: 'PLS-SOFT',
        title: 'Soft Skills',
        description:
          'Spoken English, communication, teamwork, time management and workplace behaviour.',
        durationWeeks: 6,
        prerequisites: null,
        seatCapacity: 40,
      },
      {
        code: 'PLS-ENTRP',
        title: 'Entrepreneurial Training',
        description:
          'Start and run a micro-enterprise: market research, business plan, finance and bank linkage, government schemes.',
        durationWeeks: 8,
        prerequisites: null,
        seatCapacity: 30,
      },
    ],
  },
];

export const COURSES: readonly SeedCourse[] = PROGRAMMES.flatMap((p) => p.courses);

/**
 * The students, in roll-number order: 100 different people. Each name pairs a first name and a
 * surname taken from different people, so none is a real student's name, and no first name or
 * surname is used twice.
 */
export const STUDENT_NAMES = [
  'Mayukh Murmu',
  'Shrey Kanungo',
  'Aastha Shankar',
  'Prachi Patra',
  'Kshitiz Majumdar',
  'Sarthak Vyas',
  'Ranit Pradhan',
  'Tanishq Mishra',
  'Bhumi Mahapatra',
  'Saksham Ansari',
  'Surya Samanta',
  'Supriyo Nandan',
  'Sourik Upadhyay',
  'Sampurna Katiyar',
  'Udita Bhuyan',
  'Hritika Dash',
  'Supratim Banik',
  'Shrihari Shah',
  'Prabhu Borah',
  'Srijita Shekhar',
  'Sushant Ray',
  'Abhipsa Meher',
  'Arjita Awasthi',
  'Adri Shahi',
  'Taniya Basu',
  'Pratyush Deb',
  'Subhamoy Jha',
  'Rohit Kundu',
  'Niyati Seth',
  'Akshit Talukder',
  'Srishti Gupta',
  'Avik Soni',
  'Aadya Bhowmik',
  'Animesh Bhardwaj',
  'Aayushi Misra',
  'Ritik Manna',
  'Abhay Bhadra',
  'Snehashis Parashar',
  'Atharv Shaw',
  'Anirudha Verma',
  'Kushagra Mathur',
  'Shreyansh Giri',
  'Prisha Khan',
  'Sujal Sahay',
  'Indrakshi Sarangi',
  'Sukriti Mahajan',
  'Shibam Behera',
  'Arghya Majumder',
  'Ravish Samal',
  'Tanishqa Ganguly',
  'Rajiv Rahman',
  'Shubham Datta',
  'Sanchit Adhikari',
  'Sohan Bhatta',
  'Dwipayan Patro',
  'Muskan Reddy',
  'Abdullah Dawn',
  'Ashutosh Chakravarty',
  'Priyanshu Kaur',
  'Aaditya Lal',
  'Mukesh Sahoo',
  'Aahana Alam',
  'Pranit Yadav',
  'Amiya Dutta',
  'Abhijit Thapa',
  'Shuvam Raut',
  'Adarsh Chaurasia',
  'Siya Jaiswal',
  'Sthita Bhatnagar',
  'Prince Jena',
  'Ansuman Chauhan',
  'Tithi Tyagi',
  'Soumyak Agrawal',
  'Priti Bhagat',
  'Anubhab Singha',
  'Tanvi Swain',
  'Biswa Pattanayak',
  'Garima Chittora',
  'Anshita Trivedi',
  'Anirban Sah',
  'Lavanya Singhal',
  'Rishi Panigrahi',
  'Akshaya Nag',
  'Ritam Pattanaik',
  'Saikat Adhikary',
  'Samriddhi Goswami',
  'Anirudh Satapathy',
  'Vaishnabi Ojha',
  'Aaradhya Shukla',
  'Snehasis Bharti',
  'Arkaprabho Chaudhury',
  'Kavish Guha',
  'Tanay Sikdar',
  'Tamanna Maji',
  'Marisha Chandra',
  'Arijit Dwivedi',
  'Chandan Dhar',
  'Swapnanil Rath',
  'Preeti Mondal',
  'Kaustubh Bhoi',
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

export function makeStudents(count: number = STUDENT_NAMES.length): SeedStudent[] {
  if (count > STUDENT_NAMES.length) {
    throw new Error(`At most ${STUDENT_NAMES.length} seed students have names`);
  }
  const rand = lcg(2026);
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    // CGPA spread 5.00–9.80 so the CGPA priority rule has something to sort.
    const cgpa = (5 + Math.round(rand() * 480) / 100).toFixed(2);
    return {
      n,
      email: `student${String(n).padStart(3, '0')}@${EMAIL_DOMAIN}`,
      fullName: STUDENT_NAMES[i]!,
      rollNo: `KISS-VT-${String(n).padStart(4, '0')}`,
      cgpa,
      phone: `9${String(437000000 + n * 7919).padStart(9, '0')}`,
    };
  });
}
