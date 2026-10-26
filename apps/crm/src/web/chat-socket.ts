import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type ChatSocketEvent =
  | { type: 'message.created' | 'message.deleted'; conversationId: string; messageId: string }
  | { type: 'conversation.updated'; conversationId: string }
  | { type: 'read'; conversationId: string }
  | { type: 'agent.thinking'; conversationId: string; agentId: string }
  | { type: 'notification' };

/** Window event that `chat-thread.tsx` listens for to show "Trợ lý đang trả lời…" to every member, not only the sender. */
export const AGENT_THINKING_EVENT = 'chat:agent-thinking';

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000] as const;
const PING_INTERVAL_MS = 30_000;
const MAX_FAILED_CONNECTS = 10;

let socketConnected = false;
const listeners = new Set<() => void>();

function setSocketConnected(next: boolean) {
  if (socketConnected === next) return;
  socketConnected = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return socketConnected;
}

/** Reactive boolean reflecting whether the shared ChatHub WebSocket is currently connected. */
export function useChatSocketConnected(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Opens one WebSocket to `/api/chat/socket`, sends `'ping'` every 30 s, reconnects with backoff
 * (1 s, 2 s, 5 s, 10 s, 30 s), and invalidates matching React Query keys on incoming ID-only events.
 * Mount once in `layout.tsx`.
 */
export function useChatSocket(): { connected: boolean } {
  const queryClient = useQueryClient();
  const connected = useChatSocketConnected();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let failedConnects = 0;
    let hasConnectedOnce = false;
    let disposed = false;

    const clearPing = () => {
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null || failedConnects >= MAX_FAILED_CONNECTS) return;
      const delay = BACKOFF_MS[Math.min(Math.max(0, failedConnects - 1), BACKOFF_MS.length - 1)]!;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const handleEvent = (raw: unknown) => {
      if (typeof raw !== 'string' || raw === 'pong') return;
      let event: ChatSocketEvent | null = null;
      try {
        event = JSON.parse(raw) as ChatSocketEvent;
      } catch {
        return;
      }
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;

      if (
        (event.type === 'message.created' || event.type === 'message.deleted') &&
        typeof event.conversationId === 'string'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['chat', event.conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
        return;
      }

      if (event.type === 'conversation.updated' && typeof event.conversationId === 'string') {
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversation', event.conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['chat', event.conversationId] });
        return;
      }

      // A read marker changes only unread counts; refetching the messages here would cost a request per read.
      if (event.type === 'read' && typeof event.conversationId === 'string') {
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
        return;
      }

      if (event.type === 'agent.thinking' && typeof event.conversationId === 'string') {
        window.dispatchEvent(new CustomEvent(AGENT_THINKING_EVENT, {
          detail: { conversationId: event.conversationId, agentId: event.agentId },
        }));
        return;
      }

      if (event.type === 'notification') {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }
    };

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${window.location.host}/api/chat/socket`;

      let opened = false;
      try {
        ws = new WebSocket(url);
      } catch {
        failedConnects += 1;
        setSocketConnected(false);
        scheduleReconnect();
        return;
      }

      ws.addEventListener('open', () => {
        if (disposed) return;
        opened = true;
        const isReconnect = hasConnectedOnce;
        hasConnectedOnce = true;
        failedConnects = 0;
        setSocketConnected(true);
        clearPing();
        pingTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send('ping');
            } catch {
              /* socket closing */
            }
          }
        }, PING_INTERVAL_MS);

        if (isReconnect) {
          void queryClient.invalidateQueries({ queryKey: ['chat'] });
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      });

      ws.addEventListener('message', (e) => {
        if (disposed) return;
        handleEvent(e.data);
      });

      ws.addEventListener('close', () => {
        clearPing();
        setSocketConnected(false);
        if (!opened) {
          failedConnects += 1;
        }
        if (!disposed) {
          scheduleReconnect();
        }
      });

      ws.addEventListener('error', () => {
        // The browser fires 'close' after 'error', which triggers scheduleReconnect.
      });
    };

    const resume = () => {
      if (disposed) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      failedConnects = 0;
      clearReconnect();
      connect();
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        resume();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);

    connect();

    return () => {
      disposed = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      clearPing();
      clearReconnect();
      setSocketConnected(false);
      if (ws) {
        try {
          ws.close(1000, 'unmount');
        } catch {
          /* ignore */
        }
        ws = null;
      }
    };
  }, [queryClient]);

  return { connected };
}
