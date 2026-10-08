import type { RoleCode } from '@abm/contracts';
import type { Actor } from '../env';
import { enqueueCommand } from './dispatcher';

/**
 * Who handles a conversation: manual assignment by managers, self-claim by sales staff, and round-robin
 * among staff on duty when a conversation is handed off to people. Every assignment is audited and
 * announced in the Lark inbox group (and privately to the assignee when their Lark account is linked).
 */

export type AssignMode = 'manual' | 'round_robin';

export interface InboxSettings {
  assignMode: AssignMode;
  slaMinutes: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export const DEFAULT_SLA_MINUTES = 15;
/** Roles that may assign a conversation to anyone. */
export const MANAGER_ROLES: ReadonlySet<RoleCode> = new Set(['leader', 'head', 'director', 'admin']);
/** Roles that may receive a conversation (everyone who can open the inbox). */
export const ASSIGNABLE_ROLES: readonly RoleCode[] = ['sale', 'leader', 'head', 'director', 'admin'];
/** Roles that take part in round-robin. */
export const ROUND_ROBIN_ROLES: readonly RoleCode[] = ['sale', 'leader'];
const ROUND_ROBIN_TRIES = 3;

/**
 * SQL expression for the SLA deadline: the ISO time bound to `param` plus the configured reply window, in the
 * same format as `Date.toISOString()` so deadlines compare as text.
 */
export const slaDueSql = (param = '?') =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${param}, '+' || COALESCE((SELECT sla_minutes FROM inbox_setting WHERE id = 1), ${DEFAULT_SLA_MINUTES}) || ' minutes')`;

export async function loadInboxSettings(db: D1Database): Promise<InboxSettings> {
  const row = await db.prepare('SELECT assign_mode, sla_minutes, updated_by_user_id, updated_at FROM inbox_setting WHERE id = 1')
    .first<{ assign_mode: AssignMode; sla_minutes: number; updated_by_user_id: string | null; updated_at: string | null }>();
  return {
    assignMode: row?.assign_mode ?? 'manual',
    slaMinutes: row?.sla_minutes ?? DEFAULT_SLA_MINUTES,
    updatedByUserId: row?.updated_by_user_id ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export interface Assignee {
  id: string;
  displayName: string;
  larkOpenId: string | null;
}

interface AssigneeRow { id: string; display_name: string; lark_open_id: string | null }
const toAssignee = (row: AssigneeRow): Assignee => ({ id: row.id, displayName: row.display_name, larkOpenId: row.lark_open_id });

interface ConversationRef {
  id: string;
  organization_id: string;
  display_name: string | null;
  external_thread_id: string;
  assignee_user_id: string | null;
}

const loadConversationRef = (db: D1Database, id: string) => db.prepare(`SELECT id, organization_id, display_name, external_thread_id,
    assignee_user_id FROM conversation WHERE id = ?`).bind(id).first<ConversationRef>();

/**
 * Picks the on-duty sale or leader who was assigned least recently (never assigned first) and stamps them.
 * The stamp is a compare-and-set on the value just read, so two concurrent picks never take the same person;
 * a lost race picks again, at most three times. Null when nobody is on duty.
 */
export async function pickRoundRobin(db: D1Database, organizationId: string, now = new Date()): Promise<Assignee | null> {
  const nowIso = now.toISOString();
  const roles = ROUND_ROBIN_ROLES.map(() => '?').join(', ');
  for (let attempt = 0; attempt < ROUND_ROBIN_TRIES; attempt += 1) {
    const candidate = await db.prepare(`SELECT u.id, u.display_name, u.lark_open_id, r.last_assigned_at
      FROM inbox_roster r JOIN app_user u ON u.id = r.user_id
      WHERE r.on_duty = 1 AND u.status = 'active' AND u.organization_id = ? AND u.role IN (${roles})
      ORDER BY r.last_assigned_at IS NOT NULL, r.last_assigned_at, u.id LIMIT 1`)
      .bind(organizationId, ...ROUND_ROBIN_ROLES).first<AssigneeRow & { last_assigned_at: string | null }>();
    if (!candidate) return null;
    const stamped = await db.prepare('UPDATE inbox_roster SET last_assigned_at = ? WHERE user_id = ? AND last_assigned_at IS ?')
      .bind(nowIso, candidate.id, candidate.last_assigned_at).run();
    if (stamped.meta.changes === 1) return toAssignee(candidate);
  }
  return null;
}

/**
 * Sets the assignee when it still is `expectedAssignee` (compare-and-set), then records the audit row and
 * queues the Lark notices. False when someone else changed the assignee meanwhile.
 */
async function applyAssignment(db: D1Database, actor: Actor | null, conv: ConversationRef, assignee: Assignee, via: 'manual' | 'round_robin', appBase: string, now: string) {
  const updated = await db.prepare(`UPDATE conversation SET assignee_user_id = ?, assigned_at = ?, updated_at = ?
    WHERE id = ? AND assignee_user_id IS ?`).bind(assignee.id, now, now, conv.id, conv.assignee_user_id).run();
  if (updated.meta.changes !== 1) return false;
  await db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, 'inbox.assign', 'conversation', ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor?.id ?? null, actor?.kind ?? 'system',
    conv.id, JSON.stringify({ assigneeUserId: conv.assignee_user_id }), JSON.stringify({ assigneeUserId: assignee.id, via }), now).run();
  const text = `Giao ${conv.display_name ?? conv.external_thread_id} cho ${assignee.displayName} – ${appBase}/inbox/${conv.id}`;
  await enqueueCommand(db, { kind: 'send_lark', target: 'worker', conversationId: conv.id, payload: { text } });
  if (assignee.larkOpenId) {
    await enqueueCommand(db, { kind: 'send_lark', target: 'worker', conversationId: conv.id, payload: { text, openId: assignee.larkOpenId } });
  }
  return true;
}

/** Base URL for links in Lark notices: APP_URL, else the request origin, without a trailing slash. */
export const linkBase = (appUrl: string | undefined, origin?: string) => (appUrl || origin || '').replace(/\/+$/, '');

export type AssignOutcome =
  | { ok: true; assignee: Assignee; changed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_ASSIGNEE' | 'ALREADY_ASSIGNED' };

/**
 * Assigns a conversation of the actor's organization. Managers assign it to any active inbox staff member;
 * a sale may only claim an unassigned conversation for themselves.
 */
export async function assignConversation(db: D1Database, actor: Actor, conversationId: string, userId: string, appBase = ''): Promise<AssignOutcome> {
  const conv = await loadConversationRef(db, conversationId);
  if (!conv || conv.organization_id !== actor.organizationId) return { ok: false, reason: 'NOT_FOUND' };
  const manager = MANAGER_ROLES.has(actor.role);
  if (!manager && (actor.role !== 'sale' || userId !== actor.id)) return { ok: false, reason: 'FORBIDDEN' };
  if (!manager && conv.assignee_user_id !== null) return { ok: false, reason: 'ALREADY_ASSIGNED' };

  const row = await db.prepare(`SELECT id, display_name, lark_open_id FROM app_user
    WHERE id = ? AND organization_id = ? AND status = 'active' AND role IN (${ASSIGNABLE_ROLES.map(() => '?').join(', ')})`)
    .bind(userId, actor.organizationId, ...ASSIGNABLE_ROLES).first<AssigneeRow>();
  if (!row) return { ok: false, reason: 'INVALID_ASSIGNEE' };
  const assignee = toAssignee(row);
  if (conv.assignee_user_id === assignee.id) return { ok: true, assignee, changed: false };

  const applied = await applyAssignment(db, actor, conv, assignee, 'manual', appBase, new Date().toISOString());
  return applied ? { ok: true, assignee, changed: true } : { ok: false, reason: 'ALREADY_ASSIGNED' };
}

export type HandoffAssignment =
  | { status: 'kept' | 'manual' | 'no_one_on_duty' }
  | { status: 'assigned'; assignee: Assignee };

/**
 * Assignment on handoff: an assigned conversation keeps its assignee; otherwise round-robin mode picks the
 * next person on duty and manual mode leaves it unassigned for a manager.
 */
export async function autoAssignOnHandoff(db: D1Database, conversationId: string, appBase: string, now = new Date()): Promise<HandoffAssignment> {
  const conv = await loadConversationRef(db, conversationId);
  if (!conv || conv.assignee_user_id !== null) return { status: 'kept' };
  if ((await loadInboxSettings(db)).assignMode !== 'round_robin') return { status: 'manual' };
  const assignee = await pickRoundRobin(db, conv.organization_id, now);
  if (!assignee) return { status: 'no_one_on_duty' };
  const applied = await applyAssignment(db, null, conv, assignee, 'round_robin', appBase, now.toISOString());
  return applied ? { status: 'assigned', assignee } : { status: 'kept' };
}
