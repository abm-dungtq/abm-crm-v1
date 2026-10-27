import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, api } from '../api';
import { useChatSocketConnected } from '../chat-socket';
import { fmtDateTime } from '../format';
import { Empty, ErrorState, Loading } from './ui';

export interface NotificationItem {
  id: string;
  kind: 'chat_direct' | 'chat_mention' | 'chat_thread' | 'task_assigned' | 'task_due' | 'approval' | 'inbox' | 'system';
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const client = useQueryClient();
  const connected = useChatSocketConnected();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unreadQuery = useQuery<{ total: number }, ApiFailure>({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ total: number }>('/notifications/unread'),
    refetchInterval: connected ? false : 60_000,
  });

  const listQuery = useQuery<NotificationItem[], ApiFailure>({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<NotificationItem[]>('/notifications'),
    enabled: open,
    refetchInterval: open && !connected ? 60_000 : false,
  });

  const markReadMutation = useMutation<{ readAt: string }, ApiFailure, { ids?: string[] }>({
    mutationFn: (payload) => api.post<{ readAt: string }>('/notifications/read', payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadTotal = unreadQuery.data?.total ?? 0;
  const items = listQuery.data ?? [];

  const handleSelectItem = (item: NotificationItem) => {
    if (!item.readAt) {
      markReadMutation.mutate({ ids: [item.id] });
    }
    setOpen(false);
    if (item.link) {
      // `href` keeps a query such as `/chat/<id>?thread=<root>`; `to` would treat it as part of the path.
      void navigate({ href: item.link });
    }
  };

  const handleMarkAllRead = () => {
    markReadMutation.mutate({});
  };

  return (
    <div className="dropdown" ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost icon-btn badge-btn${open ? ' is-active' : ''}`}
        aria-label={unreadTotal > 0 ? `Thông báo, ${unreadTotal} chưa đọc` : 'Thông báo'}
        title="Thông báo"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadTotal > 0 ? <span className="count" aria-hidden="true">{unreadTotal}</span> : null}
      </button>

      {open && (
        <div
          className="menu-pop wide"
          style={{ width: 340, maxWidth: 'calc(100vw - 24px)' }}
          role="dialog"
          aria-label="Thông báo"
        >
          <div
            className="row"
            style={{
              justifyContent: 'space-between',
              padding: '6px 8px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <strong style={{ fontSize: 13.5 }}>Thông báo</strong>
            <div className="row" style={{ gap: 6 }}>
              {unreadTotal > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ minHeight: 26, padding: '0 8px', fontSize: 12 }}
                  disabled={markReadMutation.isPending}
                  onClick={handleMarkAllRead}
                >
                  Đánh dấu đã đọc hết
                </button>
              )}
              <Link
                to="/settings/notifications"
                className="btn btn-ghost btn-sm"
                style={{ minHeight: 26, padding: '0 8px', fontSize: 12 }}
                onClick={() => setOpen(false)}
              >
                Cài đặt
              </Link>
            </div>
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {listQuery.isLoading ? (
              <div style={{ padding: 12 }}>
                <Loading rows={3} />
              </div>
            ) : listQuery.error ? (
              <div style={{ padding: 12 }}>
                <ErrorState error={listQuery.error} onRetry={() => listQuery.refetch()} />
              </div>
            ) : items.length === 0 ? (
              <Empty title="Chưa có thông báo" icon="inbox">
                Khi có tin nhắn riêng, nhắc tên hoặc giao việc mới, thông báo sẽ hiện tại đây.
              </Empty>
            ) : (
              <div className="stack-sm" style={{ gap: 2, padding: '4px 0' }}>
                {items.map((item) => {
                  const isUnread = !item.readAt;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="menu-item"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 2,
                        textAlign: 'left',
                        width: '100%',
                        background: isUnread ? 'var(--brand-soft)' : undefined,
                      }}
                      onClick={() => handleSelectItem(item)}
                    >
                      <div className="row" style={{ width: '100%', justifyContent: 'space-between', gap: 8 }}>
                        <span
                          className="truncate"
                          style={{ fontWeight: isUnread ? 600 : 500, flex: 1 }}
                        >
                          {item.title}
                        </span>
                        {isUnread && (
                          <span
                            aria-label="Chưa đọc"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: 'var(--brand)',
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </div>
                      {item.body && (
                        <div
                          className="small text-2"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            width: '100%',
                          }}
                        >
                          {item.body}
                        </div>
                      )}
                      <time className="small muted" dateTime={item.createdAt}>
                        {fmtDateTime(item.createdAt)}
                      </time>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
