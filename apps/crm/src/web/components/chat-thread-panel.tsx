import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api } from '../api';
import { useChatSocketConnected } from '../chat-socket';
import { canCloseTopic } from '../chat-tree';
import type {
  ChatConversationDetail,
  ChatMessage,
  ChatThreadDetail,
  ChatThreadSubscriptionState,
  ChatThreadSummary,
} from '../types';
import { ChatComposer, useAgentThinking, useDebouncedMarkRead } from './chat-composer';
import { ChatMessageItem, scrollToMessage } from './chat-message-item';
import { Icon } from './icons';
import { ErrorState, FormError, Loading } from './ui';

const HIGHLIGHT_MS = 2000;

const byTime = (a: ChatMessage, b: ChatMessage) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export interface ChatThreadPanelProps {
  conversationId: string;
  rootId: string;
  conversationTitle: string;
  /** A reply to highlight once the thread has loaded. */
  highlightMessageId?: string;
  /** Phone width: the panel fills the screen and has a back button instead of ×. */
  isPhone: boolean;
  onClose: () => void;
}

/** The thread of one root message: the root, its replies (oldest first) and a composer that posts into the thread. */
export function ChatThreadPanel({
  conversationId,
  rootId,
  conversationTitle,
  highlightMessageId,
  isPhone,
  onClose,
}: ChatThreadPanelProps) {
  const actor = useActor();
  const client = useQueryClient();
  const connected = useChatSocketConnected();
  const threadPath = `/chat/threads/${encodeURIComponent(rootId)}`;

  const convQuery = useQuery<ChatConversationDetail, ApiFailure>({
    queryKey: ['chat', 'conversation', conversationId],
    queryFn: () => api.get<ChatConversationDetail>(`/chat/conversations/${encodeURIComponent(conversationId)}`),
    refetchInterval: connected ? false : 60_000,
  });
  const threadQuery = useQuery<ChatThreadDetail, ApiFailure>({
    queryKey: ['chat', 'thread', rootId],
    queryFn: () => api.get<ChatThreadDetail>(threadPath),
    refetchInterval: connected ? false : 60_000,
  });

  const [older, setOlder] = useState<{ replies: ChatMessage[]; hasMore: boolean } | null>(null);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const [quote, setQuote] = useState<ChatMessage | null>(null);
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const highlightHandledRef = useRef<string | null>(null);

  const conv = convQuery.data;
  const data = threadQuery.data;
  const conversationKind = conv?.kind ?? 'group';
  const conversationMode = conv?.mode ?? 'chat';
  const agents = useMemo(() => (conv?.agents ?? []).filter((a) => a.enabled !== false), [conv]);

  const stored = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of older?.replies ?? []) map.set(m.id, m);
    for (const m of data?.replies ?? []) map.set(m.id, m);
    return [...map.values()].sort(byTime);
  }, [older, data]);
  const replies = useMemo(() => {
    const seen = new Set(stored.map((m) => m.id));
    return [...stored, ...optimistic.filter((m) => !seen.has(m.id))].sort(byTime);
  }, [stored, optimistic]);
  const hasMore = older ? older.hasMore : (data?.hasMore ?? false);
  const newestReply = replies.at(-1);
  const newestStoredAt = stored.at(-1)?.createdAt ?? data?.root.createdAt ?? null;
  const agentThinking = useAgentThinking(conversationId, rootId, newestReply);

  // Opening the panel and every new reply while it is open move the thread read marker.
  useDebouncedMarkRead(data ? `${threadPath}/read` : null, newestStoredAt, () => {
    void client.invalidateQueries({ queryKey: ['chat', 'threads'] });
    void client.invalidateQueries({ queryKey: ['chat', 'unread'] });
    void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    void client.invalidateQueries({ queryKey: ['chat', conversationId] });
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (el && !highlight) el.scrollTop = el.scrollHeight;
    // Only a new newest reply (or the first load) scrolls to the bottom; loading older replies does not.
  }, [newestReply?.id, Boolean(data)]);

  useEffect(() => {
    if (!data || !highlightMessageId || highlightHandledRef.current === highlightMessageId) return;
    highlightHandledRef.current = highlightMessageId;
    setHighlight({ id: highlightMessageId, nonce: Date.now() });
  }, [data, highlightMessageId]);

  useEffect(() => {
    if (!highlight) return;
    scrollToMessage(bodyRef.current, highlight.id);
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  const loadOlderMutation = useMutation<ChatThreadDetail, ApiFailure, string>({
    mutationFn: (before) => api.get<ChatThreadDetail>(`${threadPath}?before=${encodeURIComponent(before)}`),
    onSuccess: (page) => {
      setOlder((prev) => ({ replies: [...page.replies, ...(prev?.replies ?? [])], hasMore: page.hasMore }));
    },
  });

  const subscriptionMutation = useMutation<
    { rootId: string; following: boolean; muted: boolean },
    ApiFailure,
    ChatThreadSubscriptionState
  >({
    mutationFn: (state) => api.put(`${threadPath}/subscription`, { state }),
    onSuccess: (result) => {
      client.setQueryData<ChatThreadDetail>(['chat', 'thread', rootId], (prev) =>
        prev?.thread ? { ...prev, thread: { ...prev.thread, following: result.following, muted: result.muted } } : prev,
      );
      void client.invalidateQueries({ queryKey: ['chat', 'thread', rootId] });
      void client.invalidateQueries({ queryKey: ['chat', 'threads'] });
      void client.invalidateQueries({ queryKey: ['chat', 'unread'] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      void client.invalidateQueries({ queryKey: ['chat', conversationId] });
    },
  });

  const onPending = (pending: ChatMessage) => setOptimistic((prev) => [...prev, pending]);
  const onSent = (saved: ChatMessage, pending: ChatMessage) => {
    const enriched: ChatMessage = {
      ...saved,
      authorName: saved.authorName ?? actor.displayName,
      replyTo: saved.replyTo ?? pending.replyTo,
      attachments: saved.attachments?.length ? saved.attachments : (pending.attachments ?? []),
    };
    client.setQueryData<ChatThreadDetail>(['chat', 'thread', rootId], (prev) =>
      prev && !prev.replies.some((m) => m.id === enriched.id) ? { ...prev, replies: [...prev.replies, enriched] } : prev,
    );
    setOptimistic((prev) => prev.filter((m) => m.id !== saved.id));
    void client.invalidateQueries({ queryKey: ['chat', 'thread', rootId] });
    void client.invalidateQueries({ queryKey: ['chat', conversationId] });
    void client.invalidateQueries({ queryKey: ['chat', 'threads'] });
  };
  const onFailed = (messageId: string) => setOptimistic((prev) => prev.filter((m) => m.id !== messageId));

  const jumpWithinThread = (messageId: string) => {
    if ([data?.root, ...replies].some((m) => m?.id === messageId)) {
      setHighlight({ id: messageId, nonce: Date.now() });
    }
  };

  const closeTopicMutation = useMutation<ChatThreadSummary | null, ApiFailure, boolean>({
    mutationFn: (nextClosed) => api.post(`${threadPath}/close`, { closed: nextClosed }),
    onSuccess: (summary) => {
      if (summary) {
        client.setQueryData<ChatThreadDetail>(['chat', 'thread', rootId], (prev) =>
          prev ? { ...prev, thread: summary } : prev,
        );
      }
      void client.invalidateQueries({ queryKey: ['chat', 'thread', rootId] });
      void client.invalidateQueries({ queryKey: ['chat', conversationId] });
      void client.invalidateQueries({ queryKey: ['chat', 'threads'] });
    },
  });

  const thread = data?.thread ?? null;
  const following = thread?.following ?? false;
  const muted = thread?.muted ?? false;
  const closed = thread?.closed ?? false;
  const showAlsoSend = conversationMode === 'chat' && !(thread?.isTopic ?? false);
  const rootAuthorUserId = data?.root.authorKind === 'user' ? data.root.authorUserId : null;
  const showCloseTopic = conv ? canCloseTopic(thread, rootAuthorUserId, conv, actor) : false;
  const toggleTopicClosed = () => {
    const nextClosed = !closed;
    const question = nextClosed
      ? 'Đóng chủ đề này? Mọi người vẫn đọc được nhưng không trả lời thêm.'
      : 'Mở lại chủ đề này để mọi người trả lời tiếp?';
    if (!window.confirm(question)) return;
    closeTopicMutation.mutate(nextClosed);
  };

  const renderMessage = (m: ChatMessage) => (
    <ChatMessageItem
      key={m.id}
      message={m}
      context="thread"
      conversationKind={conversationKind}
      conversationMode={conversationMode}
      pending={optimistic.some((o) => o.id === m.id)}
      highlighted={highlight?.id === m.id}
      canRecall={m.authorKind === 'user' && m.authorUserId === actor.id}
      onQuote={setQuote}
      onJumpTo={(preview) => jumpWithinThread(preview.id)}
    />
  );

  return (
    <aside className="chat-thread-panel" role="complementary" aria-label="Chuỗi trả lời">
      <header className="chat-thread-panel-head">
        {isPhone && (
          <button
            type="button"
            className="btn btn-ghost icon-btn"
            onClick={onClose}
            aria-label="Quay lại hội thoại"
            title="Quay lại hội thoại"
          >
            <Icon name="arrow" style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
        <div className="truncate" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{thread?.isTopic ? 'Chủ đề' : 'Chuỗi'}</div>
          <div className="small muted truncate" title={conversationTitle}>
            {conversationTitle}
          </div>
        </div>
        {data && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              disabled={subscriptionMutation.isPending}
              onClick={() => subscriptionMutation.mutate(following ? 'none' : 'following')}
            >
              {following ? 'Bỏ theo dõi' : 'Theo dõi'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={subscriptionMutation.isPending}
              onClick={() => subscriptionMutation.mutate(following && muted ? 'following' : 'muted')}
            >
              {following && muted ? 'Bật thông báo' : 'Tắt thông báo'}
            </button>
            {showCloseTopic && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={closeTopicMutation.isPending}
                onClick={toggleTopicClosed}
              >
                {closed ? 'Mở lại' : 'Đóng chủ đề'}
              </button>
            )}
          </>
        )}
        {!isPhone && (
          <button
            type="button"
            className="btn btn-ghost btn-sm icon-btn"
            onClick={onClose}
            aria-label="Đóng chuỗi"
            title="Đóng chuỗi"
          >
            <Icon name="close" />
          </button>
        )}
      </header>

      {threadQuery.isLoading ? (
        <div style={{ padding: 12 }}>
          <Loading rows={3} />
        </div>
      ) : threadQuery.error || !data ? (
        <div style={{ padding: 12 }}>
          <ErrorState error={threadQuery.error} onRetry={() => threadQuery.refetch()} />
        </div>
      ) : (
        <>
          <div ref={bodyRef} className="inbox-messages" aria-label="Tin gốc và các trả lời">
            <FormError error={subscriptionMutation.error ?? closeTopicMutation.error ?? loadOlderMutation.error} />
            <ol className="msg-list">
              {renderMessage(data.root)}
            </ol>
            <div className="chat-thread-divider small muted">
              {thread && thread.replyCount > 0 ? `${thread.replyCount} trả lời` : 'Chưa có trả lời'}
            </div>
            {hasMore && (
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={loadOlderMutation.isPending || !stored[0]}
                  onClick={() => stored[0] && loadOlderMutation.mutate(stored[0].createdAt)}
                >
                  {loadOlderMutation.isPending ? 'Đang tải…' : 'Tải trả lời cũ hơn'}
                </button>
              </div>
            )}
            <ol className="msg-list">{replies.map(renderMessage)}</ol>
          </div>

          {closed && (
            <div className="chat-context-banner" role="status">
              Chủ đề đã đóng
            </div>
          )}

          <ChatComposer
            key={rootId}
            conversationId={conversationId}
            conversationKind={conv?.kind ?? null}
            threadRootId={rootId}
            showAlsoSend={showAlsoSend}
            quote={quote}
            onClearQuote={() => setQuote(null)}
            agents={agents}
            thinking={agentThinking.thinking}
            onAgentAsked={agentThinking.start}
            disabled={closed}
            autoFocus
            onPending={onPending}
            onSent={onSent}
            onFailed={onFailed}
          />
        </>
      )}
    </aside>
  );
}
