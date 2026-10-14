import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelKind, ConversationMode } from '@abm/contracts';
import { ApiFailure, listMessages, sendMessage, setMode } from '../api';
import { fmtDateTime } from '../format';
import { conversationChannelLabel, mergeMessages, senderLabel } from '../inbox-format';
import type { InboxConversation, InboxMessage, SendMessageResult, SetModeResult } from '../types';
import { Icon } from './icons';
import { Avatar, Badge, ChannelBadge, ErrorState, FormError, Loading, SegmentedControl, useToast, type Tone } from './ui';

/** Same limit as the Worker's staff send. */
export const STAFF_TEXT_MAX = 2000;
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

interface Attachment { url: string; name?: string }
/** Only http(s) links are rendered; anything else in the stored JSON is ignored. */
function parseAttachments(json: string | null): Attachment[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.flatMap((a: unknown) => {
      if (!a || typeof a !== 'object') return [];
      const { url, name } = a as { url?: unknown; name?: unknown };
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return [];
      return [{ url, name: typeof name === 'string' && name ? name : undefined }];
    });
  } catch {
    return [];
  }
}

function MessageBubble({ message: m, channel }: { message: InboxMessage; channel: ChannelKind }) {
  const time = <time dateTime={m.createdAt} title={fmtDateTime(m.createdAt, true)}>{fmtShortTime(m.createdAt)}</time>;
  if (m.senderKind === 'system') {
    return <li className="msg-system" role="note"><span>{m.body}</span> · {time}</li>;
  }
  const attachments = parseAttachments(m.attachmentsJson);
  const label = senderLabel(m, channel);
  return (
    <li className="msg" data-side={m.senderKind === 'customer' ? 'in' : 'out'} data-kind={m.senderKind} data-status={m.status}>
      <div className="msg-bubble">
        {m.body && <div className="msg-body">{m.body}</div>}
        {attachments.map((a, i) => (
          <a key={i} className="msg-attachment" href={a.url} target="_blank" rel="noopener noreferrer"><Icon name="file" />{a.name ?? 'Tệp đính kèm'}</a>
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
    </li>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  /** Id of the message being composed; a retry of the same text reuses it, so the server sends it once. */
  const pending = useRef<{ text: string; id: string } | null>(null);
  const send = useMutation<SendMessageResult, ApiFailure, { text: string; id: string }>({
    mutationFn: (message) => sendMessage(conversationId, message.text, message.id),
    onSuccess: () => {
      pending.current = null;
      setText('');
    },
    // Refresh at once either way: a request whose response was lost may still have queued the message.
    onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const trimmed = text.trim();
  const submit = () => {
    if (!trimmed || trimmed.length > STAFF_TEXT_MAX || send.isPending) return;
    if (pending.current?.text !== trimmed) pending.current = { text: trimmed, id: crypto.randomUUID() };
    send.mutate(pending.current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Vietnamese IMEs confirm a word with Enter; only a plain Enter outside composition sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <form className="inbox-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <FormError error={send.error} />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <textarea aria-label="Nội dung tin nhắn" placeholder="Nhập tin nhắn… (Enter gửi, Shift+Enter xuống dòng)" rows={2}
          maxLength={STAFF_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
        <button type="submit" className="btn btn-primary" aria-label="Gửi tin nhắn" disabled={!trimmed || send.isPending}>
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
  const changeMode = useMutation<SetModeResult, ApiFailure, ConversationMode>({
    mutationFn: (mode) => setMode(conversation.id, mode),
    onSuccess: (_data, mode) => toast(MODE_DONE_TOAST[mode] ?? 'Đã đổi chế độ'),
    onSettled: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { stick.current = true; }, [conversation.id]);
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
        <Avatar name={name} />
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
          {messages.data?.map((m) => <MessageBubble key={m.id} message={m} channel={conversation.channel} />)}
        </ol>
      </div>
      <Composer key={conversation.id} conversationId={conversation.id} />
    </section>
  );
}
