import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AllocationPreview,
  BatchCreateInput,
  BatchDetail,
  BatchStatus,
  BatchSummary,
  BatchUpdateInput,
  Candidate,
  SessionCreateInput,
  SessionDto,
  TrainerOption,
} from '@vtmp/shared';
import { api } from '../../lib/api/client';

export function useMyBatches() {
  return useQuery({
    queryKey: ['batches', 'mine'],
    queryFn: ({ signal }) => api.get<BatchSummary[]>('/batches/mine', { signal }),
  });
}

export function useBatch(batchId: string) {
  return useQuery({
    queryKey: ['batches', batchId],
    // No request until a batch is chosen (the Completion page starts with none).
    enabled: !!batchId,
    queryFn: ({ signal }) => api.get<BatchDetail>(`/batches/${batchId}`, { signal }),
  });
}

export function useSessions(batchId: string) {
  return useQuery({
    queryKey: ['batches', batchId, 'sessions'],
    queryFn: ({ signal }) => api.get<SessionDto[]>(`/batches/${batchId}/sessions`, { signal }),
  });
}

export function useAdminBatches(filters: {
  cycleId?: string;
  courseId?: string;
  status?: BatchStatus | '';
}) {
  return useQuery({
    queryKey: ['batches', 'admin', filters],
    enabled: !!filters.cycleId,
    queryFn: ({ signal }) =>
      api.get<BatchSummary[]>('/admin/batches', {
        signal,
        query: {
          cycleId: filters.cycleId,
          courseId: filters.courseId || undefined,
          status: filters.status || undefined,
        },
      }),
  });
}

export function useCandidates(batchId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['batches', batchId, 'candidates'],
    enabled,
    queryFn: ({ signal }) =>
      api.get<Candidate[]>(`/admin/batches/${batchId}/candidates`, { signal }),
  });
}

export function useTrainers() {
  return useQuery({
    queryKey: ['trainers'],
    queryFn: ({ signal }) => api.get<TrainerOption[]>('/admin/trainers', { signal }),
    staleTime: 5 * 60_000,
  });
}

/** Any batch change can affect lists, rosters, seats and applications: refresh them all. */
function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['batches', 'catalogue', 'admin-enrollments', 'my-enrollments'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

function useBatchMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: fn, onSuccess: refresh });
}

export const useCreateBatch = () =>
  useBatchMutation((input: BatchCreateInput) => api.post<BatchSummary>('/admin/batches', input));

export const useUpdateBatch = () =>
  useBatchMutation(({ id, ...input }: BatchUpdateInput & { id: string }) =>
    api.patch<BatchSummary>(`/admin/batches/${id}`, input),
  );

export const useActivateBatch = () =>
  useBatchMutation((id: string) =>
    api.post<BatchSummary>(`/admin/batches/${id}/activate`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  );

export const useCloseBatch = () =>
  useBatchMutation((id: string) =>
    api.post<BatchSummary>(`/admin/batches/${id}/close`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  );

export const usePlaceStudent = () =>
  useBatchMutation(({ batchId, enrollmentId }: { batchId: string; enrollmentId: string }) =>
    api.post<BatchDetail>(`/admin/batches/${batchId}/students`, { enrollmentId }),
  );

export const useRemoveStudent = () =>
  useBatchMutation(({ batchId, enrollmentId }: { batchId: string; enrollmentId: string }) =>
    api.delete<BatchDetail>(`/admin/batches/${batchId}/students/${enrollmentId}`),
  );

export const useWithdrawStudent = () =>
  useBatchMutation(
    ({
      batchId,
      enrollmentId,
      reason,
    }: {
      batchId: string;
      enrollmentId: string;
      reason: string;
    }) =>
      api.post<BatchDetail>(
        `/admin/batches/${batchId}/students/${enrollmentId}/withdraw`,
        { reason },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      ),
  );

export const useMoveStudent = () =>
  useBatchMutation(
    ({
      batchId,
      enrollmentId,
      toBatchId,
    }: {
      batchId: string;
      enrollmentId: string;
      toBatchId: string;
    }) =>
      api.post<BatchDetail>(`/admin/batches/${batchId}/students/${enrollmentId}/move`, {
        toBatchId,
      }),
  );

export const useAssignTrainer = () =>
  useBatchMutation(({ batchId, trainerId }: { batchId: string; trainerId: string }) =>
    api.post<BatchDetail>(`/admin/batches/${batchId}/trainers`, { trainerId }),
  );

export const useUnassignTrainer = () =>
  useBatchMutation(({ batchId, trainerId }: { batchId: string; trainerId: string }) =>
    api.delete<BatchDetail>(`/admin/batches/${batchId}/trainers/${trainerId}`),
  );

export const useCreateSessions = () =>
  useBatchMutation(({ batchId, input }: { batchId: string; input: SessionCreateInput }) =>
    api.post<SessionDto[]>(`/admin/batches/${batchId}/sessions`, input),
  );

export const useCancelSession = () =>
  useBatchMutation(({ batchId, sessionId }: { batchId: string; sessionId: string }) =>
    api.patch<SessionDto>(`/admin/batches/${batchId}/sessions/${sessionId}`, {
      status: 'CANCELLED',
    }),
  );

export function usePreviewAllocation() {
  return useMutation({
    mutationFn: (cycleId: string) =>
      api.post<AllocationPreview>('/admin/allocations/preview', { cycleId }),
  });
}

export function useConfirmAllocation() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (previewId: string) =>
      api.post<{ previewId: string; allocated: number; waitlisted: number }>(
        '/admin/allocations/confirm',
        { previewId },
        // The key derives from the preview, so a double click can never apply it twice.
        { headers: { 'Idempotency-Key': `alloc-${previewId}` } },
      ),
    onSuccess: refresh,
  });
}
