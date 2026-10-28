import type { Prisma } from '@prisma/client';
import type {
  CertificateDto,
  CertificateListQuery,
  CertificateSummary,
  Grade,
  Paginated,
  PublicVerification,
} from '@vtmp/shared';
import { withAudit, type Actor, type AuditFn } from '../../core/audit';
import { config } from '../../core/config';
import { prisma, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { paginated, type PageRequest } from '../../core/http';
import { settings } from '../../core/settings';
import { storage } from '../../core/storage';
import * as batches from '../batches/batches.service';
import * as enrollments from '../enrollments/enrollments.service';
import { renderCertificate } from './certificate.pdf';
import { publicCode } from './code';

const num = (d: Prisma.Decimal) => Number(d);

const certificateInclude = {
  issuedBy: { select: { fullName: true } },
  enrollment: {
    select: {
      cycle: { select: { name: true } },
      student: { select: { rollNo: true, user: { select: { fullName: true } } } },
      batchMembership: {
        select: { batch: { select: { name: true, course: { select: { title: true } } } } },
      },
    },
  },
} satisfies Prisma.CertificateInclude;
type CertificateRow = Prisma.CertificateGetPayload<{ include: typeof certificateInclude }>;

function toSummary(c: {
  id: string;
  publicCode: string;
  status: CertificateSummary['status'];
  issuedAt: Date;
  pdfObjectKey: string | null;
}): CertificateSummary {
  return {
    id: c.id,
    publicCode: c.publicCode,
    status: c.status,
    issuedAt: c.issuedAt.toISOString(),
    rendered: c.pdfObjectKey !== null,
  };
}

function toDto(c: CertificateRow): CertificateDto {
  const batch = c.enrollment.batchMembership?.batch;
  return {
    ...toSummary(c),
    enrollmentId: c.enrollmentId,
    studentName: c.enrollment.student.user.fullName,
    rollNo: c.enrollment.student.rollNo,
    courseTitle: batch?.course.title ?? '',
    batchName: batch?.name ?? '',
    cycleName: c.enrollment.cycle.name,
    grade: c.grade,
    aggregatePercent: num(c.aggregatePercent),
    attendancePercent: num(c.attendancePercent),
    issuedBy: c.issuedBy.fullName,
    canReissue: canReissue(c),
  };
}

/** BR-19: a valid certificate, or a revoked one nobody has replaced yet, may be reissued. */
function canReissue(c: { status: string; supersededById: string | null }): boolean {
  return c.status === 'VALID' || (c.status === 'REVOKED' && c.supersededById === null);
}

export interface NewCertificate {
  enrollmentId: string;
  grade: Exclude<Grade, 'NOT_COMPLETED'>;
  aggregatePercent: number;
  attendancePercent: number;
  issuedById: string;
}

/**
 * Creates the certificate record inside the caller's transaction (TAD §8.1 step 4): a random
 * public code (BR-10, BR-19) and snapshots of grade, aggregate and attendance at approval. The
 * database allows one VALID certificate per enrollment, so a concurrent second approval fails.
 */
export async function createCertificate(
  tx: Tx,
  log: AuditFn,
  input: NewCertificate,
): Promise<CertificateSummary> {
  const c = await tx.certificate.create({
    data: {
      enrollmentId: input.enrollmentId,
      publicCode: publicCode(),
      grade: input.grade,
      aggregatePercent: input.aggregatePercent,
      attendancePercent: input.attendancePercent,
      issuedById: input.issuedById,
    },
  });
  await log({
    action: 'CERTIFICATE_ISSUED',
    entity: 'Certificate',
    entityId: c.id,
    newValue: {
      enrollmentId: c.enrollmentId,
      publicCode: c.publicCode,
      grade: c.grade,
      aggregatePercent: input.aggregatePercent,
      attendancePercent: input.attendancePercent,
    },
  });
  return toSummary(c);
}

const objectKey = (id: string) => `certificates/${id}.pdf`;

/**
 * TAD §8.1 step 5: renders the PDF (with the QR of the verification URL), stores it and
 * records the object key. Throws on any failure; the caller keeps the enrollment COMPLETED so
 * the admin can retry. Rendering the same certificate again overwrites the same object.
 */
export async function renderAndStore(
  actor: Actor,
  certificateId: string,
): Promise<CertificateSummary> {
  const c = await prisma().certificate.findUnique({ where: { id: certificateId } });
  if (!c) throw AppError.notFound('Certificate not found');
  const [facts, placement, institution] = await Promise.all([
    enrollments.placementFacts(c.enrollmentId),
    batches.placementOf(c.enrollmentId),
    settings.get('institution.name'),
  ]);
  if (!facts || !placement) throw AppError.conflict('NOT_IN_TRAINING', 'No batch placement');

  const pdf = await renderCertificate({
    institution,
    studentName: facts.fullName,
    nameOdia: facts.nameOdia,
    rollNo: facts.rollNo,
    courseTitle: placement.batch.courseTitle,
    batchName: placement.batch.name,
    startDate: placement.batch.startDate,
    endDate: placement.batch.endDate,
    grade: c.grade,
    aggregatePercent: num(c.aggregatePercent),
    attendancePercent: num(c.attendancePercent),
    issuedAt: c.issuedAt,
    publicCode: c.publicCode,
    verifyUrl: `${config().PUBLIC_BASE_URL.replace(/\/$/, '')}/verify/${c.publicCode}`,
  });
  const key = objectKey(c.id);
  await storage().put(key, pdf, 'application/pdf');

  return withAudit(actor, async (tx, log) => {
    const updated = await tx.certificate.update({
      where: { id: c.id },
      data: { pdfObjectKey: key },
    });
    await log({
      action: 'CERTIFICATE_RENDERED',
      entity: 'Certificate',
      entityId: c.id,
      oldValue: { pdfObjectKey: c.pdfObjectKey },
      newValue: { pdfObjectKey: key, bytes: pdf.length },
    });
    return toSummary(updated);
  });
}

/** The stored PDF, for the owner student or an admin (ownership is checked by the route). */
export async function download(certificateId: string): Promise<{ pdf: Buffer; filename: string }> {
  const c = await prisma().certificate.findUnique({ where: { id: certificateId } });
  if (!c) throw AppError.notFound('Certificate not found');
  if (!c.pdfObjectKey) {
    throw AppError.conflict('CERTIFICATE_NOT_RENDERED', 'The certificate PDF is not ready yet');
  }
  const pdf = await storage().get(c.pdfObjectKey);
  if (!pdf) {
    throw AppError.conflict('CERTIFICATE_NOT_RENDERED', 'The certificate PDF is not ready yet');
  }
  return { pdf, filename: `certificate-${c.publicCode}.pdf` };
}

export async function get(certificateId: string): Promise<CertificateDto> {
  const c = await prisma().certificate.findUnique({
    where: { id: certificateId },
    include: certificateInclude,
  });
  if (!c) throw AppError.notFound('Certificate not found');
  return toDto(c);
}

/** BRQ-7.3: register of every certificate issued, newest first, searchable. */
export async function list(
  query: CertificateListQuery,
  page: PageRequest,
): Promise<Paginated<CertificateDto>> {
  const q = query.q?.trim();
  const where: Prisma.CertificateWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(q
      ? {
          OR: [
            { publicCode: { contains: q.toUpperCase() } },
            { enrollment: { student: { rollNo: { contains: q, mode: 'insensitive' } } } },
            {
              enrollment: {
                student: { user: { fullName: { contains: q, mode: 'insensitive' } } },
              },
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma().certificate.findMany({
      where,
      include: certificateInclude,
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma().certificate.count({ where }),
  ]);
  return paginated(rows.map(toDto), total, page);
}

/** A student's certificates, newest first (their dashboard and enrollment page). */
export async function forStudent(studentId: string): Promise<CertificateDto[]> {
  const rows = await prisma().certificate.findMany({
    where: { enrollment: { studentId } },
    include: certificateInclude,
    orderBy: { issuedAt: 'desc' },
  });
  return rows.map(toDto);
}

/** The current VALID certificate of each application, if any (completion queue). */
export async function validFor(enrollmentIds: string[]): Promise<Map<string, CertificateSummary>> {
  const rows = await prisma().certificate.findMany({
    where: { enrollmentId: { in: enrollmentIds }, status: 'VALID' },
  });
  return new Map(rows.map((c) => [c.enrollmentId, toSummary(c)]));
}

/** The enrollment a certificate belongs to (completion retry). */
export async function enrollmentOf(certificateId: string): Promise<string | null> {
  const c = await prisma().certificate.findUnique({
    where: { id: certificateId },
    select: { enrollmentId: true },
  });
  return c?.enrollmentId ?? null;
}

/** Grades on valid certificates, optionally for one course (dashboard, course report). */
export async function gradeDistribution(courseId?: string): Promise<Map<string, number>> {
  const rows = await prisma().certificate.groupBy({
    by: ['grade'],
    where: {
      status: 'VALID',
      ...(courseId ? { enrollment: { batchMembership: { batch: { courseId } } } } : {}),
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.grade, r._count._all]));
}

// ─── Reports (F8, BRD §12.2) ───────────────────────────────────────────────────

export { renderStudentReport, renderTableReport } from './reports.pdf';
export { pdfDay } from './pdf';
export { renderPassport } from './passport.pdf';
export type { StudentReportContent, TableReportContent } from './reports.pdf';

/**
 * Keeps the figures a student report was generated from (BRQ-8.1, rule 9: report snapshots
 * are stored, live figures are not). The PDF itself is re-generated on request.
 */
export async function savePerformanceReport(
  actor: Actor,
  enrollmentId: string,
  snapshot: unknown,
): Promise<string> {
  return withAudit(actor, async (tx, log) => {
    const r = await tx.performanceReport.create({
      data: {
        enrollmentId,
        snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        generatedById: actor.userId!,
      },
    });
    await log({
      action: 'PERFORMANCE_REPORT_GENERATED',
      entity: 'PerformanceReport',
      entityId: r.id,
      newValue: { enrollmentId },
    });
    return r.id;
  });
}

/** Grades on valid certificates of one batch (course report). */
export async function batchGrades(batchId: string): Promise<Map<string, number>> {
  const rows = await prisma().certificate.groupBy({
    by: ['grade'],
    where: { status: 'VALID', enrollment: { batchMembership: { batchId } } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.grade, r._count._all]));
}

// ─── Revoke, reissue, public verification (F15: BRQ-15.2–15.5, BR-19) ─────────

/** BRQ-15.4: a valid certificate becomes REVOKED at once; it stays on record (BR-19). */
export async function revokeCertificate(
  actor: Actor,
  id: string,
  reason: string,
): Promise<CertificateDto> {
  const c = await prisma().certificate.findUnique({ where: { id } });
  if (!c) throw AppError.notFound('Certificate not found');
  if (c.status !== 'VALID') {
    throw AppError.conflict('CERTIFICATE_NOT_VALID', 'Only a valid certificate can be revoked');
  }
  await withAudit(actor, async (tx, log) => {
    const updated = await tx.certificate.updateMany({
      where: { id, status: 'VALID' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
    });
    if (updated.count !== 1) {
      throw AppError.conflict('CERTIFICATE_NOT_VALID', 'Only a valid certificate can be revoked');
    }
    await log({
      action: 'CERTIFICATE_REVOKED',
      entity: 'Certificate',
      entityId: id,
      oldValue: { status: 'VALID' },
      newValue: { status: 'REVOKED', reason },
    });
  });
  return get(id);
}

const notReissuable = () =>
  AppError.conflict(
    'CERTIFICATE_NOT_REISSUABLE',
    'Only a valid certificate, or a revoked one not yet replaced, can be reissued',
  );

/**
 * BR-19: reissue creates a new certificate with a new random code and the same snapshots, and
 * links the old one to it. A valid old one becomes SUPERSEDED. A revoked one stays REVOKED (its
 * code keeps showing as revoked), so a certificate revoked by mistake or to correct it can be
 * replaced. The enrollment stays CERTIFIED. The new PDF is rendered after commit; if that
 * fails, the admin retries as after an approval.
 */
export async function reissueCertificate(actor: Actor, id: string): Promise<CertificateDto> {
  const old = await prisma().certificate.findUnique({ where: { id } });
  if (!old) throw AppError.notFound('Certificate not found');
  if (!canReissue(old)) throw notReissuable();
  const fromRevoked = old.status === 'REVOKED';
  const fresh = await withAudit(actor, async (tx, log) => {
    // A valid one frees the one-VALID-per-enrollment slot first (a revoked one never held it).
    if (!fromRevoked) {
      const moved = await tx.certificate.updateMany({
        where: { id, status: 'VALID' },
        data: { status: 'SUPERSEDED' },
      });
      if (moved.count !== 1) throw notReissuable();
    }
    const created = await tx.certificate.create({
      data: {
        enrollmentId: old.enrollmentId,
        publicCode: publicCode(),
        grade: old.grade,
        aggregatePercent: old.aggregatePercent,
        attendancePercent: old.attendancePercent,
        issuedById: actor.userId!,
      },
    });
    // Guarded link: a revoked one that a concurrent reissue already replaced rolls this back.
    const linked = await tx.certificate.updateMany({
      where: { id, supersededById: null },
      data: { supersededById: created.id },
    });
    if (linked.count !== 1) throw notReissuable();
    await log.many([
      {
        action: fromRevoked ? 'CERTIFICATE_REPLACED' : 'CERTIFICATE_SUPERSEDED',
        entity: 'Certificate',
        entityId: id,
        oldValue: { status: old.status },
        newValue: { status: fromRevoked ? 'REVOKED' : 'SUPERSEDED', supersededById: created.id },
      },
      {
        action: 'CERTIFICATE_ISSUED',
        entity: 'Certificate',
        entityId: created.id,
        newValue: { enrollmentId: old.enrollmentId, publicCode: created.publicCode, reissueOf: id },
      },
    ]);
    return created;
  });
  try {
    await renderAndStore(actor, fresh.id);
  } catch {
    // Left unrendered; POST /certificates/:id/render retries (UC-04 4a).
  }
  return get(fresh.id);
}

/**
 * BRQ-15.3, BR-15: what anyone may see about a certificate code — name, course, grade, issue
 * date, status, and for a revoked one the date (never the reason). Null when unknown.
 */
export async function publicVerification(code: string): Promise<PublicVerification | null> {
  const c = await prisma().certificate.findUnique({
    where: { publicCode: code.trim().toUpperCase() },
    include: certificateInclude,
  });
  if (!c) return null;
  return {
    name: c.enrollment.student.user.fullName,
    course: c.enrollment.batchMembership?.batch.course.title ?? '',
    grade: c.grade,
    issueDate: c.issuedAt.toISOString().slice(0, 10),
    status: c.status,
    revokedOn:
      c.status === 'REVOKED' && c.revokedAt ? c.revokedAt.toISOString().slice(0, 10) : null,
  };
}

/** BRQ-15.5: counts lookups of a known code. Callers don't wait for it. */
export async function recordVerification(code: string): Promise<void> {
  await prisma().certificate.updateMany({
    where: { publicCode: code.trim().toUpperCase() },
    data: { verificationCount: { increment: 1 } },
  });
}

/** D7: certificates issued after a moment (every certificate when it is null). */
export async function issuedSince(since: Date | null): Promise<number> {
  return prisma().certificate.count({ where: since ? { issuedAt: { gt: since } } : {} });
}
