import { env, type D1Migration } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import type { Env as WorkerEnv } from '../src/worker/env';
import app from '../src/worker/index';
import { notifyDueTasks } from '../src/worker/inbox/scheduled';
import { notify } from '../src/worker/notify';
import { resetDb } from './helpers/reset-db';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      CHAT_HUB: DurableObjectNamespace;
      TEST_MIGRATIONS: D1Migration[];
      DEMO_MODE: string;
      AUTH_MODE: string;
    }
  }
}

const db = env.DB;
beforeEach(() => resetDb(db, seedSql));
afterEach(() => vi.restoreAllMocks());

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string>; details?: any } };

async function call(user: string, method: string, path: string, body?: unknown, key: string = crypto.randomUUID()) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}
const command = (user: string, name: string, body: unknown, key?: string) => call(user, 'POST', `/commands/${name}`, body, key);
const lead = (id: string) => db.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first<Record<string, any>>();
const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of u8) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('notifications and web push', () => {
  test('1. direct message u-lan -> u-huy creates one chat_direct notification for u-huy, none for u-lan; duplicate message id does not add one', async () => {
    void lead;
    void count;
    const dm = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    expect(dm.status).toBe(200);
    const convId = dm.json.data.id as string;

    const msgId = crypto.randomUUID();
    const p1 = await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: msgId,
      body: 'Chào @[Bùi Quang Huy](user:u-huy)',
    });
    expect(p1.status).toBe(200);

    // Posting the same message id again does not add another notification
    const p2 = await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: msgId,
      body: 'Chào @[Bùi Quang Huy](user:u-huy)',
    });
    expect(p2.status).toBe(200);

    const huyList = await call('u-huy', 'GET', '/notifications');
    expect(huyList.status).toBe(200);
    expect(huyList.json.data).toHaveLength(1);
    expect(huyList.json.data[0]).toMatchObject({
      kind: 'chat_direct',
      title: 'Đỗ Ngọc Lan',
      body: 'Chào @Bùi Quang Huy',
      link: `/chat/${convId}`,
    });

    const lanList = await call('u-lan', 'GET', '/notifications');
    expect(lanList.status).toBe(200);
    expect(lanList.json.data).toHaveLength(0);
  });

  test('2. group message mentioning @[Đỗ Ngọc Lan](user:u-lan) creates chat_mention for u-lan only', async () => {
    const grp = await call('u-long', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm KD1',
      memberUserIds: ['u-lan', 'u-hung'],
    });
    expect(grp.status).toBe(200);
    const convId = grp.json.data.id as string;

    const post = await call('u-long', 'POST', `/chat/conversations/${convId}/messages`, {
      id: crypto.randomUUID(),
      body: 'Nhờ @[Đỗ Ngọc Lan](user:u-lan) gửi báo giá nhé',
    });
    expect(post.status).toBe(200);

    const lanNotifs = await call('u-lan', 'GET', '/notifications');
    expect(lanNotifs.json.data).toHaveLength(1);
    expect(lanNotifs.json.data[0]).toMatchObject({
      kind: 'chat_mention',
      body: 'Nhờ @Đỗ Ngọc Lan gửi báo giá nhé',
      link: `/chat/${convId}`,
    });

    const hungNotifs = await call('u-hung', 'GET', '/notifications');
    expect(hungNotifs.json.data).toHaveLength(0);

    const longNotifs = await call('u-long', 'GET', '/notifications');
    expect(longNotifs.json.data).toHaveLength(0);
  });

  test('3. createTask by u-lan assigned to u-long -> task_assigned for u-long; assigned to self -> none', async () => {
    const toLong = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Gọi lại khách hàng mới',
      assigneeUserId: 'u-long',
    });
    expect(toLong.status).toBe(200);
    const taskId = toLong.json.data.taskId as string;

    const longNotifs = await call('u-long', 'GET', '/notifications');
    expect(longNotifs.json.data).toHaveLength(1);
    expect(longNotifs.json.data[0]).toMatchObject({
      kind: 'task_assigned',
      link: `/tasks/${taskId}`,
    });

    const toSelf = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Việc tự làm',
      assigneeUserId: 'u-lan',
    });
    expect(toSelf.status).toBe(200);

    const lanNotifs = await call('u-lan', 'GET', '/notifications');
    expect(lanNotifs.json.data).toHaveLength(0);
  });

  test('4. notifyDueTasks with a task due in 10 minutes -> one task_due; running it twice -> still one', async () => {
    const now = new Date();
    const in10m = new Date(now.getTime() + 10 * 60_000).toISOString();

    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Họp chốt hợp đồng trong 10 phút',
      assigneeUserId: 'u-lan',
      dueAt: in10m,
    });
    expect(created.status).toBe(200);
    const taskId = created.json.data.taskId as string;

    const sink = { env: { ...(env as unknown as WorkerEnv), DEMO_MODE: '1' }, waitUntil: () => undefined };
    await notifyDueTasks(sink, now);
    await notifyDueTasks(sink, now);

    const lanNotifs = await call('u-lan', 'GET', '/notifications');
    const dueNotifs = lanNotifs.json.data.filter((n: any) => n.kind === 'task_due' && n.link === `/tasks/${taskId}`);
    expect(dueNotifs).toHaveLength(1);
  });

  test('5. push sender: 410 deletes subscription, 201 sets last_success_at, and request has Content-Encoding: aes128gcm', async () => {
    // Generate throwaway VAPID ECDSA P-256 keypair
    const vapidPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const vapidPublicRaw = (await crypto.subtle.exportKey('raw', vapidPair.publicKey)) as ArrayBuffer;
    const vapidPrivateJwk = (await crypto.subtle.exportKey('jwk', vapidPair.privateKey)) as JsonWebKey;
    const vapidPublicKey = toBase64Url(vapidPublicRaw);
    const vapidPrivateKey = vapidPrivateJwk.d!;

    // Generate throwaway subscription ECDH P-256 keypair and 16-byte auth secret
    const makeSubKeys = async () => {
      const ecdh = (await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      )) as CryptoKeyPair;
      const p256dh = toBase64Url((await crypto.subtle.exportKey('raw', ecdh.publicKey)) as ArrayBuffer);
      const authBytes = crypto.getRandomValues(new Uint8Array(16));
      const auth = toBase64Url(authBytes);
      return { p256dh, auth };
    };

    const keysGone = await makeSubKeys();
    const keysOk = await makeSubKeys();
    const endpointGone = 'https://push.example/sub-410';
    const endpointOk = 'https://push.example/sub-201';

    const sub1 = await call('u-lan', 'POST', '/push/subscriptions', {
      endpoint: endpointGone,
      keys: keysGone,
    });
    expect(sub1.status).toBe(200);

    const sub2 = await call('u-lan', 'POST', '/push/subscriptions', {
      endpoint: endpointOk,
      keys: keysOk,
    });
    expect(sub2.status).toBe(200);

    const seenEncodings: (string | null)[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      seenEncodings.push(headers.get('Content-Encoding'));
      if (url === endpointGone) {
        return new Response(null, { status: 410 });
      }
      return new Response(null, { status: 201 });
    });

    const pending: Promise<unknown>[] = [];
    await notify(
      {
        env: {
          ...(env as unknown as WorkerEnv),
          VAPID_PUBLIC_KEY: vapidPublicKey,
          VAPID_PRIVATE_KEY: vapidPrivateKey,
          VAPID_SUBJECT: 'mailto:test@abm.example',
        },
        waitUntil: (w) => {
          pending.push(w);
        },
      },
      {
        organizationId: 'org-abm',
        userIds: ['u-lan'],
        kind: 'system',
        title: 'Kiểm tra Web Push',
        body: 'Nội dung thử nghiệm',
        link: '/tasks',
        dedupeKey: 'test-push-1',
      },
    );
    await Promise.all(pending);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(seenEncodings).toEqual(['aes128gcm', 'aes128gcm']);

    const rowGone = await db.prepare('SELECT id FROM push_subscription WHERE endpoint = ?')
      .bind(endpointGone)
      .first();
    expect(rowGone).toBeNull();

    const rowOk = await db.prepare('SELECT last_success_at, failure_count FROM push_subscription WHERE endpoint = ?')
      .bind(endpointOk)
      .first<{ last_success_at: string | null; failure_count: number }>();
    expect(rowOk?.last_success_at).toBeTruthy();
    expect(rowOk?.failure_count).toBe(0);
  });

  test('6. GET /notifications/unread reflects reads after POST /notifications/read', async () => {
    const dm = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const convId = dm.json.data.id as string;

    await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: crypto.randomUUID(),
      body: 'Tin 1',
    });
    await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: crypto.randomUUID(),
      body: 'Tin 2',
    });

    const unreadBefore = await call('u-huy', 'GET', '/notifications/unread');
    expect(unreadBefore.json.data.total).toBe(2);

    const list = await call('u-huy', 'GET', '/notifications');
    expect(list.json.data).toHaveLength(2);
    const firstId = list.json.data[0].id as string;

    // Mark one read
    const readOne = await call('u-huy', 'POST', '/notifications/read', { ids: [firstId] });
    expect(readOne.status).toBe(200);

    const unreadMid = await call('u-huy', 'GET', '/notifications/unread');
    expect(unreadMid.json.data.total).toBe(1);

    // Mark all read
    const readAll = await call('u-huy', 'POST', '/notifications/read', {});
    expect(readAll.status).toBe(200);

    const unreadAfter = await call('u-huy', 'GET', '/notifications/unread');
    expect(unreadAfter.json.data.total).toBe(0);
  });

  test('7. D1 budget: ONE POST of a task comment with 10 mentions uses <= 40 D1 queries', async () => {
    // Seed 3 extra active users so we have 10 distinct mention targets
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, status, created_at, updated_at)
        VALUES ('u-extra-1', 'org-abm', 'dep-kd', 'team-kd1', 'Nhân viên 1', 'e1@demo.abm.example', 'sale', 'active', ?, ?)`).bind(now, now),
      db.prepare(`INSERT OR IGNORE INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, status, created_at, updated_at)
        VALUES ('u-extra-2', 'org-abm', 'dep-kd', 'team-kd1', 'Nhân viên 2', 'e2@demo.abm.example', 'sale', 'active', ?, ?)`).bind(now, now),
      db.prepare(`INSERT OR IGNORE INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, status, created_at, updated_at)
        VALUES ('u-extra-3', 'org-abm', 'dep-kd', 'team-kd2', 'Nhân viên 3', 'e3@demo.abm.example', 'sale', 'active', ?, ?)`).bind(now, now),
    ]);

    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Việc kiểm tra ngân sách truy vấn D1',
      assigneeUserId: 'u-long',
    });
    const taskId = created.json.data.taskId as string;

    const tenMentions = [
      '@[Admin](user:u-admin)',
      '@[BGĐ](user:u-bgd)',
      '@[Head](user:u-head)',
      '@[Hùng](user:u-hung)',
      '@[Lan](user:u-lan)',
      '@[Long](user:u-long)',
      '@[Mai](user:u-mai)',
      '@[Huy](user:u-huy)',
      '@[NV1](user:u-extra-1)',
      '@[NV2](user:u-extra-2)',
    ].join(' ');

    let batchCalls = 0;
    let outsideBatchExecs = 0;
    let insideBatch = false;

    const origBatch = db.batch.bind(db);
    const origPrepare = db.prepare.bind(db);

    const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement => {
      const origBind = stmt.bind.bind(stmt);
      const origFirst = stmt.first.bind(stmt);
      const origAll = stmt.all.bind(stmt);
      const origRun = stmt.run.bind(stmt);
      const origRaw = stmt.raw.bind(stmt);

      stmt.bind = (...args: unknown[]) => wrapStmt(origBind(...args));
      stmt.first = ((...args: [string?]) => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origFirst(...(args as [never]));
      }) as typeof stmt.first;
      stmt.all = (() => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origAll();
      }) as typeof stmt.all;
      stmt.run = (() => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origRun();
      }) as typeof stmt.run;
      stmt.raw = ((...args: [never?]) => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origRaw(...args);
      }) as typeof stmt.raw;
      return stmt;
    };

    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => wrapStmt(origPrepare(sql)));
    const batchSpy = vi.spyOn(db, 'batch').mockImplementation(async (stmts: D1PreparedStatement[]) => {
      batchCalls += 1;
      insideBatch = true;
      try {
        return await origBatch(stmts);
      } finally {
        insideBatch = false;
      }
    });

    const post = await call('u-lan', 'POST', `/tasks/${taskId}/comments`, {
      id: crypto.randomUUID(),
      body: `Bình luận 10 người: ${tenMentions}`,
    });
    expect(post.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalled();

    const totalD1 = batchCalls + outsideBatchExecs;
    expect(totalD1).toBeLessThanOrEqual(40);
  });

  test('8. D1 budget: group message mentioning 1 agent + 5 users uses <= 50 D1 queries', async () => {
    await db
      .prepare('UPDATE inbox_setting SET bridge_last_seen_at = ? WHERE id = 1')
      .bind(new Date().toISOString())
      .run();

    const agentRes = await call('u-admin', 'POST', '/admin/chat-agents', {
      displayName: 'Trợ lý',
      dmAgentKey: 'crm-assistant',
      groupAgentKey: 'crm-group-assistant',
    });
    const agentId = agentRes.json.data.id as string;

    const grp = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm ngân sách D1',
      memberUserIds: ['u-long', 'u-hung', 'u-head', 'u-bgd', 'u-mai'],
    });
    const convId = grp.json.data.id as string;

    await call('u-lan', 'POST', `/chat/conversations/${convId}/agents`, { agentId });

    const fiveUsersAndOneAgent = [
      `@[Trợ lý](agent:${agentId})`,
      '@[Long](user:u-long)',
      '@[Hùng](user:u-hung)',
      '@[Head](user:u-head)',
      '@[BGĐ](user:u-bgd)',
      '@[Mai](user:u-mai)',
    ].join(' ');

    let batchCalls = 0;
    let outsideBatchExecs = 0;
    let insideBatch = false;

    const origBatch = db.batch.bind(db);
    const origPrepare = db.prepare.bind(db);

    const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement => {
      const origBind = stmt.bind.bind(stmt);
      const origFirst = stmt.first.bind(stmt);
      const origAll = stmt.all.bind(stmt);
      const origRun = stmt.run.bind(stmt);
      const origRaw = stmt.raw.bind(stmt);

      stmt.bind = (...args: unknown[]) => wrapStmt(origBind(...args));
      stmt.first = ((...args: [string?]) => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origFirst(...(args as [never]));
      }) as typeof stmt.first;
      stmt.all = (() => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origAll();
      }) as typeof stmt.all;
      stmt.run = (() => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origRun();
      }) as typeof stmt.run;
      stmt.raw = ((...args: [never?]) => {
        if (!insideBatch) outsideBatchExecs += 1;
        return origRaw(...args);
      }) as typeof stmt.raw;
      return stmt;
    };

    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => wrapStmt(origPrepare(sql)));
    const batchSpy = vi.spyOn(db, 'batch').mockImplementation(async (stmts: D1PreparedStatement[]) => {
      batchCalls += 1;
      insideBatch = true;
      try {
        return await origBatch(stmts);
      } finally {
        insideBatch = false;
      }
    });

    const post = await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: crypto.randomUUID(),
      body: `Họp cùng ${fiveUsersAndOneAgent}`,
    });
    expect(post.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalled();

    const totalD1 = batchCalls + outsideBatchExecs;
    expect(totalD1).toBeLessThanOrEqual(50);

    // The measured request really scheduled the agent turn and notified the five mentioned users.
    const turns = await db
      .prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'run_completion' AND dedupe_key LIKE 'chat-turn:%'")
      .first<{ n: number }>();
    expect(turns?.n).toBe(1);
    const mentioned = await db
      .prepare("SELECT COUNT(*) AS n FROM notification WHERE kind = 'chat_mention'")
      .first<{ n: number }>();
    expect(mentioned?.n).toBe(5);
  });

  test('9. budget: a worst-case per-minute cron run stays within 40 D1 queries and 35 subrequests', async () => {
    const { runScheduled, EVERY_MINUTE_CRON } = await import('../src/worker/inbox/scheduled');
    const { enqueueCommand } = await import('../src/worker/inbox/dispatcher');
    // Minute 0 also runs the Zalo OA token refresh step.
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const stamp = now.toISOString();
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    const assignees = ['u-admin', 'u-bgd', 'u-head', 'u-hung', 'u-lan', 'u-long', 'u-mai', 'u-huy'];
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const subKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const p256dh = toBase64Url(await crypto.subtle.exportKey('raw', subKey.publicKey) as ArrayBuffer);
    await db.batch([
      // 8 due tasks (more than one run takes), three devices for every assignee.
      ...assignees.map((uid, i) => db.prepare(`INSERT INTO task (id, kind, title, due_at, assignee_user_id, status, created_at, updated_at)
        VALUES (?, 'internal', ?, ?, ?, 'open', ?, ?)`).bind(`t-due-${i}`, `Việc ${i}`, new Date(now.getTime() + (5 + i) * 60_000).toISOString(), uid, stamp, stamp)),
      ...assignees.flatMap((uid) => [1, 2, 3].map((n) => db.prepare(`INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(`ps-${uid}-${n}`, uid, `https://push.example/${uid}/${n}`, p256dh, toBase64Url(crypto.getRandomValues(new Uint8Array(16))), stamp))),
      db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
        VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(stamp, stamp),
      // Three overdue human conversations (SLA reminders).
      ...[1, 2, 3].map((n) => db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, mode,
          assignee_user_id, sla_due_at, created_at, updated_at)
        VALUES (?, 'org-abm', 'ca-1', 'direct', ?, ?, 'human', 'u-lan', ?, ?, ?)`).bind(`conv-sla-${n}`, `cust-sla-${n}`, `Khách ${n}`, ago(n), stamp, stamp)),
      // One bot conversation whose reply went stale (handoff).
      db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, mode, created_at, updated_at)
        VALUES ('conv-ai', 'org-abm', 'ca-1', 'direct', 'cust-ai', 'Khách AI', 'ai', ?, ?)`).bind(stamp, stamp),
    ]);
    const staleReply = await enqueueCommand(db, { kind: 'run_completion', target: 'bridge', channelAccountId: 'ca-1', conversationId: 'conv-ai',
      payload: { agentKey: 'sales-bot', userId: 'zalo:zalo-acc-1:cust-ai', text: 'Cho em hỏi', conversationId: 'conv-ai', purpose: 'reply' }, dedupeKey: 'stale-1' });
    await db.prepare('UPDATE channel_command SET created_at = ?, next_run_at = ? WHERE id = ?').bind(ago(11), ago(11), staleReply).run();
    // Two commands for the Worker's dispatcher.
    for (const n of [1, 2]) {
      await enqueueCommand(db, { kind: 'send_messenger', target: 'worker', payload: { messageId: `missing-${n}` }, dedupeKey: `worker-${n}` });
    }

    let d1 = 0;
    let insideBatch = false;
    const origBatch = db.batch.bind(db);
    const origPrepare = db.prepare.bind(db);
    const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
      const [bind, first, all, run, raw] = [stmt.bind.bind(stmt), stmt.first.bind(stmt), stmt.all.bind(stmt), stmt.run.bind(stmt), stmt.raw.bind(stmt)];
      const count = () => { if (!insideBatch) d1 += 1; };
      stmt.bind = (...args: unknown[]) => wrap(bind(...args));
      stmt.first = ((...a: [string?]) => { count(); return first(...(a as [never])); }) as typeof stmt.first;
      stmt.all = (() => { count(); return all(); }) as typeof stmt.all;
      stmt.run = (() => { count(); return run(); }) as typeof stmt.run;
      stmt.raw = ((...a: [never?]) => { count(); return raw(...a); }) as typeof stmt.raw;
      return stmt;
    };
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => wrap(origPrepare(sql)));
    vi.spyOn(db, 'batch').mockImplementation(async (stmts: D1PreparedStatement[]) => {
      d1 += 1;
      insideBatch = true;
      try { return await origBatch(stmts); } finally { insideBatch = false; }
    });
    let pushes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { pushes += 1; return new Response(null, { status: 201 }); });
    let hubCalls = 0;
    const hub = { fetch: async () => { hubCalls += 1; return new Response('ok'); } };
    const pending: Promise<unknown>[] = [];
    const cronEnv = {
      ...(env as unknown as WorkerEnv),
      CHAT_HUB: { idFromName: () => 'org', get: () => hub } as unknown as DurableObjectNamespace,
      VAPID_PUBLIC_KEY: toBase64Url(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer),
      VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey) as JsonWebKey).d!,
    };
    await runScheduled(cronEnv, EVERY_MINUTE_CRON, { waitUntil: (w: Promise<unknown>) => { pending.push(w); }, passThroughOnException: () => undefined } as unknown as ExecutionContext, now);
    await Promise.all(pending);
    vi.restoreAllMocks();

    // The run really did every kind of work it was seeded with.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM notification WHERE kind = 'task_due'").first<{ n: number }>()).toEqual({ n: 5 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM chat_message WHERE id LIKE 'notice:sla:%'").first<{ n: number }>()).toEqual({ n: 3 });
    expect(await db.prepare("SELECT mode FROM conversation WHERE id = 'conv-ai'").first<{ mode: string }>()).toEqual({ mode: 'human' });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'send_messenger' AND attempts = 1 AND result_json IS NOT NULL").first<{ n: number }>()).toEqual({ n: 2 });
    console.log('cron_budget', { d1, pushes, hubCalls, subrequests: pushes + hubCalls });
    expect(pushes).toBe(15);
    expect(d1).toBeLessThanOrEqual(40);
    expect(pushes + hubCalls).toBeLessThanOrEqual(35);
  });
});
