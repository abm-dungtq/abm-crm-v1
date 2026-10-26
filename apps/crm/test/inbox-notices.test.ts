import { env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { ensureInboxConversation, notifyInboxUser, postInboxNotice } from '../src/worker/inbox-notices';
import app from '../src/worker/index';
import { resetDb } from './helpers/reset-db';
import { testSink } from './helpers/test-sink';

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

describe('inbox notices in CRM chat and notifications', () => {
  test('postInboxNotice twice with the same dedupe key creates one message; members include a leader and exclude a sale not on inbox_roster', async () => {
    // Put u-lan on inbox_roster; leave u-long (sale) off inbox_roster
    await db
      .prepare('INSERT INTO inbox_roster (user_id, on_duty) VALUES (?, 1)')
      .bind('u-lan')
      .run();

    const sink = testSink();

    await postInboxNotice(sink, db, {
      organizationId: 'org-abm',
      text: 'Handoff: Khách A cần tư vấn trực tiếp',
      link: '/inbox/conv-1',
      dedupeKey: 'handoff:conv-1:1',
    });

    await postInboxNotice(sink, db, {
      organizationId: 'org-abm',
      text: 'Handoff: Khách A cần tư vấn trực tiếp',
      link: '/inbox/conv-1',
      dedupeKey: 'handoff:conv-1:1',
    });

    const messages = await db
      .prepare("SELECT id, author_kind, body, meta_json FROM chat_message WHERE conversation_id = 'sys:inbox:org-abm'")
      .all<{ id: string; author_kind: string; body: string; meta_json: string | null }>();
    expect(messages.results).toHaveLength(1);
    expect(messages.results[0]).toMatchObject({
      id: 'notice:handoff:conv-1:1',
      author_kind: 'system',
      body: 'Handoff: Khách A cần tư vấn trực tiếp',
      meta_json: JSON.stringify({ link: '/inbox/conv-1' }),
    });

    const members = await db
      .prepare("SELECT user_id FROM chat_member WHERE conversation_id = 'sys:inbox:org-abm'")
      .all<{ user_id: string }>();
    const memberIds = members.results.map((m) => m.user_id);

    // Leader u-hung and roster member u-lan are included; sale u-long not on inbox_roster is excluded
    expect(memberIds).toContain('u-hung');
    expect(memberIds).toContain('u-lan');
    expect(memberIds).not.toContain('u-long');
  });

  test('notifyInboxUser creates one notification with kind inbox and deduplicates by dedupeKey', async () => {
    const sink = testSink();

    await notifyInboxUser(sink, {
      organizationId: 'org-abm',
      userId: 'u-lan',
      text: 'Bạn vừa được giao hội thoại mới',
      link: '/inbox/conv-2',
      dedupeKey: 'assign:conv-2',
    });

    await notifyInboxUser(sink, {
      organizationId: 'org-abm',
      userId: 'u-lan',
      text: 'Bạn vừa được giao hội thoại mới',
      link: '/inbox/conv-2',
      dedupeKey: 'assign:conv-2',
    });

    const rows = await db
      .prepare("SELECT kind, title, body, link FROM notification WHERE user_id = 'u-lan'")
      .all<{ kind: string; title: string; body: string; link: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toEqual({
      kind: 'inbox',
      title: 'Inbox',
      body: 'Bạn vừa được giao hội thoại mới',
      link: '/inbox/conv-2',
    });
  });
  test('the Inbox group drops people who no longer qualify; the others keep their read marker', async () => {
    await db.batch([
      db.prepare('INSERT INTO inbox_roster (user_id, on_duty) VALUES (?, 1)').bind('u-lan'),
      db.prepare('INSERT INTO inbox_roster (user_id, on_duty) VALUES (?, 1)').bind('u-long'),
    ]);
    const convId = await ensureInboxConversation(db, 'org-abm');
    const readAt = '2026-10-20T01:00:00.000Z';
    await db.prepare('UPDATE chat_member SET last_read_at = ? WHERE conversation_id = ?').bind(readAt, convId).run();

    // u-lan leaves the roster; leader u-mai is disabled.
    await db.batch([
      db.prepare("DELETE FROM inbox_roster WHERE user_id = 'u-lan'"),
      db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-mai'"),
    ]);
    await postInboxNotice(testSink(), db, { organizationId: 'org-abm', text: 'Thông báo mới', dedupeKey: 'after-roster-change' });

    const members = await db.prepare('SELECT user_id, last_read_at FROM chat_member WHERE conversation_id = ? ORDER BY user_id')
      .bind(convId).all<{ user_id: string; last_read_at: string | null }>();
    expect(members.results).toEqual(['u-admin', 'u-bgd', 'u-head', 'u-hung', 'u-long'].map((user_id) => ({ user_id, last_read_at: readAt })));
  });

  test('nobody adds or removes members of the Inbox group through the API', async () => {
    const convId = await ensureInboxConversation(db, 'org-abm');
    const call = async (user: string, method: string, path: string, body?: unknown) => {
      const res = await app.fetch(new Request(`http://crm.test/api${path}`, {
        method,
        headers: { 'X-Demo-User': user, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), { ...env, DEMO_MODE: '1' });
      return { status: res.status, json: await res.json() as { ok: boolean; data?: { system?: boolean } } };
    };
    const path = `/chat/conversations/${encodeURIComponent(convId)}`;

    expect((await call('u-admin', 'GET', path)).json.data?.system).toBe(true);
    expect((await call('u-admin', 'POST', `${path}/members`, { userIds: ['u-lan'] })).status).toBe(403);
    expect((await call('u-admin', 'DELETE', `${path}/members/u-hung`)).status).toBe(403);
    // Leaving by oneself is refused as well: membership follows the roster.
    expect((await call('u-hung', 'DELETE', `${path}/members/u-hung`)).status).toBe(403);
    const members = await db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ?').bind(convId).all<{ user_id: string }>();
    expect(members.results.map((m) => m.user_id)).toContain('u-hung');
    expect(members.results.map((m) => m.user_id)).not.toContain('u-lan');
  });
});
