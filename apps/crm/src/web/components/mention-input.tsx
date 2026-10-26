import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useApi } from '../api';
import { roleLabel } from './layout';
import { Avatar } from './ui';
import type { DirectoryUser } from '../types';

const MENTION_TOKEN_RE = /(@\[[^\]]+\]\((?:user|agent):[^)\s]+\))/g;
const MENTION_PARTS_RE = /^@\[([^\]]+)\]\((user|agent):([^)\s]+)\)$/;

/** Folds Vietnamese diacritics using NFD normalization so typing `@lan` or `@dat` matches `Lân` or `Đạt`. */
export function foldDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

/** Converts `@[Name](user:<id>)` and `@[Name](agent:<id>)` tokens into plain `@Name` for previews and quotes. */
export function formatMentionText(body: string): string {
  if (!body) return '';
  return body.replace(/@\[([^\]]+)\]\((?:user|agent):[^)\s]+\)/g, '@$1');
}

/** Renders message text with `@[Name](user:<id>)` and `@[Name](agent:<id>)` tokens highlighted as `@Name`. */
export function renderMessageBody(body: string, currentUserId?: string): ReactNode {
  if (!body) return null;
  const parts = body.split(MENTION_TOKEN_RE);
  if (parts.length === 1) return body;
  return parts.map((part, idx) => {
    const match = MENTION_PARTS_RE.exec(part);
    if (!match) return part;
    const [, name, kind, targetId] = match;
    const isMe = Boolean(kind === 'user' && currentUserId && targetId === currentUserId);
    return (
      <span
        key={`${idx}-${kind}-${targetId}`}
        className="badge"
        data-tone={isMe || kind === 'agent' ? 'accent' : 'info'}
        style={{ fontWeight: 600, padding: '0 6px', margin: '0 1px', verticalAlign: 'baseline' }}
      >
        @{name}
      </span>
    );
  });
}

interface ActiveMention {
  atIndex: number;
  endIndex: number;
  query: string;
}

function detectActiveMention(value: string, cursor: number): ActiveMention | null {
  const before = value.slice(0, cursor);
  const match = /(?:^|\s)@([^@\n\r[\]()]{0,40})$/.exec(before);
  if (!match) return null;
  const query = match[1] ?? '';
  const atIndex = cursor - query.length - 1;
  return { atIndex, endIndex: cursor, query };
}

export interface MentionInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  ariaLabel?: string;
  agents?: { id: string; name: string }[];
}

interface MentionCandidate {
  kind: 'user' | 'agent';
  id: string;
  name: string;
  label: string;
}

export function MentionInput({
  id,
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  rows = 2,
  maxLength = 4000,
  ariaLabel,
  agents,
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const directory = useApi<DirectoryUser[]>('/directory');
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (!mention) return [];
    const agentItems: MentionCandidate[] = (agents ?? []).map((a) => ({
      kind: 'agent',
      id: a.id,
      name: a.name,
      label: 'Trợ lý',
    }));
    const userItems: MentionCandidate[] = (directory.data ?? []).map((u) => ({
      kind: 'user',
      id: u.id,
      name: u.name,
      label: roleLabel(u.role),
    }));
    const all = [...agentItems, ...userItems];
    const q = foldDiacritics(mention.query.trim());
    const filtered = q ? all.filter((item) => foldDiacritics(item.name).includes(q)) : all;
    return filtered.slice(0, 8);
  }, [agents, directory.data, mention]);

  const showPopup = Boolean(mention && candidates.length > 0);
  const activeIdx = candidates.length > 0 ? Math.min(selectedIndex, candidates.length - 1) : 0;

  const updateCursorState = (text: string, cursor: number | null) => {
    if (cursor === null) {
      setMention(null);
      return;
    }
    const next = detectActiveMention(text, cursor);
    setMention(next);
    setSelectedIndex(0);
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    onChange(nextVal);
    updateCursorState(nextVal, e.target.selectionStart);
  };

  const insertCandidate = (item: MentionCandidate) => {
    if (!mention) return;
    const token = `@[${item.name}](${item.kind}:${item.id}) `;
    const nextValue = value.slice(0, mention.atIndex) + token + value.slice(mention.endIndex);
    const nextCursor = mention.atIndex + token.length;
    onChange(nextValue);
    setMention(null);
    setSelectedIndex(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPopup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + candidates.length) % candidates.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        const chosen = candidates[activeIdx];
        if (chosen) {
          e.preventDefault();
          insertCandidate(chosen);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      {showPopup && (
        <div
          role="listbox"
          aria-label="Gợi ý nhắc tên"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            maxWidth: 360,
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            padding: 4,
            zIndex: 35,
          }}
        >
          {candidates.map((item, idx) => {
            const selected = idx === activeIdx;
            return (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                role="option"
                aria-selected={selected}
                className="menu-item"
                style={{
                  background: selected ? 'var(--accent-weak)' : undefined,
                  color: selected ? 'var(--accent-text)' : undefined,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertCandidate(item);
                }}
              >
                <Avatar name={item.name} />
                <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>{item.name}</span>
                <span className="muted small">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        maxLength={maxLength}
        rows={rows}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) => updateCursorState(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
            updateCursorState(e.currentTarget.value, e.currentTarget.selectionStart);
          }
        }}
        onBlur={() => {
          setTimeout(() => setMention(null), 150);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
