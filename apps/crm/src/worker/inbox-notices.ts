import { publish } from './chat';
import type { Sink } from './env';
import { notify } from './notify';

export type InboxNoticeInput = {
  organizationId: string;
  text: string;
  link?: string;
  dedupeKey?: string;
  ensuredOrgs?: Set<string>;
};

export type InboxUserNoticeInput = {
  organizationId: string;
  userId: string;
  text: string;
  link?: string;
  dedupeKey?: string;
};

/**
 * Ensures the organization's system "Inbox" group (`sys:inbox:<org>`) exists and has exactly the people who may
 * read customer notices: every active leader/head/director/admin plus everyone on `inbox_roster`. Members who no
 * longer qualify are removed; the others keep their row (and `last_read_at`). Runs in one `db.batch` and returns
 * the conversation id.
 */
export async function ensureInboxConversation(db: D1Database, organizationId: string): Promise<string> {
  const id = `sys:inbox:${organizationId}`;
  const systemKey = `inbox:${organizationId}`;
  const now = new Date().toISOString();
  const qualifies = `u.organization_id = ?2 AND u.status = 'active'
         AND (u.role IN ('leader', 'head', 'director', 'admin')
              OR EXISTS (SELECT 1 FROM inbox_roster r WHERE r.user_id = u.id))`;
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO chat_conversation (id, organization_id, kind, title, system_key, created_at, updated_at)
       VALUES (?, ?, 'group', 'Inbox', ?, ?, ?)`,
    ).bind(id, organizationId, systemKey, now, now),
    db.prepare(
      `DELETE FROM chat_member WHERE conversation_id = ?1
         AND user_id NOT IN (SELECT u.id FROM app_user u WHERE ${qualifies})`,
    ).bind(id, organizationId),
    db.prepare(
      `INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at)
       SELECT ?1, u.id, 'member', ?3 FROM app_user u WHERE ${qualifies}`,
    ).bind(id, organizationId, now),
  ]);
  return id;
}

/**
 * Posts a system notice into the organization's "Inbox" CRM chat group and publishes `message.created` to its members.
 * Uses `'notice:' + dedupeKey` as the message id so retries are idempotent; never throws into the caller's main flow.
 * Returns true when the notice is stored (now, or already by an earlier try with the same key), false on failure.
 */
export async function postInboxNotice(
  sink: Sink,
  db: D1Database,
  input: InboxNoticeInput,
): Promise<boolean> {
  try {
    const convId = input.ensuredOrgs?.has(input.organizationId)
      ? `sys:inbox:${input.organizationId}`
      : await ensureInboxConversation(db, input.organizationId);
    input.ensuredOrgs?.add(input.organizationId);

    const messageId = `notice:${input.dedupeKey ?? crypto.randomUUID()}`;
    const metaJson = JSON.stringify(input.link ? { link: input.link } : {});
    const now = new Date().toISOString();
    const [insRes, , membersRes] = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO chat_message (id, conversation_id, author_kind, body, meta_json, created_at)
         VALUES (?, ?, 'system', ?, ?, ?)`,
      ).bind(messageId, convId, input.text, metaJson, now),
      db.prepare(
        `UPDATE chat_conversation SET last_message_at = ?, updated_at = ? WHERE id = ? AND changes() > 0`,
      ).bind(now, now, convId),
      db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ?').bind(convId),
    ]);

    if ((insRes?.meta.changes ?? 0) > 0) {
      const members = ((membersRes?.results ?? []) as { user_id: string }[]).map((r) => r.user_id);
      publish(sink, input.organizationId, members, {
        type: 'message.created',
        conversationId: convId,
        messageId,
      });
    }
    return true;
  } catch (err) {
    console.error('post_inbox_notice_failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Sends a private CRM notification (`kind = 'inbox'`, `title = 'Inbox'`) to a single user.
 * Never throws into the caller's main flow.
 */
export async function notifyInboxUser(sink: Sink, input: InboxUserNoticeInput): Promise<void> {
  try {
    await notify(sink, {
      organizationId: input.organizationId,
      userIds: [input.userId],
      kind: 'inbox',
      title: 'Inbox',
      body: input.text,
      ...(input.link ? { link: input.link } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    });
  } catch (err) {
    console.error('notify_inbox_user_failed', err instanceof Error ? err.message : String(err));
  }
}
