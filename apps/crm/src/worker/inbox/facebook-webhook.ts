import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { background, type Env } from '../env';
import { markMessageSent } from './conversation-flow';
import { ingestMessage, type ChannelAccountRef, type InboundMessage } from './ingest';

/**
 * Messenger webhook of the Facebook app. Meta calls it without a browser origin or a
 * session, so it is mounted before those checks. A POST is accepted only with a valid `X-Hub-Signature-256`
 * over the raw body; messages then go through the shared ingest path after the response is sent.
 * Message text and tokens are never logged.
 */
export const facebookWebhookRoutes = new Hono<{ Bindings: Env }>();

/** Meta batches at most a few hundred events per request; this is far above that. */
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEXT = 20_000;
const encoder = new TextEncoder();

const graphId = z.string().min(1).max(128);
const attachmentSchema = z.object({ type: z.string().max(64).optional(), payload: z.object({ url: z.string().optional() }).nullish() });
const messagingSchema = z.object({
  sender: z.object({ id: graphId }),
  recipient: z.object({ id: graphId }),
  message: z.object({
    mid: z.string().min(1).max(512),
    text: z.string().max(MAX_TEXT).optional(),
    is_echo: z.boolean().optional(),
    metadata: z.string().max(1000).optional(),
    attachments: z.array(attachmentSchema).max(50).optional(),
  }).optional(),
});
const webhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ id: graphId, messaging: z.array(z.unknown()).optional() })),
});
type WebhookBody = z.infer<typeof webhookSchema>;
type MessagingEvent = z.infer<typeof messagingSchema>;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** True when `header` is `sha256=` + hex HMAC-SHA256(secret, body). crypto.subtle.verify compares in constant time. */
export async function verifyMetaSignature(secret: string, body: Uint8Array, header: string) {
  if (!header.startsWith('sha256=')) return false;
  const signature = hexToBytes(header.slice('sha256='.length));
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, body);
}

const findPage = (db: D1Database, pageId: string) =>
  db.prepare("SELECT id, organization_id FROM channel_account WHERE channel = 'facebook' AND external_id = ?").bind(pageId).first<ChannelAccountRef>();

/**
 * An echo is ours when its `mid` is the id Graph returned for a message we sent, or when its
 * `metadata` names one of our outgoing messages (every part of a split message carries it, and it also covers
 * an echo that arrives before the send response). The matching message is marked sent.
 */
async function matchMessengerEcho(db: D1Database, conversationId: string, mid: string, metadata: string | undefined) {
  const own = await db.prepare(`SELECT id FROM message
    WHERE conversation_id = ? AND direction = 'out' AND (external_msg_id = ? OR id = ?) LIMIT 1`)
    .bind(conversationId, mid, metadata ?? null).first<{ id: string }>();
  if (!own) return false;
  await markMessageSent(db, own.id, mid);
  return true;
}

const notEcho = async () => false;

/** Maps a Messenger event to the shared message shape; null for events that are not messages. */
function toInbound(event: MessagingEvent): InboundMessage | null {
  const message = event.message;
  if (!message) return null;
  const fromSelf = message.is_echo === true;
  const attachments = (message.attachments ?? []).flatMap((a) => {
    const url = a.payload?.url;
    return typeof url === 'string' && URL.canParse(url) ? [{ url }] : [];
  });
  return {
    // The thread is the customer's page-scoped id; in an echo the page is the sender and the customer the recipient.
    threadId: fromSelf ? event.recipient.id : event.sender.id,
    threadKind: 'direct',
    msgId: message.mid,
    fromSelf,
    senderExternalId: event.sender.id,
    senderName: null,
    text: message.text ?? '',
    attachments: attachments.length ? attachments : undefined,
  };
}

/** Ingests every message of the batch on its own; a failing event is logged and never stops the rest. */
export async function processMessengerWebhook(db: D1Database, body: WebhookBody): Promise<void> {
  if (body.object !== 'page') return;
  for (const entry of body.entry) {
    let account: ChannelAccountRef | null;
    try {
      account = await findPage(db, entry.id);
    } catch (error) {
      console.error('fb_webhook_error', error instanceof Error ? error.message : 'unknown');
      continue;
    }
    if (!account) {
      console.warn('fb_webhook_unknown_page');
      continue;
    }
    for (const raw of entry.messaging ?? []) {
      const parsed = messagingSchema.safeParse(raw);
      if (!parsed.success) continue;
      // Delivery and read receipts, reactions and postbacks carry no `message` and are skipped.
      const inbound = toInbound(parsed.data);
      if (!inbound) continue;
      const { mid, metadata } = parsed.data.message!;
      try {
        await ingestMessage(db, account, inbound, new Date(),
          inbound.fromSelf ? (conversationId) => matchMessengerEcho(db, conversationId, mid, metadata) : notEcho);
      } catch (error) {
        console.error('fb_webhook_error', error instanceof Error ? error.message : 'unknown');
      }
    }
  }
}

facebookWebhookRoutes.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));

/** Subscription handshake: echoes the challenge only for the configured verify token. */
facebookWebhookRoutes.get('/webhook', (c) => {
  const token = c.env.FB_VERIFY_TOKEN;
  if (token && c.req.query('hub.mode') === 'subscribe' && c.req.query('hub.verify_token') === token) {
    return c.text(c.req.query('hub.challenge') ?? '', 200);
  }
  return c.text('Forbidden', 403);
});

/** Signed event delivery; answered with 200 at once while the messages are stored in the background. */
facebookWebhookRoutes.post('/webhook', async (c) => {
  const secret = c.env.FB_APP_SECRET;
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (!secret || !(await verifyMetaSignature(secret, body, c.req.header('X-Hub-Signature-256') ?? ''))) {
    return c.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Chữ ký không hợp lệ' } }, 401);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    json = null;
  }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ' } }, 400);
  await background(c, processMessengerWebhook(c.env.DB, parsed.data));
  return c.text('EVENT_RECEIVED', 200);
});

facebookWebhookRoutes.all('*', (c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } }, 404));
