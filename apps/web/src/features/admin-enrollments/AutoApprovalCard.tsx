import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutoApproval } from '@vtmp/shared';
import { Badge, Button, Card, Modal } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useAutoApproval, useRunAutoApproval, useSaveAutoApproval } from './api';

const checkbox =
  'h-4 w-4 rounded border-slate-400 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600';

/**
 * BRQ-3.3 automatic approval: the admin's switch and rules. Applications that pass are
 * approved as soon as they are submitted; the rest wait in the list below with the reason.
 * "Approve eligible now" applies the rules to what is already pending in the chosen cycle.
 */
export function AutoApprovalCard({ cycleId, cycleName }: { cycleId?: string; cycleName: string }) {
  const { t } = useTranslation('enrollment');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const current = useAutoApproval();
  const save = useSaveAutoApproval();
  const run = useRunAutoApproval();
  const ids = { enabled: useId(), prereq: useId() };
  const [form, setForm] = useState<AutoApproval | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (current.data) {
      setForm(current.data);
    }
  }, [current.data]);

  if (!form) return null;
  const dirty =
    !!current.data &&
    (form.enabled !== current.data.enabled ||
      form.manualIfPrerequisites !== current.data.manualIfPrerequisites);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync(form);
      toast.show({ tone: 'success', title: t('admin.auto.saved') });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  const runNow = async () => {
    if (!cycleId) return;
    try {
      const r = await run.mutateAsync(cycleId);
      setConfirming(false);
      toast.show({
        tone: 'success',
        title: t('admin.auto.ran', { count: r.approved, pending: r.stillPending }),
      });
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Card
      title={t('admin.auto.title')}
      actions={
        <Badge tone={current.data?.enabled ? 'success' : 'neutral'}>
          {current.data?.enabled ? t('admin.auto.on') : t('admin.auto.off')}
        </Badge>
      }
    >
      <p className="mb-4 max-w-3xl text-sm text-slate-700">{t('admin.auto.intro')}</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={ids.enabled} className="flex items-center gap-2 text-sm text-slate-900">
          <input
            id={ids.enabled}
            type="checkbox"
            className={checkbox}
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <span className="font-medium">{t('admin.auto.enabled')}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor={ids.prereq} className="flex items-start gap-2 text-sm text-slate-900">
            <input
              id={ids.prereq}
              type="checkbox"
              className={`${checkbox} mt-0.5`}
              checked={form.manualIfPrerequisites}
              onChange={(e) => setForm({ ...form, manualIfPrerequisites: e.target.checked })}
            />
            <span>{t('admin.auto.manualIfPrerequisites')}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            {t('admin.auto.save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!cycleId || dirty}
            onClick={() => setConfirming(true)}
          >
            {t('admin.auto.runNow')}
          </Button>
        </div>
        {dirty && <p className="text-xs text-slate-600">{t('admin.auto.saveFirst')}</p>}
      </form>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('admin.auto.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('admin.auto.cancel')}
            </Button>
            <Button loading={run.isPending} onClick={() => void runNow()}>
              {t('admin.auto.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          {t('admin.auto.confirmBody', { cycle: cycleName })}
        </p>
      </Modal>
    </Card>
  );
}
