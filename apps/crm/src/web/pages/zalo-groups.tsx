import { useState, type FormEvent } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelAccountStatus } from '@abm/contracts';
import { useActor } from '../actor-context';
import {
  ApiFailure, createGroupSchedule, deleteGroupSchedule, getConversation, getInboxSettings, listAccounts, listGroupSchedules, listGroups,
  moveGroupSchedule, updateGroup, updateGroupSchedule, updateInboxSettings, type GroupScheduleAction,
} from '../api';
import { Icon } from '../components/icons';
import { InboxThread, conversationName, fmtShortTime } from '../components/inbox-thread';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast, type Tone } from '../components/ui';
import { fmtDateTime } from '../format';
import { WEEKDAYS, weekdaysLabel } from '../inbox-format';
import type {
  ChannelAccount, GroupSchedule, GroupScheduleInput, GroupScheduleStatus, InboxConversation, InboxSettings, ScheduleSkipReason, ZaloGroup,
  ZaloGroupUpdate,
} from '../types';
import { MANAGER_ROLES } from './inbox';
import { SETTINGS_KEY } from './inbox-settings';

/** Same limit as the Worker's schedule text. */
const SCHEDULE_TEXT_MAX = 2000;
const LIST_POLL_MS = 30_000;
const CONVERSATION_POLL_MS = 5000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Monday to Friday, the default of a new schedule. */
const WORKDAYS_MASK = 0b0011111;

const STATUS_LABEL: Record<GroupScheduleStatus, [string, Tone]> = {
  draft: ['Nháp', 'neutral'],
  pending_approval: ['Chờ duyệt', 'warn'],
  active: ['Đang chạy', 'ok'],
  paused: ['Tạm dừng', 'info'],
};

const SKIP_LABEL: Record<ScheduleSkipReason, string> = {
  feature_off: 'Bỏ qua: tin định kỳ đang tắt toàn hệ thống',
  bot_switch_on: 'Bỏ qua: bot khách hàng đang bị tắt toàn hệ thống',
  account_unavailable: 'Bỏ qua: tài khoản mất kết nối hoặc tạm dừng gửi',
  group_opted_out: 'Bỏ qua: nhóm không nhận tin định kỳ',
  quiet_hours: 'Đã dời: đang trong giờ yên lặng của tài khoản',
  daily_cap: 'Đã dời: tài khoản đủ số tin gửi trong ngày',
};

const ACCOUNT_STATE: Record<ChannelAccountStatus, [string, Tone] | null> = {
  connected: null,
  qr_pending: ['Chờ quét QR', 'info'],
  disconnected: ['Chưa kết nối', 'warn'],
  error: ['Lỗi kết nối', 'danger'],
};

const groupName = (g: Pick<ZaloGroup, 'displayName'>) => conversationName({ displayName: g.displayName, kind: 'group' });
const groupsKey = (account: string) => ['inbox', 'groups', account] as const;
const schedulesKey = (conversationId: string | undefined) => ['inbox', 'group-schedules', conversationId ?? 'all'] as const;

/** Group and schedule writes refresh every inbox query afterwards, including after a failure. */
function useInboxMutation<I, T>(fn: (input: I) => Promise<T>) {
  const client = useQueryClient();
  return useMutation<T, ApiFailure, I>({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }) });
}

/** `/zalo-groups`: groups by channel account with their switches, and every recurring-post schedule. */
export function ZaloGroupsPage() {
  const [account, setAccount] = useState('');
  const accounts = useQuery<ChannelAccount[], ApiFailure>({ queryKey: ['inbox', 'accounts'], queryFn: listAccounts, staleTime: 60_000 });
  const groups = useQuery<ZaloGroup[], ApiFailure>({
    queryKey: groupsKey(account),
    queryFn: () => listGroups(account || undefined),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const zaloAccounts = accounts.data?.filter((a) => a.channel === 'zalo') ?? [];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Nhóm Zalo</h1>
          <p className="sub">Bot không trả lời trong nhóm. Nhân viên nhắn tay, đặt tin định kỳ (cần duyệt) và nhận tóm tắt hằng ngày lúc 21:00 qua Lark.</p>
        </div>
        <select aria-label="Lọc theo tài khoản Zalo" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Mọi tài khoản</option>
          {zaloAccounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
        </select>
      </div>
      <ScheduledSendsBanner />
      <section className="card">
        <div className="card-head">
          <h2>Danh sách nhóm</h2><span className="spacer" />
          {groups.data && <span className="small muted">{groups.data.length} nhóm</span>}
        </div>
        {groups.isLoading && <div className="card-body"><Loading rows={4} /></div>}
        {groups.error && <div className="card-body"><ErrorState error={groups.error} onRetry={() => groups.refetch()} /></div>}
        {groups.data && !groups.data.length && <Empty title="Chưa có nhóm Zalo" icon="leads">Nhóm hiện ở đây khi tài khoản Zalo nhận tin từ nhóm.</Empty>}
        {!!groups.data?.length && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Nhóm</th><th>Tài khoản</th><th>Cài đặt nhóm</th><th>Lịch đang chạy</th><th>Tin cuối</th><th><span className="visually-hidden">Thao tác</span></th></tr>
              </thead>
              <tbody>
                {groups.data.map((g) => (
                  <tr key={g.id}>
                    <td data-label="Nhóm">
                      <Link to="/zalo-groups/$groupId" params={{ groupId: g.id }} className="cell-title">{groupName(g)}</Link>
                    </td>
                    <td data-label="Tài khoản"><div className="stack-sm"><span>{g.accountName}</span><AccountState group={g} /></div></td>
                    <td data-label="Cài đặt nhóm"><GroupSwitches group={g} /></td>
                    <td data-label="Lịch đang chạy">{g.activeSchedules}</td>
                    <td data-label="Tin cuối" className="nowrap">
                      {g.lastMessageAt ? <time dateTime={g.lastMessageAt} title={fmtDateTime(g.lastMessageAt, true)}>{fmtShortTime(g.lastMessageAt)}</time> : '—'}
                    </td>
                    <td>
                      <Link to="/zalo-groups/$groupId" params={{ groupId: g.id }} className="btn btn-sm" aria-label={`Mở nhóm ${groupName(g)}`}>Mở nhóm</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <SchedulesCard />
    </div>
  );
}

/** `/zalo-groups/$groupId`: the group's messages and composer, its switches and its schedules. */
export function ZaloGroupPage() {
  const { groupId } = useParams({ from: '/zalo-groups/$groupId' });
  const conversation = useQuery<InboxConversation, ApiFailure>({
    queryKey: ['inbox', 'conversation', groupId],
    queryFn: () => getConversation(groupId),
    refetchInterval: CONVERSATION_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const accountId = conversation.data?.channelAccountId ?? '';
  const groups = useQuery<ZaloGroup[], ApiFailure>({
    queryKey: groupsKey(accountId),
    queryFn: () => listGroups(accountId),
    enabled: Boolean(accountId),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const group = groups.data?.find((g) => g.id === groupId);
  const back = <Link to="/zalo-groups" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>Quay lại danh sách nhóm</Link>;

  if (conversation.isLoading) return <Loading rows={4} />;
  if (conversation.error || !conversation.data) {
    return <div className="stack"><ErrorState error={conversation.error} onRetry={() => conversation.refetch()} />{back}</div>;
  }
  const c = conversation.data;
  if (c.kind !== 'group') {
    return (
      <div className="stack">
        <Alert tone="warn">Đây là hội thoại 1-1, không phải nhóm Zalo.</Alert>
        <Link to="/inbox/$conversationId" params={{ conversationId: c.id }} className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>Mở trong Inbox</Link>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="small"><Link to="/zalo-groups">Nhóm Zalo</Link> / {conversationName(c)}</div>
          <h1>{conversationName(c)}</h1>
          <p className="sub">Zalo · {c.accountName}</p>
        </div>
      </div>
      <ScheduledSendsBanner />
      <div className="zalo-group-chat">
        <InboxThread conversation={c} backTo="/zalo-groups" />
        <aside className="inbox-side" aria-label="Cài đặt nhóm">
          <div className="stack-sm">
            <div className="field-label">Tài khoản</div>
            <span className="small">{c.accountName}</span>
            {group && <AccountState group={group} />}
          </div>
          <div className="stack-sm">
            <div className="field-label">Cài đặt nhóm</div>
            {groups.isLoading && <Loading rows={2} />}
            {groups.error && <ErrorState error={groups.error} onRetry={() => groups.refetch()} />}
            {group && <GroupSwitches group={group} />}
            {groups.data && !group && <span className="small muted">Không tìm thấy cài đặt của nhóm này.</span>}
          </div>
          <p className="small text-2 row" style={{ alignItems: 'flex-start' }}>
            <Icon name="info" />Bot không trả lời trong nhóm. Tóm tắt hằng ngày gửi vào Lark lúc 21:00 nếu hôm đó nhóm có tin.
          </p>
        </aside>
      </div>
      <SchedulesCard conversationId={c.id} />
    </div>
  );
}

function AccountState({ group: g }: { group: ZaloGroup }) {
  const state = ACCOUNT_STATE[g.accountStatus];
  if (!state && !g.sendPaused) return null;
  return (
    <span className="row-wrap">
      {state && <Badge tone={state[1]} dot>{state[0]}</Badge>}
      {g.sendPaused && <Badge tone="danger" dot>Tạm dừng gửi</Badge>}
    </span>
  );
}

/** "Tóm tắt hằng ngày" for anyone; "Không nhận tin định kỳ" can be turned off again only by a manager. */
function GroupSwitches({ group: g }: { group: ZaloGroup }) {
  const actor = useActor();
  const toast = useToast();
  const update = useInboxMutation<ZaloGroupUpdate, ZaloGroup>((input) => updateGroup(g.id, input));
  const save = (input: ZaloGroupUpdate, done: string) => update.mutate(input, { onSuccess: () => toast(done) });
  const name = groupName(g);
  const optOutLocked = g.scheduledOptOut && !MANAGER_ROLES.includes(actor.role);
  return (
    <div className="stack-sm">
      <label className="row">
        <input type="checkbox" checked={g.summaryEnabled} disabled={update.isPending} aria-label={`Tóm tắt hằng ngày nhóm ${name}`}
          onChange={(e) => save({ summaryEnabled: e.target.checked }, e.target.checked ? `Đã bật tóm tắt hằng ngày cho ${name}` : `Đã tắt tóm tắt hằng ngày cho ${name}`)} />
        Tóm tắt hằng ngày
      </label>
      <label className="row" title={optOutLocked ? 'Chỉ quản lý được cho nhóm nhận lại tin định kỳ' : undefined}>
        <input type="checkbox" checked={g.scheduledOptOut} disabled={update.isPending || optOutLocked} aria-label={`Không nhận tin định kỳ nhóm ${name}`}
          onChange={(e) => save({ scheduledOptOut: e.target.checked }, e.target.checked ? `${name} không nhận tin định kỳ nữa` : `${name} nhận lại tin định kỳ`)} />
        Không nhận tin định kỳ
      </label>
      {optOutLocked && <span className="small muted">Chỉ quản lý được bỏ chọn.</span>}
      <FormError error={update.error} />
    </div>
  );
}

/**
 * Red banner while the organization-wide switch for recurring posts is off; an admin turns it on or off here
 * after a confirmation.
 */
function ScheduledSendsBanner() {
  const actor = useActor();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const settings = useQuery<InboxSettings, ApiFailure>({ queryKey: SETTINGS_KEY, queryFn: getInboxSettings });
  const save = useInboxMutation<boolean, InboxSettings>((enabled) => updateInboxSettings({ scheduledSendsEnabled: enabled }));
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  if (!settings.data) return null;
  const on = settings.data.scheduledSendsEnabled;
  const admin = actor.role === 'admin';
  if (on && !admin) return null;
  const toggle = admin && (
    <button className={on ? 'btn btn-sm btn-danger' : 'btn btn-sm'} onClick={() => setConfirming(true)}>
      {on ? 'Tắt tin định kỳ' : 'Bật tin định kỳ'}
    </button>
  );
  return (
    <>
      {on
        ? <Alert tone="ok"><div className="row-wrap"><span>Tin định kỳ đang bật toàn hệ thống.</span>{toggle}</div></Alert>
        : (
          <Alert tone="danger">
            <div className="row-wrap">
              <span><strong>Tin định kỳ đang tắt toàn hệ thống (chờ kết quả pilot)</strong>. Lịch vẫn được tạo và duyệt nhưng chưa gửi tin nào.</span>
              {toggle}
            </div>
          </Alert>
        )}
      {confirming && (
        <Modal open title={on ? 'Tắt tin định kỳ toàn hệ thống?' : 'Bật tin định kỳ toàn hệ thống?'} onClose={() => setConfirming(false)} footer={<>
          <button className="btn" onClick={() => setConfirming(false)}>Hủy</button>
          <button className={on ? 'btn btn-danger' : 'btn btn-primary'} disabled={save.isPending}
            onClick={() => save.mutate(!on, { onSuccess: () => { toast(on ? 'Đã tắt tin định kỳ' : 'Đã bật tin định kỳ'); setConfirming(false); } })}>
            {on ? 'Tắt' : 'Bật'}
          </button>
        </>}>
          <FormError error={save.error} />
          <p>{on
            ? 'Mọi lịch đang chạy ngừng gửi vào nhóm ngay; lịch vẫn được giữ và chạy lại khi bật.'
            : 'Các lịch đã duyệt sẽ bắt đầu gửi vào nhóm khách theo giờ đã đặt, vẫn qua giờ yên lặng và giới hạn gửi trong ngày của từng tài khoản.'}</p>
        </Modal>
      )}
    </>
  );
}

/** Schedules of one group, or of every group with a group column. */
function SchedulesCard({ conversationId }: { conversationId?: string }) {
  const [editing, setEditing] = useState<GroupSchedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GroupSchedule | null>(null);
  const schedules = useQuery<GroupSchedule[], ApiFailure>({
    queryKey: schedulesKey(conversationId),
    queryFn: () => listGroupSchedules(conversationId),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const allGroups = conversationId === undefined;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{allGroups ? 'Lịch tin định kỳ của mọi nhóm' : 'Lịch tin định kỳ'}</h2><span className="spacer" />
        {conversationId && <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}><Icon name="plus" />Thêm lịch</button>}
      </div>
      {schedules.isLoading && <div className="card-body"><Loading rows={3} /></div>}
      {schedules.error && <div className="card-body"><ErrorState error={schedules.error} onRetry={() => schedules.refetch()} /></div>}
      {schedules.data && !schedules.data.length && (
        <Empty title="Chưa có lịch tin định kỳ" icon="clock">{allGroups ? 'Mở một nhóm để thêm lịch.' : 'Thêm lịch rồi gửi duyệt để bắt đầu.'}</Empty>
      )}
      {!!schedules.data?.length && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                {allGroups && <th>Nhóm</th>}<th>Nội dung</th><th>Lịch gửi</th><th>Trạng thái</th><th>Lần chạy</th><th>Người tạo / duyệt</th>
                <th><span className="visually-hidden">Thao tác</span></th>
              </tr>
            </thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.id}>
                  {allGroups && (
                    <td data-label="Nhóm">
                      <Link to="/zalo-groups/$groupId" params={{ groupId: s.conversationId }} className="cell-title">
                        {conversationName({ displayName: s.conversationName, kind: 'group' })}
                      </Link>
                      <div className="cell-sub">{s.accountName}</div>
                    </td>
                  )}
                  <td data-label="Nội dung"><span className="schedule-text" title={s.templateText}>{s.templateText}</span></td>
                  <td data-label="Lịch gửi" className="nowrap">{weekdaysLabel(s.weekdaysMask)} · {s.timeOfDay}</td>
                  <td data-label="Trạng thái"><Badge tone={STATUS_LABEL[s.status][1]} dot>{STATUS_LABEL[s.status][0]}</Badge></td>
                  <td data-label="Lần chạy">
                    <div className="stack-sm small">
                      {s.nextRunAt && <span>Lần tới {fmtDateTime(s.nextRunAt)}</span>}
                      {s.lastRunAt && <span className="muted">Gửi lần cuối {fmtDateTime(s.lastRunAt)}</span>}
                      {s.lastSkipReason && <Badge tone="warn">{SKIP_LABEL[s.lastSkipReason]}</Badge>}
                      {!s.nextRunAt && !s.lastRunAt && !s.lastSkipReason && <span className="muted">—</span>}
                    </div>
                  </td>
                  <td data-label="Người tạo / duyệt">
                    <div className="stack-sm small">
                      <span>Tạo: {s.createdByName ?? '—'}</span>
                      {s.approvedByName && <span className="muted">Duyệt: {s.approvedByName}{s.approvedAt ? ` · ${fmtDateTime(s.approvedAt)}` : ''}</span>}
                    </div>
                  </td>
                  <td><ScheduleActions schedule={s} onEdit={() => setEditing(s)} onDelete={() => setDeleting(s)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-body small text-2 row" style={{ alignItems: 'flex-start' }}>
        <Icon name="info" />
        <span>Lịch chỉ chạy sau khi Trưởng nhóm, Trưởng phòng, Giám đốc hoặc Admin (không phải người tạo) duyệt. Sửa nội dung hoặc giờ gửi phải duyệt lại.
          Mỗi lần gửi lệch ngẫu nhiên 0–10 phút, tránh giờ yên lặng và giới hạn gửi trong ngày của tài khoản.</span>
      </div>
      {editing === 'new' && conversationId && <ScheduleFormModal conversationId={conversationId} schedule={null} onClose={() => setEditing(null)} />}
      {editing && editing !== 'new' && (
        <ScheduleFormModal conversationId={editing.conversationId} schedule={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteScheduleModal schedule={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

const ACTION_DONE: Record<GroupScheduleAction, string> = {
  submit: 'Đã gửi lịch chờ duyệt',
  approve: 'Đã duyệt, lịch bắt đầu chạy',
  pause: 'Đã tạm dừng lịch',
};

/** Buttons a schedule allows the current user, following the Worker's rules. */
function ScheduleActions({ schedule: s, onEdit, onDelete }: { schedule: GroupSchedule; onEdit: () => void; onDelete: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const move = useInboxMutation<GroupScheduleAction, GroupSchedule>((action) => moveGroupSchedule(s.id, action));
  const manager = MANAGER_ROLES.includes(actor.role);
  const author = s.createdByUserId === actor.id;
  const mayManage = author || manager;
  const mayApprove = manager && !author;
  const run = (action: GroupScheduleAction) => move.mutate(action, {
    onSuccess: () => toast(ACTION_DONE[action]),
    onError: (error) => toast(error.message, 'danger'),
  });
  const busy = move.isPending;
  return (
    <div className="row-wrap">
      {s.status === 'draft' && mayManage && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run('submit')}>Gửi duyệt</button>}
      {s.status === 'pending_approval' && mayApprove && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run('approve')}>Duyệt</button>}
      {s.status === 'pending_approval' && !mayApprove && <span className="small muted">Chờ quản lý khác duyệt</span>}
      {s.status === 'active' && mayManage && <button className="btn btn-sm" disabled={busy} onClick={() => run('pause')}>Tạm dừng</button>}
      {s.status === 'paused' && mayApprove && <button className="btn btn-sm" disabled={busy} onClick={() => run('approve')}>Chạy lại</button>}
      {mayManage && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onEdit}>Sửa</button>}
      {mayManage && <button className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={onDelete}>Xoá</button>}
    </div>
  );
}

/** Creates a draft for the group `conversationId`, or edits `schedule` (a schedule of that group). */
function ScheduleFormModal({ conversationId, schedule, onClose }: { conversationId: string; schedule: GroupSchedule | null; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(schedule?.templateText ?? '');
  const [mask, setMask] = useState(schedule?.weekdaysMask ?? WORKDAYS_MASK);
  const [time, setTime] = useState(schedule?.timeOfDay ?? '09:00');
  const save = useInboxMutation<GroupScheduleInput, GroupSchedule>((input) =>
    (schedule ? updateGroupSchedule(schedule.id, input) : createGroupSchedule({ conversationId, ...input })));
  const errors = fieldErrors(save.error);
  const trimmed = text.trim();
  const textError = errors.templateText ?? (text && !trimmed ? 'Nhập nội dung' : undefined);
  const maskError = errors.weekdaysMask ?? (mask === 0 ? 'Chọn ít nhất một ngày' : undefined);
  const timeError = errors.timeOfDay ?? (time && !HHMM.test(time) ? 'Định dạng HH:MM' : undefined);
  const valid = trimmed.length > 0 && trimmed.length <= SCHEDULE_TEXT_MAX && mask > 0 && HHMM.test(time);
  const reapprove = schedule?.status === 'active' || schedule?.status === 'paused';
  const formId = 'group-schedule-form';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || save.isPending) return;
    save.mutate({ templateText: trimmed, weekdaysMask: mask, timeOfDay: time }, {
      onSuccess: (s) => {
        toast(schedule ? (s.status === 'pending_approval' && reapprove ? 'Đã lưu, lịch chờ duyệt lại' : 'Đã lưu lịch') : 'Đã tạo lịch nháp. Gửi duyệt để bắt đầu.');
        onClose();
      },
    });
  };
  const toggleDay = (i: number) => setMask((m) => m ^ (1 << i));
  return (
    <Modal open title={schedule ? 'Sửa lịch tin định kỳ' : 'Thêm lịch tin định kỳ'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={!valid || save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</button>
    </>}>
      <form id={formId} className="stack" onSubmit={submit}>
        {reapprove && <Alert tone="warn">Sửa nội dung hoặc giờ gửi sẽ dừng lịch và chuyển về chờ duyệt lại.</Alert>}
        <Field label="Nội dung tin" required htmlFor="schedule-text" error={textError} hint={`${text.length}/${SCHEDULE_TEXT_MAX} ký tự`}>
          <textarea id="schedule-text" rows={5} maxLength={SCHEDULE_TEXT_MAX} required value={text} aria-invalid={Boolean(textError)}
            onChange={(e) => setText(e.target.value)} />
        </Field>
        <fieldset className="weekday-picker stack-sm">
          <legend className="field-label" style={{ marginBottom: 6 }}>Ngày gửi<span className="req" aria-hidden="true"> *</span></legend>
          <div>
            {WEEKDAYS.map((d, i) => (
              <label key={d}><input type="checkbox" checked={(mask & (1 << i)) !== 0} onChange={() => toggleDay(i)} />{d}</label>
            ))}
          </div>
          {maskError && <span className="field-error" role="alert">{maskError}</span>}
        </fieldset>
        <Field label="Giờ gửi (giờ Việt Nam)" required htmlFor="schedule-time" error={timeError}>
          <input id="schedule-time" type="time" step={60} required value={time} aria-invalid={Boolean(timeError)}
            onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 160 }} />
        </Field>
        <FormError error={save.error && !Object.keys(errors).length ? save.error : null} />
      </form>
    </Modal>
  );
}

function DeleteScheduleModal({ schedule, onClose }: { schedule: GroupSchedule; onClose: () => void }) {
  const toast = useToast();
  const remove = useInboxMutation<string, { id: string }>(deleteGroupSchedule);
  return (
    <Modal open title="Xoá lịch tin định kỳ?" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-danger" disabled={remove.isPending}
        onClick={() => remove.mutate(schedule.id, { onSuccess: () => { toast('Đã xoá lịch'); onClose(); } })}>Xoá lịch</button>
    </>}>
      <FormError error={remove.error} />
      <p>Lịch “{weekdaysLabel(schedule.weekdaysMask)} · {schedule.timeOfDay}” sẽ bị xoá. Tin đã xếp hàng gửi không bị thu hồi.</p>
    </Modal>
  );
}
