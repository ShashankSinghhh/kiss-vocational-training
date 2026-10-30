import { useQuery } from '@tanstack/react-query';
import type { CatalogueCourse, CatalogueCycle, Cycle } from '@vtmp/shared';
import { api } from '../../lib/api/client';

export interface CatalogueResponse {
  cycle: Cycle | null;
  courses: CatalogueCourse[];
}

/**
 * Cycles a student can choose from: offering active courses and not yet ended, those taking
 * applications first (L7).
 */
export function useCycles() {
  return useQuery({
    queryKey: ['cycles'],
    queryFn: ({ signal }) => api.get<CatalogueCycle[]>('/cycles', { signal }),
  });
}

/** Courses of the cycle the student chose; nothing is fetched until a cycle is chosen. */
export function useCatalogue(cycleId: string | undefined) {
  return useQuery({
    queryKey: ['catalogue', cycleId],
    enabled: !!cycleId,
    queryFn: ({ signal }) => api.get<CatalogueResponse>('/courses', { signal, query: { cycleId } }),
  });
}

export function useCatalogueCourse(id: string, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['catalogue', cycleId, id],
    enabled: !!cycleId,
    queryFn: ({ signal }) =>
      api.get<{ cycle: Cycle; course: CatalogueCourse }>(`/courses/${id}`, {
        signal,
        query: { cycleId },
      }),
  });
}
