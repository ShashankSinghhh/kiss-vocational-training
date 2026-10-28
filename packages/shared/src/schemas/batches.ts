import { z } from 'zod';
import {
  BatchStatusSchema,
  SessionStatusSchema,
  type BatchStatus,
  type SessionStatus,
} from '../enums';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const isoDateTime = z.string().datetime({ offset: true });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 h)');

// ─── Batches (BRQ-4.1) ────────────────────────────────────────────────────────

export const BatchCreateSchema = z
  .object({
    courseId: z.string().uuid(),
    cycleId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    capacity: z.coerce.number().int().min(1).max(500),
    startDate: isoDate,
    endDate: isoDate,
    venue: z.string().trim().min(2).max(120),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'Ends before it starts' });
export type BatchCreateInput = z.infer<typeof BatchCreateSchema>;

export const BatchUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    capacity: z.coerce.number().int().min(1).max(500),
    startDate: isoDate,
    endDate: isoDate,
    venue: z.string().trim().min(2).max(120),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type BatchUpdateInput = z.infer<typeof BatchUpdateSchema>;

export const BatchListQuerySchema = z.object({
  cycleId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  status: BatchStatusSchema.optional(),
});

export interface BatchSummary {
  id: string;
  name: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  cycleId: string;
  cycleName: string;
  capacity: number;
  enrolled: number;
  startDate: string;
  endDate: string;
  venue: string;
  status: BatchStatus;
  trainers: Array<{ id: string; fullName: string }>;
  nextSession: SessionDto | null;
}

export interface RosterEntry {
  enrollmentId: string;
  studentId: string;
  rollNo: string;
  fullName: string;
  email: string;
  phone: string | null;
  cgpa: string;
  enrollmentStatus: string;
  allocatedAt: string;
}

export interface BatchDetail extends BatchSummary {
  /** Hidden from students (NFR-08): they see their batch, not classmates' details. */
  roster: RosterEntry[] | null;
}

export const AssignStudentSchema = z.object({ enrollmentId: z.string().uuid() }).strict();
export const MoveStudentSchema = z.object({ toBatchId: z.string().uuid() }).strict();
/** L4: a student leaves a planned or running batch; the reason is kept on the application. */
export const WithdrawFromTrainingSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export type WithdrawFromTrainingInput = z.infer<typeof WithdrawFromTrainingSchema>;
export const AssignTrainerSchema = z.object({ trainerId: z.string().uuid() }).strict();

export interface Candidate {
  enrollmentId: string;
  status: string;
  rollNo: string;
  fullName: string;
  cgpa: string;
  submittedAt: string;
  /** Rank of this batch's course in the student's preferences. */
  rankForCourse: number;
}

export interface TrainerOption {
  id: string;
  fullName: string;
  employeeCode: string;
  specialization: string | null;
}

// ─── Sessions (BRQ-4.3) ───────────────────────────────────────────────────────

export const DAYS_OF_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

const sessionBase = {
  venue: z.string().trim().min(2).max(120).optional(),
  topic: z.string().trim().max(200).optional(),
  trainerId: z.string().uuid().optional(),
};

export const SessionCreateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('single'),
      startsAt: isoDateTime,
      endsAt: isoDateTime,
      ...sessionBase,
    })
    .strict(),
  z
    .object({
      kind: z.literal('recurring'),
      daysOfWeek: z.array(z.enum(DAYS_OF_WEEK)).min(1).max(7),
      startTime: hhmm,
      endTime: hhmm,
      from: isoDate,
      until: isoDate,
      ...sessionBase,
    })
    .strict(),
]);
export type SessionCreateInput = z.infer<typeof SessionCreateSchema>;

export interface SessionDto {
  id: string;
  batchId: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  topic: string | null;
  status: SessionStatus;
  trainerId: string | null;
  trainerName: string | null;
}

export const SessionStatusUpdateSchema = z
  .object({ status: SessionStatusSchema.extract(['CANCELLED']) })
  .strict();

// ─── Allocation (BRQ-4.2, BR-03, BR-04) ───────────────────────────────────────

export const AllocationPreviewRequestSchema = z.object({ cycleId: z.string().uuid() }).strict();
export const AllocationConfirmSchema = z.object({ previewId: z.string().uuid() }).strict();

export interface AllocationAssignment {
  enrollmentId: string;
  studentName: string;
  rollNo: string;
  batchId: string;
  courseId: string;
  /** Which preference was satisfied (1 = first choice). */
  rank: number;
}

export interface AllocationWaitlistEntry {
  enrollmentId: string;
  studentName: string;
  rollNo: string;
}

export interface AllocationBatchFill {
  batchId: string;
  batchName: string;
  courseId: string;
  courseTitle: string;
  capacity: number;
  /** Students already in the batch before this allocation. */
  existing: number;
  /** Students this allocation adds. */
  added: number;
}

export interface AllocationPreview {
  previewId: string;
  cycleId: string;
  expiresAt: string;
  priorityRule: string;
  assignments: AllocationAssignment[];
  waitlist: AllocationWaitlistEntry[];
  batches: AllocationBatchFill[];
  stats: {
    applicants: number;
    allocated: number;
    waitlisted: number;
    byRank: Record<string, number>;
    elapsedMs: number;
  };
  warnings: string[];
}
