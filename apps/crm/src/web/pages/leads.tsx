import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ACTIVE_STAGES, sourceLabel, stageLabel } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { AssignDialog } from '../components/lead-actions';
import { Avatar, Empty, ErrorState, HealthBadges, Loading, StageBadge } from '../components/ui';
import { fmtAgo, fmtDue, fmtMoney } from '../format';
import type { LeadItem, Member } from '../types';

const TABS = [
  { id: 'active', label: 'Đang mở', status: 'active' },
  { id: 'queue', label: 'Hàng chờ', status: 'queue' },
  { id: 'won', label: 'Won', status: 'won' },
  { id: 'lost', label: 'Lost', status: 'lost' },
  { id: 'all', label: 'Tất cả', status: '' },
] as const;

export function LeadsPage() {
  const actor = useActor();
  const search = useSearch({ from: '/leads' });
  const navigate = useNavigate({ from: '/leads' });
  const tab = search.tab ?? 'active';
  const [text, setText] = useState(search.q ?? '');
  useEffect(() => {
    const t = setTimeout(() => { if ((search.q ?? '') !== text.trim()) void navigate({ search: (s) => ({ ...s, q: text.trim() || undefined }), replace: true }); }, 250);
    return () => clearTimeout(t);
  }, [text]); // keep URL in sync with the box without a navigation per keystroke

  const all = useApi<LeadItem[]>('/leads');
  const members = useApi<Member[]>(actor.role === 'leader' ? '/team-members' : null);
  const [assigning, setAssigning] = useState<LeadItem | null>(null);
  const status = TABS.find((t) => t.id === tab)?.status ?? '';
  const needle = (search.q ?? '').toLowerCase();
  const rows = (all.data ?? []).filter((l) =>
    (!status || l.status === status)
    && (!search.stage || l.stage === search.stage)
    && (!needle || [l.code, l.contactName, l.account?.name, l.owner?.name, l.needSummary].some((v) => v?.toLowerCase().includes(needle))));
  const countFor = (s: string) => (all.data ?? []).filter((l) => !s || l.status === s).length;
  const visibleTabs = TABS.filter((t) => t.id !== 'queue' || actor.role !== 'sale');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lead</h1>
          <p className="sub">Lead đang mở luôn có Owner + Next Action + hạn (QĐ13).</p>
        </div>
        <Link to="/leads/new" className="btn btn-primary">Tạo lead</Link>
      </div>
      <div className="tabs" role="tablist" aria-label="Trạng thái lead">
        {visibleTabs.map((t) => (
          <Link key={t.id} role="tab" aria-selected={tab === t.id} to="/leads" search={(s) => ({ ...s, tab: t.id })}>
            {t.label}<span className="count">{all.data ? countFor(t.status) : ''}</span>
          </Link>
        ))}
      </div>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="lead-filter" className="visually-hidden">Lọc lead</label>
          <input id="lead-filter" type="search" placeholder="Lọc theo mã, tên khách, công ty, Sale…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 1 200px' }}>
          <label htmlFor="stage-filter" className="visually-hidden">Stage</label>
          <select id="stage-filter" value={search.stage ?? ''} onChange={(e) => void navigate({ search: (s) => ({ ...s, stage: e.target.value || undefined }) })}>
            <option value="">Mọi stage</option>
            {[...ACTIVE_STAGES, 'won', 'lost'].map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        {all.isLoading && <div className="card-body"><Loading /></div>}
        {all.error && <div className="card-body"><ErrorState error={all.error} onRetry={() => all.refetch()} /></div>}
        {all.data && rows.length === 0 && (
          <Empty title={tab === 'queue' ? 'Hàng chờ trống' : 'Không có lead phù hợp'}>
            {tab === 'queue' ? 'Lead mới từ form, website, fanpage sẽ vào đây để Leader giao.' : 'Thử bỏ bớt bộ lọc.'}
          </Empty>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Lead</th><th>Stage</th><th>{tab === 'queue' ? 'Nguồn' : 'Owner'}</th>
                  <th>{tab === 'queue' ? 'Vào lúc' : 'Next Action'}</th><th className="right">Giá trị</th><th className="hide-sm">Cảnh báo</th>
                  {tab === 'queue' && actor.role === 'leader' && <th><span className="visually-hidden">Thao tác</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to="/leads/$leadId" params={{ leadId: l.id }} className="cell-title">{l.contactName}</Link>
                      <div className="cell-sub"><span className="mono">{l.code}</span>{l.account ? ` · ${l.account.name}` : ''}</div>
                    </td>
                    <td data-label="Stage"><StageBadge stage={l.stage} /></td>
                    {tab === 'queue'
                      ? <td data-label="Nguồn">{sourceLabel(l.source)}</td>
                      : <td data-label="Owner">{l.owner ? <span className="row"><Avatar name={l.owner.name} /><span className="truncate">{l.owner.name}</span></span> : <span className="muted">Chưa giao</span>}</td>}
                    {tab === 'queue'
                      ? <td data-label="Vào lúc" className="nowrap">{fmtAgo(l.createdAt)}</td>
                      : <td data-label="Next Action">{l.nextAction ? <><div className="truncate" style={{ maxWidth: 260 }}>{l.nextAction.title}</div><div className="cell-sub" style={l.health.nextActionOverdue ? { color: 'var(--danger)' } : undefined}>{fmtDue(l.nextAction.dueAt)}</div></> : <span className="muted">—</span>}</td>}
                    <td className="right num" data-label="Giá trị">{fmtMoney(l.expectedValue)}</td>
                    <td className="hide-sm"><HealthBadges health={l.health} compact /></td>
                    {tab === 'queue' && actor.role === 'leader' && (
                      <td><button className="btn btn-sm btn-primary" onClick={() => setAssigning(l)}>Giao</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {assigning && (
        <AssignDialog open onClose={() => setAssigning(null)} members={members.data ?? []}
          lead={{ id: assigning.id, code: assigning.code, version: assigning.version, status: assigning.status, ownerId: assigning.owner?.id ?? null }} />
      )}
    </>
  );
}
