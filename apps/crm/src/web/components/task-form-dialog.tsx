import { useEffect, useId, useState } from 'react';
import type { CreateTaskInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { unresolvedNamesHint, type TaskFormInitialValues } from '../chat-task-draft';
import { fromLocalInput, toLocalInput } from '../format';
import type { DirectoryUser, LeadItem, TaskPriority } from '../types';
import { roleLabel } from './layout';
import { Badge, Field, FormError, Modal, SegmentedControl, fieldErrors, useDebounced, useToast, type Tone } from './ui';

export const PRIORITY_OPTIONS: { code: TaskPriority; label: string; tone: Tone }[] = [
  { code: 'low', label: 'Thấp', tone: 'neutral' },
  { code: 'normal', label: 'Bình thường', tone: 'info' },
  { code: 'high', label: 'Cao', tone: 'warn' },
  { code: 'urgent', label: 'Khẩn cấp', tone: 'danger' },
];

export const priorityLabel = (p: TaskPriority | string) =>
  PRIORITY_OPTIONS.find((o) => o.code === p)?.label ?? p;

export function PriorityBadge({ priority }: { priority: TaskPriority | string }) {
  const opt = PRIORITY_OPTIONS.find((o) => o.code === priority);
  return <Badge tone={opt?.tone ?? 'neutral'}>{opt?.label ?? priority}</Badge>;
}

export const TASK_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Cần làm', tone: 'neutral' },
  in_progress: { label: 'Đang làm', tone: 'info' },
  completed: { label: 'Đã xong', tone: 'ok' },
  cancelled: { label: 'Đã hủy', tone: 'danger' },
};

export function TaskStatusBadge({ status }: { status: string }) {
  const meta = TASK_STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
}

const at = (days: number, hour: number, minute = 0) => {
  const d = new Date(Date.now() + 7 * 3600_000);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return toLocalInput(new Date(d.getTime() - 7 * 3600_000));
};

const QUICK_DUE = [
  { label: 'Hôm nay 17:00', value: () => at(0, 17) },
  { label: 'Sáng mai 9:00', value: () => at(1, 9) },
  { label: '+3 ngày', value: () => at(3, 9) },
  { label: '+1 tuần', value: () => at(7, 9) },
];

const CRM_ROLES = ['sale', 'leader', 'head', 'director', 'admin'];

export type { TaskFormInitialValues };

export function TaskFormDialog({
  open,
  onClose,
  parentTask,
  onCreated,
  initialValues,
}: {
  open: boolean;
  onClose: () => void;
  parentTask?: { id: string; title: string };
  onCreated?: (taskId: string) => void;
  initialValues?: TaskFormInitialValues;
}) {
  const actor = useActor();
  const source = parentTask ? undefined : initialValues?.source;
  const draftRef = source ? initialValues?.draft : undefined;
  const unresolvedHint = unresolvedNamesHint(initialValues?.unresolvedNames);
  const canCreateCrm = !parentTask && !source && CRM_ROLES.includes(actor.role);
  const [kind, setKind] = useState<'internal' | 'crm'>('internal');
  const [leadQuery, setLeadQuery] = useState('');
  const debouncedLeadQ = useDebounced(leadQuery.trim(), 200);
  const [leadId, setLeadId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [due, setDue] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState(actor.id);
  const [memberUserIds, setMemberUserIds] = useState<string[]>([]);

  const directory = useApi<DirectoryUser[]>(open ? '/directory' : null);
  const leads = useApi<LeadItem[]>(
    open && kind === 'crm'
      ? `/leads?status=active${debouncedLeadQ ? `&q=${encodeURIComponent(debouncedLeadQ.slice(0, 100))}` : ''}`
      : null,
  );
  const mutation = useCommand<CreateTaskInput, { taskId: string }>('createTask');
  const toast = useToast();
  const errors = fieldErrors(mutation.error);
  const formId = useId();

  // Reset only when the dialog opens: the initial values are read then, so a parent re-render never wipes the user's edits.
  useEffect(() => {
    if (open) {
      setKind('internal');
      setLeadQuery('');
      setLeadId('');
      setTitle(initialValues?.title ?? '');
      setDescription(initialValues?.description ?? '');
      setPriority('normal');
      setDue(initialValues?.due ?? '');
      setAssigneeUserId(initialValues?.assigneeUserId || actor.id);
      setMemberUserIds((initialValues?.memberUserIds ?? []).slice(0, 20));
      mutation.reset();
    }
  }, [open, actor.id]);

  // Prefilled members are kept only when they are active directory users; the list loads after the dialog opens.
  useEffect(() => {
    if (!open || !directory.data) return;
    const active = new Set(directory.data.map((u) => u.id));
    setMemberUserIds((prev) => (prev.every((id) => active.has(id)) ? prev : prev.filter((id) => active.has(id))));
  }, [open, directory.data]);

  const handleKindChange = (nextKind: 'internal' | 'crm') => {
    setKind(nextKind);
    if (nextKind === 'crm') {
      if (!due) setDue(at(1, 9));
      setMemberUserIds([]);
    } else {
      setLeadId('');
    }
  };

  const selectedLead = leads.data?.find((l) => l.id === leadId);

  const handleLeadSelect = (nextLeadId: string) => {
    setLeadId(nextLeadId);
    const found = leads.data?.find((l) => l.id === nextLeadId);
    if (found?.owner?.id) {
      setAssigneeUserId(found.owner.id);
    }
  };

  const toggleMember = (uid: string) => {
    setMemberUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : prev.length < 20 ? [...prev, uid] : prev,
    );
  };

  const users = directory.data ?? [];
  const crmAllowedIds = selectedLead
    ? new Set([selectedLead.owner?.id, actor.id].filter(Boolean) as string[])
    : null;
  const assignableUsers = kind === 'crm' && crmAllowedIds
    ? users.filter((u) => crmAllowedIds.has(u.id))
    : users;

  const canSubmit = Boolean(
    title.trim()
    && assigneeUserId
    && (kind === 'internal' || (leadId && due))
    && !mutation.isPending,
  );

  const submit = () => {
    if (!canSubmit) return;
    mutation.mutate(
      {
        kind: parentTask ? 'internal' : kind,
        leadId: !parentTask && kind === 'crm' ? leadId : undefined,
        parentTaskId: parentTask?.id,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueAt: due ? fromLocalInput(due) : undefined,
        assigneeUserId,
        memberUserIds: !parentTask && kind === 'internal'
          ? memberUserIds.filter((uid) => uid !== assigneeUserId)
          : [],
        source,
        draft: draftRef,
      },
      {
        onSuccess: (res) => {
          toast(parentTask ? 'Đã thêm việc con' : 'Đã tạo công việc');
          onCreated?.(res.taskId);
          onClose();
        },
        onError: (err) => {
          // Someone (or another tab) already made this draft into a task.
          if (draftRef && (err.code === 'STALE_VERSION' || err.status === 409)) {
            toast('Việc nháp này đã được tạo');
            onClose();
          }
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parentTask ? 'Thêm việc con' : 'Tạo việc mới'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            {mutation.isPending ? 'Đang lưu…' : parentTask ? 'Thêm việc con' : 'Tạo việc'}
          </button>
        </>
      }
    >
      {parentTask ? (
        <div className="small text-2">
          Việc cha: <strong>{parentTask.title}</strong>
        </div>
      ) : canCreateCrm ? (
        <Field label="Loại công việc">
          <div>
            <SegmentedControl
              ariaLabel="Loại công việc"
              value={kind}
              onChange={handleKindChange}
              options={[
                { value: 'internal', label: 'Việc nội bộ' },
                { value: 'crm', label: 'Việc gắn lead' },
              ]}
            />
          </div>
        </Field>
      ) : null}

      {source && (
        <div className="small text-2">
          Tạo từ chat · việc sẽ được gửi lại vào {source.scope === 'thread' ? 'chuỗi' : 'tin gốc'}
        </div>
      )}
      {unresolvedHint && (
        <div className="chat-task-hint small" role="note">
          {unresolvedHint}
        </div>
      )}

      {!parentTask && kind === 'crm' && (
        <div className="stack-sm">
          <Field label="Tìm và chọn lead" required error={errors.leadId} htmlFor={`${formId}-lead-q`}>
            <input
              id={`${formId}-lead-q`}
              type="search"
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
              placeholder="Tìm mã L-…, tên khách, công ty, SĐT…"
              autoComplete="off"
            />
          </Field>
          <Field label="Lead" required htmlFor={`${formId}-lead`}>
            <select
              id={`${formId}-lead`}
              value={leadId}
              onChange={(e) => handleLeadSelect(e.target.value)}
              aria-invalid={Boolean(errors.leadId)}
            >
              <option value="">
                {leads.isLoading ? 'Đang tải danh sách lead…' : 'Chọn lead đang mở…'}
              </option>
              {(leads.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.contactName}{l.account?.name ? ` · ${l.account.name}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <Field label="Tiêu đề" required error={errors.title} htmlFor={`${formId}-title`}>
        <input
          id={`${formId}-title`}
          type="text"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="VD: Chuẩn bị tài liệu họp tuần, Gọi xác nhận báo giá…"
          required
          aria-invalid={Boolean(errors.title)}
        />
      </Field>

      <Field label="Mô tả" error={errors.description} htmlFor={`${formId}-desc`}>
        <textarea
          id={`${formId}-desc`}
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Chi tiết công việc, tài liệu liên quan, kết quả mong đợi…"
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

        <Field label="Người phụ trách" required htmlFor={`${formId}-assignee`} error={errors.assigneeUserId}>
          <select
            id={`${formId}-assignee`}
            value={assigneeUserId}
            onChange={(e) => {
              const next = e.target.value;
              setAssigneeUserId(next);
              setMemberUserIds((prev) => prev.filter((id) => id !== next));
            }}
          >
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({roleLabel(u.role)}{u.teamName ? ` · ${u.teamName}` : ''})
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="stack-sm">
        <Field
          label="Hạn hoàn thành (giờ Việt Nam)"
          required={kind === 'crm'}
          error={errors.dueAt}
          htmlFor={`${formId}-due`}
          hint={kind === 'internal' ? 'Có thể bỏ trống nếu việc nội bộ chưa có hạn.' : undefined}
        >
          <div className="row">
            <input
              id={`${formId}-due`}
              type="datetime-local"
              value={due}
              required={kind === 'crm'}
              onChange={(e) => setDue(e.target.value)}
            />
            {kind === 'internal' && due && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDue('')}>
                Bỏ hạn
              </button>
            )}
          </div>
        </Field>
        <div className="chips" aria-label="Chọn nhanh hạn">
          {QUICK_DUE.map((q) => {
            const v = q.value();
            return (
              <button
                type="button"
                key={q.label}
                className="chip"
                aria-pressed={due === v}
                onClick={() => setDue(v)}
              >
                {q.label}
              </button>
            );
          })}
        </div>
      </div>

      {!parentTask && kind === 'internal' && (
        <Field
          label="Người cùng làm"
          error={errors.memberUserIds}
          hint="Người cùng làm được xem việc và trao đổi trong bình luận."
        >
          <div className="chips" role="group" aria-label="Chọn người cùng làm" style={{ maxHeight: 140, overflowY: 'auto' }}>
            {users
              .filter((u) => u.id !== assigneeUserId)
              .map((u) => {
                const selected = memberUserIds.includes(u.id);
                return (
                  <button
                    type="button"
                    key={u.id}
                    className="chip"
                    aria-pressed={selected}
                    onClick={() => toggleMember(u.id)}
                  >
                    {u.name}
                  </button>
                );
              })}
          </div>
        </Field>
      )}

      <FormError error={mutation.error} />
    </Modal>
  );
}
