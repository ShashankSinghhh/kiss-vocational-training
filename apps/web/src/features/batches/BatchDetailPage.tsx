import { useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BatchDetail, Candidate, RosterEntry } from '@vtmp/shared';
import {
  Button,
  Card,
  EmptyState,
  Modal,
  PageSkeleton,
  Select,
  Spinner,
  Table,
  Tabs,
  type Column,
} from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { formatDay } from '../../lib/format';
import { useAdminCourses } from '../admin-courses/api';
import { StatusBadge } from '../enrollment/StatusBadge';
import {
  useActivateBatch,
  useAdminBatches,
  useAssignTrainer,
  useBatch,
  useCancelSession,
  useCandidates,
  useCloseBatch,
  useMoveStudent,
  usePlaceStudent,
  useRemoveStudent,
  useSessions,
  useTrainers,
  useUnassignTrainer,
  useWithdrawStudent,
} from './api';
import { BatchStatusBadge, FillBar } from './bits';
import { BatchFormModal, ScheduleModal } from './forms';
import { SessionsView } from './SessionsView';
import { downloadBatchReport } from '../reports/api';
import { ReportButtons } from '../reports/ReportButtons';
import { AssessmentsPanel } from '../training/AssessmentsPanel';
import { AttendanceSummaryTab, EvaluationsTab, ProgressTab } from '../training/BatchTrainingTabs';

/**
 * One batch: students, trainers and sessions. Admins manage everything; trainers (their own
 * batches only, enforced by the API) get the same view read-only.
 */
export function BatchDetailPage({ admin }: { admin: boolean }) {
  const { batchId = '' } = useParams();
  const { t, i18n } = useTranslation(['batches', 'reports']);
  const lng = i18n.resolvedLanguage ?? 'en';
  const errorMessage = useErrorMessage();
  const toast = useToast();
  const batch = useBatch(batchId);
  const activate = useActivateBatch();
  const [tab, setTab] = useState('students');
  const [editing, setEditing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [closing, setClosing] = useState(false);
  const courses = useAdminCourses(admin);
  const back = admin ? '/admin/batches' : '/trainer/batches';

  if (batch.isPending) return <PageSkeleton />;
  if (batch.isError) return <EmptyState title={errorMessage(batch.error)} />;
  const b = batch.data;

  const onActivate = async () => {
    try {
      await activate.mutateAsync(b.id);
      toast.show({ tone: 'success', title: t('detail.activated') });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link to={back} className="text-sm font-medium text-brand-700 underline hover:text-brand-900">
        {t('detail.back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">{`${b.courseTitle} · ${b.cycleName}`}</p>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold text-slate-900">
            {b.name} <BatchStatusBadge status={b.status} />
          </h1>
          <p className="mt-1 text-sm text-slate-700">
            {`${formatDay(b.startDate, lng)} – ${formatDay(b.endDate, lng)} · ${b.venue}`}
          </p>
          <div className="mt-2 w-48">
            <FillBar existing={b.enrolled} capacity={b.capacity} />
          </div>
        </div>
        {admin && (
          <div className="flex gap-2">
            {b.status !== 'CLOSED' && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('detail.edit')}
              </Button>
            )}
            {b.status === 'PLANNED' && (
              <Button onClick={() => setActivating(true)}>{t('detail.activate')}</Button>
            )}
            {b.status === 'ACTIVE' && (
              <Button variant="secondary" onClick={() => setClosing(true)}>
                {t('detail.close')}
              </Button>
            )}
            {b.status !== 'PLANNED' && (
              <Link
                to={`/admin/completions?batch=${b.id}`}
                className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                {t('detail.completion')}
              </Link>
            )}
          </div>
        )}
      </div>

      {b.status !== 'PLANNED' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-800">{t('reports:batchReport')}</span>
          <ReportButtons
            size="sm"
            name={`${b.courseTitle} · ${b.name}`}
            download={(format) => downloadBatchReport(b.id, `${b.courseCode}-${b.name}`, format)}
          />
        </div>
      )}

      <Tabs
        label={t('detail.tabs.label')}
        selected={tab}
        onSelect={setTab}
        items={[
          {
            id: 'students',
            label: t('detail.tabs.students'),
            content: <StudentsTab batch={b} admin={admin} />,
          },
          {
            id: 'trainers',
            label: t('detail.tabs.trainers'),
            content: <TrainersTab batch={b} admin={admin} />,
          },
          {
            id: 'sessions',
            label: t('detail.tabs.sessions'),
            content: <SessionsTab batch={b} admin={admin} />,
          },
          ...(b.status === 'PLANNED'
            ? []
            : [
                {
                  id: 'attendance',
                  label: t('detail.tabs.attendance'),
                  content: <AttendanceSummaryTab batchId={b.id} />,
                },
                {
                  id: 'assessments',
                  label: t('detail.tabs.assessments'),
                  content: (
                    <AssessmentsPanel
                      batchId={b.id}
                      editable={b.status !== 'CLOSED'}
                      marksBase={admin ? '/admin/assessments' : '/trainer/assessments'}
                    />
                  ),
                },
                {
                  id: 'progress',
                  label: t('detail.tabs.progress'),
                  content: <ProgressTab batch={b} editable={b.status === 'ACTIVE'} />,
                },
                {
                  id: 'evaluations',
                  label: t('detail.tabs.evaluations'),
                  content: <EvaluationsTab batchId={b.id} editable={b.status === 'ACTIVE'} />,
                },
              ]),
        ]}
      />

      {admin && (
        <BatchFormModal
          open={editing}
          cycleId={b.cycleId}
          courses={courses.data ?? []}
          batch={b}
          onClose={() => setEditing(false)}
        />
      )}
      <Modal
        open={activating}
        onClose={() => setActivating(false)}
        title={t('detail.activateTitle', { name: b.name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setActivating(false)}>
              {t('form.cancel')}
            </Button>
            <Button loading={activate.isPending} onClick={() => void onActivate()}>
              {t('detail.activate')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('detail.activateBody')}</p>
      </Modal>
      {admin && <CloseModal batch={b} open={closing} onClose={() => setClosing(false)} />}
    </div>
  );
}

/** Students still waiting for a completion decision keep a batch from closing (L1). */
const UNDECIDED = ['ALLOCATED', 'ACTIVE'];

/**
 * L1: closing ends a batch for good. The API checks the end date and decisions; this dialog
 * shows the same facts first so the admin knows what is left to do.
 */
function CloseModal({
  batch,
  open,
  onClose,
}: {
  batch: BatchDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('batches');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const close = useCloseBatch();
  const undecided = (batch.roster ?? []).filter((r) => UNDECIDED.includes(r.enrollmentStatus));
  // The device's calendar day (YYYY-MM-DD); the API decides with the institution's.
  const notEnded = new Date().toLocaleDateString('en-CA') <= batch.endDate;

  const submit = async () => {
    try {
      await close.mutateAsync(batch.id);
      toast.show({ tone: 'success', title: t('detail.closed') });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('detail.closeTitle', { name: batch.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button
            loading={close.isPending}
            disabled={undecided.length > 0 || notEnded}
            onClick={() => void submit()}
          >
            {t('detail.close')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>{t('detail.closeBody')}</p>
        {notEnded && (
          <p className="text-amber-900">
            {t('detail.closeNotEnded', {
              date: formatDay(batch.endDate, i18n.resolvedLanguage ?? 'en'),
            })}
          </p>
        )}
        {undecided.length > 0 && (
          <div>
            <p className="text-amber-900">
              {t('detail.closeUndecided', { count: undecided.length })}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {undecided.map((r) => (
                <li key={r.enrollmentId}>{`${r.fullName} (${r.rollNo})`}</li>
              ))}
            </ul>
            <Link
              to={`/admin/completions?batch=${batch.id}`}
              className="mt-2 inline-block font-medium text-brand-700 underline hover:text-brand-900"
            >
              {t('detail.closeGoToCompletion')}
            </Link>
          </div>
        )}
      </div>
    </Modal>
  );
}

function StudentsTab({ batch, admin }: { batch: BatchDetail; admin: boolean }) {
  const { t } = useTranslation('batches');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const remove = useRemoveStudent();
  const place = usePlaceStudent();
  const candidates = useCandidates(batch.id, admin && batch.status !== 'CLOSED');
  const [moving, setMoving] = useState<RosterEntry | null>(null);
  const [withdrawing, setWithdrawing] = useState<RosterEntry | null>(null);
  const full = batch.enrolled >= batch.capacity;

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.show({ tone: 'success', title: message });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  const columns: Column<RosterEntry>[] = [
    { key: 'roll', header: t('students.rollNo'), render: (r) => r.rollNo },
    {
      key: 'name',
      header: t('students.name'),
      render: (r) => <span className="font-medium">{r.fullName}</span>,
    },
    { key: 'email', header: t('students.email'), render: (r) => r.email },
    { key: 'phone', header: t('students.phone'), render: (r) => r.phone ?? '—' },
    {
      key: 'status',
      header: t('students.status'),
      render: (r) => <StatusBadge status={r.enrollmentStatus as never} />,
    },
    ...(admin
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('students.move')}</span>,
            align: 'right' as const,
            render: (r: RosterEntry) => (
              <div className="flex justify-end gap-1">
                {batch.status !== 'CLOSED' && UNDECIDED.includes(r.enrollmentStatus) && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMoving(r)}
                      aria-label={t('students.moveFor', { name: r.fullName })}
                    >
                      {t('students.move')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setWithdrawing(r)}
                      aria-label={t('students.withdrawFor', { name: r.fullName })}
                    >
                      {t('students.withdraw')}
                    </Button>
                  </>
                )}
                {batch.status === 'PLANNED' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('students.removeFor', { name: r.fullName })}
                    onClick={() =>
                      void act(
                        () =>
                          remove.mutateAsync({ batchId: batch.id, enrollmentId: r.enrollmentId }),
                        t('students.removed', { name: r.fullName }),
                      )
                    }
                  >
                    {t('students.remove')}
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  const candidateColumns: Column<Candidate>[] = [
    { key: 'name', header: t('students.name'), render: (c) => `${c.fullName} (${c.rollNo})` },
    { key: 'cgpa', header: t('students.cgpa'), align: 'right', render: (c) => c.cgpa },
    { key: 'rank', header: t('students.rank'), align: 'right', render: (c) => c.rankForCourse },
    {
      key: 'status',
      header: t('students.status'),
      render: (c) => <StatusBadge status={c.status as never} />,
    },
    {
      key: 'place',
      header: <span className="sr-only">{t('students.place')}</span>,
      align: 'right',
      render: (c) => (
        <Button
          size="sm"
          disabled={full}
          aria-label={t('students.placeFor', { name: c.fullName })}
          onClick={() =>
            void act(
              () => place.mutateAsync({ batchId: batch.id, enrollmentId: c.enrollmentId }),
              t('students.placed', { name: c.fullName }),
            )
          }
        >
          {t('students.place')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Table
        caption={t('students.caption')}
        columns={columns}
        rows={batch.roster ?? []}
        rowKey={(r) => r.enrollmentId}
        empty={<EmptyState title={t('students.empty')} />}
      />
      {admin && batch.status !== 'CLOSED' && (
        <Card title={t('students.candidates')} headingLevel={3}>
          {full && <p className="mb-2 text-sm text-amber-900">{t('students.full')}</p>}
          {candidates.isPending ? (
            <Spinner />
          ) : (
            <Table
              caption={t('students.candidatesCaption')}
              columns={candidateColumns}
              rows={candidates.data ?? []}
              rowKey={(c) => c.enrollmentId}
              empty={<EmptyState title={t('students.noCandidates')} />}
            />
          )}
        </Card>
      )}
      {admin && <MoveModal batch={batch} student={moving} onClose={() => setMoving(null)} />}
      {admin && (
        <WithdrawModal batch={batch} student={withdrawing} onClose={() => setWithdrawing(null)} />
      )}
    </div>
  );
}

/** L4: a student leaves training; the reason is kept on the application and sent to them. */
function WithdrawModal({
  batch,
  student,
  onClose,
}: {
  batch: BatchDetail;
  student: RosterEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('batches');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const withdraw = useWithdrawStudent();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const id = useId();

  const dismiss = () => {
    setReason('');
    setInvalid(false);
    onClose();
  };
  const submit = async () => {
    if (!student) return;
    if (reason.trim().length < 3) return setInvalid(true);
    try {
      await withdraw.mutateAsync({
        batchId: batch.id,
        enrollmentId: student.enrollmentId,
        reason: reason.trim(),
      });
      toast.show({ tone: 'success', title: t('students.withdrawn', { name: student.fullName }) });
      dismiss();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open={!!student}
      onClose={dismiss}
      title={student ? t('students.withdrawTitle', { name: student.fullName }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={dismiss}>
            {t('form.cancel')}
          </Button>
          <Button variant="danger" loading={withdraw.isPending} onClick={() => void submit()}>
            {t('students.withdraw')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-700">
        {batch.status === 'ACTIVE'
          ? t('students.withdrawBodyActive')
          : t('students.withdrawBodyPlanned')}
      </p>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {t('students.withdrawReason')}
      </label>
      <p id={`${id}-hint`} className="text-xs text-slate-600">
        {t('students.withdrawHint')}
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
          {t('students.withdrawReasonRequired')}
        </p>
      )}
    </Modal>
  );
}

function MoveModal({
  batch,
  student,
  onClose,
}: {
  batch: BatchDetail;
  student: RosterEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('batches');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const move = useMoveStudent();
  const others = useAdminBatches({ cycleId: batch.cycleId });
  const [to, setTo] = useState('');
  const options = (others.data ?? []).filter((x) => x.id !== batch.id && x.status !== 'CLOSED');

  const submit = async () => {
    if (!student || !to) return;
    try {
      await move.mutateAsync({
        batchId: batch.id,
        enrollmentId: student.enrollmentId,
        toBatchId: to,
      });
      toast.show({ tone: 'success', title: t('students.moved', { name: student.fullName }) });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open={!!student}
      onClose={onClose}
      title={student ? t('students.moveTitle', { name: student.fullName }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button loading={move.isPending} disabled={!to} onClick={() => void submit()}>
            {t('students.move')}
          </Button>
        </>
      }
    >
      <Select
        label={t('students.moveTo')}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        options={[
          { value: '', label: '—' },
          ...options.map((x) => ({
            value: x.id,
            label: `${x.courseTitle} · ${x.name} (${t('fields.fill', { enrolled: x.enrolled, capacity: x.capacity })})`,
          })),
        ]}
      />
    </Modal>
  );
}

function TrainersTab({ batch, admin }: { batch: BatchDetail; admin: boolean }) {
  const { t } = useTranslation('batches');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const trainers = useTrainers();
  const assign = useAssignTrainer();
  const unassign = useUnassignTrainer();
  const [choice, setChoice] = useState('');
  const available = (trainers.data ?? []).filter(
    (tr) => !batch.trainers.some((x) => x.id === tr.id),
  );

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.show({ tone: 'success', title: msg });
      setChoice('');
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {batch.trainers.length === 0 ? (
        <EmptyState title={t('trainers.empty')} />
      ) : (
        <ul aria-label={t('trainers.caption')} className="flex flex-col gap-2">
          {batch.trainers.map((tr) => (
            <li
              key={tr.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
            >
              <span className="font-medium text-slate-900">{tr.fullName}</span>
              {admin && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('trainers.unassignFor', { name: tr.fullName })}
                  onClick={() =>
                    void run(
                      () => unassign.mutateAsync({ batchId: batch.id, trainerId: tr.id }),
                      t('trainers.unassigned'),
                    )
                  }
                >
                  {t('trainers.unassign')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin && batch.status !== 'CLOSED' && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72">
            <Select
              label={t('trainers.choose')}
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              options={[
                { value: '', label: t('trainers.chooseOne') },
                ...available.map((tr) => ({
                  value: tr.id,
                  label: tr.specialization ? `${tr.fullName} — ${tr.specialization}` : tr.fullName,
                })),
              ]}
            />
          </div>
          <Button
            disabled={!choice}
            loading={assign.isPending}
            onClick={() =>
              void run(
                () => assign.mutateAsync({ batchId: batch.id, trainerId: choice }),
                t('trainers.assigned'),
              )
            }
          >
            {t('trainers.assign')}
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionsTab({ batch, admin }: { batch: BatchDetail; admin: boolean }) {
  const { t } = useTranslation('batches');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const sessions = useSessions(batch.id);
  const cancel = useCancelSession();
  const [scheduling, setScheduling] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {admin && batch.status !== 'CLOSED' && (
        <div>
          <Button onClick={() => setScheduling(true)}>{t('sessions.schedule')}</Button>
        </div>
      )}
      {sessions.isPending ? (
        <Spinner />
      ) : sessions.isError ? (
        <EmptyState title={errorMessage(sessions.error)} />
      ) : (
        <SessionsView
          sessions={sessions.data}
          attendanceBase={
            batch.status === 'PLANNED' ? undefined : admin ? '/admin/sessions' : '/trainer/sessions'
          }
          onCancel={
            admin
              ? (s) =>
                  void cancel
                    .mutateAsync({ batchId: batch.id, sessionId: s.id })
                    .then(() => toast.show({ tone: 'success', title: t('sessions.cancelled') }))
                    .catch((err: unknown) =>
                      toast.show({ tone: 'error', title: errorMessage(err) }),
                    )
              : undefined
          }
        />
      )}
      {admin && (
        <ScheduleModal open={scheduling} batch={batch} onClose={() => setScheduling(false)} />
      )}
    </div>
  );
}
