import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ACTIVE_STAGES, LEARNER_STAGES, STAGES, learnerStageLabel, stageLabel, type LearnerStageCode, type StageCode } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { Icon } from '../components/icons';
import { ChangeStageDialog } from '../components/lead-actions';
import { Avatar, Badge, ErrorState, HealthBadges, Loading, SegmentedControl } from '../components/ui';
import { fmtDue, fmtMoney } from '../format';
import type { LeadItem } from '../types';

const ACTIVE_LEARNER_STAGES: LearnerStageCode[] = ['new', 'contacted', 'qualified', 'trial_booked', 'trial_done'];

export function PipelinePage() {
  const actor = useActor();
  const [pipeline, setPipeline] = useState<'b2b' | 'learner'>('b2b');
  const q = useApi<LeadItem[]>(`/leads?status=active&stage=${pipeline}`);
  const [owner, setOwner] = useState('');
  const [moving, setMoving] = useState<LeadItem | null>(null);
  const allForPipeline = (q.data ?? []).filter((l) => (l.pipeline ?? 'b2b') === pipeline);
  const leads = allForPipeline.filter((l) => !owner || l.owner?.id === owner);
  const owners = [...new Map(allForPipeline.filter((l) => l.owner).map((l) => [l.owner!.id, l.owner!.name])).entries()];
  const stages = pipeline === 'learner' ? ACTIVE_LEARNER_STAGES : ACTIVE_STAGES;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="sub">
            {pipeline === 'learner'
              ? 'Lead học viên đang mở theo giai đoạn tư vấn & học thử. Thẻ viền đỏ là lead trễ SLA hoặc Next Action quá hạn.'
              : 'Lead B2B đang mở theo stage QĐ1. Thẻ viền đỏ là lead trễ SLA hoặc Next Action quá hạn.'}
          </p>
        </div>
        <div className="row-wrap" style={{ gap: 10 }}>
          <SegmentedControl
            ariaLabel="Chọn luồng pipeline"
            value={pipeline}
            onChange={(next) => { setPipeline(next); setOwner(''); }}
            options={[
              { value: 'b2b', label: 'B2B' },
              { value: 'learner', label: 'Học viên' },
            ]}
          />
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
      </div>
      {q.isLoading && <Loading rows={5} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="board" role="list" aria-label="Các stage">
          {stages.map((stage) => {
            const items = leads.filter((l) => l.stage === stage);
            const sla = pipeline === 'b2b' ? STAGES.find((s) => s.code === stage)?.slaWorkingDays : null;
            const title = pipeline === 'learner' ? learnerStageLabel(stage) : stageLabel(stage);
            return (
              <section className="column" key={stage} role="listitem" aria-label={title}>
                <div className="column-head">
                  <div className="title">{title}<span className="muted num" style={{ fontWeight: 400 }}>{items.length}</span></div>
                  <div className="meta">
                    {pipeline === 'b2b' ? `${fmtMoney(items.reduce((s, l) => s + (l.expectedValue ?? 0), 0))} · ` : ''}
                    {sla ? `SLA ${sla} ngày` : 'SLA liên hệ 4 giờ'}
                  </div>
                </div>
                <div className="column-body">
                  {items.length === 0 && <div className="small muted" style={{ padding: '12px 4px', textAlign: 'center' }}>Trống</div>}
                  {items.map((l) => {
                    const program = [l.productName, l.courseName].filter(Boolean).join(' · ');
                    return (
                      <article
                        className="deal-card"
                        key={l.id}
                        data-alert={Boolean(
                          l.health.nextActionOverdue
                          || l.health.stageSla?.state === 'breach'
                          || (l.health.firstContact && l.health.firstContact.state !== 'ok' && l.health.firstContact.state !== 'warn'),
                        )}
                      >
                        <div className="row">
                          <span className="mono muted small">{l.code}</span>
                          <span className="spacer" />
                          {pipeline === 'b2b' ? (
                            <span className="num small" style={{ fontWeight: 600 }}>{fmtMoney(l.expectedValue)}</span>
                          ) : (
                            program && <Badge tone="agent">{program}</Badge>
                          )}
                        </div>
                        {pipeline === 'learner' && l.contactId ? (
                          <Link to="/learners/$contactId" params={{ contactId: l.contactId }} className="title">{l.contactName}</Link>
                        ) : (
                          <Link to="/leads/$leadId" params={{ leadId: l.id }} className="title">{l.account?.name ?? l.contactName}</Link>
                        )}
                        {l.account && <span className="small muted truncate">{l.contactName}</span>}
                        {pipeline === 'b2b' && program && <span className="small muted truncate">{program}</span>}
                        <HealthBadges health={l.health} compact />
                        <div className="small text-2" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                          <Icon name="clock" style={{ width: 14, height: 14, marginTop: 3, flex: 'none' }} />
                          <span>{l.nextAction ? <>{l.nextAction.title} · <span className={l.health.nextActionOverdue ? '' : 'muted'} style={l.health.nextActionOverdue ? { color: 'var(--danger)' } : undefined}>{fmtDue(l.nextAction.dueAt)}</span></> : '—'}</span>
                        </div>
                        <div className="foot">
                          <Avatar name={l.owner?.name} /><span className="truncate">{l.owner?.name}</span>
                          <span className="spacer" />
                          {pipeline === 'b2b' ? (
                            <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setMoving(l)} aria-label={`Đổi stage ${l.code}`} title="Đổi stage"><Icon name="arrow" /></button>
                          ) : (
                            l.contactId && (
                              <Link to="/learners/$contactId" params={{ contactId: l.contactId }} className="btn btn-sm btn-ghost icon-btn" title="Mở hồ sơ học viên">
                                <Icon name="arrow" />
                              </Link>
                            )
                          )}
                        </div>
                      </article>
                    );
                  })}
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
