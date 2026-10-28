import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CompletionRow, EligibilityCheck } from '@vtmp/shared';
import {
  Button,
  EmptyState,
  Modal,
  Select,
  Spinner,
  Table,
  type Column,
} from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useAdminCycles } from '../admin-courses/api';
import { useAdminBatches, useBatch } from '../batches/api';
import { StatusBadge } from '../enrollment/StatusBadge';
import {
  downloadCertificate,
  useApprove,
  useCompletionQueue,
  useNotCompleted,
  useRetryRender,
} from './api';

const pct = (n: number | null) => (n === null ? null : `${n.toFixed(2)} %`);
const canApprove = (r: CompletionRow) =>
  r.eligible && (r.status === 'ACTIVE' || r.status === 'NOT_COMPLETED');

/** Admin: completion queue per batch with the BR-09 checklist (BRQ-7.1, BRQ-9.4). */
export function CompletionPage() {
  const { t } = useTranslation('completion');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const batchId = params.get('batch') ?? '';
  const linked = useBatch(batchId);
  const cycles = useAdminCycles();
  const [cycleId, setCycleId] = useState<string>();
  const batches = useAdminBatches({ cycleId });
  const queue = useCompletionQueue(batchId || undefined);
  const approve = useApprove();
  const retry = useRetryRender();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<CompletionRow | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // Cycle follows a linked batch (?batch=), else the first cycle.
  useEffect(() => {
    if (linked.data) setCycleId(linked.data.cycleId);
    else if (!batchId && !cycleId && cycles.data?.[0]) setCycleId(cycles.data[0].id);
  }, [linked.data, batchId, cycleId, cycles.data]);
  useEffect(() => setSelected(new Set()), [batchId]);

  const options = (batches.data ?? []).filter((b) => b.status !== 'PLANNED');

  const approveOne = async (r: CompletionRow) => {
    const res = await approve.mutateAsync(r.enrollmentId);
    toast.show(
      res.certificate.rendered
        ? {
            tone: 'success',
            title: t('queue.approved', { name: r.fullName, code: res.certificate.publicCode }),
          }
        : { tone: 'info', title: t('queue.approvedPending', { name: r.fullName }) },
    );
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  // Each approval renders a PDF, so they run one after another rather than all at once.
  const approveSelected = async (rows: CompletionRow[]) => {
    setBulkRunning(true);
    let done = 0;
    for (const r of rows) {
      try {
        await approve.mutateAsync(r.enrollmentId);
        done++;
      } catch (err) {
        toast.show({ tone: 'error', title: `${r.fullName}: ${errorMessage(err)}` });
      }
    }
    setBulkRunning(false);
    setSelected(new Set());
    toast.show({ tone: 'success', title: t('queue.bulkDone', { done, total: rows.length }) });
  };

  const rows = queue.data ?? [];
  const approvable = rows.filter(canApprove);
  const chosen = approvable.filter((r) => selected.has(r.enrollmentId));

  const columns: Column<CompletionRow>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={t('queue.selectAll')}
          className="h-4 w-4"
          disabled={approvable.length === 0}
          checked={approvable.length > 0 && chosen.length === approvable.length}
          onChange={(e) =>
            setSelected(new Set(e.target.checked ? approvable.map((r) => r.enrollmentId) : []))
          }
        />
      ),
      render: (r) =>
        canApprove(r) ? (
          <input
            type="checkbox"
            aria-label={t('queue.select', { name: r.fullName })}
            className="h-4 w-4"
            checked={selected.has(r.enrollmentId)}
            onChange={(e) =>
              setSelected((s) => {
                const next = new Set(s);
                if (e.target.checked) next.add(r.enrollmentId);
                else next.delete(r.enrollmentId);
                return next;
              })
            }
          />
        ) : null,
    },
    {
      key: 'student',
      header: t('queue.student'),
      render: (r) => (
        <span>
          <span className="font-medium text-slate-900">{r.fullName}</span>
          <span className="block text-xs text-slate-600">{r.rollNo}</span>
        </span>
      ),
    },
    {
      key: 'checks',
      header: t('queue.checks'),
      render: (r) => <Checklist row={r} />,
    },
    {
      key: 'status',
      header: t('queue.status'),
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={r.status} />
          {r.reason && <span className="text-xs text-slate-700">{r.reason}</span>}
          {r.certificate && (
            <span className="font-mono text-xs text-slate-700">{r.certificate.publicCode}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('queue.actions')}</span>,
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-1">
          {canApprove(r) && (
            <Button
              size="sm"
              aria-label={t('queue.approveFor', { name: r.fullName })}
              disabled={bulkRunning}
              loading={approve.isPending && approve.variables === r.enrollmentId}
              onClick={() => void act(() => approveOne(r))}
            >
              {t('queue.approve')}
            </Button>
          )}
          {r.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('queue.notCompletedFor', { name: r.fullName })}
              onClick={() => setClosing(r)}
            >
              {t('queue.notCompleted')}
            </Button>
          )}
          {r.certificate && !r.certificate.rendered && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('queue.retryFor', { name: r.fullName })}
              loading={retry.isPending && retry.variables === r.certificate.id}
              onClick={() =>
                void act(async () => {
                  await retry.mutateAsync(r.certificate!.id);
                  toast.show({ tone: 'success', title: t('queue.retried') });
                })
              }
            >
              {t('queue.retry')}
            </Button>
          )}
          {r.certificate?.rendered && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('queue.downloadFor', { name: r.fullName })}
              onClick={() =>
                void act(() => downloadCertificate(r.certificate!.id, r.certificate!.publicCode))
              }
            >
              {t('queue.download')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('queue.title')}</h1>
        <p className="mt-1 text-sm text-slate-700">{t('queue.intro')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            label={t('queue.cycle')}
            value={cycleId ?? ''}
            onChange={(e) => {
              setCycleId(e.target.value);
              setParams({}, { replace: true });
            }}
            options={(cycles.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="w-80 max-w-full">
          <Select
            label={t('queue.batch')}
            value={batchId}
            onChange={(e) =>
              setParams(e.target.value ? { batch: e.target.value } : {}, { replace: true })
            }
            options={[
              { value: '', label: t('queue.chooseBatch') },
              ...options.map((b) => ({ value: b.id, label: `${b.courseTitle} · ${b.name}` })),
            ]}
          />
        </div>
        {chosen.length > 0 && (
          <Button loading={bulkRunning} onClick={() => void approveSelected(chosen)}>
            {t('queue.approveSelected', { count: chosen.length })}
          </Button>
        )}
      </div>

      {batches.data && options.length === 0 && <EmptyState title={t('queue.noBatches')} />}
      {batchId &&
        (queue.isPending ? (
          <Spinner />
        ) : queue.isError ? (
          <EmptyState title={errorMessage(queue.error)} />
        ) : (
          <Table
            caption={t('queue.caption')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.enrollmentId}
            empty={<EmptyState title={t('queue.empty')} />}
          />
        ))}
      <NotCompletedModal row={closing} onClose={() => setClosing(null)} />
    </div>
  );
}

/** The BR-09 checks (plus sessions recorded) as a list: icon plus words, so colour is never the only signal. */
function Checklist({ row }: { row: CompletionRow }) {
  const { t } = useTranslation('completion');
  const value = (c: EligibilityCheck) => {
    if (c.rule === 'RECOMMENDATION') {
      return c.actual === null
        ? t('rule.recommendedNone')
        : c.actual
          ? t('rule.recommendedYes')
          : t('rule.recommendedNo');
    }
    if (c.rule === 'MANDATORY_ASSESSMENTS' || c.rule === 'SESSIONS_RECORDED') return c.actual;
    return pct(c.actual as number | null) ?? t('rule.noneYet');
  };
  return (
    <ul
      className="flex flex-col gap-0.5 text-xs"
      aria-label={row.eligible ? t('queue.eligible') : t('queue.notEligible')}
    >
      {row.checks.map((c) => (
        <li key={c.rule} className={c.passed ? 'text-green-800' : 'text-red-800'}>
          <span aria-hidden="true">{c.passed ? '✓ ' : '✗ '}</span>
          <span className="sr-only">{c.passed ? t('rule.passed') : t('rule.failed')}: </span>
          {t(`rule.${c.rule}`, { actual: value(c), required: c.required })}
          {!c.passed && c.missing && (
            <span className="block pl-4">{t('rule.missing', { list: c.missing.join(', ') })}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function NotCompletedModal({ row, onClose }: { row: CompletionRow | null; onClose: () => void }) {
  const { t } = useTranslation('completion');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const mark = useNotCompleted();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!row) return;
    const failing = row.checks.filter((c) => !c.passed).map((c) => c.rule);
    // Start from the unmet rules; the admin can edit before confirming.
    setReason(failing.map((r) => t(`ruleShort.${r}`)).join('; '));
    setInvalid(false);
  }, [row, t]);

  const submit = async () => {
    if (!row) return;
    if (reason.trim().length < 3) return setInvalid(true);
    try {
      await mark.mutateAsync({ enrollmentId: row.enrollmentId, reason: reason.trim() });
      toast.show({ tone: 'success', title: t('queue.notCompletedDone', { name: row.fullName }) });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={row ? t('queue.notCompletedTitle', { name: row.fullName }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('queue.cancel')}
          </Button>
          <Button variant="danger" loading={mark.isPending} onClick={() => void submit()}>
            {t('queue.confirm')}
          </Button>
        </>
      }
    >
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {t('queue.reason')}
      </label>
      <p id={`${id}-hint`} className="text-xs text-slate-600">
        {t('queue.notCompletedHint')}
      </p>
      <textarea
        id={id}
        rows={3}
        maxLength={500}
        value={reason}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-err` : ''}`}
        onChange={(e) => setReason(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      />
      {invalid && (
        <p id={`${id}-err`} className="mt-1 text-xs text-red-700">
          {t('queue.reasonRequired')}
        </p>
      )}
    </Modal>
  );
}
