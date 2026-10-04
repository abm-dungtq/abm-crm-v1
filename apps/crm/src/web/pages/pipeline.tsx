import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ACTIVE_STAGES, STAGES, stageLabel, type StageCode } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { Icon } from '../components/icons';
import { ChangeStageDialog } from '../components/lead-actions';
import { Avatar, ErrorState, HealthBadges, Loading } from '../components/ui';
import { fmtDue, fmtMoney } from '../format';
import type { LeadItem } from '../types';

export function PipelinePage() {
  const actor = useActor();
  const q = useApi<LeadItem[]>('/leads?status=active');
  const [owner, setOwner] = useState('');
  const [moving, setMoving] = useState<LeadItem | null>(null);
  const leads = (q.data ?? []).filter((l) => !owner || l.owner?.id === owner);
  const owners = [...new Map((q.data ?? []).filter((l) => l.owner).map((l) => [l.owner!.id, l.owner!.name])).entries()];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="sub">Lead đang mở theo stage QĐ1. Thẻ viền đỏ là lead trễ SLA hoặc Next Action quá hạn.</p>
        </div>
        {actor.role !== 'sale' && owners.length > 1 && (
          <div className="field" style={{ minWidth: 200 }}>
            <label htmlFor="owner-filter" className="visually-hidden">Lọc theo Sale</label>
            <select id="owner-filter" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Tất cả Sale</option>
              {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        )}
      </div>
      {q.isLoading && <Loading rows={5} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="board" role="list" aria-label="Các stage">
          {ACTIVE_STAGES.map((stage) => {
            const items = leads.filter((l) => l.stage === stage);
            const sla = STAGES.find((s) => s.code === stage)?.slaWorkingDays;
            return (
              <section className="column" key={stage} role="listitem" aria-label={stageLabel(stage)}>
                <div className="column-head">
                  <div className="title">{stageLabel(stage)}<span className="muted num" style={{ fontWeight: 400 }}>{items.length}</span></div>
                  <div className="meta">{fmtMoney(items.reduce((s, l) => s + (l.expectedValue ?? 0), 0))}{sla ? ` · SLA ${sla} ngày` : ' · SLA liên hệ 4 giờ'}</div>
                </div>
                <div className="column-body">
                  {items.length === 0 && <div className="small muted" style={{ padding: '12px 4px', textAlign: 'center' }}>Trống</div>}
                  {items.map((l) => (
                    <article className="deal-card" key={l.id} data-alert={Boolean(l.health.nextActionOverdue || l.health.stageSla?.state === 'breach' || (l.health.firstContact && l.health.firstContact.state !== 'ok' && l.health.firstContact.state !== 'warn'))}>
                      <div className="row">
                        <span className="mono muted small">{l.code}</span>
                        <span className="spacer" />
                        <span className="num small" style={{ fontWeight: 600 }}>{fmtMoney(l.expectedValue)}</span>
                      </div>
                      <Link to="/leads/$leadId" params={{ leadId: l.id }} className="title">{l.account?.name ?? l.contactName}</Link>
                      {l.account && <span className="small muted truncate">{l.contactName}</span>}
                      <HealthBadges health={l.health} compact />
                      <div className="small text-2" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <Icon name="clock" style={{ width: 14, height: 14, marginTop: 3, flex: 'none' }} />
                        <span>{l.nextAction ? <>{l.nextAction.title} · <span className={l.health.nextActionOverdue ? '' : 'muted'} style={l.health.nextActionOverdue ? { color: 'var(--danger)' } : undefined}>{fmtDue(l.nextAction.dueAt)}</span></> : '—'}</span>
                      </div>
                      <div className="foot">
                        <Avatar name={l.owner?.name} /><span className="truncate">{l.owner?.name}</span>
                        <span className="spacer" />
                        <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setMoving(l)} aria-label={`Đổi stage ${l.code}`} title="Đổi stage"><Icon name="arrow" /></button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {moving && (
        <ChangeStageDialog open onClose={() => setMoving(null)}
          lead={{ id: moving.id, code: moving.code, stage: moving.stage as StageCode, version: moving.version, firstContactAt: moving.firstContactAt }} />
      )}
    </>
  );
}
