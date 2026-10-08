import { Hono, type Context } from 'hono';
import { CONVERSATION_MODES, type RoleCode } from '@abm/contracts';
import { z } from 'zod';
import { background, type Actor, type AppBindings } from '../env';
import { STAFF_TEXT_MAX, setMode, staffSend } from './conversation-flow';
import { enqueueCommand } from './dispatcher';
import { processWorkerCommands } from './worker-commands';

/** Inbox API for the web app. Inbox roles see every conversation of the organization; channel accounts are admin-only. */
export const inboxRoutes = new Hono<AppBindings>();

type Ctx = Context<AppBindings>;

const INBOX_ROLES: ReadonlySet<RoleCode> = new Set(['sale', 'leader', 'head', 'director', 'admin']);
const CONVERSATION_PAGE = 50;
const MESSAGE_PAGE = 200;

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: { code, message, ...extra } });
const forbidden = fail('FORBIDDEN', 'Vai trò hiện tại không xem được mục này');
const notFound = fail('NOT_FOUND', 'Không tìm thấy trong phạm vi của bạn');

async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<{ data: z.infer<S> } | { error: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
  return { error: c.json(fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', { fields }), 422) };
}
const invalidQuery = (c: Ctx, field: string) => c.json(fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', { fields: { [field]: 'Không hợp lệ' } }), 422);

const auditRow = (db: D1Database, actor: Actor, command: string, entity: string, entityId: string, before: unknown, after: unknown, now: string) =>
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor.id, actor.kind, command, entity, entityId,
    JSON.stringify(before), JSON.stringify(after), now);

const sendTextInput = z.object({ text: z.string().trim().min(1).max(STAFF_TEXT_MAX) });
const modeInput = z.object({ mode: z.enum(CONVERSATION_MODES) });
const agentKey = z.string().trim().min(1).max(128);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Định dạng HH:MM');
const createAccountInput = z.object({ displayName: z.string().trim().min(1).max(200), agentKey });
const updateAccountInput = z.object({
  botEnabled: z.boolean().optional(),
  sendPaused: z.boolean().optional(),
  dailySendCap: z.number().int().min(0).max(10_000).optional(),
  quietStart: hhmm.nullable().optional(),
  quietEnd: hhmm.nullable().optional(),
  agentKey: agentKey.optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Không có thay đổi' });
const botSwitchInput = z.object({ enabled: z.boolean() });

inboxRoutes.use('*', async (c, next) => {
  if (!INBOX_ROLES.has(c.get('actor').role)) return c.json(forbidden, 403);
  await next();
});
const adminOnly = async (c: Ctx, next: () => Promise<void>) => {
  if (c.get('actor').role !== 'admin') return c.json(forbidden, 403);
  await next();
};

const CONVERSATION_SELECT = `SELECT c.id, c.channel_account_id AS channelAccountId, a.display_name AS accountName, a.channel,
    c.kind, c.external_thread_id AS externalThreadId, c.contact_id AS contactId, c.display_name AS displayName, c.mode,
    c.assignee_user_id AS assigneeUserId, u.display_name AS assigneeName, c.assigned_at AS assignedAt,
    c.handoff_reason AS handoffReason, c.last_message_at AS lastMessageAt, c.last_inbound_at AS lastInboundAt,
    c.last_staff_reply_at AS lastStaffReplyAt, c.sla_due_at AS slaDueAt, c.created_at AS createdAt, c.updated_at AS updatedAt,
    lm.body AS lastMessageBody, lm.sender_kind AS lastMessageSenderKind, lm.created_at AS lastMessageCreatedAt
  FROM conversation c
  JOIN channel_account a ON a.id = c.channel_account_id
  LEFT JOIN app_user u ON u.id = c.assignee_user_id
  LEFT JOIN message lm ON lm.id = (SELECT m.id FROM message m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1)`;

const conversationInOrg = (db: D1Database, actor: Actor, id: string) =>
  db.prepare('SELECT id FROM conversation WHERE id = ? AND organization_id = ?').bind(id, actor.organizationId).first<{ id: string }>();

inboxRoutes.get('/conversations', async (c) => {
  const actor = c.get('actor');
  const where = ['c.organization_id = ?'];
  const binds: unknown[] = [actor.organizationId];
  const mode = c.req.query('mode');
  if (mode) {
    if (!(CONVERSATION_MODES as readonly string[]).includes(mode)) return invalidQuery(c, 'mode');
    where.push('c.mode = ?'); binds.push(mode);
  }
  const kind = c.req.query('kind');
  if (kind) {
    if (kind !== 'direct' && kind !== 'group') return invalidQuery(c, 'kind');
    where.push('c.kind = ?'); binds.push(kind);
  }
  const assignee = c.req.query('assignee');
  if (assignee === 'none') where.push('c.assignee_user_id IS NULL');
  else if (assignee) { where.push('c.assignee_user_id = ?'); binds.push(assignee); }
  const account = c.req.query('account');
  if (account) { where.push('c.channel_account_id = ?'); binds.push(account); }
  const q = c.req.query('q')?.trim();
  if (q) {
    where.push("(c.display_name LIKE ? ESCAPE '\\' OR c.external_thread_id = ?)");
    binds.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`, q);
  }
  const before = c.req.query('before');
  if (before) { where.push('c.last_message_at < ?'); binds.push(before); }
  const rows = await c.env.DB.prepare(`${CONVERSATION_SELECT} WHERE ${where.join(' AND ')}
    ORDER BY c.last_message_at DESC, c.id DESC LIMIT ?`).bind(...binds, CONVERSATION_PAGE).all();
  return c.json(ok(rows.results));
});

inboxRoutes.get('/conversations/:id', async (c) => {
  const row = await c.env.DB.prepare(`${CONVERSATION_SELECT} WHERE c.id = ? AND c.organization_id = ?`)
    .bind(c.req.param('id'), c.get('actor').organizationId).first();
  return row ? c.json(ok(row)) : c.json(notFound, 404);
});

inboxRoutes.get('/conversations/:id/messages', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  if (!(await conversationInOrg(db, c.get('actor'), id))) return c.json(notFound, 404);
  const select = `SELECT m.id, m.direction, m.sender_kind AS senderKind, m.sender_external_id AS senderExternalId,
      m.sent_by_user_id AS sentByUserId, u.display_name AS sentByName, m.external_msg_id AS externalMsgId, m.body,
      m.attachments_json AS attachmentsJson, m.status, m.created_at AS createdAt
    FROM message m LEFT JOIN app_user u ON u.id = m.sent_by_user_id WHERE m.conversation_id = ?`;
  const after = c.req.query('after');
  // Without `after` the latest page is returned; either way the list is oldest first.
  const rows = after
    ? (await db.prepare(`${select} AND m.created_at > ? ORDER BY m.created_at, m.rowid LIMIT ?`).bind(id, after, MESSAGE_PAGE).all()).results
    : (await db.prepare(`${select} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`).bind(id, MESSAGE_PAGE).all()).results.reverse();
  return c.json(ok(rows));
});

inboxRoutes.post('/conversations/:id/messages', async (c) => {
  const input = await body(c, sendTextInput);
  if ('error' in input) return input.error;
  const sent = await staffSend(c.env.DB, c.get('actor'), c.req.param('id'), input.data.text);
  if (!sent) return c.json(notFound, 404);
  if (sent.workerCommandQueued) await background(c, processWorkerCommands(c.env));
  const { workerCommandQueued: _queued, ...data } = sent;
  return c.json(ok(data));
});

inboxRoutes.post('/conversations/:id/mode', async (c) => {
  const input = await body(c, modeInput);
  if ('error' in input) return input.error;
  const changed = await setMode(c.env.DB, c.get('actor'), c.req.param('id'), input.data.mode);
  return changed ? c.json(ok(changed)) : c.json(notFound, 404);
});

interface AccountRow {
  id: string; channel: string; externalId: string | null; displayName: string; agentKey: string | null; botEnabled: number;
  sendPaused: number; dailySendCap: number; quietStart: string | null; quietEnd: string | null; status: string;
  qrImage: string | null; qrExpiresAt: string | null; lastSeenAt: string | null; createdAt: string; updatedAt: string;
}
const ACCOUNT_SELECT = `SELECT id, channel, external_id AS externalId, display_name AS displayName, agent_key AS agentKey,
    bot_enabled AS botEnabled, send_paused AS sendPaused, daily_send_cap AS dailySendCap, quiet_start AS quietStart,
    quiet_end AS quietEnd, status, qr_image AS qrImage, qr_expires_at AS qrExpiresAt, last_seen_at AS lastSeenAt,
    created_at AS createdAt, updated_at AS updatedAt
  FROM channel_account`;
/** The login QR signs a company number into the bridge, so only admins receive it. */
const presentAccount = (row: AccountRow, actor: Actor) => ({
  ...row, botEnabled: row.botEnabled === 1, sendPaused: row.sendPaused === 1,
  qrImage: actor.role === 'admin' ? row.qrImage : null,
});
const loadAccount = (db: D1Database, actor: Actor, id: string) =>
  db.prepare(`${ACCOUNT_SELECT} WHERE id = ? AND organization_id = ?`).bind(id, actor.organizationId).first<AccountRow>();

inboxRoutes.get('/accounts', async (c) => {
  const actor = c.get('actor');
  const rows = await c.env.DB.prepare(`${ACCOUNT_SELECT} WHERE organization_id = ? ORDER BY display_name`).bind(actor.organizationId).all<AccountRow>();
  return c.json(ok(rows.results.map((r) => presentAccount(r, actor))));
});

inboxRoutes.post('/accounts', adminOnly, async (c) => {
  const input = await body(c, createAccountInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, display_name, agent_key, created_at, updated_at)
      VALUES (?, ?, 'zalo', ?, ?, ?, ?)`).bind(id, actor.organizationId, input.data.displayName, input.data.agentKey, now, now),
    auditRow(db, actor, 'inbox.createAccount', 'channel_account', id, null, input.data, now),
  ]);
  return c.json(ok(presentAccount((await loadAccount(db, actor, id))!, actor)));
});

inboxRoutes.patch('/accounts/:id', adminOnly, async (c) => {
  const input = await body(c, updateAccountInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const current = await loadAccount(db, actor, c.req.param('id')!);
  if (!current) return c.json(notFound, 404);
  const v = input.data;
  const next = {
    botEnabled: v.botEnabled ?? current.botEnabled === 1,
    sendPaused: v.sendPaused ?? current.sendPaused === 1,
    dailySendCap: v.dailySendCap ?? current.dailySendCap,
    quietStart: v.quietStart !== undefined ? v.quietStart : current.quietStart,
    quietEnd: v.quietEnd !== undefined ? v.quietEnd : current.quietEnd,
    agentKey: v.agentKey ?? current.agentKey,
  };
  if ((next.quietStart === null) !== (next.quietEnd === null)) {
    return c.json(fail('VALIDATION_FAILED', 'Giờ yên lặng cần cả giờ bắt đầu và kết thúc', { fields: { quietEnd: 'Thiếu' } }), 422);
  }
  const now = new Date().toISOString();
  const before = {
    botEnabled: current.botEnabled === 1, sendPaused: current.sendPaused === 1, dailySendCap: current.dailySendCap,
    quietStart: current.quietStart, quietEnd: current.quietEnd, agentKey: current.agentKey,
  };
  await db.batch([
    db.prepare(`UPDATE channel_account SET bot_enabled = ?, send_paused = ?, daily_send_cap = ?, quiet_start = ?, quiet_end = ?,
        agent_key = ?, updated_at = ? WHERE id = ?`)
      .bind(next.botEnabled ? 1 : 0, next.sendPaused ? 1 : 0, next.dailySendCap, next.quietStart, next.quietEnd, next.agentKey, now, current.id),
    auditRow(db, actor, 'inbox.updateAccount', 'channel_account', current.id, before, next, now),
  ]);
  return c.json(ok(presentAccount((await loadAccount(db, actor, current.id))!, actor)));
});

/** Queues a bridge login or logout for the account; repeated clicks within the same minute queue one command. */
async function queueSessionCommand(c: Ctx, kind: 'zalo_login' | 'zalo_logout') {
  const actor = c.get('actor');
  const db = c.env.DB;
  const account = await loadAccount(db, actor, c.req.param('id')!);
  if (!account) return c.json(notFound, 404);
  if (account.channel !== 'zalo') return c.json(fail('VALIDATION_FAILED', 'Chỉ tài khoản Zalo đăng nhập qua bridge'), 422);
  const now = new Date();
  const minute = now.toISOString().slice(0, 16);
  const commandId = await enqueueCommand(db, {
    kind, target: 'bridge', channelAccountId: account.id, payload: { accountId: account.id },
    dedupeKey: `${kind === 'zalo_login' ? 'login' : 'logout'}:${account.id}:${minute}`,
  });
  await auditRow(db, actor, kind === 'zalo_login' ? 'inbox.connectAccount' : 'inbox.disconnectAccount', 'channel_account',
    account.id, { status: account.status }, { commandId }, now.toISOString()).run();
  return c.json(ok({ commandId }));
}
inboxRoutes.post('/accounts/:id/connect', adminOnly, (c) => queueSessionCommand(c, 'zalo_login'));
inboxRoutes.post('/accounts/:id/disconnect', adminOnly, (c) => queueSessionCommand(c, 'zalo_logout'));

inboxRoutes.get('/customer-bot-switch', adminOnly, async (c) => {
  const row = await c.env.DB.prepare('SELECT enabled, updated_at FROM customer_bot_switch WHERE id = 1').first<{ enabled: number; updated_at: string | null }>();
  return c.json(ok({ enabled: row?.enabled === 1, updatedAt: row?.updated_at ?? null }));
});

inboxRoutes.put('/customer-bot-switch', adminOnly, async (c) => {
  const input = await body(c, botSwitchInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const now = new Date().toISOString();
  const before = await db.prepare('SELECT enabled FROM customer_bot_switch WHERE id = 1').first<{ enabled: number }>();
  const enabled = input.data.enabled ? 1 : 0;
  await db.batch([
    db.prepare(`INSERT INTO customer_bot_switch (id, enabled, updated_by_user_id, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`)
      .bind(enabled, actor.id, now),
    auditRow(db, actor, 'inbox.setCustomerBotSwitch', 'customer_bot_switch', '1', { enabled: before?.enabled === 1 }, { enabled: enabled === 1 }, now),
  ]);
  return c.json(ok({ enabled: enabled === 1, updatedAt: now }));
});

inboxRoutes.all('*', (c) => c.json(notFound, 404));
