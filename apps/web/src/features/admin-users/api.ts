import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  BulkStatusInput,
  BulkStatusResult,
  Paginated,
  Role,
  UserSummary,
} from '@vtmp/shared';
import { api } from '../../lib/api/client';

export interface UserFilters {
  page: number;
  q: string;
  role: Role | '';
  isActive: '' | 'true' | 'false';
}

export const PAGE_SIZE = 20;

export function useUsers(filters: UserFilters) {
  return useQuery({
    queryKey: ['admin-users', filters],
    queryFn: ({ signal }) =>
      api.get<Paginated<UserSummary>>('/admin/users', {
        signal,
        query: {
          page: filters.page,
          pageSize: PAGE_SIZE,
          q: filters.q || undefined,
          role: filters.role || undefined,
          isActive: filters.isActive || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminCreateUserInput) => api.post<UserSummary>('/admin/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AdminUpdateUserInput & { id: string }) =>
      api.patch<UserSummary>(`/admin/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useSetUsersActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkStatusInput) =>
      api.post<BulkStatusResult>('/admin/users/bulk-status', input, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useUnlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<UserSummary>(`/admin/users/${id}/unlock`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; password: string; mustChangePassword: boolean }) =>
      api.post<UserSummary>(`/admin/users/${id}/password`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}
