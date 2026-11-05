import { z } from 'zod';

/**
 * Every status value in the domain. The `as const` object is the runtime value,
 * the type of the same name is its union, and the Zod schema validates input.
 */
function defineEnum<const T extends readonly [string, ...string[]]>(values: T) {
  const obj = Object.fromEntries(values.map((v) => [v, v])) as { readonly [K in T[number]]: K };
  return { values, obj, schema: z.enum(values) };
}

const role = defineEnum(['STUDENT', 'TRAINER', 'ADMIN']);
export const Role = role.obj;
export type Role = (typeof role.values)[number];
export const RoleSchema = role.schema;
export const ROLES = role.values;

const locale = defineEnum(['en', 'or', 'hi']);
export const Locale = locale.obj;
export type Locale = (typeof locale.values)[number];
export const LocaleSchema = locale.schema;
export const LOCALES = locale.values;
export const DEFAULT_LOCALE: Locale = 'en';

const enrollmentStatus = defineEnum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WAITLISTED',
  'ALLOCATED',
  'ACTIVE',
  'COMPLETED',
  'NOT_COMPLETED',
  'CERTIFIED',
  'WITHDRAWN',
]);
export const EnrollmentStatus = enrollmentStatus.obj;
export type EnrollmentStatus = (typeof enrollmentStatus.values)[number];
export const EnrollmentStatusSchema = enrollmentStatus.schema;
export const ENROLLMENT_STATUSES = enrollmentStatus.values;
/** Statuses that do not count as an active enrollment for BR-01. */
export const INACTIVE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  'REJECTED',
  'NOT_COMPLETED',
  'WITHDRAWN',
];

const batchStatus = defineEnum(['PLANNED', 'ACTIVE', 'CLOSED']);
export const BatchStatus = batchStatus.obj;
export type BatchStatus = (typeof batchStatus.values)[number];
export const BatchStatusSchema = batchStatus.schema;
export const BATCH_STATUSES = batchStatus.values;

const sessionStatus = defineEnum(['SCHEDULED', 'CONDUCTED', 'CANCELLED']);
export const SessionStatus = sessionStatus.obj;
export type SessionStatus = (typeof sessionStatus.values)[number];
export const SessionStatusSchema = sessionStatus.schema;

const attendanceStatus = defineEnum(['PRESENT', 'ABSENT', 'LATE']);
export const AttendanceStatus = attendanceStatus.obj;
export type AttendanceStatus = (typeof attendanceStatus.values)[number];
export const AttendanceStatusSchema = attendanceStatus.schema;

const assessmentMode = defineEnum(['THEORY', 'PRACTICAL']);
export const AssessmentMode = assessmentMode.obj;
export type AssessmentMode = (typeof assessmentMode.values)[number];
export const AssessmentModeSchema = assessmentMode.schema;

const certificateStatus = defineEnum(['VALID', 'REVOKED', 'SUPERSEDED']);
export const CertificateStatus = certificateStatus.obj;
export type CertificateStatus = (typeof certificateStatus.values)[number];
export const CertificateStatusSchema = certificateStatus.schema;
export const CERTIFICATE_STATUSES = certificateStatus.values;

const riskLevel = defineEnum(['LOW', 'MEDIUM', 'HIGH']);
export const RiskLevel = riskLevel.obj;
export type RiskLevel = (typeof riskLevel.values)[number];
export const RiskLevelSchema = riskLevel.schema;
export const RISK_LEVELS = riskLevel.values;

const grade = defineEnum(['A', 'B', 'C', 'D', 'NOT_COMPLETED']);
export const Grade = grade.obj;
export type Grade = (typeof grade.values)[number];
export const GradeSchema = grade.schema;

const interventionActionType = defineEnum(['COUNSELLING', 'EXTRA_SESSION', 'PRACTICE_TASK']);
export const InterventionActionType = interventionActionType.obj;
export type InterventionActionType = (typeof interventionActionType.values)[number];
export const InterventionActionTypeSchema = interventionActionType.schema;
export const INTERVENTION_ACTION_TYPES = interventionActionType.values;

const learningResourceType = defineEnum(['VIDEO', 'DOCUMENT', 'PRACTICE_TASK', 'REMEDIAL_SESSION']);
export const LearningResourceType = learningResourceType.obj;
export type LearningResourceType = (typeof learningResourceType.values)[number];
export const LearningResourceTypeSchema = learningResourceType.schema;
export const LEARNING_RESOURCE_TYPES = learningResourceType.values;

/** Vocational training is open to everyone: seats go by preference, then by who applied first. */
const allocationPriorityRule = defineEnum(['SUBMISSION_TIME']);
export const AllocationPriorityRule = allocationPriorityRule.obj;
export type AllocationPriorityRule = (typeof allocationPriorityRule.values)[number];
export const AllocationPriorityRuleSchema = allocationPriorityRule.schema;

const opportunityType = defineEnum(['INTERNSHIP', 'APPRENTICESHIP', 'JOB']);
export const OpportunityType = opportunityType.obj;
export type OpportunityType = (typeof opportunityType.values)[number];
export const OpportunityTypeSchema = opportunityType.schema;
