import { useEffect, useId, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import type { CancelTaskInput, CreateTaskInput, UpdateTaskInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { ChatThread } from '../components/chat-thread';
import { Icon } from '../components/icons';
import { roleLabel } from '../components/layout';
import { CompleteTaskDialog } from '../components/lead-actions';
import {
  PRIORITY_OPTIONS,
  PriorityBadge,
  TaskFormDialog,
  TaskStatusBadge,
} from '../components/task-form-dialog';
import {
  Avatar,
  Badge,
  Empty,
  ErrorState,
  Field,
  FormError,
  Loading,
  PipelineBadge,
  StageBadge,
  fieldErrors,
  useToast,
} from '../components/ui';
import { fmtDateTime, fmtDue, fromLocalInput, toLocalInput } from '../format';
import type { DirectoryUser, TaskDetail, TaskPriority } from '../types';

export function TaskDetailPage() {
  const { taskId } = useParams({ from: '/tasks/$taskId' });
  const q = useApi<TaskDetail>(`/tasks/${taskId}`);
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <TaskDetailView task={q.data} />;
}

function TaskDetailView({ task }: { task: TaskDetail }) {
  const actor = useActor();
  const toast = useToast();
  const formId = useId();
  const directory = useApi<DirectoryUser[]>('/directory');
  const updateTask = useCommand<UpdateTaskInput>('updateTask');
  const cancelTask = useCommand<CancelTaskInput>('cancelTask');
  const createSubtask = useCommand<CreateTaskInput, { taskId: string }>('createTask');

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [due, setDue] = useState(task.dueAt ? toLocalInput(new Date(task.dueAt)) : '');
  const [assigneeUserId, setAssigneeUserId] = useState(task.assignee.id);
  const [status, setStatus] = useState<'open' | 'in_progress'>(
    task.status === 'in_progress' ? 'in_progress' : 'open',
  );
  const [memberIds, setMemberIds] = useState<string[]>(task.members.map((m) => m.id));
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskDialogOpen, setSubtaskDialogOpen] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(task.priority);
    setDue(task.dueAt ? toLocalInput(new Date(task.dueAt)) : '');
    setAssigneeUserId(task.assignee.id);
    setStatus(task.status === 'in_progress' ? 'in_progress' : 'open');
    setMemberIds(task.members.map((m) => m.id));
  }, [task]);

  const isOpen = task.status === 'open' || task.status === 'in_progress';
  const canEdit = isOpen && (
    task.kind === 'crm'
    || actor.id === task.createdBy?.id
    || actor.id === task.assignee.id
    || actor.role === 'director'
    || actor.role === 'admin'
  );
  const canCancel = isOpen
    && task.kind === 'internal'
    && (actor.id === task.createdBy?.id || actor.role === 'director' || actor.role === 'admin');

  const currentDueLocal = task.dueAt ? toLocalInput(new Date(task.dueAt)) : '';
  const currentMemberKey = task.members.map((m) => m.id).sort().join(',');
  const nextMemberKey = [...memberIds].sort().join(',');

  const isDirty =
    title.trim() !== task.title
    || description.trim() !== (task.description ?? '')
    || priority !== task.priority
    || due !== currentDueLocal
    || assigneeUserId !== task.assignee.id
    || (task.kind === 'internal' && status !== task.status)
    || (task.kind === 'internal' && nextMemberKey !== currentMemberKey);

  const errors = fieldErrors(updateTask.error);
  const users = directory.data ?? [];

  const toggleMember = (uid: string) => {
    setMemberIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : prev.length < 20 ? [...prev, uid] : prev,
    );
  };

  const handleSave = () => {
    if (!title.trim() || (task.kind === 'crm' && !due)) return;
    updateTask.mutate(
      {
        taskId: task.id,
        expectedVersion: task.version,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        priority,
        dueAt: due ? fromLocalInput(due) : null,
        assigneeUserId,
        ...(task.kind === 'internal' ? { status, memberUserIds: memberIds.filter((id) => id !== assigneeUserId) } : {}),
      },
      {
        onSuccess: () => toast('Đã lưu cập nhật công việc'),
      },
    );
  };

  const handleQuickStatus = (nextStatus: 'open' | 'in_progress') => {
    updateTask.mutate(
      { taskId: task.id, expectedVersion: task.version, status: nextStatus },
      {
        onSuccess: () => toast(nextStatus === 'in_progress' ? 'Đã chuyển sang Đang làm' : 'Đã chuyển về Cần làm'),
      },
    );
  };

  const handleCancel = () => {
    cancelTask.mutate(
      { taskId: task.id, expectedVersion: task.version },
      {
        onSuccess: () => toast('Đã hủy công việc'),
      },
    );
  };

  const handleQuickSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = subtaskTitle.trim();
    if (!trimmed || createSubtask.isPending) return;
    createSubtask.mutate(
      {
        kind: 'internal',
        parentTaskId: task.id,
        title: trimmed,
        priority: 'normal',
        assigneeUserId: actor.id,
        memberUserIds: [],
      },
      {
        onSuccess: () => {
          setSubtaskTitle('');
          toast('Đã thêm việc con');
        },
      },
    );
  };

  return (
    <>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small">
            <Link to="/tasks">Công việc</Link>
            {task.parent && (
              <>
                {' / '}
                <Link to="/tasks/$taskId" params={{ taskId: task.parent.id }}>
                  {task.parent.title}
                </Link>
              </>
            )}
            {' / '}
            <span className="muted">Chi tiết</span>
          </div>
          <h1 className="truncate">{task.title}</h1>
          <div className="row-wrap" style={{ marginTop: 6 }}>
            {task.kind === 'internal' ? (
              <Badge tone="neutral">Việc nội bộ</Badge>
            ) : (
              <Badge tone="info">Việc gắn lead</Badge>
            )}
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.isNextAction && <Badge tone="accent">Next Action</Badge>}
          </div>
        </div>

        <div className="row-wrap">
          {isOpen && task.kind === 'internal' && canEdit && (
            <button
              type="button"
              className="btn"
              disabled={updateTask.isPending}
              onClick={() => handleQuickStatus(task.status === 'in_progress' ? 'open' : 'in_progress')}
            >
              {task.status === 'in_progress' ? 'Chuyển về Cần làm' : 'Bắt đầu làm'}
            </button>
          )}
          {isOpen && (
            <button type="button" className="btn btn-primary" onClick={() => setCompleting(true)}>
              <Icon name="check" />
              Hoàn thành
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={cancelTask.isPending}
              onClick={handleCancel}
            >
              Hủy việc
            </button>
          )}
        </div>
      </div>

      <div className="cols-main">
        <div className="grid">
          <section className="card" aria-labelledby="detail-h">
            <div className="card-head">
              <h2 id="detail-h">Chi tiết công việc</h2>
              <span className="spacer" />
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!isDirty || !title.trim() || (task.kind === 'crm' && !due) || updateTask.isPending}
                  onClick={handleSave}
                >
                  {updateTask.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
                </button>
              )}
            </div>
            <div className="card-body stack">
              {canEdit ? (
                <>
                  <Field label="Tiêu đề" required error={errors.title} htmlFor={`${formId}-title`}>
                    <input
                      id={`${formId}-title`}
                      type="text"
                      maxLength={200}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </Field>
                  <Field label="Mô tả" error={errors.description} htmlFor={`${formId}-desc`}>
                    <textarea
                      id={`${formId}-desc`}
                      maxLength={5000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Thêm mô tả chi tiết cho công việc…"
                    />
                  </Field>
                  <div className="grid-2">
                    <Field label="Độ ưu tiên" htmlFor={`${formId}-priority`} error={errors.priority}>
                      <select
                        id={`${formId}-priority`}
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as TaskPriority)}
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p.code} value={p.code}>{p.label}</option>
                        ))}
                      </select>
                    </Field>
                    {task.kind === 'internal' ? (
                      <Field label="Trạng thái" htmlFor={`${formId}-status`} error={errors.status}>
                        <select
                          id={`${formId}-status`}
                          value={status}
                          onChange={(e) => setStatus(e.target.value as 'open' | 'in_progress')}
                        >
                          <option value="open">Cần làm</option>
                          <option value="in_progress">Đang làm</option>
                        </select>
                      </Field>
                    ) : (
                      <Field label="Người phụ trách" htmlFor={`${formId}-assignee`} error={errors.assigneeUserId}>
                        <select
                          id={`${formId}-assignee`}
                          value={assigneeUserId}
                          onChange={(e) => setAssigneeUserId(e.target.value)}
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({roleLabel(u.role)})
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                  <div className="grid-2">
                    <Field
                      label="Hạn hoàn thành (giờ Việt Nam)"
                      required={task.kind === 'crm'}
                      error={errors.dueAt}
                      htmlFor={`${formId}-due`}
                    >
                      <div className="row">
                        <input
                          id={`${formId}-due`}
                          type="datetime-local"
                          value={due}
                          required={task.kind === 'crm'}
                          onChange={(e) => setDue(e.target.value)}
                        />
                        {task.kind === 'internal' && due && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDue('')}>
                            Bỏ hạn
                          </button>
                        )}
                      </div>
                    </Field>
                    {task.kind === 'internal' && (
                      <Field label="Người phụ trách" htmlFor={`${formId}-assignee-int`} error={errors.assigneeUserId}>
                        <select
                          id={`${formId}-assignee-int`}
                          value={assigneeUserId}
                          onChange={(e) => {
                            const next = e.target.value;
                            setAssigneeUserId(next);
                            setMemberIds((prev) => prev.filter((id) => id !== next));
                          }}
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({roleLabel(u.role)}{u.teamName ? ` · ${u.teamName}` : ''})
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                  <FormError error={updateTask.error} />
                  <FormError error={cancelTask.error} />
                </>
              ) : (
                <dl className="dl">
                  <dt>Tiêu đề</dt>
                  <dd>{task.title}</dd>
                  <dt>Mô tả</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{task.description || <span className="muted">Không có mô tả</span>}</dd>
                  <dt>Hạn hoàn thành</dt>
                  <dd>{task.dueAt ? fmtDue(task.dueAt) : <span className="muted">Chưa đặt hạn</span>}</dd>
                  {task.outcome && (
                    <>
                      <dt>Kết quả</dt>
                      <dd>{task.outcome}</dd>
                    </>
                  )}
                </dl>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="subtasks-h">
            <div className="card-head">
              <h2 id="subtasks-h">Việc con</h2>
              <Badge tone="neutral">{task.subtasks.length}</Badge>
              <span className="spacer" />
              <button type="button" className="btn btn-sm" onClick={() => setSubtaskDialogOpen(true)}>
                <Icon name="plus" />
                Thêm việc con
              </button>
            </div>
            <div className="card-body stack-sm">
              <form className="row" onSubmit={handleQuickSubtask}>
                <label className="visually-hidden" htmlFor={`${formId}-subtask`}>
                  Tiêu đề việc con mới
                </label>
                <input
                  id={`${formId}-subtask`}
                  type="text"
                  maxLength={200}
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  placeholder="Nhập nhanh tiêu đề việc con…"
                />
                <button
                  type="submit"
                  className="btn btn-sm btn-primary"
                  disabled={!subtaskTitle.trim() || createSubtask.isPending}
                >
                  {createSubtask.isPending ? 'Đang thêm…' : 'Thêm'}
                </button>
              </form>
              <FormError error={createSubtask.error} />
              {task.subtasks.length === 0 ? (
                <Empty title="Chưa có việc con" icon="check" />
              ) : (
                <ul className="list">
                  {task.subtasks.map((st) => (
                    <li key={st.id} className="row" style={{ padding: '8px 4px' }}>
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: st.id }}
                        style={{
                          flex: 1,
                          fontWeight: 500,
                          textDecoration: st.status === 'completed' ? 'line-through' : undefined,
                        }}
                      >
                        {st.title}
                      </Link>
                      <TaskStatusBadge status={st.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="comments-h">
            <div className="card-head">
              <h2 id="comments-h">Bình luận</h2>
            </div>
            <div className="card-body">
              <ChatThread
                listPath={`/tasks/${task.id}/comments`}
                postPath={`/tasks/${task.id}/comments`}
                readPath={`/tasks/${task.id}/comments/read`}
              />
            </div>
          </section>
        </div>

        <div className="grid">
          {task.lead && (
            <section className="card" aria-labelledby="lead-h">
              <div className="card-head">
                <h2 id="lead-h">Lead liên kết</h2>
              </div>
              <div className="card-body stack-sm">
                <div className="row-wrap">
                  <span className="mono" style={{ fontWeight: 600 }}>{task.lead.code}</span>
                  <PipelineBadge pipeline={task.lead.pipeline} />
                  <StageBadge stage={task.lead.stage} pipeline={task.lead.pipeline} />
                </div>
                <div style={{ fontWeight: 600 }}>
                  {task.lead.pipeline === 'learner' ? (
                    <Link to="/learners/$contactId" params={{ contactId: task.lead.contactId }}>
                      {task.lead.contactName}
                    </Link>
                  ) : (
                    <Link to="/leads/$leadId" params={{ leadId: task.lead.id }}>
                      {task.lead.contactName}
                    </Link>
                  )}
                </div>
                {task.lead.accountName && <div className="small muted">{task.lead.accountName}</div>}
                <div className="row-wrap" style={{ marginTop: 4 }}>
                  <Link className="btn btn-sm" to="/leads/$leadId" params={{ leadId: task.lead.id }}>
                    Mở lead {task.lead.code}
                  </Link>
                  {task.lead.pipeline === 'learner' && (
                    <Link className="btn btn-sm btn-ghost" to="/learners/$contactId" params={{ contactId: task.lead.contactId }}>
                      Hồ sơ học viên
                    </Link>
                  )}
                </div>
              </div>
            </section>
          )}

          {task.kind === 'internal' && (
            <section className="card" aria-labelledby="members-h">
              <div className="card-head">
                <h2 id="members-h">Người cùng làm</h2>
                <Badge tone="neutral">{memberIds.length}</Badge>
              </div>
              <div className="card-body stack-sm">
                {task.members.length === 0 ? (
                  <div className="small muted">Chưa có người cùng làm.</div>
                ) : (
                  <div className="row-wrap">
                    {task.members.map((m) => (
                      <span key={m.id} className="badge">
                        <Avatar name={m.name} />
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}
                {canEdit && (
                  <div className="stack-sm" style={{ marginTop: 6 }}>
                    <span className="field-label">Chọn người cùng làm</span>
                    <div className="chips" style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {users
                        .filter((u) => u.id !== assigneeUserId)
                        .map((u) => {
                          const active = memberIds.includes(u.id);
                          return (
                            <button
                              type="button"
                              key={u.id}
                              className="chip"
                              aria-pressed={active}
                              onClick={() => toggleMember(u.id)}
                            >
                              {u.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="meta-h">
            <div className="card-head">
              <h2 id="meta-h">Thông tin</h2>
            </div>
            <div className="card-body">
              <dl className="dl">
                <dt>Phụ trách</dt>
                <dd>
                  <span className="row">
                    <Avatar name={task.assignee.name} />
                    {task.assignee.name}
                  </span>
                </dd>
                <dt>Người tạo</dt>
                <dd>{task.createdBy?.name ?? '—'}</dd>
                <dt>Hạn</dt>
                <dd>{task.dueAt ? fmtDue(task.dueAt) : <span className="muted">Chưa đặt hạn</span>}</dd>
                {task.completedAt && (
                  <>
                    <dt>Hoàn thành</dt>
                    <dd>{fmtDateTime(task.completedAt)}</dd>
                  </>
                )}
                {task.outcome && (
                  <>
                    <dt>Kết quả</dt>
                    <dd>{task.outcome}</dd>
                  </>
                )}
              </dl>
            </div>
          </section>
        </div>
      </div>

      <TaskFormDialog
        open={subtaskDialogOpen}
        onClose={() => setSubtaskDialogOpen(false)}
        parentTask={{ id: task.id, title: task.title }}
      />

      {completing && (
        <CompleteTaskDialog
          open
          onClose={() => setCompleting(false)}
          task={task}
          leadCode={task.lead?.code ?? 'Việc nội bộ'}
          requiresNext={Boolean(task.lead && task.isNextAction && task.lead.status === 'active')}
        />
      )}
    </>
  );
}
