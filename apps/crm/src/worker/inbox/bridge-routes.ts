import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { bridgeCommandResultSchema, bridgeEventsBodySchema } from '@abm/contracts';
import type { z } from 'zod';
import { background } from '../env';
import { bridgeAuth, type BridgeBindings } from './bridge-auth';
import { BOT_OFF, BOT_SEND_BLOCKED_SQL, applyCompletionResult, markMessageSent } from './conversation-flow';
import { MAX_COMMAND_ATTEMPTS, claimCommands, completeCommand, dropBotSend, failCommand, type ClaimedCommand } from './dispatcher';
import { applyGroupSummaryResult } from './group-summaries';
import { ingestEvents } from './ingest';
import { applyExtractionResult } from './intake';
import { processWorkerCommands } from './worker-commands';

/**
 * API for the Zalo bridge sidecar (ADR-008): push events, long-poll commands, report command results.
 * Every request is HMAC-signed; see bridge-auth.ts for the signature format.
 */
export const bridgeRoutes = new Hono<BridgeBindings>();

/** 100 events of up to 20k characters each, or a QR image, fit well inside this. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 1000;
const CLAIM_LIMIT = 20;
const SEND_KINDS = new Set(['send_zalo', 'send_messenger']);

const ok = <T>(data: T) => ({ ok: true as const, data });
const invalid = (fields: Record<string, string>) =>
  ({ ok: false as const, error: { code: 'VALIDATION_FAILED' as const, message: 'Dữ liệu không hợp lệ', fields } });
const notFound = { ok: false as const, error: { code: 'NOT_FOUND' as const, message: 'Không tìm thấy lệnh' } };

function parseBody<S extends z.ZodType>(raw: string, schema: S): { data: z.infer<S> } | { fields: Record<string, string> } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { fields: { form: 'JSON không hợp lệ' } };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { data: parsed.data };
  return { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || 'form', i.message])) };
}

/** A send that will not be retried leaves its message failed. */
async function failSend(db: D1Database, command: { id: string; kind: string; payload: unknown }, attempts: number, error: string) {
  const moved = await failCommand(db, command.id, attempts, error);
  if (moved && attempts >= MAX_COMMAND_ATTEMPTS && SEND_KINDS.has(command.kind)) {
    const messageId = (command.payload as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId === 'string') {
      await db.prepare("UPDATE message SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(messageId).run();
    }
  }
  return moved;
}

/**
 * Claims due bridge commands. A bot message is dropped for good while the customer bot switch is on or the account's
 * bot is off (a late bot reply must not go out when the bot comes back); other sends of a paused account are failed
 * and retried by backoff. Neither is handed out.
 */
async function claimDeliverable(db: D1Database): Promise<ClaimedCommand[]> {
  const claimed = await claimCommands(db, 'bridge', CLAIM_LIMIT);
  const sends = claimed.filter((c) => SEND_KINDS.has(c.kind) && c.channelAccountId);
  if (!sends.length) return claimed;
  const accountIds = [...new Set(sends.map((c) => c.channelAccountId!))];
  const paused = await db.prepare(`SELECT id FROM channel_account WHERE send_paused = 1 AND id IN (${accountIds.map(() => '?').join(', ')})`)
    .bind(...accountIds).all<{ id: string }>();
  const pausedIds = new Set(paused.results.map((r) => r.id));
  const blocked = await db.prepare(`SELECT cc.id FROM channel_command cc
      JOIN message m ON m.id = json_extract(cc.payload_json, '$.messageId') JOIN channel_account a ON a.id = cc.channel_account_id
    WHERE cc.id IN (SELECT value FROM json_each(?)) AND ${BOT_SEND_BLOCKED_SQL}`)
    .bind(JSON.stringify(sends.map((c) => c.id))).all<{ id: string }>();
  const blockedIds = new Set(blocked.results.map((r) => r.id));
  const deliverable: ClaimedCommand[] = [];
  for (const command of claimed) {
    if (blockedIds.has(command.id)) {
      await dropBotSend(db, command, BOT_OFF);
    } else if (SEND_KINDS.has(command.kind) && command.channelAccountId && pausedIds.has(command.channelAccountId)) {
      await failSend(db, command, command.attempts, 'ACCOUNT_PAUSED');
    } else {
      deliverable.push(command);
    }
  }
  return deliverable;
}

bridgeRoutes.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));
bridgeRoutes.use('*', bridgeAuth);

bridgeRoutes.post('/events', async (c) => {
  const input = parseBody(c.get('bridgeBody'), bridgeEventsBodySchema);
  if ('fields' in input) return c.json(invalid(input.fields), 422);
  return c.json(ok(await ingestEvents(c.env.DB, input.data.events)));
});

bridgeRoutes.get('/commands', async (c) => {
  const raw = c.req.query('wait');
  const wait = raw === undefined || raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(wait)) return c.json(invalid({ wait: 'Phải là số giây nguyên' }), 422);
  const deadline = Date.now() + Math.min(Math.max(wait, 0), MAX_WAIT_SECONDS) * 1000;
  for (;;) {
    const commands = await claimDeliverable(c.env.DB);
    const remaining = deadline - Date.now();
    if (commands.length || remaining <= 0) return c.json(ok(commands));
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)));
  }
});

bridgeRoutes.post('/commands/:id/result', async (c) => {
  const input = parseBody(c.get('bridgeBody'), bridgeCommandResultSchema);
  if ('fields' in input) return c.json(invalid(input.fields), 422);
  const db = c.env.DB;
  const row = await db.prepare("SELECT id, kind, conversation_id, payload_json FROM channel_command WHERE id = ? AND target = 'bridge'")
    .bind(c.req.param('id')).first<{ id: string; kind: string; conversation_id: string | null; payload_json: string }>();
  if (!row) return c.json(notFound, 404);
  const command = { id: row.id, kind: row.kind, payload: JSON.parse(row.payload_json) as unknown };
  const result = input.data;

  if (!result.ok) {
    const moved = await failSend(db, command, result.attempts, result.error || 'BRIDGE_ERROR');
    return c.json(ok({ ignored: !moved }));
  }
  // The CRM extractor's answer fills a lead intake; it is never sent to the customer.
  const purpose = row.kind === 'run_completion' ? (command.payload as { purpose?: unknown } | null)?.purpose : undefined;
  if (purpose === 'extract') {
    const owned = await applyExtractionResult(db, { id: row.id, attempts: result.attempts, conversationId: row.conversation_id }, result.text ?? '');
    return c.json(ok({ ignored: !owned }));
  }
  // A group summary goes to the Lark inbox group; it is never sent into the Zalo group.
  if (purpose === 'group_summary') {
    const owned = await applyGroupSummaryResult(db, { id: row.id, attempts: result.attempts, conversationId: row.conversation_id }, result.text ?? '');
    if (owned) await background(c, processWorkerCommands(c.env));
    return c.json(ok({ ignored: !owned }));
  }
  const completed = await completeCommand(db, row.id, result.attempts,
    { externalMsgId: result.externalMsgId ?? null, text: result.text ?? null });
  if (!completed) return c.json(ok({ ignored: true }));

  if (row.kind === 'run_completion' && row.conversation_id) {
    const outcome = await applyCompletionResult(db, c.env, row.conversation_id, result.text ?? '', new URL(c.req.url).origin);
    if (outcome.workerCommandQueued) await background(c, processWorkerCommands(c.env));
  } else if (SEND_KINDS.has(row.kind)) {
    const messageId = (command.payload as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId === 'string') await markMessageSent(db, messageId, result.externalMsgId ?? null);
  }
  return c.json(ok({ ignored: false }));
});

bridgeRoutes.all('*', (c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } }, 404));
