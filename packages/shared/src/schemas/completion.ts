import { z } from 'zod';
import {
  CertificateStatusSchema,
  type CertificateStatus,
  type EnrollmentStatus,
  type Grade,
} from '../enums';

// ─── Completion (F7: BRQ-7.1, BRQ-9.4, BR-09) ──────────────────────────────────

/** The four BR-09 conditions, in the order they are shown. */
export const ELIGIBILITY_RULES = [
  'ATTENDANCE',
  'MANDATORY_ASSESSMENTS',
  'AGGREGATE',
  'RECOMMENDATION',
] as const;
export type EligibilityRule = (typeof ELIGIBILITY_RULES)[number];

export interface EligibilityCheck {
  rule: EligibilityRule;
  passed: boolean;
  /** Attendance/aggregate: percent or null if none yet. Mandatory: recorded count. Recommendation: true/false/null. */
  actual: number | boolean | null;
  /** Attendance/aggregate: minimum percent. Mandatory: number of mandatory assessments. Recommendation: true. */
  required: number | boolean;
  /** Mandatory: titles of the mandatory assessments with no marks yet for this student. */
  missing?: string[];
}

export interface Eligibility {
  eligible: boolean;
  checks: EligibilityCheck[];
}

export interface CompletionRow extends Eligibility {
  enrollmentId: string;
  studentId: string;
  rollNo: string;
  fullName: string;
  status: EnrollmentStatus;
  /** Reason recorded with NOT_COMPLETED. */
  reason: string | null;
  attendancePercent: number | null;
  aggregate: number | null;
  grade: Grade | null;
  certificate: CertificateSummary | null;
}

export const NotCompletedSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export type NotCompletedInput = z.infer<typeof NotCompletedSchema>;

// ─── Certificates (F7: BRQ-7.2, BRQ-7.3, BR-10, BR-19) ────────────────────────

export interface CertificateSummary {
  id: string;
  publicCode: string;
  status: CertificateStatus;
  issuedAt: string;
  /** False until the PDF has been rendered and stored. */
  rendered: boolean;
}

export interface CertificateDto extends CertificateSummary {
  enrollmentId: string;
  studentName: string;
  rollNo: string;
  courseTitle: string;
  batchName: string;
  cycleName: string;
  grade: Grade;
  aggregatePercent: number;
  attendancePercent: number;
  issuedBy: string;
  /**
   * True when an admin may reissue it: a valid certificate, or a revoked one that has not been
   * replaced yet (BR-19).
   */
  canReissue: boolean;
}

export const CertificateListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: CertificateStatusSchema.optional(),
});
export type CertificateListQuery = z.infer<typeof CertificateListQuerySchema>;

/** Result of approving: the certificate, and whether the PDF is ready (else retry later). */
export interface ApproveResult {
  enrollmentId: string;
  status: EnrollmentStatus;
  certificate: CertificateSummary;
}
