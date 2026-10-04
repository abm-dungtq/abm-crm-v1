import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { ApiError, CommandName } from '@abm/contracts';

const USER_KEY = 'abm-crm-demo-user';

export function getDemoUser(): string | null {
  try { return localStorage.getItem(USER_KEY); } catch { return null; }
}
export function setDemoUser(id: string | null) {
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    else localStorage.removeItem(USER_KEY);
  } catch { /* storage unavailable: the choice lasts for this page only */ }
  memoryUser = id;
}
let memoryUser: string | null = getDemoUser();
export const currentDemoUser = () => memoryUser;

export class ApiFailure extends Error {
  constructor(readonly error: ApiError, readonly status: number) {
    super(error.message);
  }
  get code() { return this.error.code; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (memoryUser) headers.set('X-Demo-User', memoryUser);
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiFailure({ code: 'INTERNAL', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' }, 0);
  }
  const body = await response.json().catch(() => null) as { ok: boolean; data?: T; error?: ApiError } | null;
  if (!body) throw new ApiFailure({ code: 'INTERNAL', message: `Máy chủ trả lỗi ${response.status}` }, response.status);
  if (!body.ok) throw new ApiFailure(body.error!, response.status);
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  command: <T>(name: CommandName, input: unknown, idempotencyKey: string) =>
    request<T>(`/commands/${name}`, { method: 'POST', body: JSON.stringify(input), headers: { 'Idempotency-Key': idempotencyKey } }),
};

export function useApi<T>(path: string | null, options: Partial<UseQueryOptions<T, ApiFailure>> = {}) {
  return useQuery<T, ApiFailure>({
    queryKey: [memoryUser, path],
    queryFn: () => api.get<T>(path!),
    enabled: path !== null,
    ...options,
  });
}

/**
 * One idempotency key per user intent: a retry after a failure reuses it (so a request that
 * committed but lost its response replays instead of writing twice); success rotates it.
 */
export function useCommand<I, T = unknown>(name: CommandName) {
  const client = useQueryClient();
  const key = useRef(crypto.randomUUID());
  return useMutation<T, ApiFailure, I>({
    mutationFn: (input) => api.command<T>(name, input, key.current),
    onSuccess: () => { key.current = crypto.randomUUID(); },
    onSettled: (_data, error) => {
      if (!error || error.code === 'STALE_VERSION') void client.invalidateQueries();
    },
  });
}
