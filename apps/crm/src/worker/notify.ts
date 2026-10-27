import { buildPushPayload } from '@block65/webcrypto-web-push';
import { publish } from './chat';
import type { Sink } from './env';

export type NotificationKind =
  | 'chat_direct'
  | 'chat_mention'
  | 'chat_thread'
  | 'task_assigned'
  | 'task_due'
  | 'approval'
  | 'inbox'
  | 'system';

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
}

/** One notification for one user. `dedupeKey` is stored as given (callers that fan out append the user id). */
export interface NotificationRow {
  organizationId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
}

const PUSH_TTL_SECONDS = 3600;
const PUSH_MAX_SUBSCRIPTIONS = 20;
const PUSH_BODY_MAX_CHARS = 200;

/**
 * Stores in-app notifications for every user (deduplicated by key), tells each user's open tabs, and hands the
 * Web Push sends to `sink.waitUntil`. Never throws and never waits for the pushes.
 */
export async function notify(sink: Sink, input: NotifyInput): Promise<void> {
  const uniqueUserIds = [...new Set(input.userIds.map((u) => u.trim()).filter(Boolean))];
  await notifyRows(
    sink,
    uniqueUserIds.map((userId) => ({
      organizationId: input.organizationId,
      userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: input.link,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : undefined,
    })),
    PUSH_MAX_SUBSCRIPTIONS,
  );
}

/**
 * Stores many notifications with one D1 batch, publishes one live event per organization, reads the push
 * subscriptions with one query and pushes to at most `pushLimit` devices in the background. Rows past the
 * limit stay in-app only. Returns how many rows were newly inserted. Never throws.
 */
export async function notifyRows(sink: Sink, rows: NotificationRow[], pushLimit: number): Promise<number> {
  try {
    if (rows.length === 0) return 0;
    const db = sink.env.DB;
    const now = new Date().toISOString();

    const batchRes = await db.batch(
      rows.map((row) =>
        db.prepare(`
          INSERT OR IGNORE INTO notification
            (id, user_id, kind, title, body, link, dedupe_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            crypto.randomUUID(),
            row.userId,
            row.kind,
            row.title,
            row.body ?? null,
            row.link ?? null,
            row.dedupeKey ?? null,
            now,
          ),
      ),
    );

    const inserted = rows.filter((_, idx) => (batchRes[idx]?.meta?.changes ?? 0) === 1);
    if (inserted.length === 0) return 0;

    const usersByOrg = new Map<string, string[]>();
    for (const row of inserted) {
      const list = usersByOrg.get(row.organizationId) ?? [];
      list.push(row.userId);
      usersByOrg.set(row.organizationId, list);
    }
    for (const [organizationId, userIds] of usersByOrg) {
      publish(sink, organizationId, userIds, { type: 'notification' });
    }

    await queuePushes(sink, inserted, pushLimit);
    return inserted.length;
  } catch (err) {
    console.error('notify_failed', err instanceof Error ? err.message : 'unknown');
    return 0;
  }
}

type SubscriptionRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** Reads the subscriptions of the rows' users (one query) and hands the sends to `sink.waitUntil`. */
async function queuePushes(sink: Sink, rows: NotificationRow[], pushLimit: number): Promise<void> {
  const vapidPublicKey = sink.env.VAPID_PUBLIC_KEY?.trim();
  const vapidPrivateKey = sink.env.VAPID_PRIVATE_KEY?.trim();
  if (!vapidPublicKey || !vapidPrivateKey || pushLimit < 1) return;

  const db = sink.env.DB;
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const subs = await db.prepare(`
    SELECT id, user_id, endpoint, p256dh, auth
    FROM push_subscription
    WHERE user_id IN (SELECT value FROM json_each(?))
    ORDER BY created_at DESC, id DESC
    LIMIT ?`)
    .bind(JSON.stringify(userIds), pushLimit)
    .all<SubscriptionRow>();
  if (subs.results.length === 0) return;

  const subsByUser = new Map<string, SubscriptionRow[]>();
  for (const sub of subs.results) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }
  const sends: { sub: SubscriptionRow; payloadJson: string }[] = [];
  for (const row of rows) {
    const payloadJson = JSON.stringify({
      title: row.title,
      body: row.body ? row.body.slice(0, PUSH_BODY_MAX_CHARS) : undefined,
      link: row.link,
    });
    for (const sub of subsByUser.get(row.userId) ?? []) sends.push({ sub, payloadJson });
  }

  const vapid = {
    subject: sink.env.VAPID_SUBJECT?.trim() || 'mailto:admin@abm.example',
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
  };
  sink.waitUntil(sendPushes(db, sends.slice(0, pushLimit), vapid));
}

/** Sends each push once (no retry) and records the outcome per subscription in one batch. Never throws. */
async function sendPushes(
  db: D1Database,
  sends: { sub: SubscriptionRow; payloadJson: string }[],
  vapid: { subject: string; publicKey: string; privateKey: string },
): Promise<void> {
  try {
    const statements: D1PreparedStatement[] = [];
    const sentNow = new Date().toISOString();
    const failed = (id: string) =>
      db.prepare('UPDATE push_subscription SET failure_count = failure_count + 1 WHERE id = ?').bind(id);

    for (const { sub, payloadJson } of sends) {
      try {
        const payload = await buildPushPayload(
          { data: payloadJson, options: { ttl: PUSH_TTL_SECONDS } },
          { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          vapid,
        );
        const res = await fetch(sub.endpoint, payload);
        if (res.status === 404 || res.status === 410) {
          statements.push(db.prepare('DELETE FROM push_subscription WHERE id = ?').bind(sub.id));
        } else if (res.ok) {
          statements.push(
            db.prepare('UPDATE push_subscription SET last_success_at = ?, failure_count = 0 WHERE id = ?')
              .bind(sentNow, sub.id),
          );
        } else {
          statements.push(failed(sub.id));
        }
      } catch {
        statements.push(failed(sub.id));
      }
    }

    if (statements.length > 0) await db.batch(statements);
  } catch {
    // Background push work never throws.
  }
}
