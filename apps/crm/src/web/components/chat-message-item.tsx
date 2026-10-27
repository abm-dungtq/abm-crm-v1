import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api } from '../api';
import { formatThreadTime, replierInitials } from '../chat-links';
import { fmtDateTime } from '../format';
import type { ChatMessage, ChatQuotePreview, ChatTaskSuggestion } from '../types';
import { Icon } from './icons';
import { formatMentionText, renderMessageBody } from './mention-input';
import { TaskFormDialog } from './task-form-dialog';
import { Avatar, Badge, ImageLightbox, useToast } from './ui';

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

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
  onQuote: (message: ChatMessage) => void;
  onOpenThread?: (rootId: string) => void;
  onJumpTo: (quote: ChatQuotePreview) => void;
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
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

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

  if (m.authorKind === 'system') {
    const metaLink = !m.deleted && typeof m.meta?.link === 'string' ? m.meta.link : null;
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
        <time dateTime={m.createdAt}>{fmtDateTime(m.createdAt)}</time>
      </li>
    );
  }

  const msgAttachments = m.deleted ? [] : (m.attachments ?? []);
  const imageAtts = msgAttachments.filter((a) => isInlineImage(a.contentType));
  const fileAtts = msgAttachments.filter((a) => !isInlineImage(a.contentType));
  const taskSuggestions =
    !m.deleted && Array.isArray(m.meta?.taskSuggestions) ? (m.meta.taskSuggestions as ChatTaskSuggestion[]) : [];
  const requestedByUserId =
    !m.deleted && typeof m.meta?.requestedByUserId === 'string' ? m.meta.requestedByUserId : null;

  const canQuote = !m.deleted && !pending;
  const canThreadReply =
    canQuote &&
    context === 'main' &&
    (conversationKind === 'group' || conversationKind === 'direct') &&
    conversationMode === 'chat' &&
    m.threadRootId === null &&
    Boolean(onOpenThread);
  const showRecall = canRecall && !m.deleted && !pending;
  const hasActions = canQuote || showRecall;
  const thread = context === 'main' && m.threadRootId === null ? m.thread : null;

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
        {!isMine && <Avatar name={sender} />}
        <div className="msg-stack">
          <div className="msg-bubble">
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

          {context === 'main' && m.threadRootId && onOpenThread && (
            <button type="button" className="chat-link-btn small" onClick={() => onOpenThread(m.threadRootId!)}>
              Đã trả lời trong chuỗi · Xem chuỗi
            </button>
          )}

          <div className="msg-meta">
            {m.authorKind === 'agent' && (
              <>
                <Icon name="bot" />
                <Badge tone="accent">Trợ lý</Badge>
              </>
            )}
            <span className="msg-sender">{sender}</span>
            <time dateTime={m.createdAt}>{fmtDateTime(m.createdAt)}</time>
            {pending && <span className="msg-state">Đang gửi…</span>}
            {hasActions && (
              <MessageActionMenu
                open={menuOpen}
                onOpenChange={setMenuOpen}
                side={isMine ? 'out' : 'in'}
                items={[
                  ...(canQuote ? [{ label: 'Trả lời', onSelect: () => onQuote(m) }] : []),
                  ...(canThreadReply ? [{ label: 'Trả lời theo chuỗi', onSelect: () => onOpenThread?.(m.id) }] : []),
                  ...(showRecall
                    ? [{ label: 'Thu hồi', disabled: recallMutation.isPending, onSelect: () => recallMutation.mutate(m.id) }]
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

interface MenuItemSpec {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** The "⋯" button and its menu. Closes on a choice, an outside press or Escape. */
function MessageActionMenu({
  open,
  onOpenChange,
  side,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'in' | 'out';
  items: MenuItemSpec[];
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    boxRef.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <span className="dropdown chat-msg-actions" data-side={side} data-open={open ? 'true' : undefined} ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm icon-btn chat-msg-actions-btn"
        aria-label="Thao tác với tin"
        title="Thao tác với tin"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <span className="menu-pop" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={item.disabled}
              onClick={() => {
                onOpenChange(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
