import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BatchAttendanceRow, BatchDetail, EvaluationRow } from '@vtmp/shared';
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
import { formatDate } from '../../lib/format';
import {
  useAddProgress,
  useAttendanceSummary,
  useEvaluations,
  useProgress,
  useSaveEvaluation,
} from './api';

const pct = (n: number | null, none: string) => (n === null ? none : `${n.toFixed(2)} %`);

/** Attendance per student, computed live from the sheets (BR-08). */
export function AttendanceSummaryTab({ batchId }: { batchId: string }) {
  const { t } = useTranslation(['training', 'batches']);
  const errorMessage = useErrorMessage();
  const summary = useAttendanceSummary(batchId);
  if (summary.isPending) return <Spinner />;
  if (summary.isError) return <EmptyState title={errorMessage(summary.error)} />;

  const columns: Column<BatchAttendanceRow>[] = [
    { key: 'roll', header: t('batches:students.rollNo'), render: (r) => r.rollNo },
    {
      key: 'name',
      header: t('progress.student'),
      render: (r) => <span className="font-medium">{r.fullName}</span>,
    },
    {
      key: 'pct',
      header: t('summary.percent'),
      align: 'right',
      render: (r) => pct(r.percent, t('summary.none')),
    },
    { key: 'attended', header: t('summary.attended'), align: 'right', render: (r) => r.attended },
    {
      key: 'conducted',
      header: t('summary.conducted'),
      align: 'right',
      render: (r) => r.conducted,
    },
    { key: 'absences', header: t('summary.absences'), align: 'right', render: (r) => r.absences },
    {
      key: 'row',
      header: t('summary.consecutive'),
      align: 'right',
      render: (r) => r.consecutiveAbsences,
    },
    // L2: sessions that ended unmarked are left out of the percentage, so show them beside it.
    {
      key: 'unrecorded',
      header: t('summary.unrecorded'),
      align: 'right',
      render: (r) =>
        r.unrecorded > 0 ? <span className="font-medium text-red-800">{r.unrecorded}</span> : 0,
    },
  ];
  return (
    <Table
      caption={t('summary.caption')}
      columns={columns}
      rows={summary.data}
      rowKey={(r) => r.studentId}
    />
  );
}

/** Progress notes for the batch or one student (BRQ-6.3). */
export function ProgressTab({ batch, editable }: { batch: BatchDetail; editable: boolean }) {
  const { t, i18n } = useTranslation('training');
  const lng = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const notes = useProgress(batch.id);
  const add = useAddProgress();
  const [studentId, setStudentId] = useState('');
  const [milestone, setMilestone] = useState('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (milestone.trim().length < 2) return setInvalid(true);
    setInvalid(false);
    try {
      await add.mutateAsync({
        batchId: batch.id,
        input: {
          studentId: studentId || null,
          milestone: milestone.trim(),
          note: note.trim() || null,
        },
      });
      setMilestone('');
      setNote('');
      toast.show({ tone: 'success', title: t('progress.saved') });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {editable && (
        <Card title={t('progress.add')} headingLevel={3}>
          <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('progress.student')}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              options={[
                { value: '', label: t('progress.wholeBatch') },
                ...(batch.roster ?? []).map((r) => ({
                  value: r.studentId,
                  label: `${r.fullName} (${r.rollNo})`,
                })),
              ]}
            />
            <Input
              label={t('progress.milestone')}
              required
              maxLength={200}
              value={milestone}
              error={invalid ? t('assessments.invalid') : undefined}
              onChange={(e) => setMilestone(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Input
                label={t('progress.note')}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div>
              <Button type="submit" loading={add.isPending}>
                {t('progress.add')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {notes.isPending ? (
        <Spinner />
      ) : notes.isError ? (
        <EmptyState title={errorMessage(notes.error)} />
      ) : notes.data.length === 0 ? (
        <EmptyState title={t('progress.empty')} />
      ) : (
        <ul aria-label={t('progress.caption')} className="flex flex-col gap-2">
          {notes.data.map((p) => (
            <li key={p.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="font-medium text-slate-900">
                {p.milestone}{' '}
                <Badge tone="neutral">{p.studentName ?? t('progress.wholeBatch')}</Badge>
              </p>
              {p.note && <p className="mt-1 text-sm text-slate-700">{p.note}</p>}
              <p className="mt-1 text-xs text-slate-600">
                {t('progress.by', { who: p.recordedBy, when: formatDate(p.recordedAt, lng, true) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Trainer's final evaluation of each student (BRQ-6.3). */
export function EvaluationsTab({ batchId, editable }: { batchId: string; editable: boolean }) {
  const { t } = useTranslation(['training', 'batches']);
  const errorMessage = useErrorMessage();
  const rows = useEvaluations(batchId);
  const [open, setOpen] = useState<EvaluationRow | null>(null);
  if (rows.isPending) return <Spinner />;
  if (rows.isError) return <EmptyState title={errorMessage(rows.error)} />;

  const columns: Column<EvaluationRow>[] = [
    { key: 'roll', header: t('batches:students.rollNo'), render: (r) => r.rollNo },
    {
      key: 'name',
      header: t('progress.student'),
      render: (r) => <span className="font-medium">{r.fullName}</span>,
    },
    {
      key: 'status',
      header: t('evaluation.recommended'),
      render: (r) =>
        !r.evaluation ? (
          <Badge tone="neutral">{t('evaluation.pending')}</Badge>
        ) : r.evaluation.recommended ? (
          <Badge tone="success">{t('evaluation.recommendedYes')}</Badge>
        ) : (
          <Badge tone="warning">{t('evaluation.recommendedNo')}</Badge>
        ),
    },
    {
      key: 'remarks',
      header: t('evaluation.remarks'),
      render: (r) => r.evaluation?.remarks ?? '—',
    },
    ...(editable
      ? [
          {
            key: 'act',
            header: <span className="sr-only">{t('evaluation.evaluate')}</span>,
            align: 'right' as const,
            render: (r: EvaluationRow) => (
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('evaluation.evaluateFor', { name: r.fullName })}
                onClick={() => setOpen(r)}
              >
                {t('evaluation.evaluate')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Table
        caption={t('evaluation.caption')}
        columns={columns}
        rows={rows.data}
        rowKey={(r) => r.enrollmentId}
      />
      <EvaluationModal row={open} onClose={() => setOpen(null)} />
    </>
  );
}

function EvaluationModal({ row, onClose }: { row: EvaluationRow | null; onClose: () => void }) {
  const { t } = useTranslation('training');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const save = useSaveEvaluation();
  const [remarks, setRemarks] = useState('');
  const [recommended, setRecommended] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const remarksId = useId();

  useEffect(() => {
    if (!row) return;
    setRemarks(row.evaluation?.remarks ?? '');
    setRecommended(row.evaluation?.recommended ?? true);
    setInvalid(false);
  }, [row]);

  const submit = async () => {
    if (!row) return;
    if (remarks.trim().length < 3) return setInvalid(true);
    try {
      await save.mutateAsync({
        enrollmentId: row.enrollmentId,
        input: { remarks: remarks.trim(), recommended },
      });
      toast.show({ tone: 'success', title: t('evaluation.saved') });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={row ? t('evaluation.title', { name: row.fullName }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('assessments.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => void submit()}>
            {t('assessments.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor={remarksId} className="text-sm font-medium text-slate-800">
            {t('evaluation.remarks')}
          </label>
          <textarea
            id={remarksId}
            rows={4}
            maxLength={2000}
            value={remarks}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${remarksId}-err` : undefined}
            onChange={(e) => setRemarks(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          />
          {invalid && (
            <p id={`${remarksId}-err`} className="mt-1 text-xs text-red-700">
              {t('evaluation.remarksRequired')}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={recommended}
            onChange={(e) => setRecommended(e.target.checked)}
            className="h-4 w-4 rounded border-slate-400 focus-visible:ring-2 focus-visible:ring-brand-600"
          />
          {t('evaluation.recommended')}
        </label>
      </div>
    </Modal>
  );
}
