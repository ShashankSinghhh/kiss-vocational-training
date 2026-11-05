import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ENROLLMENT_STATUSES, type AdminEnrollmentRow, type ReviewAction } from '@vtmp/shared';
import {
  Button,
  EmptyState,
  Input,
  Modal,
  PageSkeleton,
  Select,
  Table,
  type Column,
} from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { formatDate } from '../../lib/format';
import { oneOf, usePersistentState } from '../../lib/usePersistentState';
import { useAdminCourses, useAdminCycles } from '../admin-courses/api';
import { StatusBadge } from '../enrollment/StatusBadge';
import { useAdminEnrollments, useReview, type EnrollmentFilters } from './api';
import { AutoApprovalCard } from './AutoApprovalCard';

const REVIEWABLE = new Set(['PENDING', 'WAITLISTED']);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Admin review queue (BRQ-3.3): filters, single and bulk approve / reject / waitlist. */
export function AdminEnrollmentsPage() {
  const { t, i18n } = useTranslation('enrollment');
  const lng = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const cycles = useAdminCycles();
  const courses = useAdminCourses();
  const review = useReview();

  // The status filter is remembered on this device (default: applications waiting for review).
  const [savedStatus, setSavedStatus] = usePersistentState<EnrollmentFilters['status']>(
    'admin-enrollments.status',
    'PENDING',
    oneOf('', ...ENROLLMENT_STATUSES),
  );
  const [filters, setFilters] = useState<EnrollmentFilters>({
    page: 1,
    courseId: '',
    status: savedStatus,
    q: '',
  });
  useEffect(() => setSavedStatus(filters.status), [filters.status, setSavedStatus]);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonFor, setReasonFor] = useState<{ ids: string[]; action: ReviewAction } | null>(null);

  useEffect(() => setFilters((f) => ({ ...f, q, page: 1 })), [q]);
  useEffect(() => {
    if (!filters.cycleId && cycles.data?.[0]) {
      setFilters((f) => ({ ...f, cycleId: cycles.data![0]!.id }));
    }
  }, [filters.cycleId, cycles.data]);
  // A new result set clears the selection so bulk actions never hit rows the admin can't see.
  useEffect(() => setSelected(new Set()), [filters]);

  const list = useAdminEnrollments(filters);
  const rows = list.data?.data ?? [];
  const selectable = rows.filter((r) => REVIEWABLE.has(r.status));
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  const run = async (ids: string[], action: ReviewAction, reason?: string) => {
    try {
      const count = await review.mutateAsync({ ids, action, reason });
      toast.show({ tone: 'success', title: t(`admin.done.${action}`, { count }) });
      setSelected(new Set());
      setReasonFor(null);
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };
  const act = (ids: string[], action: ReviewAction) =>
    action === 'APPROVE' ? void run(ids, action) : setReasonFor({ ids, action });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: Column<AdminEnrollmentRow>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={t('admin.selectAll')}
          checked={allSelected}
          disabled={selectable.length === 0}
          onChange={() =>
            setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))
          }
          className="h-4 w-4 rounded border-slate-400"
        />
      ),
      render: (r) =>
        REVIEWABLE.has(r.status) ? (
          <input
            type="checkbox"
            aria-label={t('admin.selectRow', { name: r.student.fullName })}
            checked={selected.has(r.id)}
            onChange={() => toggle(r.id)}
            className="h-4 w-4 rounded border-slate-400"
          />
        ) : null,
    },
    {
      key: 'student',
      header: t('admin.columns.student'),
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.student.fullName}</p>
          <p className="text-xs text-slate-600">
            {r.student.rollNo} · {r.student.email}
          </p>
        </div>
      ),
    },
    {
      key: 'prefs',
      header: t('admin.columns.preferences'),
      render: (r) => (
        <ol className="list-decimal pl-4 text-xs">
          {r.preferences.map((p) => (
            <li key={p.courseId}>{p.courseTitle}</li>
          ))}
        </ol>
      ),
    },
    {
      key: 'submitted',
      header: t('admin.columns.submitted'),
      render: (r) => <span className="text-xs">{formatDate(r.submittedAt, lng, true)}</span>,
    },
    {
      key: 'status',
      header: t('admin.columns.status'),
      render: (r) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={r.status} />
          {r.reason && <span className="text-xs text-slate-600">{r.reason}</span>}
          {r.needsReview?.map((n) => (
            <span key={`${n.code}-${n.course}`} className="text-xs text-amber-800">
              {t('admin.needsReview.prerequisites', { course: n.course })}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('admin.columns.actions')}</span>,
      align: 'right',
      render: (r) =>
        REVIEWABLE.has(r.status) ? (
          <div className="flex flex-wrap justify-end gap-1">
            <Button
              size="sm"
              onClick={() => act([r.id], 'APPROVE')}
              aria-label={t('admin.approveFor', { name: r.student.fullName })}
            >
              {t('admin.approve')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => act([r.id], 'REJECT')}
              aria-label={t('admin.rejectFor', { name: r.student.fullName })}
            >
              {t('admin.reject')}
            </Button>
            {r.status === 'PENDING' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => act([r.id], 'WAITLIST')}
                aria-label={t('admin.waitlistFor', { name: r.student.fullName })}
              >
                {t('admin.waitlist')}
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  const meta = list.data?.meta;
  const selectedIds = [...selected];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('admin.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-700">{t('admin.intro')}</p>
      </div>

      <AutoApprovalCard
        cycleId={filters.cycleId}
        cycleName={cycles.data?.find((c) => c.id === filters.cycleId)?.name ?? ''}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label={t('admin.cycle')}
          value={filters.cycleId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, page: 1, cycleId: e.target.value }))}
          options={(cycles.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label={t('admin.course')}
          value={filters.courseId}
          onChange={(e) => setFilters((f) => ({ ...f, page: 1, courseId: e.target.value }))}
          options={[
            { value: '', label: t('admin.allCourses') },
            ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.title })),
          ]}
        />
        <Select
          label={t('admin.status')}
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              page: 1,
              status: e.target.value as EnrollmentFilters['status'],
            }))
          }
          options={[
            { value: '', label: t('admin.allStatuses') },
            ...ENROLLMENT_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
          ]}
        />
        <Input
          label={t('admin.search')}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {selectedIds.length > 0 && (
        <div
          role="region"
          aria-label={t('admin.selected', { count: selectedIds.length })}
          className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3"
        >
          <span className="text-sm font-medium text-brand-900">
            {t('admin.selected', { count: selectedIds.length })}
          </span>
          <Button size="sm" onClick={() => act(selectedIds, 'APPROVE')} loading={review.isPending}>
            {t('admin.approve')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act(selectedIds, 'REJECT')}>
            {t('admin.reject')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act(selectedIds, 'WAITLIST')}>
            {t('admin.waitlist')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('admin.clearSelection')}
          </Button>
        </div>
      )}

      {list.isPending ? (
        <PageSkeleton />
      ) : list.isError ? (
        <EmptyState title={errorMessage(list.error)} />
      ) : (
        <div aria-busy={list.isFetching} className="flex flex-col gap-3">
          <Table
            caption={t('admin.caption')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title={t('admin.empty')} />}
          />
          {meta && meta.total > 0 && (
            <nav
              aria-label={t('admin.pagination.label')}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <p className="text-slate-700">{t('admin.pagination.summary', meta)}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={meta.page <= 1}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                >
                  {t('admin.pagination.previous')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  {t('admin.pagination.next')}
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

      <ReasonModal
        target={reasonFor}
        loading={review.isPending}
        onCancel={() => setReasonFor(null)}
        onConfirm={(reason) => reasonFor && void run(reasonFor.ids, reasonFor.action, reason)}
      />
    </div>
  );
}

function ReasonModal({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: { ids: string[]; action: ReviewAction } | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  const { t } = useTranslation('enrollment');
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const required = target?.action === 'REJECT';

  useEffect(() => {
    setReason('');
    setError(false);
  }, [target]);

  const confirm = () => {
    const value = reason.trim();
    if ((required || value) && value.length < 3) return setError(true);
    onConfirm(value || undefined);
  };

  return (
    <Modal
      open={!!target}
      onClose={onCancel}
      title={target ? t(`admin.reasonTitle.${target.action}`, { count: target.ids.length }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('admin.cancel')}
          </Button>
          <Button variant={required ? 'danger' : 'primary'} loading={loading} onClick={confirm}>
            {t('admin.confirm')}
          </Button>
        </>
      }
    >
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {t('admin.reasonLabel')}
        {!required && (
          <span className="ml-1 font-normal text-slate-600">({t('admin.reasonOptional')})</span>
        )}
      </label>
      <textarea
        id={id}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      />
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-red-700">
          {t('admin.reasonRequired')}
        </p>
      )}
    </Modal>
  );
}
