import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, getInboxSettings, listRoster, setOnDuty, updateInboxSettings } from '../api';
import { Icon } from '../components/icons';
import { roleLabel } from '../components/layout';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, fieldErrors, useToast } from '../components/ui';
import { fmtDateTime } from '../format';
import type { AssignMode, InboxSettings, InboxSettingsUpdate, RosterMember } from '../types';

/** Roles the Worker lets change assignment settings and the duty roster. */
export const INBOX_SETTINGS_ROLES: readonly string[] = ['leader', 'admin'];
export const SETTINGS_KEY = ['inbox', 'settings'] as const;
export const ROSTER_KEY = ['inbox', 'roster'] as const;
const SLA_MIN = 1;
const SLA_MAX = 1440;

const ASSIGN_MODES: { value: AssignMode; label: string; hint: string }[] = [
  { value: 'manual', label: 'Thủ công', hint: 'Hội thoại chuyển người để chưa giao; trưởng nhóm giao hoặc sale tự nhận.' },
  { value: 'round_robin', label: 'Lần lượt', hint: 'Hội thoại chuyển người tự giao lần lượt cho người đang trực.' },
];

/** `/inbox/settings`: assignment mode, reply deadline and who is on duty. */
export function InboxSettingsPage() {
  const actor = useActor();
  const allowed = INBOX_SETTINGS_ROLES.includes(actor.role);
  return (
    <div className="inbox-settings">
      <div className="page-head">
        <div>
          <div className="small"><Link to="/inbox">Inbox</Link> / Cài đặt</div>
          <h1>Chia việc Inbox</h1>
          <p className="sub">Cách giao hội thoại khi bot chuyển cho người, hạn trả lời khách và danh sách người trực.</p>
        </div>
      </div>
      {allowed
        ? <div className="stack"><SettingsCard /><RosterCard /></div>
        : <Alert tone="warn">Chỉ Trưởng nhóm và Admin thay đổi cài đặt chia việc.</Alert>}
    </div>
  );
}

function SettingsCard() {
  const client = useQueryClient();
  const toast = useToast();
  const settings = useQuery<InboxSettings, ApiFailure>({ queryKey: SETTINGS_KEY, queryFn: getInboxSettings });
  const [mode, setMode] = useState<AssignMode>('manual');
  const [sla, setSla] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setMode(settings.data.assignMode);
    setSla(String(settings.data.slaMinutes));
  }, [settings.data]);
  const save = useMutation<InboxSettings, ApiFailure, InboxSettingsUpdate>({
    mutationFn: updateInboxSettings,
    onSuccess: () => toast('Đã lưu cài đặt chia việc'),
    onSettled: () => client.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
  const errors = fieldErrors(save.error);
  const minutes = Number(sla);
  const validSla = Number.isInteger(minutes) && minutes >= SLA_MIN && minutes <= SLA_MAX;
  const dirty = settings.data && (mode !== settings.data.assignMode || minutes !== settings.data.slaMinutes);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (validSla) save.mutate({ assignMode: mode, slaMinutes: minutes });
  };

  return (
    <section className="card">
      <div className="card-head"><h2>Cách chia</h2></div>
      {settings.isLoading && <div className="card-body"><Loading rows={2} /></div>}
      {settings.error && <div className="card-body"><ErrorState error={settings.error} onRetry={() => settings.refetch()} /></div>}
      {settings.data && (
        <form className="card-body stack" onSubmit={submit}>
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>Chế độ giao</legend>
            {ASSIGN_MODES.map((m) => (
              <label key={m.value} className="row" style={{ alignItems: 'flex-start' }}>
                <input type="radio" name="assign-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
                <span><strong>{m.label}</strong><span className="small text-2" style={{ display: 'block' }}>{m.hint}</span></span>
              </label>
            ))}
            {errors.assignMode && <span className="field-error" role="alert">{errors.assignMode}</span>}
          </fieldset>
          <Field label="Hạn trả lời (phút)" required htmlFor="inbox-sla"
            error={errors.slaMinutes ?? (sla && !validSla ? `Từ ${SLA_MIN} đến ${SLA_MAX} phút` : undefined)}
            hint="Quá hạn mà nhân viên chưa trả lời khách thì nhắc trên Lark.">
            <input id="inbox-sla" type="number" inputMode="numeric" min={SLA_MIN} max={SLA_MAX} step={1} required value={sla}
              aria-invalid={Boolean(errors.slaMinutes) || (Boolean(sla) && !validSla)} onChange={(e) => setSla(e.target.value)} style={{ maxWidth: 160 }} />
          </Field>
          <FormError error={save.error && !Object.keys(errors).length ? save.error : null} />
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary" disabled={!dirty || !validSla || save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</button>
            {settings.data.updatedAt && <span className="small muted">Cập nhật lần cuối {fmtDateTime(settings.data.updatedAt)}</span>}
          </div>
        </form>
      )}
    </section>
  );
}

function RosterCard() {
  const client = useQueryClient();
  const toast = useToast();
  const roster = useQuery<RosterMember[], ApiFailure>({ queryKey: ROSTER_KEY, queryFn: listRoster });
  const duty = useMutation<{ userId: string; onDuty: boolean }, ApiFailure, { userId: string; onDuty: boolean; name: string }>({
    mutationFn: ({ userId, onDuty }) => setOnDuty(userId, onDuty),
    onSuccess: (r, v) => toast(r.onDuty ? `${v.name} đang trực` : `${v.name} nghỉ trực`),
    onSettled: () => client.invalidateQueries({ queryKey: ROSTER_KEY }),
  });
  const onDuty = roster.data?.filter((m) => m.onDuty).length ?? 0;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Người trực</h2>
        <span className="spacer" />
        {roster.data && <span className="small muted">{onDuty} người đang trực</span>}
      </div>
      {roster.isLoading && <div className="card-body"><Loading rows={3} /></div>}
      {roster.error && <div className="card-body"><ErrorState error={roster.error} onRetry={() => roster.refetch()} /></div>}
      {duty.error && <div className="card-body"><FormError error={duty.error} /></div>}
      {roster.data && !roster.data.length && <Empty title="Chưa có nhân viên Inbox đang hoạt động" icon="leads" />}
      {!!roster.data?.length && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Trực</th><th>Giao lần cuối</th></tr></thead>
            <tbody>
              {roster.data.map((m) => (
                <tr key={m.userId}>
                  <td data-label="Nhân viên"><div className="cell-title">{m.displayName}</div></td>
                  <td data-label="Vai trò">{roleLabel(m.role)}</td>
                  <td data-label="Trực">
                    {m.roundRobin ? (
                      <button className="btn btn-sm" aria-pressed={m.onDuty} disabled={duty.isPending}
                        aria-label={`${m.onDuty ? 'Cho nghỉ trực' : 'Xếp trực'} ${m.displayName}`}
                        onClick={() => duty.mutate({ userId: m.userId, onDuty: !m.onDuty, name: m.displayName })}>
                        <Badge tone={m.onDuty ? 'ok' : 'neutral'} dot>{m.onDuty ? 'Đang trực' : 'Nghỉ'}</Badge>
                      </button>
                    ) : <span className="small muted" title="Chỉ Sale và Trưởng nhóm được chia lần lượt">Không chia lần lượt</span>}
                  </td>
                  <td data-label="Giao lần cuối" className="nowrap">{m.lastAssignedAt ? fmtDateTime(m.lastAssignedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-body small text-2 row"><Icon name="info" />Chế độ “Lần lượt” chọn người đang trực được giao lâu nhất trước.</div>
    </section>
  );
}
