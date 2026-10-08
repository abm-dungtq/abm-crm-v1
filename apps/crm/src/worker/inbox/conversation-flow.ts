import type { ConversationMode } from '@abm/contracts';
import type { Actor, Env } from '../env';
import { autoAssignOnHandoff, linkBase, slaDueSql } from './assignment';
import { enqueueCommand, type CommandTarget } from './dispatcher';

/**
 * Conversation rules of the customer-facing bot (ADR-009): when the bot may reply, how customer turns
 * are batched into one GoClaw call, how a reply or a handoff marker is applied, and how staff take over.
 */

/** Delay that lets a customer's burst of messages reach GoClaw as one turn. */
export const COMPLETION_DELAY_MS = 8_000;
/** Staff/customer exchange kept for the bot's next turn while a person handles the conversation. */
export const STAFF_CONTEXT_MAX_CHARS = 1500;
export const STAFF_TEXT_MAX = 2000;
/** Text that stands in for a message carrying only attachments. */
export const ATTACHMENT_ONLY_TEXT = '[Tệp đính kèm]';
export const CANCELLED_REPLY_PREFIX = '[Bot trả lời bị huỷ vì đã chuyển người] ';

const HANDOFF_MARKER = /^\[HANDOFF:\s*(.+?)\]\s*$/m;
const HANDOFF_MARKER_ALL = new RegExp(HANDOFF_MARKER.source, 'gm');

interface ConversationRow {
  id: string;
  organization_id: string;
  kind: 'direct' | 'group';
  mode: ConversationMode;
  external_thread_id: string;
  display_name: string | null;
  staff_context_pending: string | null;
  assignee_user_id: string | null;
  channel_account_id: string;
  channel: 'zalo' | 'facebook';
  account_external_id: string | null;
  account_name: string;
  agent_key: string | null;
  bot_enabled: number;
  bot_switch: number | null;
}

const loadConversation = (db: D1Database, id: string) => db.prepare(`SELECT c.id, c.organization_id, c.kind, c.mode,
    c.external_thread_id, c.display_name, c.staff_context_pending, c.assignee_user_id, c.channel_account_id,
    a.channel, a.external_id AS account_external_id, a.display_name AS account_name, a.agent_key, a.bot_enabled,
    (SELECT enabled FROM customer_bot_switch WHERE id = 1) AS bot_switch
  FROM conversation c JOIN channel_account a ON a.id = c.channel_account_id WHERE c.id = ?`).bind(id).first<ConversationRow>();

/** Audit row for inbox actions; `actor` null means the system acted (for example a bot handoff). Never holds message text. */
const auditStatement = (db: D1Database, actor: Actor | null, command: string, entityId: string, before: unknown, after: unknown, now: string) =>
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, 'conversation', ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor?.id ?? null, actor?.kind ?? 'system', command,
    entityId, JSON.stringify(before), JSON.stringify(after), now);

/** Appends one line to the pending staff context, keeping only the last 1500 characters. */
export const appendStaffContext = (db: D1Database, conversationId: string, line: string, now: string) =>
  db.prepare(`UPDATE conversation SET staff_context_pending = substr(COALESCE(staff_context_pending || char(10), '') || ?, ?),
      updated_at = ? WHERE id = ?`).bind(line, -STAFF_CONTEXT_MAX_CHARS, now, conversationId);

/**
 * Marks an outgoing message as delivered and records the channel's message id when it has none yet and
 * no other message of the conversation already holds that id.
 */
export const markMessageSent = (db: D1Database, messageId: string, externalMsgId: string | null) =>
  db.prepare(`UPDATE message SET status = 'sent',
      external_msg_id = CASE WHEN external_msg_id IS NULL AND ?1 IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM message o WHERE o.conversation_id = message.conversation_id AND o.external_msg_id = ?1) THEN ?1 ELSE external_msg_id END
    WHERE id = ?2 AND direction = 'out'`).bind(externalMsgId, messageId).run();

/** GoClaw session of a conversation: `<channel>:<account external id>:<thread id>`. */
const goclawUserId = (conv: ConversationRow) => `${conv.channel}:${conv.account_external_id ?? conv.channel_account_id}:${conv.external_thread_id}`;

/**
 * Rule 1: the bot replies only in a direct conversation in `ai` mode of an enabled account while the customer bot is on.
 * An account without an agent has no bot to reply with.
 */
const botMayReply = (conv: ConversationRow) =>
  conv.agent_key !== null && conv.bot_switch === 0 && conv.bot_enabled === 1 && conv.kind === 'direct' && conv.mode === 'ai';

/**
 * Queues the bot's reply to a customer message: extends the pending reply of the conversation with this
 * text and pushes its run time back 8 seconds, or queues a new one. Pending staff context is prefixed once
 * and then cleared. Returns false when the bot may not reply.
 */
export async function scheduleCompletion(db: D1Database, conversationId: string, messageId: string, text: string, now = new Date()) {
  const conv = await loadConversation(db, conversationId);
  if (!conv || !botMayReply(conv)) return false;
  const context = conv.staff_context_pending ?? '';
  const turn = (context ? `[Nhân viên đã trao đổi: ${context}]\n` : '') + (text || ATTACHMENT_ONLY_TEXT);
  const runAt = new Date(now.getTime() + COMPLETION_DELAY_MS);
  const extended = await db.prepare(`UPDATE channel_command
      SET payload_json = json_set(payload_json, '$.text', json_extract(payload_json, '$.text') || char(10) || ?), next_run_at = ?, updated_at = ?
    WHERE conversation_id = ? AND kind = 'run_completion' AND status = 'pending' AND json_extract(payload_json, '$.purpose') = 'reply'`)
    .bind(turn, runAt.toISOString(), now.toISOString(), conversationId).run();
  if (extended.meta.changes === 0) {
    await enqueueCommand(db, {
      kind: 'run_completion', target: 'bridge', channelAccountId: conv.channel_account_id, conversationId,
      payload: { agentKey: conv.agent_key, userId: goclawUserId(conv), text: turn, conversationId, purpose: 'reply' },
      dedupeKey: `completion:${messageId}`, runAt,
    });
  }
  if (context) {
    // Compare-and-clear: a line appended meanwhile stays for the next turn.
    await db.prepare('UPDATE conversation SET staff_context_pending = NULL, updated_at = ? WHERE id = ? AND staff_context_pending = ?')
      .bind(now.toISOString(), conversationId, context).run();
  }
  return true;
}

/** Inserts an outgoing message and the command that sends it; returns the command target. */
async function queueOutgoing(db: D1Database, conv: ConversationRow, message: { id: string; senderKind: 'bot' | 'staff_web'; userId: string | null; text: string }, now: string) {
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, sent_by_user_id, body, status, created_at)
    VALUES (?, ?, 'out', ?, ?, ?, 'pending', ?)`).bind(message.id, conv.id, message.senderKind, message.userId, message.text, now).run();
  // Messenger is sent by the Worker itself; Zalo by the bridge sidecar (ADR-010).
  const target: CommandTarget = conv.channel === 'facebook' ? 'worker' : 'bridge';
  await enqueueCommand(db, {
    kind: conv.channel === 'facebook' ? 'send_messenger' : 'send_zalo', target, channelAccountId: conv.channel_account_id,
    conversationId: conv.id, dedupeKey: `send:${message.id}`,
    payload: { messageId: message.id, threadId: conv.external_thread_id, threadKind: conv.kind, text: message.text },
  });
  return target;
}

export interface FlowOutcome {
  /** True when a command for the Worker itself was queued; the caller runs processWorkerCommands. */
  workerCommandQueued: boolean;
}

/**
 * Hands the conversation to people: `human` mode, the reason, and a Lark notice to the inbox group.
 * `origin` is the request origin, used for the link when APP_URL is unset.
 */
export async function handoff(db: D1Database, env: Pick<Env, 'APP_URL'>, conversationId: string, reason: string, origin?: string): Promise<FlowOutcome> {
  const conv = await loadConversation(db, conversationId);
  if (!conv) return { workerCommandQueued: false };
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const base = linkBase(env.APP_URL, origin);
  await db.batch([
    db.prepare(`UPDATE conversation SET mode = 'human', handoff_reason = ?, sla_due_at = ${slaDueSql()}, updated_at = ? WHERE id = ?`)
      .bind(reason, now, now, conv.id),
    auditStatement(db, null, 'inbox.handoff', conv.id, { mode: conv.mode }, { mode: 'human', reason }, now),
  ]);
  const assignment = await autoAssignOnHandoff(db, conv.id, base, nowDate);
  const noOneOnDuty = assignment.status === 'no_one_on_duty' ? ' – chưa có người trực' : '';
  const text = `Handoff: ${conv.display_name ?? conv.external_thread_id} (${conv.account_name}) – ${reason}${noOneOnDuty} – ${base}/inbox/${conv.id}`;
  await enqueueCommand(db, { kind: 'send_lark', target: 'worker', conversationId: conv.id, payload: { text } });
  return { workerCommandQueued: true };
}

/**
 * Applies GoClaw's reply: strips handoff marker lines, sends the remaining text while the conversation is
 * still in `ai` mode (otherwise keeps it as a cancelled system note), then hands off when a marker was present.
 */
export async function applyCompletionResult(db: D1Database, env: Pick<Env, 'APP_URL'>, conversationId: string, replyText: string, origin?: string): Promise<FlowOutcome> {
  const conv = await loadConversation(db, conversationId);
  if (!conv) return { workerCommandQueued: false };
  const marker = HANDOFF_MARKER.exec(replyText);
  const text = replyText.replace(HANDOFF_MARKER_ALL, '').trim();
  const now = new Date().toISOString();
  if (conv.mode !== 'ai') {
    if (text) {
      await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
        VALUES (?, ?, 'out', 'system', ?, 'failed', ?)`).bind(crypto.randomUUID(), conv.id, CANCELLED_REPLY_PREFIX + text, now).run();
    }
    return { workerCommandQueued: false };
  }
  let workerCommandQueued = false;
  if (text) {
    const target = await queueOutgoing(db, conv, { id: crypto.randomUUID(), senderKind: 'bot', userId: null, text }, now);
    await db.prepare('UPDATE conversation SET last_message_at = ?, updated_at = ? WHERE id = ?').bind(now, now, conv.id).run();
    workerCommandQueued = target === 'worker';
  }
  if (marker) {
    const outcome = await handoff(db, env, conv.id, marker[1]!.trim(), origin);
    workerCommandQueued ||= outcome.workerCommandQueued;
  }
  return { workerCommandQueued };
}

/** Looks up a conversation of the actor's organization. */
async function loadForActor(db: D1Database, actor: Actor, conversationId: string) {
  const conv = await loadConversation(db, conversationId);
  return conv && conv.organization_id === actor.organizationId ? conv : null;
}

/**
 * A staff member writes from the web: the message is queued for sending, recorded in the pending staff
 * context, and an `ai` conversation switches to `human`, assigned to the sender when nobody has it.
 * Null when the conversation is not in the actor's organization.
 */
export async function staffSend(db: D1Database, actor: Actor, conversationId: string, text: string) {
  const conv = await loadForActor(db, actor, conversationId);
  if (!conv) return null;
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const target = await queueOutgoing(db, conv, { id: messageId, senderKind: 'staff_web', userId: actor.id, text }, now);
  const mode: ConversationMode = conv.mode === 'ai' ? 'human' : conv.mode;
  const assignee = conv.assignee_user_id ?? (conv.mode === 'ai' ? actor.id : null);
  await db.batch([
    db.prepare(`UPDATE conversation SET mode = ?, last_message_at = ?, last_staff_reply_at = ?, sla_due_at = NULL, updated_at = ?,
        assigned_at = CASE WHEN assignee_user_id IS NULL AND ? IS NOT NULL THEN ? ELSE assigned_at END,
        assignee_user_id = COALESCE(assignee_user_id, ?)
      WHERE id = ?`).bind(mode, now, now, now, assignee, now, assignee, conv.id),
    appendStaffContext(db, conv.id, `Nhân viên: ${text}`, now),
    auditStatement(db, actor, 'inbox.staffSend', conv.id, { mode: conv.mode, assigneeUserId: conv.assignee_user_id },
      { mode, assigneeUserId: assignee, messageId }, now),
  ]);
  return { messageId, mode, assigneeUserId: assignee, workerCommandQueued: target === 'worker' };
}

/**
 * Changes the conversation mode. Taking it to `human` while nobody has it assigns it to the actor.
 * Null when the conversation is not in the actor's organization.
 */
export async function setMode(db: D1Database, actor: Actor, conversationId: string, mode: ConversationMode) {
  const conv = await loadForActor(db, actor, conversationId);
  if (!conv) return null;
  const now = new Date().toISOString();
  const assignee = conv.assignee_user_id ?? (mode === 'human' ? actor.id : null);
  await db.batch([
    // Switching to `human` starts the reply deadline; any other mode has no staff reply to wait for.
    db.prepare(`UPDATE conversation SET mode = ?1, updated_at = ?2,
        sla_due_at = CASE WHEN ?1 <> 'human' THEN NULL WHEN mode = 'human' THEN sla_due_at ELSE ${slaDueSql('?2')} END,
        assigned_at = CASE WHEN assignee_user_id IS NULL AND ?3 IS NOT NULL THEN ?2 ELSE assigned_at END,
        assignee_user_id = COALESCE(assignee_user_id, ?3)
      WHERE id = ?4`).bind(mode, now, assignee, conv.id),
    auditStatement(db, actor, 'inbox.setMode', conv.id, { mode: conv.mode, assigneeUserId: conv.assignee_user_id },
      { mode, assigneeUserId: assignee }, now),
  ]);
  return { mode, assigneeUserId: assignee };
}

/** An outgoing message still pending after this long without a live send command is given up. */
export const STUCK_OUTGOING_MS = 15 * 60_000;

/**
 * Marks outgoing messages failed when they have been pending for 15 minutes and no pending or claimed
 * command refers to them any more (for example the send command failed for good). Returns the count.
 */
export async function sweepStuckOutgoing(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_OUTGOING_MS).toISOString();
  const res = await db.prepare(`UPDATE message SET status = 'failed'
    WHERE direction = 'out' AND status = 'pending' AND created_at < ?
      AND NOT EXISTS (SELECT 1 FROM channel_command cc
        WHERE json_extract(cc.payload_json, '$.messageId') = message.id AND cc.status IN ('pending', 'claimed'))`)
    .bind(cutoff).run();
  return res.meta.changes;
}
