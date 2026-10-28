import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudentResult, StudentSessionRecord, StudentTraining } from '@vtmp/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageSkeleton,
  Table,
  type Column,
} from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useAuth } from '../../lib/auth';
import { downloadStudentReport } from '../reports/api';
import { formatDate, formatDay, formatSessionDate, formatSessionTime } from '../../lib/format';
import { useMyTraining } from './api';

/** Student "My training" (BO-4): live attendance, results, aggregate and projected grade. */
export function MyTrainingPage() {
  const { t } = useTranslation('training');
  const errorMessage = useErrorMessage();
  const { data, isPending, isError, error } = useMyTraining();

  if (isPending) return <PageSkeleton />;
  if (isError) return <EmptyState title={errorMessage(error)} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('mine.title')}</h1>
        <p className="mt-1 text-sm text-slate-700">{t('mine.intro')}</p>
      </div>
      {data.length === 0 ? (
        <EmptyState title={t('mine.none')} />
      ) : (
        data.map((tr) => <BatchTraining key={tr.batch.id} training={tr} />)
      )}
    </div>
  );
}

function BatchTraining({ training: tr }: { training: StudentTraining }) {
  const { t, i18n } = useTranslation(['training', 'batches', 'dashboard']);
  const lng = i18n.resolvedLanguage ?? 'en';
  const a = tr.attendance;
  const below = a.percent !== null && a.percent < tr.minAttendancePercent;
  const { user } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const onReport = async () => {
    setBusy(true);
    try {
      await downloadStudentReport('me', user?.student?.rollNo ?? 'me', tr.enrollmentId);
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const sessionCols: Column<StudentSessionRecord>[] = [
    { key: 'date', header: t('mine.date'), render: (s) => formatSessionDate(s.startsAt, lng) },
    {
      key: 'time',
      header: t('mine.time'),
      render: (s) => formatSessionTime(s.startsAt, s.endsAt, lng),
    },
    { key: 'topic', header: t('mine.topic'), render: (s) => s.topic ?? '—' },
    {
      key: 'att',
      header: t('mine.attendance'),
      render: (s) =>
        s.sessionStatus === 'CANCELLED' ? (
          <Badge tone="neutral">{t('batches:session.CANCELLED')}</Badge>
        ) : s.attendance ? (
          <Badge
            tone={
              s.attendance === 'ABSENT' ? 'danger' : s.attendance === 'LATE' ? 'warning' : 'success'
            }
          >
            {t(`attendanceStatus.${s.attendance}`)}
          </Badge>
        ) : (
          <span className="text-slate-600">{t('notMarked')}</span>
        ),
    },
  ];

  const resultCols: Column<StudentResult>[] = [
    {
      key: 'title',
      header: t('mine.assessment'),
      render: (r) => <span className="font-medium">{r.title}</span>,
    },
    {
      key: 'mode',
      header: t('assessments.fields.mode'),
      render: (r) => t(`assessments.mode.${r.mode}`),
    },
    {
      key: 'held',
      header: t('assessments.fields.heldOn'),
      render: (r) => (r.heldOn ? formatDay(r.heldOn, lng) : '—'),
    },
    {
      key: 'weight',
      header: t('assessments.fields.weightage'),
      align: 'right',
      render: (r) => r.weightage,
    },
    {
      key: 'score',
      header: t('mine.score'),
      align: 'right',
      render: (r) => (r.marks === null ? t('mine.notRecorded') : `${r.marks} / ${r.maxMarks}`),
    },
    { key: 'remarks', header: t('marks.remarks'), render: (r) => r.remarks ?? '' },
  ];

  return (
    <section aria-labelledby={`training-${tr.batch.id}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`training-${tr.batch.id}`} className="text-lg font-semibold text-slate-900">
          {`${tr.batch.courseTitle} · ${tr.batch.name}`}
        </h2>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void onReport()}>
          {t('dashboard:studentHome.report')}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title={t('mine.attendance')} headingLevel={3}>
          <div className="flex items-center gap-4">
            <Ring
              percent={a.percent}
              danger={below}
              label={
                a.percent === null
                  ? t('mine.noneYet')
                  : t('mine.attendanceRing', { percent: a.percent.toFixed(2) })
              }
            />
            <div className="text-sm text-slate-700">
              <p>
                {a.conducted === 0
                  ? t('mine.noneYet')
                  : t('mine.ofSessions', { attended: a.attended, conducted: a.conducted })}
              </p>
              <p className={below ? 'font-medium text-red-700' : undefined}>
                {t('mine.minimum', { min: tr.minAttendancePercent })}
              </p>
            </div>
          </div>
        </Card>
        <Card title={t('mine.aggregate')} headingLevel={3}>
          <p className="text-3xl font-bold text-slate-900">
            {tr.aggregate === null ? '—' : `${tr.aggregate.toFixed(2)} %`}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {t('mine.projected')}:{' '}
            <strong>{tr.projectedGrade ? t(`mine.grade.${tr.projectedGrade}`) : '—'}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-600">{t('mine.gradeNote')}</p>
        </Card>
        <Card title={t('mine.evaluation')} headingLevel={3}>
          {tr.evaluation ? (
            <>
              <Badge tone={tr.evaluation.recommended ? 'success' : 'warning'}>
                {tr.evaluation.recommended
                  ? t('evaluation.recommendedYes')
                  : t('evaluation.recommendedNo')}
              </Badge>
              <p className="mt-2 text-sm text-slate-800">{tr.evaluation.remarks}</p>
              <p className="mt-1 text-xs text-slate-600">
                {formatDate(tr.evaluation.evaluatedAt, lng)}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-700">{t('evaluation.pending')}</p>
          )}
        </Card>
      </div>
      <Card title={t('mine.results')} headingLevel={3}>
        <Table
          caption={t('mine.resultsCaption')}
          columns={resultCols}
          rows={tr.results}
          rowKey={(r) => r.assessmentId}
          empty={<EmptyState title={t('assessments.empty')} />}
        />
      </Card>
      <Card title={t('mine.sessions')} headingLevel={3}>
        <Table
          caption={t('mine.sessionsCaption')}
          columns={sessionCols}
          rows={tr.sessions}
          rowKey={(s) => s.sessionId}
          empty={<EmptyState title={t('batches:sessions.empty')} />}
        />
      </Card>
    </section>
  );
}

/** Progress ring; the figure is also given in text, so the graphic is decorative. */
function Ring({
  percent,
  danger,
  label,
}: {
  percent: number | null;
  danger: boolean;
  label: string;
}) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const filled = ((percent ?? 0) / 100) * c;
  return (
    <div className="relative h-20 w-20 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90" aria-hidden="true">
        <circle cx="36" cy="36" r={r} fill="none" strokeWidth="8" className="stroke-slate-200" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          className={danger ? 'stroke-red-700' : 'stroke-green-700'}
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-900"
      >
        {/* BR-08: two decimals, as everywhere else the figure is shown. */}
        {percent === null ? '—' : `${percent.toFixed(2)}%`}
      </span>
    </div>
  );
}
