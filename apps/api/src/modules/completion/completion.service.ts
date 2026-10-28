import type {
  ApproveResult,
  CertificateSummary,
  CompletionRow,
  EnrollmentStatus,
  Grade,
} from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { AppError } from '../../core/errors';
import { logger } from '../../core/logger';
import { settings } from '../../core/settings';
import * as assessments from '../assessments/assessments.service';
import { gradeBand, weightedAggregate } from '../assessments/rules';
import * as attendance from '../attendance/attendance.service';
import * as batches from '../batches/batches.service';
import * as documents from '../documents/documents.service';
import * as enrollments from '../enrollments/enrollments.service';
import { eligibility, type CompletionFacts } from './rules';

/** Applications that have reached the end of training, or are in it. */
const IN_QUEUE: readonly EnrollmentStatus[] = ['ACTIVE', 'COMPLETED', 'NOT_COMPLETED', 'CERTIFIED'];
/** Statuses an admin may approve from (a NOT_COMPLETED decision can be revisited). */
const APPROVABLE: readonly EnrollmentStatus[] = ['ACTIVE', 'NOT_COMPLETED'];

interface Assessed {
  facts: CompletionFacts;
  grade: Grade | null;
}

/** Live facts for BR-09, computed on read from attendance, results and the evaluation. */
async function assess(batchId: string, studentId: string, enrollmentId: string): Promise<Assessed> {
  const [figures, results, evaluation, bands] = await Promise.all([
    attendance.studentFigures(batchId, studentId),
    assessments.studentResults(batchId, studentId),
    assessments.evaluationFor(enrollmentId),
    settings.get('grade.bands'),
  ]);
  const recorded = results.filter((r) => r.marks !== null);
  const aggregate = weightedAggregate(
    recorded.map((r) => ({ marks: r.marks!, maxMarks: r.maxMarks, weightage: r.weightage })),
  );
  const mandatory = results.filter((r) => r.isMandatory);
  return {
    facts: {
      attendancePercent: figures.percent,
      unrecordedSessions: figures.unrecorded,
      mandatoryTotal: mandatory.length,
      mandatoryRecorded: mandatory.filter((r) => r.marks !== null).length,
      mandatoryMissing: mandatory.filter((r) => r.marks === null).map((r) => r.title),
      aggregate,
      recommended: evaluation ? evaluation.recommended : null,
    },
    grade: aggregate === null ? null : gradeBand(aggregate, bands),
  };
}

async function thresholds() {
  const [minAttendancePercent, minAggregatePercent] = await Promise.all([
    settings.get('attendance.minPercent'),
    settings.get('aggregate.minPercent'),
  ]);
  return { minAttendancePercent, minAggregatePercent };
}

/** BRQ-9.4: every student of the batch with the system's eligibility result and reasons. */
export async function queue(batchId: string): Promise<CompletionRow[]> {
  const batch = await batches.detail(batchId, 'ADMIN');
  const roster = (batch.roster ?? []).filter((r) =>
    IN_QUEUE.includes(r.enrollmentStatus as EnrollmentStatus),
  );
  const ids = roster.map((r) => r.enrollmentId);
  const [t, statuses, certificates] = await Promise.all([
    thresholds(),
    enrollments.statusesOf(ids),
    documents.validFor(ids),
  ]);
  return Promise.all(
    roster.map(async (r) => {
      const a = await assess(batchId, r.studentId, r.enrollmentId);
      const s = statuses.get(r.enrollmentId);
      return {
        enrollmentId: r.enrollmentId,
        studentId: r.studentId,
        rollNo: r.rollNo,
        fullName: r.fullName,
        status: s?.status ?? (r.enrollmentStatus as EnrollmentStatus),
        reason: s?.reason ?? null,
        attendancePercent: a.facts.attendancePercent,
        aggregate: a.facts.aggregate,
        grade: a.grade,
        certificate: certificates.get(r.enrollmentId) ?? null,
        ...eligibility(a.facts, t),
      };
    }),
  );
}

async function loadForDecision(enrollmentId: string) {
  const [facts, placement] = await Promise.all([
    enrollments.placementFacts(enrollmentId),
    batches.placementOf(enrollmentId),
  ]);
  if (!facts) throw AppError.notFound('Application not found');
  if (!placement) {
    throw AppError.conflict('NOT_IN_TRAINING', 'This student is not placed in a batch');
  }
  return { facts, placement };
}

function notInTraining(status: EnrollmentStatus) {
  if (status === 'COMPLETED' || status === 'CERTIFIED') {
    return AppError.conflict('ALREADY_COMPLETED', 'This student has already completed');
  }
  return AppError.conflict('NOT_IN_TRAINING', 'This student is not in training');
}

/**
 * TAD §8.1: recompute eligibility (BR-09) → 409 NOT_ELIGIBLE with the failing checks, nothing
 * saved → in ONE transaction the enrollment becomes COMPLETED and the certificate row is created
 * with its snapshots, both audited → after commit, render and store the PDF and set CERTIFIED.
 * If rendering fails the student stays COMPLETED and the admin can retry (UC-04 4a).
 */
export async function approve(actor: Actor, enrollmentId: string): Promise<ApproveResult> {
  const { facts, placement } = await loadForDecision(enrollmentId);
  if (!APPROVABLE.includes(facts.status)) throw notInTraining(facts.status);

  const [a, t] = await Promise.all([
    assess(placement.batch.id, placement.studentId, enrollmentId),
    thresholds(),
  ]);
  const result = eligibility(a.facts, t);
  // A grade below band D can't be certified even if the aggregate setting were set lower.
  if (!result.eligible || !a.grade || a.grade === 'NOT_COMPLETED') {
    throw AppError.conflict(
      'NOT_ELIGIBLE',
      'This student does not meet the completion rules',
      result.checks
        .filter((c) => !c.passed)
        .map((c) => ({ path: c.rule, message: `${String(c.actual)} / ${String(c.required)}` })),
    );
  }
  const grade = a.grade;

  const certificate = await withAudit(actor, async (tx, log) => {
    await enrollments.changeStatuses(tx, log, [
      {
        enrollmentId,
        from: [facts.status],
        to: 'COMPLETED',
        reason: null,
        notify: {
          userId: facts.userId,
          type: 'TRAINING_COMPLETED',
          title: 'Training completed',
          body: `${placement.batch.courseTitle}: grade ${grade}`,
          data: { courseTitle: placement.batch.courseTitle, grade },
        },
      },
    ]);
    return documents.createCertificate(tx, log, {
      enrollmentId,
      grade,
      aggregatePercent: a.facts.aggregate!,
      attendancePercent: a.facts.attendancePercent!,
      issuedById: actor.userId!,
    });
  });

  const rendered = await tryRender(actor, enrollmentId, certificate);
  return {
    enrollmentId,
    status: rendered.rendered ? 'CERTIFIED' : 'COMPLETED',
    certificate: rendered,
  };
}

/** Render, store, then COMPLETED → CERTIFIED. Failures are logged and leave COMPLETED. */
async function tryRender(
  actor: Actor,
  enrollmentId: string,
  certificate: CertificateSummary,
): Promise<CertificateSummary> {
  try {
    const rendered = certificate.rendered
      ? certificate
      : await documents.renderAndStore(actor, certificate.id);
    await certify(actor, enrollmentId, rendered);
    return rendered;
  } catch (err) {
    logger.error(
      { err, certificateId: certificate.id },
      'Certificate rendering failed; enrollment stays COMPLETED',
    );
    return certificate;
  }
}

async function certify(actor: Actor, enrollmentId: string, c: CertificateSummary) {
  const facts = await enrollments.placementFacts(enrollmentId);
  if (!facts || facts.status !== 'COMPLETED') return;
  await withAudit(actor, (tx, log) =>
    enrollments.changeStatuses(tx, log, [
      {
        enrollmentId,
        from: ['COMPLETED'],
        to: 'CERTIFIED',
        notify: {
          userId: facts.userId,
          type: 'CERTIFICATE_ISSUED',
          title: 'Your certificate is ready',
          body: `Certificate ${c.publicCode}`,
          data: { publicCode: c.publicCode },
        },
      },
    ]),
  );
}

/**
 * Retry after a failed render (TAD §8.1 step 6). Safe to repeat: an already rendered and
 * certified certificate is returned as it is.
 */
export async function retryRender(actor: Actor, certificateId: string): Promise<ApproveResult> {
  const enrollmentId = await documents.enrollmentOf(certificateId);
  if (!enrollmentId) throw AppError.notFound('Certificate not found');
  const current = await documents.get(certificateId);
  if (current.status !== 'VALID') {
    throw AppError.conflict('CERTIFICATE_NOT_VALID', 'Only a valid certificate can be rendered');
  }
  // Unlike approve, a failure here is reported to the admin who asked for the retry.
  const rendered = current.rendered
    ? current
    : await documents.renderAndStore(actor, certificateId);
  await certify(actor, enrollmentId, rendered);
  const facts = await enrollments.placementFacts(enrollmentId);
  return {
    enrollmentId,
    status: facts!.status,
    certificate: {
      id: rendered.id,
      publicCode: rendered.publicCode,
      status: rendered.status,
      issuedAt: rendered.issuedAt,
      rendered: rendered.rendered,
    },
  };
}

/** A student who does not meet the rules is closed as NOT_COMPLETED with a reason (BR-12). */
export async function markNotCompleted(
  actor: Actor,
  enrollmentId: string,
  reason: string,
): Promise<{ enrollmentId: string; status: EnrollmentStatus; reason: string }> {
  const { facts, placement } = await loadForDecision(enrollmentId);
  if (facts.status !== 'ACTIVE') throw notInTraining(facts.status);
  await withAudit(actor, (tx, log) =>
    enrollments.changeStatuses(tx, log, [
      {
        enrollmentId,
        from: ['ACTIVE'],
        to: 'NOT_COMPLETED',
        reason,
        notify: {
          userId: facts.userId,
          type: 'TRAINING_NOT_COMPLETED',
          title: 'Training not completed',
          body: `${placement.batch.courseTitle}: ${reason}`,
          data: { courseTitle: placement.batch.courseTitle, reason },
        },
      },
    ]),
  );
  return { enrollmentId, status: 'NOT_COMPLETED', reason };
}
