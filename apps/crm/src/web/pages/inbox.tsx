import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationMode } from '@abm/contracts';
import { useActor } from '../actor-context';
import {
  ApiFailure, assignConversation, getConversation, getInboxContactCrm, listAccounts, listConversations, listIntakes, listRoster, setMode,
} from '../api';
import { Icon } from '../components/icons';
import { InboxThread, MODE_LABEL, ModeBadge, conversationName, fmtShortTime } from '../components/inbox-thread';
import { IntakeCard } from '../components/intake-card';
import { roleLabel } from '../components/layout';
import {
  Avatar, Badge, ChannelBadge, CopyableText, Empty, ErrorState, FormError, KpiCard, LinkedLeadCard, Loading, SegmentedControl, useDebounced, useToast,
} from '../components/ui';
import { fmtDateTime } from '../format';
import { channelKindLabel, conversationChannelLabel } from '../inbox-format';
import type {
  AssignResult, ChannelAccountList, ConversationFilter, InboxContactCrm, InboxConversation, LeadIntake, RosterMember, SetModeResult,
} from '../types';
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

/** Leader and admin, matching the Worker: turn Long on in a group and mark ABM staff. Changing a group's agent stays admin-only. */
export const SETTINGS_ROLES: readonly string[] = ['leader', 'admin'];

type AssigneeTab = 'mine' | 'none' | 'all';
const ASSIGNEE_TABS: { value: AssigneeTab; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'mine', label: 'Của tôi' },
  { value: 'none', label: 'Chưa giao' },
];

const SENDER_PREFIX: Record<string, string> = { bot: 'Bot: ', staff_web: 'Nhân viên: ', staff_phone: 'Điện thoại: ', system: '' };

/** `/inbox` and `/inbox/$conversationId`: the list stays mounted so its filters survive opening a conversation. */
export function InboxPage() {
  const actor = useActor();
  const { conversationId } = useParams({ strict: false });
  const atList = useRouterState({ select: (s) => /^\/inbox\/?$/.test(s.location.pathname) });
  const [account, setAccount] = useState('');
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);

  const accounts = useQuery<ChannelAccountList, ApiFailure>({
    queryKey: ['inbox', 'accounts'],
    queryFn: listAccounts,
    staleTime: 60_000,
  });
  const pendingIntakes = useQuery<LeadIntake[], ApiFailure>({
    queryKey: ['inbox', 'intakes', { status: 'pending' }],
    queryFn: () => listIntakes({ status: 'pending' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const overviewList = useQuery<InboxConversation[], ApiFailure>({
    queryKey: ['inbox', 'conversations', 'overview'],
    queryFn: () => listConversations({}),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const overviewRows = overviewList.data ?? [];
  const nowMs = Date.now();
  const humanCount = overviewRows.filter((c) => c.mode === 'human').length;
  const aiCount = overviewRows.filter((c) => c.mode === 'ai').length;
  const overdueCount = overviewRows.filter((c) => c.slaDueAt !== null && Date.parse(c.slaDueAt) < nowMs).length;
  const pendingIntakeCount = pendingIntakes.data?.length ?? 0;

  const countByAccount = new Map<string, number>();
  for (const c of overviewRows) {
    countByAccount.set(c.channelAccountId, (countByAccount.get(c.channelAccountId) ?? 0) + 1);
  }

  return (
    <div className="inbox-workspace">
      <h1 className="visually-hidden">Inbox</h1>
      <div className="inbox-kpi-strip" role="region" aria-label="Chỉ số hội thoại">
        <KpiCard compact label="Hội thoại gần nhất" value={overviewRows.length} sub={`${accounts.data?.accounts.length ?? 0} kênh kết nối`} />
        <KpiCard compact label="Chờ nhân viên" value={humanCount} tone={humanCount > 0 ? 'brand' : 'neutral'} sub="Đang ở chế độ Nhân viên" />
        <KpiCard compact label="AI đang trực" value={aiCount} tone={aiCount > 0 ? 'ai' : 'neutral'} sub="Phản hồi tự động" />
        <KpiCard compact label="Lead chờ phân loại" value={pendingIntakeCount} tone={pendingIntakeCount > 0 ? 'warn' : 'neutral'} sub="Từ trích xuất tự động" />
        <KpiCard compact label="Quá hạn SLA" value={overdueCount} tone={overdueCount > 0 ? 'danger' : 'neutral'} sub="Cần phản hồi ngay" />
      </div>

      <div className={`inbox ${channelsCollapsed ? 'inbox-channels-collapsed' : ''}`} data-view={atList ? 'list' : 'thread'}>
        <aside className="inbox-channels" aria-label="Danh sách kênh">
          <div className="row" style={{ padding: '4px 8px 6px' }}>
            <div className="inbox-channels-head" style={{ padding: 0 }}>Kênh kết nối</div>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-ghost btn-sm icon-btn"
              onClick={() => setChannelsCollapsed((v) => !v)}
              title="Thu gọn cột kênh"
              aria-label="Thu gọn cột kênh"
              style={{ color: '#94A3B8', width: 24, height: 24 }}
            >
              <Icon name="layers" />
            </button>
          </div>
          <button
            type="button"
            className="inbox-channel-btn"
            aria-current={account === '' ? 'true' : undefined}
            onClick={() => setAccount('')}
          >
            <Icon name="inbox" />
            <span className="truncate">Tất cả kênh</span>
            <span className="count">{overviewRows.length}</span>
          </button>
          {accounts.data?.accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              className="inbox-channel-btn"
              aria-current={account === a.id ? 'true' : undefined}
              onClick={() => setAccount(a.id)}
              title={`${channelKindLabel(a.channel)} · ${a.displayName}`}
            >
              <Icon name={a.channel === 'facebook' ? 'facebook' : a.channel === 'zalo_oa' ? 'zalo-oa' : 'zalo'} />
              <span className="truncate">{a.displayName}</span>
              <span className="count">{countByAccount.get(a.id) ?? 0}</span>
            </button>
          ))}
          <span className="spacer" />
          <div className="inbox-channels-head"> Điều hướng nhanh</div>
          <Link to="/zalo-groups" className="inbox-channel-btn">
            <Icon name="users" />
            <span className="truncate">Nhóm Zalo</span>
          </Link>
          <Link to="/intakes" className="inbox-channel-btn">
            <Icon name="bot" />
            <span className="truncate">Chờ phân loại</span>
            {pendingIntakeCount > 0 && <span className="count">{pendingIntakeCount}</span>}
          </Link>
          {INBOX_SETTINGS_ROLES.includes(actor.role) && (
            <Link to="/inbox/settings" className="inbox-channel-btn">
              <Icon name="settings" />
              <span className="truncate">Cài đặt chia việc</span>
            </Link>
          )}
        </aside>

        <ConversationList
          selectedId={conversationId ?? null}
          account={account}
          onAccountChange={setAccount}
          accounts={accounts.data?.accounts ?? []}
          channelsCollapsed={channelsCollapsed}
          onExpandChannels={() => setChannelsCollapsed(false)}
        />
        <div className="inbox-main"><Outlet /></div>
      </div>
    </div>
  );
}

export function InboxIndexPage() {
  return <div className="inbox-placeholder"><Empty title="Chọn một hội thoại" icon="message">Tin nhắn Zalo và Fanpage hiện ở đây, cập nhật vài giây một lần.</Empty></div>;
}

export function InboxConversationPage() {
  const { conversationId } = useParams({ from: '/inbox/$conversationId' });
  const [sideOpen, setSideOpen] = useState(false);
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
      <InboxThread
        conversation={conversation.data}
        sideOpen={sideOpen}
        onToggleSide={() => setSideOpen((v) => !v)}
      />
      <ConversationPanel
        conversation={conversation.data}
        isOpen={sideOpen}
        onClose={() => setSideOpen(false)}
      />
    </div>
  );
}

function ConversationList({
  selectedId,
  account,
  onAccountChange,
  accounts,
  channelsCollapsed,
  onExpandChannels,
}: {
  selectedId: string | null;
  account: string;
  onAccountChange: (accountId: string) => void;
  accounts: ChannelAccountList['accounts'];
  channelsCollapsed: boolean;
  onExpandChannels: () => void;
}) {
  const actor = useActor();
  const [tab, setTab] = useState<AssigneeTab>('all');
  const [mode, setModeFilter] = useState<ConversationMode | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);

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
        <div className="row" style={{ gap: 6 }}>
          {channelsCollapsed && (
            <button
              type="button"
              className="btn btn-ghost btn-sm icon-btn"
              onClick={onExpandChannels}
              title="Mở danh sách kênh"
              aria-label="Mở danh sách kênh"
            >
              <Icon name="layers" />
            </button>
          )}
          <SegmentedControl
            size="sm"
            ariaLabel="Lọc theo người được giao"
            value={tab}
            onChange={setTab}
            options={ASSIGNEE_TABS}
          />
          <span className="spacer" />
          {INBOX_SETTINGS_ROLES.includes(actor.role) && (
            <Link to="/inbox/settings" className="btn btn-ghost btn-sm icon-btn" title="Cài đặt chia việc" aria-label="Cài đặt chia việc">
              <Icon name="settings" />
            </Link>
          )}
        </div>
        <input type="search" aria-label="Tìm hội thoại theo tên khách" placeholder="Tìm theo tên khách…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="row">
          <select aria-label="Lọc theo tài khoản kênh" value={account} onChange={(e) => onAccountChange(e.target.value)}>
            <option value="">Mọi tài khoản</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{channelKindLabel(a.channel)} · {a.displayName}</option>)}
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
  const name = conversationName(c);
  const preview = c.lastMessageBody ? `${SENDER_PREFIX[c.lastMessageSenderKind ?? ''] ?? ''}${c.lastMessageBody}` : '';
  const unread = c.unreadCount ?? 0;
  const overdue = c.slaDueAt !== null && Date.parse(c.slaDueAt) < Date.now();
  return (
    <li>
      <Link to="/inbox/$conversationId" params={{ conversationId: c.id }} className="conv-row" aria-current={selected ? 'true' : undefined}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <Avatar name={name} src={c.avatarUrl} />
          <div className="stack-xs" style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="truncate conv-name">{name}</span>
              <ChannelBadge channel={c.channel} compact />
              <span className="spacer" />
              <time className="small muted nowrap" dateTime={c.lastMessageAt ?? undefined} title={fmtDateTime(c.lastMessageAt, true)}>
                {fmtShortTime(c.lastMessageAt)}
              </time>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {preview ? (
                <div className="small text-2 truncate" style={{ flex: 1, fontWeight: unread > 0 ? 600 : 400 }}>{preview}</div>
              ) : (
                <div className="small muted truncate" style={{ flex: 1 }}>Chưa có tin nhắn</div>
              )}
              {unread > 0 && <span className="conv-unread-badge" aria-label={`${unread} tin chưa đọc`}>{unread}</span>}
            </div>
            <div className="row-wrap conv-meta">
              <ModeBadge mode={c.mode} />
              {c.leadCode && <Badge tone="info">{c.leadCode}</Badge>}
              {overdue && <Badge tone="danger">Quá hạn SLA</Badge>}
              <span className="small muted truncate">{c.assigneeName ?? 'Chưa giao'}</span>
            </div>
          </div>
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

/** Right column ("Khách trong CRM"): customer record, linked leads, pending intake, assignee, and mode controls. */
function ConversationPanel({
  conversation: c,
  isOpen,
  onClose,
}: {
  conversation: InboxConversation;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const change = useMutation<SetModeResult, ApiFailure, ConversationMode>({
    mutationFn: (mode) => setMode(c.id, mode),
    onSuccess: (_data, mode) => toast(MODE_ACTIONS.find((a) => a.mode === mode)?.done ?? 'Đã đổi chế độ'),
    onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const crm = useQuery<InboxContactCrm, ApiFailure>({
    queryKey: ['inbox', 'contact', c.contactId],
    queryFn: () => getInboxContactCrm(c.contactId!),
    enabled: Boolean(c.contactId),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const contact = crm.data?.contact ?? null;
  const leads = crm.data?.leads ?? [];
  const hasOpenLead = crm.data?.hasOpenLead ?? false;
  const openLeadCode = crm.data?.openLeadCode ?? null;

  return (
    <aside className={`inbox-side ${isOpen ? 'is-open' : ''}`} aria-label="Khách trong CRM">
      <div className="row">
        <strong style={{ fontSize: 14 }}>Khách trong CRM</strong>
        <span className="spacer" />
        {onClose && isOpen && (
          <button type="button" className="btn btn-ghost btn-sm icon-btn" onClick={onClose} aria-label="Đóng cột Khách trong CRM">
            <Icon name="close" />
          </button>
        )}
      </div>

      {c.contactId ? (
        <div className="stack-sm">
          {crm.isLoading && <Loading rows={2} />}
          {crm.error && <ErrorState error={crm.error} onRetry={() => crm.refetch()} />}
          {contact ? (
            <div className="crm-contact-card">
              <div className="row" style={{ gap: 8 }}>
                <Avatar name={contact.displayName} src={c.avatarUrl} />
                <div className="truncate" style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>{contact.displayName}</div>
                  <div className="small muted truncate">
                    Người giữ khách: <strong>{contact.ownerName ?? 'Chưa có'}</strong>
                  </div>
                </div>
                <Link to="/learners/$contactId" params={{ contactId: contact.id }} className="btn btn-ghost btn-sm" title="Mở hồ sơ khách">
                  <Icon name="external-link" />Hồ sơ
                </Link>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                <span className="muted">Số điện thoại</span>
                {contact.phone ? <CopyableText value={contact.phone} mono /> : <span className="muted">Chưa có</span>}
              </div>
              {contact.email && (
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span className="muted">Email</span>
                  <span className="truncate">{contact.email}</span>
                </div>
              )}
            </div>
          ) : (
            !crm.isLoading && <p className="small muted">Khách thuộc phạm vi của nhân sự khác.</p>
          )}

          <div className="stack-xs">
            <div className="field-label">Lead của khách ({leads.length})</div>
            {leads.length > 0 ? (
              <div className="stack-xs">
                {leads.map((l) => <LinkedLeadCard key={l.id} lead={l} />)}
              </div>
            ) : (
              <p className="small muted">Chưa có lead nào trong phạm vi của bạn.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="small muted">Hội thoại này chưa gắn với hồ sơ khách nào trong CRM.</p>
      )}

      {c.kind === 'direct' && (
        <IntakeCard conversation={c} hasOpenLead={hasOpenLead} openLeadCode={openLeadCode} />
      )}

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
      <PanelSection title="Kênh">
        <span className="small">{conversationChannelLabel(c)}{c.kind === 'group' ? ' · Nhóm' : ''}</span>
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
