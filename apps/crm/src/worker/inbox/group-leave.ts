import type { Actor } from '../env';
import { cancelCommand, dropBotSend } from './dispatcher';
import { keyFromCrmMediaUrl, ownsMediaKey } from './media';

/**
 * What the CRM records once the bridge has tried to leave a Zalo group.
 * A success stops every send into that group. A final failure only clears the outstanding request.
 */

const noteStatement = (db: D1Database, conversationId: string, body: string, now: string) =>
  db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES (?, ?, 'out', 'system', ?, 'sent', ?)`).bind(crypto.randomUUID(), conversationId, body, now);

const auditRow = (db: D1Database, actor: Actor, command: string, entity: string, entityId: string, before: unknown, after: unknown, now: string) =>
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor.id, actor.kind, command, entity, entityId,
    JSON.stringify(before), JSON.stringify(after), now);

export interface LeftGroupSummary {
  id: string;
  displayName: string | null;
  leftAt: string;
}

function collectStaffMediaKeys(organizationId: string, rows: readonly { attachments_json: string | null }[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.attachments_json) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.attachments_json);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const url = (item as { url?: unknown }).url;
      const rawKey = (item as { key?: unknown }).key;
      const candidate = (typeof url === 'string' ? keyFromCrmMediaUrl(url) : null)
        ?? (typeof rawKey === 'string' ? rawKey : null);
      if (candidate && ownsMediaKey(organizationId, candidate)) keys.add(candidate);
    }
  }
  return [...keys];
}

/** The name stored on the leave audit. A missing row still produces a readable note. */
async function requesterName(db: D1Database, conversationId: string): Promise<string> {
  const row = await db.prepare(`SELECT after_json FROM audit_log
    WHERE command = 'inbox.leaveGroup' AND entity = 'conversation' AND entity_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(conversationId).first<{ after_json: string | null }>();
  if (!row?.after_json) return 'không rõ';
  try {
    const parsed = JSON.parse(row.after_json) as { requestedByName?: unknown };
    if (typeof parsed.requestedByName !== 'string') return 'không rõ';
    const name = parsed.requestedByName.replace(/\s+/g, ' ').trim();
    return name ? name.slice(0, 120) : 'không rõ';
  } catch {
    return 'không rõ';
  }
}

function messageIdOf(payload: unknown): string | null {
  const messageId = (payload as { messageId?: unknown } | null)?.messageId;
  return typeof messageId === 'string' ? messageId : null;
}

async function failQueuedMessage(db: D1Database, payload: unknown) {
  const messageId = messageIdOf(payload);
  if (!messageId) return;
  await db.prepare("UPDATE message SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(messageId).run();
}

/**
 * Fails pending and claimed commands that would still send into this group: Zalo, Messenger and OA sends,
 * and a group-bot reply that has not been turned into a send yet. Lark notices and summaries are left alone.
 * Pending rows use `cancelCommand`; a claim the bridge already holds uses `dropBotSend`.
 */
export async function cancelSendsIntoGroup(db: D1Database, conversationId: string): Promise<void> {
  const rows = await db.prepare(`SELECT id, status, attempts, payload_json FROM channel_command
    WHERE conversation_id = ? AND status IN ('pending', 'claimed')
      AND (
        kind IN ('send_zalo', 'send_messenger', 'send_zalo_oa')
        OR (kind = 'run_completion' AND json_extract(payload_json, '$.purpose') = 'reply')
      )`).bind(conversationId).all<{ id: string; status: string; attempts: number; payload_json: string }>();
  for (const row of rows.results) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload_json) as unknown;
    } catch {
      payload = null;
    }
    if (row.status === 'pending') {
      if (await cancelCommand(db, row.id, 'LEFT_GROUP')) await failQueuedMessage(db, payload);
    } else {
      await dropBotSend(db, { id: row.id, attempts: row.attempts, payload }, 'LEFT_GROUP');
    }
  }
}

/**
 * Zalo confirmed the leave. The group stays in the list, the bot and the daily summary go off,
 * active recurring posts are paused, and queued sends into the group are cancelled.
 */
export async function applyGroupLeft(db: D1Database, conversationId: string, now = new Date()): Promise<void> {
  const group = await db.prepare("SELECT id FROM conversation WHERE id = ? AND kind = 'group'")
    .bind(conversationId).first<{ id: string }>();
  if (!group) return;
  const nowIso = now.toISOString();
  const name = await requesterName(db, conversationId);
  await db.batch([
    db.prepare(`UPDATE conversation SET left_at = ?, leave_requested_at = NULL, bot_reply_enabled = 0,
        summary_enabled = 0, scheduled_opt_out = 1, last_message_at = ?, updated_at = ?
      WHERE id = ?`).bind(nowIso, nowIso, nowIso, conversationId),
    db.prepare(`UPDATE group_schedule SET status = 'paused', next_run_at = NULL, updated_at = ?
      WHERE conversation_id = ? AND status = 'active'`).bind(nowIso, conversationId),
    noteStatement(db, conversationId, `Đã rời nhóm (do ${name})`, nowIso),
  ]);
  await cancelSendsIntoGroup(db, conversationId);
}

/** The leave will not be retried. Staff can ask again; the group is not marked as left. */
export async function noteLeaveFailed(db: D1Database, conversationId: string, error: string, now = new Date()): Promise<void> {
  const group = await db.prepare("SELECT id FROM conversation WHERE id = ? AND kind = 'group'")
    .bind(conversationId).first<{ id: string }>();
  if (!group) return;
  const nowIso = now.toISOString();
  const code = error.replace(/\s+/g, ' ').trim().slice(0, 200) || 'BRIDGE_ERROR';
  await db.batch([
    db.prepare('UPDATE conversation SET leave_requested_at = NULL, last_message_at = ?, updated_at = ? WHERE id = ?')
      .bind(nowIso, nowIso, conversationId),
    noteStatement(db, conversationId, `Rời nhóm không thành công: ${code}`, nowIso),
  ]);
}

/**
 * Permanently removes a left Zalo group and its members, schedules, intakes, commands and messages in one batch,
 * records the audit entry, and best-effort deletes the staff-uploaded R2 images of those messages.
 */
export async function deleteLeftGroupHistory(
  db: D1Database,
  media: R2Bucket | undefined,
  actor: Actor,
  group: LeftGroupSummary,
  now = new Date().toISOString(),
): Promise<void> {
  const { id, displayName, leftAt } = group;
  const messages = await db.prepare('SELECT attachments_json FROM message WHERE conversation_id = ?')
    .bind(id).all<{ attachments_json: string | null }>();
  const messageCount = messages.results.length;
  const keys = collectStaffMediaKeys(actor.organizationId, messages.results);
  await db.batch([
    db.prepare('DELETE FROM zalo_group_member WHERE conversation_id = ?').bind(id),
    db.prepare('DELETE FROM group_schedule WHERE conversation_id = ?').bind(id),
    db.prepare('DELETE FROM lead_intake WHERE conversation_id = ?').bind(id),
    db.prepare('DELETE FROM channel_command WHERE conversation_id = ?').bind(id),
    db.prepare('DELETE FROM message WHERE conversation_id = ?').bind(id),
    db.prepare("DELETE FROM conversation WHERE id = ? AND organization_id = ? AND kind = 'group' AND left_at IS NOT NULL")
      .bind(id, actor.organizationId),
    auditRow(db, actor, 'inbox.deleteGroupHistory', 'conversation', id, { displayName, leftAt, messageCount }, null, now),
  ]);
  if (keys.length > 0 && media) {
    try {
      await media.delete(keys);
    } catch {
      // Best-effort cleanup; an R2 error must not fail the completed D1 delete.
    }
  }
}
