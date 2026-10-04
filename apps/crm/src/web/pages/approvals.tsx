import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useApi } from '../api';
import { Icon } from '../components/icons';
import { DecideButtons, approvalTitle } from '../components/lead-actions';
import { Badge, Empty, ErrorState, Loading } from '../components/ui';
import { fmtAgo, fmtDateTime } from '../format';
import type { ApprovalItem } from '../types';

const STATUS: Record<string, { label: string; tone: 'ok' | 'danger' | 'warn' | 'info' }> = {
  pending: { label: 'Chờ duyệt', tone: 'info' },
  approved: { label: 'Đã duyệt', tone: 'ok' },
  rejected: { label: 'Từ chối', tone: 'danger' },
  stale: { label: 'Hết hiệu lực', tone: 'warn' },
};

export function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const q = useApi<ApprovalItem[]>('/approvals');
  const rows = (q.data ?? []).filter((a) => (tab === 'pending' ? a.status === 'pending' : a.status !== 'pending'));
  const mine = rows.filter((a) => a.canDecide).length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hàng chờ duyệt</h1>
          <p className="sub">Đổi owner, đổi stage/Won/Lost do agent đề xuất cần người duyệt (ma trận rủi ro). Duyệt chỉ thực hiện khi lead chưa đổi kể từ lúc tạo yêu cầu.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>Chờ duyệt<span className="count">{q.data?.filter((a) => a.status === 'pending').length ?? ''}</span></button>
        <button role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>Đã xử lý</button>
      </div>
      {tab === 'pending' && mine > 0 && <p className="small text-2" style={{ marginBottom: 10 }}>{mine} yêu cầu đang chờ bạn quyết định.</p>}
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && rows.length === 0 && <div className="card"><Empty title={tab === 'pending' ? 'Không có yêu cầu chờ duyệt' : 'Chưa có yêu cầu đã xử lý'} icon="approve" /></div>}
      <div className="grid">
        {rows.map((a) => (
          <article className="card" key={a.id}>
            <div className="card-body stack-sm">
              <div className="row-wrap">
                {a.requestedByKind === 'agent'
                  ? <Badge tone="agent"><Icon name="bot" style={{ width: 12, height: 12 }} />{a.requester} qua bot</Badge>
                  : <Badge>{a.requester}</Badge>}
                <Badge tone={STATUS[a.status]?.tone}>{STATUS[a.status]?.label}</Badge>
                <span className="small muted">{fmtAgo(a.createdAt)}</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{approvalTitle(a)}</div>
              <div className="small"><Link to="/leads/$leadId" params={{ leadId: a.lead.id }} className="mono">{a.lead.code}</Link> · {a.lead.contactName}</div>
              {a.reason && <p className="text-2">{a.reason}</p>}
              {a.payload.evidence && <p className="small text-2" style={{ borderLeft: '3px solid var(--agent)', paddingLeft: 8 }}>Bằng chứng: {a.payload.evidence}</p>}
              {a.isStale && <span className="small" style={{ color: 'var(--warn)' }}>Lead đã thay đổi sau khi tạo yêu cầu: duyệt sẽ đánh dấu hết hiệu lực, không thực hiện.</span>}
              {a.status === 'pending'
                ? (a.canDecide ? <DecideButtons approval={a} /> : <span className="small muted">Chờ {a.kind === 'agent_stage_change' && !['won', 'lost'].includes(a.payload.toStage ?? '') ? 'owner hoặc Leader' : 'Leader của team'} duyệt.</span>)
                : <span className="small muted">{a.decider ?? '—'} · {fmtDateTime(a.decidedAt)}{a.decisionNote ? ` · “${a.decisionNote}”` : ''}</span>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
