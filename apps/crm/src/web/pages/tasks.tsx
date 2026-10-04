import { useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { CompleteTaskDialog } from '../components/lead-actions';
import { Badge, Empty, ErrorState, Loading, StageBadge } from '../components/ui';
import { fmtDateTime, fmtDue } from '../format';
import type { TaskItem } from '../types';

const GROUPS = [
  { id: 'overdue', label: 'Quá hạn', tone: 'danger' },
  { id: 'today', label: 'Hôm nay', tone: 'warn' },
  { id: 'upcoming', label: 'Sắp tới', tone: 'neutral' },
] as const;

export function TasksPage() {
  const actor = useActor();
  const { view } = useSearch({ from: '/tasks' });
  const completed = view === 'completed';
  const q = useApi<TaskItem[]>(`/tasks${completed ? '?status=completed' : ''}`);
  const [completing, setCompleting] = useState<TaskItem | null>(null);
  const scope = actor.role === 'sale' ? 'Việc được giao cho bạn' : 'Việc của lead trong phạm vi bạn quản lý';

  return (
    <>
      <div className="page-head">
        <div><h1>Việc của tôi</h1><p className="sub">{scope}. Hoàn thành Next Action của lead đang mở phải đặt việc tiếp theo.</p></div>
      </div>
      <div className="tabs" role="tablist">
        <Link role="tab" aria-selected={!completed} to="/tasks" search={{}}>Đang mở</Link>
        <Link role="tab" aria-selected={completed} to="/tasks" search={{ view: 'completed' }}>Đã xong</Link>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <div className="card"><Empty title={completed ? 'Chưa có việc hoàn thành' : 'Không còn việc mở'} icon="check" /></div>}
      {q.data && !completed && (
        <div className="grid">
          {GROUPS.map((g) => {
            const items = q.data.filter((t) => t.bucket === g.id);
            if (!items.length) return null;
            return (
              <section className="card" key={g.id} aria-labelledby={`g-${g.id}`}>
                <div className="card-head"><h2 id={`g-${g.id}`}>{g.label}</h2><Badge tone={g.tone}>{items.length}</Badge></div>
                <ul className="list">
                  {items.map((t) => (
                    <li key={t.id} className="row" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-wrap"><span style={{ fontWeight: 500 }}>{t.title}</span>{t.isNextAction && <Badge tone="accent">Next Action</Badge>}</div>
                        <div className="small muted">
                          <Link to="/leads/$leadId" params={{ leadId: t.lead.id }}>{t.lead.code}</Link> · {t.lead.contactName}{t.lead.accountName ? ` · ${t.lead.accountName}` : ''}
                          {actor.role !== 'sale' && ` · ${t.assignee.name}`}
                        </div>
                      </div>
                      <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 6 }}>
                        <span className="small nowrap" style={g.id === 'overdue' ? { color: 'var(--danger)', fontWeight: 500 } : undefined}>{fmtDue(t.dueAt)}</span>
                        <div className="row"><span className="hide-sm"><StageBadge stage={t.lead.stage} /></span><button className="btn btn-sm" onClick={() => setCompleting(t)}>Hoàn thành</button></div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {q.data && completed && q.data.length > 0 && (
        <div className="card">
          <ul className="list">
            {q.data.map((t) => (
              <li key={t.id}>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                <div className="small muted"><Link to="/leads/$leadId" params={{ leadId: t.lead.id }}>{t.lead.code}</Link> · xong {fmtDateTime(t.completedAt)}{t.outcome ? ` · ${t.outcome}` : ''}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {completing && (
        <CompleteTaskDialog open onClose={() => setCompleting(null)} task={completing} leadCode={completing.lead.code}
          requiresNext={completing.isNextAction && completing.lead.status === 'active'} />
      )}
    </>
  );
}
