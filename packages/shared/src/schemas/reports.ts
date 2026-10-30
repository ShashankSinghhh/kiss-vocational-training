import { z } from 'zod';
import type { EnrollmentStatus, Grade } from '../enums';
import type { CertificateSummary } from './completion';

// ─── Reports (F8: BRQ-8.1, BRQ-8.2, BRD §12.2) ────────────────────────────────

export const ReportFormatSchema = z.enum(['csv', 'pdf']);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

export const ReportFormatQuerySchema = z.object({ format: ReportFormatSchema.default('csv') });

export const StudentReportQuerySchema = z.object({
  /** Which training to report on; defaults to the student's most recent batch. */
  enrollmentId: z.string().uuid().optional(),
});

// ─── Dashboards (F9: BRQ-9.1–9.3) ──────────────────────────────────────────────

export const AdminDashboardQuerySchema = z.object({
  /** Enrollment funnel for one cycle; defaults to all cycles. */
  cycleId: z.string().uuid().optional(),
});

export interface AdminDashboard {
  counts: {
    students: number;
    courses: number;
    trainers: number;
    batches: { PLANNED: number; ACTIVE: number; CLOSED: number };
  };
  enrollmentFunnel: Array<{ status: EnrollmentStatus; count: number }>;
  completion: {
    /** COMPLETED + CERTIFIED */
    completed: number;
    notCompleted: number;
    inTraining: number;
    /** completed ÷ (completed + not completed), two decimals; null until anyone finishes. */
    ratePercent: number | null;
  };
  /** Grades on valid certificates. */
  grades: Array<{ grade: Exclude<Grade, 'NOT_COMPLETED'>; count: number }>;
  /** Attendance % per week (institution time) over recent conducted sessions. */
  attendanceTrend: Array<{ weekStart: string; percent: number | null; marks: number }>;
  /** Setting attendance.minPercent, drawn as the trend's reference line. */
  minAttendancePercent: number;
  /**
   * L8: running batches whose end date has passed, oldest first: `undecided` students still
   * wait for a completion decision; at 0 the batch is ready to close.
   */
  endedBatches: EndedBatch[];
}

export interface EndedBatch {
  batchId: string;
  batchName: string;
  courseTitle: string;
  endDate: string;
  undecided: number;
}

export interface DashboardSession {
  id: string;
  batchId: string;
  batchName: string;
  courseTitle: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  topic: string | null;
  marked: number;
  rosterSize: number;
}

export interface TrainerDashboard {
  activeBatches: number;
  students: number;
  todaySessions: DashboardSession[];
  /** Started, not cancelled, and not every student marked yet (newest first). */
  pendingAttendance: DashboardSession[];
  minAttendancePercent: number;
  /** Students of my active batches below the attendance minimum, lowest first. */
  lowAttendance: Array<{
    batchId: string;
    batchName: string;
    courseTitle: string;
    studentId: string;
    rollNo: string;
    fullName: string;
    percent: number;
  }>;
}

export interface StudentDashboard {
  enrollment: {
    id: string;
    status: EnrollmentStatus;
    cycleName: string;
    reason: string | null;
  } | null;
  training: {
    enrollmentId: string;
    batchId: string;
    batchName: string;
    courseTitle: string;
    attendancePercent: number | null;
    minAttendancePercent: number;
    aggregate: number | null;
    projectedGrade: Grade | null;
  } | null;
  nextSession: {
    startsAt: string;
    endsAt: string;
    venue: string;
    topic: string | null;
  } | null;
  certificate: (CertificateSummary & { courseTitle: string }) | null;
}
