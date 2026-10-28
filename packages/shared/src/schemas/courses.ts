import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ─── Courses (BRQ-2.1, BRQ-2.2) ───────────────────────────────────────────────

export const CourseCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,20}$/, 'Use 2–20 letters, digits or dashes'),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(2000),
    durationWeeks: z.coerce.number().int().min(1).max(104),
    prerequisites: z.string().trim().max(500).nullable().optional(),
    /** Automatic approval waits for a person to check the prerequisites (D2); default true. */
    prerequisitesNeedReview: z.boolean().optional(),
    seatCapacity: z.coerce.number().int().min(1).max(1000),
  })
  .strict();
export type CourseCreateInput = z.infer<typeof CourseCreateSchema>;

export const CourseUpdateSchema = CourseCreateSchema.omit({ code: true })
  .extend({ isActive: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type CourseUpdateInput = z.infer<typeof CourseUpdateSchema>;

export interface AdminCourse {
  id: string;
  code: string;
  title: string;
  description: string;
  durationWeeks: number;
  prerequisites: string | null;
  prerequisitesNeedReview: boolean;
  seatCapacity: number;
  isActive: boolean;
  /** What deactivating it would affect (D4): live batches, students placed, open windows. */
  inUse: { batches: number; students: number; openWindows: number };
}

// ─── Training cycles ──────────────────────────────────────────────────────────

export const CycleCreateSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, { path: ['endsOn'], message: 'Ends before it starts' });
export type CycleCreateInput = z.infer<typeof CycleCreateSchema>;

export const CycleUpdateSchema = z
  .object({ name: z.string().trim().min(3).max(60), startsOn: isoDate, endsOn: isoDate })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type CycleUpdateInput = z.infer<typeof CycleUpdateSchema>;

export interface Cycle {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

// ─── Offerings: a course in a cycle with its enrollment window (BRQ-2.3) ──────

export const OfferingUpsertSchema = z
  .object({
    enrollmentOpensAt: isoDateTime,
    enrollmentClosesAt: isoDateTime,
    isOpen: z.boolean(),
  })
  .strict()
  .refine((v) => new Date(v.enrollmentClosesAt) > new Date(v.enrollmentOpensAt), {
    path: ['enrollmentClosesAt'],
    message: 'Window must close after it opens',
  });
export type OfferingUpsertInput = z.infer<typeof OfferingUpsertSchema>;

export type WindowState = 'NOT_OFFERED' | 'UPCOMING' | 'OPEN' | 'CLOSED';

export interface Offering {
  courseId: string;
  cycleId: string;
  enrollmentOpensAt: string;
  enrollmentClosesAt: string;
  isOpen: boolean;
  windowState: WindowState;
}

/** A catalogue entry for one course in one cycle (BRQ-2.2). */
export interface CatalogueCourse {
  id: string;
  code: string;
  title: string;
  description: string;
  durationWeeks: number;
  prerequisites: string | null;
  seatCapacity: number;
  /** Indicative: capacity minus approved applications ranking it first and allocated students. */
  seatsRemaining: number;
  offering: Offering | null;
}

export const CatalogueQuerySchema = z.object({
  cycleId: z.string().uuid().optional(),
});
