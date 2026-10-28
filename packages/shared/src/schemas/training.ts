import { z } from 'zod';
import {
  AssessmentModeSchema,
  AttendanceStatusSchema,
  type AssessmentMode,
  type AttendanceStatus,
  type Grade,
  type SessionStatus,
} from '../enums';

// ─── Attendance (F5: BRQ-5.1–5.3, BR-05, BR-06, BR-08) ────────────────────────

export const AttendanceSaveSchema = z
  .object({
    entries: z
      .array(z.object({ studentId: z.string().uuid(), status: AttendanceStatusSchema }).strict())
      .min(1)
      .max(500)
      .refine((e) => new Set(e.map((x) => x.studentId)).size === e.length, {
        message: 'Each student can appear only once',
      }),
    /** Required when an admin edits after the trainer edit window closed. */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
export type AttendanceSaveInput = z.infer<typeof AttendanceSaveSchema>;

export interface AttendanceSheet {
  session: {
    id: string;
    batchId: string;
    batchName: string;
    courseTitle: string;
    startsAt: string;
    endsAt: string;
    venue: string;
    topic: string | null;
    status: SessionStatus;
  };
  rows: Array<{
    studentId: string;
    rollNo: string;
    fullName: string;
    status: AttendanceStatus | null;
    markedAt: string | null;
  }>;
  /** Null until the first save. */
  firstMarkedAt: string | null;
  /** When the trainer edit window closes (null before the first save). */
  editableUntil: string | null;
  canEdit: boolean;
  /** True when an edit is allowed only for an admin with a reason. */
  requiresReason: boolean;
  /** Why the sheet is read-only, if it is (i18n key suffix). */
  lockedReason: 'NOT_STARTED' | 'CANCELLED' | 'BATCH_NOT_ACTIVE' | 'WINDOW_CLOSED' | null;
}

export interface AttendanceFigures {
  attended: number;
  conducted: number;
  /** Null when no session has been conducted yet. Two decimals (BR-08). */
  percent: number | null;
  absences: number;
  consecutiveAbsences: number;
  /** Sessions that have ended while the student was in the batch but were never marked (L2). */
  unrecorded: number;
}

export interface BatchAttendanceRow extends AttendanceFigures {
  studentId: string;
  rollNo: string;
  fullName: string;
}

export interface StudentSessionRecord {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  topic: string | null;
  sessionStatus: SessionStatus;
  attendance: AttendanceStatus | null;
}

// ─── Assessments (F6: BRQ-6.1–6.4, BR-07, BR-11) ──────────────────────────────

const decimal = (max: number) =>
  z.coerce
    .number()
    .min(0)
    .max(max)
    .refine((n) => Math.round(n * 100) === n * 100, 'At most two decimals');

export const AssessmentCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    mode: AssessmentModeSchema,
    maxMarks: decimal(1000).refine((n) => n > 0, 'Must be more than 0'),
    weightage: decimal(1000).refine((n) => n > 0, 'Must be more than 0'),
    isMandatory: z.boolean(),
    heldOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();
export type AssessmentCreateInput = z.infer<typeof AssessmentCreateSchema>;

export const AssessmentUpdateSchema = AssessmentCreateSchema.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type AssessmentUpdateInput = z.infer<typeof AssessmentUpdateSchema>;

export interface AssessmentDto {
  id: string;
  batchId: string;
  title: string;
  mode: AssessmentMode;
  maxMarks: number;
  weightage: number;
  isMandatory: boolean;
  heldOn: string | null;
  recorded: number;
  rosterSize: number;
}

export const ResultsSaveSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            studentId: z.string().uuid(),
            // Range against maxMarks is checked by the service (BR-07) with per-row details.
            marks: z.coerce
              .number()
              .refine((n) => Math.round(n * 100) === n * 100, 'At most two decimals'),
            remarks: z.string().trim().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500)
      .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, {
        message: 'Each student can appear only once',
      }),
  })
  .strict();
export type ResultsSaveInput = z.infer<typeof ResultsSaveSchema>;

export interface ResultsSheet {
  assessment: AssessmentDto;
  rows: Array<{
    studentId: string;
    rollNo: string;
    fullName: string;
    marks: number | null;
    remarks: string | null;
  }>;
}

// ─── Progress and evaluation (BRQ-6.3) ─────────────────────────────────────────

export const ProgressCreateSchema = z
  .object({
    studentId: z.string().uuid().nullable().optional(),
    milestone: z.string().trim().min(2).max(200),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type ProgressCreateInput = z.infer<typeof ProgressCreateSchema>;

export interface ProgressDto {
  id: string;
  studentId: string | null;
  studentName: string | null;
  milestone: string;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

export const EvaluationSaveSchema = z
  .object({
    remarks: z.string().trim().min(3).max(2000),
    recommended: z.boolean(),
  })
  .strict();
export type EvaluationSaveInput = z.infer<typeof EvaluationSaveSchema>;

export interface EvaluationDto {
  enrollmentId: string;
  remarks: string;
  recommended: boolean;
  evaluatedBy: string;
  evaluatedAt: string;
}

export interface EvaluationRow {
  enrollmentId: string;
  studentId: string;
  rollNo: string;
  fullName: string;
  evaluation: EvaluationDto | null;
}

// ─── Student "My training" (BO-4: figures are live on every load) ─────────────

export interface StudentResult {
  assessmentId: string;
  title: string;
  mode: AssessmentMode;
  maxMarks: number;
  weightage: number;
  isMandatory: boolean;
  heldOn: string | null;
  marks: number | null;
  percent: number | null;
  remarks: string | null;
}

export interface StudentTraining {
  /** The application this training belongs to (performance report, BRQ-8.1). */
  enrollmentId: string;
  batch: {
    id: string;
    name: string;
    courseTitle: string;
    status: string;
    startDate: string;
    endDate: string;
  };
  attendance: AttendanceFigures;
  minAttendancePercent: number;
  sessions: StudentSessionRecord[];
  results: StudentResult[];
  /** Weighted aggregate over recorded assessments (two decimals), null if none recorded. */
  aggregate: number | null;
  /** Grade band of the current aggregate (BR-11). */
  projectedGrade: Grade | null;
  evaluation: Pick<EvaluationDto, 'remarks' | 'recommended' | 'evaluatedAt'> | null;
}
