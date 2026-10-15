import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelKind, ConversationMode } from '@abm/contracts';
import { ApiFailure, listMessages, sendMessage, setMode, uploadInboxMedia } from '../api';
import { fmtDateTime } from '../format';
import { compressImage, IMAGE_DECODE_ERROR } from '../image-compress';
import { canChannelSendImages, conversationChannelLabel, mergeMessages, senderLabel } from '../inbox-format';
import type { InboxConversation, InboxMessage, SendMessageResult, SetModeResult, UploadedInboxMedia } from '../types';
import { Icon } from './icons';
import { Avatar, Badge, ChannelBadge, ErrorState, FormError, ImageLightbox, Loading, SegmentedControl, useToast, type Tone } from './ui';

/** Same limit as the Worker's staff send. */
export const STAFF_TEXT_MAX = 2000;
/** Maximum images per staff message. */
export const STAFF_IMAGE_MAX = 4;
export { canChannelSendImages };
/** Open conversation polling interval. */
const THREAD_POLL_MS = 3000;
/** While an outgoing message is still pending, every n-th poll reloads the page so status changes (sent, failed) show. */
const STATUS_REFRESH_EVERY = 5;

export const MODE_LABEL: Record<ConversationMode, [string, Tone]> = {
  ai: ['AI', 'agent'],
  human: ['Nhân viên', 'accent'],
  paused: ['Tạm dừng', 'warn'],
};
export const ModeBadge = ({ mode }: { mode: ConversationMode }) => <Badge tone={MODE_LABEL[mode][1]} dot>{MODE_LABEL[mode][0]}</Badge>;

const MODE_SEGMENT_OPTIONS: { value: ConversationMode; label: string }[] = [
  { value: 'ai', label: 'AI' },
  { value: 'human', label: 'Nhân viên' },
  { value: 'paused', label: 'Tạm dừng' },
];
const MODE_DONE_TOAST: Record<ConversationMode, string> = {
  ai: 'Đã trả hội thoại cho AI',
  human: 'Đã tiếp quản hội thoại',
  paused: 'Đã tạm dừng hội thoại',
};

export const channelLabel = (c: Pick<InboxConversation, 'channel' | 'accountName'>) => conversationChannelLabel(c);
export const conversationName = (c: Pick<InboxConversation, 'displayName' | 'kind'>) =>
  c.displayName?.trim() || (c.kind === 'group' ? 'Nhóm chưa đặt tên' : 'Khách chưa rõ tên');

const TZ = 'Asia/Ho_Chi_Minh';
const timeOnly = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayMonth = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** "14:30" for today, "07/10" otherwise, in Vietnam time. */
export function fmtShortTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return dayKey.format(d) === dayKey.format(new Date()) ? timeOnly.format(d) : dayMonth.format(d);
}

export const messagesKey = (conversationId: string) => ['inbox', 'messages', conversationId] as const;

/**
 * Messages of the open conversation: the latest page first, then only what is newer (`after`). Polling pauses
 * while the tab is hidden (`refetchIntervalInBackground: false` checks `document.visibilityState`).
 */
function useThreadMessages(conversationId: string) {
  const client = useQueryClient();
  const ticks = useRef(0);
  return useQuery<InboxMessage[], ApiFailure>({
    queryKey: messagesKey(conversationId),
    queryFn: async () => {
      const prev = client.getQueryData<InboxMessage[]>(messagesKey(conversationId));
      ticks.current += 1;
      const last = prev?.at(-1);
      const reloadStatuses = prev?.some((m) => m.status === 'pending') && ticks.current % STATUS_REFRESH_EVERY === 0;
      if (!prev || !last || reloadStatuses) return mergeMessages(prev ?? [], await listMessages(conversationId));
      return mergeMessages(prev, await listMessages(conversationId, last.createdAt));
    },
    refetchInterval: THREAD_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export interface Attachment { url: string; name?: string; mimeType?: string }

const IMAGE_PLACEHOLDER_BODIES = new Set(['', '[Hình ảnh]', '[Tệp đính kèm]', '[Ảnh]']);

/** Only http(s) links or root-relative media paths (e.g. /api/inbox/media/<key>) are rendered. */
export function parseAttachments(json: string | null): Attachment[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.flatMap((a: unknown) => {
      if (!a || typeof a !== 'object') return [];
      const { url, name, mimeType } = a as { url?: unknown; name?: unknown; mimeType?: unknown };
      if (typeof url !== 'string' || !/^(https?:\/\/|\/(?!\/))/i.test(url)) return [];
      const cleanMime = typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : undefined;
      return [{
        url,
        name: typeof name === 'string' && name ? name : undefined,
        mimeType: cleanMime,
      }];
    });
  } catch {
    return [];
  }
}

export function isImageAttachment(a: Attachment): boolean {
  if (a.mimeType) {
    return a.mimeType.toLowerCase().startsWith('image/');
  }
  try {
    const parsed = new URL(a.url, 'https://crm.local');
    const path = parsed.pathname.toLowerCase();
    if (/\.(jpe?g|png|gif|webp)$/i.test(path)) return true;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'zdn.vn' ||
      host.endsWith('.zdn.vn') ||
      host === 'fbcdn.net' ||
      host.endsWith('.fbcdn.net') ||
      host === 'fbsbx.com' ||
      host.endsWith('.fbsbx.com')
    );
  } catch {
    return /\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(a.url);
  }
}

function MessageBubble({
  message: m,
  channel,
  kind,
  onOpenImage,
}: {
  message: InboxMessage;
  channel: ChannelKind;
  kind: 'direct' | 'group';
  onOpenImage: (img: { src: string; alt: string }) => void;
}) {
  const [brokenImages, setBrokenImages] = useState<Record<number, boolean>>({});
  const time = <time dateTime={m.createdAt} title={fmtDateTime(m.createdAt, true)}>{fmtShortTime(m.createdAt)}</time>;
  if (m.senderKind === 'system') {
    return <li className="msg-system" role="note"><span>{m.body}</span> · {time}</li>;
  }
  const attachments = parseAttachments(m.attachmentsJson);
  const imageItems = attachments
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => isImageAttachment(a));
  const fileItems = attachments
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => !isImageAttachment(a));
  const visibleImages = imageItems.filter(({ index }) => !brokenImages[index]);
  const failedImages = imageItems.filter(({ index }) => Boolean(brokenImages[index]));
  const hasAnyImage = imageItems.length > 0;
  const trimmedBody = m.body.trim();
  const showBody = Boolean(m.body) && !(hasAnyImage && IMAGE_PLACEHOLDER_BODIES.has(trimmedBody));
  const imageAlt = m.senderKind === 'customer' ? 'Ảnh khách gửi' : 'Ảnh đã gửi';
  const label = senderLabel(m, channel);
  const showSender = kind === 'group' && m.senderKind === 'customer';
  const content = (
    <>
      <div className="msg-bubble">
        {showBody && <div className="msg-body">{m.body}</div>}
        {visibleImages.length > 0 && (
          <div className="msg-images" data-grid={visibleImages.length > 1 ? 'true' : undefined}>
            {visibleImages.map(({ a, index }) => (
              <button
                key={index}
                type="button"
                className="msg-image-btn"
                onClick={() => onOpenImage({ src: a.url, alt: imageAlt })}
                aria-label={`Xem lớn: ${imageAlt}`}
              >
                <img
                  className="msg-image"
                  src={a.url}
                  alt={imageAlt}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenImages((prev) => ({ ...prev, [index]: true }))}
                />
              </button>
            ))}
          </div>
        )}
        {failedImages.map(({ a, index }) => (
          <a key={`err-${index}`} className="msg-attachment" href={a.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external-link" />Mở ảnh
          </a>
        ))}
        {fileItems.map(({ a, index }) => (
          <a key={`file-${index}`} className="msg-attachment" href={a.url} target="_blank" rel="noopener noreferrer">
            <Icon name="file" />{a.name ?? 'Tệp đính kèm'}
          </a>
        ))}
      </div>
      <div className="msg-meta">
        {m.senderKind === 'bot' && <Icon name="bot" />}
        {m.senderKind === 'staff_phone' && <Icon name={channel === 'facebook' ? 'message' : 'phone'} />}
        {label && <span className="msg-sender">{label}</span>}
        {time}
        {m.status === 'pending' && <span className="msg-state">Đang gửi</span>}
        {m.status === 'failed' && <span className="msg-state msg-failed"><Icon name="alert" />Gửi lỗi</span>}
      </div>
    </>
  );
  if (!showSender) {
    return <li className="msg" data-side={m.senderKind === 'customer' ? 'in' : 'out'} data-kind={m.senderKind} data-status={m.status}>{content}</li>;
  }
  return (
    <li className="msg msg-with-avatar" data-side="in" data-kind="customer" data-status={m.status}>
      <Avatar name={m.senderDisplayName} src={m.senderAvatarUrl} />
      <div className="msg-stack">{content}</div>
    </li>
  );
}

interface ComposerImageItem {
  id: string;
  name: string;
  previewUrl: string;
  status: 'uploading' | 'uploaded' | 'error';
  uploaded?: UploadedInboxMedia;
  error?: string;
}

interface PendingSendPayload {
  id: string;
  text: string;
  attachments: { key: string; previewUrl: string; url: string; name: string; mimeType: string }[];
  keysSig: string;
}

const IMAGE_LIMIT_MESSAGE = 'Chỉ được đính kèm tối đa 4 ảnh trong một tin nhắn';

function isCandidateImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

function toFormError(err: unknown): ApiFailure {
  if (err instanceof ApiFailure) return err;
  const message = err instanceof Error && err.message ? err.message : IMAGE_DECODE_ERROR;
  return new ApiFailure({ code: 'VALIDATION_FAILED', message }, 422);
}

function Composer({ conversationId, channel }: { conversationId: string; channel: ChannelKind }) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [images, setImages] = useState<ComposerImageItem[]>([]);
  const [composerError, setComposerError] = useState<ApiFailure | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<ComposerImageItem[]>([]);
  const activeIdsRef = useRef<Set<string>>(new Set());
  /** Id of the message being composed; a retry of the same text + attachments reuses it, so the server sends it once. */
  const pending = useRef<PendingSendPayload | null>(null);

  const canSendImages = canChannelSendImages(channel);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Revoke any remaining object URLs on unmount.
  useEffect(() => {
    return () => {
      activeIdsRef.current.clear();
      for (const item of imagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
      imagesRef.current = [];
    };
  }, []);

  const clearImages = useCallback(() => {
    activeIdsRef.current.clear();
    for (const item of imagesRef.current) {
      URL.revokeObjectURL(item.previewUrl);
    }
    imagesRef.current = [];
    setImages([]);
  }, []);

  const removeImage = useCallback((id: string) => {
    activeIdsRef.current.delete(id);
    setImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((item) => item.id !== id);
      imagesRef.current = next;
      const firstRemainingError = next.find((item) => item.status === 'error' && item.error);
      setComposerError(firstRemainingError ? toFormError(new Error(firstRemainingError.error)) : null);
      return next;
    });
  }, []);

  const processAndUpload = useCallback(async (id: string, file: File) => {
    try {
      const compressed = await compressImage(file);
      if (!activeIdsRef.current.has(id)) return;
      const uploaded = await uploadInboxMedia(compressed.blob, compressed.filename);
      if (!activeIdsRef.current.has(id)) return;
      setImages((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, status: 'uploaded' as const, uploaded, error: undefined } : item,
        );
        imagesRef.current = next;
        return next;
      });
    } catch (err) {
      if (!activeIdsRef.current.has(id)) return;
      const failure = toFormError(err);
      setComposerError(failure);
      setImages((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, status: 'error' as const, error: failure.message } : item,
        );
        imagesRef.current = next;
        return next;
      });
    }
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (!canSendImages || !incoming.length) return;
      const currentCount = imagesRef.current.length;
      const remaining = STAFF_IMAGE_MAX - currentCount;
      if (incoming.length > remaining) {
        setComposerError(new ApiFailure({ code: 'VALIDATION_FAILED', message: IMAGE_LIMIT_MESSAGE }, 422));
      } else {
        const existingError = imagesRef.current.find((item) => item.status === 'error' && item.error);
        if (!existingError) setComposerError(null);
      }
      if (remaining <= 0) return;

      const selected = incoming.slice(0, remaining);
      const pairs = selected.map((file) => {
        const id = crypto.randomUUID();
        activeIdsRef.current.add(id);
        const item: ComposerImageItem = {
          id,
          name: file.name || 'image.jpg',
          previewUrl: URL.createObjectURL(file),
          status: 'uploading',
        };
        return { file, item };
      });

      const nextList = [...imagesRef.current, ...pairs.map((p) => p.item)];
      imagesRef.current = nextList;
      setImages(nextList);

      for (const { file, item } of pairs) {
        void processAndUpload(item.id, file);
      }
    },
    [canSendImages, processAndUpload],
  );

  const send = useMutation<SendMessageResult, ApiFailure, PendingSendPayload>({
    mutationFn: (message) =>
      sendMessage(
        conversationId,
        message.text,
        message.id,
        message.attachments.length ? message.attachments.map((a) => ({ key: a.key })) : undefined,
      ),
    onMutate: async (message) => {
      await client.cancelQueries({ queryKey: messagesKey(conversationId) });
      const optimisticId = `optimistic-${message.id}`;
      client.setQueryData<InboxMessage[]>(messagesKey(conversationId), (old) => {
        if (!old) return old;
        const lastCreatedAt = old.at(-1)?.createdAt ?? new Date().toISOString();
        const optimistic: InboxMessage = {
          id: optimisticId,
          direction: 'out',
          senderKind: 'staff_web',
          senderExternalId: null,
          sentByUserId: null,
          sentByName: null,
          externalMsgId: null,
          body: message.text || (message.attachments.length ? '[Tệp đính kèm]' : ''),
          attachmentsJson: message.attachments.length
            ? JSON.stringify(
                message.attachments.map((a) => ({
                  url: a.url,
                  name: a.name,
                  mimeType: a.mimeType,
                })),
              )
            : null,
          status: 'pending',
          createdAt: lastCreatedAt,
        };
        return [...old.filter((m) => m.id !== optimisticId), optimistic];
      });
    },
    onSuccess: () => {
      pending.current = null;
      setText('');
      setComposerError(null);
      clearImages();
    },
    // Refresh at once either way: a request whose response was lost may still have queued the message.
    onSettled: async (_data, _error, message) => {
      const optimisticId = `optimistic-${message.id}`;
      client.setQueryData<InboxMessage[]>(messagesKey(conversationId), (old) =>
        old?.filter((m) => m.id !== optimisticId),
      );
      await client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });

  const trimmed = text.trim();
  const isUploading = images.some((item) => item.status === 'uploading');
  const uploadedImages = images.filter(
    (item): item is ComposerImageItem & { uploaded: UploadedInboxMedia } =>
      item.status === 'uploaded' && Boolean(item.uploaded),
  );
  const canSubmit =
    (Boolean(trimmed) || uploadedImages.length > 0) &&
    trimmed.length <= STAFF_TEXT_MAX &&
    !isUploading &&
    !send.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const attachments = uploadedImages.map((item) => ({
      key: item.uploaded.key,
      previewUrl: item.previewUrl,
      url: item.uploaded.url,
      name: item.name,
      mimeType: item.uploaded.mimeType,
    }));
    const keysSig = attachments.map((a) => a.key).join(',');
    if (
      !pending.current ||
      pending.current.text !== trimmed ||
      pending.current.keysSig !== keysSig
    ) {
      pending.current = { id: crypto.randomUUID(), text: trimmed, attachments, keysSig };
    } else {
      pending.current = { ...pending.current, attachments };
    }
    send.mutate(pending.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Vietnamese IMEs confirm a word with Enter; only a plain Enter outside composition sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canSendImages) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    let files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null && isCandidateImageFile(f));
    if (!files.length && e.clipboardData?.files?.length) {
      files = Array.from(e.clipboardData.files).filter(isCandidateImageFile);
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDragOver = (e: DragEvent<HTMLFormElement>) => {
    if (!canSendImages) return;
    if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
      e.preventDefault();
      if (!dragOver) setDragOver(true);
    }
  };

  const onDragLeave = (e: DragEvent<HTMLFormElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    if (!canSendImages) return;
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter(isCandidateImageFile);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  return (
    <form
      className="inbox-composer"
      data-drag={dragOver ? 'true' : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <FormError error={send.error ?? composerError} />
      {images.length > 0 && (
        <div className="composer-strip" role="list" aria-label="Ảnh đính kèm">
          {images.map((item) => (
            <div
              key={item.id}
              className="composer-thumb"
              role="listitem"
              data-status={item.status}
              title={item.error ?? item.name}
            >
              <img src={item.previewUrl} alt={item.name} />
              {item.status === 'uploading' && (
                <span className="composer-thumb-state" role="status" aria-label="Đang tải ảnh">
                  <span className="composer-spinner" aria-hidden="true" />
                </span>
              )}
              {item.status === 'error' && (
                <span className="composer-thumb-state composer-thumb-error" role="status" aria-label={item.error ?? 'Lỗi tải ảnh'}>
                  <Icon name="alert" />
                </span>
              )}
              <button
                type="button"
                className="composer-thumb-remove"
                aria-label="Bỏ ảnh"
                title="Bỏ ảnh"
                onClick={() => removeImage(item.id)}
                disabled={send.isPending}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {canSendImages && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="visually-hidden"
              tabIndex={-1}
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = '';
                if (files.length > 0) addFiles(files);
              }}
            />
            <button
              type="button"
              className="btn icon-btn composer-add-btn"
              aria-label="Thêm ảnh"
              title="Thêm ảnh (hoặc dán Ctrl+V)"
              disabled={send.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="plus" />
            </button>
          </>
        )}
        <textarea
          aria-label="Nội dung tin nhắn"
          placeholder="Nhập tin nhắn… (Enter gửi, Shift+Enter xuống dòng)"
          rows={2}
          maxLength={STAFF_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button type="submit" className="btn btn-primary composer-send-btn" aria-label="Gửi tin nhắn" disabled={!canSubmit}>
          <Icon name="arrow" /><span className="hide-sm">{send.isPending ? 'Đang gửi…' : 'Gửi'}</span>
        </button>
      </div>
      <div className="small muted inbox-counter" aria-live="polite">{text.length}/{STAFF_TEXT_MAX}</div>
    </form>
  );
}

/**
 * Middle column: header, messages (polled every few seconds) and the composer. `backTo` is the list the
 * small-screen back button returns to.
 */
export function InboxThread({
  conversation,
  backTo = '/inbox',
  onToggleSide,
  sideOpen,
}: {
  conversation: InboxConversation;
  backTo?: '/inbox' | '/zalo-groups';
  onToggleSide?: () => void;
  sideOpen?: boolean;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const messages = useThreadMessages(conversation.id);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const changeMode = useMutation<SetModeResult, ApiFailure, ConversationMode>({
    mutationFn: (mode) => setMode(conversation.id, mode),
    onSuccess: (_data, mode) => toast(MODE_DONE_TOAST[mode] ?? 'Đã đổi chế độ'),
    onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    stick.current = true;
    setLightboxImage(null);
  }, [conversation.id]);
  const count = messages.data?.length ?? 0;
  const lastId = messages.data?.at(-1)?.id;
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, lastId, conversation.id]);
  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const failed = messages.data?.filter((m) => m.status === 'failed').length ?? 0;
  const name = conversationName(conversation);

  return (
    <section className="inbox-thread" aria-label={`Hội thoại với ${name}`}>
      <header className="inbox-thread-head">
        <Link to={backTo} className="btn btn-ghost icon-btn inbox-back" aria-label="Quay lại danh sách hội thoại"><Icon name="arrow" style={{ transform: 'rotate(180deg)' }} /></Link>
        <Avatar name={name} src={conversation.avatarUrl} />
        <div className="truncate" style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="truncate" style={{ fontWeight: 600 }} title={name}>{name}</span>
            <ChannelBadge channel={conversation.channel} compact />
            {conversation.leadCode && <Badge tone="info">{conversation.leadCode}</Badge>}
          </div>
          <div className="small muted truncate">
            {channelLabel(conversation)}{conversation.kind === 'group' ? ' · Nhóm' : ''} · {conversation.assigneeName ? `Phụ trách: ${conversation.assigneeName}` : 'Chưa giao'}
          </div>
        </div>
        <SegmentedControl
          size="sm"
          ariaLabel="Chế độ hội thoại"
          value={conversation.mode}
          onChange={(mode) => { if (mode !== conversation.mode && !changeMode.isPending) changeMode.mutate(mode); }}
          options={MODE_SEGMENT_OPTIONS}
        />
        {onToggleSide && (
          <button
            type="button"
            className="btn btn-ghost btn-sm icon-btn"
            onClick={onToggleSide}
            aria-expanded={sideOpen}
            aria-label="Mở hoặc đóng cột Khách trong CRM"
            title="Khách trong CRM"
          >
            <Icon name="panel-right" />
          </button>
        )}
      </header>
      {failed > 0 && (
        <div className="alert" data-tone="danger" role="alert" style={{ margin: '8px 12px 0' }}>
          <Icon name="alert" />
          <div>{failed} tin gửi lỗi. Kiểm tra tài khoản kênh (có thể đang tạm dừng gửi hoặc mất kết nối) rồi gửi lại.</div>
        </div>
      )}
      <div className="inbox-messages" ref={list} onScroll={onScroll}>
        {messages.isLoading && <Loading rows={3} />}
        {messages.error && <ErrorState error={messages.error} onRetry={() => messages.refetch()} />}
        {messages.data && !messages.data.length && <div className="empty"><strong>Chưa có tin nhắn</strong></div>}
        <ol className="msg-list" aria-live="polite" aria-relevant="additions">
          {messages.data?.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              channel={conversation.channel}
              kind={conversation.kind}
              onOpenImage={setLightboxImage}
            />
          ))}
        </ol>
      </div>
      <Composer key={conversation.id} conversationId={conversation.id} channel={conversation.channel} />
      <ImageLightbox
        src={lightboxImage?.src ?? null}
        alt={lightboxImage?.alt}
        onClose={() => setLightboxImage(null)}
      />
    </section>
  );
}
