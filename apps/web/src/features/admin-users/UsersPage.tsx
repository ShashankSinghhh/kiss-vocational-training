import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLES, type UserSummary } from '@vtmp/shared';
import {
  Badge,
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
import { useAuth } from '../../lib/auth';
import { usePersistentState } from '../../lib/usePersistentState';
import { useSelection } from '../../lib/useSelection';
import {
  useDeleteUser,
  useSetUsersActive,
  useUnlockUser,
  useUpdateUser,
  useUsers,
  type UserFilters,
} from './api';
import { CreateUserModal } from './CreateUserModal';
import { ResetPasswordModal } from './ResetPasswordModal';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const isSavedFilters = (v: unknown): v is Pick<UserFilters, 'role' | 'isActive'> => {
  const f = v as Partial<UserFilters> | null;
  return (
    !!f &&
    ['', ...ROLES].includes(f.role as string) &&
    ['', 'true', 'false'].includes(f.isActive as string)
  );
};

export function UsersPage() {
  const { t } = useTranslation(['users', 'common']);
  const { user: me } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [search, setSearch] = useState('');
  // Role and status filters are remembered on this device; inactive accounts are hidden by
  // default so the list shows the people who actually use the portal.
  const [saved, setSaved] = usePersistentState<Pick<UserFilters, 'role' | 'isActive'>>(
    'admin-users.filters',
    { role: '', isActive: 'true' },
    isSavedFilters,
  );
  const [filters, setFilters] = useState<UserFilters>({ page: 1, q: '', ...saved });
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState<UserSummary | null>(null);
  const [resetting, setResetting] = useState<UserSummary | null>(null);
  const update = useUpdateUser();
  const setMany = useSetUsersActive();
  const remove = useDeleteUser();
  const unlock = useUnlockUser();
  const isLocked = (u: UserSummary) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();

  const doUnlock = async (target: UserSummary) => {
    try {
      await unlock.mutateAsync(target.id);
      toast.show({ tone: 'success', title: t('unlocked', { name: target.fullName }) });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };
  const { selected, toggle, toggleAll, clear } = useSelection();

  const q = useDebounced(search, 300);
  useEffect(() => setFilters((f) => ({ ...f, q, page: 1 })), [q]);
  useEffect(
    () => setSaved({ role: filters.role, isActive: filters.isActive }),
    [filters.role, filters.isActive, setSaved],
  );
  // A new result set clears the selection so bulk actions never hit rows the admin can't see.
  useEffect(clear, [filters, clear]);

  const { data, isPending, isError, error, isFetching } = useUsers(filters);
  const selectable = (data?.data ?? []).filter((u) => u.id !== me?.id);
  const selectableIds = selectable.map((u) => u.id);
  const selectedIds = selectableIds.filter((id) => selected.has(id));
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;

  const bulk = async (isActive: boolean) => {
    try {
      const { updated } = await setMany.mutateAsync({ ids: selectedIds, isActive });
      toast.show({
        tone: 'success',
        title: t(isActive ? 'bulkReactivated' : 'bulkDeactivated', { count: updated }),
      });
      clear();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  const confirmDelete = async (target: UserSummary) => {
    try {
      await remove.mutateAsync(target.id);
      toast.show({ tone: 'success', title: t('deleted', { name: target.fullName }) });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setDeleting(null);
    }
  };

  const setActive = async (target: UserSummary, isActive: boolean) => {
    try {
      await update.mutateAsync({ id: target.id, isActive });
      toast.show({
        tone: 'success',
        title: t(isActive ? 'reactivated' : 'deactivated', { name: target.fullName }),
      });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setConfirming(null);
    }
  };

  const status = (u: UserSummary) => {
    if (!u.isActive) return <Badge tone="neutral">{t('status.inactive')}</Badge>;
    if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) {
      return <Badge tone="warning">{t('status.locked')}</Badge>;
    }
    return <Badge tone="success">{t('status.active')}</Badge>;
  };

  const columns: Column<UserSummary>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={t('selectAll')}
          checked={allSelected}
          disabled={selectable.length === 0}
          onChange={() => toggleAll(selectableIds)}
          className="h-4 w-4 rounded border-slate-400"
        />
      ),
      render: (u) =>
        u.id === me?.id ? null : (
          <input
            type="checkbox"
            aria-label={t('selectRow', { name: u.fullName })}
            checked={selected.has(u.id)}
            onChange={() => toggle(u.id)}
            className="h-4 w-4 rounded border-slate-400"
          />
        ),
    },
    {
      key: 'name',
      header: t('columns.name'),
      render: (u) => <span className="font-medium text-slate-900">{u.fullName}</span>,
    },
    { key: 'email', header: t('columns.email'), render: (u) => u.email },
    { key: 'role', header: t('columns.role'), render: (u) => t(`common:roles.${u.role}`) },
    { key: 'id', header: t('columns.id'), render: (u) => u.rollNo ?? u.employeeCode ?? '—' },
    { key: 'status', header: t('columns.status'), render: status },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'right',
      render: (u) =>
        u.id === me?.id ? null : (
          <div className="flex flex-wrap justify-end gap-2 sm:flex-nowrap">
            {u.isActive ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirming(u)}
                aria-label={`${t('deactivate')}: ${u.fullName}`}
              >
                {t('deactivate')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void setActive(u, true)}
                aria-label={`${t('reactivate')}: ${u.fullName}`}
              >
                {t('reactivate')}
              </Button>
            )}
            {u.isActive && isLocked(u) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void doUnlock(u)}
                aria-label={`${t('unlock')}: ${u.fullName}`}
              >
                {t('unlock')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setResetting(u)}
              aria-label={`${t('resetPassword.action')}: ${u.fullName}`}
            >
              {t('resetPassword.action')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(u)}
              aria-label={`${t('delete')}: ${u.fullName}`}
            >
              {t('delete')}
            </Button>
          </div>
        ),
    },
  ];

  const meta = data?.meta;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">{t('intro')}</p>
        </div>
        <Button onClick={() => setCreating(true)}>{t('create')}</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Input
          label={t('search')}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label={t('roleFilter')}
          value={filters.role}
          onChange={(e) =>
            setFilters((f) => ({ ...f, page: 1, role: e.target.value as UserFilters['role'] }))
          }
          options={[
            { value: '', label: t('allRoles') },
            ...ROLES.map((r) => ({ value: r, label: t(`common:roles.${r}`) })),
          ]}
        />
        <Select
          label={t('statusFilter')}
          value={filters.isActive}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              page: 1,
              isActive: e.target.value as UserFilters['isActive'],
            }))
          }
          options={[
            { value: '', label: t('allStatuses') },
            { value: 'true', label: t('status.active') },
            { value: 'false', label: t('status.inactive') },
          ]}
        />
      </div>

      {selectedIds.length > 0 && (
        <div
          role="region"
          aria-label={t('selected', { count: selectedIds.length })}
          className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3"
        >
          <span className="text-sm font-medium text-brand-900">
            {t('selected', { count: selectedIds.length })}
          </span>
          <Button size="sm" onClick={() => void bulk(false)} loading={setMany.isPending}>
            {t('deactivateSelected')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void bulk(true)}>
            {t('reactivateSelected')}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('clearSelection')}
          </Button>
        </div>
      )}

      {isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <EmptyState title={errorMessage(error)} />
      ) : (
        <div aria-busy={isFetching} className="flex flex-col gap-3">
          <Table
            caption={t('caption')}
            columns={columns}
            rows={data.data}
            rowKey={(u) => u.id}
            empty={<EmptyState title={t('empty')} />}
          />
          {meta && meta.total > 0 && (
            <nav
              aria-label={t('pagination.label')}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <p className="text-slate-700">{t('pagination.summary', meta)}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={meta.page <= 1}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                >
                  {t('pagination.previous')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  {t('pagination.next')}
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={t('confirmDeactivate.title', { name: confirming?.fullName ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={update.isPending}
              onClick={() => confirming && void setActive(confirming, false)}
            >
              {t('confirmDeactivate.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('confirmDeactivate.body')}</p>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('confirmDelete.title', { name: deleting?.fullName ?? '' })}
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
              {t('confirmDelete.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('confirmDelete.body')}</p>
      </Modal>
    </div>
  );
}
