import { Prisma } from '@prisma/client';
import type {
  AssessmentCreateInput,
  AssessmentDto,
  AssessmentUpdateInput,
  EvaluationDto,
  EvaluationRow,
  EvaluationSaveInput,
  ProgressCreateInput,
  ProgressDto,
  ResultsSaveInput,
  ResultsSheet,
  Role,
  StudentResult,
} from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { trainerOwnsBatch } from '../../core/auth';
import { prisma } from '../../core/db';
import { batchEvents } from '../../core/events';
import { AppError } from '../../core/errors';
import { heldInsideBatch, resultPercent } from './rules';

interface Viewer extends Actor {
  userId: string;
  role: Role;
  trainerId: string | null;
}

const num = (d: Prisma.Decimal) => Number(d);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** L4: students who withdrew mid-training; their earlier marks stay but don't count here. */
const WITHDRAWN = { enrollment: { status: 'WITHDRAWN' } } as const;

const include = {
  _count: { select: { results: true } },
  results: { select: { studentId: true } },
  batch: {
    select: {
      _count: { select: { students: { where: { NOT: WITHDRAWN } } } },
      students: { where: WITHDRAWN, select: { studentId: true } },
    },
  },
} satisfies Prisma.AssessmentInclude;

type AssessmentRow = Prisma.AssessmentGetPayload<{ include: typeof include }>;

function toDto(a: AssessmentRow): AssessmentDto {
  const withdrawn = new Set(a.batch.students.map((m) => m.studentId));
  return {
    id: a.id,
    batchId: a.batchId,
    title: a.title,
    mode: a.mode,
    maxMarks: num(a.maxMarks),
    weightage: num(a.weightage),
    isMandatory: a.isMandatory,
    heldOn: day(a.heldOn),
    // Marks of the students still in the batch, against those students (L4).
    recorded: a.results.filter((r) => !withdrawn.has(r.studentId)).length,
    rosterSize: a.batch._count.students,
  };
}

async function load(id: string): Promise<AssessmentRow> {
  const a = await prisma().assessment.findUnique({ where: { id }, include });
  if (!a) throw AppError.notFound('Assessment not found');
  return a;
}

async function assertBatchOpen(batchId: string, requireActive = false) {
  const b = await prisma().batch.findUnique({
    where: { id: batchId },
    select: { status: true, startDate: true, endDate: true },
  });
  if (!b) throw AppError.notFound('Batch not found');
  if (b.status === 'CLOSED') throw AppError.conflict('BATCH_CLOSED', 'This batch is closed');
  if (requireActive && b.status !== 'ACTIVE') {
    throw AppError.conflict('BATCH_NOT_ACTIVE', 'Marks are recorded only for active batches');
  }
  return b;
}

function assertHeldInsideBatch(
  heldOn: string | null | undefined,
  b: { startDate: Date; endDate: Date },
): void {
  if (!heldOn) return;
  const batch = { start: day(b.startDate)!, end: day(b.endDate)! };
  if (!heldInsideBatch(heldOn, batch)) {
    throw AppError.unprocessable(
      'HELD_OUTSIDE_BATCH',
      `Choose a date between ${batch.start} and ${batch.end}, when the batch runs`,
      [{ path: 'heldOn', message: `${batch.start} – ${batch.end}` }],
    );
  }
}

// ─── Assessments (BRQ-6.1) ─────────────────────────────────────────────────────

export async function list(batchId: string): Promise<AssessmentDto[]> {
  const rows = await prisma().assessment.findMany({
    where: { batchId },
    include,
    orderBy: [{ heldOn: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDto);
}

export async function create(
  actor: Viewer,
  batchId: string,
  input: AssessmentCreateInput,
): Promise<AssessmentDto> {
  assertHeldInsideBatch(input.heldOn, await assertBatchOpen(batchId));
  return withAudit(actor, async (tx, log) => {
    const a = await tx.assessment.create({
      data: {
        batchId,
        title: input.title,
        mode: input.mode,
        maxMarks: new Prisma.Decimal(input.maxMarks),
        weightage: new Prisma.Decimal(input.weightage),
        isMandatory: input.isMandatory,
        heldOn: input.heldOn ? new Date(input.heldOn) : null,
        createdById: actor.userId,
      },
      include,
    });
    await log({
      action: 'ASSESSMENT_CREATED',
      entity: 'Assessment',
      entityId: a.id,
      newValue: toDto(a),
    });
    return toDto(a);
  });
}

export async function update(
  actor: Viewer,
  id: string,
  input: AssessmentUpdateInput,
): Promise<AssessmentDto> {
  const before = await load(id);
  assertHeldInsideBatch(input.heldOn, await assertBatchOpen(before.batchId));
  if (input.maxMarks !== undefined) {
    const top = await prisma().assessmentResult.aggregate({
      where: { assessmentId: id },
      _max: { marks: true },
    });
    if (top._max.marks && num(top._max.marks) > input.maxMarks) {
      throw AppError.conflict(
        'MAX_BELOW_RESULTS',
        `Maximum marks cannot be below a recorded result (${num(top._max.marks)})`,
      );
    }
  }
  return withAudit(actor, async (tx, log) => {
    const a = await tx.assessment.update({
      where: { id },
      data: {
        title: input.title,
        mode: input.mode,
        maxMarks: input.maxMarks !== undefined ? new Prisma.Decimal(input.maxMarks) : undefined,
        weightage: input.weightage !== undefined ? new Prisma.Decimal(input.weightage) : undefined,
        isMandatory: input.isMandatory,
        heldOn:
          input.heldOn === undefined ? undefined : input.heldOn ? new Date(input.heldOn) : null,
      },
      include,
    });
    await log({
      action: 'ASSESSMENT_UPDATED',
      entity: 'Assessment',
      entityId: id,
      oldValue: toDto(before),
      newValue: toDto(a),
    });
    return toDto(a);
  });
}

export async function remove(actor: Viewer, id: string): Promise<void> {
  const before = await load(id);
  if (before._count.results > 0) {
    throw AppError.conflict('HAS_RESULTS', 'An assessment with recorded marks cannot be deleted');
  }
  await withAudit(actor, async (tx, log) => {
    await tx.assessment.delete({ where: { id } });
    await log({
      action: 'ASSESSMENT_DELETED',
      entity: 'Assessment',
      entityId: id,
      oldValue: toDto(before),
    });
  });
}

// ─── Results (BRQ-6.2, BR-07) ──────────────────────────────────────────────────

/** Students who withdrew (L4) are left off mark entry. */
async function roster(batchId: string) {
  return prisma().batchStudent.findMany({
    where: { batchId, enrollment: { status: { not: 'WITHDRAWN' } } },
    orderBy: { student: { rollNo: 'asc' } },
    select: {
      studentId: true,
      student: { select: { rollNo: true, user: { select: { fullName: true } } } },
    },
  });
}

export async function resultsSheet(id: string): Promise<ResultsSheet> {
  const a = await load(id);
  const [members, results] = await Promise.all([
    roster(a.batchId),
    prisma().assessmentResult.findMany({ where: { assessmentId: id } }),
  ]);
  const byStudent = new Map(results.map((r) => [r.studentId, r]));
  return {
    assessment: toDto(a),
    rows: members.map((m) => ({
      studentId: m.studentId,
      rollNo: m.student.rollNo,
      fullName: m.student.user.fullName,
      marks: byStudent.has(m.studentId) ? num(byStudent.get(m.studentId)!.marks) : null,
      remarks: byStudent.get(m.studentId)?.remarks ?? null,
    })),
  };
}

/**
 * Records or corrects marks for any subset of the roster in one transaction. Every value must
 * be within 0..max (BR-07) — all problems are reported together as 422 MARKS_OUT_OF_RANGE and
 * nothing is saved. Each new or changed mark is audited with old/new (BR-12).
 */
export async function saveResults(
  actor: Viewer,
  id: string,
  input: ResultsSaveInput,
): Promise<ResultsSheet> {
  const a = await load(id);
  await assertBatchOpen(a.batchId, true);
  const max = num(a.maxMarks);
  const members = new Set((await roster(a.batchId)).map((m) => m.studentId));

  const notInBatch = input.results.filter((r) => !members.has(r.studentId));
  if (notInBatch.length) {
    throw AppError.unprocessable(
      'NOT_IN_BATCH',
      'Some students are not in this batch',
      notInBatch.map((r) => ({ path: r.studentId, message: 'Not in this batch' })),
    );
  }
  const outOfRange = input.results.filter((r) => r.marks < 0 || r.marks > max);
  if (outOfRange.length) {
    throw AppError.unprocessable(
      'MARKS_OUT_OF_RANGE',
      `Marks must be between 0 and ${max}`,
      outOfRange.map((r) => ({ path: r.studentId, message: `${r.marks} is outside 0–${max}` })),
    );
  }

  await withAudit(actor, async (tx, log) => {
    const existing = new Map(
      (await tx.assessmentResult.findMany({ where: { assessmentId: id } })).map((r) => [
        r.studentId,
        r,
      ]),
    );
    const entries = [];
    for (const r of input.results) {
      const old = existing.get(r.studentId);
      const remarks = r.remarks === undefined ? (old?.remarks ?? null) : r.remarks;
      if (old && num(old.marks) === r.marks && old.remarks === remarks) continue;
      if (old) {
        await tx.assessmentResult.update({
          where: { id: old.id },
          data: { marks: new Prisma.Decimal(r.marks), remarks, recordedById: actor.userId },
        });
      } else {
        await tx.assessmentResult.create({
          data: {
            assessmentId: id,
            studentId: r.studentId,
            marks: new Prisma.Decimal(r.marks),
            remarks,
            recordedById: actor.userId,
          },
        });
      }
      entries.push({
        action: old ? 'RESULT_UPDATED' : 'RESULT_RECORDED',
        entity: 'AssessmentResult',
        entityId: `${id}:${r.studentId}`,
        oldValue: old ? { marks: num(old.marks), remarks: old.remarks } : undefined,
        newValue: { assessmentId: id, studentId: r.studentId, marks: r.marks, remarks },
      });
    }
    await log.many(entries);
  });
  // F11: re-evaluate the batch's risk flags before responding (TAD §8.2 step 6).
  await batchEvents.dataChanged(a.batchId);
  return resultsSheet(id);
}

/** A student's results in one batch, for "My training" (their own marks only). */
export async function studentResults(batchId: string, studentId: string): Promise<StudentResult[]> {
  const rows = await prisma().assessment.findMany({
    where: { batchId },
    orderBy: [{ heldOn: 'asc' }, { createdAt: 'asc' }],
    include: { results: { where: { studentId } } },
  });
  return rows.map((a) => {
    const r = a.results[0];
    const max = num(a.maxMarks);
    return {
      assessmentId: a.id,
      title: a.title,
      mode: a.mode,
      maxMarks: max,
      weightage: num(a.weightage),
      isMandatory: a.isMandatory,
      heldOn: day(a.heldOn),
      marks: r ? num(r.marks) : null,
      percent: r ? resultPercent(num(r.marks), max) : null,
      remarks: r?.remarks ?? null,
    };
  });
}

/**
 * Every student's recorded results in one batch, oldest assessment first, in one query (F11
 * input). Students with nothing recorded are absent from the map.
 */
export async function batchScores(
  batchId: string,
): Promise<
  Map<string, Array<{ marks: number; maxMarks: number; weightage: number; percent: number }>>
> {
  const rows = await prisma().assessmentResult.findMany({
    where: { assessment: { batchId } },
    orderBy: [{ assessment: { heldOn: 'asc' } }, { assessment: { createdAt: 'asc' } }],
    select: {
      studentId: true,
      marks: true,
      assessment: { select: { maxMarks: true, weightage: true } },
    },
  });
  const byStudent = new Map<
    string,
    Array<{ marks: number; maxMarks: number; weightage: number; percent: number }>
  >();
  for (const r of rows) {
    const marks = num(r.marks);
    const maxMarks = num(r.assessment.maxMarks);
    const list = byStudent.get(r.studentId) ?? [];
    list.push({
      marks,
      maxMarks,
      weightage: num(r.assessment.weightage),
      percent: resultPercent(marks, maxMarks),
    });
    byStudent.set(r.studentId, list);
  }
  return byStudent;
}

/** Where a recorded result belongs (F18 evidence, ownership checks); null when unknown. */
export async function resultContext(resultId: string): Promise<{
  resultId: string;
  assessmentId: string;
  batchId: string;
  studentId: string;
  mode: AssessmentDto['mode'];
} | null> {
  const r = await prisma().assessmentResult.findUnique({
    where: { id: resultId },
    select: {
      id: true,
      studentId: true,
      assessment: { select: { id: true, batchId: true, mode: true } },
    },
  });
  return r
    ? {
        resultId: r.id,
        assessmentId: r.assessment.id,
        batchId: r.assessment.batchId,
        studentId: r.studentId,
        mode: r.assessment.mode,
      }
    : null;
}

/** Result ids of an assessment by student (F18 evidence sheet). */
export async function resultIds(assessmentId: string): Promise<Map<string, string>> {
  const rows = await prisma().assessmentResult.findMany({
    where: { assessmentId },
    select: { id: true, studentId: true },
  });
  return new Map(rows.map((r) => [r.studentId, r.id]));
}

// ─── Progress milestones (BRQ-6.3) ─────────────────────────────────────────────

export async function progress(batchId: string, studentId?: string): Promise<ProgressDto[]> {
  const rows = await prisma().progress.findMany({
    where: { batchId, ...(studentId ? { OR: [{ studentId }, { studentId: null }] } : {}) },
    orderBy: { recordedAt: 'desc' },
    include: {
      student: { select: { user: { select: { fullName: true } } } },
      recordedBy: { select: { fullName: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    studentId: p.studentId,
    studentName: p.student?.user.fullName ?? null,
    milestone: p.milestone,
    note: p.note,
    recordedBy: p.recordedBy.fullName,
    recordedAt: p.recordedAt.toISOString(),
  }));
}

export async function addProgress(
  actor: Viewer,
  batchId: string,
  input: ProgressCreateInput,
): Promise<ProgressDto> {
  await assertBatchOpen(batchId);
  if (input.studentId) {
    const member = await prisma().batchStudent.findUnique({
      where: { batchId_studentId: { batchId, studentId: input.studentId } },
    });
    if (!member) throw AppError.unprocessable('NOT_IN_BATCH', 'This student is not in the batch');
  }
  const id = await withAudit(actor, async (tx, log) => {
    const p = await tx.progress.create({
      data: {
        batchId,
        studentId: input.studentId ?? null,
        milestone: input.milestone,
        note: input.note ?? null,
        recordedById: actor.userId,
      },
    });
    await log({ action: 'PROGRESS_RECORDED', entity: 'Progress', entityId: p.id, newValue: p });
    return p.id;
  });
  return (await progress(batchId)).find((p) => p.id === id)!;
}

// ─── Final evaluation (BRQ-6.3, input to BR-09) ────────────────────────────────

function toEvaluation(
  e: Prisma.EvaluationGetPayload<{ include: { evaluatedBy: { select: { fullName: true } } } }>,
): EvaluationDto {
  return {
    enrollmentId: e.enrollmentId,
    remarks: e.remarks,
    recommended: e.recommended,
    evaluatedBy: e.evaluatedBy.fullName,
    evaluatedAt: e.updatedAt.toISOString(),
  };
}

export async function evaluations(batchId: string): Promise<EvaluationRow[]> {
  const members = await prisma().batchStudent.findMany({
    where: { batchId, enrollment: { status: { not: 'WITHDRAWN' } } },
    orderBy: { student: { rollNo: 'asc' } },
    select: {
      enrollmentId: true,
      studentId: true,
      student: { select: { rollNo: true, user: { select: { fullName: true } } } },
      enrollment: {
        select: { evaluation: { include: { evaluatedBy: { select: { fullName: true } } } } },
      },
    },
  });
  return members.map((m) => ({
    enrollmentId: m.enrollmentId,
    studentId: m.studentId,
    rollNo: m.student.rollNo,
    fullName: m.student.user.fullName,
    evaluation: m.enrollment.evaluation ? toEvaluation(m.enrollment.evaluation) : null,
  }));
}

export async function evaluationFor(enrollmentId: string): Promise<EvaluationDto | null> {
  const e = await prisma().evaluation.findUnique({
    where: { enrollmentId },
    include: { evaluatedBy: { select: { fullName: true } } },
  });
  return e ? toEvaluation(e) : null;
}

/** Only a trainer of the student's batch (BR-05), or an admin, evaluates; training must be active. */
export async function saveEvaluation(
  actor: Viewer,
  enrollmentId: string,
  input: EvaluationSaveInput,
): Promise<EvaluationDto> {
  const member = await prisma().batchStudent.findUnique({
    where: { enrollmentId },
    select: { batchId: true, enrollment: { select: { status: true } } },
  });
  if (!member)
    throw AppError.conflict('NOT_IN_BATCH', 'This student has not been placed in a batch');
  if (
    actor.role === 'TRAINER' &&
    !(actor.trainerId && (await trainerOwnsBatch(actor.trainerId, member.batchId)))
  ) {
    throw AppError.forbidden('Only a trainer of this batch can evaluate the student');
  }
  if (member.enrollment.status !== 'ACTIVE') {
    throw AppError.conflict(
      'NOT_IN_TRAINING',
      'Evaluations are recorded while the student is in training',
    );
  }
  return withAudit(actor, async (tx, log) => {
    const before = await tx.evaluation.findUnique({ where: { enrollmentId } });
    const e = await tx.evaluation.upsert({
      where: { enrollmentId },
      create: {
        enrollmentId,
        remarks: input.remarks,
        recommended: input.recommended,
        evaluatedById: actor.userId,
      },
      update: {
        remarks: input.remarks,
        recommended: input.recommended,
        evaluatedById: actor.userId,
      },
      include: { evaluatedBy: { select: { fullName: true } } },
    });
    await log({
      action: before ? 'EVALUATION_UPDATED' : 'EVALUATION_RECORDED',
      entity: 'Evaluation',
      entityId: enrollmentId,
      oldValue: before ? { remarks: before.remarks, recommended: before.recommended } : undefined,
      newValue: input,
    });
    return toEvaluation(e);
  });
}

/** Every assessment in any batch of a course (the competency editor links them, BRQ-C.1). */
export async function ofCourse(courseId: string): Promise<
  Array<{
    id: string;
    title: string;
    mode: AssessmentDto['mode'];
    batchId: string;
    batchName: string;
  }>
> {
  const rows = await prisma().assessment.findMany({
    where: { batch: { courseId } },
    orderBy: [{ batch: { startDate: 'desc' } }, { createdAt: 'asc' }],
    select: { id: true, title: true, mode: true, batchId: true, batch: { select: { name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    mode: a.mode,
    batchId: a.batchId,
    batchName: a.batch.name,
  }));
}
