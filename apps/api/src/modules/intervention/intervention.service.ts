import type { Prisma } from '@prisma/client';
import type {
  ActionCreateInput,
  ActionUpdateInput,
  InterventionActionDto,
  MyRiskFlag,
  Paginated,
  RiskEvaluationSummary,
  RiskFlagDetail,
  RiskFlagQuery,
  RiskFlagRow,
  RiskReason,
  RiskTimelineEvent,
  Role,
} from '@vtmp/shared';
import { audit, withAudit, type Actor } from '../../core/audit';
import { prisma } from '../../core/db';
import { AppError } from '../../core/errors';
import { paginated } from '../../core/http';
import { withJobLease } from '../../core/jobs';
import { settings } from '../../core/settings';
import * as assessments from '../assessments/assessments.service';
import { weightedAggregate } from '../assessments/rules';
import * as attendance from '../attendance/attendance.service';
import * as batches from '../batches/batches.service';
import * as competency from '../competency/competency.service';
import { notify, type NewNotification } from '../notifications/notifications.service';
import * as users from '../users/users.service';
import {
  flagStep,
  inTraining,
  riskLevel,
  runOrder,
  shouldEscalate,
  type RiskFacts,
  type RiskThresholds,
} from './rules';

interface Viewer extends Actor {
  userId: string;
  role: Role;
  trainerId: string | null;
}

type FlagRow = Prisma.RiskFlagGetPayload<object>;
type ActionRow = Prisma.InterventionActionGetPayload<object>;

const JOB = 'risk-evaluation';
/** Longer than any run can take (the function stops at 30 s); frees a crashed run's lease. */
const LEASE_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

const reasonsOf = (flag: { reasons: Prisma.JsonValue }) =>
  (flag.reasons ?? []) as unknown as RiskReason[];
const iso = (d: Date | null) => d?.toISOString() ?? null;
const day = (d: Date) => d.toISOString().slice(0, 10);

async function thresholds(): Promise<RiskThresholds> {
  const [mA, mC, mS, hA, hP, hD] = await Promise.all([
    settings.get('risk.medium.attendanceBelow'),
    settings.get('risk.medium.consecutiveAbsences'),
    settings.get('risk.medium.assessmentBelow'),
    settings.get('risk.high.attendanceBelow'),
    settings.get('risk.high.projectedBelow'),
    settings.get('risk.high.dropPoints'),
  ]);
  return {
    mediumAttendanceBelow: mA,
    mediumConsecutiveAbsences: mC,
    mediumAssessmentBelow: mS,
    highAttendanceBelow: hA,
    highProjectedBelow: hP,
    highDropPoints: hD,
  };
}

/**
 * TAD §8.2 step 2: the facts for every student in one batch, from set-based queries in the
 * attendance, assessments and competency services (one per source, not one per student).
 */
async function gatherFacts(batchId: string): Promise<Map<string, RiskFacts>> {
  const [att, scores, gaps] = await Promise.all([
    attendance.batchSummary(batchId),
    assessments.batchScores(batchId),
    competency.mandatoryGapsByStudent(batchId),
  ]);
  return new Map(
    att.map((a) => {
      const results = scores.get(a.studentId) ?? [];
      return [
        a.studentId,
        {
          attendancePercent: a.percent,
          consecutiveAbsences: a.consecutiveAbsences,
          assessmentPercents: results.map((r) => r.percent),
          projectedAggregate: weightedAggregate(results),
          mandatoryGaps: (gaps.get(a.studentId) ?? []).map((g) => ({
            title: g.title,
            requiredLevel: g.requiredLevel,
            gap: g.gap,
          })),
        },
      ];
    }),
  );
}

const emptySummary = (): RiskEvaluationSummary => ({
  batches: 0,
  students: 0,
  opened: 0,
  updated: 0,
  clearing: 0,
  closed: 0,
  escalated: 0,
});

/**
 * BRQ-11.1, 11.4, BR-16–18: evaluates one ACTIVE batch and applies the flag lifecycle — open,
 * update, start clearing, close after the clear period, escalate unresolved High flags to every
 * admin. Each change is audited (actor null for the scheduled run), so the flag's history stays
 * in the audit log. Other batches are left alone.
 *
 * Writes take a transaction-scoped advisory lock on the batch, so the daily run and an
 * evaluation triggered by a save never interleave on the same batch.
 */
export async function evaluateBatch(
  batchId: string,
  options: { now?: Date } = {},
): Promise<RiskEvaluationSummary> {
  const now = options.now ?? new Date();
  const summary = emptySummary();
  const batch = (await batches.namesOf([batchId])).get(batchId);
  if (!batch || batch.status !== 'ACTIVE') return summary;

  // Everything read before the transaction: production pools one connection per instance.
  const [allFacts, statuses, t, closeDays, escalateDays, admins] = await Promise.all([
    gatherFacts(batchId),
    batches.memberStatuses(batchId),
    thresholds(),
    settings.get('risk.closeAfterClearDays'),
    settings.get('risk.escalateAfterDays'),
    users.activeAdmins(),
  ]);
  // Only students still in training are evaluated (BR-16); finished ones keep no open flag.
  const inBatch = new Map([...allFacts].filter(([id]) => inTraining(statuses.get(id))));
  const students = await users.studentSummaries([...inBatch.keys()]);
  // T2: a deactivated student has left; absences after that are not a risk to act on.
  const facts = new Map([...inBatch].filter(([id]) => students.get(id)?.isActive !== false));
  summary.batches = 1;
  summary.students = facts.size;

  await withAudit(
    { userId: null },
    async (tx, log) => {
      await tx.$queryRaw`
        SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${JOB}), hashtext(${batchId}))`;
      const open = new Map(
        (await tx.riskFlag.findMany({ where: { batchId, closedAt: null } })).map((f) => [
          f.studentId,
          f,
        ]),
      );
      const notices: NewNotification[] = [];

      for (const [studentId, flag] of open) {
        if (facts.has(studentId)) continue;
        await tx.riskFlag.update({ where: { id: flag.id }, data: { closedAt: now } });
        summary.closed++;
        await log({
          action: 'RISK_FLAG_CLOSED',
          entity: 'RiskFlag',
          entityId: flag.id,
          oldValue: { closedAt: null },
          newValue: { closedAt: now, reason: 'TRAINING_ENDED', status: statuses.get(studentId) },
        });
      }

      for (const [studentId, f] of facts) {
        const current = riskLevel(f, t);
        let flag = open.get(studentId) ?? null;
        const step = flagStep(
          current,
          flag
            ? { level: flag.level, reasons: reasonsOf(flag), clearSince: flag.clearSince }
            : null,
          now,
          closeDays,
        );
        const reasons = current.reasons as unknown as Prisma.InputJsonValue;

        if (step.kind === 'open') {
          flag = await tx.riskFlag.create({
            data: { studentId, batchId, level: current.level, reasons, openedAt: now },
          });
          summary.opened++;
          await log({
            action: 'RISK_FLAG_OPENED',
            entity: 'RiskFlag',
            entityId: flag.id,
            newValue: { studentId, batchId, level: current.level, reasons: current.reasons },
          });
        } else if (step.kind === 'update' && flag) {
          const before = {
            level: flag.level,
            reasons: reasonsOf(flag),
            clearSince: flag.clearSince,
          };
          flag = await tx.riskFlag.update({
            where: { id: flag.id },
            data: { level: current.level, reasons, clearSince: null },
          });
          summary.updated++;
          await log({
            action: 'RISK_FLAG_UPDATED',
            entity: 'RiskFlag',
            entityId: flag.id,
            oldValue: before,
            newValue: { level: current.level, reasons: current.reasons },
          });
        } else if (step.kind === 'clearing' && flag) {
          flag = await tx.riskFlag.update({ where: { id: flag.id }, data: { clearSince: now } });
          summary.clearing++;
          await log({
            action: 'RISK_FLAG_CLEARING',
            entity: 'RiskFlag',
            entityId: flag.id,
            oldValue: { clearSince: null },
            newValue: { clearSince: now },
          });
        } else if (step.kind === 'close' && flag) {
          flag = await tx.riskFlag.update({ where: { id: flag.id }, data: { closedAt: now } });
          summary.closed++;
          await log({
            action: 'RISK_FLAG_CLOSED',
            entity: 'RiskFlag',
            entityId: flag.id,
            oldValue: { closedAt: null, clearSince: flag.clearSince },
            newValue: { closedAt: now },
          });
          continue;
        }

        if (flag && shouldEscalate(flag, now, escalateDays)) {
          flag = await tx.riskFlag.update({ where: { id: flag.id }, data: { escalatedAt: now } });
          summary.escalated++;
          await log({
            action: 'RISK_FLAG_ESCALATED',
            entity: 'RiskFlag',
            entityId: flag.id,
            oldValue: { escalatedAt: null },
            newValue: { escalatedAt: now, level: flag.level },
          });
          const name = students.get(studentId)?.fullName ?? '';
          const days = String(Math.floor((now.getTime() - flag.openedAt.getTime()) / DAY_MS));
          for (const admin of admins) {
            notices.push({
              userId: admin.id,
              type: 'RISK_FLAG_ESCALATED',
              title: 'At-risk student needs attention',
              body: `${name} (${batch.name}) has been at high risk for ${days} days.`,
              data: { student: name, batch: batch.name, days },
              link: `/admin/at-risk/${flag.id}`,
            });
          }
        }
      }
      await notify(tx, notices);
    },
    { timeoutMs: 30_000 },
  );
  return summary;
}

/** Leaves headroom inside the 30 s serverless limit (vercel.json maxDuration). */
const RUN_BUDGET_MS = 25_000;

/** The daily cron (vercel.json): missed days are counted against this. */
const RUN_EVERY_MS = 24 * 60 * 60_000;

/** Batch ids a partial run did not reach, read back from the stored result. */
function leftOver(lastResult: unknown): string[] {
  const r = (lastResult as { ok?: boolean; result?: { remainingIds?: unknown } } | null)?.result;
  return Array.isArray(r?.remainingIds) ? r.remainingIds.filter((x) => typeof x === 'string') : [];
}

/**
 * The daily run (BRQ-11.1): every ACTIVE batch, one at a time. Returns `skipped` when another
 * run holds the job lease, so two runs never overlap. If the time budget runs out it stops
 * between batches and reports `partial` with the batches left; the next run starts with those
 * (catch-up), then the rest in random order. `missedRuns` counts days without a successful run.
 */
export async function evaluateAll(options: { now?: Date; budgetMs?: number } = {}): Promise<
  RiskEvaluationSummary & {
    skipped: boolean;
    partial: boolean;
    remaining: number;
    remainingIds: string[];
    missedRuns: number;
  }
> {
  const started = Date.now();
  const budget = options.budgetMs ?? RUN_BUDGET_MS;
  const run = await withJobLease(
    JOB,
    LEASE_MS,
    async (previous) => {
      const total = emptySummary();
      const active = await batches.idsByStatus('ACTIVE');
      const ids = runOrder(active, leftOver(previous.lastResult), Math.random);
      let done = 0;
      for (const id of ids) {
        if (Date.now() - started > budget) break;
        const s = await evaluateBatch(id, options);
        for (const k of Object.keys(total) as Array<keyof RiskEvaluationSummary>) total[k] += s[k];
        done++;
      }
      const remainingIds = ids.slice(done);
      return {
        ...total,
        partial: remainingIds.length > 0,
        remaining: remainingIds.length,
        remainingIds,
      };
    },
    { everyMs: RUN_EVERY_MS },
  );
  return run.ran
    ? { ...run.result, skipped: false, missedRuns: run.missedRuns }
    : {
        ...emptySummary(),
        skipped: true,
        partial: false,
        remaining: 0,
        remainingIds: [],
        missedRuns: 0,
      };
}

// ─── Reads (BRQ-11.2) ──────────────────────────────────────────────────────────

type FlagWithCounts = FlagRow & {
  _count: { actions: number };
  actions: Array<{ id: string }>;
};

async function toRows(flags: FlagWithCounts[]): Promise<RiskFlagRow[]> {
  const [students, batchNames] = await Promise.all([
    users.studentSummaries(flags.map((f) => f.studentId)),
    batches.namesOf(flags.map((f) => f.batchId)),
  ]);
  return flags.map((f) => {
    const s = students.get(f.studentId);
    return {
      id: f.id,
      student: { id: f.studentId, fullName: s?.fullName ?? '', rollNo: s?.rollNo ?? '' },
      batch: { id: f.batchId, name: batchNames.get(f.batchId)?.name ?? '' },
      level: f.level,
      reasons: reasonsOf(f),
      status: f.closedAt ? 'CLOSED' : 'OPEN',
      openedAt: f.openedAt.toISOString(),
      clearSince: iso(f.clearSince),
      closedAt: iso(f.closedAt),
      escalatedAt: iso(f.escalatedAt),
      actionCount: f._count.actions,
      openActionCount: f.actions.length,
    };
  });
}

const countsInclude = {
  _count: { select: { actions: true } },
  actions: { where: { completedAt: null }, select: { id: true } },
} as const;

/** Admin: every flag. Trainer: flags in their own batches only (BR-05). */
export async function listFlags(
  viewer: Viewer,
  query: RiskFlagQuery,
): Promise<Paginated<RiskFlagRow>> {
  const where: Prisma.RiskFlagWhereInput = {
    ...(query.status === 'OPEN' ? { closedAt: null } : {}),
    ...(query.status === 'CLOSED' ? { closedAt: { not: null } } : {}),
    ...(query.level ? { level: query.level } : {}),
    ...(query.escalated === true ? { escalatedAt: { not: null } } : {}),
    ...(query.escalated === false ? { escalatedAt: null } : {}),
  };
  if (viewer.role === 'TRAINER') {
    const mine = await batches.idsForTrainer(viewer.trainerId ?? '');
    if (query.batchId && !mine.includes(query.batchId)) throw AppError.forbidden();
    where.batchId = query.batchId ? query.batchId : { in: mine };
  } else if (query.batchId) {
    where.batchId = query.batchId;
  }
  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    prisma().riskFlag.findMany({
      where,
      // Enum order is LOW, MEDIUM, HIGH: worst first, then the longest-open.
      orderBy: [{ level: 'desc' }, { openedAt: 'asc' }],
      include: countsInclude,
      skip,
      take: query.pageSize,
    }),
    prisma().riskFlag.count({ where }),
  ]);
  return paginated(await toRows(rows), total, {
    page: query.page,
    pageSize: query.pageSize,
    skip,
    take: query.pageSize,
  });
}

async function loadFlag(id: string): Promise<FlagWithCounts> {
  const f = await prisma().riskFlag.findUnique({ where: { id }, include: countsInclude });
  if (!f) throw AppError.notFound('Flag not found');
  return f;
}

function toAction(a: ActionRow, names: Map<string, string>): InterventionActionDto {
  return {
    id: a.id,
    flagId: a.flagId,
    type: a.type,
    owner: { id: a.ownerId, fullName: names.get(a.ownerId) ?? '' },
    dueOn: day(a.dueOn),
    note: a.note,
    outcome: a.outcome,
    completedAt: iso(a.completedAt),
    createdBy: names.get(a.createdById) ?? '',
    createdAt: a.createdAt.toISOString(),
  };
}

async function ownerOptions(batchId: string): Promise<RiskFlagDetail['ownerOptions']> {
  const [trainers, admins] = await Promise.all([
    batches.trainerUsers(batchId),
    users.activeAdmins(),
  ]);
  return [
    ...trainers.map((u) => ({ ...u, role: 'TRAINER' as const })),
    ...admins.map((u) => ({ ...u, role: 'ADMIN' as const })),
  ];
}

const FLAG_EVENTS: Record<string, RiskTimelineEvent['kind']> = {
  RISK_FLAG_OPENED: 'OPENED',
  RISK_FLAG_UPDATED: 'LEVEL_CHANGED',
  RISK_FLAG_CLEARING: 'CLEARING',
  RISK_FLAG_CLOSED: 'CLOSED',
  RISK_FLAG_ESCALATED: 'ESCALATED',
};

/** One flag with its actions and a timeline built from the audit log (BRQ-11.4: history). */
export async function flagDetail(id: string): Promise<RiskFlagDetail> {
  const flag = await loadFlag(id);
  const actions = await prisma().interventionAction.findMany({
    where: { flagId: id },
    orderBy: { createdAt: 'asc' },
  });
  const [[row], flagHistory, actionHistory, options, closeAfterClearDays] = await Promise.all([
    toRows([flag]),
    audit.history('RiskFlag', id),
    audit.historyOf(
      'InterventionAction',
      actions.map((a) => a.id),
    ),
    ownerOptions(flag.batchId),
    settings.get('risk.closeAfterClearDays'),
  ]);
  const names = await users.userNames([
    ...actions.flatMap((a) => [a.ownerId, a.createdById]),
    ...actionHistory.map((h) => h.userId).filter((u): u is string => u !== null),
  ]);

  const timeline: RiskTimelineEvent[] = [];
  for (const h of flagHistory) {
    const kind = FLAG_EVENTS[h.action];
    if (!kind) continue;
    const next = (h.newValue ?? {}) as { level?: RiskFlagRow['level']; reasons?: RiskReason[] };
    const prev = (h.oldValue ?? {}) as { level?: RiskFlagRow['level'] };
    timeline.push({
      at: h.createdAt.toISOString(),
      kind,
      ...(next.level ? { level: next.level } : {}),
      ...(kind === 'LEVEL_CHANGED' && prev.level ? { previousLevel: prev.level } : {}),
      ...(next.reasons ? { reasons: next.reasons } : {}),
      by: null,
    });
  }
  const byId = new Map(actions.map((a) => [a.id, a]));
  for (const h of actionHistory) {
    const a = byId.get(h.entityId);
    if (!a) continue;
    const by = h.userId ? (names.get(h.userId) ?? null) : null;
    if (h.action === 'INTERVENTION_ACTION_CREATED') {
      timeline.push({
        at: h.createdAt.toISOString(),
        kind: 'ACTION_ADDED',
        actionType: a.type,
        by,
      });
    } else if (h.action === 'INTERVENTION_ACTION_COMPLETED') {
      const outcome = (h.newValue as { outcome?: string } | null)?.outcome;
      timeline.push({
        at: h.createdAt.toISOString(),
        kind: 'ACTION_COMPLETED',
        actionType: a.type,
        ...(outcome ? { outcome } : {}),
        by,
      });
    }
  }
  timeline.sort((x, y) => x.at.localeCompare(y.at));

  return {
    ...row!,
    actions: actions.map((a) => toAction(a, names)),
    timeline,
    ownerOptions: options,
    closeAfterClearDays,
  };
}

// ─── Remedial actions (BRQ-11.3) ───────────────────────────────────────────────

const ACTION_TEXT: Record<InterventionActionDto['type'], string> = {
  COUNSELLING: 'A counselling session',
  EXTRA_SESSION: 'An extra session',
  PRACTICE_TASK: 'A practice task',
};

export async function createAction(
  actor: Viewer,
  flagId: string,
  input: ActionCreateInput,
): Promise<RiskFlagDetail> {
  const flag = await loadFlag(flagId);
  if (flag.closedAt) throw AppError.conflict('FLAG_CLOSED', 'This flag is already closed');
  if (input.dueOn < day(new Date())) {
    throw AppError.unprocessable('DUE_IN_PAST', 'The due date cannot be in the past', [
      { path: 'dueOn', message: 'Must be today or later' },
    ]);
  }
  const owner = (await ownerOptions(flag.batchId)).find((o) => o.id === input.ownerId);
  if (!owner) {
    throw AppError.unprocessable(
      'INVALID_OWNER',
      "The owner must be one of the batch's trainers or an admin",
      [{ path: 'ownerId', message: 'Not allowed' }],
    );
  }
  const student = (await users.studentSummaries([flag.studentId])).get(flag.studentId);

  await withAudit(actor, async (tx, log) => {
    const created = await tx.interventionAction.create({
      data: {
        flagId,
        type: input.type,
        ownerId: owner.id,
        dueOn: new Date(`${input.dueOn}T00:00:00Z`),
        note: input.note || null,
        createdById: actor.userId,
      },
    });
    await log({
      action: 'INTERVENTION_ACTION_CREATED',
      entity: 'InterventionAction',
      entityId: created.id,
      newValue: {
        flagId,
        type: input.type,
        ownerId: owner.id,
        dueOn: input.dueOn,
        note: created.note,
      },
    });
    // BRQ-11.5: the student sees the agreed action (never the staff note).
    if (student) {
      await notify(tx, [
        {
          userId: student.userId,
          type: 'RISK_ACTION_AGREED',
          title: 'A plan to help you',
          body: `${ACTION_TEXT[input.type]} with ${owner.fullName} by ${input.dueOn}.`,
          data: { type: input.type, owner: owner.fullName, dueOn: input.dueOn },
          link: '/student',
        },
      ]);
    }
  });
  return flagDetail(flagId);
}

/** Records the outcome of an action; completedAt defaults to now and can't be in the future. */
export async function updateAction(
  actor: Viewer,
  actionId: string,
  input: ActionUpdateInput,
): Promise<RiskFlagDetail> {
  const action = await prisma().interventionAction.findUnique({ where: { id: actionId } });
  if (!action) throw AppError.notFound('Action not found');
  const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
  if (completedAt.getTime() > Date.now() + 60_000) {
    throw AppError.unprocessable('COMPLETED_IN_FUTURE', 'Completion cannot be in the future', [
      { path: 'completedAt', message: 'Must not be in the future' },
    ]);
  }
  await withAudit(actor, async (tx, log) => {
    await tx.interventionAction.update({
      where: { id: actionId },
      data: { outcome: input.outcome, completedAt },
    });
    await log({
      action: action.completedAt ? 'INTERVENTION_ACTION_UPDATED' : 'INTERVENTION_ACTION_COMPLETED',
      entity: 'InterventionAction',
      entityId: actionId,
      oldValue: { outcome: action.outcome, completedAt: action.completedAt },
      newValue: { outcome: input.outcome, completedAt },
    });
  });
  return flagDetail(action.flagId);
}

/** For the ownership resolver: the batch an action's flag belongs to. */
export async function batchOfAction(actionId: string): Promise<string | null> {
  const a = await prisma().interventionAction.findUnique({
    where: { id: actionId },
    select: { flag: { select: { batchId: true } } },
  });
  return a?.flag.batchId ?? null;
}

/** For the ownership resolver: the batch a flag belongs to. */
export async function batchOfFlag(flagId: string): Promise<string | null> {
  const f = await prisma().riskFlag.findUnique({
    where: { id: flagId },
    select: { batchId: true },
  });
  return f?.batchId ?? null;
}

// ─── The student's own view (BRQ-11.5) ─────────────────────────────────────────

export async function myRisk(studentId: string): Promise<MyRiskFlag[]> {
  const flags = await prisma().riskFlag.findMany({
    where: { studentId, closedAt: null },
    orderBy: { openedAt: 'asc' },
    include: { actions: { orderBy: { dueOn: 'asc' } } },
  });
  const [batchNames, names] = await Promise.all([
    batches.namesOf(flags.map((f) => f.batchId)),
    users.userNames(flags.flatMap((f) => f.actions.map((a) => a.ownerId))),
  ]);
  return flags.map((f) => ({
    id: f.id,
    batch: { id: f.batchId, name: batchNames.get(f.batchId)?.name ?? '' },
    level: f.level,
    reasons: reasonsOf(f),
    clearSince: iso(f.clearSince),
    actions: f.actions.map((a) => ({
      id: a.id,
      type: a.type,
      owner: names.get(a.ownerId) ?? '',
      dueOn: day(a.dueOn),
      completedAt: iso(a.completedAt),
    })),
  }));
}
