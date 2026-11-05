import { z } from 'zod';
import { EnrollmentStatusSchema, type EnrollmentStatus } from '../enums';

/** Hard ceiling on preferences; the effective limit is the setting enrollment.maxPreferences. */
export const MAX_PREFERENCES = 3;

/** Course ids in rank order: index 0 is the first preference (BRQ-3.1). */
export const PreferencesSchema = z
  .array(z.string().uuid())
  .min(1, 'Choose at least one course')
  .max(MAX_PREFERENCES, `Choose at most ${MAX_PREFERENCES} courses`)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Each course can be chosen only once',
  });

export const EnrollmentSubmitSchema = z
  .object({ cycleId: z.string().uuid(), courseIds: PreferencesSchema })
  .strict();
export type EnrollmentSubmitInput = z.infer<typeof EnrollmentSubmitSchema>;

export const EnrollmentUpdateSchema = z.object({ courseIds: PreferencesSchema }).strict();
export type EnrollmentUpdateInput = z.infer<typeof EnrollmentUpdateSchema>;

export const REVIEW_ACTIONS = ['APPROVE', 'REJECT', 'WAITLIST'] as const;
export const ReviewActionSchema = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const ReasonSchema = z.string().trim().min(3).max(500);

export const RejectSchema = z.object({ reason: ReasonSchema }).strict();
export const WaitlistSchema = z.object({ reason: ReasonSchema.optional() }).strict();

export const BULK_MAX = 200;
export const BulkReviewSchema = z
  .object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(BULK_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate ids' }),
    action: ReviewActionSchema,
    reason: ReasonSchema.optional(),
  })
  .strict()
  .refine((v) => v.action !== 'REJECT' || !!v.reason, {
    path: ['reason'],
    message: 'A reason is required to reject',
  });
export type BulkReviewInput = z.infer<typeof BulkReviewSchema>;

export const AdminEnrollmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cycleId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  status: EnrollmentStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
export type AdminEnrollmentQuery = z.infer<typeof AdminEnrollmentQuerySchema>;

export interface EnrollmentPreference {
  rank: number;
  courseId: string;
  courseCode: string;
  courseTitle: string;
}

export interface EnrollmentHistoryEntry {
  status: EnrollmentStatus;
  reason: string | null;
  at: string;
}

export interface Enrollment {
  id: string;
  cycleId: string;
  cycleName: string;
  status: EnrollmentStatus;
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  preferences: EnrollmentPreference[];
  /** True while the student may still edit or withdraw (PENDING and every window open). */
  editable: boolean;
}

export interface MyEnrollment extends Enrollment {
  history: EnrollmentHistoryEntry[];
}

export interface AdminEnrollmentRow extends Enrollment {
  student: { id: string; rollNo: string; fullName: string; email: string };
  /**
   * Pending, with automatic approval on: why the rules hold it for a person (empty = it
   * passes). Null otherwise.
   */
  needsReview: ScreeningReason[] | null;
}

// ─── Automatic approval (BRQ-3.3): the admin's rules approve routine applications ──

/** Why an application is held for manual review instead of being approved automatically. */
export type ScreeningReason = { code: 'HAS_PREREQUISITES'; course: string; prerequisites: string };

export const AutoApprovalSchema = z
  .object({
    /** Approve applications that pass the rules as soon as they are submitted. */
    enabled: z.boolean(),
    /** Applications naming a course with prerequisites wait for a person (they're free text). */
    manualIfPrerequisites: z.boolean(),
  })
  .strict();
export type AutoApproval = z.infer<typeof AutoApprovalSchema>;

export const AutoApproveRunSchema = z.object({ cycleId: z.string().uuid() }).strict();
export type AutoApproveRunInput = z.infer<typeof AutoApproveRunSchema>;

export interface AutoApproveRunResult {
  approved: number;
  stillPending: number;
}
