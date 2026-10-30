import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type AttendanceStatus } from '@vtmp/shared';
import { Button, Card, cn, EmptyState, PageSkeleton } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { formatDate, formatSessionDate, formatSessionTime, relativeTime } from '../../lib/format';
import { useAttendanceSheet, useSaveAttendance } from './api';

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT'];
const TONE: Record<AttendanceStatus, string> = {
  PRESENT: 'peer-checked:bg-green-700 peer-checked:text-white peer-checked:border-green-700',
  LATE: 'peer-checked:bg-amber-500 peer-checked:text-slate-900 peer-checked:border-amber-500',
  ABSENT: 'peer-checked:bg-red-700 peer-checked:text-white peer-checked:border-red-700',
};

/**
 * Attendance sheet (BRQ-5.1/5.2). One radio group per student: Tab moves between students,
 * arrow keys between Present/Late/Absent. Shows the edit window, the lock reason, and the
 * admin override reason field after the window closes.
 */
export function AttendancePage({
  back,
}: {
  /** Defaults to the batch page (admin). */ back?: string;
}) {
  const { sessionId = '' } = useParams();
  const { t, i18n } = useTranslation('training');
  const lng = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const sheet = useAttendanceSheet(sessionId);
  const save = useSaveAttendance();
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reasonId = useId();

  useEffect(() => {
    if (!sheet.data) return;
    setMarks(
      Object.fromEntries(
        sheet.data.rows.filter((r) => r.status).map((r) => [r.studentId, r.status!]),
      ),
    );
  }, [sheet.data]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, unmarked: 0 };
    for (const r of sheet.data?.rows ?? []) {
      const m = marks[r.studentId];
      if (m === 'PRESENT') c.present++;
      else if (m === 'LATE') c.late++;
      else if (m === 'ABSENT') c.absent++;
      else c.unmarked++;
    }
    return c;
  }, [marks, sheet.data]);

  if (sheet.isPending) return <PageSkeleton />;
  if (sheet.isError) return <EmptyState title={errorMessage(sheet.error)} />;
  const s = sheet.data;
  const readOnly = !s.canEdit;

  const onSave = async () => {
    setProblem(null);
    if (counts.unmarked > 0) return setProblem(t('sheet.incomplete'));
    if (s.requiresReason && reason.trim().length < 3) return setProblem(t('sheet.reasonRequired'));
    try {
      await save.mutateAsync({
        sessionId,
        input: {
          entries: s.rows.map((r) => ({ studentId: r.studentId, status: marks[r.studentId]! })),
          ...(s.requiresReason ? { reason: reason.trim() } : {}),
        },
      });
      setReason('');
      toast.show({ tone: 'success', title: t('sheet.saved') });
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        to={back ?? `/admin/batches/${s.session.batchId}`}
        className="text-sm font-medium text-brand-700 underline hover:text-brand-900"
      >
        {t('sheet.back')}
      </Link>
      <div>
        <p className="text-sm text-slate-600">{`${s.session.courseTitle} · ${s.session.batchName}`}</p>
        <h1 className="text-2xl font-bold text-slate-900">
          {t('sheet.title')}: {formatSessionDate(s.session.startsAt, lng)}
        </h1>
        <p className="mt-1 text-sm text-slate-700">
          {formatSessionTime(s.session.startsAt, s.session.endsAt, lng)} · {s.session.venue}
          {s.session.topic ? ` · ${s.session.topic}` : ''}
        </p>
      </div>

      {s.lockedReason && !s.requiresReason && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800"
        >
          <span aria-hidden="true">🔒</span> {t(`sheet.locked.${s.lockedReason}`)}
        </p>
      )}
      {s.requiresReason && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span aria-hidden="true">🔒 </span>
          {t('sheet.override')}
        </p>
      )}
      {!s.lockedReason && (
        <p className="text-sm text-slate-700">
          {t(s.firstMarkedAt ? 'sheet.editableFor' : 'sheet.markBy', {
            when: formatDate(s.editableUntil, lng, true),
            relative: relativeTime(s.editableUntil, lng),
          })}
        </p>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700" aria-live="polite">
            {t('sheet.counts', counts)}
          </p>
          {!readOnly && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setMarks(Object.fromEntries(s.rows.map((r) => [r.studentId, 'PRESENT'])))
              }
            >
              {t('sheet.markAll')}
            </Button>
          )}
        </div>
        <ul className="divide-y divide-slate-100">
          {s.rows.map((r) => (
            <li
              key={r.studentId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span>
                <span className="font-medium text-slate-900">{r.fullName}</span>{' '}
                <span className="text-xs text-slate-600">{r.rollNo}</span>
              </span>
              <fieldset className="flex gap-1" disabled={readOnly}>
                <legend className="sr-only">{t('sheet.statusFor', { name: r.fullName })}</legend>
                {STATUSES.map((status) => (
                  <label key={status} className="cursor-pointer">
                    <input
                      type="radio"
                      name={`att-${r.studentId}`}
                      value={status}
                      checked={marks[r.studentId] === status}
                      onChange={() => setMarks((m) => ({ ...m, [r.studentId]: status }))}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'inline-flex min-w-[5.5rem] justify-center rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800',
                        'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-1',
                        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
                        TONE[status],
                      )}
                    >
                      {t(`attendanceStatus.${status}`)}
                    </span>
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ul>

        {s.requiresReason && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="text-sm font-medium text-slate-800">
              {t('sheet.reason')}
            </label>
            <textarea
              id={reasonId}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            />
          </div>
        )}
        {problem && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {problem}
          </p>
        )}
        {!readOnly && (
          <div className="mt-4">
            <Button onClick={() => void onSave()} loading={save.isPending}>
              {t('sheet.save')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
