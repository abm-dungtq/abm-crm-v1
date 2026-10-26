import { useState } from 'react';
import { LEAD_SOURCES, LOST_REASONS, STAGES, WORKDAY, type UpdateOrgBankInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { api, useApi, useCommand } from '../api';
import { roleLabel } from '../components/layout';
import { Alert, Badge, ErrorState, Field, FormError, Loading, fieldErrors, useToast } from '../components/ui';
import type { AdminChatAgent, AdminOverview } from '../types';

interface OrgBank { version: number; bankName: string | null; bankAccountNo: string | null; bankAccountHolder: string | null }

export function AdminPage() {
  const actor = useActor();
  const q = useApi<AdminOverview>(actor.role === 'admin' ? '/admin/overview' : null);
  const bank = useApi<OrgBank>(actor.role === 'admin' ? '/fees/settings' : null);
  const agents = useApi<AdminChatAgent[]>(actor.role === 'admin' ? '/admin/chat-agents' : null);
  if (actor.role !== 'admin') return <Alert tone="warn">Chỉ Admin xem cấu hình.</Alert>;
  return (
    <>
      <div className="page-head">
        <div><h1>Cấu hình</h1><p className="sub">Admin quản trị cấu hình, xem và cập nhật dữ liệu toàn công ty; không duyệt yêu cầu.</p></div>
      </div>
      {bank.isLoading && <Loading />}
      {bank.error && <ErrorState error={bank.error} onRetry={() => bank.refetch()} />}
      {bank.data && <OrgBankForm key={bank.data.version} bank={bank.data} />}
      {agents.isLoading && <Loading />}
      {agents.error && <ErrorState error={agents.error} onRetry={() => agents.refetch()} />}
      {agents.data && <ChatAgentsSection items={agents.data} onChanged={() => void agents.refetch()} />}
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="grid">
          <div className="kpis" style={{ marginBottom: 0 }}>
            <div className="card kpi"><span className="kpi-label">Lead</span><span className="kpi-value">{q.data.counts.leads}</span></div>
            <div className="card kpi"><span className="kpi-label">Bản ghi audit</span><span className="kpi-value">{q.data.counts.audit}</span></div>
            <div className="card kpi"><span className="kpi-label">Outbox chờ gửi</span><span className="kpi-value">{q.data.counts.outboxPending}</span><span className="kpi-note">Chưa có consumer ở bản đánh giá</span></div>
            <div className="card kpi"><span className="kpi-label">Yêu cầu chờ duyệt</span><span className="kpi-value">{q.data.counts.approvalsPending}</span></div>
          </div>
          <div className="cols-2">
            <section className="card">
              <div className="card-head"><h2>Người dùng</h2><span className="spacer" /><Badge>{q.data.users.length}</Badge></div>
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Tên</th><th>Vai trò</th><th>Team</th></tr></thead>
                  <tbody>
                    {q.data.users.map((u) => (
                      <tr key={u.id}><td><div className="cell-title">{u.name}</div><div className="cell-sub">{u.email}</div></td><td data-label="Vai trò">{roleLabel(u.role)}</td><td data-label="Team">{u.teamName ?? u.departmentName ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Stage &amp; SLA (QĐ1)</h2></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Stage</th><th className="right">SLA</th></tr></thead>
                  <tbody>
                    {STAGES.map((s) => (
                      <tr key={s.code}><td>{s.label}</td><td className="right num">{s.code === 'new' ? 'Liên hệ đầu 4 giờ LV; nhả sau 24 giờ LV' : s.slaWorkingDays ? `${s.slaWorkingDays} ngày LV` : 'Kết thúc'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-foot small text-2">Giờ làm việc {WORKDAY.start}–{WORKDAY.end} ({WORKDAY.timeZone}), thứ 2–6. Lịch nghỉ lễ cần cấu hình trước vận hành.</div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Lý do Lost (PRD 10.6)</h2></div>
              <ul className="list">{LOST_REASONS.map((r) => <li key={r.code}>{r.label}{r.code === 'other' && <span className="muted small"> · bắt buộc ghi chú</span>}</li>)}</ul>
            </section>
            <section className="card">
              <div className="card-head"><h2>Nguồn lead đang bật</h2></div>
              <div className="card-body chips">{LEAD_SOURCES.map((s) => <Badge key={s.code} tone="accent">{s.label}</Badge>)}</div>
              <div className="card-head" style={{ borderTop: '1px solid var(--border)' }}><h2>Team</h2></div>
              <ul className="list">{q.data.teams.map((t) => <li key={t.id}>{t.name} <span className="muted small">· {t.departmentName}</span></li>)}</ul>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

function OrgBankForm({ bank }: { bank: OrgBank }) {
  const toast = useToast();
  const [form, setForm] = useState({
    bankName: bank.bankName ?? '', bankAccountNo: bank.bankAccountNo ?? '', bankAccountHolder: bank.bankAccountHolder ?? '',
  });
  const m = useCommand<UpdateOrgBankInput>('updateOrgBank');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate({
    version: bank.version, bankName: form.bankName.trim(), bankAccountNo: form.bankAccountNo.trim(), bankAccountHolder: form.bankAccountHolder.trim(),
  }, { onSuccess: () => toast('Đã lưu tài khoản nhận tiền') });
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h2>Tài khoản nhận tiền</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Ngân hàng" htmlFor="bank-name" required error={errors.bankName}>
          <input id="bank-name" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required maxLength={120} />
        </Field>
        <Field label="Số tài khoản" htmlFor="bank-no" required error={errors.bankAccountNo}>
          <input id="bank-no" value={form.bankAccountNo} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} required maxLength={40} />
        </Field>
        <Field label="Chủ tài khoản" htmlFor="bank-holder" required error={errors.bankAccountHolder}>
          <input id="bank-holder" value={form.bankAccountHolder} onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })} required maxLength={120} />
        </Field>
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
        <button className="btn btn-primary" disabled={m.isPending}>{m.isPending ? 'Đang lưu…' : 'Lưu tài khoản'}</button>
      </form>
    </section>
  );
}

interface ChatAgentForm { displayName: string; dmAgentKey: string; groupAgentKey: string }
const EMPTY_AGENT_FORM: ChatAgentForm = { displayName: '', dmAgentKey: '', groupAgentKey: '' };

/** GoClaw agents that answer in CRM chat: one key for direct chats, one for @mentions in groups and task threads. */
function ChatAgentsSection({ items, onChanged }: { items: AdminChatAgent[]; onChanged: () => void }) {
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChatAgentForm>(EMPTY_AGENT_FORM);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(error);

  const startEdit = (agent: AdminChatAgent) => {
    setEditingId(agent.id);
    setForm({ displayName: agent.displayName, dmAgentKey: agent.dmAgentKey ?? '', groupAgentKey: agent.groupAgentKey ?? '' });
    setError(null);
  };
  const reset = () => { setEditingId(null); setForm(EMPTY_AGENT_FORM); setError(null); };

  const run = async (action: () => Promise<unknown>, message: string, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(message);
      after?.();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const body = { displayName: form.displayName.trim(), dmAgentKey: form.dmAgentKey.trim(), groupAgentKey: form.groupAgentKey.trim() };
    return editingId
      ? run(() => api.patch(`/admin/chat-agents/${editingId}`, body), 'Đã lưu trợ lý', reset)
      : run(() => api.post('/admin/chat-agents', body), 'Đã thêm trợ lý', reset);
  };
  const toggle = (agent: AdminChatAgent) =>
    run(() => api.patch(`/admin/chat-agents/${agent.id}`, { enabled: !agent.enabled }), agent.enabled ? 'Đã tắt trợ lý' : 'Đã bật trợ lý');

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h2>Agent trong chat</h2><span className="spacer" /><Badge>{items.length}</Badge></div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Tên</th><th>Nhắn riêng</th><th>Trong nhóm</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td><div className="cell-title">{a.displayName}</div></td>
                  <td data-label="Nhắn riêng"><code>{a.dmAgentKey ?? '—'}</code></td>
                  <td data-label="Trong nhóm"><code>{a.groupAgentKey ?? '—'}</code></td>
                  <td data-label="Trạng thái"><Badge tone={a.enabled ? 'ok' : 'neutral'}>{a.enabled ? 'Đang bật' : 'Đã tắt'}</Badge></td>
                  <td>
                    <div className="row-wrap">
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => startEdit(a)}>Sửa</button>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void toggle(a)}>{a.enabled ? 'Tắt' : 'Bật'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="small text-2">{editingId ? 'Sửa trợ lý.' : 'Thêm trợ lý.'} Mã agent GoClaw gồm chữ thường, số và dấu gạch ngang; cần ít nhất một mã.</div>
        <Field label="Tên hiển thị" htmlFor="agent-name" required error={errors.displayName}>
          <input id="agent-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required maxLength={80} />
        </Field>
        <Field label="Mã agent nhắn riêng (dùng quyền của người nhắn)" htmlFor="agent-dm" error={errors.dmAgentKey}>
          <input id="agent-dm" value={form.dmAgentKey} onChange={(e) => setForm({ ...form, dmAgentKey: e.target.value })} maxLength={63} placeholder="crm-assistant" />
        </Field>
        <Field label="Mã agent trong nhóm (không có công cụ CRM)" htmlFor="agent-group" error={errors.groupAgentKey}>
          <input id="agent-group" value={form.groupAgentKey} onChange={(e) => setForm({ ...form, groupAgentKey: e.target.value })} maxLength={63} placeholder="crm-group-assistant" />
        </Field>
        <FormError error={error && !Object.keys(errors).length ? error : null} />
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : editingId ? 'Lưu trợ lý' : 'Thêm trợ lý'}</button>
          {editingId && <button type="button" className="btn" disabled={busy} onClick={reset}>Hủy</button>}
        </div>
      </form>
    </section>
  );
}
