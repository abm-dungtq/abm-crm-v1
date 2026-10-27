import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api } from '../api';
import { vnTime, type ChatFlowItem } from '../chat-flow';
import { formatThreadTime, replierInitials } from '../chat-links';
import { fmtDateTime } from '../format';
import type { ChatMessage, ChatQuotePreview, ChatTaskSuggestion } from '../types';
import {
  DraftCard,
  FailedDraft,
  TaskCard,
  readFailedDraftSource,
  readTaskCard,
  readTaskDrafts,
  useTaskDraftRequest,
} from './chat-task-cards';
import { Icon } from './icons';
import { formatMentionText, renderMessageBody } from './mention-input';
import { TaskFormDialog } from './task-form-dialog';
import { Avatar, Badge, ConfirmDialog, ImageLightbox, OverflowMenu, useToast } from './ui';

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;
const RECALL_PREVIEW_MAX = 160;

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType.toLowerCase());
}

/** Scrolls a rendered message inside `container` into view; returns false when it is not rendered. */
export function scrollToMessage(container: HTMLElement | null, messageId: string): boolean {
  const el = container?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

export type ChatMessageContextKind = 'main' | 'thread' | 'task';

export interface ChatMessageItemProps {
  message: ChatMessage;
  /** Where the message is shown: the main flow, the thread panel, or task comments. */
  context: ChatMessageContextKind;
  conversationKind: 'group' | 'direct' | 'task';
  conversationMode: 'chat' | 'topic';
  /** Own message not yet stored ("Đang gửi…"). */
  pending?: boolean;
  /** Outlined for 2 s after a jump. */
  highlighted?: boolean;
  canRecall: boolean;
  /** Follows a message by the same author within a few minutes: no avatar and no name, only the time. */
  continued?: boolean;
  /**
   * Last message of a run by one author: the only one that shows its time. The others keep the time as a tooltip on
   * the bubble.
   */
  endsRun?: boolean;
  onQuote: (message: ChatMessage) => void;
  onOpenThread?: (rootId: string) => void;
  onJumpTo: (quote: ChatQuotePreview) => void;
}

/** A day separator ("Hôm nay", "Hôm qua", "20/10/2026") or the "Tin mới" divider in a message list. */
export function ChatFlowSeparator({ item }: { item: Exclude<ChatFlowItem, { kind: 'message' }> }) {
  if (item.kind === 'day') {
    return (
      <li className="chat-flow-sep" role="separator" aria-label={item.label}>
        <span>{item.label}</span>
      </li>
    );
  }
  return (
    <li className="chat-flow-sep" data-tone="new" data-new-divider="true" role="separator" aria-label="Tin mới">
      <span>Tin mới</span>
    </li>
  );
}

/** One chat message with its action menu, quote block, thread card, attachments and legacy task suggestions. */
export function ChatMessageItem({
  message: m,
  context,
  conversationKind,
  conversationMode,
  pending = false,
  highlighted = false,
  canRecall,
  continued = false,
  endsRun = true,
  onQuote,
  onOpenThread,
  onJumpTo,
}: ChatMessageItemProps) {
  const actor = useActor();
  const client = useQueryClient();
  const toast = useToast();
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [suggestionToCreate, setSuggestionToCreate] = useState<ChatTaskSuggestion | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRecall, setConfirmRecall] = useState(false);
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const taskDraftRequest = useTaskDraftRequest();

  const recallMutation = useMutation<{ id: string; conversationId: string; deleted: boolean }, ApiFailure, string>({
    mutationFn: (messageId) => api.delete(`/chat/messages/${encodeURIComponent(messageId)}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['chat', m.conversationId] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      if (m.threadRootId) {
        void client.invalidateQueries({ queryKey: ['chat', 'thread', m.threadRootId] });
        void client.invalidateQueries({ queryKey: ['chat', 'threads'] });
      }
    },
    onError: (err) => toast(err.message, 'danger'),
  });

  useEffect(() => () => {
    if (pressRef.current) clearTimeout(pressRef.current.timer);
  }, []);

  const isMine = m.authorKind === 'user' && m.authorUserId === actor.id;
  const sender =
    m.authorName ?? (m.authorKind === 'agent' ? 'Trợ lý' : m.authorKind === 'system' ? 'Hệ thống' : 'Nhân viên');
  const requestedByUserId =
    !m.deleted && typeof m.meta?.requestedByUserId === 'string' ? m.meta.requestedByUserId : null;
  // "Tự tạo việc" after Trợ lý could not draft: only for the person who asked.
  const failedDraftSource =
    !m.deleted && requestedByUserId === actor.id && m.authorKind !== 'user' ? readFailedDraftSource(m.meta) : null;

  if (m.authorKind === 'system') {
    const metaLink = !m.deleted && typeof m.meta?.link === 'string' ? m.meta.link : null;
    const taskCard = m.deleted ? null : readTaskCard(m.meta);
    if (taskCard) {
      return (
        <li
          className="chat-task-card-row"
          role="note"
          data-message-id={m.id}
          data-highlight={highlighted ? 'true' : undefined}
        >
          <TaskCard card={taskCard} />
          <time className="small muted" dateTime={m.createdAt} title={fmtDateTime(m.createdAt)}>
            {vnTime(m.createdAt)}
          </time>
        </li>
      );
    }
    return (
      <li
        className="msg-system muted small"
        role="note"
        data-message-id={m.id}
        data-highlight={highlighted ? 'true' : undefined}
        style={{ textAlign: 'center', alignSelf: 'center', width: '100%', padding: '4px 12px' }}
      >
        <span>{m.deleted ? 'Tin nhắn đã thu hồi' : m.body}</span>
        {metaLink && (
          <>
            {' · '}
            <Link to={metaLink}>Xem chi tiết</Link>
          </>
        )}
        {' · '}
        <time dateTime={m.createdAt} title={fmtDateTime(m.createdAt)}>
          {vnTime(m.createdAt)}
        </time>
        {failedDraftSource && <FailedDraft source={failedDraftSource} />}
      </li>
    );
  }

  const msgAttachments = m.deleted ? [] : (m.attachments ?? []);
  const imageAtts = msgAttachments.filter((a) => isInlineImage(a.contentType));
  const fileAtts = msgAttachments.filter((a) => !isInlineImage(a.contentType));
  // Older agent answers still carry `taskSuggestions`; newer ones carry `taskDrafts`. Only agent messages get drafts.
  const taskSuggestions =
    !m.deleted && Array.isArray(m.meta?.taskSuggestions) ? (m.meta.taskSuggestions as ChatTaskSuggestion[]) : [];
  const taskDrafts = !m.deleted && m.authorKind === 'agent' ? readTaskDrafts(m.meta) : [];

  const canQuote = !m.deleted && !pending;
  const canMakeTask = canQuote && (conversationKind === 'group' || conversationKind === 'direct');
  const canThreadReply =
    canQuote &&
    context === 'main' &&
    (conversationKind === 'group' || conversationKind === 'direct') &&
    conversationMode === 'chat' &&
    m.threadRootId === null &&
    Boolean(onOpenThread);
  const showRecall = canRecall && !m.deleted && !pending;
  const recallPreview = showRecall ? formatMentionText(m.body).slice(0, RECALL_PREVIEW_MAX) : '';
  const hasActions = canQuote || showRecall;
  const thread = context === 'main' && m.threadRootId === null ? m.thread : null;
  const showTime = endsRun || pending;

  const clearPress = () => {
    if (pressRef.current) {
      clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || !hasActions) return;
    clearPress();
    pressRef.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        pressRef.current = null;
        setMenuOpen(true);
      }, LONG_PRESS_MS),
    };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const press = pressRef.current;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_MOVE_PX) clearPress();
  };

  return (
    <li
      className="stack-sm"
      data-message-id={m.id}
      data-highlight={highlighted ? 'true' : undefined}
      data-continued={continued ? 'true' : undefined}
      style={{ alignItems: isMine ? 'flex-end' : 'flex-start' }}
    >
      <div
        className={isMine ? 'msg' : 'msg msg-with-avatar'}
        data-side={isMine ? 'out' : 'in'}
        data-kind={m.authorKind === 'agent' ? 'bot' : undefined}
        data-status={pending ? 'pending' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
      >
        {!isMine && (continued ? <span className="msg-avatar-spacer" aria-hidden="true" /> : <Avatar name={sender} />)}
        <div className="msg-stack">
          {continued || isMine ? (
            // The author is still announced to screen readers on every message.
            <span className="visually-hidden">{sender}:</span>
          ) : (
            <div className="msg-head">
              {m.authorKind === 'agent' && (
                <>
                  <Icon name="bot" />
                  {/* The badge tells an agent from a person; it would only repeat an agent already named "Trợ lý". */}
                  {sender !== 'Trợ lý' && <Badge tone="accent">Trợ lý</Badge>}
                </>
              )}
              <span className="msg-sender">{sender}</span>
            </div>
          )}
          <div className="msg-bubble" title={showTime ? undefined : fmtDateTime(m.createdAt)}>
            {m.replyTo && !m.deleted && (
              <button
                type="button"
                className="chat-quote"
                onClick={() => onJumpTo(m.replyTo!)}
                title="Xem tin được trả lời"
              >
                <strong className="chat-quote-author">{m.replyTo.authorName ?? 'Nhân viên'}</strong>
                {m.replyTo.deleted ? (
                  <em className="chat-quote-text">Tin đã thu hồi</em>
                ) : (
                  <span className="chat-quote-text">{formatMentionText(m.replyTo.snippet)}</span>
                )}
              </button>
            )}
            <div className="msg-body">
              {m.deleted ? <span className="muted">Tin nhắn đã thu hồi</span> : renderMessageBody(m.body, actor.id)}
            </div>
            {imageAtts.length > 0 && (
              <div className="msg-images" data-grid={imageAtts.length > 1 ? 'true' : undefined}>
                {imageAtts.map((att) => {
                  const url = `/api/chat/attachments/${encodeURIComponent(att.id)}`;
                  return (
                    <button
                      key={att.id}
                      type="button"
                      className="msg-image-btn"
                      onClick={() => setLightboxImage({ src: url, alt: att.fileName })}
                      aria-label={`Xem ảnh ${att.fileName}`}
                    >
                      <img className="msg-image" src={url} alt={att.fileName} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )}
            {fileAtts.map((att) => {
              const url = `/api/chat/attachments/${encodeURIComponent(att.id)}`;
              return (
                <a key={att.id} className="msg-attachment" href={url} target="_blank" rel="noopener noreferrer">
                  <Icon name="file" />
                  <span>{att.fileName}</span>
                  <span className="muted small">({fmtFileSize(att.size)})</span>
                </a>
              );
            })}
          </div>

          {taskSuggestions.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 4 }}>
              {taskSuggestions.map((s, idx) => (
                <div
                  key={`${m.id}-task-${idx}`}
                  className="card"
                  style={{ padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', maxWidth: 380 }}
                >
                  <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{s.title}</div>
                      <div className="small muted">
                        Phụ trách: {s.assigneeName || '—'} · Hạn: {s.dueDate || 'Chưa đặt hạn'}
                      </div>
                    </div>
                    {requestedByUserId === actor.id && (
                      <button type="button" className="btn btn-sm btn-primary nowrap" onClick={() => setSuggestionToCreate(s)}>
                        Tạo việc
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {taskDrafts.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 4 }}>
              {taskDrafts.map(({ draft, index }) => (
                <DraftCard
                  key={`${m.id}-draft-${index}`}
                  draft={draft}
                  messageId={m.id}
                  index={index}
                  requestedByUserId={requestedByUserId}
                />
              ))}
            </div>
          )}

          {failedDraftSource && <FailedDraft source={failedDraftSource} />}

          {context === 'main' && m.threadRootId && onOpenThread && (
            <button type="button" className="chat-link-btn small" onClick={() => onOpenThread(m.threadRootId!)}>
              Đã trả lời trong chuỗi · Xem chuỗi
            </button>
          )}

          {/* Without the time the row would only hold the "⋯" button; it moves beside the bubble instead. */}
          <div className="msg-meta" data-compact={showTime ? undefined : 'true'}>
            {showTime && (
              <time dateTime={m.createdAt} title={fmtDateTime(m.createdAt)}>
                {vnTime(m.createdAt)}
              </time>
            )}
            {pending && <span className="msg-state">Đang gửi…</span>}
            {hasActions && (
              <OverflowMenu
                label="Thao tác với tin"
                className="chat-msg-actions"
                buttonClassName="btn btn-ghost btn-sm icon-btn chat-msg-actions-btn"
                open={menuOpen}
                onOpenChange={setMenuOpen}
                align={isMine ? 'right' : 'left'}
                items={[
                  ...(canQuote ? [{ label: 'Trả lời', onSelect: () => onQuote(m) }] : []),
                  ...(canThreadReply ? [{ label: 'Trả lời theo chuỗi', onSelect: () => onOpenThread?.(m.id) }] : []),
                  ...(canMakeTask
                    ? [
                        {
                          label: 'Tạo việc từ tin này',
                          disabled: taskDraftRequest.pending,
                          onSelect: () =>
                            taskDraftRequest.requestTaskDraft({
                              conversationId: m.conversationId,
                              messageId: m.id,
                              scope: 'message',
                              excerpt: m.body,
                            }),
                        },
                      ]
                    : []),
                  ...(showRecall
                    ? [{ label: 'Thu hồi', danger: true, disabled: recallMutation.isPending, onSelect: () => setConfirmRecall(true) }]
                    : []),
                ]}
              />
            )}
          </div>

          {thread && thread.replyCount > 0 && (
            <div className="chat-thread-card">
              <span className="chat-thread-avatars" aria-hidden="true">
                {thread.repliers.slice(0, 3).map((r) => (
                  <span key={r.userId} className="chat-avatar-mini" title={r.name}>
                    {replierInitials(r.name)}
                  </span>
                ))}
              </span>
              <span className="small">
                {thread.replyCount} trả lời · {formatThreadTime(thread.lastReplyAt ?? thread.lastActivityAt)}
              </span>
              {thread.unread > 0 && (
                <span className="chat-unread-dot" role="img" aria-label={`${thread.unread} trả lời chưa đọc`} />
              )}
              <button type="button" className="chat-link-btn small" onClick={() => onOpenThread?.(m.id)}>
                Xem chuỗi
              </button>
            </div>
          )}
        </div>
      </div>

      {lightboxImage && (
        <ImageLightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
      )}

      {taskDraftRequest.dialog}

      {showRecall && confirmRecall && (
        <ConfirmDialog
          open
          title="Thu hồi tin nhắn?"
          confirmLabel="Thu hồi"
          pending={recallMutation.isPending}
          onCancel={() => setConfirmRecall(false)}
          onConfirm={() => recallMutation.mutate(m.id, { onSettled: () => setConfirmRecall(false) })}
        >
          <p>Mọi người sẽ thấy &ldquo;Tin nhắn đã thu hồi&rdquo; thay cho tin này:</p>
          <blockquote className="confirm-quote">{recallPreview || 'Tin có tệp đính kèm'}</blockquote>
        </ConfirmDialog>
      )}

      {suggestionToCreate && (
        <TaskFormDialog
          open
          onClose={() => setSuggestionToCreate(null)}
          initialValues={{
            title: suggestionToCreate.title,
            assigneeUserId: suggestionToCreate.assigneeUserId,
            // The agent proposes a day only; 09:00 Vietnam time is the default hour, as for the quick picks.
            due: suggestionToCreate.dueDate ? `${suggestionToCreate.dueDate}T09:00` : null,
          }}
        />
      )}
    </li>
  );
}
