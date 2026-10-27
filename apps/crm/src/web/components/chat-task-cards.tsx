import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi } from '../api';
import { draftToInitialValues, type TaskFormInitialValues } from '../chat-task-draft';
import { fmtDateTime } from '../format';
import type { ChatTaskCard, ChatTaskDraft, ChatTaskDraftResponse, ChatTaskSource, DirectoryUser } from '../types';
import { Icon } from './icons';
import { TaskFormDialog } from './task-form-dialog';
import { useToast } from './ui';

export interface TaskDraftRequest {
  conversationId: string;
  messageId: string;
  scope: ChatTaskSource['scope'];
  /** Skip Trợ lý and get the manual draft at once ("Tự tạo việc"). */
  prefer?: 'manual';
}

/**
 * The shared "Tạo việc từ tin này / từ chuỗi" action. Trợ lý drafting shows a toast (its card arrives by socket);
 * a manual draft opens the task form. Render `dialog` next to the button.
 */
export function useTaskDraftRequest(): {
  requestTaskDraft: (input: TaskDraftRequest) => void;
  pending: boolean;
  dialog: ReactNode;
} {
  const toast = useToast();
  const [initialValues, setInitialValues] = useState<TaskFormInitialValues | null>(null);
  const mutation = useMutation<ChatTaskDraftResponse, ApiFailure, TaskDraftRequest>({
    mutationFn: ({ conversationId, messageId, scope, prefer }) =>
      api.post<ChatTaskDraftResponse>(`/chat/conversations/${encodeURIComponent(conversationId)}/task-drafts`, {
        messageId,
        scope,
        ...(prefer ? { prefer } : {}),
      }),
    onSuccess: (res) => {
      if (res.mode === 'manual') setInitialValues(draftToInitialValues(res.draft));
      else toast('Trợ lý đang soạn việc…');
    },
    onError: (err) => toast(err.message, 'danger'),
  });

  const requestTaskDraft = (input: TaskDraftRequest) => {
    if (!mutation.isPending) mutation.mutate(input);
  };
  const dialog = initialValues ? (
    <TaskFormDialog open onClose={() => setInitialValues(null)} initialValues={initialValues} />
  ) : null;
  return { requestTaskDraft, pending: mutation.isPending, dialog };
}

function OpenTaskLink({ taskId }: { taskId: string }) {
  return (
    <Link to="/tasks/$taskId" params={{ taskId }}>
      Mở việc
    </Link>
  );
}

const fmtDueDate = (date: string | null) => {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

/** One task Trợ lý proposed. Only the requester can edit and create it, once. */
export function DraftCard({
  draft,
  messageId,
  index,
  requestedByUserId,
}: {
  draft: ChatTaskDraft;
  messageId: string;
  index: number;
  requestedByUserId: string | null;
}) {
  const actor = useActor();
  const [expanded, setExpanded] = useState(false);
  const [initialValues, setInitialValues] = useState<TaskFormInitialValues | null>(null);
  const isRequester = requestedByUserId !== null && requestedByUserId === actor.id;
  const created = draft.createdTaskId;
  const waiting = !created && !isRequester;
  // The requester's name is needed only for the "chờ … xác nhận" line; the directory list is cached app-wide.
  const directory = useApi<DirectoryUser[]>(waiting && requestedByUserId ? '/directory' : null);
  const requesterName = directory.data?.find((u) => u.id === requestedByUserId)?.name ?? 'người yêu cầu';
  const unresolved = new Set(draft.unresolvedNames);
  const description = draft.description?.trim() ?? '';
  const longDescription = description.length > 240 || description.split('\n').length > 4;
  const due = fmtDueDate(draft.dueDate);

  return (
    <div className="chat-task-card" data-state={created ? 'created' : 'draft'}>
      <div className="chat-task-card-head small muted">
        <Icon name="check" />
        <span>Việc nháp</span>
      </div>
      <div className="chat-task-card-title">{draft.title}</div>
      {description && (
        <div>
          <div className="chat-task-desc" data-expanded={expanded ? 'true' : undefined}>
            {description}
          </div>
          {longDescription && (
            <button type="button" className="chat-link-btn small" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Thu gọn' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}
      <dl className="chat-task-fields small">
        <dt>Người làm</dt>
        <dd>
          {draft.assigneeName ? (
            draft.assigneeUserId ? (
              draft.assigneeName
            ) : (
              <span className="chat-task-chip" data-unresolved="true" title="Chưa khớp tên">
                {draft.assigneeName}
              </span>
            )
          ) : (
            <span className="muted">Chưa chọn</span>
          )}
        </dd>
        {draft.memberNames.length > 0 && (
          <>
            <dt>Người liên quan</dt>
            <dd className="chat-task-chips">
              {draft.memberNames.map((name) => (
                <span
                  key={name}
                  className="chat-task-chip"
                  data-unresolved={unresolved.has(name) ? 'true' : undefined}
                  title={unresolved.has(name) ? 'Chưa khớp tên' : undefined}
                >
                  {name}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>Hạn</dt>
        <dd>{due ?? <span className="muted">Chưa đặt hạn</span>}</dd>
      </dl>
      <div className="chat-task-card-foot small">
        {created ? (
          <span>
            Đã tạo việc · <OpenTaskLink taskId={created} />
          </span>
        ) : isRequester ? (
          draft.source && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setInitialValues(draftToInitialValues(draft, messageId, index))}
            >
              Sửa và tạo việc
            </button>
          )
        ) : (
          <span className="muted">Trợ lý đề xuất việc · chờ {requesterName} xác nhận</span>
        )}
      </div>
      {initialValues && (
        <TaskFormDialog open onClose={() => setInitialValues(null)} initialValues={initialValues} />
      )}
    </div>
  );
}

/** The "Đã tạo việc" card posted where a task made from chat came from. Opening it still checks task access. */
export function TaskCard({ card }: { card: ChatTaskCard }) {
  return (
    <div className="chat-task-card" data-state="created">
      <div className="row" style={{ gap: 8 }}>
        <Icon name="check" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-task-card-title truncate">{card.title}</div>
          <div className="small muted">
            {card.assigneeName ?? 'Chưa có người làm'}
            {' · '}
            {card.dueAt ? `Hạn ${fmtDateTime(card.dueAt)}` : 'Chưa đặt hạn'}
          </div>
        </div>
        <span className="small nowrap">
          <OpenTaskLink taskId={card.taskId} />
        </span>
      </div>
    </div>
  );
}

/** Trợ lý could not draft: the requester makes the task by hand from the same source. */
export function FailedDraft({ source }: { source: ChatTaskSource }) {
  const { requestTaskDraft, pending, dialog } = useTaskDraftRequest();
  return (
    <div className="chat-task-failed small">
      <span className="muted">Trợ lý chưa soạn được việc.</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() => requestTaskDraft({ ...source, prefer: 'manual' })}
      >
        {pending ? 'Đang mở…' : 'Tự tạo việc'}
      </button>
      {dialog}
    </div>
  );
}

/** Reads `meta.taskCard`; null for anything that is not a well-formed card. */
export function readTaskCard(meta: Record<string, unknown> | null | undefined): ChatTaskCard | null {
  const c = meta?.taskCard as Partial<ChatTaskCard> | undefined;
  if (!c || typeof c !== 'object' || typeof c.taskId !== 'string' || typeof c.title !== 'string') return null;
  return {
    taskId: c.taskId,
    title: c.title,
    assigneeName: typeof c.assigneeName === 'string' ? c.assigneeName : null,
    dueAt: typeof c.dueAt === 'string' ? c.dueAt : null,
    createdByName: typeof c.createdByName === 'string' ? c.createdByName : null,
  };
}

/** Reads `meta.taskDraftFailed.source`; null when absent or malformed. */
export function readFailedDraftSource(meta: Record<string, unknown> | null | undefined): ChatTaskSource | null {
  const f = meta?.taskDraftFailed as { source?: Partial<ChatTaskSource> } | undefined;
  const s = f && typeof f === 'object' ? f.source : undefined;
  if (!s || typeof s.conversationId !== 'string' || typeof s.messageId !== 'string') return null;
  if (s.scope !== 'message' && s.scope !== 'thread') return null;
  return { conversationId: s.conversationId, messageId: s.messageId, scope: s.scope };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Reads `meta.taskDrafts` with its index in the stored array (the server marks a draft created by that index). Entries
 * without a title are skipped and odd fields are normalised, so a malformed payload never breaks the message.
 */
export function readTaskDrafts(meta: Record<string, unknown> | null | undefined): { draft: ChatTaskDraft; index: number }[] {
  const raw = meta?.taskDrafts;
  if (!Array.isArray(raw)) return [];
  const result: { draft: ChatTaskDraft; index: number }[] = [];
  raw.forEach((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object') return;
    const d = entry as Record<string, unknown>;
    if (typeof d.title !== 'string' || !d.title.trim()) return;
    const source = readFailedDraftSource({ taskDraftFailed: { source: d.source } });
    result.push({
      index,
      draft: {
        title: d.title,
        description: stringOrNull(d.description),
        assigneeName: stringOrNull(d.assigneeName),
        assigneeUserId: stringOrNull(d.assigneeUserId),
        memberNames: strings(d.memberNames),
        memberUserIds: strings(d.memberUserIds),
        unresolvedNames: strings(d.unresolvedNames),
        dueDate: stringOrNull(d.dueDate),
        source,
        createdTaskId: stringOrNull(d.createdTaskId),
      },
    });
  });
  return result;
}
