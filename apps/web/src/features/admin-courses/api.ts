import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminCourse,
  BulkStatusInput,
  BulkStatusResult,
  CourseCreateInput,
  CourseUpdateInput,
  Cycle,
  CycleCreateInput,
  Offering,
  OfferingUpsertInput,
  Programme,
  ProgrammeInput,
  ProgrammeUpdateInput,
} from '@vtmp/shared';
import { api } from '../../lib/api/client';

export function useAdminCourses(enabled = true) {
  return useQuery({
    queryKey: ['admin-courses'],
    enabled,
    queryFn: ({ signal }) => api.get<AdminCourse[]>('/admin/courses', { signal }),
  });
}

export function useAdminCycles() {
  return useQuery({
    queryKey: ['cycles'],
    queryFn: ({ signal }) => api.get<Cycle[]>('/admin/cycles', { signal }),
  });
}

export function useOfferings(cycleId: string | undefined) {
  return useQuery({
    queryKey: ['offerings', cycleId],
    enabled: !!cycleId,
    queryFn: ({ signal }) =>
      api.get<Array<{ course: AdminCourse; offering: Offering | null }>>(
        `/admin/cycles/${cycleId}/offerings`,
        { signal },
      ),
  });
}

export function useAdminProgrammes() {
  return useQuery({
    queryKey: ['programmes'],
    queryFn: ({ signal }) => api.get<Programme[]>('/admin/programmes', { signal }),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['admin-courses', 'cycles', 'offerings', 'catalogue', 'programmes'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export function useCreateCourse() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: CourseCreateInput) => api.post<AdminCourse>('/admin/courses', input),
    onSuccess: refresh,
  });
}

export function useUpdateCourse() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...input }: CourseUpdateInput & { id: string }) =>
      api.patch<AdminCourse>(`/admin/courses/${id}`, input),
    onSuccess: refresh,
  });
}

export function useSetCoursesActive() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: BulkStatusInput) =>
      api.post<BulkStatusResult>('/admin/courses/bulk-status', input, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: refresh,
  });
}

export function useDeleteCourse() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/courses/${id}`),
    onSuccess: refresh,
  });
}

export function useCreateCycle() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: CycleCreateInput) => api.post<Cycle>('/admin/cycles', input),
    onSuccess: refresh,
  });
}

export function useUpsertOffering() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      cycleId,
      courseId,
      ...input
    }: OfferingUpsertInput & { cycleId: string; courseId: string }) =>
      api.put<Offering>(`/admin/cycles/${cycleId}/offerings/${courseId}`, input),
    onSuccess: refresh,
  });
}

export function useCreateProgramme() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: ProgrammeInput) => api.post<Programme>('/admin/programmes', input),
    onSuccess: refresh,
  });
}

export function useUpdateProgramme() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...input }: ProgrammeUpdateInput & { id: string }) =>
      api.patch<Programme>(`/admin/programmes/${id}`, input),
    onSuccess: refresh,
  });
}
