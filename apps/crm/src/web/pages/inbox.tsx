import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationMode } from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, assignConversation, getConversation, listAccounts, listConversations, listRoster, setMode } from '../api';
import { Icon } from '../components/icons';
import { InboxThread, MODE_LABEL, ModeBadge, channelLabel, conversationName, fmtShortTime } from '../components/inbox-thread';
import { IntakeCard } from '../components/intake-card';
import { roleLabel } from '../components/layout';
import { Empty, ErrorState, FormError, Loading, useDebounced, useToast } from '../components/ui';
import { fmtDateTime } from '../format';
import type { AssignResult, ChannelAccount, ConversationFilter, InboxConversation, RosterMember, SetModeResult } from '../types';
import { INBOX_SETTINGS_ROLES, ROSTER_KEY } from './inbox-settings';

/** Conversation list polling interval. */
const LIST_POLL_MS = 5000;
/** Page size of GET /inbox/conversations. */
const CONVERSATION_PAGE = 50;

/**
 * Manager roles on the Worker: they assign a conversation to anyone (a sale only claims an unassigned one),
 * approve group schedules and let an opted-out group receive recurring posts again.
 */
export const MANAGER_ROLES: readonly string[] = ['leader', 'head', 'director', 'admin'];

type AssigneeTab = 'mine' | 'none' | 'all';
const ASSIGNEE_TABS: [AssigneeTab, string][] = [['mine', 'Của tôi'], ['none', 'Chưa giao'], ['all', 'Tất cả']];

const SENDER_PREFIX: Record<string, string> = { bot: 'Bot: ', staff_web: 'Nhân viên: ', staff_phone: 'Điện thoại: ', system: '' };

/** `/inbox` and `/inbox/$conversationId`: the list stays mounted so its filters survive opening a conversation. */
export function InboxPage() {
  const { conversationId } = useParams({ strict: false });
  // On small screens only one column shows: the list at /inbox, the open conversation or settings below it.
  const atList = useRouterState({ select: (s) => /^\/inbox\/?$/.test(s.location.pathname) });
  return (
    <div className="inbox" data-view={atList ? 'list' : 'thread'}>
      <h1 className="visually-hidden">Inbox</h1>
      <ConversationList selectedId={conversationId ?? null} />
      <div className="inbox-main"><Outlet /></div>
    </div>
  );
}

export function InboxIndexPage() {
  return <div className="inbox-placeholder"><Empty title="Chọn một hội thoại" icon="message">Tin nhắn Zalo và Fanpage hiện ở đây, cập nhật vài giây một lần.</Empty></div>;
}

export function InboxConversationPage() {
  const { conversationId } = useParams({ from: '/inbox/$conversationId' });
  const conversation = useQuery<InboxConversation, ApiFailure>({
    queryKey: ['inbox', 'conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });
  if (conversation.isLoading) return <div className="inbox-placeholder"><Loading rows={3} /></div>;
  if (conversation.error || !conversation.data) {
    return (
      <div className="inbox-placeholder stack">
        <ErrorState error={conversation.error} onRetry={() => conversation.refetch()} />
        <Link to="/inbox" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>Quay lại danh sách</Link>
      </div>
    );
  }
  return (
    <div className="inbox-chat">
      <InboxThread conversation={conversation.data} />
      <ConversationPanel conversation={conversation.data} />
    </div>
  );
}

function ConversationList({ selectedId }: { selectedId: string | null }) {
  const actor = useActor();
  const [tab, setTab] = useState<AssigneeTab>('all');
  const [account, setAccount] = useState('');
  const [mode, setModeFilter] = useState<ConversationMode | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const accounts = useQuery<ChannelAccount[], ApiFailure>({ queryKey: ['inbox', 'accounts'], queryFn: listAccounts, staleTime: 60_000 });

  const filter: ConversationFilter = {
    assignee: tab === 'mine' ? actor.id : tab === 'none' ? 'none' : undefined,
    account: account || undefined,
    mode: mode || undefined,
    q: q || undefined,
  };
  // Every loaded page is refetched on each poll, so new conversations and new last messages appear without a reload.
  const list = useInfiniteQuery({
    queryKey: ['inbox', 'conversations', filter],
    queryFn: ({ pageParam }) => listConversations({ ...filter, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: InboxConversation[]) =>
      (last.length === CONVERSATION_PAGE ? last.at(-1)?.lastMessageAt ?? undefined : undefined),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const seen = new Set<string>();
  const rows = (list.data?.pages.flat() ?? []).filter((c) => !seen.has(c.id) && Boolean(seen.add(c.id)));

  return (
    <section className="inbox-list" aria-label="Danh sách hội thoại">
      <div className="inbox-filters">
        {INBOX_SETTINGS_ROLES.includes(actor.role) && (
          <Link to="/inbox/settings" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}><Icon name="settings" />Cài đặt chia việc</Link>
        )}
        <div className="tabs" role="tablist" aria-label="Lọc theo người được giao" style={{ marginBottom: 0 }}>
          {ASSIGNEE_TABS.map(([value, label]) => (
            <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>
        <input type="search" aria-label="Tìm hội thoại theo tên khách" placeholder="Tìm theo tên khách…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="row">
          <select aria-label="Lọc theo tài khoản kênh" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Mọi tài khoản</option>
            {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel === 'facebook' ? 'Fanpage' : 'Zalo'} · {a.displayName}</option>)}
          </select>
          <select aria-label="Lọc theo chế độ" value={mode} onChange={(e) => setModeFilter(e.target.value as ConversationMode | '')}>
            <option value="">Mọi chế độ</option>
            {(Object.keys(MODE_LABEL) as ConversationMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m][0]}</option>)}
          </select>
        </div>
      </div>
      <div className="inbox-list-body">
        {list.isLoading && <div style={{ padding: 12 }}><Loading rows={5} /></div>}
        {list.error && <div style={{ padding: 12 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
        {list.data && !rows.length && <Empty title="Không có hội thoại" icon="inbox">Thử bỏ bớt bộ lọc.</Empty>}
        <ul className="conv-list">
          {rows.map((c) => <ConversationRow key={c.id} conversation={c} selected={c.id === selectedId} />)}
        </ul>
        {list.hasNextPage && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn btn-sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm hội thoại cũ hơn'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ConversationRow({ conversation: c, selected }: { conversation: InboxConversation; selected: boolean }) {
  const preview = c.lastMessageBody ? `${SENDER_PREFIX[c.lastMessageSenderKind ?? ''] ?? ''}${c.lastMessageBody}` : '';
  return (
    <li>
      <Link to="/inbox/$conversationId" params={{ conversationId: c.id }} className="conv-row" aria-current={selected ? 'true' : undefined}>
        <div className="row">
          <span className="truncate conv-name">{conversationName(c)}</span>
          <span className="spacer" />
          <time className="small muted nowrap" dateTime={c.lastMessageAt ?? undefined} title={fmtDateTime(c.lastMessageAt, true)}>{fmtShortTime(c.lastMessageAt)}</time>
        </div>
        {preview && <div className="small text-2 truncate">{preview}</div>}
        <div className="row-wrap conv-meta">
          <span className="small muted truncate">{channelLabel(c)}{c.kind === 'group' ? ' · Nhóm' : ''}</span>
          <ModeBadge mode={c.mode} />
          <span className="small muted truncate">{c.assigneeName ?? 'Chưa giao'}</span>
        </div>
      </Link>
    </li>
  );
}

const MODE_ACTIONS: { mode: ConversationMode; label: string; done: string; primary?: boolean }[] = [
  { mode: 'human', label: 'Tiếp quản', done: 'Đã tiếp quản hội thoại', primary: true },
  { mode: 'ai', label: 'Trả lại AI', done: 'Đã trả hội thoại cho AI' },
  { mode: 'paused', label: 'Tạm dừng', done: 'Đã tạm dừng hội thoại' },
];

/** Right column: who handles the conversation, its mode, the handoff reason and mode actions. */
function ConversationPanel({ conversation: c }: { conversation: InboxConversation }) {
  const client = useQueryClient();
  const toast = useToast();
  const change = useMutation<SetModeResult, ApiFailure, ConversationMode>({
    mutationFn: (mode) => setMode(c.id, mode),
    onSuccess: (_data, mode) => toast(MODE_ACTIONS.find((a) => a.mode === mode)?.done ?? 'Đã đổi chế độ'),
    onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
  return (
    <aside className="inbox-side" aria-label="Thông tin hội thoại">
      <AssigneeSection conversation={c} />
      <PanelSection title="Chế độ">
        <span><ModeBadge mode={c.mode} /></span>
        {c.handoffReason && <p className="small text-2 inbox-handoff"><strong>Lý do chuyển người:</strong> {c.handoffReason}</p>}
      </PanelSection>
      <div className="stack-sm">
        <FormError error={change.error} />
        {MODE_ACTIONS.map((a) => (
          <button key={a.mode} className={a.primary ? 'btn btn-primary' : 'btn'} aria-label={`${a.label} hội thoại`}
            disabled={c.mode === a.mode || change.isPending} onClick={() => change.mutate(a.mode)}>
            {a.label}
          </button>
        ))}
      </div>
      {c.kind === 'direct' && <IntakeCard conversation={c} />}
      <PanelSection title="Kênh">
        <span className="small">{channelLabel(c)}{c.kind === 'group' ? ' · Nhóm' : ''}</span>
        {c.lastInboundAt && <span className="small muted">Khách nhắn lần cuối {fmtDateTime(c.lastInboundAt)}</span>}
      </PanelSection>
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="stack-sm">
      <div className="field-label">{title}</div>
      {children}
    </div>
  );
}

/** Who handles the conversation and, for the roles allowed to, assigning it (managers) or claiming it (sale). */
function AssigneeSection({ conversation: c }: { conversation: InboxConversation }) {
  const actor = useActor();
  const client = useQueryClient();
  const toast = useToast();
  const manager = MANAGER_ROLES.includes(actor.role);
  const canClaim = actor.role === 'sale' && !c.assigneeUserId;
  const roster = useQuery<RosterMember[], ApiFailure>({ queryKey: ROSTER_KEY, queryFn: listRoster, enabled: manager, staleTime: 60_000 });
  const [userId, setUserId] = useState(c.assigneeUserId ?? '');
  useEffect(() => setUserId(c.assigneeUserId ?? ''), [c.id, c.assigneeUserId]);
  const assign = useMutation<AssignResult, ApiFailure, string>({
    mutationFn: (to) => assignConversation(c.id, to),
    onSuccess: (r) => toast(r.assigneeUserId === actor.id ? 'Đã nhận hội thoại' : `Đã giao cho ${r.assigneeName}`),
    onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const overdue = c.slaDueAt !== null && Date.parse(c.slaDueAt) < Date.now();
  return (
    <PanelSection title="Người được giao">
      <span>{c.assigneeName ?? 'Chưa giao'}</span>
      {c.assignedAt && <span className="small muted">Từ {fmtDateTime(c.assignedAt)}</span>}
      {c.slaDueAt && (
        <span className={`small ${overdue ? 'inbox-sla-overdue' : 'muted'}`}>
          {overdue ? 'Quá hạn trả lời từ' : 'Hạn trả lời'} {fmtDateTime(c.slaDueAt)}
        </span>
      )}
      <FormError error={assign.error} />
      {canClaim && (
        <button className="btn btn-primary" disabled={assign.isPending} onClick={() => assign.mutate(actor.id)}>Nhận</button>
      )}
      {manager && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (userId) assign.mutate(userId); }}>
          <select aria-label="Giao hội thoại cho" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!roster.data} style={{ flex: 1, minWidth: 0 }}>
            <option value="">{roster.isLoading ? 'Đang tải…' : 'Chọn nhân viên'}</option>
            {roster.data?.map((m) => (
              <option key={m.userId} value={m.userId}>{m.displayName} · {roleLabel(m.role)}{m.onDuty ? ' · đang trực' : ''}</option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={!userId || userId === c.assigneeUserId || assign.isPending}>Giao</button>
        </form>
      )}
      {roster.error && <ErrorState error={roster.error} onRetry={() => roster.refetch()} />}
    </PanelSection>
  );
}
