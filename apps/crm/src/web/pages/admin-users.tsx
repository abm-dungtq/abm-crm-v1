import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ROLES, type RoleCode } from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi } from '../api';
import { roleLabel } from '../components/layout';
import { Alert, Badge, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast, type Tone } from '../components/ui';
import { fmtDateTime } from '../format';
import type { AdminOverview, AdminUser, IssuedPassword, LarkLinkResult } from '../types';

/** Admin mutations: refresh the user list afterwards, including after a lost race. */
function useAdminMutation<I, T = null>(fn: (input: I) => Promise<T>) {
  const client = useQueryClient();
  return useMutation<T, ApiFailure, I>({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries(),
  });
}

const LARK_LABEL: Record<AdminUser['larkLinkStatus'], [string, Tone]> = {
  linked: ['Đã liên kết', 'ok'], unmatched: ['Không tìm thấy', 'warn'], error: ['Lỗi', 'danger'], unlinked: ['Chưa kiểm', 'neutral'],
};

function passwordState(u: AdminUser): [string, Tone] {
  if (!u.hasPassword) return ['Chưa cấp', 'neutral'];
  if (!u.mustChangePassword) return ['Đã đặt', 'ok'];
  if (!u.tempPasswordExpiresAt || u.tempPasswordExpiresAt < new Date().toISOString()) return ['Mật khẩu tạm đã hết hạn', 'danger'];
  return [`Mật khẩu tạm, hạn ${fmtDateTime(u.tempPasswordExpiresAt)}`, 'warn'];
}

type Dialog = { kind: 'edit' | 'status' | 'temp' | 'bot'; user: AdminUser } | null;

export function AdminUsersPage() {
  const actor = useActor();
  const q = useApi<AdminOverview>(actor.role === 'admin' ? '/admin/overview' : null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [issued, setIssued] = useState<IssuedPassword[] | null>(null);
  const [larkResult, setLarkResult] = useState<LarkLinkResult | null>(null);
  const link = useAdminMutation((userIds?: string[]) => api.post<LarkLinkResult>('/admin/lark/link', userIds ? { userIds } : {}));
  if (actor.role !== 'admin') return <Alert tone="warn">Chỉ Admin quản lý người dùng.</Alert>;
  const runLink = (userIds?: string[]) => link.mutate(userIds, { onSuccess: setLarkResult });

  return (
    <>
      <div className="page-head">
        <div><h1>Người dùng</h1><p className="sub">Tạo tài khoản từ file danh sách nhân sự, cấp mật khẩu tạm và liên kết Lark để bot nhận ra người nhắn.</p></div>
        <div className="row-wrap">
          <button className="btn" onClick={() => runLink()} disabled={link.isPending}>{link.isPending ? 'Đang liên kết…' : 'Liên kết Lark cho mọi người'}</button>
        </div>
      </div>
      <div className="stack">
        {link.error && <FormError error={link.error} />}
        {larkResult && (
          <Alert tone={larkResult.error ? 'warn' : 'ok'}>
            Lark: {larkResult.linked} đã liên kết · {larkResult.unmatched} không tìm thấy · {larkResult.error} lỗi
            {larkResult.message && <div className="small">{larkResult.message}</div>}
          </Alert>
        )}
        {q.data && <AgentKillSwitch enabled={q.data.counts.agentKillSwitch === 1} />}
        <RosterImport onIssued={setIssued} />
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && (
          <section className="card">
            <div className="card-head"><h2>Danh sách người dùng</h2><span className="spacer" /><Badge>{q.data.users.length}</Badge></div>
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>Tên</th><th>Vai trò</th><th>Phòng ban / Nhóm</th><th>Trạng thái</th><th>Mật khẩu</th><th>Lark</th><th>Bot</th><th><span className="visually-hidden">Thao tác</span></th></tr></thead>
                <tbody>
                  {q.data.users.map((u) => {
                    const [pw, pwTone] = passwordState(u);
                    const [lark, larkTone] = LARK_LABEL[u.larkLinkStatus];
                    const self = u.id === actor.id;
                    return (
                      <tr key={u.id}>
                        <td><div className="cell-title">{u.name}{self && <span className="muted small"> (bạn)</span>}</div><div className="cell-sub">{u.email}</div></td>
                        <td data-label="Vai trò">{roleLabel(u.role)}</td>
                        <td data-label="Phòng ban / Nhóm">{[u.departmentName, u.teamName].filter(Boolean).join(' / ') || '—'}</td>
                        <td data-label="Trạng thái"><Badge tone={u.status === 'active' ? 'ok' : 'danger'}>{u.status === 'active' ? 'Hoạt động' : 'Đã khóa'}</Badge></td>
                        <td data-label="Mật khẩu"><Badge tone={pwTone}>{pw}</Badge></td>
                        <td data-label="Lark"><Badge tone={larkTone} title={u.larkCheckedAt ? `Kiểm lúc ${fmtDateTime(u.larkCheckedAt)}` : undefined}>{lark}</Badge></td>
                        <td data-label="Bot"><Badge tone={u.agentTokens ? 'ok' : 'neutral'}>{u.agentTokens ? `Có chìa khóa (${u.agentTokens})` : 'Chưa'}</Badge></td>
                        <td>
                          <div className="row-wrap">
                            <button className="btn btn-sm" onClick={() => setDialog({ kind: 'edit', user: u })}>Sửa</button>
                            {!self && <button className="btn btn-sm" onClick={() => setDialog({ kind: 'status', user: u })}>{u.status === 'active' ? 'Khóa' : 'Mở khóa'}</button>}
                            <button className="btn btn-sm" onClick={() => setDialog({ kind: 'temp', user: u })}>Cấp mật khẩu tạm</button>
                            {u.agentTokens > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: 'bot', user: u })}>Thu hồi chìa khóa bot</button>}
                            {u.status === 'active' && u.larkLinkStatus !== 'linked' && (
                              <button className="btn btn-sm btn-ghost" onClick={() => runLink([u.id])} disabled={link.isPending}>Thử liên kết Lark</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      {dialog?.kind === 'edit' && q.data && <EditUserDialog user={dialog.user} overview={q.data} self={dialog.user.id === actor.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'status' && <StatusDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'temp' && <TempPasswordDialog user={dialog.user} self={dialog.user.id === actor.id} onClose={() => setDialog(null)} onIssued={(p) => { setDialog(null); setIssued([p]); }} />}
      {dialog?.kind === 'bot' && <RevokeBotDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {issued && <IssuedPasswordsDialog items={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

interface PreviewUser { line: number; name: string; email: string; role: RoleCode; departmentName: string | null; teamName: string | null; action: 'create' | 'update' | 'unchanged'; changes: string[] }
interface RosterPreview {
  users: PreviewUser[]; errors: { line: number | null; message: string }[];
  counts: { create: number; update: number; unchanged: number };
  newDepartments: string[]; newTeams: { departmentName: string; name: string }[];
}
const ACTION_LABEL: Record<PreviewUser['action'], [string, Tone]> = { create: ['Tạo mới', 'accent'], update: ['Cập nhật', 'warn'], unchanged: ['Không đổi', 'neutral'] };

function RosterImport({ onIssued }: { onIssued: (items: IssuedPassword[]) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const preview = useMutation<RosterPreview, ApiFailure, string>({ mutationFn: (text) => api.post('/admin/roster/preview', { csv: text }) });
  const commit = useAdminMutation((text: string) => api.post<{ counts: RosterPreview['counts']; tempPasswords: IssuedPassword[] }>('/admin/roster/commit', { csv: text }));
  const reset = () => { setCsv(null); preview.reset(); commit.reset(); if (input.current) input.current.value = ''; };

  const choose = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsv({ name: file.name, text });
      commit.reset();
      preview.mutate(text);
    };
    reader.readAsText(file, 'UTF-8');
  };
  const confirm = () => csv && commit.mutate(csv.text, {
    onSuccess: (r) => {
      toast(`Đã nhập: ${r.counts.create} tạo mới, ${r.counts.update} cập nhật`);
      reset();
      if (r.tempPasswords.length) onIssued(r.tempPasswords);
    },
  });
  const p = preview.data;
  const nothingToDo = p && !p.counts.create && !p.counts.update && !p.newDepartments.length && !p.newTeams.length;

  return (
    <section className="card">
      <div className="card-head"><h2>Nhập danh sách nhân sự</h2></div>
      <div className="card-body stack">
        <p className="text-2">
          Tải <a href="/mau-danh-sach-nhan-su.csv" download>file mẫu CSV</a>, thay các dòng ví dụ bằng nhân sự thật, lưu dạng CSV UTF-8 rồi chọn file.
          Vai trò: Sale, Leader, Trưởng phòng, BGĐ hoặc Admin. Sale và Leader ghi cả Phòng ban và Nhóm; Trưởng phòng chỉ ghi Phòng ban; BGĐ và Admin để trống hai cột này.
          Người đã có (cùng email) được cập nhật; người mới nhận mật khẩu tạm.
        </p>
        <Field label="File CSV" htmlFor="roster-file">
          <input id="roster-file" ref={input} type="file" accept=".csv,text/csv" onChange={(e) => choose(e.target.files?.[0])} />
        </Field>
        {preview.isPending && <Loading rows={2} />}
        {preview.error && <FormError error={preview.error} />}
        {commit.error && <FormError error={commit.error} />}
        {p && csv && (
          <>
            <div className="row-wrap">
              <Badge tone="accent">{p.counts.create} tạo mới</Badge>
              <Badge tone="warn">{p.counts.update} cập nhật</Badge>
              <Badge>{p.counts.unchanged} không đổi</Badge>
              {p.errors.length > 0 && <Badge tone="danger">{p.errors.length} lỗi</Badge>}
            </div>
            {p.errors.length > 0 && (
              <Alert tone="danger">
                <div>Sửa các lỗi sau trong file rồi chọn lại:</div>
                <ul>{p.errors.map((e, i) => <li key={i}>{e.line ? `Dòng ${e.line}: ` : ''}{e.message}</li>)}</ul>
              </Alert>
            )}
            {(p.newDepartments.length > 0 || p.newTeams.length > 0) && (
              <Alert tone="info">
                Sẽ tạo mới: {[...p.newDepartments.map((d) => `phòng ban "${d}"`), ...p.newTeams.map((t) => `nhóm "${t.name}" (${t.departmentName})`)].join(', ')}
              </Alert>
            )}
            {p.users.length > 0 && (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Dòng</th><th>Tên</th><th>Vai trò</th><th>Phòng ban / Nhóm</th><th>Kết quả</th></tr></thead>
                  <tbody>
                    {p.users.map((u) => {
                      const [label, tone] = ACTION_LABEL[u.action];
                      return (
                        <tr key={u.email}>
                          <td data-label="Dòng" className="num">{u.line}</td>
                          <td><div className="cell-title">{u.name}</div><div className="cell-sub">{u.email}</div></td>
                          <td data-label="Vai trò">{roleLabel(u.role)}</td>
                          <td data-label="Phòng ban / Nhóm">{[u.departmentName, u.teamName].filter(Boolean).join(' / ') || '—'}</td>
                          <td data-label="Kết quả"><Badge tone={tone}>{label}</Badge>{u.changes.length > 0 && <span className="small muted"> · {u.changes.join(', ')}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row-wrap">
              <button className="btn btn-primary" onClick={confirm} disabled={p.errors.length > 0 || !!nothingToDo || commit.isPending}>
                {commit.isPending ? 'Đang nhập…' : 'Xác nhận nhập'}
              </button>
              <button className="btn" onClick={reset}>Hủy</button>
              {nothingToDo && !p.errors.length && <span className="small muted">Không có thay đổi nào.</span>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Roles that sit outside the department and team structure. */
const NO_PLACEMENT_ROLES: RoleCode[] = ['director', 'admin', 'academic', 'teacher', 'accountant'];

function EditUserDialog({ user, overview, self, onClose }: { user: AdminUser; overview: AdminOverview; self: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, email: user.email, role: user.role, departmentName: user.departmentName ?? '', teamName: user.teamName ?? '' });
  const save = useAdminMutation(() => api.patch(`/admin/users/${user.id}`, {
    version: user.version, name: form.name, email: form.email, role: form.role,
    departmentName: form.departmentName || null, teamName: form.teamName || null,
  }));
  const errors = fieldErrors(save.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const needsDept = !NO_PLACEMENT_ROLES.includes(form.role);
  const needsTeam = form.role === 'sale' || form.role === 'leader';
  const teams = overview.teams.filter((t) => t.departmentName === form.departmentName);
  return (
    <Modal open title={`Sửa ${user.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast('Đã lưu người dùng'); onClose(); } })}>
        {save.isPending ? 'Đang lưu…' : 'Lưu'}
      </button>
    </>}>
      <FormError error={save.error} />
      <Field label="Họ tên" required error={errors.name} htmlFor="u-name"><input id="u-name" value={form.name} onChange={set('name')} /></Field>
      <Field label="Email" required error={errors.email} hint="Đổi email sẽ bỏ liên kết Lark cũ." htmlFor="u-email"><input id="u-email" type="email" value={form.email} onChange={set('email')} /></Field>
      <Field label="Vai trò" required hint={self ? 'Không tự đổi vai trò của mình.' : undefined} htmlFor="u-role">
        <select id="u-role" value={form.role} disabled={self}
          onChange={(e) => { const role = e.target.value as RoleCode; setForm((f) => ({ ...f, role, ...(NO_PLACEMENT_ROLES.includes(role) ? { departmentName: '', teamName: '' } : role === 'head' ? { teamName: '' } : {}) })); }}>
          {ROLES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </Field>
      {needsDept && (
        <Field label="Phòng ban" required htmlFor="u-dept" hint="Phòng ban mới thêm bằng file danh sách.">
          <select id="u-dept" value={form.departmentName} onChange={(e) => setForm((f) => ({ ...f, departmentName: e.target.value, teamName: '' }))}>
            <option value="">— Chọn —</option>
            {overview.departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </Field>
      )}
      {needsTeam && (
        <Field label="Nhóm" required htmlFor="u-team">
          <select id="u-team" value={form.teamName} onChange={set('teamName')} disabled={!form.departmentName}>
            <option value="">— Chọn —</option>
            {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

function StatusDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const toast = useToast();
  const disabling = user.status === 'active';
  const save = useAdminMutation(() => api.post(`/admin/users/${user.id}/status`, { version: user.version, status: disabling ? 'disabled' : 'active' }));
  return (
    <Modal open title={disabling ? `Khóa ${user.name}?` : `Mở khóa ${user.name}?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className={disabling ? 'btn btn-danger' : 'btn btn-primary'} disabled={save.isPending}
        onClick={() => save.mutate(undefined, { onSuccess: () => { toast(disabling ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản'); onClose(); } })}>
        {disabling ? 'Khóa tài khoản' : 'Mở khóa'}
      </button>
    </>}>
      <FormError error={save.error} />
      <p>{disabling ? 'Người này bị đăng xuất ngay, chìa khóa bot bị thu hồi và không đăng nhập được cho đến khi mở khóa. Dữ liệu của họ giữ nguyên.' : 'Người này đăng nhập lại được bằng mật khẩu hiện có.'}</p>
    </Modal>
  );
}

function TempPasswordDialog({ user, self, onClose, onIssued }: { user: AdminUser; self: boolean; onClose: () => void; onIssued: (p: IssuedPassword) => void }) {
  const issue = useAdminMutation(() => api.post<{ password: string; expiresAt: string }>(`/admin/users/${user.id}/temp-password`, { version: user.version }));
  return (
    <Modal open title={`Cấp mật khẩu tạm cho ${user.name}?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-primary" disabled={issue.isPending}
        onClick={() => issue.mutate(undefined, { onSuccess: (r) => onIssued({ name: user.name, email: user.email, ...r }) })}>Cấp mật khẩu tạm</button>
    </>}>
      <FormError error={issue.error} />
      <p>Mật khẩu cũ hết hiệu lực và người này bị đăng xuất. Lần đăng nhập tới họ phải đặt mật khẩu mới.</p>
      {self && <Alert tone="warn">Đây là tài khoản của bạn: bạn sẽ bị đăng xuất ngay và cần mật khẩu tạm này để đăng nhập lại.</Alert>}
    </Modal>
  );
}

/** Passwords live only in this dialog's props; closing it drops them for good. */
function IssuedPasswordsDialog({ items, onClose }: { items: IssuedPassword[]; onClose: () => void }) {
  const toast = useToast();
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Đã sao chép'), () => toast('Không sao chép được, hãy chọn và sao chép tay', 'danger'));
  const download = () => {
    const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const rows = [['Họ tên', 'Email', 'Mật khẩu tạm', 'Hạn dùng'], ...items.map((i) => [i.name, i.email, i.password, fmtDateTime(i.expiresAt, true)])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'mat-khau-tam.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal open title="Mật khẩu tạm vừa cấp" onClose={onClose} footer={<>
      {items.length > 1 && <button className="btn" onClick={download}>Tải file CSV</button>}
      <button className="btn btn-primary" onClick={onClose}>Đã lưu, đóng</button>
    </>}>
      <Alert tone="warn">Mật khẩu chỉ hiện một lần. Đóng hộp này là không xem lại được. Hạn dùng 48 giờ; gửi riêng cho từng người.</Alert>
      <div className="table-wrap">
        <table className="table responsive">
          <thead><tr><th>Tên</th><th>Mật khẩu tạm</th><th>Hạn</th><th><span className="visually-hidden">Sao chép</span></th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.email}>
                <td><div className="cell-title">{i.name}</div><div className="cell-sub">{i.email}</div></td>
                <td data-label="Mật khẩu tạm"><code className="mono">{i.password}</code></td>
                <td data-label="Hạn">{fmtDateTime(i.expiresAt)}</td>
                <td><button className="btn btn-sm" onClick={() => copy(i.password)}>Sao chép</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Stops every write made through the chat bot, including Admin's; web work is unaffected. */
function AgentKillSwitch({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const save = useAdminMutation((next: boolean) => api.put('/admin/agent-kill-switch', { enabled: next }));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Bot ghi dữ liệu</h2><span className="spacer" />
        <Badge tone={enabled ? 'danger' : 'ok'}>{enabled ? 'Đang tạm khóa' : 'Đang mở'}</Badge>
        <button className={enabled ? 'btn btn-sm' : 'btn btn-sm btn-danger'} onClick={() => setConfirming(true)}>{enabled ? 'Mở lại' : 'Tạm khóa bot'}</button>
      </div>
      <div className="card-body small text-2">Khi tạm khóa, mọi lệnh ghi qua bot Lark bị chặn, kể cả của Admin. Bot vẫn đọc được dữ liệu; làm trên web không bị ảnh hưởng.</div>
      {confirming && (
        <Modal open title={enabled ? 'Mở lại cho bot ghi dữ liệu?' : 'Tạm khóa bot ghi dữ liệu?'} onClose={() => setConfirming(false)} footer={<>
          <button className="btn" onClick={() => setConfirming(false)}>Hủy</button>
          <button className={enabled ? 'btn btn-primary' : 'btn btn-danger'} disabled={save.isPending}
            onClick={() => save.mutate(!enabled, { onSuccess: () => { toast(enabled ? 'Đã mở lại bot' : 'Đã tạm khóa bot'); setConfirming(false); } })}>
            {enabled ? 'Mở lại' : 'Tạm khóa'}
          </button>
        </>}>
          <FormError error={save.error} />
          <p>{enabled ? 'Bot sẽ ghi được dữ liệu CRM trở lại theo quyền của từng người.' : 'Mọi lệnh ghi qua bot sẽ bị từ chối ngay cho đến khi mở lại.'}</p>
        </Modal>
      )}
    </section>
  );
}

function RevokeBotDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const toast = useToast();
  const revoke = useAdminMutation(() => api.post(`/admin/users/${user.id}/agent-token/revoke`, {}));
  return (
    <Modal open title={`Thu hồi chìa khóa bot của ${user.name}?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-danger" disabled={revoke.isPending}
        onClick={() => revoke.mutate(undefined, { onSuccess: () => { toast('Đã thu hồi chìa khóa bot'); onClose(); } })}>Thu hồi</button>
    </>}>
      <FormError error={revoke.error} />
      <p>Bot không đọc hay ghi CRM thay người này được nữa cho đến khi cấp chìa khóa mới. Tài khoản web không bị ảnh hưởng.</p>
    </Modal>
  );
}