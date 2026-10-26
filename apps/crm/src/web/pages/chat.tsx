import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi } from '../api';
import { useChatSocketConnected } from '../chat-socket';
import { ChatThread, ConversationAgentsDialog } from '../components/chat-thread';
import { Icon } from '../components/icons';
import { fmtShortTime } from '../components/inbox-thread';
import { roleLabel } from '../components/layout';
import { foldDiacritics, formatMentionText } from '../components/mention-input';
import {
  Avatar,
  Badge,
  Empty,
  ErrorState,
  Field,
  FormError,
  Loading,
  Modal,
  fieldErrors,
  useToast,
} from '../components/ui';
import type { ChatAgentItem, ChatConversationDetail, ChatConversationSummary, DirectoryUser } from '../types';

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
  const connected = useChatSocketConnected();
  const isPhoneWidth = useIsPhoneWidth();

  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newDirectOpen, setNewDirectOpen] = useState(false);

  const conversationsQuery = useQuery<ChatConversationSummary[], ApiFailure>({
    queryKey: ['chat', 'conversations'],
    queryFn: () => api.get<ChatConversationSummary[]>('/chat/conversations'),
    refetchInterval: connected ? false : 60_000,
  });

  const groups = useMemo(
    () => (conversationsQuery.data ?? []).filter((c) => c.kind === 'group'),
    [conversationsQuery.data],
  );
  const directs = useMemo(
    () => (conversationsQuery.data ?? []).filter((c) => c.kind === 'direct'),
    [conversationsQuery.data],
  );

  const groupUnread = groups.reduce((sum, c) => sum + c.unread, 0);
  const directUnread = directs.reduce((sum, c) => sum + c.unread, 0);

  return (
    <div className="inbox-workspace">
      <h1 className="visually-hidden">Chat nội bộ</h1>
      <div
        className={isPhoneWidth ? 'inbox' : 'inbox inbox-channels-collapsed'}
        data-view={conversationId ? 'thread' : 'list'}
      >
        <section className="inbox-list" aria-label="Danh sách hội thoại chat">
          <div className="inbox-filters">
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                style={{ flex: 1 }}
                onClick={() => setCreateGroupOpen(true)}
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
          </div>

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
            {conversationsQuery.data && (
              <>
                <div
                  className="row"
                  style={{
                    padding: '10px 12px 6px',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span className="small" style={{ fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Nhóm
                  </span>
                  {groupUnread > 0 && (
                    <span className="conv-unread-badge" aria-label={`${groupUnread} tin chưa đọc trong nhóm`}>
                      {groupUnread}
                    </span>
                  )}
                </div>
                {groups.length === 0 ? (
                  <div className="small muted" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                    Chưa có nhóm nào. Bấm &ldquo;Tạo nhóm&rdquo; để bắt đầu.
                  </div>
                ) : (
                  <ul className="conv-list" aria-label="Nhóm">
                    {groups.map((c) => (
                      <ChatConversationRow key={c.id} item={c} selected={c.id === conversationId} />
                    ))}
                  </ul>
                )}

                <div
                  className="row"
                  style={{
                    padding: '10px 12px 6px',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span className="small" style={{ fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Tin riêng
                  </span>
                  {directUnread > 0 && (
                    <span className="conv-unread-badge" aria-label={`${directUnread} tin riêng chưa đọc`}>
                      {directUnread}
                    </span>
                  )}
                </div>
                {directs.length === 0 ? (
                  <div className="small muted" style={{ padding: '10px 12px' }}>
                    Chưa có hội thoại riêng. Bấm &ldquo;Nhắn riêng&rdquo; để chọn đồng nghiệp.
                  </div>
                ) : (
                  <ul className="conv-list" aria-label="Tin riêng">
                    {directs.map((c) => (
                      <ChatConversationRow key={c.id} item={c} selected={c.id === conversationId} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>

        <div className="inbox-main">
          {conversationId ? (
            <ChatConversationPane conversationId={conversationId} />
          ) : (
            <div className="inbox-placeholder">
              <Empty title="Chọn một hội thoại" icon="message">
                Chọn nhóm hoặc tin riêng ở danh sách bên trái, hoặc tạo hội thoại mới để bắt đầu trao đổi.
              </Empty>
            </div>
          )}
        </div>
      </div>

      <CreateGroupDialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} />
      <NewDirectDialog open={newDirectOpen} onClose={() => setNewDirectOpen(false)} />
    </div>
  );
}

function ChatConversationRow({
  item,
  selected,
}: {
  item: ChatConversationSummary;
  selected: boolean;
}) {
  const title = item.title || (item.kind === 'group' ? 'Nhóm chat' : 'Tin riêng');
  const preview = formatMentionText(item.lastMessage) || 'Chưa có tin nhắn';
  const time = fmtShortTime(item.lastMessageAt ?? item.updatedAt);

  return (
    <li>
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: item.id }}
        className="conv-row"
        aria-current={selected ? 'true' : undefined}
      >
        <div className="row" style={{ gap: 8 }}>
          <Avatar name={title} />
          <div className="truncate" style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <span
                className="conv-name truncate"
                style={{ flex: 1, fontWeight: item.unread > 0 ? 700 : 600 }}
              >
                {title}
              </span>
              {time && <span className="small muted nowrap">{time}</span>}
              {item.unread > 0 && (
                <span className="conv-unread-badge" aria-label={`${item.unread} tin chưa đọc`}>
                  {item.unread}
                </span>
              )}
            </div>
            <div
              className="small truncate"
              style={{
                color: item.unread > 0 ? 'var(--text)' : 'var(--muted)',
                fontWeight: item.unread > 0 ? 500 : 400,
              }}
            >
              {preview}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function ChatConversationPane({ conversationId }: { conversationId: string }) {
  const actor = useActor();
  const client = useQueryClient();
  const toast = useToast();
  const connected = useChatSocketConnected();
  const [membersModalOpen, setMembersModalOpen] = useState(false);
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

  return (
    <section className="inbox-thread" style={{ flex: 1, minHeight: 0 }} aria-label={`Hội thoại ${displayTitle}`}>
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
        <div className="truncate" style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="truncate" style={{ fontWeight: 600 }} title={displayTitle}>
              {displayTitle}
            </span>
            <Badge tone={conv.kind === 'group' ? 'info' : 'neutral'}>
              {conv.kind === 'group' ? `Nhóm · ${conv.members.length} thành viên` : 'Tin riêng'}
            </Badge>
          </div>
          <div className="small muted truncate" title={memberNames}>
            Thành viên: {memberNames || '—'}
          </div>
        </div>

        {conv.kind === 'direct' && (
          <label
            className="row small"
            style={{
              cursor: toggleAgentMutation.isPending ? 'not-allowed' : 'pointer',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              role="switch"
              checked={conv.agentReadable}
              disabled={toggleAgentMutation.isPending}
              onChange={(e) => toggleAgentMutation.mutate(e.target.checked)}
              style={{ width: 16, height: 16, minHeight: 16, margin: 0 }}
            />
            <span>Cho agent đọc hội thoại này</span>
          </label>
        )}

        {conv.kind === 'group' && (
          <div className="row" style={{ gap: 6 }}>
            {canManageGroup && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setAgentsModalOpen(true)}
              >
                <Icon name="bot" />
                <span>Thêm trợ lý</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setMembersModalOpen(true)}
            >
              <Icon name="users" />
              <span>Thành viên ({conv.members.length})</span>
            </button>
          </div>
        )}
      </header>

      <ChatThread conversationId={conversationId} embedded />

      <div
        className="small muted"
        style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        Tin nhắn có thể được agent mà thành viên đã kết nối đọc.
      </div>

      {conv.kind === 'group' && (
        <>
          <GroupMembersDialog
            open={membersModalOpen}
            onClose={() => setMembersModalOpen(false)}
            conversation={conv}
            canManage={canManageGroup}
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
  );
}

function CreateGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actor = useActor();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const directory = useApi<DirectoryUser[]>(open ? '/directory' : null);

  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setSearch('');
      setSelectedIds([]);
    }
  }, [open]);

  const createGroupMutation = useMutation<{ id: string }, ApiFailure, { title: string; memberUserIds: string[] }>({
    mutationFn: (payload) =>
      api.post<{ id: string }>('/chat/conversations', {
        kind: 'group',
        title: payload.title,
        memberUserIds: payload.memberUserIds,
      }),
    onSuccess: (res) => {
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      toast('Đã tạo nhóm chat mới');
      onClose();
      void navigate({ to: '/chat/$conversationId', params: { conversationId: res.id } });
    },
  });

  const errors = fieldErrors(createGroupMutation.error);
  const candidates = useMemo(() => {
    const users = (directory.data ?? []).filter((u) => u.id !== actor.id);
    const q = foldDiacritics(search.trim());
    return q ? users.filter((u) => foldDiacritics(u.name).includes(q)) : users;
  }, [directory.data, actor.id, search]);

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length < 50
          ? [...prev, userId]
          : prev,
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || selectedIds.length === 0 || createGroupMutation.isPending) return;
    createGroupMutation.mutate({ title: trimmed, memberUserIds: selectedIds });
  };

  return (
    <Modal
      open={open}
      title="Tạo nhóm"
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

        <Field
          label={`Thành viên (${selectedIds.length} đã chọn)`}
          required
          error={errors.memberUserIds}
          htmlFor={`${formId}-search`}
        >
          <input
            id={`${formId}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm đồng nghiệp theo tên…"
          />
        </Field>

        {directory.isLoading ? (
          <Loading rows={3} />
        ) : (
          <div className="chips" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {candidates.map((u) => {
              const pressed = selectedIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  className="chip"
                  aria-pressed={pressed}
                  onClick={() => toggleMember(u.id)}
                >
                  {u.name} · {roleLabel(u.role)}
                </button>
              );
            })}
            {candidates.length === 0 && (
              <span className="small muted">Không tìm thấy đồng nghiệp phù hợp.</span>
            )}
          </div>
        )}
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

function GroupMembersDialog({
  open,
  onClose,
  conversation,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  conversation: ChatConversationDetail;
  canManage: boolean;
}) {
  const actor = useActor();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const membersEditable = !conversation.system;
  const directory = useApi<DirectoryUser[]>(open && canManage && membersEditable ? '/directory' : null);

  const [title, setTitle] = useState(conversation.title);
  const [addUserId, setAddUserId] = useState('');

  useEffect(() => {
    setTitle(conversation.title);
    setAddUserId('');
  }, [conversation.title, open]);

  const renameMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (nextTitle) =>
      api.patch(`/chat/conversations/${encodeURIComponent(conversation.id)}`, { title: nextTitle }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['chat', 'conversation', conversation.id] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      toast('Đã đổi tên nhóm');
    },
  });

  const addMemberMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (userId) =>
      api.post(`/chat/conversations/${encodeURIComponent(conversation.id)}/members`, { userIds: [userId] }),
    onSuccess: () => {
      setAddUserId('');
      void client.invalidateQueries({ queryKey: ['chat', 'conversation', conversation.id] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      toast('Đã thêm thành viên');
    },
  });

  const removeMemberMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (userId) =>
      api.delete(`/chat/conversations/${encodeURIComponent(conversation.id)}/members/${encodeURIComponent(userId)}`),
    onSuccess: (_res, removedId) => {
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      if (removedId === actor.id) {
        onClose();
        void navigate({ to: '/chat' });
      } else {
        void client.invalidateQueries({ queryKey: ['chat', 'conversation', conversation.id] });
        toast('Đã xóa thành viên khỏi nhóm');
      }
    },
  });

  const existingIds = new Set(conversation.members.map((m) => m.id));
  const nonMembers = (directory.data ?? []).filter((u) => !existingIds.has(u.id));

  return (
    <Modal open={open} title="Thành viên nhóm" onClose={onClose}>
      <div className="stack">
        <FormError error={renameMutation.error ?? addMemberMutation.error ?? removeMemberMutation.error} />

        {canManage && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = title.trim();
              if (trimmed && trimmed !== conversation.title) {
                renameMutation.mutate(trimmed);
              }
            }}
          >
            <input
              type="text"
              maxLength={80}
              value={title}
              aria-label="Tên nhóm"
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!title.trim() || title.trim() === conversation.title || renameMutation.isPending}
            >
              Đổi tên
            </button>
          </form>
        )}

        {canManage && membersEditable && nonMembers.length > 0 && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (addUserId) addMemberMutation.mutate(addUserId);
            }}
          >
            <select
              aria-label="Chọn thành viên thêm vào nhóm"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="">— Chọn đồng nghiệp để thêm —</option>
              {nonMembers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({roleLabel(u.role)})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!addUserId || addMemberMutation.isPending}
            >
              Thêm
            </button>
          </form>
        )}

        <ul className="list">
          {conversation.members.map((m) => {
            const canRemoveThis = membersEditable && (canManage || m.id === actor.id);
            return (
              <li key={m.id} className="row" style={{ padding: '8px 4px' }}>
                <Avatar name={m.name} />
                <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>
                  {m.name}
                </span>
                {m.role === 'owner' && <Badge tone="accent">Trưởng nhóm</Badge>}
                {canRemoveThis && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={removeMemberMutation.isPending}
                    onClick={() => removeMemberMutation.mutate(m.id)}
                  >
                    {m.id === actor.id ? 'Rời nhóm' : 'Xóa'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
