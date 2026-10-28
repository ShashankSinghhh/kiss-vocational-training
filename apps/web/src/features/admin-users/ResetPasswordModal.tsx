import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, type UserSummary } from '@vtmp/shared';
import { Button, Input, Modal } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useResetPassword } from './api';

/**
 * Admin sets a new password for someone who forgot theirs (the sign-in page sends them to the
 * training office). The server also clears any login lock and signs them out everywhere.
 */
export function ResetPasswordModal({
  user,
  onClose,
}: {
  user: UserSummary | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [mustChange, setMustChange] = useState(true);

  useEffect(() => {
    setPassword('');
    setInvalid(false);
    setMustChange(true);
  }, [user]);

  if (!user) return null;

  const confirm = async () => {
    const strong =
      password.length >= PASSWORD_MIN_LENGTH && /\p{L}/u.test(password) && /\d/.test(password);
    if (!strong) return setInvalid(true);
    try {
      await reset.mutateAsync({ id: user.id, password, mustChangePassword: mustChange });
      toast.show({ tone: 'success', title: t('resetPassword.done', { name: user.fullName }) });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('resetPassword.title', { name: user.fullName })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button loading={reset.isPending} onClick={() => void confirm()}>
            {t('resetPassword.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">{t('resetPassword.body', { name: user.fullName })}</p>
      <div className="mt-4">
        <Input
          label={t('resetPassword.password')}
          type="text"
          autoComplete="new-password"
          value={password}
          hint={t('form.passwordHint')}
          error={invalid ? t('resetPassword.tooShort', { min: PASSWORD_MIN_LENGTH }) : undefined}
          onChange={(e) => {
            setPassword(e.target.value);
            setInvalid(false);
          }}
        />
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-400 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600"
            checked={mustChange}
            onChange={(e) => setMustChange(e.target.checked)}
          />
          {t('form.mustChangePassword')}
        </label>
      </div>
    </Modal>
  );
}
