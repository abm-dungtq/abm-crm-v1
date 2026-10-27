import { useEffect, useId, useState } from 'react';
import type { CreateTaskInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { taskSourceSummary, unresolvedNamesHint, type TaskFormInitialValues } from '../chat-task-draft';
import { quickDueValue } from '../date-time';
import { fromLocalInput } from '../format';
import type { DirectoryUser, LeadItem, TaskPriority } from '../types';
import { Combobox, MultiCombobox, type ComboOption } from './combobox';
import { DateTimeField } from './date-time-field';
import { Icon } from './icons';
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

/** The four priorities side by side: one press to pick, every choice visible. */
export function PriorityControl({ value, onChange }: { value: TaskPriority; onChange: (value: TaskPriority) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Độ ưu tiên"
      className="seg-fill"
      value={value}
      onChange={onChange}
      options={PRIORITY_OPTIONS.map((p) => ({ value: p.code, label: p.label }))}
    />
  );
}

/** Nothing for "Bình thường": a badge on almost every task carries no information. */
export function PriorityBadge({ priority }: { priority: TaskPriority | string }) {
  if (priority === 'normal') return null;
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

/** A person as a picker option: the name, with role and team on the second line. */
export const userOption = (u: DirectoryUser): ComboOption => ({
  value: u.id,
  label: u.name,
  hint: `${roleLabel(u.role)}${u.teamName ? ` · ${u.teamName}` : ''}`,
});

const leadLabel = (l: LeadItem) => `${l.code} · ${l.contactName}${l.account?.name ? ` · ${l.account.name}` : ''}`;

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
  const sourceSummary = source ? taskSourceSummary(source, initialValues?.sourceExcerpt) : null;
  const canCreateCrm = !parentTask && !source && CRM_ROLES.includes(actor.role);
  const [kind, setKind] = useState<'internal' | 'crm'>('internal');
  const [leadQuery, setLeadQuery] = useState('');
  const debouncedLeadQ = useDebounced(leadQuery.trim(), 200);
  const [leadId, setLeadId] = useState('');
  // Kept apart from the search results, which change as the person types a new query.
  const [selectedLead, setSelectedLead] = useState<LeadItem | null>(null);
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
      setSelectedLead(null);
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
      if (!due) setDue(quickDueValue(1, 9));
      setMemberUserIds([]);
    } else {
      setLeadId('');
      setSelectedLead(null);
    }
  };

  const handleLeadSelect = (nextLeadId: string) => {
    setLeadId(nextLeadId);
    const found = leads.data?.find((l) => l.id === nextLeadId) ?? null;
    setSelectedLead(found);
    if (found?.owner?.id) {
      setAssigneeUserId(found.owner.id);
    }
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
          toast(parentTask ? 'Đã thêm việc con' : 'Đã tạo công việc', undefined, {
            label: 'Mở việc',
            to: `/tasks/${encodeURIComponent(res.taskId)}`,
          });
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
      title={parentTask ? 'Thêm việc con' : source ? 'Tạo việc từ chat' : 'Tạo việc mới'}
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

      {sourceSummary && (
        <section className="task-source" aria-label="Nguồn của việc">
          <div className="task-source-head">
            <Icon name="message" />
            <strong>{sourceSummary.label}</strong>
          </div>
          {sourceSummary.quote && <blockquote className="task-source-quote">{sourceSummary.quote}</blockquote>}
          <div className="small muted">{sourceSummary.note}</div>
        </section>
      )}
      {unresolvedHint && (
        <div className="chat-task-hint small" role="note">
          {unresolvedHint}
        </div>
      )}

      {!parentTask && kind === 'crm' && (
        <Field label="Lead" required error={errors.leadId} htmlFor={`${formId}-lead`}>
          <Combobox
            id={`${formId}-lead`}
            value={leadId}
            selectedLabel={selectedLead ? leadLabel(selectedLead) : undefined}
            onChange={handleLeadSelect}
            options={(leads.data ?? []).map((l) => ({ value: l.id, label: leadLabel(l), hint: l.owner?.name ?? undefined }))}
            filter={false}
            onQueryChange={setLeadQuery}
            loading={leads.isLoading || leadQuery.trim() !== debouncedLeadQ}
            placeholder="Tìm mã L-…, tên khách, công ty, SĐT…"
            emptyText="Không có lead đang mở"
            invalid={Boolean(errors.leadId)}
          />
        </Field>
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

      <Field label="Độ ưu tiên" error={errors.priority}>
        <PriorityControl value={priority} onChange={setPriority} />
      </Field>

      <Field label="Người phụ trách" required htmlFor={`${formId}-assignee`} error={errors.assigneeUserId}>
        <Combobox
          id={`${formId}-assignee`}
          value={assigneeUserId}
          onChange={(next) => {
            setAssigneeUserId(next);
            setMemberUserIds((prev) => prev.filter((id) => id !== next));
          }}
          options={assignableUsers.map(userOption)}
          loading={directory.isLoading}
          placeholder="Tìm người phụ trách…"
          invalid={Boolean(errors.assigneeUserId)}
        />
      </Field>

      <Field
        label="Hạn hoàn thành (giờ Việt Nam)"
        required={kind === 'crm'}
        error={errors.dueAt}
        htmlFor={`${formId}-due`}
        hint={kind === 'internal' ? 'Có thể bỏ trống nếu việc nội bộ chưa có hạn.' : undefined}
      >
        <DateTimeField
          id={`${formId}-due`}
          value={due}
          onChange={setDue}
          required={kind === 'crm'}
          invalid={Boolean(errors.dueAt)}
          clearLabel={kind === 'internal' ? 'Bỏ hạn' : undefined}
          quickPicks
        />
      </Field>

      {!parentTask && kind === 'internal' && (
        <Field
          label="Người cùng làm"
          error={errors.memberUserIds}
          htmlFor={`${formId}-members`}
          hint="Người cùng làm được xem việc và trao đổi trong bình luận."
        >
          <MultiCombobox
            id={`${formId}-members`}
            values={memberUserIds}
            onChange={setMemberUserIds}
            options={users.filter((u) => u.id !== assigneeUserId).map(userOption)}
            max={20}
            placeholder="Tìm và thêm người cùng làm…"
            tagListLabel="Người cùng làm đã chọn"
          />
        </Field>
      )}

      <FormError error={mutation.error} />
    </Modal>
  );
}
