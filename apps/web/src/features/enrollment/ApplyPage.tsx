import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { INACTIVE_ENROLLMENT_STATUSES, MAX_PREFERENCES, type CatalogueCourse } from '@vtmp/shared';
import { Button, Card, EmptyState, PageSkeleton } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { useCatalogue } from '../catalogue/api';
import { useMyEnrollments, useSubmitEnrollment, useUpdateEnrollment } from './api';

const linkClass =
  'text-sm font-medium text-brand-700 underline hover:text-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/**
 * Apply (or edit) with up to the configured number of ranked preferences (BRQ-3.1; setting
 * enrollment.maxPreferences, 1 at KISS: one course). Courses are grouped by programme. Ranking
 * uses selects plus move up/down buttons, which work with keyboard and screen readers.
 */
export function ApplyPage() {
  const { t } = useTranslation('enrollment');
  const toast = useToast();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const preselect = params.get('courseId');

  const mine = useMyEnrollments();
  const editing = mine.data?.find((e) => e.id === editId) ?? null;
  // The cycle comes from the Courses page link, or from the application being edited.
  const cycleId = params.get('cycle') ?? editing?.cycleId;
  const catalogue = useCatalogue(cycleId);
  const submit = useSubmitEnrollment();
  const update = useUpdateEnrollment();
  const [slots, setSlots] = useState<string[]>(['']);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const cycle = catalogue.data?.cycle ?? null;
  const active = mine.data?.find(
    (e) => e.cycleId === cycle?.id && !INACTIVE_ENROLLMENT_STATUSES.includes(e.status),
  );
  const openCourses = useMemo(
    () => (catalogue.data?.courses ?? []).filter((c) => c.offering?.windowState === 'OPEN'),
    [catalogue.data],
  );
  const maxPreferences = catalogue.data?.maxPreferences ?? MAX_PREFERENCES;
  // Open courses by programme, keeping the catalogue's order (programmes, then titles).
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; courses: CatalogueCourse[] }>();
    for (const c of openCourses) {
      const key = c.programme?.id ?? '';
      const g = m.get(key) ?? { name: c.programme?.name ?? '', courses: [] };
      g.courses.push(c);
      m.set(key, g);
    }
    return [...m.values()];
  }, [openCourses]);

  useEffect(() => {
    if (prefilled || !catalogue.data || !mine.data) return;
    if (editing) setSlots(editing.preferences.map((p) => p.courseId));
    else if (preselect && openCourses.some((c) => c.id === preselect)) setSlots([preselect]);
    setPrefilled(true);
  }, [prefilled, catalogue.data, mine.data, editing, preselect, openCourses]);

  if (mine.isPending) return <PageSkeleton />;
  if (!cycleId) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t('apply.title')}</h1>
        <EmptyState
          title={t('apply.pickCycle')}
          action={
            <Link to="/student/courses" className={linkClass}>
              {t('apply.toCourses')}
            </Link>
          }
        />
      </div>
    );
  }
  if (catalogue.isPending) return <PageSkeleton />;
  if (catalogue.isError) return <EmptyState title={errorMessage(catalogue.error)} />;

  if (!editing && active) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t('apply.title')}</h1>
        <EmptyState
          title={t('apply.alreadyApplied')}
          action={
            <Link to="/student/enrollment" className={linkClass}>
              {t('apply.viewMine')}
            </Link>
          }
        />
      </div>
    );
  }
  if (!cycle || openCourses.length === 0) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t('apply.title')}</h1>
        <EmptyState title={t('apply.nothingOpen')} />
      </div>
    );
  }

  const chosen = slots.filter(Boolean);
  const setSlot = (i: number, value: string) =>
    setSlots((s) => s.map((v, j) => (j === i ? value : v)));
  const move = (i: number, by: -1 | 1) =>
    setSlots((s) => {
      const next = [...s];
      [next[i], next[i + by]] = [next[i + by]!, next[i]!];
      return next;
    });
  const remove = (i: number) =>
    setSlots((s) => (s.length === 1 ? [''] : s.filter((_, j) => j !== i)));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (chosen.length === 0) return setError(t('apply.needOne'));
    if (new Set(chosen).size !== chosen.length) return setError(t('apply.duplicate'));
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, courseIds: chosen });
        toast.show({ tone: 'success', title: t('apply.updated') });
      } else {
        await submit.mutateAsync({ cycleId: cycle.id, courseIds: chosen });
        toast.show({ tone: 'success', title: t('apply.submitted') });
      }
      navigate('/student/enrollment');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {editing ? t('apply.editTitle') : t('apply.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-700">
          {maxPreferences === 1 ? t('apply.introOne') : t('apply.intro', { max: maxPreferences })}
        </p>
        <p className="mt-1 text-sm font-medium text-slate-800">
          {t('apply.cycle', { name: cycle.name })}
        </p>
      </div>
      <Card>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </div>
          )}
          <ol className="flex flex-col gap-3">
            {slots.map((value, i) => {
              const id = `pref-${i}`;
              const takenElsewhere = new Set(slots.filter((_, j) => j !== i));
              return (
                <li
                  key={i}
                  className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-end"
                >
                  <div className="flex-1">
                    <label htmlFor={id} className="text-sm font-medium text-slate-800">
                      {maxPreferences === 1 ? t('apply.course') : t('apply.rank', { rank: i + 1 })}
                    </label>
                    <select
                      id={id}
                      value={value}
                      onChange={(e) => setSlot(i, e.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-400 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    >
                      <option value="">{t('apply.noChoice')}</option>
                      {groups.map((g) => {
                        const options = g.courses
                          .filter((c) => c.id === value || !takenElsewhere.has(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title} ({c.code})
                            </option>
                          ));
                        return g.name ? (
                          <optgroup key={g.name} label={g.name}>
                            {options}
                          </optgroup>
                        ) : (
                          options
                        );
                      })}
                    </select>
                  </div>
                  {maxPreferences > 1 && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={t('apply.moveUp', { rank: i + 1 })}
                      >
                        <span aria-hidden="true">↑</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={i === slots.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={t('apply.moveDown', { rank: i + 1 })}
                      >
                        <span aria-hidden="true">↓</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(i)}
                        aria-label={t('apply.remove', { rank: i + 1 })}
                      >
                        <span aria-hidden="true">✕</span>
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {slots.length < Math.min(maxPreferences, openCourses.length) && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setSlots((s) => [...s, ''])}>
                {t('apply.choose')}
              </Button>
            </div>
          )}
          <p className="text-xs text-slate-600">{t('apply.onlyOpen')}</p>
          <div>
            <Button type="submit" loading={submit.isPending || update.isPending}>
              {editing ? t('apply.update') : t('apply.submit')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
