import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiFailure, api, useApi } from '../api';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, Modal, SegmentedControl, fieldErrors, useToast } from '../components/ui';
import { fmtDateTime } from '../format';

type TokenScope = 'read' | 'read_tasks';

interface AgentToken {
  id: string;
  label: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** Returned only by create and rotate. Held in component state while the dialog is open, never in the query cache. */
interface IssuedToken {
  id: string;
  token: string;
  mcpUrl: string;
  expiresAt: string;
}

const SCOPE_LABELS: Record<TokenScope, string> = {
  read: 'Chỉ đọc',
  read_tasks: 'Đọc + quản lý việc của tôi',
};

const EXPIRY_DAYS = [30, 90, 180] as const;

/**
 * Ready-to-paste setup for each agent client. `url` is the CRM MCP endpoint and `token` the value just issued.
 * Kept in one place so a client that changes its config format is fixed here only.
 */
export const CLIENT_SNIPPETS = [
  {
    id: 'claude',
    label: 'Claude Code',
    hint: 'Chạy lệnh này trong terminal.',
    code: (url: string, token: string) => `claude mcp add --transport http abm-crm ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: 'codex',
    label: 'Codex',
    hint: 'Thêm vào ~/.codex/config.toml, rồi đặt biến môi trường ABM_CRM_TOKEN (lệnh setx cho Windows) và mở lại terminal.',
    code: (url: string, token: string) =>
      `[mcp_servers.abm-crm]\nurl = "${url}"\nbearer_token_env_var = "ABM_CRM_TOKEN"\n\n# Windows:\nsetx ABM_CRM_TOKEN "${token}"`,
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    hint: 'Thêm vào mcp_config.json.',
    code: (url: string, token: string) =>
      JSON.stringify({ mcpServers: { 'abm-crm': { serverUrl: url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
] as const;

type ClientId = (typeof CLIENT_SNIPPETS)[number]['id'];

const WARNING = 'Agent đọc được mọi hội thoại bạn tham gia (trừ chat riêng đã tắt cho agent đọc), cùng dữ liệu lead và việc bạn được xem. Nội dung sẽ được gửi tới nhà cung cấp AI của agent đó. Không chia sẻ token.';

const preStyle = {
  margin: 0, padding: 10, borderRadius: 8, background: 'var(--surface-2)',
  fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  userSelect: 'all', maxWidth: '100%',
} as const;

/** Lets a segmented control scroll sideways on a phone instead of pushing the page wider. */
const scrollX = { maxWidth: '100%', overflowX: 'auto' } as const;

function CopyButton({ value, label = 'Sao chép' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = () => {
    navigator.clipboard?.writeText(value)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })
      .catch(() => toast('Không sao chép được, hãy chọn và chép tay', 'danger'));
  };
  return <button type="button" className="btn btn-sm" onClick={copy}>{copied ? 'Đã chép' : label}</button>;
}

function IssuedTokenDialog({ issued, onClose }: { issued: IssuedToken | null; onClose: () => void }) {
  const [client, setClient] = useState<ClientId>('claude');
  const snippet = CLIENT_SNIPPETS.find((s) => s.id === client) ?? CLIENT_SNIPPETS[0];
  return (
    <Modal open={issued !== null} title="Token mới" onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Tôi đã lưu token</button>}>
      {issued && (
        <div className="stack">
          <Alert tone="warn">Token chỉ hiện một lần. Đóng hộp này là không xem lại được; khi mất hãy xoay token.</Alert>
          <div className="stack-sm">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>Token</strong>
              <CopyButton value={issued.token} />
            </div>
            <pre style={preStyle}>{issued.token}</pre>
            <span className="small muted">Hết hạn {fmtDateTime(issued.expiresAt, true)}</span>
          </div>
          <div className="stack-sm">
            <div style={scrollX}>
              <SegmentedControl<ClientId> value={client} onChange={setClient} size="sm" ariaLabel="Chọn agent"
                options={CLIENT_SNIPPETS.map((s) => ({ value: s.id, label: s.label }))} />
            </div>
            <span className="small text-2">{snippet.hint}</span>
            <pre style={preStyle}>{snippet.code(issued.mcpUrl, issued.token)}</pre>
            <div><CopyButton value={snippet.code(issued.mcpUrl, issued.token)} label="Sao chép cấu hình" /></div>
          </div>
          <span className="small muted">{WARNING}</span>
        </div>
      )}
    </Modal>
  );
}

function CreateTokenForm({ onIssued }: { onIssued: (issued: IssuedToken) => void }) {
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<TokenScope>('read');
  const [days, setDays] = useState<(typeof EXPIRY_DAYS)[number]>(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const issued = await api.post<IssuedToken>('/agent-tokens', { label: label.trim(), scope, expiresInDays: days });
      setLabel('');
      onIssued(issued);
    } catch (err) {
      setError(err instanceof ApiFailure ? err : new ApiFailure({ code: 'INTERNAL', message: 'Không tạo được token. Thử lại.' }, 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head"><h2>Tạo token</h2></div>
      <form className="card-body stack" onSubmit={(e) => void submit(e)}>
        <Field label="Tên gợi nhớ" required htmlFor="agent-token-label" error={errors.label} hint="Ví dụ: Claude Code trên laptop">
          <input id="agent-token-label" value={label} maxLength={40} required
            onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Quyền">
          <div style={scrollX}>
            <SegmentedControl<TokenScope> value={scope} onChange={setScope} ariaLabel="Quyền của token"
              options={(['read', 'read_tasks'] as const).map((value) => ({ value, label: SCOPE_LABELS[value] }))} />
          </div>
        </Field>
        <Field label="Hạn dùng">
          <SegmentedControl<string> value={String(days)} onChange={(v) => setDays(Number(v) as (typeof EXPIRY_DAYS)[number])} ariaLabel="Hạn dùng"
            options={EXPIRY_DAYS.map((d) => ({ value: String(d), label: `${d} ngày` }))} />
        </Field>
        <Alert tone="info">{WARNING}</Alert>
        <FormError error={Object.keys(errors).length ? null : error} />
        <div><button type="submit" className="btn btn-primary" disabled={busy || !label.trim()}>{busy ? 'Đang tạo…' : 'Tạo token'}</button></div>
      </form>
    </section>
  );
}

export function AgentConnectPage() {
  const client = useQueryClient();
  const toast = useToast();
  const tokens = useApi<AgentToken[]>('/agent-tokens');
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [revoking, setRevoking] = useState<AgentToken | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const refresh = () => client.invalidateQueries({ predicate: (q) => q.queryKey[1] === '/agent-tokens' });

  const showIssued = (value: IssuedToken) => {
    setIssued(value);
    void refresh();
  };

  const rotate = async (token: AgentToken) => {
    setActionError(null);
    setBusyId(token.id);
    try {
      showIssued(await api.post<IssuedToken>(`/agent-tokens/${encodeURIComponent(token.id)}/rotate`));
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (token: AgentToken) => {
    setActionError(null);
    setBusyId(token.id);
    try {
      await api.delete(`/agent-tokens/${encodeURIComponent(token.id)}`);
      setRevoking(null);
      toast('Đã thu hồi token');
      void refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  };

  const now = new Date().toISOString();

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div>
        <h1>Kết nối agent</h1>
        <p className="text-2">
          Tạo token để Claude Code, Codex hoặc Antigravity đọc chat và việc của bạn trong CRM. Không token nào gửi được tin vào chat.
        </p>
      </div>

      <CreateTokenForm onIssued={showIssued} />

      <section className="card">
        <div className="card-head"><h2>Token của tôi</h2></div>
        <FormError error={actionError} />
        {tokens.isLoading && <Loading rows={2} />}
        {tokens.error && <ErrorState error={tokens.error} onRetry={() => tokens.refetch()} />}
        {tokens.data && tokens.data.length === 0 && <Empty title="Chưa có token">Tạo token ở trên để kết nối agent.</Empty>}
        {tokens.data && tokens.data.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Tên</th><th>Quyền</th><th>Tạo lúc</th><th>Dùng lần cuối</th><th>Hết hạn</th><th><span className="visually-hidden">Thao tác</span></th></tr></thead>
              <tbody>
                {tokens.data.map((t) => {
                  const expired = Boolean(t.expiresAt && t.expiresAt <= now);
                  return (
                    <tr key={t.id}>
                      <td><div className="cell-title">{t.label || '—'}</div></td>
                      <td data-label="Quyền">{SCOPE_LABELS[t.scope] ?? t.scope}</td>
                      <td data-label="Tạo lúc">{fmtDateTime(t.createdAt, true)}</td>
                      <td data-label="Dùng lần cuối">{t.lastUsedAt ? fmtDateTime(t.lastUsedAt, true) : 'Chưa dùng'}</td>
                      <td data-label="Hết hạn">
                        {expired ? <Badge tone="danger">Đã hết hạn</Badge> : t.expiresAt ? fmtDateTime(t.expiresAt, true) : '—'}
                      </td>
                      <td>
                        <div className="row-wrap">
                          <button type="button" className="btn btn-sm" disabled={busyId === t.id} onClick={() => void rotate(t)}>Xoay token</button>
                          <button type="button" className="btn btn-sm btn-ghost" disabled={busyId === t.id} onClick={() => setRevoking(t)}>Thu hồi</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <IssuedTokenDialog issued={issued} onClose={() => setIssued(null)} />

      <Modal open={revoking !== null} title="Thu hồi token" onClose={() => setRevoking(null)}
        footer={(
          <>
            <button type="button" className="btn" onClick={() => setRevoking(null)}>Hủy</button>
            <button type="button" className="btn btn-danger" disabled={!revoking || busyId === revoking.id}
              onClick={() => revoking && void revoke(revoking)}>Thu hồi</button>
          </>
        )}>
        <p>Agent đang dùng token “{revoking?.label}” sẽ mất kết nối ngay.</p>
      </Modal>
    </div>
  );
}
