import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import type { CancelTaskInput, CreateTaskInput, UpdateTaskInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { ChatThread } from '../components/chat-thread';
import { Combobox, MultiCombobox } from '../components/combobox';
import { DateTimeField } from '../components/date-time-field';
import { Icon } from '../components/icons';
import { CompleteTaskDialog } from '../components/lead-actions';
import {
  PriorityBadge,
  PriorityControl,
  TaskFormDialog,
  TaskStatusBadge,
  userOption,
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
  SegmentedControl,
  StageBadge,
  fieldErrors,
  useToast,
} from '../components/ui';
import { fmtDateTime, fmtDue, fromLocalInput, toLocalInput } from '../format';
import { taskSourceLink } from '../chat-task-draft';
import type { DirectoryUser, TaskDetail, TaskPriority, TaskSourceDetail } from '../types';

/** "Tạo từ chat": opens the source thread or message for members of that chat; plain text for everyone else. */
function TaskSourceLink({ source }: { source: TaskSourceDetail }) {
  const navigate = useNavigate();
  if (!source.canOpen) return <span className="muted">Tạo từ chat (bạn không ở trong hội thoại này)</span>;
  const href = taskSourceLink(source);
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // `href` keeps `?thread=` / `?message=` as the search, which `to` would read as part of the path.
        void navigate({ href });
      }}
    >
      {source.conversationTitle ?? 'Mở hội thoại'}
    </a>
  );
}

export function TaskDetailPage() {
  const { taskId } = useParams({ from: '/tasks/$taskId' });
  const q = useApi<TaskDetail>(`/tasks/${taskId}`);
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  // A new key per task: moving to a subtask or the parent starts a fresh form.
  return <TaskDetailView key={q.data.id} task={q.data} />;
}

/** The editable fields of a task, as the form holds them. */
interface TaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  due: string;
  assigneeUserId: string;
  memberIds: string[];
}

const draftOf = (task: TaskDetail): TaskDraft => ({
  title: task.title,
  description: task.description ?? '',
  priority: task.priority,
  due: task.dueAt ? toLocalInput(new Date(task.dueAt)) : '',
  assigneeUserId: task.assignee.id,
  memberIds: task.members.map((m) => m.id),
});

const memberKey = (ids: string[]) => [...ids].sort().join(',');

/**
 * After the task reloads (a status change, someone else's edit, our own save), fields the person has not touched take
 * the new values and fields they changed keep their edits.
 */
function rebaseDraft(draft: TaskDraft, before: TaskDraft, after: TaskDraft): TaskDraft {
  const pick = <T,>(cur: T, was: T, next: T) => (cur === was ? next : cur);
  return {
    title: pick(draft.title, before.title, after.title),
    description: pick(draft.description, before.description, after.description),
    priority: pick(draft.priority, before.priority, after.priority),
    due: pick(draft.due, before.due, after.due),
    assigneeUserId: pick(draft.assigneeUserId, before.assigneeUserId, after.assigneeUserId),
    memberIds: memberKey(draft.memberIds) === memberKey(before.memberIds) ? after.memberIds : draft.memberIds,
  };
}

type DetailTab = 'details' | 'comments';

function TaskDetailView({ task }: { task: TaskDetail }) {
  const actor = useActor();
  const toast = useToast();
  const formId = useId();
  const directory = useApi<DirectoryUser[]>('/directory');
  const updateTask = useCommand<UpdateTaskInput>('updateTask');
  const setStatus = useCommand<UpdateTaskInput>('updateTask');
  const cancelTask = useCommand<CancelTaskInput>('cancelTask');
  const createSubtask = useCommand<CreateTaskInput, { taskId: string }>('createTask');

  const [draft, setDraft] = useState<TaskDraft>(() => draftOf(task));
  const savedRef = useRef<TaskDraft>(draftOf(task));
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskDialogOpen, setSubtaskDialogOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [tab, setTab] = useState<DetailTab>('details');

  // Before paint, so a reload never flashes the save bar for fields that only changed on the server.
  useLayoutEffect(() => {
    const before = savedRef.current;
    const after = draftOf(task);
    savedRef.current = after;
    setDraft((cur) => rebaseDraft(cur, before, after));
  }, [task]);

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

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

  const saved = draftOf(task);
  const isDirty =
    draft.title.trim() !== task.title
    || draft.description.trim() !== (task.description ?? '')
    || draft.priority !== task.priority
    || draft.due !== saved.due
    || draft.assigneeUserId !== task.assignee.id
    || (task.kind === 'internal' && memberKey(draft.memberIds) !== memberKey(saved.memberIds));
  const blockReason = !draft.title.trim()
    ? 'Nhập tiêu đề để lưu.'
    : task.kind === 'crm' && !draft.due
      ? 'Việc gắn lead cần có hạn.'
      : null;

  const errors = fieldErrors(updateTask.error);
  const users = directory.data ?? [];

  const handleSave = () => {
    if (blockReason || updateTask.isPending) return;
    updateTask.mutate(
      {
        taskId: task.id,
        expectedVersion: task.version,
        title: draft.title.trim(),
        description: draft.description.trim() ? draft.description.trim() : null,
        priority: draft.priority,
        dueAt: draft.due ? fromLocalInput(draft.due) : null,
        assigneeUserId: draft.assigneeUserId,
        ...(task.kind === 'internal' ? { memberUserIds: draft.memberIds.filter((id) => id !== draft.assigneeUserId) } : {}),
      },
      {
        onSuccess: () => toast('Đã lưu cập nhật công việc'),
      },
    );
  };

  const discard = () => {
    setDraft(draftOf(task));
    updateTask.reset();
  };

  const handleStatus = (nextStatus: 'open' | 'in_progress') => {
    if (nextStatus === task.status) return;
    setStatus.mutate(
      { taskId: task.id, expectedVersion: task.version, status: nextStatus },
      {
        onSuccess: () => toast(nextStatus === 'in_progress' ? 'Đã chuyển sang Đang làm' : 'Đã chuyển về Cần làm'),
        onError: (err) => toast(err.message, 'danger'),
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

  const tabIds = { details: `${formId}-tab-details`, comments: `${formId}-tab-comments` };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: DetailTab = tab === 'details' ? 'comments' : 'details';
    setTab(next);
    document.getElementById(tabIds[next])?.focus();
  };

  // Only an open internal task the reader may edit has a status to switch; everything else shows its status.
  const statusControl = isOpen && task.kind === 'internal' && canEdit ? (
    <SegmentedControl
      ariaLabel="Trạng thái công việc"
      size="sm"
      value={task.status === 'in_progress' ? 'in_progress' : 'open'}
      onChange={handleStatus}
      options={[
        { value: 'open', label: 'Cần làm', disabled: setStatus.isPending },
        { value: 'in_progress', label: 'Đang làm', disabled: setStatus.isPending },
      ]}
    />
  ) : (
    <TaskStatusBadge status={task.status} />
  );

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
            {statusControl}
            <PriorityBadge priority={task.priority} />
            {task.isNextAction && <Badge tone="neutral">Việc tiếp theo</Badge>}
          </div>
        </div>

        <div className="row-wrap">
          {isOpen && (
            // While edits are unsaved, "Lưu thay đổi" is the one primary action on the page.
            <button type="button" className={`btn${isDirty ? '' : ' btn-primary'}`} onClick={() => setCompleting(true)}>
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
      <FormError error={cancelTask.error} />

      <div className="tabs task-detail-tabs" role="tablist" aria-label="Nội dung công việc" onKeyDown={onTabKey}>
        <button
          type="button"
          role="tab"
          id={tabIds.details}
          aria-selected={tab === 'details'}
          aria-controls={`${formId}-pane-details`}
          tabIndex={tab === 'details' ? 0 : -1}
          onClick={() => setTab('details')}
        >
          Chi tiết
        </button>
        <button
          type="button"
          role="tab"
          id={tabIds.comments}
          aria-selected={tab === 'comments'}
          aria-controls={`${formId}-pane-comments`}
          tabIndex={tab === 'comments' ? 0 : -1}
          onClick={() => setTab('comments')}
        >
          Bình luận
        </button>
      </div>

      <div className="cols-main task-detail" data-tab={tab}>
        <div className="grid">
          <section className="card task-pane-details" id={`${formId}-pane-details`} aria-labelledby="detail-h">
            <div className="card-head">
              <h2 id="detail-h">Chi tiết công việc</h2>
            </div>
            <div className="card-body stack">
              {canEdit ? (
                <>
                  <Field label="Tiêu đề" required error={errors.title} htmlFor={`${formId}-title`}>
                    <input
                      id={`${formId}-title`}
                      type="text"
                      maxLength={200}
                      value={draft.title}
                      aria-invalid={Boolean(errors.title) || !draft.title.trim() || undefined}
                      onChange={(e) => set('title', e.target.value)}
                    />
                  </Field>
                  <Field label="Mô tả" error={errors.description} htmlFor={`${formId}-desc`}>
                    <textarea
                      id={`${formId}-desc`}
                      maxLength={5000}
                      value={draft.description}
                      onChange={(e) => set('description', e.target.value)}
                      placeholder="Thêm mô tả chi tiết cho công việc…"
                    />
                  </Field>
                  <Field label="Độ ưu tiên" error={errors.priority}>
                    <PriorityControl value={draft.priority} onChange={(p) => set('priority', p)} />
                  </Field>
                  <Field label="Người phụ trách" htmlFor={`${formId}-assignee`} error={errors.assigneeUserId}>
                    <Combobox
                      id={`${formId}-assignee`}
                      value={draft.assigneeUserId}
                      selectedLabel={task.assignee.id === draft.assigneeUserId ? task.assignee.name : undefined}
                      onChange={(next) => setDraft((d) => ({
                        ...d,
                        assigneeUserId: next,
                        memberIds: d.memberIds.filter((id) => id !== next),
                      }))}
                      options={users.map(userOption)}
                      loading={directory.isLoading}
                      placeholder="Tìm người phụ trách…"
                      invalid={Boolean(errors.assigneeUserId)}
                    />
                  </Field>
                  <Field
                    label="Hạn hoàn thành (giờ Việt Nam)"
                    required={task.kind === 'crm'}
                    error={errors.dueAt}
                    htmlFor={`${formId}-due`}
                  >
                    <DateTimeField
                      id={`${formId}-due`}
                      value={draft.due}
                      onChange={(due) => set('due', due)}
                      required={task.kind === 'crm'}
                      invalid={Boolean(errors.dueAt)}
                      clearLabel={task.kind === 'internal' ? 'Bỏ hạn' : undefined}
                      quickPicks
                    />
                  </Field>
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

          <section className="card task-pane-details" aria-labelledby="subtasks-h">
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
                  className="btn btn-sm"
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

          <section className="card task-pane-comments" id={`${formId}-pane-comments`} aria-labelledby="comments-h">
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

        <div className="grid task-pane-details">
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
                <Badge tone="neutral">{canEdit ? draft.memberIds.length : task.members.length}</Badge>
              </div>
              <div className="card-body stack-sm">
                {canEdit ? (
                  <Field label="Chọn người cùng làm" htmlFor={`${formId}-members`} error={errors.memberUserIds}>
                    <MultiCombobox
                      id={`${formId}-members`}
                      values={draft.memberIds}
                      onChange={(ids) => set('memberIds', ids)}
                      options={users.filter((u) => u.id !== draft.assigneeUserId).map(userOption)}
                      max={20}
                      placeholder="Tìm và thêm người cùng làm…"
                      tagListLabel="Người cùng làm đã chọn"
                    />
                  </Field>
                ) : task.members.length === 0 ? (
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
                {task.source && (
                  <>
                    <dt>Tạo từ chat</dt>
                    <dd>
                      <TaskSourceLink source={task.source} />
                    </dd>
                  </>
                )}
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

      {canEdit && isDirty && (
        <div className="save-bar" role="region" aria-label="Thay đổi chưa lưu">
          <div className="save-bar-text">
            <strong>Có thay đổi chưa lưu</strong>
            {blockReason && <span className="small">{blockReason}</span>}
            <FormError error={updateTask.error} />
          </div>
          <div className="save-bar-actions">
            <button type="button" className="btn" disabled={updateTask.isPending} onClick={discard}>
              Hủy thay đổi
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(blockReason) || updateTask.isPending}
              onClick={handleSave}
            >
              {updateTask.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </div>
      )}

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
