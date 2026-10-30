import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DashboardSession, EndedBatch } from '@vtmp/shared';
import { Button, Card, EmptyState, Select, Spinner, Table } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useAuth } from '../../lib/auth';
import { formatDay, formatSessionDate, formatSessionTime } from '../../lib/format';
import { useAdminCycles } from '../admin-courses/api';
import { StatusBadge } from '../enrollment/StatusBadge';
import { EscalationsWidget, MyRiskCard } from '../intervention/Widgets';
import { downloadStudentReport } from '../reports/api';
import { useAdminDashboard, useStudentDashboard, useTrainerDashboard } from './api';
import { StatTile } from './StatTile';

// Recharts is large; only the admin dashboard loads it, after the figures arrive (NFR-10).
const AdminCharts = lazy(() => import('./AdminCharts').then((m) => ({ default: m.AdminCharts })));

const pct = (n: number | null, none: string) => (n === null ? none : `${n.toFixed(2)} %`);

/** BRQ-9.1, BRQ-9.2: counts, completion and charts. */
/**
 * L8: batches whose training is over but which are still open: decisions to make on
 * Completions, or nothing left but to close them.
 */
function EndedBatchesCard({ batches }: { batches: EndedBatch[] }) {
  const { t, i18n } = useTranslation('dashboard');
  const lng = i18n.resolvedLanguage ?? 'en';
  const link = 'font-medium text-brand-700 underline-offset-2 hover:underline';
  return (
    <Card title={t('ended.title')} headingLevel={2} data-testid="ended-batches">
      {batches.length === 0 ? (
        <EmptyState title={t('ended.none')} />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {batches.map((b) => (
            <li key={b.batchId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium text-slate-900">{`${b.courseTitle} · ${b.batchName}`}</span>
                <span className="block text-xs text-slate-600">
                  {t('ended.endedOn', { date: formatDay(b.endDate, lng) })}
                </span>
              </span>
              {b.undecided > 0 ? (
                <Link to={`/admin/completions?batch=${b.batchId}`} className={link}>
                  {t('ended.decide', { count: b.undecided })}
                </Link>
              ) : (
                <Link to={`/admin/batches/${b.batchId}`} className={link}>
                  {t('ended.close')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AdminHome() {
  const { t, i18n } = useTranslation('dashboard');
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en');
  const errorMessage = useErrorMessage();
  const cycles = useAdminCycles();
  const [cycleId, setCycleId] = useState('');
  const { data, isPending, isError, error } = useAdminDashboard(cycleId || undefined);

  if (isPending) return <Spinner />;
  if (isError) return <EmptyState title={errorMessage(error)} />;
  const c = data.counts;
  const done = data.completion;

  return (
    <section aria-labelledby="admin-figures" className="flex flex-col gap-6">
      <h2 id="admin-figures" className="sr-only">
        {t('charts.funnel')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          testId="tile-students"
          label={t('tiles.students')}
          value={nf.format(c.students)}
        />
        <StatTile testId="tile-courses" label={t('tiles.courses')} value={nf.format(c.courses)} />
        <StatTile
          testId="tile-trainers"
          label={t('tiles.trainers')}
          value={nf.format(c.trainers)}
        />
        <StatTile
          testId="tile-batches"
          label={t('tiles.activeBatches')}
          value={nf.format(c.batches.ACTIVE)}
          detail={t('tiles.plannedBatches', { count: c.batches.PLANNED, closed: c.batches.CLOSED })}
        />
        <StatTile
          testId="tile-completion"
          label={t('tiles.completionRate')}
          value={done.ratePercent === null ? t('tiles.none') : `${done.ratePercent.toFixed(2)} %`}
          detail={
            done.ratePercent === null
              ? t('tiles.noneFinished')
              : t('tiles.completionDetail', {
                  completed: done.completed,
                  notCompleted: done.notCompleted,
                  inTraining: done.inTraining,
                })
          }
        />
      </div>
      <EscalationsWidget />
      <EndedBatchesCard batches={data.endedBatches} />
      <div className="w-64">
        <Select
          label={t('charts.cycle')}
          value={cycleId}
          onChange={(e) => setCycleId(e.target.value)}
          options={[
            { value: '', label: t('charts.allCycles') },
            ...(cycles.data ?? []).map((cy) => ({ value: cy.id, label: cy.name })),
          ]}
        />
      </div>
      <Suspense fallback={<Spinner label={t('charts.loading')} />}>
        <AdminCharts data={data} />
      </Suspense>
    </section>
  );
}

function SessionRow({ s, lng }: { s: DashboardSession; lng: string }) {
  const { t } = useTranslation('dashboard');
  const when = `${formatSessionDate(s.startsAt, lng)} ${formatSessionTime(s.startsAt, s.endsAt, lng)}`;
  const batch = `${s.courseTitle} · ${s.batchName}`;
  const started = new Date(s.startsAt) <= new Date();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div>
        <p className="font-medium text-slate-900">{batch}</p>
        <p className="text-sm text-slate-700">
          {when} · {s.venue}
        </p>
        <p className="text-xs text-slate-600">
          {t('trainerHome.marked', { marked: s.marked, total: s.rosterSize })}
        </p>
      </div>
      {started && (
        <Link
          to={`/trainer/sessions/${s.id}`}
          aria-label={t('trainerHome.takeFor', { batch, when })}
          className="inline-flex h-9 items-center rounded-md bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          {t('trainerHome.take')}
        </Link>
      )}
    </li>
  );
}

/** BRQ-9.3 for trainers: what needs doing today, one click from here. */
export function TrainerHome() {
  const { t, i18n } = useTranslation('dashboard');
  const lng = i18n.resolvedLanguage ?? 'en';
  const errorMessage = useErrorMessage();
  const { data, isPending, isError, error } = useTrainerDashboard();
  if (isPending) return <Spinner />;
  if (isError) return <EmptyState title={errorMessage(error)} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          testId="tile-my-batches"
          label={t('tiles.myBatches')}
          value={data.activeBatches}
        />
        <StatTile testId="tile-my-students" label={t('tiles.myStudents')} value={data.students} />
        <StatTile
          testId="tile-pending"
          label={t('tiles.pending')}
          value={data.pendingAttendance.length}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('trainerHome.today')} headingLevel={2}>
          {data.todaySessions.length === 0 ? (
            <p className="text-sm text-slate-700">{t('trainerHome.noToday')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.todaySessions.map((s) => (
                <SessionRow key={s.id} s={s} lng={lng} />
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('trainerHome.pending')} headingLevel={2}>
          {data.pendingAttendance.length === 0 ? (
            <p className="text-sm text-slate-700">{t('trainerHome.noPending')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.pendingAttendance.map((s) => (
                <SessionRow key={s.id} s={s} lng={lng} />
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title={t('trainerHome.low')} headingLevel={2}>
        <Table
          caption={t('trainerHome.lowCaption')}
          columns={[
            {
              key: 'student',
              header: t('trainerHome.student'),
              render: (r) => (
                <span>
                  <span className="font-medium text-slate-900">{r.fullName}</span>{' '}
                  <span className="text-xs text-slate-600">{r.rollNo}</span>
                </span>
              ),
            },
            {
              key: 'batch',
              header: t('trainerHome.batch'),
              render: (r) => (
                <Link
                  to={`/trainer/batches/${r.batchId}`}
                  className="text-brand-700 underline hover:text-brand-900"
                >
                  {`${r.courseTitle} · ${r.batchName}`}
                </Link>
              ),
            },
            {
              key: 'pct',
              header: t('trainerHome.percent'),
              align: 'right',
              render: (r) => (
                <span className="font-medium text-red-800">{r.percent.toFixed(2)} %</span>
              ),
            },
          ]}
          rows={data.lowAttendance}
          rowKey={(r) => `${r.batchId}:${r.studentId}`}
          empty={<p className="text-sm text-slate-700">{t('trainerHome.noLow')}</p>}
        />
      </Card>
    </div>
  );
}

/** BRQ-9.3 for students: status, live figures and the performance report. */
export function StudentHome() {
  const { t } = useTranslation(['dashboard', 'training']);
  const { user } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const { data, isPending, isError, error } = useStudentDashboard();
  const [busy, setBusy] = useState(false);
  if (isPending) return <Spinner />;
  if (isError) return <EmptyState title={errorMessage(error)} />;
  const tr = data.training;

  const onReport = async () => {
    setBusy(true);
    try {
      await downloadStudentReport('me', user?.student?.rollNo ?? 'me', tr?.enrollmentId);
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <MyRiskCard />
      <Card title={t('studentHome.figures')} headingLevel={2} data-testid="student-figures">
        {data.enrollment && (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            {t('tiles.status')}: <StatusBadge status={data.enrollment.status} />
            <span>{data.enrollment.cycleName}</span>
          </p>
        )}
        {!tr ? (
          <p className="text-sm text-slate-700">{t('studentHome.noTraining')}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label={t('tiles.attendance')}
                value={pct(tr.attendancePercent, t('tiles.none'))}
                detail={t('tiles.minimum', { min: tr.minAttendancePercent })}
              />
              <StatTile label={t('tiles.aggregate')} value={pct(tr.aggregate, t('tiles.none'))} />
              <StatTile
                label={t('tiles.grade')}
                value={
                  tr.projectedGrade
                    ? t(`training:mine.grade.${tr.projectedGrade}`)
                    : t('tiles.none')
                }
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" loading={busy} onClick={() => void onReport()}>
                {t('studentHome.report')}
              </Button>
              <span className="text-xs text-slate-600">{t('studentHome.reportHint')}</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
