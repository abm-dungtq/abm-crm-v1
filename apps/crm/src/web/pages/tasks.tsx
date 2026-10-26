import { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { Icon } from '../components/icons';
import { CompleteTaskDialog } from '../components/lead-actions';
import { TaskBoard } from '../components/task-board';
import { PriorityBadge, TaskFormDialog, TaskStatusBadge } from '../components/task-form-dialog';
import { Badge, Empty, ErrorState, Loading, SegmentedControl, StageBadge } from '../components/ui';
import { fmtDateTime, fmtDue } from '../format';
import type { TaskItem } from '../types';

function taskLeadCode(t: TaskItem) {
  if (!t.lead) return <Badge tone="neutral">Việc nội bộ</Badge>;
  if (t.lead.pipeline === 'learner') {
    return <Link to="/learners/$contactId" params={{ contactId: t.lead.contactId }}>{t.lead.code}</Link>;
  }
  return <Link to="/leads/$leadId" params={{ leadId: t.lead.id }}>{t.lead.code}</Link>;
}

const GROUPS = [
  { id: 'overdue', label: 'Quá hạn', tone: 'danger' },
  { id: 'today', label: 'Hôm nay', tone: 'warn' },
  { id: 'upcoming', label: 'Sắp tới', tone: 'neutral' },
  { id: 'nodue', label: 'Chưa đặt hạn', tone: 'neutral' },
] as const;

export function TasksPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const { view, status, mine } = useSearch({ from: '/tasks' });
  const isBoard = view === 'board';
  const completed = status === 'completed';
  const isMine = mine === '1';
  const mineSuffix = isMine ? '&mine=1' : '';

  const q = useApi<TaskItem[]>(
    !isBoard ? `/tasks?status=${completed ? 'completed' : 'open'}${mineSuffix}` : null,
  );
  const inProgressQ = useApi<TaskItem[]>(
    !isBoard && !completed ? `/tasks?status=in_progress${mineSuffix}` : null,
  );

  const [completing, setCompleting] = useState<TaskItem | null>(null);
  const [creating, setCreating] = useState(false);

  const scope = actor.role === 'sale' ? 'Việc được giao cho bạn' : 'Việc của lead và việc nội bộ trong phạm vi bạn quản lý';
  const activeItems = [...(q.data ?? []), ...(inProgressQ.data ?? [])];
  const listItems = completed ? (q.data ?? []) : activeItems;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Việc của tôi</h1>
          <p className="sub">{scope}. Hoàn thành Next Action của lead đang mở phải đặt việc tiếp theo.</p>
        </div>
        <div className="row-wrap" style={{ gap: 10 }}>
          {actor.role !== 'sale' && (
            <button
              type="button"
              className="chip"
              aria-pressed={isMine}
              onClick={() =>
                void navigate({
                  to: '/tasks',
                  search: { view, status, mine: isMine ? undefined : '1' },
                })
              }
            >
              Chỉ việc của tôi
            </button>
          )}
          <SegmentedControl
            ariaLabel="Chế độ hiển thị công việc"
            value={isBoard ? 'board' : 'list'}
            onChange={(nextView) =>
              void navigate({
                to: '/tasks',
                search: { view: nextView, status: nextView === 'board' ? undefined : status, mine },
              })
            }
            options={[
              { value: 'list', label: 'Danh sách' },
              { value: 'board', label: 'Kanban' },
            ]}
          />
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Tạo việc
          </button>
        </div>
      </div>

      {isBoard ? (
        <TaskBoard mine={isMine} />
      ) : (
        <>
          <div className="tabs" role="tablist">
            <Link role="tab" aria-selected={!completed} to="/tasks" search={{ view: view === 'list' ? 'list' : undefined, mine }}>
              Đang mở
            </Link>
            <Link role="tab" aria-selected={completed} to="/tasks" search={{ view: view === 'list' ? 'list' : undefined, status: 'completed', mine }}>
              Đã xong
            </Link>
          </div>
          {(q.isLoading || (!completed && inProgressQ.isLoading)) && <Loading />}
          {(q.error || inProgressQ.error) && (
            <ErrorState
              error={q.error || inProgressQ.error}
              onRetry={() => {
                void q.refetch();
                if (!completed) void inProgressQ.refetch();
              }}
            />
          )}
          {q.data && (!completed ? !inProgressQ.isLoading : true) && listItems.length === 0 && (
            <div className="card">
              <Empty title={completed ? 'Chưa có việc hoàn thành' : 'Không còn việc mở'} icon="check" />
            </div>
          )}
          {q.data && !completed && listItems.length > 0 && (
            <div className="grid">
              {GROUPS.map((g) => {
                const items = listItems.filter((t) => t.bucket === g.id);
                if (!items.length) return null;
                return (
                  <section className="card" key={g.id} aria-labelledby={`g-${g.id}`}>
                    <div className="card-head">
                      <h2 id={`g-${g.id}`}>{g.label}</h2>
                      <Badge tone={g.tone}>{items.length}</Badge>
                    </div>
                    <ul className="list">
                      {items.map((t) => (
                        <li key={t.id} className="row" style={{ alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="row-wrap">
                              <Link to="/tasks/$taskId" params={{ taskId: t.id }} style={{ fontWeight: 500 }}>
                                {t.title}
                              </Link>
                              <PriorityBadge priority={t.priority} />
                              {t.status === 'in_progress' && <TaskStatusBadge status="in_progress" />}
                              {t.isNextAction && <Badge tone="accent">Next Action</Badge>}
                            </div>
                            <div className="small muted" style={{ marginTop: 2 }}>
                              {t.lead ? (
                                <>
                                  {taskLeadCode(t)} · {t.lead.contactName}
                                  {t.lead.accountName ? ` · ${t.lead.accountName}` : ''}
                                </>
                              ) : (
                                <Badge tone="neutral">Việc nội bộ</Badge>
                              )}
                              {actor.role !== 'sale' && ` · ${t.assignee.name}`}
                            </div>
                          </div>
                          <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 6 }}>
                            <span
                              className="small nowrap"
                              style={g.id === 'overdue' ? { color: 'var(--danger)', fontWeight: 500 } : undefined}
                            >
                              {t.dueAt ? fmtDue(t.dueAt) : 'Chưa đặt hạn'}
                            </span>
                            <div className="row">
                              {t.lead && (
                                <span className="hide-sm">
                                  <StageBadge stage={t.lead.stage} pipeline={t.lead.pipeline} />
                                </span>
                              )}
                              <button className="btn btn-sm" onClick={() => setCompleting(t)}>
                                Hoàn thành
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {q.data && completed && listItems.length > 0 && (
            <div className="card">
              <ul className="list">
                {listItems.map((t) => (
                  <li key={t.id}>
                    <div className="row-wrap">
                      <Link to="/tasks/$taskId" params={{ taskId: t.id }} style={{ fontWeight: 500 }}>
                        {t.title}
                      </Link>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      {t.lead ? taskLeadCode(t) : <Badge tone="neutral">Việc nội bộ</Badge>} · xong {fmtDateTime(t.completedAt)}
                      {t.outcome ? ` · ${t.outcome}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />

      {completing && (
        <CompleteTaskDialog
          open
          onClose={() => setCompleting(null)}
          task={completing}
          leadCode={completing.lead?.code ?? 'Việc nội bộ'}
          requiresNext={Boolean(completing.lead && completing.isNextAction && completing.lead.status === 'active')}
        />
      )}
    </>
  );
}
