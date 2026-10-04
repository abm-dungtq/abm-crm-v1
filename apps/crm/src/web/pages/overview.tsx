import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { stageLabel } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { Alert, Badge, ErrorState, Kpi, Loading } from '../components/ui';
import { fmtAgo, fmtDate, fmtDue, fmtMoney } from '../format';
import type { Overview, OverviewColumn, OverviewPeriod } from '../types';

const PERIODS: { id: OverviewPeriod; label: string }[] = [
  { id: 'month', label: 'Tháng này' },
  { id: 'quarter', label: 'Quý này' },
  { id: 'year', label: 'Năm nay' },
];
const APPROVAL_KIND: Record<string, string> = {
  owner_change: 'Chuyển người phụ trách',
  agent_stage_change: 'Bot đề xuất đổi stage',
  agent_assign: 'Bot đề xuất giao lead',
};
const OUTBOX_STATUS: Record<string, string> = {
  pending: 'Chờ gửi', sent: 'Đã gửi', failed: 'Lỗi', no_recipient: 'Không có người nhận', skipped: 'Bỏ qua',
};
const pct = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const columnLabel = (key: OverviewColumn['key']) => (key === 'queue' ? 'Hàng chờ' : stageLabel(key));

export function OverviewPage() {
  const actor = useActor();
  const allowed = actor.role === 'admin' || actor.role === 'director';
  const [period, setPeriod] = useState<OverviewPeriod>('month');
  const [department, setDepartment] = useState('');
  const q = useApi<Overview>(allowed ? `/overview?period=${period}${department ? `&department=${encodeURIComponent(department)}` : ''}` : null);
  if (!allowed) return <Alert tone="warn">Chỉ Admin và Giám đốc xem trang này.</Alert>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Toàn cảnh</h1>
          <p className="sub">
            Pipeline đang mở là số hiện tại; Won/Lost và tỉ lệ chốt tính từ {q.data ? fmtDate(`${q.data.period.start}T00:00:00+07:00`) : '…'} đến nay.
          </p>
        </div>
        <div className="row-wrap">
          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="ov-period" className="visually-hidden">Kỳ</label>
            <select id="ov-period" value={period} onChange={(e) => setPeriod(e.target.value as OverviewPeriod)}>
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="ov-department" className="visually-hidden">Phòng ban</label>
            <select id="ov-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Tất cả phòng ban</option>
              {(q.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      </div>
      {q.isLoading && <Loading rows={6} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && <OverviewBody data={q.data} />}
    </>
  );
}

function OverviewBody({ data }: { data: Overview }) {
  const { kpi } = data;
  return (
    <>
      {data.truncated && (
        <Alert tone="warn">Đang tính rủi ro và thẻ trên {data.truncated.shown}/{data.truncated.total} lead mới cập nhật nhất; số đếm ở đầu cột vẫn đầy đủ.</Alert>
      )}
      <div className="kpis">
        <Kpi label="Lead đang mở" value={kpi.openLeads} note={`Pipeline ${fmtMoney(kpi.pipelineValue)}`} to="/leads" />
        <Kpi label="Hàng chờ chưa giao" value={kpi.queueLeads} tone={kpi.queueLeads ? 'warn' : undefined} to="/leads" search={{ tab: 'queue' }} />
        <Kpi label="Won" value={kpi.wonCount} note={fmtMoney(kpi.wonValue)} to="/leads" search={{ tab: 'won' }} />
        <Kpi label="Lost" value={kpi.lostCount} note={fmtMoney(kpi.lostValue)} to="/leads" search={{ tab: 'lost' }} />
        <Kpi label="Tỉ lệ chốt" value={pct(kpi.winRate)} note="Won / (Won + Lost)" />
        <Kpi label="Việc quá hạn" value={kpi.overdueTasks} tone={kpi.overdueTasks ? 'danger' : undefined} to="/tasks" />
        <Kpi label="Lead có rủi ro" value={kpi.slaBreaches} note="Trễ SLA hoặc Next Action" tone={kpi.slaBreaches ? 'danger' : undefined} />
        <Kpi label="Chờ duyệt" value={kpi.pendingApprovals} tone={kpi.pendingApprovals ? 'warn' : undefined} to="/approvals" />
        <Kpi label="Bot hôm nay" value={kpi.agentActionsToday} note="Thao tác ghi qua bot" />
      </div>

      <div className="board" role="list" aria-label="Lead theo giai đoạn">
        {data.columns.map((c) => <OverviewColumnView key={c.key} column={c} />)}
      </div>

      <div className="cols-2" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="ov-approvals-h">
          <div className="card-head"><h2 id="ov-approvals-h">Chờ duyệt</h2><span className="spacer" /><Link to="/approvals" className="small">Mở hàng chờ duyệt</Link></div>
          {data.approvals.byKind.length > 0 && (
            <div className="card-body chips">
              {data.approvals.byKind.map((k) => <Badge key={k.kind} tone="warn">{APPROVAL_KIND[k.kind] ?? k.kind}: {k.count}</Badge>)}
            </div>
          )}
          {data.approvals.oldest.length === 0
            ? <div className="card-body small muted">Không có yêu cầu nào đang chờ.</div>
            : (
              <ul className="list">
                {data.approvals.oldest.map((a) => (
                  <li key={a.id} className="row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate">
                        <Link to="/leads/$leadId" params={{ leadId: a.leadId }} className="mono">{a.leadCode}</Link>
                        {' · '}{APPROVAL_KIND[a.kind] ?? a.kind}{a.toStage ? ` → ${stageLabel(a.toStage)}` : ''}
                      </div>
                      <div className="small muted truncate">{a.requester ?? 'Không rõ'}{a.requestedByKind === 'agent' ? ' (bot)' : ''}</div>
                    </div>
                    <span className="small muted nowrap">{fmtAgo(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="card" aria-labelledby="ov-bot-h">
          <div className="card-head">
            <h2 id="ov-bot-h">Bot &amp; Lark</h2><span className="spacer" />
            <Badge tone={data.bot.agentWritesOpen ? 'ok' : 'danger'}>{data.bot.agentWritesOpen ? 'Bot được ghi' : 'Bot đang khóa ghi'}</Badge>
          </div>
          <ul className="list">
            <li className="row"><span style={{ flex: 1 }}>Chìa khóa bot đang dùng</span><span className="num">{data.bot.activeTokens}</span></li>
            <li className="row"><span style={{ flex: 1 }}>Thao tác ghi qua bot (7 ngày)</span><span className="num">{data.bot.agentWrites7d}</span></li>
            {data.bot.outbox.length === 0
              ? <li className="small muted">Chưa có tin nhắn Lark nào.</li>
              : data.bot.outbox.map((o) => (
                <li key={o.status} className="row">
                  <span style={{ flex: 1 }}>Tin nhắn Lark: {OUTBOX_STATUS[o.status] ?? o.status}</span>
                  {o.status === 'failed' && o.count > 0 ? <Badge tone="danger">{o.count}</Badge> : <span className="num">{o.count}</span>}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function OverviewColumnView({ column: c }: { column: OverviewColumn }) {
  const closed = c.key === 'won' || c.key === 'lost';
  const more = c.count - c.leads.length;
  const search = c.key === 'queue' ? { tab: 'queue' as const } : closed ? { tab: c.key as 'won' | 'lost' } : { tab: 'active' as const, stage: c.key };
  return (
    <section className="column" role="listitem" aria-label={columnLabel(c.key)}>
      <div className="column-head">
        <div className="title">
          {columnLabel(c.key)}<span className="muted num" style={{ fontWeight: 400 }}>{c.count}</span>
          {c.atRisk > 0 && <Badge tone="danger" title="Lead có rủi ro">{c.atRisk}</Badge>}
        </div>
        <div className="meta">{fmtMoney(c.value)}</div>
      </div>
      <div className="column-body">
        {c.leads.length === 0 && <div className="small muted" style={{ padding: '12px 4px', textAlign: 'center' }}>Trống</div>}
        {c.leads.map((l) => (
          <article className="deal-card" key={l.id} data-alert={l.risk}>
            <div className="row">
              <span className="mono muted small">{l.code}</span><span className="spacer" />
              <span className="num small" style={{ fontWeight: 600 }}>{fmtMoney(l.value)}</span>
            </div>
            <Link to="/leads/$leadId" params={{ leadId: l.id }} className="title">{l.title}</Link>
            <div className="foot">
              <span className="truncate">{l.ownerName ?? 'Chưa giao'}</span><span className="spacer" />
              <span className="nowrap" style={l.risk ? { color: 'var(--danger)' } : undefined}>
                {closed ? fmtDate(l.closedAt) : l.nextActionDueAt ? fmtDue(l.nextActionDueAt) : ''}
              </span>
            </div>
          </article>
        ))}
        {more > 0 && <Link to="/leads" search={search} className="small" style={{ padding: '4px', textAlign: 'center' }}>+{more} nữa</Link>}
      </div>
    </section>
  );
}
