import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ChannelAccountStatus, ChannelKind } from '@abm/contracts';
import { useActor } from '../actor-context';
import {
  ApiFailure, connectAccount, createAccount, disconnectAccount, getCustomerBotSwitch, listAccounts, setCustomerBotSwitch, updateAccount,
} from '../api';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast, type Tone } from '../components/ui';
import { fmtAgo, fmtDateTime } from '../format';
import type { ChannelAccount, ChannelAccountUpdate, CustomerBotSwitch } from '../types';

/** Polling while an admin waits for a login QR or the connection that follows it. */
const CONNECT_POLL_MS = 2000;
const ACCOUNTS_KEY = ['inbox', 'accounts'] as const;

const STATUS_LABEL: Record<ChannelAccountStatus, [string, Tone]> = {
  connected: ['Đã kết nối', 'ok'],
  qr_pending: ['Chờ quét QR', 'info'],
  disconnected: ['Chưa kết nối', 'neutral'],
  error: ['Lỗi', 'danger'],
};

/** Account mutations refresh every inbox query afterwards, including after a failure. */
function useAccountMutation<I, T>(fn: (input: I) => Promise<T>) {
  const client = useQueryClient();
  return useMutation<T, ApiFailure, I>({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }) });
}

export function ChannelAccountsPage() {
  const actor = useActor();
  const isAdmin = actor.role === 'admin';
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChannelAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState<ChannelAccount | null>(null);
  const accounts = useQuery<ChannelAccount[], ApiFailure>({
    queryKey: ACCOUNTS_KEY,
    queryFn: listAccounts,
    enabled: isAdmin,
    refetchInterval: connectingId ? CONNECT_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
  const toggle = useAccountMutation(({ id, ...input }: ChannelAccountUpdate & { id: string }) => updateAccount(id, input));
  const connect = useAccountMutation(connectAccount);
  const startConnect = (id: string) => { setConnectingId(id); connect.mutate(id); };
  if (!isAdmin) return <Alert tone="warn">Chỉ Admin quản lý tài khoản kênh.</Alert>;
  const connecting = accounts.data?.find((a) => a.id === connectingId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tài khoản kênh</h1>
          <p className="sub">Số Zalo chung của công ty và Fanpage nối vào Inbox. Kết nối Zalo bằng mã QR quét từ điện thoại giữ số.</p>
        </div>
      </div>
      <div className="stack">
        <CustomerBotSwitchCard />
        <AddAccountCard />
        <section className="card">
          <div className="card-head"><h2>Danh sách tài khoản</h2></div>
          {accounts.isLoading && <div className="card-body"><Loading rows={3} /></div>}
          {accounts.error && <div className="card-body"><ErrorState error={accounts.error} onRetry={() => accounts.refetch()} /></div>}
          {accounts.data && !accounts.data.length && <Empty title="Chưa có tài khoản kênh">Thêm số Zalo hoặc Fanpage ở trên để bắt đầu.</Empty>}
          {toggle.error && <div className="card-body"><FormError error={toggle.error} /></div>}
          {!!accounts.data?.length && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Tên</th><th>Kênh</th><th>Trạng thái</th><th>Thấy lần cuối</th><th>Agent GoClaw</th>
                    <th>Bot</th><th>Gửi tin</th><th>Giới hạn/ngày</th><th>Giờ yên lặng</th><th><span className="visually-hidden">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.data.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Tên"><div className="cell-title">{a.displayName}</div>{a.externalId && <div className="cell-sub mono">{a.externalId}</div>}</td>
                      <td data-label="Kênh">{a.channel === 'facebook' ? 'Fanpage' : 'Zalo'}</td>
                      <td data-label="Trạng thái">
                        <Badge tone={STATUS_LABEL[a.status][1]} dot>{STATUS_LABEL[a.status][0]}</Badge>
                        {a.status === 'error' && a.lastError && <div className="cell-sub mono" title="Mã lỗi bridge báo gần nhất">{a.lastError}</div>}
                      </td>
                      <td data-label="Thấy lần cuối"><span title={fmtDateTime(a.lastSeenAt, true)}>{a.lastSeenAt ? fmtAgo(a.lastSeenAt) : '—'}</span></td>
                      <td data-label="Agent GoClaw" className="mono">{a.agentKey ?? <span className="muted">Chưa đặt</span>}</td>
                      <td data-label="Bot">
                        <button className="btn btn-sm" aria-pressed={a.botEnabled} aria-label={`${a.botEnabled ? 'Tắt' : 'Bật'} bot của ${a.displayName}`}
                          disabled={toggle.isPending} onClick={() => toggle.mutate({ id: a.id, botEnabled: !a.botEnabled })}>
                          <Badge tone={a.botEnabled ? 'agent' : 'neutral'}>{a.botEnabled ? 'Bật' : 'Tắt'}</Badge>
                        </button>
                      </td>
                      <td data-label="Gửi tin">
                        <button className="btn btn-sm" aria-pressed={a.sendPaused} aria-label={`${a.sendPaused ? 'Mở lại gửi tin' : 'Tạm dừng gửi tin'} của ${a.displayName}`}
                          disabled={toggle.isPending} onClick={() => toggle.mutate({ id: a.id, sendPaused: !a.sendPaused })}>
                          <Badge tone={a.sendPaused ? 'warn' : 'ok'}>{a.sendPaused ? 'Tạm dừng' : 'Đang gửi'}</Badge>
                        </button>
                      </td>
                      <td data-label="Giới hạn/ngày" className="num">{a.dailySendCap}</td>
                      <td data-label="Giờ yên lặng" className="nowrap">{a.quietStart && a.quietEnd ? `${a.quietStart}–${a.quietEnd}` : '—'}</td>
                      <td>
                        <div className="row-wrap">
                          {a.channel === 'zalo' && a.status !== 'connected' && (
                            <button className="btn btn-sm btn-primary" onClick={() => startConnect(a.id)} aria-label={`Kết nối ${a.displayName}`}>Kết nối</button>
                          )}
                          {a.channel === 'zalo' && a.status !== 'disconnected' && (
                            <button className="btn btn-sm btn-danger" onClick={() => setDisconnecting(a)} aria-label={`Ngắt kết nối ${a.displayName}`}>Ngắt</button>
                          )}
                          <button className="btn btn-sm" onClick={() => setEditing(a)} aria-label={`Sửa cấu hình ${a.displayName}`}>Sửa</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {connectingId && (
        <ConnectDialog account={connecting} connect={connect} onRetry={() => connect.mutate(connectingId)} onClose={() => setConnectingId(null)} />
      )}
      {editing && <EditAccountDialog account={editing} onClose={() => setEditing(null)} />}
      {disconnecting && <DisconnectDialog account={disconnecting} onClose={() => setDisconnecting(null)} />}
    </>
  );
}

const EMPTY_ACCOUNT_FORM = { channel: 'zalo' as ChannelKind, displayName: '', agentKey: '', externalId: '' };

/** Adds a Zalo number (connected later by QR) or a Facebook Page (identified by its page id, no QR). */
function AddAccountCard() {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_ACCOUNT_FORM);
  const create = useAccountMutation(createAccount);
  const errors = fieldErrors(create.error);
  const isPage = form.channel === 'facebook';
  const pageIdValid = /^\d{1,32}$/.test(form.externalId.trim());
  const submitLabel = isPage ? 'Thêm Fanpage' : 'Thêm số Zalo';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const base = { displayName: form.displayName.trim(), agentKey: form.agentKey.trim() };
    create.mutate(isPage ? { ...base, channel: 'facebook', externalId: form.externalId.trim() } : base, {
      onSuccess: (a) => { toast(`Đã thêm ${a.displayName}`); setForm({ ...EMPTY_ACCOUNT_FORM, channel: form.channel }); },
    });
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Thêm tài khoản kênh</h2></div>
      <form className="card-body stack" onSubmit={submit}>
        <FormError error={create.error && !Object.keys(errors).length ? create.error : null} />
        <Field label="Kênh" htmlFor="account-channel" error={errors.channel}>
          <select id="account-channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as ChannelKind })}>
            <option value="zalo">Số Zalo (kết nối bằng mã QR)</option>
            <option value="facebook">Fanpage Facebook (Messenger)</option>
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Tên hiển thị" required htmlFor="account-name" error={errors.displayName} hint={isPage ? 'Ví dụ: Fanpage ABM' : 'Ví dụ: Zalo tuyển sinh 1'}>
            <input id="account-name" type="text" maxLength={200} required value={form.displayName}
              aria-invalid={Boolean(errors.displayName)} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Agent GoClaw (agentKey)" required htmlFor="account-agent" error={errors.agentKey} hint={`Agent trả lời khách của ${isPage ? 'Fanpage' : 'số'} này`}>
            <input id="account-agent" type="text" maxLength={128} required value={form.agentKey}
              aria-invalid={Boolean(errors.agentKey)} onChange={(e) => setForm({ ...form, agentKey: e.target.value })} />
          </Field>
          {isPage && (
            <Field label="Page ID" required htmlFor="account-page-id"
              error={errors.externalId ?? (form.externalId.trim() && !pageIdValid ? 'Page ID là dãy số' : undefined)}
              hint="Token của Page do quản trị đặt trong secret FB_PAGE_TOKENS; không cần quét QR">
              <input id="account-page-id" type="text" inputMode="numeric" maxLength={32} required value={form.externalId}
                aria-invalid={Boolean(errors.externalId) || Boolean(form.externalId.trim() && !pageIdValid)}
                onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
            </Field>
          )}
        </div>
        <div>
          <button type="submit" className="btn btn-primary"
            disabled={create.isPending || !form.displayName.trim() || !form.agentKey.trim() || (isPage && !pageIdValid)}>{submitLabel}</button>
        </div>
      </form>
    </section>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

type ConnectState = Pick<UseMutationResult<unknown, ApiFailure, string>, 'isPending' | 'isSuccess' | 'isError' | 'error'>;

/** Follows a queued bridge login (the account list polls every 2 s) through QR to connected. */
function ConnectDialog({ account, connect, onRetry, onClose }: {
  account: ChannelAccount | null; connect: ConnectState; onRetry: () => void; onClose: () => void;
}) {
  const toast = useToast();
  const status = account?.status;
  const connected = connect.isSuccess && status === 'connected';
  useEffect(() => {
    if (connected) { toast(`${account?.displayName ?? 'Tài khoản'} đã kết nối`); onClose(); }
  }, [connected, account?.displayName, onClose, toast]);
  const showQr = connect.isSuccess && status === 'qr_pending' && Boolean(account?.qrImage);
  const now = useNow(showQr);
  const expiresIn = account?.qrExpiresAt ? Math.max(0, Math.floor((Date.parse(account.qrExpiresAt) - now) / 1000)) : null;
  const expired = expiresIn === 0;

  return (
    <Modal open title={`Kết nối ${account?.displayName ?? 'Zalo'}`} onClose={onClose} footer={<>
      {(expired || status === 'error' || connect.isError) && (
        <button className="btn btn-primary" disabled={connect.isPending} onClick={onRetry}>Tạo mã mới</button>
      )}
      <button className="btn" onClick={onClose}>Đóng</button>
    </>}>
      <FormError error={connect.error} />
      {connect.isPending && <p className="text-2">Đang gửi yêu cầu đăng nhập…</p>}
      {connect.isSuccess && status === 'error' && (
        <Alert tone="danger">
          Bridge báo lỗi khi đăng nhập{account?.lastError ? <> (<span className="mono">{account.lastError}</span>)</> : null}. Kiểm tra máy chạy bridge rồi tạo mã mới.
        </Alert>
      )}
      {connect.isSuccess && !showQr && status !== 'error' && (
        <p className="text-2" role="status">Đang chờ bridge tạo mã QR… Nếu chờ lâu, kiểm tra máy chạy bridge có đang mở không.</p>
      )}
      {showQr && account?.qrImage && (
        <div className="stack" style={{ alignItems: 'center' }}>
          <img className="qr-image" src={account.qrImage} alt={`Mã QR đăng nhập Zalo cho ${account.displayName}`} data-expired={expired} />
          {expired
            ? <Alert tone="warn">Mã QR đã hết hạn. Bấm “Tạo mã mới”.</Alert>
            : <p className="text-2" role="timer" aria-live="off">Mở Zalo trên điện thoại giữ số, quét mã này. Hết hạn sau <strong className="num">{fmtCountdown(expiresIn ?? 0)}</strong>.</p>}
        </div>
      )}
    </Modal>
  );
}

const fmtCountdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function DisconnectDialog({ account, onClose }: { account: ChannelAccount; onClose: () => void }) {
  const toast = useToast();
  const disconnect = useAccountMutation(disconnectAccount);
  return (
    <Modal open title={`Ngắt kết nối ${account.displayName}?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-danger" disabled={disconnect.isPending}
        onClick={() => disconnect.mutate(account.id, { onSuccess: () => { toast('Đã gửi yêu cầu ngắt kết nối'); onClose(); } })}>Ngắt kết nối</button>
    </>}>
      <FormError error={disconnect.error} />
      <p>Bridge sẽ đăng xuất số này. Tin mới không vào Inbox và không gửi được cho đến khi kết nối lại bằng mã QR.</p>
    </Modal>
  );
}

function EditAccountDialog({ account, onClose }: { account: ChannelAccount; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    agentKey: account.agentKey ?? '', dailySendCap: String(account.dailySendCap),
    quietStart: account.quietStart ?? '', quietEnd: account.quietEnd ?? '',
  });
  const save = useAccountMutation((input: ChannelAccountUpdate) => updateAccount(account.id, input));
  const errors = fieldErrors(save.error);
  const cap = Number(form.dailySendCap);
  const capValid = /^\d+$/.test(form.dailySendCap.trim()) && cap <= 10_000;
  const quietValid = Boolean(form.quietStart) === Boolean(form.quietEnd);
  const submit = () => {
    const input: ChannelAccountUpdate = {
      dailySendCap: cap,
      quietStart: form.quietStart || null,
      quietEnd: form.quietEnd || null,
    };
    if (form.agentKey.trim()) input.agentKey = form.agentKey.trim();
    save.mutate(input, { onSuccess: () => { toast('Đã lưu cấu hình'); onClose(); } });
  };
  return (
    <Modal open title={`Cấu hình ${account.displayName}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-primary" disabled={save.isPending || !capValid || !quietValid} onClick={submit}>Lưu</button>
    </>}>
      <FormError error={save.error && !Object.keys(errors).length ? save.error : null} />
      <Field label="Agent GoClaw (agentKey)" htmlFor="edit-agent" error={errors.agentKey}>
        <input id="edit-agent" type="text" maxLength={128} value={form.agentKey} onChange={(e) => setForm({ ...form, agentKey: e.target.value })} />
      </Field>
      <Field label="Giới hạn tin gửi mỗi ngày" htmlFor="edit-cap" error={errors.dailySendCap ?? (capValid ? undefined : 'Nhập số nguyên từ 0 đến 10000')}
        hint="Tính trên mọi tin gửi đi từ tài khoản này">
        <input id="edit-cap" type="number" min={0} max={10_000} step={1} value={form.dailySendCap}
          aria-invalid={!capValid} onChange={(e) => setForm({ ...form, dailySendCap: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="Giờ yên lặng từ" htmlFor="edit-quiet-start" error={errors.quietStart}>
          <input id="edit-quiet-start" type="time" value={form.quietStart} onChange={(e) => setForm({ ...form, quietStart: e.target.value })} />
        </Field>
        <Field label="đến" htmlFor="edit-quiet-end" error={errors.quietEnd ?? (quietValid ? undefined : 'Cần cả giờ bắt đầu và kết thúc')}>
          <input id="edit-quiet-end" type="time" value={form.quietEnd} aria-invalid={!quietValid} onChange={(e) => setForm({ ...form, quietEnd: e.target.value })} />
        </Field>
      </div>
      <p className="small muted">Để trống cả hai ô giờ để không dùng giờ yên lặng.</p>
    </Modal>
  );
}

/** System-wide stop for the customer-facing bot; `enabled` true means the bot is OFF. */
function CustomerBotSwitchCard() {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const state = useQuery<CustomerBotSwitch, ApiFailure>({ queryKey: ['inbox', 'customer-bot-switch'], queryFn: getCustomerBotSwitch });
  const save = useAccountMutation(setCustomerBotSwitch);
  const off = state.data?.enabled ?? false;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Bot khách hàng</h2><span className="spacer" />
        {state.data && <Badge tone={off ? 'danger' : 'ok'}>{off ? 'Đang tắt toàn hệ thống' : 'Đang hoạt động'}</Badge>}
        <button className={off ? 'btn btn-sm' : 'btn btn-sm btn-danger'} disabled={!state.data} onClick={() => setConfirming(true)}>
          {off ? 'Bật lại bot khách hàng' : 'Tắt bot khách hàng toàn hệ thống'}
        </button>
      </div>
      <div className="card-body small text-2 stack-sm">
        {state.error && <ErrorState error={state.error} onRetry={() => state.refetch()} />}
        <span>Khi tắt, bot không trả lời khách ở mọi số Zalo và Fanpage; nhân viên vẫn nhắn từ Inbox bình thường.</span>
        {state.data?.updatedAt && <span className="muted">Cập nhật {fmtDateTime(state.data.updatedAt)}</span>}
      </div>
      {confirming && (
        <Modal open title={off ? 'Bật lại bot khách hàng?' : 'Tắt bot khách hàng toàn hệ thống?'} onClose={() => setConfirming(false)} footer={<>
          <button className="btn" onClick={() => setConfirming(false)}>Hủy</button>
          <button className={off ? 'btn btn-primary' : 'btn btn-danger'} disabled={save.isPending}
            onClick={() => save.mutate(!off, { onSuccess: () => { toast(off ? 'Đã bật lại bot khách hàng' : 'Đã tắt bot khách hàng'); setConfirming(false); } })}>
            {off ? 'Bật lại' : 'Tắt bot'}
          </button>
        </>}>
          <FormError error={save.error} />
          <p>{off ? 'Bot sẽ trả lời khách trở lại ở các hội thoại đang ở chế độ AI và tài khoản bật bot.' : 'Bot ngừng trả lời khách ngay ở mọi tài khoản cho đến khi bật lại.'}</p>
        </Modal>
      )}
    </section>
  );
}
