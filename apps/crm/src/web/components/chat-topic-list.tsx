import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { formatThreadTime, replierInitials } from '../chat-links';
import { useChatSocketConnected } from '../chat-socket';
import type { ChatConversationDetail, ChatMessage } from '../types';
import { ChatComposer, useAgentThinking, useDebouncedMarkRead } from './chat-composer';
import { formatMentionText } from './mention-input';
import { Avatar, Empty, ErrorState, Loading } from './ui';

const TOPICS_PAGE_SIZE = 30;

/** Paging key of a topic: its latest activity, or its own time when nobody has replied yet (same as the server sort). */
function topicActivityAt(m: ChatMessage): string {
  return m.thread?.lastActivityAt ?? m.createdAt;
}

/**
 * The conversation view of a group in "Chủ đề" mode: a composer that starts a new topic, then the topics by latest
 * activity. "Xem chủ đề" opens the topic in the thread panel.
 */
export function ChatTopicList({
  conversation,
  onOpenThread,
}: {
  conversation: ChatConversationDetail;
  onOpenThread: (rootId: string) => void;
}) {
  const client = useQueryClient();
  const connected = useChatSocketConnected();
  const conversationId = conversation.id;
  const topicsKey = ['chat', conversationId, 'topics'] as const;
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);

  const topicsQuery = useInfiniteQuery({
    queryKey: topicsKey,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<ChatMessage[]>(
        `/chat/conversations/${encodeURIComponent(conversationId)}/topics?limit=${TOPICS_PAGE_SIZE}${
          pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ChatMessage[]) => {
      const tail = last.at(-1);
      return last.length >= TOPICS_PAGE_SIZE && tail ? topicActivityAt(tail) : undefined;
    },
    refetchInterval: connected ? false : 60_000,
  });

  const stored = useMemo(() => {
    const seen = new Set<string>();
    const list: ChatMessage[] = [];
    for (const m of topicsQuery.data?.pages.flat() ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      list.push(m);
    }
    return list;
  }, [topicsQuery.data]);
  const topics = useMemo(() => {
    const seen = new Set(stored.map((m) => m.id));
    return [...optimistic.filter((m) => !seen.has(m.id)).reverse(), ...stored];
  }, [stored, optimistic]);

  const newestRoot = useMemo(
    () => stored.reduce<ChatMessage | undefined>((acc, m) => (!acc || m.createdAt > acc.createdAt ? m : acc), undefined),
    [stored],
  );
  const agentThinking = useAgentThinking(conversationId, null, newestRoot);
  const agents = useMemo(() => (conversation.agents ?? []).filter((a) => a.enabled !== false), [conversation.agents]);

  // Same as the chat view: the main conversation is read up to its newest main-flow message.
  const readAt = [conversation.lastMessageAt, newestRoot?.createdAt]
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  useDebouncedMarkRead(
    topicsQuery.data ? `/chat/conversations/${encodeURIComponent(conversationId)}/read` : null,
    readAt,
    () => {
      void client.invalidateQueries({ queryKey: ['chat', 'unread'] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
  );

  const onPending = (pending: ChatMessage) => setOptimistic((prev) => [...prev, pending]);
  const onSent = (saved: ChatMessage) => {
    void client.invalidateQueries({ queryKey: topicsKey }).finally(() => {
      setOptimistic((prev) => prev.filter((m) => m.id !== saved.id));
    });
  };
  const onFailed = (messageId: string) => setOptimistic((prev) => prev.filter((m) => m.id !== messageId));

  return (
    <div className="inbox-thread chat-topic-view" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-topic-composer">
        <div className="small muted" style={{ fontWeight: 600 }}>
          Chủ đề mới
        </div>
        <ChatComposer
          key={conversationId}
          conversationId={conversationId}
          conversationKind={conversation.kind}
          showAlsoSend={false}
          quote={null}
          onClearQuote={() => {}}
          agents={agents}
          thinking={agentThinking.thinking}
          onAgentAsked={agentThinking.start}
          onPending={onPending}
          onSent={onSent}
          onFailed={onFailed}
        />
      </div>

      <div className="inbox-messages" aria-label="Danh sách chủ đề">
        {topicsQuery.isLoading ? (
          <Loading rows={3} />
        ) : topicsQuery.error ? (
          <ErrorState error={topicsQuery.error} onRetry={() => topicsQuery.refetch()} />
        ) : topics.length === 0 ? (
          <Empty title="Chưa có chủ đề" icon="message">
            Viết vào ô Chủ đề mới để mở chủ đề đầu tiên.
          </Empty>
        ) : (
          <ol className="chat-topic-list">
            {topics.map((m) => (
              <ChatTopicCard
                key={m.id}
                message={m}
                pending={optimistic.some((o) => o.id === m.id) && !stored.some((s) => s.id === m.id)}
                onOpen={() => onOpenThread(m.id)}
              />
            ))}
          </ol>
        )}
        {topicsQuery.hasNextPage && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={topicsQuery.isFetchingNextPage}
              onClick={() => void topicsQuery.fetchNextPage()}
            >
              {topicsQuery.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatTopicCard({ message: m, pending, onOpen }: { message: ChatMessage; pending: boolean; onOpen: () => void }) {
  const author = m.authorName ?? (m.authorKind === 'agent' ? 'Trợ lý' : 'Nhân viên');
  const thread = m.thread;
  const replyCount = thread?.replyCount ?? 0;
  // `latest` is newest first; the card reads top-down, so the older of the two comes first.
  const latest = (thread?.latest ?? []).slice(0, 2).reverse();

  return (
    <li className="chat-topic-card" data-message-id={m.id}>
      <div className="row" style={{ gap: 8 }}>
        <Avatar name={author} />
        <div className="truncate" style={{ flex: 1, minWidth: 0 }}>
          <span className="truncate" style={{ fontWeight: 600 }}>
            {author}
          </span>
          <div className="small muted">
            <time dateTime={m.createdAt}>{formatThreadTime(m.createdAt)}</time>
            {pending && ' · Đang gửi…'}
          </div>
        </div>
        {thread?.closed && <span className="chat-topic-closed">Đã đóng</span>}
        {(thread?.unread ?? 0) > 0 && (
          <span className="chat-unread-dot" role="img" aria-label={`${thread?.unread} trả lời chưa đọc`} />
        )}
      </div>

      <div className="chat-topic-text">
        {m.deleted ? <em className="muted">Tin đã thu hồi</em> : formatMentionText(m.body)}
      </div>

      {latest.length > 0 && (
        <ul className="chat-topic-latest">
          {latest.map((r) => (
            <li key={r.id} className="small truncate">
              <strong>{r.authorName ?? 'Nhân viên'}:</strong> {formatMentionText(r.snippet)}
            </li>
          ))}
        </ul>
      )}

      <div className="row chat-topic-foot">
        {thread && thread.repliers.length > 0 && (
          <span className="chat-thread-avatars" aria-hidden="true">
            {thread.repliers.slice(0, 3).map((r) => (
              <span key={r.userId} className="chat-avatar-mini" title={r.name}>
                {replierInitials(r.name)}
              </span>
            ))}
          </span>
        )}
        <span className="small muted" style={{ flex: 1 }}>
          {replyCount} trả lời
        </span>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={onOpen}>
          Xem chủ đề
        </button>
      </div>
    </li>
  );
}
