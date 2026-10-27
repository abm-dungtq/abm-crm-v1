import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi } from '../api';
import { useChatSocketConnected } from '../chat-socket';
import { buildChatFlow, firstNewMessageId } from '../chat-flow';
import type {
  ChatAgentItem,
  ChatConversationDetail,
  ChatConversationSummary,
  ChatMessage,
  ChatMessageContext,
} from '../types';
import { ChatComposer, useAgentThinking, useDebouncedMarkRead } from './chat-composer';
import { ChatFlowSeparator, ChatMessageItem, scrollToMessage } from './chat-message-item';
import { Icon } from './icons';
import { Avatar, Badge, Empty, ErrorState, FormError, Loading, Modal, useToast } from './ui';

const HIGHLIGHT_MS = 2000;
/** Room left above the "Tin mới" divider when a conversation opens on it. */
const DIVIDER_TOP_GAP_PX = 8;

/** The conversation's read marker and unread count as they were when it opened. */
interface ReadSnapshot {
  conversationId: string;
  lastReadAt: string | null;
  unread: number;
}

interface TaskCommentsBootstrap {
  conversationId: string;
  messages: ChatMessage[];
  isMember?: boolean;
}

const byTime = (a: ChatMessage, b: ChatMessage) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export interface ChatThreadProps {
  conversationId?: string;
  listPath?: string;
  postPath?: string;
  readPath?: string;
  embedded?: boolean;
  /** Opens the thread panel (chat page only), optionally highlighting one reply. */
  onOpenThread?: (rootId: string, highlightMessageId?: string) => void;
  /** A message to jump to once the messages have loaded (the `?message=` deep link). */
  focusMessageId?: string;
}

export function ChatThread({
  conversationId,
  listPath,
  embedded = false,
  onOpenThread,
  focusMessageId,
}: ChatThreadProps) {
  const actor = useActor();
  const client = useQueryClient();
  const toast = useToast();
  const connected = useChatSocketConnected();

  // Task detail passes `listPath="/tasks/:id/comments"`, which ensures the task conversation exists and returns `conversationId`.
  const bootstrap = useApi<TaskCommentsBootstrap>(conversationId ? null : (listPath ?? null));
  const resolvedId = conversationId ?? bootstrap.data?.conversationId ?? null;
  const [joinedAsMember, setJoinedAsMember] = useState(false);
  const isMember = conversationId ? true : (joinedAsMember || (bootstrap.data?.isMember ?? true));
  // Without a conversation id this view is the comment thread of a task.
  const context = conversationId ? 'main' : 'task';

  const convDetailQuery = useQuery<ChatConversationDetail, ApiFailure>({
    queryKey: ['chat', 'conversation', resolvedId],
    queryFn: () => api.get<ChatConversationDetail>(`/chat/conversations/${encodeURIComponent(resolvedId!)}`),
    enabled: Boolean(resolvedId),
    refetchInterval: connected ? false : 60_000,
  });

  const conversationAgents = useMemo(
    () => (convDetailQuery.data?.agents ?? []).filter((a) => a.enabled !== false),
    [convDetailQuery.data],
  );
  const conversationKind = convDetailQuery.data?.kind ?? (context === 'task' ? 'task' : 'group');
  const conversationMode = convDetailQuery.data?.mode ?? 'chat';

  const q = useQuery<ChatMessage[], ApiFailure>({
    queryKey: ['chat', resolvedId],
    queryFn: () => api.get<ChatMessage[]>(`/chat/conversations/${encodeURIComponent(resolvedId!)}/messages`),
    enabled: Boolean(resolvedId),
    initialData: () =>
      !conversationId && bootstrap.data && bootstrap.data.conversationId === resolvedId
        ? bootstrap.data.messages
        : undefined,
    refetchInterval: !isMember ? 30_000 : connected ? false : 60_000,
  });

  const [quote, setQuote] = useState<ChatMessage | null>(null);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const [taskAgentModalOpen, setTaskAgentModalOpen] = useState(false);
  // The main-flow window around an older message ("Đang xem tin cũ"); null shows the latest messages.
  const [olderWindow, setOlderWindow] = useState<ChatMessage[] | null>(null);
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const [jumpError, setJumpError] = useState<ApiFailure | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const focusHandledRef = useRef<string | null>(null);

  useEffect(() => {
    setJoinedAsMember(false);
    setOptimistic([]);
    setQuote(null);
    setTaskAgentModalOpen(false);
    setOlderWindow(null);
    setHighlight(null);
    setJumpError(null);
    focusHandledRef.current = null;
  }, [resolvedId]);

  const messages = useMemo(() => {
    const serverList = q.data ?? [];
    const seen = new Set(serverList.map((m) => m.id));
    return [...serverList, ...optimistic.filter((m) => !seen.has(m.id))].sort(byTime);
  }, [q.data, optimistic]);

  const shown = useMemo(() => (olderWindow ? [...olderWindow].sort(byTime) : messages), [olderWindow, messages]);
  const newest = messages.at(-1);
  const agentThinking = useAgentThinking(resolvedId, null, newest);

  // "Tin mới": the read marker as it was when the conversation opened, taken before this view marks it read. Only the
  // chat page's main flow has one; it stays until the person leaves the conversation.
  const conversationsQuery = useQuery<ChatConversationSummary[], ApiFailure>({
    queryKey: ['chat', 'conversations'],
    queryFn: () => api.get<ChatConversationSummary[]>('/chat/conversations'),
    enabled: context === 'main',
    // The chat page keeps this list fresh; only opening a conversation refetches it (below), once.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [readSnapshot, setReadSnapshot] = useState<ReadSnapshot | null>(null);
  // The cached list can be older than messages that arrived since it loaded, so the snapshot waits for a list fetched
  // after the conversation opened. Marking read waits for the snapshot, so the refetch still sees the old marker.
  const openedAtRef = useRef<{ conversationId: string; at: number } | null>(null);
  const refetchConversations = conversationsQuery.refetch;
  useEffect(() => {
    if (context !== 'main' || !resolvedId) return;
    openedAtRef.current = { conversationId: resolvedId, at: Date.now() };
    void refetchConversations();
  }, [context, resolvedId, refetchConversations]);
  useEffect(() => {
    if (context !== 'main' || !resolvedId || readSnapshot?.conversationId === resolvedId) return;
    const opened = openedAtRef.current;
    if (opened?.conversationId !== resolvedId) return;
    const fresh = conversationsQuery.dataUpdatedAt >= opened.at;
    const failed = conversationsQuery.errorUpdatedAt >= opened.at;
    if (!fresh && !failed) return;
    // After a failed refetch the older list is still the best guess; with no list at all nothing counts as new.
    const item = conversationsQuery.data?.find((c) => c.id === resolvedId);
    setReadSnapshot({ conversationId: resolvedId, lastReadAt: item?.lastReadAt ?? null, unread: item?.unread ?? 0 });
  }, [
    context, resolvedId, readSnapshot, conversationsQuery.data, conversationsQuery.dataUpdatedAt,
    conversationsQuery.errorUpdatedAt,
  ]);
  const snapshotReady = context !== 'main' || readSnapshot?.conversationId === resolvedId;
  const newMessageId = useMemo(
    () =>
      context === 'main' && readSnapshot?.conversationId === resolvedId && readSnapshot.unread > 0
        ? firstNewMessageId(messages, readSnapshot.lastReadAt, actor.id)
        : null,
    [context, readSnapshot, resolvedId, messages, actor.id],
  );
  const flow = useMemo(() => buildChatFlow(shown, { newMessageId }), [shown, newMessageId]);

  // On open: show the "Tin mới" divider near the top when there is one, otherwise the newest message. Afterwards every
  // new message scrolls to the bottom.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (olderWindow) return;
    const el = listRef.current;
    if (!el) return;
    if (openedRef.current !== resolvedId && snapshotReady && q.data) {
      openedRef.current = resolvedId;
      const divider = newMessageId && !focusMessageId ? el.querySelector<HTMLElement>('[data-new-divider]') : null;
      if (divider) {
        el.scrollTop += divider.getBoundingClientRect().top - el.getBoundingClientRect().top - DIVIDER_TOP_GAP_PX;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [messages.length, resolvedId, olderWindow, snapshotReady, newMessageId, focusMessageId, Boolean(q.data)]);

  useDebouncedMarkRead(
    resolvedId && isMember ? `/chat/conversations/${encodeURIComponent(resolvedId)}/read` : null,
    snapshotReady ? newest?.createdAt : undefined,
    () => {
      void client.invalidateQueries({ queryKey: ['chat', 'unread'] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
  );

  useEffect(() => {
    if (!highlight) return;
    scrollToMessage(listRef.current, highlight.id);
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  /**
   * Shows a quoted or linked message: highlight it when it is on screen, open its thread when it is a thread
   * reply, otherwise load the main-flow window around it.
   */
  const jumpTo = useCallback(
    async (target: { id: string; threadRootId: string | null }) => {
      setJumpError(null);
      if ((olderWindow ?? messages).some((m) => m.id === target.id)) {
        setHighlight({ id: target.id, nonce: Date.now() });
        return;
      }
      if (olderWindow && messages.some((m) => m.id === target.id)) {
        setOlderWindow(null);
        setHighlight({ id: target.id, nonce: Date.now() });
        return;
      }
      if (target.threadRootId && onOpenThread) {
        onOpenThread(target.threadRootId, target.id);
        return;
      }
      try {
        const ctx = await api.get<ChatMessageContext>(`/chat/messages/${encodeURIComponent(target.id)}/context`);
        if (ctx.threadRootId && onOpenThread && !ctx.messages.some((m) => m.id === target.id)) {
          onOpenThread(ctx.threadRootId, target.id);
          return;
        }
        setOlderWindow(ctx.messages);
        setHighlight({ id: target.id, nonce: Date.now() });
      } catch (err) {
        setJumpError(err instanceof ApiFailure ? err : new ApiFailure({ code: 'INTERNAL', message: 'Không mở được tin này' }, 500));
      }
    },
    [olderWindow, messages, onOpenThread],
  );

  useEffect(() => {
    if (!focusMessageId || !q.data || focusHandledRef.current === focusMessageId) return;
    focusHandledRef.current = focusMessageId;
    void jumpTo({ id: focusMessageId, threadRootId: null });
  }, [focusMessageId, q.data, jumpTo]);

  const onPending = (pending: ChatMessage) => {
    setOlderWindow(null);
    setOptimistic((prev) => [...prev, pending]);
  };

  const onSent = (saved: ChatMessage, pending: ChatMessage) => {
    setJoinedAsMember(true);
    const enriched: ChatMessage = {
      ...saved,
      authorName: saved.authorName ?? actor.displayName,
      replyTo: saved.replyTo ?? pending.replyTo,
      attachments: saved.attachments?.length ? saved.attachments : (pending.attachments ?? []),
    };
    client.setQueryData<ChatMessage[]>(['chat', resolvedId], (prev) => {
      if (!prev) return [enriched];
      const exists = prev.some((m) => m.id === enriched.id);
      return exists ? prev.map((m) => (m.id === enriched.id ? enriched : m)) : [...prev, enriched];
    });
    setOptimistic((prev) => prev.filter((m) => m.id !== saved.id));
    void client.invalidateQueries({ queryKey: ['chat', resolvedId] });
  };

  const onFailed = (messageId: string) => setOptimistic((prev) => prev.filter((m) => m.id !== messageId));

  if (!conversationId && bootstrap.isLoading) return <Loading rows={3} />;
  if (!conversationId && bootstrap.error) return <ErrorState error={bootstrap.error} onRetry={() => bootstrap.refetch()} />;
  if (q.isLoading) return <Loading rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div
      className="inbox-thread"
      style={
        embedded
          ? { flex: 1, minHeight: 0 }
          : {
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              background: 'var(--surface)',
            }
      }
    >
      {!embedded && resolvedId && (
        <div
          className="row"
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            justifyContent: 'space-between',
          }}
        >
          <div className="row-wrap small" style={{ gap: 6 }}>
            <span className="muted">Trợ lý trong luồng:</span>
            {conversationAgents.length === 0 ? (
              <span className="muted">Chưa có</span>
            ) : (
              conversationAgents.map((a) => (
                <Badge key={a.id} tone="accent">
                  @{a.name}
                </Badge>
              ))
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setTaskAgentModalOpen(true)}>
            <Icon name="bot" />
            <span>Thêm trợ lý</span>
          </button>
        </div>
      )}

      {olderWindow && (
        <div className="chat-context-banner" role="status">
          <span>Đang xem tin cũ</span>
          <span aria-hidden="true">·</span>
          <button type="button" className="chat-link-btn" onClick={() => setOlderWindow(null)}>
            Về tin mới nhất
          </button>
        </div>
      )}

      <div
        ref={listRef}
        className="inbox-messages"
        style={embedded ? undefined : { maxHeight: 420, minHeight: 220 }}
        aria-label="Danh sách tin nhắn"
      >
        <FormError error={jumpError} />
        {shown.length === 0 ? (
          <Empty title="Chưa có tin nhắn" icon="message">
            Gửi tin nhắn đầu tiên để bắt đầu trao đổi.
          </Empty>
        ) : (
          <ol className="msg-list">
            {flow.map((item) => {
              if (item.kind !== 'message') return <ChatFlowSeparator key={item.key} item={item} />;
              const m = item.message;
              const pending = optimistic.some((o) => o.id === m.id);
              return (
                <ChatMessageItem
                  key={m.id}
                  message={m}
                  continued={item.continued}
                  endsRun={item.endsRun}
                  context={context}
                  conversationKind={conversationKind}
                  conversationMode={conversationMode}
                  pending={pending}
                  highlighted={highlight?.id === m.id}
                  canRecall={m.authorKind === 'user' && m.authorUserId === actor.id}
                  onQuote={setQuote}
                  onOpenThread={onOpenThread}
                  onJumpTo={(preview) => void jumpTo({ id: preview.id, threadRootId: preview.threadRootId })}
                />
              );
            })}
          </ol>
        )}
      </div>

      <ChatComposer
        key={resolvedId ?? 'pending'}
        conversationId={resolvedId}
        conversationKind={convDetailQuery.data?.kind ?? (context === 'task' ? 'task' : null)}
        showAlsoSend={false}
        quote={quote}
        onClearQuote={() => setQuote(null)}
        agents={conversationAgents}
        thinking={agentThinking.thinking}
        onAgentAsked={agentThinking.start}
        onPending={onPending}
        onSent={onSent}
        onFailed={onFailed}
      />

      {!embedded && resolvedId && (
        <ConversationAgentsDialog
          open={taskAgentModalOpen}
          onClose={() => setTaskAgentModalOpen(false)}
          conversationId={resolvedId}
          currentAgents={convDetailQuery.data?.agents ?? []}
          onUpdated={() => {
            void client.invalidateQueries({ queryKey: ['chat', 'conversation', resolvedId] });
            toast('Đã cập nhật trợ lý trong hội thoại');
          }}
        />
      )}
    </div>
  );
}

export function ConversationAgentsDialog({
  open,
  onClose,
  conversationId,
  currentAgents,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  currentAgents: ChatAgentItem[];
  onUpdated?: () => void;
}) {
  const allAgents = useApi<ChatAgentItem[]>(open ? '/chat/agents' : null);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  useEffect(() => {
    if (!open) setSelectedAgentId('');
  }, [open]);

  const addMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (agentId) =>
      api.post(`/chat/conversations/${encodeURIComponent(conversationId)}/agents`, { agentId }),
    onSuccess: () => {
      setSelectedAgentId('');
      onUpdated?.();
    },
  });

  const removeMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (agentId) =>
      api.delete(`/chat/conversations/${encodeURIComponent(conversationId)}/agents/${encodeURIComponent(agentId)}`),
    onSuccess: () => {
      onUpdated?.();
    },
  });

  const existingIds = new Set(currentAgents.map((a) => a.id));
  const candidates = (allAgents.data ?? []).filter((a) => a.canGroup && !existingIds.has(a.id));

  return (
    <Modal open={open} title="Thêm trợ lý" onClose={onClose}>
      <div className="stack">
        <FormError error={addMutation.error ?? removeMutation.error} />

        {candidates.length > 0 ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedAgentId) addMutation.mutate(selectedAgentId);
            }}
          >
            <select
              aria-label="Chọn trợ lý để thêm"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              <option value="">— Chọn trợ lý —</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!selectedAgentId || addMutation.isPending}
            >
              Thêm trợ lý
            </button>
          </form>
        ) : (
          <div className="small muted">Không còn trợ lý nhóm nào chưa thêm.</div>
        )}

        {currentAgents.length > 0 && (
          <ul className="list">
            {currentAgents.map((a) => (
              <li key={a.id} className="row" style={{ padding: '8px 4px' }}>
                <Avatar name={a.name} />
                <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>
                  {a.name}
                </span>
                <Badge tone="accent">Trợ lý</Badge>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(a.id)}
                >
                  Xóa
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
