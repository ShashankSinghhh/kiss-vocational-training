import { z } from 'zod';
import { PaginationQuerySchema } from './api';

/** Shared figures for a course or a batch (BRQ-20.1, 20.3). Rates are % to two decimals. */
export interface OutcomeFigures {
  students: number;
  completed: number;
  notCompleted: number;
  certified: number;
  /** completed ÷ (completed + not completed); null until someone has finished. */
  completionRate: number | null;
  /** Mean of all recorded results as % of their maximum; null when nothing is recorded. */
  averageScore: number | null;
  /** Attended marks ÷ all marks on conducted sessions (LATE per setting); null before any. */
  attendanceRate: number | null;
  placed: number;
  /** placed ÷ completed; null until someone has completed. */
  placementRate: number | null;
}

export interface CourseOutcome extends OutcomeFigures {
  courseId: string;
  courseTitle: string;
  batches: number;
  /** BRQ-20.2: verified (student, competency) pairs ÷ students × competencies; null if none. */
  competencyAchievement: number | null;
  competencies: number;
}

export interface BatchOutcome extends OutcomeFigures {
  batchId: string;
  batchName: string;
  courseId: string;
  courseTitle: string;
  cycleName: string;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED';
}

export interface OutcomeAnalytics {
  /** When the views were last refreshed (nightly); null if never. */
  refreshedAt: string | null;
  /** D7: certificates issued since the views were refreshed (not in these figures yet). */
  certificatesSinceRefresh: number;
  totals: OutcomeFigures;
  courses: CourseOutcome[];
  batches: BatchOutcome[];
}

export const AnalyticsQuerySchema = z.object({ cycleId: z.string().uuid().optional() }).strict();
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export const PLACEMENT_TYPES = [
  'JOB',
  'APPRENTICESHIP',
  'INTERNSHIP',
  'SELF_EMPLOYED',
  'FURTHER_STUDY',
] as const;
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** BRQ-20.3: an admin records what a trained student went on to do. */
export const PlacementSchema = z
  .object({
    enrollmentId: z.string().uuid(),
    opportunityId: z.string().uuid().optional(),
    type: z.enum(PLACEMENT_TYPES),
    employer: z.string().trim().min(2).max(160),
    roleTitle: z.string().trim().min(2).max(160),
    placedOn: isoDay,
    monthlyIncome: z.number().min(0).max(10_000_000).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export type PlacementInput = z.infer<typeof PlacementSchema>;

export interface PlacementDto {
  id: string;
  enrollmentId: string;
  student: { id: string; fullName: string; rollNo: string };
  courseTitle: string;
  batchName: string;
  opportunity: { id: string; title: string } | null;
  type: PlacementType;
  employer: string;
  roleTitle: string;
  placedOn: string;
  monthlyIncome: number | null;
  notes: string | null;
  recordedBy: string;
  createdAt: string;
}

export const PlacementListQuerySchema = PaginationQuerySchema.extend({
  courseId: z.string().uuid().optional(),
});
export type PlacementListQuery = z.infer<typeof PlacementListQuerySchema>;

/** A student's finished trainings that a placement can be recorded against. */
export interface PlacementCandidate {
  enrollmentId: string;
  student: { id: string; fullName: string; rollNo: string };
  courseTitle: string;
  batchName: string;
  status: 'COMPLETED' | 'CERTIFIED';
}
