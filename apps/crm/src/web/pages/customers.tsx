import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { activityLabel } from '@abm/contracts';
import { useApi } from '../api';
import { Icon } from '../components/icons';
import { Avatar, Badge, Empty, ErrorState, Loading, StageBadge } from '../components/ui';
import { fmtAgo, fmtDateTime, fmtDue, fmtMoney } from '../format';
import type { AccountDetail, AccountItem } from '../types';

export function CustomersPage() {
  const [q, setQ] = useState('');
  const list = useApi<AccountItem[]>('/accounts');
  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle) || (a.taxCode ?? '').includes(needle));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Khách hàng 360</h1>
          <p className="sub">Doanh nghiệp có lead trong phạm vi của bạn. Customer 360 là góc nhìn tổng hợp Account, Contact, Lead và hoạt động.</p>
        </div>
      </div>
      <div className="field" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label htmlFor="acc-filter" className="visually-hidden">Lọc khách hàng</label>
        <input id="acc-filter" type="search" placeholder="Lọc theo tên công ty, mã số thuế…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        {list.isLoading && <div className="card-body"><Loading /></div>}
        {list.error && <div className="card-body"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
        {list.data && rows.length === 0 && <Empty title="Không có khách hàng" icon="building" />}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Khách hàng</th><th>Ngành · Tỉnh</th><th className="right">Lead mở</th><th className="right">Pipeline</th><th className="right">Đã thắng</th><th>Phụ trách</th><th>Hoạt động gần nhất</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to="/customers/$accountId" params={{ accountId: a.id }} className="cell-title">{a.name}</Link>
                      <div className="cell-sub">{a.taxCode ? <>MST <span className="mono">{a.taxCode}</span></> : 'Chưa có MST'}</div>
                    </td>
                    <td data-label="Ngành">{[a.industry, a.city].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="right num" data-label="Lead mở">{a.openCount} / {a.leadCount}</td>
                    <td className="right num" data-label="Pipeline">{fmtMoney(a.pipelineValue)}</td>
                    <td className="right num" data-label="Đã thắng">{a.wonValue ? fmtMoney(a.wonValue) : '—'}</td>
                    <td data-label="Phụ trách">{a.owners ?? '—'}</td>
                    <td data-label="Gần nhất" className="nowrap">{fmtAgo(a.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function AccountDetailPage() {
  const { accountId } = useParams({ from: '/customers/$accountId' });
  const q = useApi<AccountDetail>(`/accounts/${accountId}`);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { account, contacts, leads, activities } = q.data;
  const open = leads.filter((l) => l.status === 'active' || l.status === 'queue');
  const won = leads.filter((l) => l.status === 'won');
  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="small"><Link to="/customers">Khách hàng 360</Link></div>
          <h1>{account.name}</h1>
          <div className="row-wrap small text-2" style={{ marginTop: 4 }}>
            {account.taxCode && <span>MST <span className="mono">{account.taxCode}</span></span>}
            {account.industry && <span>· {account.industry}</span>}
            {account.city && <span>· {account.city}</span>}
          </div>
        </div>
      </div>
      <div className="kpis">
        <div className="card kpi"><span className="kpi-label">Lead đang mở</span><span className="kpi-value">{open.length}</span></div>
        <div className="card kpi"><span className="kpi-label">Pipeline</span><span className="kpi-value">{fmtMoney(open.reduce((s, l) => s + (l.expectedValue ?? 0), 0))}</span></div>
        <div className="card kpi"><span className="kpi-label">Đã thắng</span><span className="kpi-value">{fmtMoney(won.reduce((s, l) => s + (l.expectedValue ?? 0), 0))}</span><span className="kpi-note">{won.length} lead Won</span></div>
        <div className="card kpi"><span className="kpi-label">Đầu mối</span><span className="kpi-value">{contacts.length}</span></div>
      </div>
      <div className="cols-main">
        <div className="grid">
          <section className="card" aria-labelledby="acc-leads">
            <div className="card-head"><h2 id="acc-leads">Lead &amp; cơ hội</h2></div>
            <ul className="list">
              {leads.map((l) => (
                <li key={l.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row"><span className="mono muted small">{l.code}</span><Link to="/leads/$leadId" params={{ leadId: l.id }} className="truncate cell-title">{l.needSummary}</Link></div>
                    <div className="small muted">{l.owner?.name ?? 'Hàng chờ'}{l.nextAction ? ` · Next: ${l.nextAction.title} (${fmtDue(l.nextAction.dueAt)})` : ''}</div>
                  </div>
                  <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 4 }}><StageBadge stage={l.stage} /><span className="num small">{fmtMoney(l.expectedValue)}</span></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="card" aria-labelledby="acc-tl">
            <div className="card-head"><h2 id="acc-tl">Dòng thời gian</h2></div>
            <div className="card-body">
              {activities.length === 0 ? <Empty title="Chưa có hoạt động" /> : (
                <ol className="timeline">
                  {activities.map((a) => (
                    <li key={a.id}>
                      <span className="tl-icon"><Icon name="note" /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="row-wrap"><strong style={{ fontWeight: 600 }}>{activityLabel(a.type)}</strong>
                          {a.leadId && <Link to="/leads/$leadId" params={{ leadId: a.leadId }} className="mono small">{a.leadCode}</Link>}
                          <span className="tl-meta">{a.actorName ?? 'Hệ thống'} · {fmtDateTime(a.occurredAt)}</span></div>
                        <p className="text-2" style={{ overflowWrap: 'anywhere' }}>{a.summary}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>
        <div className="grid">
          <section className="card" aria-labelledby="acc-contacts">
            <div className="card-head"><h2 id="acc-contacts">Đầu mối liên hệ</h2></div>
            <ul className="list">
              {contacts.map((c) => (
                <li key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <Avatar name={c.name} size="lg" />
                  <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                    <div className="row-wrap"><strong>{c.name}</strong>{c.isPrimary && <Badge tone="accent">Chính</Badge>}</div>
                    {c.jobTitle && <span className="small muted">{c.jobTitle}</span>}
                    {c.points.map((p) => <a key={p.value} className="small truncate" href={p.type === 'phone' ? `tel:${p.value}` : `mailto:${p.value}`}>{p.value}</a>)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <div className="card-body small text-2">Hợp đồng, quyền lợi, thanh toán và CSKH sẽ hiện ở đây từ MVP2–MVP4. Thanh toán thực thu lấy từ MISA (chỉ đọc).</div>
          </section>
        </div>
      </div>
    </>
  );
}
