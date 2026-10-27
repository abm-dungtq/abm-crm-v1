/** Pure helpers for the chat sidebar tree and the group permissions shown in the UI. The server re-checks every action. */
import { matchesSearch } from './text-search';
import type { Actor, ChatConversationDetail, ChatConversationSummary, ChatThreadSummary } from './types';

export type ChatTreeActor = Pick<Actor, 'id' | 'role'>;

export interface ChatTreeDepartment {
  /** The department group, or null when the reader is not a member and only belongs to some of its subgroups. */
  group: ChatConversationSummary | null;
  parentId: string;
  title: string;
  children: ChatConversationSummary[];
}

export interface ChatTree {
  departments: ChatTreeDepartment[];
  groups: ChatConversationSummary[];
  system: ChatConversationSummary[];
  directs: ChatConversationSummary[];
}

const isLeader = (actor: ChatTreeActor) => actor.role === 'director' || actor.role === 'admin';

function isOwner(detail: Pick<ChatConversationDetail, 'members'>, actor: ChatTreeActor): boolean {
  return detail.members.some((m) => m.id === actor.id && m.role === 'owner');
}

/** Unread conversations first, then the most recent message (or the last update when there is none). */
function byUnreadThenRecent(a: ChatConversationSummary, b: ChatConversationSummary): number {
  const unread = Number(b.unread > 0) - Number(a.unread > 0);
  if (unread !== 0) return unread;
  const at = (b.lastMessageAt ?? b.updatedAt).localeCompare(a.lastMessageAt ?? a.updatedAt);
  return at !== 0 ? at : a.id.localeCompare(b.id);
}

/**
 * Splits the conversation list into the sidebar sections: department groups with their subgroups, normal groups,
 * system groups (Inbox) and direct chats. A subgroup whose department group is not in the list gets a header entry
 * with `group: null` and the parent's title.
 */
export function buildChatTree(conversations: readonly ChatConversationSummary[]): ChatTree {
  const departmentGroups = conversations.filter((c) => c.kind === 'group' && c.departmentId);
  const departmentIds = new Set(departmentGroups.map((c) => c.id));
  const entries = new Map<string, ChatTreeDepartment>();
  for (const group of departmentGroups) {
    entries.set(group.id, { group, parentId: group.id, title: group.title, children: [] });
  }

  const groups: ChatConversationSummary[] = [];
  const system: ChatConversationSummary[] = [];
  const directs: ChatConversationSummary[] = [];

  for (const c of conversations) {
    if (c.kind === 'direct') {
      directs.push(c);
    } else if (departmentIds.has(c.id)) {
      continue;
    } else if (c.parentConversationId) {
      let entry = entries.get(c.parentConversationId);
      if (!entry) {
        entry = {
          group: null,
          parentId: c.parentConversationId,
          title: c.parentTitle || 'Phòng ban',
          children: [],
        };
        entries.set(c.parentConversationId, entry);
      }
      entry.children.push(c);
    } else if (c.system) {
      system.push(c);
    } else {
      groups.push(c);
    }
  }

  const departments = [...entries.values()];
  for (const entry of departments) entry.children.sort(byUnreadThenRecent);
  departments.sort((a, b) => a.title.localeCompare(b.title, 'vi') || a.parentId.localeCompare(b.parentId));

  return {
    departments,
    groups: groups.sort(byUnreadThenRecent),
    system: system.sort(byUnreadThenRecent),
    directs: directs.sort(byUnreadThenRecent),
  };
}

/** Sum of unread main-flow messages of a list of conversations. */
export function sumUnread(conversations: readonly ChatConversationSummary[]): number {
  return conversations.reduce((sum, c) => sum + c.unread, 0);
}

/** True when the conversation has unread messages, or unread replies in a thread the reader follows. */
export function hasUnread(c: Pick<ChatConversationSummary, 'unread' | 'threadUnread'>): boolean {
  return c.unread > 0 || c.threadUnread > 0;
}

/**
 * The conversations the list filter keeps: titles matching every word of `query` (ignoring case and Vietnamese
 * accents, so "loc" finds "Dự án Lộc Thọ"), and only unread ones when `unreadOnly` is set. The open conversation
 * (`keepId`) stays under "Chưa đọc" after it is read, so it does not vanish while the person is in it.
 */
export function filterConversations(
  conversations: readonly ChatConversationSummary[],
  { query, unreadOnly, keepId }: { query: string; unreadOnly: boolean; keepId?: string },
): ChatConversationSummary[] {
  return conversations.filter(
    (c) =>
      (!unreadOnly || hasUnread(c) || c.id === keepId) &&
      matchesSearch(c.title || (c.kind === 'group' ? 'Nhóm chat' : 'Tin riêng'), query),
  );
}

/** Switching between "Trò chuyện" and "Chủ đề": groups other than Inbox, by the owner, a director or an admin. */
export function canSwitchMode(
  detail: Pick<ChatConversationDetail, 'kind' | 'system' | 'departmentId' | 'members'>,
  actor: ChatTreeActor,
): boolean {
  if (detail.kind !== 'group') return false;
  if (detail.system && !detail.departmentId) return false;
  return isOwner(detail, actor) || isLeader(actor);
}

/** Adding and removing members by hand: normal groups only (not department or Inbox groups). */
export function canManageMembers(
  detail: Pick<ChatConversationDetail, 'kind' | 'system' | 'members'>,
  actor: ChatTreeActor,
): boolean {
  if (detail.kind !== 'group' || detail.system) return false;
  return isOwner(detail, actor) || isLeader(actor);
}

/**
 * Creating a subgroup under a department group. `parent` is the department group as the reader sees it (being in the
 * reader's list means being a member), or null when the reader is not a member: then only a director or admin may.
 */
export function canCreateSubgroup(
  parent: { kind: ChatConversationDetail['kind']; departmentId: string | null } | null,
  actor: ChatTreeActor,
): boolean {
  if (parent === null) return isLeader(actor);
  return parent.kind === 'group' && Boolean(parent.departmentId);
}

/** Closing or reopening a topic: its author, the group owner, a director or an admin. */
export function canCloseTopic(
  thread: Pick<ChatThreadSummary, 'isTopic'> | null,
  rootAuthorUserId: string | null,
  detail: Pick<ChatConversationDetail, 'members'>,
  actor: ChatTreeActor,
): boolean {
  if (!thread?.isTopic) return false;
  return (rootAuthorUserId !== null && rootAuthorUserId === actor.id) || isOwner(detail, actor) || isLeader(actor);
}
