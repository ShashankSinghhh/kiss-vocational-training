import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@vtmp/shared';
import { Button, Card, Input } from '../../components/ui';
import { useToast } from '../../components/toast';
import { ApiError, api } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { ROLE_HOME, useAuth } from '../../lib/auth';

// Error messages here are i18n keys, translated at render time.
const FormSchema = z
  .object({
    currentPassword: z.string().min(1, 'password.required'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, 'password.tooShort')
      .max(PASSWORD_MAX_LENGTH, 'password.tooShort')
      .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), 'password.letterAndDigit'),
    confirmPassword: z.string().min(1, 'password.required'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'password.mismatch',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'password.sameAsCurrent',
  });
type FormValues = z.infer<typeof FormSchema>;

export function ChangePasswordPage() {
  const { t } = useTranslation('profile');
  const toast = useToast();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { user, setUser } = useAuth();
  const forced = !!user?.mustChangePassword;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(FormSchema) });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await api.post('/users/me/password', { currentPassword, newPassword });
      toast.show({ tone: 'success', title: t('password.done') });
      if (user) setUser({ ...user, mustChangePassword: false });
      navigate(forced && user ? ROLE_HOME[user.role] : '/profile');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CURRENT_PASSWORD') {
        setError('currentPassword', { message: errorMessage(err) }, { shouldFocus: true });
      } else {
        toast.show({ tone: 'error', title: errorMessage(err) });
      }
    }
  });

  // Schema messages are keys; server messages are already translated sentences.
  const msg = (m?: string) => (m ? (m.startsWith('password.') ? t(m) : m) : undefined);

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">{t('password.title')}</h1>
      {forced && (
        <p
          role="status"
          className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900"
        >
          {t('password.mustChange')}
        </p>
      )}
      <Card>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <Input
            label={t('password.current')}
            type="password"
            autoComplete="current-password"
            required
            error={msg(errors.currentPassword?.message)}
            {...register('currentPassword')}
          />
          <Input
            label={t('password.new')}
            type="password"
            autoComplete="new-password"
            hint={t('password.newHint')}
            required
            error={msg(errors.newPassword?.message)}
            {...register('newPassword')}
          />
          <Input
            label={t('password.confirm')}
            type="password"
            autoComplete="new-password"
            required
            error={msg(errors.confirmPassword?.message)}
            {...register('confirmPassword')}
          />
          <div>
            <Button type="submit" loading={isSubmitting}>
              {t('password.submit')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
