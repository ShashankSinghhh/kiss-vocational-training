import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { AdminCourse, Offering } from '@vtmp/shared';
import { Button, Input, Modal } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { fromLocalInput, toLocalInput } from '../../lib/format';
import { useCreateCourse, useCreateCycle, useUpdateCourse, useUpsertOffering } from './api';

// Form schemas mirror the shared API schemas; numbers arrive from inputs as strings.
const CourseForm = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,20}$/),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  durationWeeks: z.coerce.number().int().min(1).max(104),
  prerequisites: z.string().trim().max(500),
  prerequisitesNeedReview: z.boolean(),
  seatCapacity: z.coerce.number().int().min(1).max(1000),
});
type CourseValues = z.input<typeof CourseForm>;

export function CourseFormModal({
  open,
  course,
  onClose,
}: {
  open: boolean;
  course: AdminCourse | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('courses');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const create = useCreateCourse();
  const update = useUpdateCourse();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CourseValues>({ resolver: zodResolver(CourseForm) });

  useEffect(() => {
    if (open) {
      reset(
        course
          ? { ...course, prerequisites: course.prerequisites ?? '' }
          : {
              code: '',
              title: '',
              description: '',
              durationWeeks: 12,
              prerequisites: '',
              prerequisitesNeedReview: true,
              seatCapacity: 30,
            },
      );
    }
  }, [open, course, reset]);

  const onSubmit = handleSubmit(async (raw) => {
    const v = CourseForm.parse(raw);
    const fields = {
      title: v.title,
      description: v.description,
      durationWeeks: v.durationWeeks,
      prerequisites: v.prerequisites || null,
      prerequisitesNeedReview: v.prerequisitesNeedReview,
      seatCapacity: v.seatCapacity,
    };
    try {
      if (course) {
        await update.mutateAsync({ id: course.id, ...fields });
        toast.show({ tone: 'success', title: t('admin.saved') });
      } else {
        const created = await create.mutateAsync({ code: v.code, ...fields });
        toast.show({ tone: 'success', title: t('admin.courseCreated', { title: created.title }) });
      }
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  });

  const err = (k: keyof CourseValues) => (errors[k] ? t('admin.invalid') : undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={course ? t('admin.editCourseFor', { title: course.title }) : t('admin.addCourse')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button type="submit" form="course-form" loading={isSubmitting}>
            {t('admin.save')}
          </Button>
        </>
      }
    >
      <form
        id="course-form"
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Input
          label={t('fields.code')}
          hint={t('admin.codeHint')}
          required
          disabled={!!course}
          error={err('code')}
          {...register('code')}
        />
        <Input label={t('fields.title')} required error={err('title')} {...register('title')} />
        <div className="sm:col-span-2">
          <label htmlFor="course-description" className="text-sm font-medium text-slate-800">
            {t('fields.description')}
            <span aria-hidden="true" className="ml-0.5 text-red-700">
              *
            </span>
          </label>
          <textarea
            id="course-description"
            rows={4}
            required
            aria-invalid={errors.description ? true : undefined}
            className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            {...register('description')}
          />
          {errors.description && (
            <p className="text-xs font-medium text-red-700">{t('admin.invalid')}</p>
          )}
        </div>
        <Input
          label={t('fields.durationWeeks')}
          type="number"
          min={1}
          required
          error={err('durationWeeks')}
          {...register('durationWeeks')}
        />
        <Input
          label={t('fields.seatCapacity')}
          type="number"
          min={1}
          required
          error={err('seatCapacity')}
          {...register('seatCapacity')}
        />
        <div className="sm:col-span-2">
          <Input
            label={t('fields.prerequisites')}
            error={err('prerequisites')}
            {...register('prerequisites')}
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-400 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600"
              {...register('prerequisitesNeedReview')}
            />
            {t('fields.prerequisitesNeedReview')}
          </label>
          <p className="mt-1 text-xs text-slate-600">{t('fields.prerequisitesNeedReviewHint')}</p>
        </div>
      </form>
    </Modal>
  );
}

const CycleForm = z
  .object({
    name: z.string().trim().min(3).max(60),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.endsOn >= v.startsOn, { path: ['endsOn'] });
type CycleValues = z.infer<typeof CycleForm>;

export function CycleFormModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation('courses');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const create = useCreateCycle();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CycleValues>({ resolver: zodResolver(CycleForm) });

  useEffect(() => {
    if (open) reset({ name: '', startsOn: '', endsOn: '' });
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const cycle = await create.mutateAsync(v);
      toast.show({ tone: 'success', title: t('admin.cycleCreated', { name: cycle.name }) });
      onCreated(cycle.id);
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.addCycle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button type="submit" form="cycle-form" loading={isSubmitting}>
            {t('admin.save')}
          </Button>
        </>
      }
    >
      <form
        id="cycle-form"
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Input
            label={t('admin.cycleName')}
            required
            error={errors.name && t('admin.invalid')}
            {...register('name')}
          />
        </div>
        <Input
          label={t('admin.startsOn')}
          type="date"
          required
          error={errors.startsOn && t('admin.invalid')}
          {...register('startsOn')}
        />
        <Input
          label={t('admin.endsOn')}
          type="date"
          required
          error={errors.endsOn && t('admin.invalid')}
          {...register('endsOn')}
        />
      </form>
    </Modal>
  );
}

const WindowForm = z
  .object({ opensAt: z.string().min(1), closesAt: z.string().min(1), isOpen: z.boolean() })
  .refine((v) => new Date(v.closesAt) > new Date(v.opensAt), { path: ['closesAt'] });
type WindowValues = z.infer<typeof WindowForm>;

/** Offer a course in a cycle or edit its window; datetime inputs are in the admin's local time. */
export function WindowFormModal({
  target,
  cycleId,
  onClose,
}: {
  target: { course: AdminCourse; offering: Offering | null } | null;
  cycleId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('courses');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const upsert = useUpsertOffering();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WindowValues>({ resolver: zodResolver(WindowForm) });

  useEffect(() => {
    if (!target) return;
    const now = Date.now();
    reset({
      opensAt: toLocalInput(target.offering?.enrollmentOpensAt ?? new Date(now).toISOString()),
      closesAt: toLocalInput(
        target.offering?.enrollmentClosesAt ?? new Date(now + 14 * 86_400_000).toISOString(),
      ),
      isOpen: target.offering?.isOpen ?? true,
    });
  }, [target, reset]);

  const onSubmit = handleSubmit(async (v) => {
    if (!target) return;
    try {
      await upsert.mutateAsync({
        cycleId,
        courseId: target.course.id,
        enrollmentOpensAt: fromLocalInput(v.opensAt),
        enrollmentClosesAt: fromLocalInput(v.closesAt),
        isOpen: v.isOpen,
      });
      toast.show({ tone: 'success', title: t('admin.windowSaved') });
      onClose();
    } catch (err) {
      toast.show({ tone: 'error', title: errorMessage(err) });
    }
  });

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target ? t('admin.editWindowFor', { title: target.course.title }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button type="submit" form="window-form" loading={isSubmitting}>
            {t('admin.save')}
          </Button>
        </>
      }
    >
      <form
        id="window-form"
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Input
          label={t('admin.opensAt')}
          type="datetime-local"
          required
          error={errors.opensAt && t('admin.invalid')}
          {...register('opensAt')}
        />
        <Input
          label={t('admin.closesAt')}
          type="datetime-local"
          required
          error={errors.closesAt && t('admin.invalid')}
          {...register('closesAt')}
        />
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-400 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600"
              {...register('isOpen')}
            />
            {t('admin.isOpen')}
          </label>
          <p className="mt-1 text-xs text-slate-600">{t('admin.isOpenHint')}</p>
        </div>
      </form>
    </Modal>
  );
}
