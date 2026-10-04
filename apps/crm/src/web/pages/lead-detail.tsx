import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ACTIVE_STAGES, activityLabel, lostReasonLabel, sourceLabel, stageLabel, ACTIVITY_TYPES, type StageCode } from '@abm/contracts';
import { useApi } from '../api';
import { Icon, type IconName } from '../components/icons';
import {
  AssignDialog, ChangeStageDialog, CompleteTaskDialog, DecideButtons, LogActivityForm, ReleaseDialog, RequestOwnerDialog, approvalTitle,
} from '../components/lead-actions';
import { Avatar, Badge, Empty, ErrorState, HealthBadges, Loading, StageBadge, StatusBadge } from '../components/ui';
import { fmtDateTime, fmtDue, fmtHours, fmtMoney } from '../format';
import type { AuditItem, LeadDetail, LeadTask } from '../types';

const ACTIVITY_ICON: Record<string, IconName> = {
  call: 'phone', meeting: 'meeting', email: 'mail', message: 'message', customer_reply: 'message', file_sent: 'file',
  proposal_sent: 'file', note: 'note', stage_changed: 'arrow', owner_changed: 'swap', task_completed: 'check',
};

export function LeadDetailPage() {
  const { leadId } = useParams({ from: '/leads/$leadId' });
  const q = useApi<LeadDetail>(`/leads/${leadId}`);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <LeadView detail={q.data} />;
}

type DialogName = 'stage' | 'assign' | 'release' | 'request' | null;

function LeadView({ detail }: { detail: LeadDetail }) {
  const { lead, permissions: can } = detail;
  const [dialog, setDialog] = useState<DialogName>(null);
  const [completing, setCompleting] = useState<LeadTask | null>(null);
  const nextTask = detail.tasks.find((t) => t.id === lead.nextAction?.id);
  const openTasks = detail.tasks.filter((t) => t.status === 'open' && t.id !== lead.nextAction?.id);
  const doneTasks = detail.tasks.filter((t) => t.status !== 'open');
  const pendingApprovals = detail.approvals.filter((a) => a.status === 'pending');
  const leadRef = { id: lead.id, code: lead.code, version: lead.version, status: lead.status, ownerId: lead.owner?.id ?? null };

  return (
    <>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small"><Link to="/leads">Lead</Link> / <span className="mono">{lead.code}</span></div>
          <h1 className="truncate">{lead.contactName}</h1>
          <div className="row-wrap" style={{ marginTop: 6 }}>
            <StatusBadge status={lead.status} />
            <StageBadge stage={lead.stage} />
            {lead.account && <Link to="/customers/$accountId" params={{ accountId: lead.account.id }} className="row small"><Icon name="building" style={{ width: 14, height: 14 }} />{lead.account.name}</Link>}
            <span className="small muted">Nguồn: {sourceLabel(lead.source)}</span>
          </div>
        </div>
        <div className="row-wrap">
          {can.assign && <button className="btn" onClick={() => setDialog('assign')}><Icon name="swap" />{lead.status === 'queue' ? 'Giao lead' : 'Phân lại'}</button>}
          {can.release && <button className="btn btn-danger" onClick={() => setDialog('release')}>Nhả về hàng chờ</button>}
          {can.requestOwnerChange && <button className="btn" onClick={() => setDialog('request')}><Icon name="swap" />Yêu cầu chuyển owner</button>}
          {can.changeStage && can.transitions.length > 0 && <button className="btn btn-primary" onClick={() => setDialog('stage')}>Đổi stage<Icon name="arrow" /></button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <Stepper stage={lead.stage} />
        </div>
      </div>

      {lead.status === 'queue' && (
        <div className="alert" data-tone="info" style={{ marginBottom: 16 }}>
          <Icon name="info" /><span>Lead đang ở hàng chờ phòng ban, chưa có owner. Leader giao thủ công; sau khi giao, Next Action “Liên hệ lần đầu” được tạo với hạn 4 giờ làm việc.</span>
        </div>
      )}
      {lead.status === 'lost' && (
        <div className="alert" data-tone="danger" style={{ marginBottom: 16 }}>
          <Icon name="x" /><span>Lost — {lostReasonLabel(lead.lostReason)}{lead.lostNote ? `: ${lead.lostNote}` : ''} · {fmtDateTime(lead.closedAt)}</span>
        </div>
      )}
      {lead.status === 'won' && (
        <div className="alert" data-tone="ok" style={{ marginBottom: 16 }}>
          <Icon name="trophy" /><span>Won · {fmtMoney(lead.expectedValue, false)}{lead.wonNote ? ` · ${lead.wonNote}` : ''} · {fmtDateTime(lead.closedAt)}</span>
        </div>
      )}

      <div className="cols-main">
        <div className="grid">
          {lead.status === 'active' && (
            <section className="card next-action" data-overdue={lead.health.nextActionOverdue} aria-labelledby="na-h">
              <div className="card-body stack-sm">
                <span className="label" id="na-h">{lead.health.nextActionOverdue ? 'Next Action quá hạn' : 'Next Action'}</span>
                <div className="what">{lead.nextAction?.title}</div>
                <div className="row-wrap small text-2">
                  <span className="row"><Icon name="clock" style={{ width: 14, height: 14 }} />{fmtDue(lead.nextAction?.dueAt)}</span>
                  <span className="row"><Avatar name={lead.owner?.name} />{lead.owner?.name}</span>
                </div>
                {nextTask && can.completeTask && (
                  <div className="row-wrap" style={{ marginTop: 4 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => setCompleting(nextTask)}><Icon name="check" />Hoàn thành &amp; đặt việc tiếp</button>
                  </div>
                )}
              </div>
            </section>
          )}

          {pendingApprovals.length > 0 && (
            <section className="card" aria-labelledby="ap-h">
              <div className="card-head"><h2 id="ap-h">Đang chờ duyệt</h2></div>
              <ul className="list">
                {pendingApprovals.map((a) => (
                  <li key={a.id} className="stack-sm">
                    <div className="row-wrap">
                      {a.requestedByKind === 'agent' ? <Badge tone="agent"><Icon name="bot" style={{ width: 12, height: 12 }} />Agent đề xuất</Badge> : <Badge>{a.requester}</Badge>}
                      <strong>{approvalTitle(a)}</strong>
                    </div>
                    {a.reason && <span className="small text-2">{a.reason}</span>}
                    {a.isStale && <span className="small" style={{ color: 'var(--warn)' }}>Lead đã đổi sau khi tạo yêu cầu: duyệt sẽ không thực hiện.</span>}
                    {a.canDecide ? <DecideButtons approval={a} /> : <span className="small muted">Chờ {a.kind === 'owner_change' ? 'Leader của team' : 'owner hoặc Leader'} duyệt</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="act-h">
            <div className="card-head"><h2 id="act-h">Hoạt động</h2><span className="spacer" /><span className="small muted">{detail.activities.length}</span></div>
            {can.logActivity && lead.status === 'active' && (
              <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
                <LogActivityForm leadId={lead.id} version={lead.version} firstContactMissing={!lead.firstContactAt} />
              </div>
            )}
            <div className="card-body">
              {detail.activities.length === 0 ? <Empty title="Chưa có hoạt động" icon="note">Ghi cuộc gọi đầu tiên để tính liên hệ lần đầu.</Empty> : (
                <ol className="timeline">
                  {detail.activities.map((a) => {
                    const contact = ACTIVITY_TYPES.find((t) => t.code === a.type)?.contact;
                    const system = ['stage_changed', 'owner_changed', 'task_completed'].includes(a.type);
                    return (
                      <li key={a.id}>
                        <span className="tl-icon" data-kind={system ? 'system' : contact ? 'contact' : undefined}><Icon name={ACTIVITY_ICON[a.type] ?? 'note'} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="row-wrap"><strong style={{ fontWeight: 600 }}>{activityLabel(a.type)}</strong><span className="tl-meta">{a.actorName ?? 'Hệ thống'} · {fmtDateTime(a.occurredAt)}</span></div>
                          <p className="text-2" style={{ overflowWrap: 'anywhere' }}>{a.summary}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>

        <div className="grid">
          <section className="card" aria-labelledby="info-h">
            <div className="card-head"><h2 id="info-h">Thông tin</h2></div>
            <div className="card-body stack">
              <dl className="dl">
                <dt>Nhu cầu</dt><dd>{lead.needSummary}</dd>
                <dt>Giá trị dự kiến</dt><dd className="num">{fmtMoney(lead.expectedValue, false)}</dd>
                <dt>Owner</dt><dd>{lead.owner ? <span className="row"><Avatar name={lead.owner.name} />{lead.owner.name}</span> : 'Chưa giao'}</dd>
                <dt>Team</dt><dd>{lead.team?.name ?? '—'}</dd>
                {detail.contactPoints.map((p) => (
                  <ContactPoint key={p.type + p.value} type={p.type} value={p.value} />
                ))}
                <dt>Tạo lúc</dt><dd>{fmtDateTime(lead.createdAt)}</dd>
                <dt>Liên hệ đầu</dt><dd>{lead.firstContactAt ? fmtDateTime(lead.firstContactAt) : <span className="muted">Chưa có</span>}</dd>
                <dt>Vào stage</dt><dd>{fmtDateTime(lead.stageEnteredAt)}</dd>
              </dl>
              <SlaPanel detail={detail} />
            </div>
          </section>

          <section className="card" aria-labelledby="tasks-h">
            <div className="card-head"><h2 id="tasks-h">Việc</h2></div>
            {openTasks.length + doneTasks.length === 0 ? <Empty title="Không có việc khác" /> : (
              <ul className="list">
                {openTasks.map((t) => (
                  <li key={t.id} className="row">
                    <div style={{ flex: 1, minWidth: 0 }}><div className="truncate">{t.title}</div><div className="small muted">{fmtDue(t.dueAt)} · {t.assigneeName}</div></div>
                    {can.completeTask && <button className="btn btn-sm" onClick={() => setCompleting(t)}>Xong</button>}
                  </li>
                ))}
                {doneTasks.slice(0, 6).map((t) => (
                  <li key={t.id} className="row">
                    <Icon name={t.status === 'completed' ? 'check' : 'x'} style={{ width: 16, height: 16, color: 'var(--muted)', flex: 'none' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate muted" style={{ textDecoration: 'line-through' }}>{t.title}</div>
                      <div className="small muted">{t.status === 'completed' ? `Xong ${fmtDateTime(t.completedAt)}` : 'Đã hủy'}{t.outcome ? ` · ${t.outcome}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail.audit && <AuditCard items={detail.audit} />}
        </div>
      </div>

      <ChangeStageDialog open={dialog === 'stage'} onClose={() => setDialog(null)} lead={{ id: lead.id, code: lead.code, stage: lead.stage as StageCode, version: lead.version, firstContactAt: lead.firstContactAt }} />
      <AssignDialog open={dialog === 'assign'} onClose={() => setDialog(null)} lead={leadRef} members={detail.teamMembers} />
      <ReleaseDialog open={dialog === 'release'} onClose={() => setDialog(null)} lead={leadRef} />
      <RequestOwnerDialog open={dialog === 'request'} onClose={() => setDialog(null)} lead={leadRef} members={detail.teamMembers} />
      {completing && (
        <CompleteTaskDialog open onClose={() => setCompleting(null)} task={completing} leadCode={lead.code}
          requiresNext={lead.status === 'active' && completing.id === lead.nextAction?.id} />
      )}
    </>
  );
}

function ContactPoint({ type, value }: { type: string; value: string }) {
  return (
    <>
      <dt>{type === 'phone' ? 'Điện thoại' : 'Email'}</dt>
      <dd><a href={type === 'phone' ? `tel:${value}` : `mailto:${value}`}>{value}</a></dd>
    </>
  );
}

function Stepper({ stage }: { stage: string }) {
  const terminal = stage === 'won' || stage === 'lost';
  const current = terminal ? ACTIVE_STAGES.length : ACTIVE_STAGES.indexOf(stage as StageCode);
  return (
    <div className="stepper" role="list" aria-label="Tiến trình stage">
      {ACTIVE_STAGES.map((s, i) => (
        <div key={s} role="listitem" className="step" data-state={i < current ? 'done' : i === current ? 'current' : 'todo'} aria-current={i === current ? 'step' : undefined}>
          <span className="bar" /><span>{stageLabel(s)}</span>
        </div>
      ))}
      <div role="listitem" className="step" data-state={stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : 'todo'} aria-current={terminal ? 'step' : undefined}>
        <span className="bar" /><span>{stage === 'lost' ? 'Lost' : 'Won'}</span>
      </div>
    </div>
  );
}

function SlaPanel({ detail }: { detail: LeadDetail }) {
  const { health, status } = detail.lead;
  if (status !== 'active') return null;
  return (
    <div className="stack-sm">
      <span className="field-label">SLA</span>
      {health.firstContact && (
        <span className="small text-2">Liên hệ lần đầu: đã {fmtHours(health.firstContact.minutes)} làm việc / hạn 4 giờ{health.firstContact.state === 'release' ? ' · Leader có thể nhả' : ''}</span>
      )}
      {health.stageSla && <span className="small text-2">Stage: {health.stageSla.days}/{health.stageSla.limit} ngày làm việc</span>}
      <HealthBadges health={health} />
      {!health.firstContact && !health.stageSla && <span className="small muted">Không áp SLA.</span>}
    </div>
  );
}

const COMMAND_LABEL: Record<string, string> = {
  createLead: 'Tạo lead', assignLead: 'Giao lead', releaseLead: 'Nhả lead', logActivity: 'Ghi hoạt động', completeTask: 'Hoàn thành việc',
  changeStage: 'Đổi stage', requestOwnerChange: 'Yêu cầu chuyển owner', decideApproval: 'Quyết định duyệt',
};
export const commandLabel = (c: string) => COMMAND_LABEL[c] ?? c;

export function AuditDiff({ before, after }: Pick<AuditItem, 'before' | 'after'>) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !['version'].includes(k));
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="diff">
      {keys.map((k) => (
        <div key={k}>{k}: {before && k in before && <del>{show(before[k])}</del>}{before && k in before ? ' → ' : ''}<ins>{show(after?.[k])}</ins></div>
      ))}
    </div>
  );
}

function AuditCard({ items }: { items: AuditItem[] }) {
  return (
    <section className="card" aria-labelledby="audit-h">
      <div className="card-head"><h2 id="audit-h">Audit</h2><span className="spacer" /><Badge tone="warn" title="Quyền xem audit đang PROPOSED trong ma trận quyền v1">Proposed</Badge></div>
      <ul className="list">
        {items.slice(0, 12).map((a) => (
          <li key={a.id} className="stack-sm" style={{ gap: 2 }}>
            <div className="row-wrap"><strong style={{ fontWeight: 600 }}>{commandLabel(a.command)}</strong><span className="small muted">{a.actorName ?? a.actorKind} · {fmtDateTime(a.createdAt, true)}</span></div>
            <AuditDiff before={a.before} after={a.after} />
          </li>
        ))}
      </ul>
    </section>
  );
}
