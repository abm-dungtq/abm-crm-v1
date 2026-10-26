import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, currentAuthMode, currentDemoUser, useApi } from '../api';
import { AGENT_THINKING_EVENT, useChatSocketConnected } from '../chat-socket';
import { fmtDateTime } from '../format';
import type {
  ChatAgentItem,
  ChatAttachment,
  ChatConversationDetail,
  ChatMessage,
  ChatTaskSuggestion,
} from '../types';
import { Icon } from './icons';
import { MentionInput, formatMentionText, renderMessageBody } from './mention-input';
import { TaskFormDialog } from './task-form-dialog';
import { Avatar, Badge, Empty, ErrorState, FormError, ImageLightbox, Loading, Modal, useToast } from './ui';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const AGENT_THINKING_TTL_MS = 2 * 60 * 1000;
const AGENT_MENTION_RE = /@\[[^\]]+\]\(agent:[^)\s]+\)/;

interface TaskCommentsBootstrap {
  conversationId: string;
  messages: ChatMessage[];
  isMember?: boolean;
}

interface PendingAttachmentItem {
  localId: string;
  fileName: string;
  size: number;
  status: 'uploading' | 'uploaded' | 'error';
  uploaded?: ChatAttachment;
  error?: string;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType.toLowerCase());
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

export interface ChatThreadProps {
  conversationId?: string;
  listPath?: string;
  postPath?: string;
  readPath?: string;
  embedded?: boolean;
}

export function ChatThread({
  conversationId,
  listPath,
  embedded = false,
}: ChatThreadProps) {
  const actor = useActor();
  const client = useQueryClient();
  const toast = useToast();
  const connected = useChatSocketConnected();

  // Task detail passes `listPath="/tasks/:id/comments"`, which ensures the task conversation exists and returns `conversationId`.
  const bootstrap = useApi<TaskCommentsBootstrap>(conversationId ? null : (listPath ?? null));
  const resolvedId = conversationId ?? bootstrap.data?.conversationId ?? null;
  const [joinedAsMember, setJoinedAsMember] = useState(false);
  const isMember = conversationId ? true : (joinedAsMember || (bootstrap.data?.isMember ?? true));

  const convDetailQuery = useQuery<ChatConversationDetail, ApiFailure>({
    queryKey: ['chat', 'conversation', resolvedId],
    queryFn: () => api.get<ChatConversationDetail>(`/chat/conversations/${encodeURIComponent(resolvedId!)}`),
    enabled: Boolean(resolvedId),
    refetchInterval: connected ? false : 60_000,
  });

  const conversationAgents = useMemo(
    () => (convDetailQuery.data?.agents ?? []).filter((a) => a.enabled !== false),
    [convDetailQuery.data],
  );

  const q = useQuery<ChatMessage[], ApiFailure>({
    queryKey: ['chat', resolvedId],
    queryFn: () => api.get<ChatMessage[]>(`/chat/conversations/${encodeURIComponent(resolvedId!)}/messages`),
    enabled: Boolean(resolvedId),
    initialData: () =>
      !conversationId && bootstrap.data && bootstrap.data.conversationId === resolvedId
        ? bootstrap.data.messages
        : undefined,
    refetchInterval: !isMember ? 30_000 : connected ? false : 60_000,
  });

  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachmentItem[]>([]);
  const [uploadError, setUploadError] = useState<ApiFailure | null>(null);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [thinkingUntil, setThinkingUntil] = useState<number | null>(null);
  const [suggestionToCreate, setSuggestionToCreate] = useState<ChatTaskSuggestion | null>(null);
  const [taskAgentModalOpen, setTaskAgentModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<string | null>(null);

  useEffect(() => {
    lastReadRef.current = null;
    setJoinedAsMember(false);
    setOptimistic([]);
    setReplyingTo(null);
    setAttachments([]);
    setUploadError(null);
    setLightboxImage(null);
    setThinkingUntil(null);
    setSuggestionToCreate(null);
    setTaskAgentModalOpen(false);
  }, [resolvedId]);

  useEffect(() => {
    if (!resolvedId || typeof window === 'undefined') return;
    const onAgentThinking = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId === resolvedId) {
        setThinkingUntil(Date.now() + AGENT_THINKING_TTL_MS);
      }
    };
    window.addEventListener(AGENT_THINKING_EVENT, onAgentThinking);
    return () => window.removeEventListener(AGENT_THINKING_EVENT, onAgentThinking);
  }, [resolvedId]);

  const messages = useMemo(() => {
    const serverList = q.data ?? [];
    const seen = new Set(serverList.map((m) => m.id));
    const merged = [...serverList, ...optimistic.filter((m) => !seen.has(m.id))];
    return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }, [q.data, optimistic]);

  const { rootMessages, repliesByParent, messageById } = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m]));
    const findRootId = (msg: ChatMessage): string | null => {
      if (!msg.parentMessageId || !byId.has(msg.parentMessageId)) return null;
      let curr = msg.parentMessageId;
      const visited = new Set<string>([msg.id]);
      while (curr && byId.has(curr) && !visited.has(curr)) {
        visited.add(curr);
        const parent = byId.get(curr)!;
        if (!parent.parentMessageId || !byId.has(parent.parentMessageId)) {
          return curr;
        }
        curr = parent.parentMessageId;
      }
      return msg.parentMessageId;
    };

    const roots: ChatMessage[] = [];
    const replies = new Map<string, ChatMessage[]>();
    for (const m of messages) {
      const rootId = findRootId(m);
      if (!rootId) {
        roots.push(m);
      } else {
        const list = replies.get(rootId) ?? [];
        list.push(m);
        replies.set(rootId, list);
      }
    }
    return { rootMessages: roots, repliesByParent: replies, messageById: byId };
  }, [messages]);

  const newest = messages.at(-1);

  useEffect(() => {
    if (!newest) return;
    if (newest.authorKind === 'agent' || newest.id.startsWith('agent-failed:')) {
      setThinkingUntil(null);
    }
  }, [newest]);

  useEffect(() => {
    if (!thinkingUntil) return;
    const remaining = thinkingUntil - Date.now();
    if (remaining <= 0) {
      setThinkingUntil(null);
      return;
    }
    const timer = setTimeout(() => setThinkingUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [thinkingUntil]);

  const isAgentThinking = Boolean(thinkingUntil && thinkingUntil > Date.now());

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, resolvedId]);

  useEffect(() => {
    if (!resolvedId || !isMember || !newest || lastReadRef.current === newest.createdAt) return;
    const targetAt = newest.createdAt;
    const timer = setTimeout(() => {
      lastReadRef.current = targetAt;
      void api
        .post(`/chat/conversations/${encodeURIComponent(resolvedId)}/read`, { at: targetAt })
        .then(() => {
          void client.invalidateQueries({ queryKey: ['chat', 'unread'] });
          void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        })
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [newest, resolvedId, isMember, client]);

  const sendMutation = useMutation<
    ChatMessage,
    ApiFailure,
    { id: string; body: string; parentMessageId?: string | null; attachmentIds?: string[]; uploadedItems?: ChatAttachment[] }
  >({
    mutationFn: ({ id, body, parentMessageId, attachmentIds }) =>
      api.post<ChatMessage>(`/chat/conversations/${encodeURIComponent(resolvedId!)}/messages`, {
        id,
        body,
        ...(parentMessageId ? { parentMessageId } : {}),
        ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      }),
    onSuccess: (saved, vars) => {
      setJoinedAsMember(true);
      const enriched: ChatMessage = {
        ...saved,
        authorName: saved.authorName ?? actor.displayName,
        attachments: saved.attachments?.length ? saved.attachments : (vars.uploadedItems ?? []),
      };
      client.setQueryData<ChatMessage[]>(['chat', resolvedId], (prev) => {
        if (!prev) return [enriched];
        const exists = prev.some((m) => m.id === enriched.id);
        return exists ? prev.map((m) => (m.id === enriched.id ? enriched : m)) : [...prev, enriched];
      });
      setOptimistic((prev) => prev.filter((m) => m.id !== saved.id));
      void client.invalidateQueries({ queryKey: ['chat', resolvedId] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
    onError: (_err, vars) => {
      setOptimistic((prev) => prev.filter((m) => m.id !== vars.id));
      setText((curr) => (curr ? curr : vars.body));
    },
  });

  const deleteMutation = useMutation<{ id: string; conversationId: string; deleted: boolean }, ApiFailure, string>({
    mutationFn: (messageId) => api.delete(`/chat/messages/${encodeURIComponent(messageId)}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['chat', resolvedId] });
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
  });

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!resolvedId || picked.length === 0) return;

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
      const pendingItem: PendingAttachmentItem = {
        localId,
        fileName: file.name || 'attachment',
        size: file.size,
        status: 'uploading',
      };
      setAttachments((prev) => [...prev, pendingItem]);

      void uploadChatAttachment(resolvedId, file)
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

  const removeAttachment = (localId: string) => {
    setAttachments((prev) => prev.filter((item) => item.localId !== localId));
  };

  const uploadedAttachments = attachments
    .filter((a): a is PendingAttachmentItem & { uploaded: ChatAttachment } => a.status === 'uploaded' && Boolean(a.uploaded))
    .map((a) => a.uploaded);
  const isUploading = attachments.some((a) => a.status === 'uploading');

  const handleSend = () => {
    if (!resolvedId || sendMutation.isPending || isUploading) return;
    const trimmed = text.trim();
    if (!trimmed && uploadedAttachments.length === 0) return;

    const finalBody =
      trimmed || `[Tệp đính kèm: ${uploadedAttachments.map((a) => a.fileName).join(', ')}]`;
    const id = crypto.randomUUID();
    const parentId = replyingTo?.id ?? null;
    const attachmentIds = uploadedAttachments.map((a) => a.id);

    const pendingMsg: ChatMessage = {
      id,
      conversationId: resolvedId,
      authorKind: 'user',
      authorUserId: actor.id,
      authorAgentId: null,
      authorName: actor.displayName,
      parentMessageId: parentId,
      body: finalBody,
      mentions: [],
      meta: null,
      createdAt: new Date().toISOString(),
      deleted: false,
      attachments: uploadedAttachments,
    };

    setOptimistic((prev) => [...prev, pendingMsg]);
    if (resolvedId.startsWith('dm-agent:') || AGENT_MENTION_RE.test(finalBody)) {
      setThinkingUntil(Date.now() + AGENT_THINKING_TTL_MS);
    }
    setText('');
    setReplyingTo(null);
    setAttachments([]);
    setUploadError(null);
    sendMutation.mutate({
      id,
      body: finalBody,
      parentMessageId: parentId,
      attachmentIds,
      uploadedItems: uploadedAttachments,
    });
  };

  if (!conversationId && bootstrap.isLoading) return <Loading rows={3} />;
  if (!conversationId && bootstrap.error) return <ErrorState error={bootstrap.error} onRetry={() => bootstrap.refetch()} />;
  if (q.isLoading) return <Loading rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const renderSingleMessage = (m: ChatMessage, isReply = false) => {
    const isMine = m.authorKind === 'user' && m.authorUserId === actor.id;
    const isPending = optimistic.some((o) => o.id === m.id);
    const sender =
      m.authorName ?? (m.authorKind === 'agent' ? 'Trợ lý' : m.authorKind === 'system' ? 'Hệ thống' : 'Nhân viên');
    const msgAttachments = m.deleted ? [] : (m.attachments ?? []);
    const imageAtts = msgAttachments.filter((a) => isInlineImage(a.contentType));
    const fileAtts = msgAttachments.filter((a) => !isInlineImage(a.contentType));
    const directParent = m.parentMessageId ? messageById.get(m.parentMessageId) : undefined;

    if (m.authorKind === 'system') {
      const metaLink = !m.deleted && typeof m.meta?.link === 'string' ? m.meta.link : null;
      return (
        <li
          key={m.id}
          className="msg-system muted small"
          role="note"
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

    const taskSuggestions =
      !m.deleted && Array.isArray(m.meta?.taskSuggestions)
        ? (m.meta.taskSuggestions as ChatTaskSuggestion[])
        : [];
    const requestedByUserId =
      !m.deleted && typeof m.meta?.requestedByUserId === 'string' ? m.meta.requestedByUserId : null;
    const replies = !isReply ? (repliesByParent.get(m.id) ?? []) : [];

    return (
      <li key={m.id} className="stack-sm" style={{ alignItems: isMine ? 'flex-end' : 'flex-start' }}>
        <div
          className={isMine ? 'msg' : 'msg msg-with-avatar'}
          data-side={isMine ? 'out' : 'in'}
          data-kind={m.authorKind === 'agent' ? 'bot' : undefined}
          data-status={isPending ? 'pending' : undefined}
        >
          {!isMine && <Avatar name={sender} />}
          <div className="msg-stack">
            <div className="msg-bubble">
              {isReply && directParent && (
                <div
                  className="small muted truncate"
                  style={{
                    borderLeft: '2px solid var(--border-strong)',
                    paddingLeft: 6,
                    marginBottom: 2,
                    maxWidth: 320,
                  }}
                >
                  Trả lời {directParent.authorName ?? 'tin nhắn'}:{' '}
                  {directParent.deleted ? 'Tin nhắn đã thu hồi' : formatMentionText(directParent.body)}
                </div>
              )}
              <div className="msg-body">
                {m.deleted ? (
                  <span className="muted">Tin nhắn đã thu hồi</span>
                ) : (
                  renderMessageBody(m.body, actor.id)
                )}
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
                  <a
                    key={att.id}
                    className="msg-attachment"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
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
                    style={{
                      padding: '8px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      maxWidth: 380,
                    }}
                  >
                    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{s.title}</div>
                        <div className="small muted">
                          Phụ trách: {s.assigneeName || '—'} · Hạn: {s.dueDate || 'Chưa đặt hạn'}
                        </div>
                      </div>
                      {requestedByUserId === actor.id && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary nowrap"
                          onClick={() => setSuggestionToCreate(s)}
                        >
                          Tạo việc
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
              {isPending && <span className="msg-state">Đang gửi…</span>}
              {!m.deleted && !isPending && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ minHeight: 22, padding: '0 6px', fontSize: 11.5 }}
                  onClick={() => setReplyingTo(m)}
                >
                  Trả lời
                </button>
              )}
              {isMine && !m.deleted && !isPending && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm muted"
                  style={{ minHeight: 22, padding: '0 6px', fontSize: 11.5 }}
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(m.id)}
                >
                  Thu hồi
                </button>
              )}
            </div>
          </div>
        </div>

        {replies.length > 0 && (
          <ol
            className="msg-list"
            aria-label="Phản hồi trong luồng"
            style={{
              width: '100%',
              paddingLeft: 24,
              borderLeft: '2px solid var(--border-strong)',
              marginLeft: isMine ? 0 : 12,
            }}
          >
            {replies.map((reply) => renderSingleMessage(reply, true))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <div
      className="inbox-thread"
      style={
        embedded
          ? { flex: 1, minHeight: 0 }
          : {
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              background: 'var(--surface)',
            }
      }
    >
      {!embedded && resolvedId && (
        <div
          className="row"
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            justifyContent: 'space-between',
          }}
        >
          <div className="row-wrap small" style={{ gap: 6 }}>
            <span className="muted">Trợ lý trong luồng:</span>
            {conversationAgents.length === 0 ? (
              <span className="muted">Chưa có</span>
            ) : (
              conversationAgents.map((a) => (
                <Badge key={a.id} tone="accent">
                  @{a.name}
                </Badge>
              ))
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setTaskAgentModalOpen(true)}>
            <Icon name="bot" />
            <span>Thêm trợ lý</span>
          </button>
        </div>
      )}

      <div
        ref={listRef}
        className="inbox-messages"
        style={embedded ? undefined : { maxHeight: 420, minHeight: 220 }}
        aria-label="Danh sách tin nhắn"
      >
        {rootMessages.length === 0 ? (
          <Empty title="Chưa có tin nhắn" icon="message">
            Gửi tin nhắn đầu tiên để bắt đầu trao đổi.
          </Empty>
        ) : (
          <ol className="msg-list">
            {rootMessages.map((m) => renderSingleMessage(m, false))}
          </ol>
        )}
        {isAgentThinking && (
          <div className="small muted row" role="status" style={{ padding: '6px 12px', gap: 6 }}>
            <Icon name="bot" />
            <span>Trợ lý đang trả lời…</span>
          </div>
        )}
      </div>

      <form
        className="inbox-composer"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <FormError error={sendMutation.error ?? uploadError ?? deleteMutation.error} />

        {replyingTo && (
          <div
            className="row"
            style={{
              padding: '4px 8px',
              background: 'var(--surface-2)',
              borderLeft: '3px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <span className="small truncate" style={{ flex: 1 }}>
              Đang trả lời <strong>{replyingTo.authorName ?? 'Nhân viên'}</strong>:{' '}
              {formatMentionText(replyingTo.body)}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm icon-btn"
              style={{ minHeight: 24, width: 24 }}
              onClick={() => setReplyingTo(null)}
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
                  onClick={() => removeAttachment(item.localId)}
                  aria-label={`Bỏ tệp ${item.fileName}`}
                >
                  <Icon name="close" style={{ width: 12, height: 12 }} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={handleFileSelect}
          />
          <button
            type="button"
            className="btn composer-add-btn"
            disabled={!resolvedId || attachments.length >= MAX_ATTACHMENTS || sendMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Đính kèm tệp"
            title="Đính kèm tệp (tối đa 5 tệp, mỗi tệp ≤ 10 MB)"
          >
            <Icon name="paperclip" />
          </button>
          <label className="visually-hidden" htmlFor={`composer-${resolvedId ?? 'pending'}`}>
            Nhập tin nhắn
          </label>
          <MentionInput
            id={`composer-${resolvedId ?? 'pending'}`}
            value={text}
            onChange={setText}
            onSubmit={handleSend}
            disabled={!resolvedId}
            agents={conversationAgents}
            placeholder="Nhập tin nhắn… Gõ @ để nhắc tên (Enter gửi, Shift+Enter xuống dòng)"
          />
          <button
            type="submit"
            className="btn btn-primary composer-send-btn"
            disabled={
              !resolvedId ||
              (!text.trim() && uploadedAttachments.length === 0) ||
              isUploading ||
              sendMutation.isPending
            }
          >
            {sendMutation.isPending ? 'Đang gửi…' : 'Gửi'}
          </button>
        </div>
      </form>

      <ImageLightbox
        src={lightboxImage?.src ?? null}
        alt={lightboxImage?.alt}
        onClose={() => setLightboxImage(null)}
      />

      <TaskFormDialog
        open={Boolean(suggestionToCreate)}
        onClose={() => setSuggestionToCreate(null)}
        initialValues={suggestionToCreate ? {
          title: suggestionToCreate.title,
          assigneeUserId: suggestionToCreate.assigneeUserId,
          // The agent proposes a day only; 09:00 Vietnam time is the default hour, as for the quick picks.
          due: suggestionToCreate.dueDate ? `${suggestionToCreate.dueDate}T09:00` : null,
        } : undefined}
      />

      {!embedded && resolvedId && (
        <ConversationAgentsDialog
          open={taskAgentModalOpen}
          onClose={() => setTaskAgentModalOpen(false)}
          conversationId={resolvedId}
          currentAgents={convDetailQuery.data?.agents ?? []}
          onUpdated={() => {
            void client.invalidateQueries({ queryKey: ['chat', 'conversation', resolvedId] });
            toast('Đã cập nhật trợ lý trong hội thoại');
          }}
        />
      )}
    </div>
  );
}

export function ConversationAgentsDialog({
  open,
  onClose,
  conversationId,
  currentAgents,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  currentAgents: ChatAgentItem[];
  onUpdated?: () => void;
}) {
  const allAgents = useApi<ChatAgentItem[]>(open ? '/chat/agents' : null);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  useEffect(() => {
    if (!open) setSelectedAgentId('');
  }, [open]);

  const addMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (agentId) =>
      api.post(`/chat/conversations/${encodeURIComponent(conversationId)}/agents`, { agentId }),
    onSuccess: () => {
      setSelectedAgentId('');
      onUpdated?.();
    },
  });

  const removeMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (agentId) =>
      api.delete(`/chat/conversations/${encodeURIComponent(conversationId)}/agents/${encodeURIComponent(agentId)}`),
    onSuccess: () => {
      onUpdated?.();
    },
  });

  const existingIds = new Set(currentAgents.map((a) => a.id));
  const candidates = (allAgents.data ?? []).filter((a) => a.canGroup && !existingIds.has(a.id));

  return (
    <Modal open={open} title="Thêm trợ lý" onClose={onClose}>
      <div className="stack">
        <FormError error={addMutation.error ?? removeMutation.error} />

        {candidates.length > 0 ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedAgentId) addMutation.mutate(selectedAgentId);
            }}
          >
            <select
              aria-label="Chọn trợ lý để thêm"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              <option value="">— Chọn trợ lý —</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!selectedAgentId || addMutation.isPending}
            >
              Thêm trợ lý
            </button>
          </form>
        ) : (
          <div className="small muted">Không còn trợ lý nhóm nào chưa thêm.</div>
        )}

        {currentAgents.length > 0 && (
          <ul className="list">
            {currentAgents.map((a) => (
              <li key={a.id} className="row" style={{ padding: '8px 4px' }}>
                <Avatar name={a.name} />
                <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>
                  {a.name}
                </span>
                <Badge tone="accent">Trợ lý</Badge>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(a.id)}
                >
                  Xóa
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
