import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminCourse, Offering } from '@vtmp/shared';
import {
  Badge,
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
import { oneOf, usePersistentState } from '../../lib/usePersistentState';
import { useSelection } from '../../lib/useSelection';
import { WindowBadge } from '../catalogue/WindowBadge';
import {
  useAdminCourses,
  useAdminCycles,
  useDeleteCourse,
  useOfferings,
  useSetCoursesActive,
  useUpdateCourse,
} from './api';
import { CourseFormModal, CycleFormModal, WindowFormModal } from './forms';

/** Admin: courses (BRQ-2.1) and cycles with per-course enrollment windows (BRQ-2.3). */
export function AdminCoursesPage() {
  const { t } = useTranslation('courses');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('admin.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-700">{t('admin.intro')}</p>
      </div>
      <CoursesSection />
      <CyclesSection />
    </div>
  );
}

const COURSE_STATUSES = ['active', 'inactive', 'all'] as const;
type CourseStatusFilter = (typeof COURSE_STATUSES)[number];

function CoursesSection() {
  const { t } = useTranslation(['courses', 'common']);
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const { data, isPending, isError, error } = useAdminCourses();
  const update = useUpdateCourse();
  const setActive = useSetCoursesActive();
  const remove = useDeleteCourse();
  const [editing, setEditing] = useState<AdminCourse | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminCourse | null>(null);
  // D4: courses about to be deactivated that still have batches, students or open windows.
  const [confirmingOff, setConfirmingOff] = useState<{
    courses: AdminCourse[];
    bulk: boolean;
  } | null>(null);
  const inUse = (c: AdminCourse) =>
    c.inUse.batches > 0 || c.inUse.students > 0 || c.inUse.openWindows > 0;
  const [search, setSearch] = useState('');
  // Inactive courses are hidden by default so the list stays short; this device remembers it.
  const [status, setStatus] = usePersistentState<CourseStatusFilter>(
    'admin-courses.status',
    'active',
    oneOf(...COURSE_STATUSES),
  );
  const { selected, toggle: toggleRow, toggleAll, clear } = useSelection();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (status === 'all' || c.isActive === (status === 'active')) &&
        (!q || `${c.title} ${c.code}`.toLowerCase().includes(q)),
    );
  }, [data, search, status]);
  // A new result set clears the selection so bulk actions never hit rows the admin can't see.
  useEffect(clear, [search, status, clear]);
  const visibleIds = rows.map((c) => c.id);
  const selectedIds = visibleIds.filter((id) => selected.has(id));
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  const toggle = async (c: AdminCourse, confirmed = false) => {
    if (c.isActive && !confirmed && inUse(c)) {
      return setConfirmingOff({ courses: [c], bulk: false });
    }
    try {
      await update.mutateAsync({ id: c.id, isActive: !c.isActive });
      toast.show({
        tone: 'success',
        title: t(c.isActive ? 'admin.courseDeactivated' : 'admin.courseReactivated', {
          title: c.title,
        }),
      });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  const bulk = async (isActive: boolean, confirmed = false) => {
    const affected = (data ?? []).filter(
      (c) => selectedIds.includes(c.id) && c.isActive && inUse(c),
    );
    if (!isActive && !confirmed && affected.length > 0) {
      return setConfirmingOff({ courses: affected, bulk: true });
    }
    try {
      const { updated } = await setActive.mutateAsync({ ids: selectedIds, isActive });
      toast.show({
        tone: 'success',
        title: t(isActive ? 'admin.bulkReactivated' : 'admin.bulkDeactivated', { count: updated }),
      });
      clear();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  const confirmDelete = async (c: AdminCourse) => {
    try {
      await remove.mutateAsync(c.id);
      toast.show({ tone: 'success', title: t('admin.courseDeleted', { title: c.title }) });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setDeleting(null);
    }
  };

  const columns: Column<AdminCourse>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={t('admin.selectAll')}
          checked={allSelected}
          disabled={rows.length === 0}
          onChange={() => toggleAll(visibleIds)}
          className="h-4 w-4 rounded border-slate-400"
        />
      ),
      render: (c) => (
        <input
          type="checkbox"
          aria-label={t('admin.selectRow', { title: c.title })}
          checked={selected.has(c.id)}
          onChange={() => toggleRow(c.id)}
          className="h-4 w-4 rounded border-slate-400"
        />
      ),
    },
    {
      key: 'code',
      header: t('fields.code'),
      render: (c) => <span className="font-mono">{c.code}</span>,
    },
    {
      key: 'title',
      header: t('fields.title'),
      render: (c) => <span className="font-medium">{c.title}</span>,
    },
    {
      key: 'duration',
      header: t('fields.duration'),
      render: (c) => t('fields.durationValue', { count: c.durationWeeks }),
    },
    {
      key: 'seats',
      header: t('fields.seatCapacity'),
      align: 'right',
      render: (c) => c.seatCapacity,
    },
    {
      key: 'status',
      header: t('fields.status'),
      render: (c) => (
        <Badge tone={c.isActive ? 'success' : 'neutral'}>
          {c.isActive ? t('admin.active') : t('admin.inactive')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('admin.actions')}</span>,
      align: 'right',
      render: (c) => (
        <div className="flex flex-wrap justify-end gap-2 sm:flex-nowrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(c);
              setFormOpen(true);
            }}
            aria-label={t('admin.editCourseFor', { title: c.title })}
          >
            {t('admin.editCourse')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void toggle(c)}
            aria-label={`${c.isActive ? t('admin.deactivate') : t('admin.reactivate')}: ${c.title}`}
          >
            {c.isActive ? t('admin.deactivate') : t('admin.reactivate')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleting(c)}
            aria-label={`${t('admin.delete')}: ${c.title}`}
          >
            {t('admin.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title={t('admin.coursesHeading')}
      actions={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          {t('admin.addCourse')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            label={t('admin.searchCourses')}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            label={t('fields.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as CourseStatusFilter)}
            options={COURSE_STATUSES.map((s) => ({ value: s, label: t(`admin.show.${s}`) }))}
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
            <Button size="sm" onClick={() => void bulk(false)} loading={setActive.isPending}>
              {t('admin.deactivateSelected')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void bulk(true)}>
              {t('admin.reactivateSelected')}
            </Button>
            <Button size="sm" variant="ghost" onClick={clear}>
              {t('admin.clearSelection')}
            </Button>
          </div>
        )}

        {isPending ? (
          <Spinner />
        ) : isError ? (
          <EmptyState title={errorMessage(error)} />
        ) : (
          <Table
            caption={t('admin.coursesCaption')}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            empty={<EmptyState title={t('admin.noCoursesMatch')} />}
          />
        )}
      </div>
      <CourseFormModal open={formOpen} course={editing} onClose={() => setFormOpen(false)} />
      <Modal
        open={!!confirmingOff}
        onClose={() => setConfirmingOff(null)}
        title={t('admin.confirmDeactivate.title', { count: confirmingOff?.courses.length ?? 0 })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingOff(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={update.isPending || setActive.isPending}
              onClick={() => {
                const pending = confirmingOff;
                setConfirmingOff(null);
                if (!pending) return;
                if (pending.bulk) void bulk(false, true);
                else void toggle(pending.courses[0]!, true);
              }}
            >
              {t('admin.confirmDeactivate.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('admin.confirmDeactivate.body')}</p>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-slate-800">
          {(confirmingOff?.courses ?? []).map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.title}</span>
              {': '}
              {t('admin.confirmDeactivate.usage', {
                batches: c.inUse.batches,
                students: c.inUse.students,
                windows: c.inUse.openWindows,
              })}
            </li>
          ))}
        </ul>
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('admin.confirmDelete.title', { title: deleting?.title ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && void confirmDelete(deleting)}
            >
              {t('admin.confirmDelete.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('admin.confirmDelete.body')}</p>
      </Modal>
    </Card>
  );
}

function CyclesSection() {
  const { t, i18n } = useTranslation('courses');
  const lng = i18n.resolvedLanguage ?? 'en';
  const errorMessage = useErrorMessage();
  const cycles = useAdminCycles();
  const [cycleId, setCycleId] = useState<string>();
  const [cycleFormOpen, setCycleFormOpen] = useState(false);
  const [target, setTarget] = useState<{ course: AdminCourse; offering: Offering | null } | null>(
    null,
  );
  const offerings = useOfferings(cycleId);

  useEffect(() => {
    if (!cycleId && cycles.data?.[0]) setCycleId(cycles.data[0].id);
  }, [cycleId, cycles.data]);

  const cycle = cycles.data?.find((c) => c.id === cycleId);
  type Row = { course: AdminCourse; offering: Offering | null };
  const columns: Column<Row>[] = [
    {
      key: 'course',
      header: t('fields.title'),
      render: (r) => <span className="font-medium">{r.course.title}</span>,
    },
    {
      key: 'state',
      header: t('fields.window'),
      render: (r) => <WindowBadge offering={r.offering} />,
    },
    {
      key: 'dates',
      header: t('admin.opensAt'),
      render: (r) =>
        r.offering
          ? t('window.range', {
              from: formatDate(r.offering.enrollmentOpensAt, lng, true),
              to: formatDate(r.offering.enrollmentClosesAt, lng, true),
            })
          : '—',
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('admin.editWindow')}</span>,
      align: 'right',
      render: (r) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTarget(r)}
          aria-label={t('admin.editWindowFor', { title: r.course.title })}
        >
          {r.offering ? t('admin.editWindow') : t('admin.offer')}
        </Button>
      ),
    },
  ];

  return (
    <Card
      title={t('admin.cyclesHeading')}
      actions={
        <Button size="sm" onClick={() => setCycleFormOpen(true)}>
          {t('admin.addCycle')}
        </Button>
      }
    >
      {cycles.isPending ? (
        <Spinner />
      ) : cycles.isError ? (
        <EmptyState title={errorMessage(cycles.error)} />
      ) : cycles.data.length === 0 ? (
        <EmptyState title={t('admin.noCycles')} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 sm:max-w-sm">
            <Select
              label={t('admin.selectCycle')}
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              options={cycles.data.map((c) => ({ value: c.id, label: c.name }))}
            />
            {cycle && (
              <p className="text-xs text-slate-600">
                {t('window.range', {
                  from: formatDay(cycle.startsOn, lng),
                  to: formatDay(cycle.endsOn, lng),
                })}
              </p>
            )}
          </div>
          {offerings.isPending ? (
            <Spinner />
          ) : offerings.isError ? (
            <EmptyState title={errorMessage(offerings.error)} />
          ) : (
            <Table
              caption={t('admin.offeringsCaption')}
              columns={columns}
              rows={offerings.data.filter((r) => r.course.isActive || r.offering)}
              rowKey={(r) => r.course.id}
            />
          )}
        </div>
      )}
      <CycleFormModal
        open={cycleFormOpen}
        onClose={() => setCycleFormOpen(false)}
        onCreated={setCycleId}
      />
      {cycleId && (
        <WindowFormModal target={target} cycleId={cycleId} onClose={() => setTarget(null)} />
      )}
    </Card>
  );
}
