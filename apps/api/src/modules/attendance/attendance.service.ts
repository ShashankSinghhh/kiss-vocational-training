import type {
  AttendanceFigures,
  AttendanceSaveInput,
  AttendanceSheet,
  AttendanceStatus,
  BatchAttendanceRow,
  Role,
  SessionDto,
  StudentSessionRecord,
} from '@vtmp/shared';
import { withAudit, type Actor } from '../../core/audit';
import { prisma } from '../../core/db';
import { batchEvents } from '../../core/events';
import { AppError } from '../../core/errors';
import { settings } from '../../core/settings';
import { attendanceFigures, editWindow } from './rules';

interface Viewer extends Actor {
  userId: string;
  role: Role;
}

async function loadSession(sessionId: string) {
  const s = await prisma().trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
          status: true,
          course: { select: { title: true } },
          students: {
            orderBy: { student: { rollNo: 'asc' } },
            select: {
              studentId: true,
              enrollment: { select: { status: true } },
              student: {
                select: { rollNo: true, user: { select: { fullName: true, isActive: true } } },
              },
            },
          },
        },
      },
      attendance: {
        select: { studentId: true, status: true, firstMarkedAt: true, markedAt: true },
      },
    },
  });
  if (!s) throw AppError.notFound('Session not found');
  return s;
}

type LoadedSession = Awaited<ReturnType<typeof loadSession>>;

/**
 * T2 / L4: students whose account was deactivated or who withdrew from the training are not on
 * the sheet any more, unless this session already holds a mark for them, so past records stay
 * visible and editable.
 */
function sheetMembers(s: LoadedSession) {
  const marked = new Set(s.attendance.map((x) => x.studentId));
  return s.batch.students.filter(
    (m) =>
      (m.student.user.isActive && m.enrollment.status !== 'WITHDRAWN') || marked.has(m.studentId),
  );
}

function firstMarked(s: LoadedSession): Date | null {
  return s.attendance.reduce<Date | null>(
    (min, a) => (!min || a.firstMarkedAt < min ? a.firstMarkedAt : min),
    null,
  );
}

/**
 * Who may save right now (BR-05, BR-06, BRQ-5.2). Trainer: assigned (checked by the route),
 * session started and not cancelled, batch active, within the edit window. Admin: same, but
 * past the window they may still edit with a reason.
 */
function access(s: LoadedSession, viewer: Viewer, hours: number, now = new Date()) {
  const window = editWindow(firstMarked(s), now, hours);
  let lockedReason: AttendanceSheet['lockedReason'] = null;
  if (s.status === 'CANCELLED') lockedReason = 'CANCELLED';
  else if (s.startsAt > now) lockedReason = 'NOT_STARTED';
  else if (s.batch.status !== 'ACTIVE') lockedReason = 'BATCH_NOT_ACTIVE';
  else if (!window.open) lockedReason = 'WINDOW_CLOSED';

  const adminOverride = lockedReason === 'WINDOW_CLOSED' && viewer.role === 'ADMIN';
  return {
    window,
    lockedReason,
    canEdit: lockedReason === null || adminOverride,
    requiresReason: adminOverride,
  };
}

export async function sheet(viewer: Viewer, sessionId: string): Promise<AttendanceSheet> {
  const s = await loadSession(sessionId);
  const hours = await settings.get('attendance.editWindowHours');
  const a = access(s, viewer, hours);
  const marks = new Map(s.attendance.map((x) => [x.studentId, x]));
  return {
    session: {
      id: s.id,
      batchId: s.batchId,
      batchName: s.batch.name,
      courseTitle: s.batch.course.title,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      venue: s.venue,
      topic: s.topic,
      status: s.status,
    },
    rows: sheetMembers(s).map((m) => ({
      studentId: m.studentId,
      rollNo: m.student.rollNo,
      fullName: m.student.user.fullName,
      status: marks.get(m.studentId)?.status ?? null,
      markedAt: marks.get(m.studentId)?.markedAt.toISOString() ?? null,
    })),
    firstMarkedAt: firstMarked(s)?.toISOString() ?? null,
    editableUntil: a.window.until?.toISOString() ?? null,
    canEdit: a.canEdit,
    requiresReason: a.requiresReason,
    lockedReason: a.lockedReason,
  };
}

const LOCK_ERRORS = {
  CANCELLED: () =>
    AppError.conflict('SESSION_CANCELLED', 'Attendance cannot be marked for a cancelled session'),
  NOT_STARTED: () =>
    AppError.conflict(
      'SESSION_NOT_STARTED',
      'Attendance can be marked once the session has started',
    ),
  BATCH_NOT_ACTIVE: () =>
    AppError.conflict('BATCH_NOT_ACTIVE', 'Attendance is taken only for active batches'),
  WINDOW_CLOSED: () =>
    AppError.conflict(
      'EDIT_WINDOW_CLOSED',
      'The edit window for this session has closed. Ask an administrator to make changes.',
    ),
} as const;

/**
 * Saves the whole roster for a session in one transaction (BRQ-5.1). New marks and every
 * change are audited (BR-12); admin edits after the window carry their reason (BRQ-5.2).
 * The first save turns the session CONDUCTED.
 */
export async function save(viewer: Viewer, sessionId: string, input: AttendanceSaveInput) {
  const s = await loadSession(sessionId);
  const hours = await settings.get('attendance.editWindowHours');
  const a = access(s, viewer, hours);
  if (!a.canEdit) throw LOCK_ERRORS[a.lockedReason!]();
  if (a.requiresReason && !input.reason) {
    throw AppError.unprocessable(
      'REASON_REQUIRED',
      'Give a reason for changing attendance after the edit window',
      [{ path: 'reason', message: 'Required' }],
    );
  }

  // Everyone on the sheet must be marked; a deactivated student may be, but need not be.
  const required = new Set(sheetMembers(s).map((m) => m.studentId));
  const roster = new Set(s.batch.students.map((m) => m.studentId));
  const sent = new Set(input.entries.map((e) => e.studentId));
  const missing = [...required].filter((id) => !sent.has(id));
  const extra = [...sent].filter((id) => !roster.has(id));
  if (missing.length || extra.length) {
    throw AppError.unprocessable(
      'ROSTER_MISMATCH',
      'Mark every student in the batch exactly once',
      [
        ...missing.map((id) => ({ path: 'entries', message: `missing ${id}` })),
        ...extra.map((id) => ({ path: 'entries', message: `not in batch ${id}` })),
      ],
    );
  }

  const saved = await withAudit(viewer, async (tx, log) => {
    // Serialise saves of the same session so two trainers can't interleave.
    await tx.$queryRaw`SELECT id FROM training_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const existing = new Map(
      (await tx.attendance.findMany({ where: { sessionId } })).map((r) => [r.studentId, r]),
    );
    const now = new Date();
    const created: Array<{ studentId: string; status: AttendanceStatus }> = [];
    const changed: Array<{
      id: string;
      studentId: string;
      from: AttendanceStatus;
      to: AttendanceStatus;
    }> = [];
    for (const e of input.entries) {
      const row = existing.get(e.studentId);
      if (!row) created.push(e);
      else if (row.status !== e.status)
        changed.push({ id: row.id, studentId: e.studentId, from: row.status, to: e.status });
    }

    if (created.length) {
      await tx.attendance.createMany({
        data: created.map((c) => ({
          sessionId,
          studentId: c.studentId,
          status: c.status,
          markedById: viewer.userId,
          firstMarkedAt: now,
          markedAt: now,
        })),
      });
    }
    for (const c of changed) {
      await tx.attendance.update({
        where: { id: c.id },
        data: { status: c.to, markedById: viewer.userId, markedAt: now },
      });
    }

    await log.many([
      ...created.map((c) => ({
        action: 'ATTENDANCE_MARKED',
        entity: 'Attendance',
        entityId: `${sessionId}:${c.studentId}`,
        newValue: { sessionId, studentId: c.studentId, status: c.status },
      })),
      ...changed.map((c) => ({
        action: a.requiresReason ? 'ATTENDANCE_OVERRIDDEN' : 'ATTENDANCE_EDITED',
        entity: 'Attendance',
        entityId: `${sessionId}:${c.studentId}`,
        oldValue: { status: c.from },
        newValue: { status: c.to, ...(input.reason ? { reason: input.reason } : {}) },
      })),
    ]);

    if (s.status === 'SCHEDULED') {
      await tx.trainingSession.update({ where: { id: sessionId }, data: { status: 'CONDUCTED' } });
      await log({
        action: 'SESSION_CONDUCTED',
        entity: 'TrainingSession',
        entityId: sessionId,
        oldValue: { status: 'SCHEDULED' },
        newValue: { status: 'CONDUCTED' },
      });
    }
    return { created: created.length, changed: changed.length };
  });
  // F11: re-evaluate the batch's risk flags before responding (TAD §8.2 step 6).
  await batchEvents.dataChanged(s.batchId);
  return saved;
}

// ─── Figures (BR-08, BRQ-5.3): counts from SQL, percentage from the rule ──────

interface StatusesRow {
  student_id: string;
  roll_no: string;
  full_name: string;
  statuses: AttendanceStatus[];
  unrecorded: number;
}

/**
 * Per-student marks on CONDUCTED sessions of a batch, newest first, in one query, with the
 * sessions that ended after the student joined but are still SCHEDULED, i.e. never marked (L2).
 */
async function statusesFor(
  batchId: string,
  studentId?: string,
  now = new Date(),
): Promise<StatusesRow[]> {
  return prisma().$queryRaw<StatusesRow[]>`
    SELECT bs.student_id, st.roll_no, u.full_name,
      COALESCE(
        array_agg(a.status::text ORDER BY ts.starts_at DESC) FILTER (WHERE a.id IS NOT NULL),
        '{}'
      ) AS statuses,
      (SELECT COUNT(*)::int FROM training_sessions us
        WHERE us.batch_id = bs.batch_id AND us.status = 'SCHEDULED'
          AND us.ends_at <= ${now} AND us.ends_at > bs.allocated_at) AS unrecorded
    FROM batch_students bs
    JOIN students st ON st.id = bs.student_id
    JOIN users u ON u.id = st.user_id
    LEFT JOIN training_sessions ts ON ts.batch_id = bs.batch_id AND ts.status = 'CONDUCTED'
    LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = bs.student_id
    JOIN enrollments e ON e.id = bs.enrollment_id
    WHERE bs.batch_id = ${batchId}::uuid
      AND (${studentId ?? null}::uuid IS NULL OR bs.student_id = ${studentId ?? null}::uuid)
      -- L4: the batch summary leaves out students who withdrew; their own figures stay readable.
      AND (${studentId ?? null}::uuid IS NOT NULL OR e.status <> 'WITHDRAWN')
    GROUP BY bs.student_id, bs.batch_id, bs.allocated_at, st.roll_no, u.full_name
    ORDER BY st.roll_no`;
}

export async function batchSummary(batchId: string): Promise<BatchAttendanceRow[]> {
  const late = await settings.get('attendance.lateCountsAsPresent');
  const rows = await statusesFor(batchId);
  return rows.map((r) => ({
    studentId: r.student_id,
    rollNo: r.roll_no,
    fullName: r.full_name,
    ...attendanceFigures(r.statuses, late, Number(r.unrecorded)),
  }));
}

/** One student's figures in one batch (used by the training summary and, later, F11/F7). */
export async function studentFigures(
  batchId: string,
  studentId: string,
): Promise<AttendanceFigures> {
  const late = await settings.get('attendance.lateCountsAsPresent');
  const [row] = await statusesFor(batchId, studentId);
  return attendanceFigures(row?.statuses ?? [], late, Number(row?.unrecorded ?? 0));
}

/** The student's session history in a batch with their own mark only (privacy). */
export async function studentSessions(
  batchId: string,
  studentId: string,
): Promise<StudentSessionRecord[]> {
  const rows = await prisma().trainingSession.findMany({
    where: { batchId },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      topic: true,
      status: true,
      attendance: { where: { studentId }, select: { status: true } },
    },
  });
  return rows.map((r) => ({
    sessionId: r.id,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    topic: r.topic,
    sessionStatus: r.status,
    attendance: r.attendance[0]?.status ?? null,
  }));
}

/** Trainer: sessions of their batches around today (default 14 days back, 30 ahead). */
export async function mySessions(
  trainerId: string,
  from: Date,
  to: Date,
): Promise<
  Array<SessionDto & { batchName: string; courseTitle: string; marked: number; rosterSize: number }>
> {
  const rows = await prisma().trainingSession.findMany({
    where: {
      startsAt: { gte: from, lte: to },
      batch: { trainers: { some: { trainerId } }, status: { in: ['PLANNED', 'ACTIVE'] } },
    },
    orderBy: { startsAt: 'asc' },
    include: {
      trainer: { select: { user: { select: { fullName: true } } } },
      batch: {
        select: {
          name: true,
          course: { select: { title: true } },
          _count: {
            select: { students: { where: { enrollment: { status: { not: 'WITHDRAWN' } } } } },
          },
          students: {
            where: { enrollment: { status: 'WITHDRAWN' } },
            select: { studentId: true },
          },
        },
      },
      attendance: { select: { studentId: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    batchId: s.batchId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    venue: s.venue,
    topic: s.topic,
    status: s.status,
    trainerId: s.trainerId,
    trainerName: s.trainer?.user.fullName ?? null,
    batchName: s.batch.name,
    courseTitle: s.batch.course.title,
    // L4: marks of students who withdrew don't count against the current roster.
    marked: s.attendance.filter((x) => !s.batch.students.some((m) => m.studentId === x.studentId))
      .length,
    rosterSize: s.batch._count.students,
  }));
}

/**
 * Attendance % per week over the last `weeks` weeks of conducted sessions, all batches
 * (admin dashboard trend). Weeks start on Monday in institution time; LATE counts as attended
 * when the setting says so (BR-08). Aggregated in SQL.
 */
export async function weeklyTrend(
  weeks: number,
  now = new Date(),
): Promise<Array<{ weekStart: string; attended: number; marks: number }>> {
  const [late, offset] = await Promise.all([
    settings.get('attendance.lateCountsAsPresent'),
    settings.get('institution.utcOffsetMinutes'),
  ]);
  const since = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const rows = await prisma().$queryRaw<
    Array<{ week_start: Date; attended: bigint; marks: bigint }>
  >`
    SELECT date_trunc('week', ts.starts_at + make_interval(mins => ${offset}::int))::date AS week_start,
      count(*) FILTER (WHERE a.status = 'PRESENT' OR (${late}::boolean AND a.status = 'LATE')) AS attended,
      count(*) AS marks
    FROM attendance a
    JOIN training_sessions ts ON ts.id = a.session_id
    WHERE ts.status = 'CONDUCTED' AND ts.starts_at >= ${since} AND ts.starts_at <= ${now}
    GROUP BY 1
    ORDER BY 1`;
  return rows.map((r) => ({
    weekStart: r.week_start.toISOString().slice(0, 10),
    attended: Number(r.attended),
    marks: Number(r.marks),
  }));
}
