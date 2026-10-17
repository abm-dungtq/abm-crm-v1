import { createContext, createElement, useContext, useState, type ReactNode } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiFailure extends Error {
  constructor(
    readonly error: ApiError,
    readonly status: number,
  ) {
    super(error.message);
  }
  get code() {
    return this.error.code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiFailure(
      { code: 'INTERNAL', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' },
      0,
    );
  }
  const body = (await response.json().catch(() => null)) as {
    ok: boolean;
    data?: T;
    error?: ApiError;
  } | null;
  if (!body) {
    throw new ApiFailure({ code: 'INTERNAL', message: `Máy chủ trả lỗi ${response.status}` }, response.status);
  }
  if (!body.ok) {
    throw new ApiFailure(body.error!, response.status);
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown = {}) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
};

export function useApi<T>(
  path: string | null,
  options: Partial<UseQueryOptions<T, ApiFailure>> = {},
) {
  return useQuery<T, ApiFailure>({
    queryKey: [path],
    queryFn: () => api.get<T>(path!),
    enabled: path !== null,
    ...options,
  });
}

export interface LearnerMe {
  displayName: string;
  email: string;
  usesDefaultPassword: boolean;
}

export interface ProgramSummary {
  id: string;
  title: string;
  className: string | null;
  state: 'open' | 'expired';
  until: string | null;
  endedAt: string | null;
  lessonCount: number;
  completedCount: number;
  nextSectionId: string | null;
}

export interface LessonVideoItem {
  id: string;
  title: string;
}

export interface LessonItem {
  id: string;
  sectionId: string;
  title: string;
  groupTitle: string | null;
  position: number;
  done: boolean;
  videos: LessonVideoItem[];
}

export interface ProgramDetail {
  program: {
    id: string;
    title: string;
    className: string | null;
    until: string | null;
  };
  lessons: LessonItem[];
  contentUrl: string;
}

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const show = (msg: string) => {
    setMessage(msg);
    window.setTimeout(() => {
      setMessage((cur) => (cur === msg ? null : cur));
    }, 3000);
  };
  return createElement(
    ToastContext.Provider,
    { value: show },
    children,
    message ? createElement('div', { className: 'toast', role: 'status' }, message) : null,
  );
}

export function useToast() {
  return useContext(ToastContext);
}
