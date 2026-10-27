import { foldText } from '@abm/contracts';
import type { TaskSourceRef } from './chat-tasks';

/** One task the agent proposed, stored in `meta.taskDrafts` of its message until a person creates it. */
export interface TaskDraft {
  title: string;
  description: string | null;
  assigneeName: string | null;
  assigneeUserId: string | null;
  memberNames: string[];
  memberUserIds: string[];
  /** Names that matched no conversation member, or more than one; they stay as text for the requester to fix. */
  unresolvedNames: string[];
  dueDate: string | null;
  source: TaskSourceRef | null;
  createdTaskId: string | null;
}

export type ParsedTaskDraft = Omit<TaskDraft, 'source' | 'createdTaskId'>;

export interface TaskMarkerMember {
  user_id: string;
  display_name: string;
}

const MAX_DRAFTS = 3;
const TITLE_MAX_CHARS = 200;
const DESCRIPTION_MAX_CHARS = 5000;
const EMPTY_BODY = 'Đề xuất công việc:';

const BLOCK_OPEN_RE = /^\s*\[\s*task\s*\]\s*$/i;
const BLOCK_CLOSE_RE = /^\s*\[\s*\/\s*task\s*\]\s*$/i;
const LEGACY_LINE_RE = /^\s*\[\s*task\s*:(.*)\]\s*$/i;
/** A `key: value` line: the key is the trimmed text before the first colon, 1 to 40 characters. */
const KEY_MAX_CHARS = 40;
function splitKeyLine(line: string): { key: string; value: string } | null {
  // indexOf and trim instead of a regex: a pattern with optional spaces on both sides of a lazy key backtracks
  // quadratically on a long line of spaces without a colon.
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const key = line.slice(0, colon).trim();
  if (!key || key.length > KEY_MAX_CHARS) return null;
  return { key, value: line.slice(colon + 1) };
}

type Key = 'title' | 'assignee' | 'members' | 'due' | 'description';
/** Keys compared after `foldText`, so case and diacritics do not matter. */
const KEY_ALIASES: Record<string, Key> = {
  title: 'title',
  'tieu de': 'title',
  assignee: 'assignee',
  'nguoi lam': 'assignee',
  members: 'members',
  'nguoi lien quan': 'members',
  due: 'due',
  han: 'due',
  description: 'description',
  'mo ta': 'description',
};

/** A real calendar date `YYYY-MM-DD`, else null. */
function calendarDate(value: string): string | null {
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? v : null;
}

const cleanName = (raw: string) => raw.trim().replace(/^@+/, '').trim();
const splitNames = (raw: string) => raw.split(/[,;]/).map(cleanName).filter(Boolean);

/** Resolves a name to the one member whose folded display name equals it; null when none or several match. */
function resolveName(name: string, members: TaskMarkerMember[]): string | null {
  const folded = foldText(name);
  if (!folded) return null;
  const hits = members.filter((m) => foldText(m.display_name) === folded);
  return hits.length === 1 ? hits[0]!.user_id : null;
}

function buildDraft(
  fields: { title: string; assignee: string | null; members: string[]; due: string | null; description: string | null },
  members: TaskMarkerMember[],
): ParsedTaskDraft | null {
  const title = fields.title.trim().slice(0, TITLE_MAX_CHARS).trim();
  if (!title) return null;
  const unresolvedNames: string[] = [];
  const assigneeName = fields.assignee ? cleanName(fields.assignee) || null : null;
  const assigneeUserId = assigneeName ? resolveName(assigneeName, members) : null;
  if (assigneeName && !assigneeUserId) unresolvedNames.push(assigneeName);
  const memberNames: string[] = [];
  const memberUserIds: string[] = [];
  for (const name of fields.members) {
    if (memberNames.includes(name)) continue;
    memberNames.push(name);
    const uid = resolveName(name, members);
    if (uid) {
      if (!memberUserIds.includes(uid)) memberUserIds.push(uid);
    } else if (!unresolvedNames.includes(name)) {
      unresolvedNames.push(name);
    }
  }
  const description = fields.description?.trim().slice(0, DESCRIPTION_MAX_CHARS).trim() || null;
  return {
    title,
    description,
    assigneeName,
    assigneeUserId,
    memberNames,
    memberUserIds,
    unresolvedNames,
    dueDate: fields.due ? calendarDate(fields.due) : null,
  };
}

/** `[TASK: title | @Main | YYYY-MM-DD | @A, @B]`; the date and the members are optional. */
function parseLegacyLine(inner: string, members: TaskMarkerMember[]): ParsedTaskDraft | null {
  const parts = inner.split('|').map((p) => p.trim());
  if (parts.length < 2 || !parts[0] || !cleanName(parts[1] ?? '')) return null;
  let due: string | null = null;
  let names: string[] = [];
  for (const part of parts.slice(2)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) due = part;
    else names = [...names, ...splitNames(part)];
  }
  return buildDraft({ title: parts[0], assignee: parts[1] ?? null, members: names, due, description: null }, members);
}

/** Reads the `key: value` lines of one block; `description:` takes every line after it. */
function parseBlock(lines: string[], members: TaskMarkerMember[]): ParsedTaskDraft | null {
  const fields = { title: '', assignee: null as string | null, members: [] as string[], due: null as string | null, description: null as string | null };
  for (let i = 0; i < lines.length; i += 1) {
    const match = splitKeyLine(lines[i]!);
    const key = match ? KEY_ALIASES[foldText(match.key)] : undefined;
    if (!match || !key) continue;
    const value = match.value.trim();
    if (key === 'description') {
      fields.description = [value, ...lines.slice(i + 1)].join('\n').replace(/^\n+/, '');
      break;
    }
    if (key === 'title') fields.title = value;
    else if (key === 'assignee') fields.assignee = value;
    else if (key === 'members') fields.members = splitNames(value);
    else fields.due = value;
  }
  return buildDraft(fields, members);
}

/**
 * Pulls the task proposals out of an agent answer: `[TASK] … [/TASK]` blocks and legacy `[TASK: … ]` lines, at most 3
 * kept. Both are removed from the visible body; a body left empty becomes `Đề xuất công việc:` when a draft was found.
 * Names resolve only against `members`. Pure, no database access.
 */
export function extractTaskDrafts(text: string, members: TaskMarkerMember[]): { body: string; drafts: ParsedTaskDraft[] } {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  const drafts: ParsedTaskDraft[] = [];
  const add = (draft: ParsedTaskDraft | null) => {
    if (draft && drafts.length < MAX_DRAFTS) drafts.push(draft);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (BLOCK_OPEN_RE.test(line)) {
      let end = i + 1;
      while (end < lines.length && !BLOCK_CLOSE_RE.test(lines[end]!)) end += 1;
      add(parseBlock(lines.slice(i + 1, end), members));
      i = end; // past `[/TASK]`, or the end of the text when it is missing
      continue;
    }
    const legacy = LEGACY_LINE_RE.exec(line);
    if (legacy) {
      add(parseLegacyLine(legacy[1]!, members));
      continue;
    }
    kept.push(line);
  }
  const body = kept.join('\n').trim() || (drafts.length > 0 ? EMPTY_BODY : '');
  return { body, drafts };
}
