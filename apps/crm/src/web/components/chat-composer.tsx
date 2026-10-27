import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, currentAuthMode, currentDemoUser } from '../api';
import { chatDraftKey, readChatDraft, writeChatDraft } from '../chat-links';
import { AGENT_THINKING_EVENT } from '../chat-socket';
import type { ChatAttachment, ChatMessage } from '../types';
import { fmtFileSize } from './chat-message-item';
import { Icon } from './icons';
import { MentionInput, formatMentionText } from './mention-input';
import { FormError } from './ui';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const AGENT_THINKING_TTL_MS = 2 * 60 * 1000;
const AGENT_MENTION_RE = /@\[[^\]]{1,200}\]\(agent:[^)\s]{1,128}\)/;
const READ_DELAY_MS = 2000;
const QUOTE_SNIPPET_MAX = 120;

interface PendingAttachmentItem {
  localId: string;
  fileName: string;
  size: number;
  status: 'uploading' | 'uploaded' | 'error';
  uploaded?: ChatAttachment;
  error?: string;
}

async function uploadChatAttachment(conversationId: string, file: File): Promise<ChatAttachment> {
  const form = new FormData();
  form.set('file', file, file.name);
  const headers = new Headers();
  const demoUser = currentDemoUser();
  if (demoUser && currentAuthMode() !== 'password') {
    headers.set('X-Demo-User', demoUser);
  }
  let response: Response;
  try {
    response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/attachments`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch {
    throw new ApiFailure({ code: 'INTERNAL', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' }, 0);
  }
  const body = (await response.json().catch(() => null)) as {
    ok: boolean;
    data?: ChatAttachment;
    error?: { code: string; message: string };
  } | null;
  if (!body) {
    throw new ApiFailure({ code: 'INTERNAL', message: `Máy chủ trả lỗi ${response.status}` }, response.status);
  }
  if (!body.ok) {
    throw new ApiFailure(body.error as never, response.status);
  }
  return body.data!;
}

/**
 * "Trợ lý đang trả lời…" for one view: the main flow (`rootId` null) or one thread. It starts on an
 * `agent.thinking` event for that view or when this tab asks the agent, and stops when an agent message arrives
 * or after 2 minutes.
 */
export function useAgentThinking(conversationId: string | null, rootId: string | null, newest: ChatMessage | undefined) {
  const [until, setUntil] = useState<number | null>(null);

  useEffect(() => {
    setUntil(null);
  }, [conversationId, rootId]);

  useEffect(() => {
    if (!conversationId || typeof window === 'undefined') return;
    const onAgentThinking = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string; rootId?: string | null }>).detail;
      if (detail?.conversationId === conversationId && (detail.rootId ?? null) === rootId) {
        setUntil(Date.now() + AGENT_THINKING_TTL_MS);
      }
    };
    window.addEventListener(AGENT_THINKING_EVENT, onAgentThinking);
    return () => window.removeEventListener(AGENT_THINKING_EVENT, onAgentThinking);
  }, [conversationId, rootId]);

  useEffect(() => {
    if (!newest) return;
    if (newest.authorKind === 'agent' || newest.id.startsWith('agent-failed:')) {
      setUntil(null);
    }
  }, [newest]);

  useEffect(() => {
    if (!until) return;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      setUntil(null);
      return;
    }
    const timer = setTimeout(() => setUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [until]);

  return {
    thinking: Boolean(until && until > Date.now()),
    start: () => setUntil(Date.now() + AGENT_THINKING_TTL_MS),
  };
}

/**
 * Posts `{ at }` to a read endpoint 2 s after `at` last changed, once per value, then calls `onDone`.
 * Shared by the main flow (conversation read) and the thread panel (thread read).
 */
export function useDebouncedMarkRead(path: string | null, at: string | null | undefined, onDone: () => void) {
  const lastRef = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    lastRef.current = null;
  }, [path]);

  useEffect(() => {
    if (!path || !at || lastRef.current === at) return;
    const timer = setTimeout(() => {
      lastRef.current = at;
      void api
        .post(path, { at })
        .then(() => onDoneRef.current())
        .catch(() => {});
    }, READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [path, at]);
}

/** A mention token for a quoted author, without characters that would break the `@[Name](user:id)` syntax. */
function mentionToken(name: string, userId: string): string {
  const safe = name.replace(/[[\]()]/g, '').trim() || 'Nhân viên';
  return `@[${safe}](user:${userId})`;
}

export interface ChatComposerProps {
  conversationId: string | null;
  conversationKind: 'group' | 'direct' | 'task' | null;
  /** Set when the composer posts into a thread. */
  threadRootId?: string | null;
  /** Shows "Cũng gửi vào nhóm" (thread composer in a normal chat). */
  showAlsoSend: boolean;
  /** The message being quoted ("Trả lời"), or null. */
  quote: ChatMessage | null;
  onClearQuote: () => void;
  agents: { id: string; name: string }[];
  /** "Trợ lý đang trả lời…" for this view. */
  thinking: boolean;
  /** Called when this tab asks an agent, so the thinking hint shows before the server event. */
  onAgentAsked: () => void;
  /** Closed topic: the composer stays visible but cannot send. */
  disabled?: boolean;
  autoFocus?: boolean;
  /** Short field hint; keyboard tips show under the field on devices with a pointer. */
  placeholder?: string;
  /** Label of the send button ("Gửi" by default). */
  sendLabel?: string;
  /** Shorter label shown when the conversation column is narrow; must be a prefix of `sendLabel`. */
  sendShortLabel?: string;
  onPending: (message: ChatMessage) => void;
  onSent: (saved: ChatMessage, pending: ChatMessage) => void;
  onFailed: (messageId: string) => void;
}

/** The message input with mentions, attachments and the quote banner, shared by the main flow and the thread panel. */
export function ChatComposer({
  conversationId,
  conversationKind,
  threadRootId = null,
  showAlsoSend,
  quote,
  onClearQuote,
  agents,
  thinking,
  onAgentAsked,
  disabled = false,
  autoFocus = false,
  placeholder,
  sendLabel = 'Gửi',
  sendShortLabel,
  onPending,
  onSent,
  onFailed,
}: ChatComposerProps) {
  const actor = useActor();
  const client = useQueryClient();
  // Callers key the composer by conversation (and thread), so the draft is read once per place.
  const draftKey = conversationId ? chatDraftKey(actor.id, conversationId, threadRootId) : null;
  const [text, setText] = useState(() => readChatDraft(draftKey));
  useEffect(() => {
    writeChatDraft(draftKey, text);
  }, [draftKey, text]);
  const [alsoSend, setAlsoSend] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachmentItem[]>([]);
  const [uploadError, setUploadError] = useState<ApiFailure | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = `composer-${conversationId ?? 'pending'}${threadRootId ? `-thread-${threadRootId}` : ''}`;

  const focusInput = () => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(inputId);
    if (el instanceof HTMLElement) el.focus();
  };

  useEffect(() => {
    if (autoFocus) focusInput();
    // Focus once when the composer appears (the panel opens).
  }, []);

  // Quoting someone else's message in a group starts the text with their mention, which the user may delete.
  useEffect(() => {
    if (!quote) return;
    const authorId = quote.authorUserId;
    if (conversationKind === 'group' && quote.authorKind === 'user' && authorId && authorId !== actor.id) {
      setText((curr) => (curr.includes(`(user:${authorId})`) ? curr : `${mentionToken(quote.authorName ?? '', authorId)} ${curr}`));
    }
    focusInput();
    // Only a newly chosen quote inserts the mention.
  }, [quote?.id]);

  const sendMutation = useMutation<
    ChatMessage,
    ApiFailure,
    { pending: ChatMessage; attachmentIds: string[]; alsoSendToMain: boolean }
  >({
    mutationFn: ({ pending, attachmentIds, alsoSendToMain }) =>
      api.post<ChatMessage>(`/chat/conversations/${encodeURIComponent(conversationId!)}/messages`, {
        id: pending.id,
        body: pending.body,
        ...(pending.replyToMessageId ? { replyToMessageId: pending.replyToMessageId } : {}),
        ...(pending.threadRootId ? { threadRootId: pending.threadRootId } : {}),
        ...(alsoSendToMain ? { alsoSendToMain: true } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      }),
    onSuccess: (saved, vars) => {
      onSent(saved, vars.pending);
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
    onError: (_err, vars) => {
      onFailed(vars.pending.id);
      setText((curr) => (curr ? curr : vars.pending.body));
    },
  });

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!conversationId || picked.length === 0) return;

    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setUploadError(new ApiFailure({ code: 'VALIDATION_FAILED', message: 'Tối đa 5 tệp đính kèm mỗi tin nhắn' }, 422));
      return;
    }
    const filesToUpload = picked.slice(0, remaining);
    if (picked.length > remaining) {
      setUploadError(new ApiFailure({ code: 'VALIDATION_FAILED', message: 'Tối đa 5 tệp đính kèm mỗi tin nhắn' }, 422));
    } else {
      setUploadError(null);
    }

    for (const file of filesToUpload) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setUploadError(new ApiFailure({ code: 'VALIDATION_FAILED', message: `Tệp "${file.name}" vượt quá giới hạn 10 MB` }, 413));
        continue;
      }
      const localId = crypto.randomUUID();
      setAttachments((prev) => [...prev, { localId, fileName: file.name || 'attachment', size: file.size, status: 'uploading' }]);

      void uploadChatAttachment(conversationId, file)
        .then((uploaded) => {
          setAttachments((prev) =>
            prev.map((item) => (item.localId === localId ? { ...item, status: 'uploaded', uploaded } : item)),
          );
        })
        .catch((err) => {
          const msg = err instanceof ApiFailure ? err.message : 'Tải tệp đính kèm thất bại';
          setUploadError(err instanceof ApiFailure ? err : new ApiFailure({ code: 'INTERNAL', message: msg }, 500));
          setAttachments((prev) =>
            prev.map((item) => (item.localId === localId ? { ...item, status: 'error', error: msg } : item)),
          );
        });
    }
  };

  const uploadedAttachments = attachments
    .filter((a): a is PendingAttachmentItem & { uploaded: ChatAttachment } => a.status === 'uploaded' && Boolean(a.uploaded))
    .map((a) => a.uploaded);
  const isUploading = attachments.some((a) => a.status === 'uploading');
  const canSend = Boolean(conversationId) && !disabled;
  const fieldPlaceholder = placeholder ?? (threadRootId ? 'Trả lời trong chuỗi…' : 'Nhập tin nhắn…');

  const handleSend = () => {
    if (!conversationId || !canSend || sendMutation.isPending || isUploading) return;
    const trimmed = text.trim();
    if (!trimmed && uploadedAttachments.length === 0) return;

    const finalBody = trimmed || `[Tệp đính kèm: ${uploadedAttachments.map((a) => a.fileName).join(', ')}]`;
    const alsoSendToMain = Boolean(threadRootId) && showAlsoSend && alsoSend;
    const pending: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      authorKind: 'user',
      authorUserId: actor.id,
      authorAgentId: null,
      authorName: actor.displayName,
      replyToMessageId: quote?.id ?? null,
      // The send response has no quote preview; this local one shows until the list is refetched.
      replyTo: quote
        ? {
            id: quote.id,
            authorName: quote.authorName,
            snippet: formatMentionText(quote.body).slice(0, QUOTE_SNIPPET_MAX),
            deleted: false,
            threadRootId: quote.threadRootId,
          }
        : null,
      threadRootId,
      alsoInMain: alsoSendToMain,
      body: finalBody,
      mentions: [],
      meta: null,
      createdAt: new Date().toISOString(),
      deleted: false,
      attachments: uploadedAttachments,
      thread: null,
    };

    onPending(pending);
    if (conversationId.startsWith('dm-agent:') || AGENT_MENTION_RE.test(finalBody)) {
      onAgentAsked();
    }
    setText('');
    onClearQuote();
    setAttachments([]);
    setUploadError(null);
    sendMutation.mutate({ pending, attachmentIds: uploadedAttachments.map((a) => a.id), alsoSendToMain });
  };

  return (
    <form
      className="inbox-composer"
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
    >
      {thinking && (
        <div className="small muted row" role="status" style={{ gap: 6 }}>
          <Icon name="bot" />
          <span>Trợ lý đang trả lời…</span>
        </div>
      )}

      <FormError error={sendMutation.error ?? uploadError} />

      {quote && (
        <div className="chat-quote-banner">
          <span className="small truncate" style={{ flex: 1 }}>
            Đang trả lời <strong>{quote.authorName ?? 'Nhân viên'}</strong>: {formatMentionText(quote.body)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm icon-btn"
            style={{ minHeight: 24, width: 24 }}
            onClick={onClearQuote}
            aria-label="Hủy trả lời"
            title="Hủy trả lời"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="chips" role="list" aria-label="Tệp đính kèm đang chọn">
          {attachments.map((item) => (
            <span
              key={item.localId}
              role="listitem"
              className="badge"
              data-tone={item.status === 'error' ? 'danger' : item.status === 'uploaded' ? 'accent' : 'neutral'}
              style={{ gap: 6, padding: '3px 8px' }}
            >
              <Icon name="paperclip" style={{ width: 12, height: 12 }} />
              <span className="truncate" style={{ maxWidth: 180 }}>{item.fileName}</span>
              <span className="small muted">
                {item.status === 'uploading'
                  ? 'Đang tải…'
                  : item.status === 'error'
                    ? 'Lỗi'
                    : `(${fmtFileSize(item.size)})`}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm icon-btn"
                style={{ minHeight: 18, width: 18 }}
                onClick={() => setAttachments((prev) => prev.filter((a) => a.localId !== item.localId))}
                aria-label={`Bỏ tệp ${item.fileName}`}
              >
                <Icon name="close" style={{ width: 12, height: 12 }} />
              </button>
            </span>
          ))}
        </div>
      )}

      {threadRootId && showAlsoSend && (
        <label className="row small chat-also-send">
          <input
            type="checkbox"
            checked={alsoSend}
            disabled={!canSend}
            onChange={(e) => setAlsoSend(e.target.checked)}
          />
          <span>Cũng gửi vào nhóm</span>
        </label>
      )}

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelect} />
        <button
          type="button"
          className="btn composer-add-btn"
          disabled={!canSend || attachments.length >= MAX_ATTACHMENTS || sendMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Đính kèm tệp"
          title="Đính kèm tệp (tối đa 5 tệp, mỗi tệp ≤ 10 MB)"
        >
          <Icon name="paperclip" />
        </button>
        <label className="visually-hidden" htmlFor={inputId}>
          {fieldPlaceholder.replace(/…$/, '')}
        </label>
        <MentionInput
          id={inputId}
          value={text}
          onChange={setText}
          onSubmit={handleSend}
          disabled={!canSend}
          agents={agents}
          placeholder={fieldPlaceholder}
        />
        <button
          type="submit"
          className="btn btn-primary composer-send-btn"
          aria-label={sendShortLabel && !sendMutation.isPending ? sendLabel : undefined}
          disabled={!canSend || (!text.trim() && uploadedAttachments.length === 0) || isUploading || sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            'Đang gửi…'
          ) : sendShortLabel ? (
            <>
              <span className="composer-send-full">{sendLabel}</span>
              <span className="composer-send-short">{sendShortLabel}</span>
            </>
          ) : (
            sendLabel
          )}
        </button>
      </div>
      <div className="composer-hint small muted" aria-hidden="true">
        Enter để gửi · Shift+Enter xuống dòng · @ để nhắc tên
      </div>
    </form>
  );
}
