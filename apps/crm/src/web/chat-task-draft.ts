/** Pure helpers for tasks made from chat: draft to form values, and the "Tạo từ chat" link. */
import { chatLink } from './chat-links';
import type { ChatManualTaskDraft, ChatTaskDraft, ChatTaskSource } from './types';

/** Values an internal task starts with when the dialog opens; `due` is a `datetime-local` value in Vietnam time. */
export interface TaskFormInitialValues {
  title?: string;
  description?: string;
  assigneeUserId?: string | null;
  due?: string | null;
  memberUserIds?: string[];
  /** Names Trợ lý wrote that matched nobody; shown as a hint only, never sent. */
  unresolvedNames?: string[];
  /** The task is made from chat: it is internal and links back to this message or thread. */
  source?: ChatTaskSource;
  /** The agent draft being used, so the server marks it created exactly once. */
  draft?: { messageId: string; index: number };
}

/**
 * Maps an agent draft (with its message id and index) or a manual draft to the task form. The agent proposes a day
 * only, so 09:00 Vietnam time is the default hour, as for the quick picks.
 */
export function draftToInitialValues(
  draft: ChatTaskDraft | ChatManualTaskDraft,
  messageId?: string,
  index?: number,
): TaskFormInitialValues {
  const source = draft.source ?? undefined;
  return {
    title: draft.title,
    description: draft.description ?? '',
    assigneeUserId: draft.assigneeUserId,
    due: draft.dueDate ? `${draft.dueDate}T09:00` : null,
    memberUserIds: [...draft.memberUserIds],
    unresolvedNames: 'unresolvedNames' in draft ? [...draft.unresolvedNames] : [],
    source,
    draft: source && messageId !== undefined && index !== undefined ? { messageId, index } : undefined,
  };
}

/** The chat link of a task source: the thread panel for a thread, the message jump for one message. */
export function taskSourceLink(source: ChatTaskSource): string {
  return chatLink({
    conversationId: source.conversationId,
    threadRootId: source.scope === 'thread' ? source.messageId : undefined,
    messageId: source.scope === 'message' ? source.messageId : undefined,
  });
}

/** "Chưa khớp tên: @A, @B. Chọn lại người trong danh sách." or null when every name matched. */
export function unresolvedNamesHint(names: readonly string[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  return `Chưa khớp tên: ${names.map((n) => `@${n}`).join(', ')}. Chọn lại người trong danh sách.`;
}
