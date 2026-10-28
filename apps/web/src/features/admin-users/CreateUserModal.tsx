import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  AdminCreateUserSchema,
  LOCALES,
  ROLES,
  type AdminCreateUserInput,
  type Locale,
  type Role,
} from '@vtmp/shared';
import { Button, Input, Modal, Select } from '../../components/ui';
import { useToast } from '../../components/toast';
import { ApiError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useCreateUser } from './api';

interface FormValues {
  role: Role;
  fullName: string;
  email: string;
  password: string;
  locale: Locale;
  rollNo: string;
  cgpa: string;
  employeeCode: string;
  specialization: string;
  phone: string;
  mustChangePassword: boolean;
}

const EMPTY: FormValues = {
  role: 'STUDENT',
  fullName: '',
  email: '',
  password: '',
  locale: 'en',
  rollNo: '',
  cgpa: '',
  employeeCode: '',
  specialization: '',
  phone: '',
  mustChangePassword: true,
};

/** Keeps only the fields for the chosen role and drops blank optionals before validating. */
function toPayload(v: FormValues): Record<string, unknown> {
  const common = {
    role: v.role,
    fullName: v.fullName,
    email: v.email,
    password: v.password,
    locale: v.locale,
    mustChangePassword: v.mustChangePassword,
  };
  const optional = (s: string) => (s.trim() ? s : undefined);
  if (v.role === 'STUDENT') {
    return { ...common, rollNo: v.rollNo, cgpa: v.cgpa, phone: optional(v.phone) };
  }
  if (v.role === 'TRAINER') {
    return {
      ...common,
      employeeCode: v.employeeCode,
      specialization: optional(v.specialization),
      phone: optional(v.phone),
    };
  }
  return common;
}

/**
 * Validates the role-specific payload with the shared schema. Field errors carry no message
 * (Zod's are English); the form shows a translated hint instead.
 */
const resolver: Resolver<FormValues> = async (values) => {
  const parsed = AdminCreateUserSchema.safeParse(toPayload(values));
  if (parsed.success) return { values, errors: {} };
  const errors: FieldErrors<FormValues> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof FormValues | undefined;
    if (field && !errors[field]) errors[field] = { type: issue.code, message: '' };
  }
  return { values: {}, errors };
};

const CONFLICT_FIELD: Record<string, keyof FormValues> = {
  EMAIL_TAKEN: 'email',
  ROLL_NO_TAKEN: 'rollNo',
  EMPLOYEE_CODE_TAKEN: 'employeeCode',
};

export function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['users', 'common']);
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const create = useCreateUser();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver, defaultValues: EMPTY });
  const role = watch('role');

  const close = () => {
    reset(EMPTY);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const user = await create.mutateAsync(
        AdminCreateUserSchema.parse(toPayload(values)) as AdminCreateUserInput,
      );
      toast.show({ tone: 'success', title: t('created', { name: user.fullName }) });
      close();
    } catch (err) {
      const field = err instanceof ApiError ? CONFLICT_FIELD[err.code] : undefined;
      if (field) setError(field, { message: errorMessage(err) }, { shouldFocus: true });
      else toast.show({ tone: 'error', title: errorMessage(err) });
    }
  });

  // Server conflicts set a translated message; client validation leaves it empty.
  const fieldError = (name: keyof FormValues) =>
    errors[name] ? errors[name]?.message || t('form.invalid') : undefined;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('form.title')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('form.cancel')}
          </Button>
          <Button type="submit" form="create-user-form" loading={isSubmitting}>
            {t('form.submit')}
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Select
          label={t('form.role')}
          options={ROLES.map((r) => ({ value: r, label: t(`common:roles.${r}`) }))}
          {...register('role')}
        />
        <Select
          label={t('form.locale')}
          options={LOCALES.map((l) => ({ value: l, label: t(`common:language.${l}`) }))}
          {...register('locale')}
        />
        <Input
          label={t('form.fullName')}
          required
          error={fieldError('fullName')}
          {...register('fullName')}
        />
        <Input
          label={t('form.email')}
          type="email"
          required
          error={fieldError('email')}
          {...register('email')}
        />
        <div className="sm:col-span-2">
          <Input
            label={t('form.password')}
            type="text"
            autoComplete="new-password"
            hint={t('form.passwordHint')}
            required
            error={fieldError('password')}
            {...register('password')}
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-400 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600"
              {...register('mustChangePassword')}
            />
            {t('form.mustChangePassword')}
          </label>
        </div>
        {role === 'STUDENT' && (
          <>
            <Input
              label={t('form.rollNo')}
              required
              error={fieldError('rollNo')}
              {...register('rollNo')}
            />
            <Input
              label={t('form.cgpa')}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              max={10}
              required
              error={fieldError('cgpa')}
              {...register('cgpa')}
            />
          </>
        )}
        {role === 'TRAINER' && (
          <>
            <Input
              label={t('form.employeeCode')}
              required
              error={fieldError('employeeCode')}
              {...register('employeeCode')}
            />
            <Input
              label={t('form.specialization')}
              error={fieldError('specialization')}
              {...register('specialization')}
            />
          </>
        )}
        {role !== 'ADMIN' && (
          <Input
            label={t('form.phone')}
            type="tel"
            error={fieldError('phone')}
            {...register('phone')}
          />
        )}
      </form>
    </Modal>
  );
}
