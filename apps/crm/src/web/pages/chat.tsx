import { useEffect, useId, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi } from '../api';
import { chatLink, formatThreadTime, parseChatSearch } from '../chat-links';
import { useChatSocketConnected } from '../chat-socket';
import { buildChatTree, canCreateSubgroup, filterConversations, hasUnread, sumUnread } from '../chat-tree';
import { ChatGroupSettingsDialog } from '../components/chat-group-settings';
import { ChatThread, ConversationAgentsDialog } from '../components/chat-thread';
import { ChatThreadPanel } from '../components/chat-thread-panel';
import { ChatTopicList } from '../components/chat-topic-list';
import { Combobox, MultiCombobox } from '../components/combobox';
import { Icon } from '../components/icons';
import { fmtShortTime } from '../components/inbox-thread';
import { roleLabel } from '../components/layout';
import { foldDiacritics, formatMentionText } from '../components/mention-input';
import { userOption } from '../components/task-form-dialog';
import {
  Avatar,
  Badge,
  Empty,
  ErrorState,
  Field,
  FormError,
  Loading,
  Modal,
  OverflowMenu,
  fieldErrors,
  useToast,
} from '../components/ui';
import type {
  ChatAgentItem,
  ChatConversationDetail,
  ChatConversationSummary,
  ChatFollowedThread,
  DirectoryUser,
} from '../types';

const THREADS_PAGE_SIZE = 50;
/** The server accepts 1 to 50 members when a group is created. */
const GROUP_MEMBER_PICK_MAX = 50;

/**
 * The conversation list search and "Chưa đọc" filter for this tab. Kept outside React so they survive the page
 * remounting when the route switches between `/chat` and `/chat/:id`; a reload starts clean.
 */
const listFilterMemory = { query: '', unreadOnly: false };
/** Group chats are always open to the agents members have connected; direct chats follow their own switch. */
const AGENT_NOTICE = 'Agent mà thành viên đã kết nối có thể đọc tin nhắn trong nhóm này.';

/** A department group chosen as the parent of a new subgroup. */
interface SubgroupParent {
  id: string;
  title: string;
}

/** Bell with a slash: a followed thread whose notifications are off. */
function MutedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Đã tắt thông báo"
      style={{ color: 'var(--muted)', flex: 'none' }}
    >
      <path d="M13.73 21a2 2 0 0 1-3.46 0M18.63 13A17.9 17.9 0 0 1 18 8M6.26 6.26A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.33-5M1 1l22 22" />
    </svg>
  );
}

function useIsPhoneWidth(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 900px)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 900px)');
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return narrow;
}

export function ChatPage() {
  const { conversationId } = useParams({ strict: false });
  const search = parseChatSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const navigate = useNavigate();
  const connected = useChatSocketConnected();
  const isPhoneWidth = useIsPhoneWidth();
  const actor = useActor();

  // `parent` presets the "Thuộc phòng ban" picker when the dialog is opened from a department group.
  const [createGroup, setCreateGroup] = useState<{ open: boolean; parent: SubgroupParent | null }>({
    open: false,
    parent: null,
  });
  const openCreateGroup = (parent: SubgroupParent | null = null) => setCreateGroup({ open: true, parent });
  const [newDirectOpen, setNewDirectOpen] = useState(false);
  // The list choice lives in the URL so a reload or a shared link keeps it, and Back returns to "Tất cả".
  const listTab: 'all' | 'threads' = search.list === 'threads' ? 'threads' : 'all';
  const setListTab = (next: 'all' | 'threads') => {
    if (next === listTab) return;
    const list = next === 'threads' ? ('threads' as const) : undefined;
    if (conversationId) {
      void navigate({
        to: '/chat/$conversationId',
        params: { conversationId },
        search: { thread: search.thread, message: search.message, list },
      });
    } else {
      void navigate({ to: '/chat', search: { list } });
    }
  };

  const conversationsQuery = useQuery<ChatConversationSummary[], ApiFailure>({
    queryKey: ['chat', 'conversations'],
    queryFn: () => api.get<ChatConversationSummary[]>('/chat/conversations'),
    refetchInterval: connected ? false : 60_000,
  });

  // Loaded on every visit: the "Chuỗi" chip shows how many followed threads have unread replies.
  const threadsQuery = useInfiniteQuery({
    queryKey: ['chat', 'threads'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<ChatFollowedThread[]>(`/chat/threads${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ChatFollowedThread[]) =>
      last.length >= THREADS_PAGE_SIZE ? last.at(-1)?.lastActivityAt : undefined,
    refetchInterval: connected ? false : 60_000,
  });
  const followedThreads = useMemo(() => threadsQuery.data?.pages.flat() ?? [], [threadsQuery.data]);
  const threadBadge = followedThreads.filter((t) => t.following && !t.muted && t.unread > 0).length;

  const threadRootId = conversationId ? search.thread : undefined;
  const openThread = (rootId: string, messageId?: string) => {
    if (!conversationId) return;
    void navigate({
      to: '/chat/$conversationId',
      params: { conversationId },
      search: { thread: rootId, message: messageId, list: search.list },
    });
  };
  // A new history entry, so Back reopens the panel the same way Back closes it.
  const closeThread = () => {
    if (!conversationId) return;
    void navigate({ to: '/chat/$conversationId', params: { conversationId }, search: { list: search.list }, replace: false });
  };

  const [listQuery, setListQueryState] = useState(listFilterMemory.query);
  const [unreadOnly, setUnreadOnlyState] = useState(listFilterMemory.unreadOnly);
  const setListQuery = (query: string) => {
    listFilterMemory.query = query;
    setListQueryState(query);
  };
  const setUnreadOnly = (next: boolean) => {
    listFilterMemory.unreadOnly = next;
    setUnreadOnlyState(next);
  };
  const filtering = unreadOnly || listQuery.trim() !== '';
  const allConversations = conversationsQuery.data ?? [];
  const unreadConversations = allConversations.filter(hasUnread).length;

  const fullTree = useMemo(() => buildChatTree(conversationsQuery.data ?? []), [conversationsQuery.data]);
  const tree = useMemo(
    () =>
      filtering
        ? buildChatTree(
            filterConversations(conversationsQuery.data ?? [], { query: listQuery, unreadOnly, keepId: conversationId }),
          )
        : fullTree,
    [filtering, fullTree, conversationsQuery.data, listQuery, unreadOnly, conversationId],
  );
  const filteredEmpty =
    filtering && tree.departments.length + tree.groups.length + tree.system.length + tree.directs.length === 0;
  const subgroupParents = useMemo<SubgroupParent[]>(
    () =>
      fullTree.departments
        .filter((d) => canCreateSubgroup(d.group, actor))
        .map((d) => ({ id: d.parentId, title: d.title })),
    [fullTree, actor],
  );

  const departmentUnread = tree.departments.reduce(
    (sum, d) => sum + (d.group?.unread ?? 0) + sumUnread(d.children),
    0,
  );
  const groupUnread = sumUnread(tree.groups);
  const systemUnread = sumUnread(tree.system);
  const directUnread = sumUnread(tree.directs);

  return (
    <div className="inbox-workspace">
      <h1 className="visually-hidden">Chat nội bộ</h1>
      <div
        className={isPhoneWidth ? 'inbox chat-inbox' : 'inbox chat-inbox inbox-channels-collapsed'}
        data-view={conversationId ? (threadRootId ? 'thread-panel' : 'thread') : 'list'}
      >
        <section className="inbox-list" aria-label="Danh sách hội thoại chat">
          <div className="inbox-filters">
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                style={{ flex: 1 }}
                onClick={() => openCreateGroup()}
              >
                <Icon name="plus" />
                <span>Tạo nhóm</span>
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => setNewDirectOpen(true)}
              >
                <Icon name="message" />
                <span>Nhắn riêng</span>
              </button>
            </div>
            {listTab === 'all' && (
              <input
                type="search"
                className="chat-list-search"
                aria-label="Tìm hội thoại theo tên"
                placeholder="Tìm hội thoại…"
                value={listQuery}
                maxLength={80}
                onChange={(e) => setListQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && listQuery) {
                    e.preventDefault();
                    setListQuery('');
                  }
                }}
              />
            )}
            <div className="chips" role="group" aria-label="Chọn danh sách">
              <button
                type="button"
                className="chip"
                aria-pressed={listTab === 'all' && !unreadOnly}
                onClick={() => {
                  setUnreadOnly(false);
                  setListTab('all');
                }}
              >
                Tất cả
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={listTab === 'all' && unreadOnly}
                onClick={() => {
                  setUnreadOnly(true);
                  setListTab('all');
                }}
              >
                Chưa đọc
                {unreadConversations > 0 && (
                  <span className="conv-unread-badge" aria-label={`${unreadConversations} hội thoại chưa đọc`}>
                    {unreadConversations}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={listTab === 'threads'}
                onClick={() => setListTab('threads')}
              >
                Chuỗi
                {threadBadge > 0 && (
                  <span className="conv-unread-badge" aria-label={`${threadBadge} chuỗi có trả lời chưa đọc`}>
                    {threadBadge}
                  </span>
                )}
              </button>
            </div>
          </div>

          {listTab === 'threads' ? (
            <div className="inbox-list-body">
              {threadsQuery.isLoading && (
                <div style={{ padding: 12 }}>
                  <Loading rows={5} />
                </div>
              )}
              {threadsQuery.error && (
                <div style={{ padding: 12 }}>
                  <ErrorState error={threadsQuery.error} onRetry={() => threadsQuery.refetch()} />
                </div>
              )}
              {threadsQuery.data && followedThreads.length === 0 && (
                <div className="small muted" style={{ padding: '10px 12px' }}>
                  Bạn chưa theo dõi chuỗi nào. Trả lời theo chuỗi hoặc bấm Theo dõi để thấy ở đây.
                </div>
              )}
              {followedThreads.length > 0 && (
                <ul className="conv-list" aria-label="Chuỗi đang theo dõi">
                  {followedThreads.map((t) => (
                    <ChatFollowedThreadRow
                      key={t.rootId}
                      item={t}
                      selected={t.conversationId === conversationId && t.rootId === threadRootId}
                    />
                  ))}
                </ul>
              )}
              {threadsQuery.hasNextPage && (
                <div style={{ padding: 10, textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={threadsQuery.isFetchingNextPage}
                    onClick={() => void threadsQuery.fetchNextPage()}
                  >
                    {threadsQuery.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
                  </button>
                </div>
              )}
            </div>
          ) : (
          <div className="inbox-list-body">
            {conversationsQuery.isLoading && (
              <div style={{ padding: 12 }}>
                <Loading rows={5} />
              </div>
            )}
            {conversationsQuery.error && (
              <div style={{ padding: 12 }}>
                <ErrorState error={conversationsQuery.error} onRetry={() => conversationsQuery.refetch()} />
              </div>
            )}
            {conversationsQuery.data && filteredEmpty && (
              <div className="chat-list-empty" role="status">
                <span className="small muted">
                  {unreadOnly && !listQuery.trim()
                    ? 'Bạn đã đọc hết tin nhắn.'
                    : `Không có hội thoại nào${listQuery.trim() ? ` tên “${listQuery.trim()}”` : ''}${unreadOnly ? ' chưa đọc' : ''}.`}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setListQuery('');
                    setUnreadOnly(false);
                  }}
                >
                  Xóa bộ lọc
                </button>
              </div>
            )}
            {conversationsQuery.data && !filteredEmpty && (
              <>
                {tree.departments.length > 0 && (
                  <>
                    <ChatSectionHeader
                      label="Phòng ban"
                      unread={departmentUnread}
                      unreadLabel={`${departmentUnread} tin chưa đọc trong nhóm phòng ban`}
                    />
                    <ul className="conv-list" aria-label="Phòng ban">
                      {tree.departments.map((d) => (
                        <li key={d.parentId}>
                          {d.group ? (
                            <ChatDepartmentRow
                              item={d.group}
                              selected={d.group.id === conversationId}
                              canCreateSubgroup={canCreateSubgroup(d.group, actor)}
                              onCreateSubgroup={() => openCreateGroup({ id: d.parentId, title: d.title })}
                            />
                          ) : (
                            <div className="chat-dept-header truncate" title={d.title}>
                              {d.title}
                            </div>
                          )}
                          {d.children.length > 0 && (
                            <ul className="conv-list" aria-label={`Nhóm nhỏ của ${d.title}`}>
                              {d.children.map((c) => (
                                <ChatConversationRow
                                  key={c.id}
                                  item={c}
                                  selected={c.id === conversationId}
                                  className="chat-subgroup-row"
                                />
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {!(filtering && tree.groups.length === 0) && (
                  <ChatSectionHeader
                    label="Nhóm"
                    unread={groupUnread}
                    unreadLabel={`${groupUnread} tin chưa đọc trong nhóm`}
                  />
                )}
                {filtering && tree.groups.length === 0 ? null : tree.groups.length === 0 ? (
                  <div className="small muted" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                    Chưa có nhóm nào. Bấm &ldquo;Tạo nhóm&rdquo; để bắt đầu.
                  </div>
                ) : (
                  <ul className="conv-list" aria-label="Nhóm">
                    {tree.groups.map((c) => (
                      <ChatConversationRow key={c.id} item={c} selected={c.id === conversationId} />
                    ))}
                  </ul>
                )}

                {tree.system.length > 0 && (
                  <>
                    <ChatSectionHeader
                      label="Hệ thống"
                      unread={systemUnread}
                      unreadLabel={`${systemUnread} tin chưa đọc trong nhóm hệ thống`}
                    />
                    <ul className="conv-list" aria-label="Hệ thống">
                      {tree.system.map((c) => (
                        <ChatConversationRow key={c.id} item={c} selected={c.id === conversationId} />
                      ))}
                    </ul>
                  </>
                )}

                {!(filtering && tree.directs.length === 0) && (
                  <ChatSectionHeader
                    label="Tin riêng"
                    unread={directUnread}
                    unreadLabel={`${directUnread} tin riêng chưa đọc`}
                  />
                )}
                {filtering && tree.directs.length === 0 ? null : tree.directs.length === 0 ? (
                  <div className="small muted" style={{ padding: '10px 12px' }}>
                    Chưa có hội thoại riêng. Bấm &ldquo;Nhắn riêng&rdquo; để chọn đồng nghiệp.
                  </div>
                ) : (
                  <ul className="conv-list" aria-label="Tin riêng">
                    {tree.directs.map((c) => (
                      <ChatConversationRow key={c.id} item={c} selected={c.id === conversationId} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          )}
        </section>

        <div className="inbox-main">
          {conversationId ? (
            <ChatConversationPane
              conversationId={conversationId}
              threadRootId={threadRootId}
              messageId={search.message}
              isPhoneWidth={isPhoneWidth}
              onOpenThread={openThread}
              onCloseThread={closeThread}
              onCreateSubgroup={openCreateGroup}
            />
          ) : (
            <div className="inbox-placeholder">
              <Empty title="Chọn một hội thoại" icon="message">
                Chọn nhóm hoặc tin riêng ở danh sách bên trái, hoặc tạo hội thoại mới để bắt đầu trao đổi.
              </Empty>
            </div>
          )}
        </div>
      </div>

      <CreateGroupDialog
        open={createGroup.open}
        presetParent={createGroup.parent}
        parentOptions={subgroupParents}
        onClose={() => setCreateGroup({ open: false, parent: null })}
      />
      <NewDirectDialog open={newDirectOpen} onClose={() => setNewDirectOpen(false)} />
    </div>
  );
}

function ChatSectionHeader({ label, unread, unreadLabel }: { label: string; unread: number; unreadLabel: string }) {
  return (
    <div
      className="row"
      style={{
        padding: '10px 12px 6px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span className="small" style={{ fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </span>
      {unread > 0 && (
        <span className="conv-unread-badge" aria-label={unreadLabel}>
          {unread}
        </span>
      )}
    </div>
  );
}

/** A department group row (under the "Phòng ban" heading): the conversation link and a "⋯" menu to create a subgroup. */
function ChatDepartmentRow({
  item,
  selected,
  canCreateSubgroup: allowSubgroup,
  onCreateSubgroup,
}: {
  item: ChatConversationSummary;
  selected: boolean;
  canCreateSubgroup: boolean;
  onCreateSubgroup: () => void;
}) {
  return (
    <div className="chat-tree-row" data-has-menu={allowSubgroup ? 'true' : undefined}>
      <ChatConversationLink item={item} selected={selected} />
      {allowSubgroup && (
        <OverflowMenu
          label={`Thao tác với ${item.title}`}
          className="chat-tree-menu"
          items={[{ label: 'Tạo nhóm nhỏ', icon: 'plus', onSelect: onCreateSubgroup }]}
        />
      )}
    </div>
  );
}

function ChatConversationRow({
  item,
  selected,
  className,
}: {
  item: ChatConversationSummary;
  selected: boolean;
  className?: string;
}) {
  return (
    <li className={className}>
      <ChatConversationLink item={item} selected={selected} />
    </li>
  );
}

/**
 * One conversation in the list: the name and preview take the free width; the time and the unread mark sit in a
 * fixed trailing column so they never squeeze the name.
 */
function ChatConversationLink({ item, selected }: { item: ChatConversationSummary; selected: boolean }) {
  const title = item.title || (item.kind === 'group' ? 'Nhóm chat' : 'Tin riêng');
  const preview = formatMentionText(item.lastMessage) || 'Chưa có tin nhắn';
  const time = fmtShortTime(item.lastMessageAt ?? item.updatedAt);
  const unread = item.unread > 0;

  return (
    <Link
      to="/chat/$conversationId"
      params={{ conversationId: item.id }}
      className="conv-row"
      data-unread={unread ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="conv-row-grid">
        <Avatar name={title} />
        <div className="conv-row-main">
          <span className="conv-name truncate" title={title}>
            {title}
          </span>
          <span className="conv-preview small truncate">{preview}</span>
        </div>
        <div className="conv-row-trail">
          {time && <span className="small muted nowrap">{time}</span>}
          {unread ? (
            <span className="conv-unread-badge" aria-label={`${item.unread} tin chưa đọc`}>
              {item.unread}
            </span>
          ) : (
            item.threadUnread > 0 && (
              <span className="chat-unread-dot" role="img" aria-label="Có trả lời chưa đọc trong chuỗi" />
            )
          )}
        </div>
      </div>
    </Link>
  );
}

function ChatFollowedThreadRow({ item, selected }: { item: ChatFollowedThread; selected: boolean }) {
  const navigate = useNavigate();
  const href = chatLink({ conversationId: item.conversationId, threadRootId: item.rootId, list: 'threads' });
  const title = item.conversationTitle || (item.conversationKind === 'group' ? 'Nhóm chat' : 'Tin riêng');
  const unread = !item.muted && item.unread > 0;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void navigate({ href });
  };

  return (
    <li>
      <a href={href} className="conv-row" aria-current={selected ? 'true' : undefined} onClick={onClick}>
        <div className="row" style={{ gap: 8 }}>
          <Avatar name={title} />
          <div className="truncate" style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="conv-name truncate" style={{ flex: 1, fontWeight: unread ? 700 : 600 }}>
                {title}
              </span>
              {item.muted ? (
                <MutedIcon />
              ) : (
                unread && (
                  <span className="conv-unread-badge" aria-label={`${item.unread} trả lời chưa đọc`}>
                    {item.unread}
                  </span>
                )
              )}
            </div>
            <div className="small truncate" style={{ color: unread ? 'var(--text)' : 'var(--muted)' }}>
              {item.rootAuthorName ?? 'Nhân viên'}: {item.rootDeleted ? 'Tin đã thu hồi' : formatMentionText(item.rootSnippet)}
            </div>
            <div className="small muted">
              {item.replyCount} trả lời · {formatThreadTime(item.lastReplyAt ?? item.lastActivityAt)}
            </div>
          </div>
        </div>
      </a>
    </li>
  );
}

function ChatConversationPane({
  conversationId,
  threadRootId,
  messageId,
  isPhoneWidth,
  onOpenThread,
  onCloseThread,
  onCreateSubgroup,
}: {
  conversationId: string;
  threadRootId?: string;
  messageId?: string;
  isPhoneWidth: boolean;
  onOpenThread: (rootId: string, messageId?: string) => void;
  onCloseThread: () => void;
  onCreateSubgroup: (parent: SubgroupParent) => void;
}) {
  const actor = useActor();
  const client = useQueryClient();
  const toast = useToast();
  const connected = useChatSocketConnected();
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [agentsModalOpen, setAgentsModalOpen] = useState(false);

  const convQuery = useQuery<ChatConversationDetail, ApiFailure>({
    queryKey: ['chat', 'conversation', conversationId],
    queryFn: () => api.get<ChatConversationDetail>(`/chat/conversations/${encodeURIComponent(conversationId)}`),
    refetchInterval: connected ? false : 60_000,
  });

  const toggleAgentMutation = useMutation<
    { id: string; title: string | null; agentReadable: boolean },
    ApiFailure,
    boolean
  >({
    mutationFn: (agentReadable) =>
      api.patch(`/chat/conversations/${encodeURIComponent(conversationId)}`, { agentReadable }),
    onSuccess: (updated) => {
      client.setQueryData<ChatConversationDetail>(['chat', 'conversation', conversationId], (prev) =>
        prev ? { ...prev, agentReadable: updated.agentReadable } : prev,
      );
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      toast(updated.agentReadable ? 'Đã bật cho agent đọc hội thoại này' : 'Đã tắt quyền đọc của agent');
    },
  });

  if (convQuery.isLoading) {
    return (
      <div className="inbox-placeholder">
        <Loading rows={4} />
      </div>
    );
  }

  if (convQuery.error || !convQuery.data) {
    return (
      <div className="inbox-placeholder stack">
        <ErrorState error={convQuery.error} onRetry={() => convQuery.refetch()} />
        <Link to="/chat" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
          Quay lại danh sách
        </Link>
      </div>
    );
  }

  const conv = convQuery.data;
  const displayTitle = conv.title || (conv.kind === 'group' ? 'Nhóm chat' : 'Tin riêng');
  const memberNames = conv.members.map((m) => m.name).join(', ');
  const myMember = conv.members.find((m) => m.id === actor.id);
  const canManageGroup =
    conv.kind === 'group' &&
    (myMember?.role === 'owner' || actor.role === 'director' || actor.role === 'admin');

  const showPanel = Boolean(threadRootId) && (conv.kind === 'group' || conv.kind === 'direct');
  const isTopicMode = conv.kind === 'group' && conv.mode === 'topic';

  return (
    <div className="chat-main-row">
    <section className="inbox-thread chat-conversation-col" style={{ flex: 1, minHeight: 0 }} aria-label={`Hội thoại ${displayTitle}`}>
      <header className="inbox-thread-head">
        <Link
          to="/chat"
          className="btn btn-ghost icon-btn inbox-back"
          aria-label="Quay lại danh sách hội thoại"
          title="Quay lại danh sách"
        >
          <Icon name="arrow" style={{ transform: 'rotate(180deg)' }} />
        </Link>
        <Avatar name={displayTitle} />
        <div className="chat-head-title">
          <span className="chat-head-name truncate" title={displayTitle}>
            {displayTitle}
          </span>
          {conv.kind === 'group' && (
            <span className="chat-head-meta small muted">
              <span className="truncate" title={memberNames}>
                {[
                  conv.departmentId ? 'Nhóm phòng ban' : 'Nhóm',
                  `${conv.members.length} thành viên`,
                  isTopicMode ? 'Chủ đề' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="chat-head-info" role="img" aria-label={AGENT_NOTICE} title={AGENT_NOTICE}>
                <Icon name="bot" />
              </span>
            </span>
          )}
        </div>

        {conv.kind === 'group' && (
          <div className="chat-head-actions">
            {canManageGroup && (
              <button
                type="button"
                className="btn btn-sm"
                aria-label="Thêm trợ lý"
                title="Thêm trợ lý"
                onClick={() => setAgentsModalOpen(true)}
              >
                <Icon name="bot" />
                <span className="chat-head-btn-label">Thêm trợ lý</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              aria-label="Cài đặt nhóm"
              title="Cài đặt nhóm"
              onClick={() => setSettingsModalOpen(true)}
            >
              <Icon name="users" />
              <span className="chat-head-btn-label">Cài đặt nhóm</span>
            </button>
          </div>
        )}
      </header>

      {conv.kind === 'direct' && (
        <div className="chat-agent-switch-row">
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={conv.agentReadable}
              disabled={toggleAgentMutation.isPending}
              aria-describedby={`${conv.id}-agent-hint`}
              onChange={(e) => toggleAgentMutation.mutate(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">Cho agent đọc hội thoại này</span>
          </label>
          <span id={`${conv.id}-agent-hint`} className="small muted chat-agent-switch-hint">
            Agent mà hai bạn đã kết nối được đọc tin ở đây để hỗ trợ.
          </span>
        </div>
      )}
      {toggleAgentMutation.error && (
        <div style={{ padding: '0 14px' }}>
          <FormError error={toggleAgentMutation.error} />
        </div>
      )}

      {isTopicMode ? (
        <ChatTopicList conversation={conv} onOpenThread={(rootId) => onOpenThread(rootId)} />
      ) : (
        <ChatThread
          conversationId={conversationId}
          embedded
          onOpenThread={onOpenThread}
          focusMessageId={threadRootId ? undefined : messageId}
        />
      )}

      {conv.kind === 'group' && (
        <>
          <ChatGroupSettingsDialog
            open={settingsModalOpen}
            onClose={() => setSettingsModalOpen(false)}
            conversation={conv}
            onCreateSubgroup={onCreateSubgroup}
          />
          {canManageGroup && (
            <ConversationAgentsDialog
              open={agentsModalOpen}
              onClose={() => setAgentsModalOpen(false)}
              conversationId={conv.id}
              currentAgents={conv.agents ?? []}
              onUpdated={() => {
                void client.invalidateQueries({ queryKey: ['chat', 'conversation', conv.id] });
                toast('Đã cập nhật trợ lý trong nhóm');
              }}
            />
          )}
        </>
      )}
    </section>
    {showPanel && threadRootId && (
      <ChatThreadPanel
        key={threadRootId}
        conversationId={conversationId}
        rootId={threadRootId}
        conversationTitle={displayTitle}
        highlightMessageId={messageId}
        isPhone={isPhoneWidth}
        onClose={onCloseThread}
      />
    )}
    </div>
  );
}

function CreateGroupDialog({
  open,
  onClose,
  presetParent,
  parentOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** The department group to create a subgroup in, when opened from that group. */
  presetParent: SubgroupParent | null;
  /** Department groups the user may create a subgroup in. */
  parentOptions: SubgroupParent[];
}) {
  const actor = useActor();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const directory = useApi<DirectoryUser[]>(open ? '/directory' : null);

  const [title, setTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState('');

  useEffect(() => {
    if (!open) {
      setTitle('');
      setSelectedIds([]);
      setParentId('');
    } else {
      setParentId(presetParent?.id ?? '');
    }
  }, [open, presetParent?.id]);

  const parents = useMemo(
    () =>
      presetParent && !parentOptions.some((p) => p.id === presetParent.id)
        ? [presetParent, ...parentOptions]
        : parentOptions,
    [presetParent, parentOptions],
  );
  const selectedParent = parents.find((p) => p.id === parentId) ?? null;

  const createGroupMutation = useMutation<
    { id: string },
    ApiFailure,
    { title: string; memberUserIds: string[]; parentConversationId: string | null }
  >({
    mutationFn: (payload) =>
      api.post<{ id: string }>('/chat/conversations', {
        kind: 'group',
        title: payload.title,
        memberUserIds: payload.memberUserIds,
        ...(payload.parentConversationId ? { parentConversationId: payload.parentConversationId } : {}),
      }),
    onSuccess: (res, payload) => {
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      if (payload.parentConversationId) {
        void client.invalidateQueries({ queryKey: ['chat', 'conversation', payload.parentConversationId] });
      }
      toast(payload.parentConversationId ? 'Đã tạo nhóm nhỏ mới' : 'Đã tạo nhóm chat mới');
      onClose();
      void navigate({ to: '/chat/$conversationId', params: { conversationId: res.id } });
    },
  });

  const errors = fieldErrors(createGroupMutation.error);
  const candidates = useMemo(
    () => (directory.data ?? []).filter((u) => u.id !== actor.id).map(userOption),
    [directory.data, actor.id],
  );
  const parentChoices = useMemo(() => parents.map((p) => ({ value: p.id, label: p.title })), [parents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || selectedIds.length === 0 || createGroupMutation.isPending) return;
    createGroupMutation.mutate({
      title: trimmed,
      memberUserIds: selectedIds,
      parentConversationId: selectedParent?.id ?? null,
    });
  };

  return (
    <Modal
      open={open}
      title={selectedParent ? `Tạo nhóm nhỏ trong ${selectedParent.title}` : 'Tạo nhóm'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button
            type="submit"
            form={`${formId}-form`}
            className="btn btn-primary"
            disabled={!title.trim() || selectedIds.length === 0 || createGroupMutation.isPending}
          >
            {createGroupMutation.isPending ? 'Đang tạo…' : 'Tạo nhóm'}
          </button>
        </>
      }
    >
      <form id={`${formId}-form`} className="stack" onSubmit={handleSubmit}>
        <FormError error={createGroupMutation.error} />
        <Field label="Tên nhóm" required error={errors.title} htmlFor={`${formId}-title`}>
          <input
            id={`${formId}-title`}
            type="text"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Phòng Kinh doanh B2B"
            required
          />
        </Field>

        {parents.length > 0 && (
          <Field
            label="Thuộc phòng ban"
            error={errors.parentConversationId}
            hint="Để trống nếu là nhóm thường. Nhóm nhỏ mời được người ở phòng ban khác."
            htmlFor={`${formId}-parent`}
          >
            <Combobox
              id={`${formId}-parent`}
              value={parentId}
              onChange={setParentId}
              options={parentChoices}
              placeholder="Nhóm thường"
              clearLabel="Bỏ phòng ban, tạo nhóm thường"
              invalid={Boolean(errors.parentConversationId)}
            />
          </Field>
        )}

        <Field
          label={`Thành viên (${selectedIds.length}/${GROUP_MEMBER_PICK_MAX} đã chọn)`}
          required
          error={errors.memberUserIds}
          htmlFor={`${formId}-members`}
        >
          {directory.isLoading ? (
            <Loading rows={2} />
          ) : (
            <MultiCombobox
              id={`${formId}-members`}
              values={selectedIds}
              onChange={setSelectedIds}
              options={candidates}
              max={GROUP_MEMBER_PICK_MAX}
              placeholder="Tìm đồng nghiệp theo tên…"
              emptyText="Không tìm thấy đồng nghiệp phù hợp."
              tagListLabel="Thành viên đã chọn"
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

function NewDirectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actor = useActor();
  const navigate = useNavigate();
  const client = useQueryClient();
  const directory = useApi<DirectoryUser[]>(open ? '/directory' : null);
  const agents = useApi<ChatAgentItem[]>(open ? '/chat/agents' : null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const directMutation = useMutation<{ id: string }, ApiFailure, { userId?: string; agentId?: string }>({
    mutationFn: (payload) =>
      api.post<{ id: string }>('/chat/conversations', {
        kind: 'direct',
        ...payload,
      }),
    onSuccess: (res) => {
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      onClose();
      void navigate({ to: '/chat/$conversationId', params: { conversationId: res.id } });
    },
  });

  const dmAgents = useMemo(() => {
    const list = (agents.data ?? []).filter((a) => a.canDm);
    const q = foldDiacritics(search.trim());
    return q ? list.filter((a) => foldDiacritics(a.name).includes(q)) : list;
  }, [agents.data, search]);

  const candidates = useMemo(() => {
    const users = (directory.data ?? []).filter((u) => u.id !== actor.id);
    const q = foldDiacritics(search.trim());
    return q ? users.filter((u) => foldDiacritics(u.name).includes(q)) : users;
  }, [directory.data, actor.id, search]);

  return (
    <Modal open={open} title="Nhắn riêng" onClose={onClose}>
      <div className="stack">
        <FormError error={directMutation.error} />
        <input
          type="search"
          aria-label="Tìm người nhận"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm trợ lý hoặc đồng nghiệp để nhắn riêng…"
        />
        {directory.isLoading || agents.isLoading ? (
          <Loading rows={4} />
        ) : (
          <div className="stack-sm" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {dmAgents.length > 0 && (
              <>
                <div
                  className="small muted"
                  style={{ fontWeight: 700, textTransform: 'uppercase', padding: '4px 8px 2px' }}
                >
                  Trợ lý
                </div>
                {dmAgents.map((a) => (
                  <button
                    key={`agent-${a.id}`}
                    type="button"
                    className="menu-item"
                    disabled={directMutation.isPending}
                    onClick={() => directMutation.mutate({ agentId: a.id })}
                  >
                    <Avatar name={a.name} />
                    <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>
                      {a.name}
                    </span>
                    <Badge tone="accent">Trợ lý</Badge>
                  </button>
                ))}
              </>
            )}

            {candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                className="menu-item"
                disabled={directMutation.isPending}
                onClick={() => directMutation.mutate({ userId: u.id })}
              >
                <Avatar name={u.name} />
                <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>
                  {u.name}
                </span>
                <span className="small muted">
                  {roleLabel(u.role)}
                  {u.teamName ? ` · ${u.teamName}` : ''}
                </span>
              </button>
            ))}
            {dmAgents.length === 0 && candidates.length === 0 && (
              <div className="small muted" style={{ padding: 8 }}>
                Không tìm thấy người nhận phù hợp.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
