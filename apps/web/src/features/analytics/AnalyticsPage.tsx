import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PLACEMENT_TYPES,
  type BatchOutcome,
  type CourseOutcome,
  type PlacementCandidate,
  type PlacementDto,
  type PlacementType,
} from '@vtmp/shared';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
  type Column,
} from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { formatDate, formatDay } from '../../lib/format';
import { useAdminCycles } from '../admin-courses/api';
import { StatTile } from '../dashboard/StatTile';
import {
  downloadOutcomesCsv,
  findCandidates,
  useCreatePlacement,
  useDeletePlacement,
  useOutcomes,
  usePlacements,
  useRefreshAnalytics,
} from './api';

const OutcomeChart = lazy(() =>
  import('./OutcomeChart').then((m) => ({ default: m.OutcomeChart })),
);

const METRICS = [
  'completionRate',
  'averageScore',
  'attendanceRate',
  'competencyAchievement',
  'placementRate',
] as const;
type Metric = (typeof METRICS)[number];

/**
 * Admin: training outcome analytics (F20). Compare completion rate, average score and attendance
 * across courses and batches (BRQ-20.1), competency achievement per course (BRQ-20.2), and
 * record and report placements (BRQ-20.3). Figures come from nightly views; "Refresh now"
 * rebuilds them on demand.
 */
export function AnalyticsPage() {
  const { t, i18n } = useTranslation('analytics');
  const lng = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const cycles = useAdminCycles();
  const [cycleId, setCycleId] = useState('');
  const [metric, setMetric] = useState<Metric>('completionRate');
  const outcomes = useOutcomes(cycleId || undefined);
  const refresh = useRefreshAnalytics();
  const pct = (v: number | null) => (v === null ? t('none') : `${v.toFixed(2)} %`);

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (r) =>
        toast.show({
          tone: r.refreshed ? 'success' : 'info',
          title: r.refreshed ? t('refreshed') : t('refreshBusy'),
        }),
      onError: (err) => toast.show({ tone: 'error', title: errorMessage(err) }),
    });

  const courseColumns: Column<CourseOutcome>[] = [
    { key: 'course', header: t('cols.course'), render: (c) => c.courseTitle },
    { key: 'students', header: t('cols.students'), align: 'right', render: (c) => c.students },
    {
      key: 'completion',
      header: t('metric.completionRate'),
      align: 'right',
      render: (c) => pct(c.completionRate),
    },
    {
      key: 'score',
      header: t('metric.averageScore'),
      align: 'right',
      render: (c) => pct(c.averageScore),
    },
    {
      key: 'attendance',
      header: t('metric.attendanceRate'),
      align: 'right',
      render: (c) => pct(c.attendanceRate),
    },
    {
      key: 'competency',
      header: t('metric.competencyAchievement'),
      align: 'right',
      render: (c) => pct(c.competencyAchievement),
    },
    {
      key: 'placed',
      header: t('metric.placementRate'),
      align: 'right',
      render: (c) => `${pct(c.placementRate)} (${c.placed})`,
    },
  ];
  const batchColumns: Column<BatchOutcome>[] = [
    {
      key: 'batch',
      header: t('cols.batch'),
      render: (b) => (
        <span>
          <span className="font-medium text-slate-900">{b.batchName}</span>
          <span className="block text-xs text-slate-600">
            {b.courseTitle} · {b.cycleName}
          </span>
        </span>
      ),
    },
    { key: 'students', header: t('cols.students'), align: 'right', render: (b) => b.students },
    {
      key: 'completion',
      header: t('metric.completionRate'),
      align: 'right',
      render: (b) => pct(b.completionRate),
    },
    {
      key: 'score',
      header: t('metric.averageScore'),
      align: 'right',
      render: (b) => pct(b.averageScore),
    },
    {
      key: 'attendance',
      header: t('metric.attendanceRate'),
      align: 'right',
      render: (b) => pct(b.attendanceRate),
    },
    { key: 'placed', header: t('cols.placed'), align: 'right', render: (b) => b.placed },
  ];

  const o = outcomes.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={refresh.isPending} onClick={onRefresh}>
            {t('refresh')}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void downloadOutcomesCsv(cycleId || undefined).catch((err: unknown) =>
                toast.show({ tone: 'error', title: errorMessage(err) }),
              )
            }
          >
            {t('exportCsv')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Select
            label={t('cycle')}
            value={cycleId}
            onChange={(e) => setCycleId(e.target.value)}
            options={[
              { value: '', label: t('allCycles') },
              ...(cycles.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        {o && (
          <p className="text-sm text-slate-600" data-testid="refreshed-at">
            {o.refreshedAt
              ? t('asOf', { when: formatDate(o.refreshedAt, lng, true) })
              : t('neverRefreshed')}
          </p>
        )}
        {o && o.certificatesSinceRefresh > 0 && (
          <p
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"
          >
            {t('staleCertificates', { count: o.certificatesSinceRefresh })}
          </p>
        )}
      </div>

      {outcomes.isPending ? (
        <Spinner />
      ) : outcomes.isError ? (
        <EmptyState title={errorMessage(outcomes.error)} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              testId="tile-completion"
              label={t('metric.completionRate')}
              value={pct(o!.totals.completionRate)}
              detail={t('tiles.completion', {
                completed: o!.totals.completed,
                notCompleted: o!.totals.notCompleted,
              })}
            />
            <StatTile label={t('metric.averageScore')} value={pct(o!.totals.averageScore)} />
            <StatTile label={t('metric.attendanceRate')} value={pct(o!.totals.attendanceRate)} />
            <StatTile
              label={t('metric.placementRate')}
              value={pct(o!.totals.placementRate)}
              detail={t('tiles.placed', { count: o!.totals.placed })}
            />
          </div>

          <Card title={t('byCourse')} headingLevel={2} data-testid="course-outcomes">
            {o!.courses.length === 0 ? (
              <EmptyState title={t('noData')} description={t('noDataHint')} />
            ) : (
              <>
                <div className="mb-3 w-72 max-w-full">
                  <Select
                    label={t('metricLabel')}
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as Metric)}
                    options={METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
                  />
                </div>
                <div aria-hidden="true" className="h-72">
                  <Suspense fallback={<Spinner />}>
                    <OutcomeChart
                      metricLabel={t(`metric.${metric}`)}
                      noDataLabel={t('chartNoData')}
                      rows={o!.courses.map((c) => ({ label: c.courseTitle, value: c[metric] }))}
                    />
                  </Suspense>
                </div>
                <div className="mt-4">
                  <Table
                    caption={t('byCourse')}
                    columns={courseColumns}
                    rows={o!.courses}
                    rowKey={(c) => c.courseId}
                  />
                </div>
              </>
            )}
          </Card>

          <Card title={t('byBatch')} headingLevel={2}>
            <Table
              caption={t('byBatch')}
              columns={batchColumns}
              rows={o!.batches}
              rowKey={(b) => b.batchId}
              empty={<EmptyState title={t('noData')} />}
            />
          </Card>
        </>
      )}

      <Placements />
    </div>
  );
}

function Placements() {
  const { t, i18n } = useTranslation('analytics');
  const lng = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [page, setPage] = useState(1);
  const list = usePlacements(page);
  const remove = useDeletePlacement();
  const [adding, setAdding] = useState(false);
  const nf = new Intl.NumberFormat(lng, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

  const columns: Column<PlacementDto>[] = [
    {
      key: 'student',
      header: t('placements.student'),
      render: (p) => (
        <span>
          <span className="font-medium text-slate-900">{p.student.fullName}</span>
          <span className="block text-xs text-slate-600">
            {p.student.rollNo} · {p.courseTitle}
          </span>
        </span>
      ),
    },
    { key: 'type', header: t('placements.type'), render: (p) => t(`placementType.${p.type}`) },
    {
      key: 'employer',
      header: t('placements.employer'),
      render: (p) => (
        <span>
          {p.employer}
          <span className="block text-xs text-slate-600">{p.roleTitle}</span>
        </span>
      ),
    },
    { key: 'on', header: t('placements.placedOn'), render: (p) => formatDay(p.placedOn, lng) },
    {
      key: 'income',
      header: t('placements.income'),
      align: 'right',
      render: (p) => (p.monthlyIncome === null ? t('none') : nf.format(p.monthlyIncome)),
    },
    {
      key: 'delete',
      header: <span className="sr-only">{t('placements.delete')}</span>,
      align: 'right',
      render: (p) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('placements.deleteFor', { name: p.student.fullName })}
          onClick={() =>
            remove.mutate(p.id, {
              onSuccess: () => toast.show({ tone: 'success', title: t('placements.deleted') }),
              onError: (err) => toast.show({ tone: 'error', title: errorMessage(err) }),
            })
          }
        >
          {t('placements.delete')}
        </Button>
      ),
    },
  ];

  const meta = list.data?.meta;
  return (
    <Card
      title={t('placements.title')}
      headingLevel={2}
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          {t('placements.add')}
        </Button>
      }
    >
      <p className="-mt-2 mb-3 text-sm text-slate-600">{t('placements.intro')}</p>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <EmptyState title={errorMessage(list.error)} />
      ) : (
        <Table
          caption={t('placements.title')}
          columns={columns}
          rows={list.data.data}
          rowKey={(p) => p.id}
          empty={<EmptyState title={t('placements.none')} />}
        />
      )}
      {meta && meta.totalPages > 1 && (
        <nav className="mt-3 flex items-center gap-3" aria-label={t('placements.title')}>
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('previous')}
          </Button>
          <span className="text-sm text-slate-700">
            {t('page', { page: meta.page, pages: meta.totalPages })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('next')}
          </Button>
        </nav>
      )}
      {adding && <PlacementForm onClose={() => setAdding(false)} />}
    </Card>
  );
}

function PlacementForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('analytics');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const create = useCreatePlacement();
  const [rollNo, setRollNo] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<PlacementCandidate[] | null>(null);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [type, setType] = useState<PlacementType>('JOB');
  const [employer, setEmployer] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [placedOn, setPlacedOn] = useState(new Date().toISOString().slice(0, 10));
  const [income, setIncome] = useState('');

  const search = async () => {
    setSearching(true);
    try {
      const list = await findCandidates(rollNo.trim());
      setFound(list);
      setEnrollmentId(list[0]?.enrollmentId ?? '');
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    try {
      await create.mutateAsync({
        enrollmentId,
        type,
        employer: employer.trim(),
        roleTitle: roleTitle.trim(),
        placedOn,
        ...(income.trim() ? { monthlyIncome: Number(income) } : {}),
      });
      toast.show({ tone: 'success', title: t('placements.saved') });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('placements.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button loading={create.isPending} disabled={!enrollmentId} onClick={() => void save()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={t('placements.rollNo')}
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            loading={searching}
            disabled={!rollNo.trim()}
            onClick={() => void search()}
          >
            {t('placements.find')}
          </Button>
        </div>
        {found && found.length === 0 && (
          <p role="status" className="text-sm text-slate-700">
            {t('placements.noneFinished')}
          </p>
        )}
        {found && found.length > 0 && (
          <>
            <Select
              label={t('placements.training')}
              value={enrollmentId}
              onChange={(e) => setEnrollmentId(e.target.value)}
              options={found.map((c) => ({
                value: c.enrollmentId,
                label: `${c.student.fullName} · ${c.courseTitle} · ${c.batchName}`,
              }))}
            />
            <Select
              label={t('placements.type')}
              value={type}
              onChange={(e) => setType(e.target.value as PlacementType)}
              options={PLACEMENT_TYPES.map((v) => ({ value: v, label: t(`placementType.${v}`) }))}
            />
            <Input
              label={t('placements.employer')}
              value={employer}
              onChange={(e) => setEmployer(e.target.value)}
            />
            <Input
              label={t('placements.role')}
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
            />
            <Input
              label={t('placements.placedOn')}
              type="date"
              value={placedOn}
              onChange={(e) => setPlacedOn(e.target.value)}
            />
            <Input
              label={t('placements.incomeLabel')}
              type="number"
              min={0}
              inputMode="numeric"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
