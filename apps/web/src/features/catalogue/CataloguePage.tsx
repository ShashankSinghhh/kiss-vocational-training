import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { INACTIVE_ENROLLMENT_STATUSES, type CatalogueCourse } from '@vtmp/shared';
import { Badge, Card, EmptyState, Input, PageSkeleton, Select } from '../../components/ui';
import { useErrorMessage } from '../../lib/api/useErrorMessage';
import { formatDay } from '../../lib/format';
import { usePersistentState } from '../../lib/usePersistentState';
import { useMyEnrollments } from '../enrollment/api';
import { StatusBadge } from '../enrollment/StatusBadge';
import { useCatalogue, useCycles } from './api';
import { WindowBadge } from './WindowBadge';

/** Courses not filed under any programme are grouped under this value of ?programme=. */
const OTHER = 'other';
const programmeKey = (c: CatalogueCourse) => c.programme?.id ?? OTHER;

const secondaryLink =
  'inline-flex h-9 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/**
 * Student course catalogue (BRQ-2.2): the student first chooses a training cycle (nothing is
 * pre-selected), then a programme (a group of related courses), then sees that programme's
 * courses with seats, window state and countdown. Both choices live in the address
 * (?cycle=&programme=), so links, reloads and the back button keep them. Courses the student
 * has already applied for in that cycle show the application's status instead of Apply.
 */
export function CataloguePage() {
  const { t, i18n } = useTranslation('courses');
  const lng = i18n.resolvedLanguage ?? 'en';
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const cycleId = params.get('cycle') ?? '';
  const programmeId = params.get('programme') ?? '';
  const cycles = useCycles();
  const { data, isPending, isError, error } = useCatalogue(cycleId || undefined);
  const mine = useMyEnrollments();
  const application = mine.data?.find(
    (e) => e.cycleId === cycleId && !INACTIVE_ENROLLMENT_STATUSES.includes(e.status),
  );
  const choiceOf = (courseId: string) =>
    application?.preferences.find((p) => p.courseId === courseId)?.rank;
  const inCycle = `cycle=${cycleId}`;
  const choose = (key: 'cycle' | 'programme', id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set(key, id);
    else next.delete(key);
    // A different cycle may not offer the same programmes.
    if (key === 'cycle') next.delete('programme');
    setParams(next);
  };
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = usePersistentState(
    'catalogue.openOnly',
    false,
    (v): v is boolean => typeof v === 'boolean',
  );

  // Programmes on offer in this cycle, in the admin's order, each with its course count.
  const programmes = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; courses: number; open: number }>();
    for (const c of data?.courses ?? []) {
      const key = programmeKey(c);
      const g = groups.get(key) ?? {
        id: key,
        name: c.programme?.name ?? t('catalogue.otherCourses'),
        courses: 0,
        open: 0,
      };
      g.courses += 1;
      if (c.offering?.windowState === 'OPEN') g.open += 1;
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [data, t]);
  // With only one group there is nothing to choose: show its courses straight away.
  const programme =
    programmes.length === 1 ? programmes[0] : programmes.find((p) => p.id === programmeId);

  const courses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.courses ?? []).filter(
      (c) =>
        programmeKey(c) === programme?.id &&
        (!openOnly || c.offering?.windowState === 'OPEN') &&
        (!q || `${c.title} ${c.code} ${c.description}`.toLowerCase().includes(q)),
    );
  }, [data, search, openOnly, programme]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('catalogue.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-700">{t('catalogue.intro')}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-80">
          <Select
            label={t('catalogue.cycle')}
            value={cycleId}
            onChange={(e) => choose('cycle', e.target.value)}
            disabled={!cycles.data?.length}
            options={[
              { value: '', label: t('catalogue.chooseCycle') },
              ...(cycles.data ?? []).map((c) => ({
                value: c.id,
                // L7: say whether the cycle takes applications, so nobody picks a closed one
                // expecting to apply.
                label: `${t('catalogue.cycleOption', {
                  name: c.name,
                  from: formatDay(c.startsOn, lng),
                  to: formatDay(c.endsOn, lng),
                })} · ${t(`catalogue.applications.${c.applications}`)}`,
              })),
            ]}
          />
        </div>
        {cycleId && programmes.length > 1 && (
          <div className="sm:w-72">
            <Select
              label={t('catalogue.programme')}
              value={programme?.id ?? ''}
              onChange={(e) => choose('programme', e.target.value)}
              options={[
                { value: '', label: t('catalogue.chooseProgramme') },
                ...programmes.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
        )}
        <div className="sm:w-64">
          <Input
            label={t('catalogue.search')}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-400 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600"
          />
          {t('catalogue.openOnly')}
        </label>
      </div>

      {cycles.isPending ? (
        <PageSkeleton />
      ) : cycles.isError ? (
        <EmptyState title={errorMessage(cycles.error)} />
      ) : cycles.data.length === 0 ? (
        <EmptyState title={t('catalogue.noCycle')} />
      ) : !cycleId ? (
        <EmptyState title={t('catalogue.pickCycle')} description={t('catalogue.pickCycleHint')} />
      ) : isPending || mine.isPending ? (
        <PageSkeleton />
      ) : isError ? (
        <EmptyState title={errorMessage(error)} />
      ) : programmes.length === 0 ? (
        <EmptyState title={t('catalogue.empty')} />
      ) : !programme ? (
        <section aria-labelledby="programmes-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="programmes-heading" className="text-lg font-semibold text-slate-900">
              {t('catalogue.pickProgramme')}
            </h2>
            <p className="text-sm text-slate-700">{t('catalogue.pickProgrammeHint')}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {programmes.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose('programme', p.id)}
                  className="flex h-full w-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-600 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  <span className="text-base font-semibold text-slate-900">{p.name}</span>
                  <span className="text-sm text-slate-700">
                    {t('catalogue.programmeCourses', { count: p.courses })}
                  </span>
                  {p.open > 0 && (
                    <span className="self-start">
                      <Badge tone="success">
                        {t('catalogue.programmeOpen', { count: p.open })}
                      </Badge>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : courses.length === 0 ? (
        <EmptyState title={t('catalogue.empty')} />
      ) : (
        <ul
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label={t('catalogue.caption')}
        >
          {courses.map((c) => {
            const choice = choiceOf(c.id);
            return (
              <li key={c.id}>
                <Card className="flex h-full flex-col" title={c.title} headingLevel={2}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                    {c.code}
                  </p>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm text-slate-700">{c.description}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-600">{t('fields.duration')}</dt>
                      <dd className="font-medium text-slate-900">
                        {t('fields.durationValue', { count: c.durationWeeks })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">{t('fields.seatsRemaining')}</dt>
                      <dd>
                        {c.seatsRemaining > 0 ? (
                          <Badge tone={c.seatsRemaining <= 5 ? 'warning' : 'neutral'}>
                            {t('fields.seatsLeft', { count: c.seatsRemaining })}
                          </Badge>
                        ) : (
                          <Badge tone="danger">{t('fields.full')}</Badge>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <WindowBadge offering={c.offering} />
                  </div>
                  {application && choice !== undefined && (
                    <div
                      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
                      data-testid="applied-badge"
                    >
                      <Badge tone="info">{t('catalogue.applied', { rank: choice })}</Badge>
                      <StatusBadge status={application.status} />
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      to={`/student/courses/${c.id}?${inCycle}`}
                      className={secondaryLink}
                      aria-label={`${t('catalogue.viewDetails')}: ${c.title}`}
                    >
                      {t('catalogue.viewDetails')}
                    </Link>
                    {application && choice !== undefined ? (
                      <Link
                        to="/student/enrollment"
                        className={secondaryLink}
                        aria-label={`${t('catalogue.viewApplication')}: ${c.title}`}
                      >
                        {t('catalogue.viewApplication')}
                      </Link>
                    ) : application ? (
                      application.editable &&
                      c.offering?.windowState === 'OPEN' && (
                        <Link
                          to={`/student/enrollment/apply?edit=${application.id}&${inCycle}`}
                          className={secondaryLink}
                          aria-label={`${t('catalogue.changeChoices')}: ${c.title}`}
                        >
                          {t('catalogue.changeChoices')}
                        </Link>
                      )
                    ) : (
                      c.offering?.windowState === 'OPEN' && (
                        <Link
                          to={`/student/enrollment/apply?courseId=${c.id}&${inCycle}`}
                          className="inline-flex h-9 items-center rounded-md bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                          aria-label={`${t('catalogue.applyNow')}: ${c.title}`}
                        >
                          {t('catalogue.applyNow')}
                        </Link>
                      )
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
