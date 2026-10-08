import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { ApiError, CommandName, ConversationMode } from '@abm/contracts';
import type {
  AssignResult, ChannelAccount, ChannelAccountUpdate, ClassifyIntakeResult, ConversationFilter, CustomerBotSwitch, GroupSchedule,
  GroupScheduleInput, InboxConversation, InboxMessage, InboxSettings, InboxSettingsUpdate, IntakeField, IntakePipeline, IntakeStatus,
  IntakeValues, LeadIntake, RosterMember, SendMessageResult, SetModeResult, ZaloGroup, ZaloGroupUpdate,
} from './types';

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

export type AuthMode = 'password' | 'demo' | 'unconfigured';
let authMode: AuthMode | null = null;
export const currentAuthMode = () => authMode;

export class ApiFailure extends Error {
  constructor(readonly error: ApiError, readonly status: number) {
    super(error.message);
  }
  get code() { return this.error.code; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // The session cookie travels on its own; the demo header only matters in demo mode.
  if (memoryUser && authMode !== 'password') headers.set('X-Demo-User', memoryUser);
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
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
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

/** Asked once per page load; everything else depends on it, so it is fetched before any identity. */
export function useAuthMode() {
  return useQuery<AuthMode, ApiFailure>({
    queryKey: ['auth-mode'],
    queryFn: async () => {
      authMode = (await api.get<{ mode: AuthMode }>('/auth/mode')).mode;
      if (authMode === 'password') setDemoUser(null);
      return authMode;
    },
    staleTime: Infinity,
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

// ---------- omnichannel inbox ----------
const enc = encodeURIComponent;

/** Query string of GET /inbox/conversations; empty filters are left out. */
export function conversationsPath(filter: ConversationFilter = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter) as [keyof ConversationFilter, string | undefined][]) {
    const text = value?.trim();
    if (text) params.set(key, text);
  }
  const query = params.toString();
  return `/inbox/conversations${query ? `?${query}` : ''}`;
}

export const listConversations = (filter: ConversationFilter = {}) => api.get<InboxConversation[]>(conversationsPath(filter));
export const getConversation = (id: string) => api.get<InboxConversation>(`/inbox/conversations/${enc(id)}`);
/** Latest page oldest first, or with `after` only the messages created after that instant. */
export const listMessages = (id: string, after?: string) =>
  api.get<InboxMessage[]>(`/inbox/conversations/${enc(id)}/messages${after ? `?after=${enc(after)}` : ''}`);
export const sendMessage = (id: string, text: string) => api.post<SendMessageResult>(`/inbox/conversations/${enc(id)}/messages`, { text });
export const setMode = (id: string, mode: ConversationMode) => api.post<SetModeResult>(`/inbox/conversations/${enc(id)}/mode`, { mode });
export const listAccounts = () => api.get<ChannelAccount[]>('/inbox/accounts');
export const createAccount = (input: { displayName: string; agentKey: string }) => api.post<ChannelAccount>('/inbox/accounts', input);
export const updateAccount = (id: string, input: ChannelAccountUpdate) => api.patch<ChannelAccount>(`/inbox/accounts/${enc(id)}`, input);
export const connectAccount = (id: string) => api.post<{ commandId: string }>(`/inbox/accounts/${enc(id)}/connect`);
export const disconnectAccount = (id: string) => api.post<{ commandId: string }>(`/inbox/accounts/${enc(id)}/disconnect`);
export const getCustomerBotSwitch = () => api.get<CustomerBotSwitch>('/inbox/customer-bot-switch');
export const setCustomerBotSwitch = (enabled: boolean) => api.put<CustomerBotSwitch>('/inbox/customer-bot-switch', { enabled });

// ---------- inbox assignment ----------
export const assignConversation = (id: string, userId: string) =>
  api.post<AssignResult>(`/inbox/conversations/${enc(id)}/assign`, { userId });
export const getInboxSettings = () => api.get<InboxSettings>('/inbox/settings');
export const updateInboxSettings = (input: InboxSettingsUpdate) => api.put<InboxSettings>('/inbox/settings', input);
export const listRoster = () => api.get<RosterMember[]>('/inbox/roster');
export const setOnDuty = (userId: string, onDuty: boolean) => api.put<{ userId: string; onDuty: boolean }>('/inbox/roster', { userId, onDuty });

// ---------- lead intake ----------
export const listIntakes = (filter: { status?: IntakeStatus; conversationId?: string } = {}) => {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.conversationId) params.set('conversationId', filter.conversationId);
  const query = params.toString();
  return api.get<LeadIntake[]>(`/inbox/intakes${query ? `?${query}` : ''}`);
};
/** `input` is the createLead / createLearnerLead form; the server sets `source` from the channel. */
export const classifyIntake = (id: string, pipeline: IntakePipeline, input: Record<string, unknown>) =>
  api.post<ClassifyIntakeResult>(`/inbox/intakes/${enc(id)}/classify`, { pipeline, input });
export const discardIntake = (id: string) => api.post<{ intakeId: string }>(`/inbox/intakes/${enc(id)}/discard`);
export const confirmIntakeField = (id: string, field: IntakeField) =>
  api.post<{ intakeId: string; fields: IntakeValues }>(`/inbox/intakes/${enc(id)}/confirm-field`, { field });
export const linkIntakeContact = (id: string, contactId: string) =>
  api.post<{ intakeId: string; contactId: string }>(`/inbox/intakes/${enc(id)}/link-contact`, { contactId });
/** "Cập nhật CRM": queues an extraction of a direct conversation now. */
export const requestExtraction = (conversationId: string) =>
  api.post<{ commandId: string }>(`/inbox/conversations/${enc(conversationId)}/extract`);

// ---------- Zalo groups and recurring posts ----------
/** Groups of the organization, optionally of one channel account. */
export const listGroups = (account?: string) => api.get<ZaloGroup[]>(`/inbox/groups${account ? `?account=${enc(account)}` : ''}`);
export const updateGroup = (id: string, input: ZaloGroupUpdate) => api.patch<ZaloGroup>(`/inbox/groups/${enc(id)}`, input);
/** Schedules of the organization, newest first, optionally of one group. */
export const listGroupSchedules = (conversationId?: string) =>
  api.get<GroupSchedule[]>(`/inbox/group-schedules${conversationId ? `?conversationId=${enc(conversationId)}` : ''}`);
export const createGroupSchedule = (input: GroupScheduleInput & { conversationId: string }) =>
  api.post<GroupSchedule>('/inbox/group-schedules', input);
export const updateGroupSchedule = (id: string, input: Partial<GroupScheduleInput>) =>
  api.patch<GroupSchedule>(`/inbox/group-schedules/${enc(id)}`, input);
export const deleteGroupSchedule = (id: string) => api.delete<{ id: string }>(`/inbox/group-schedules/${enc(id)}`);
export type GroupScheduleAction = 'submit' | 'approve' | 'pause';
export const moveGroupSchedule = (id: string, action: GroupScheduleAction) =>
  api.post<GroupSchedule>(`/inbox/group-schedules/${enc(id)}/${action}`);
