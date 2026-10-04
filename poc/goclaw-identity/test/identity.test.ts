import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { tokenHash } from '../src/mcp-tools';

let db: D1Database;
const bindings = () => ({ DB: db, ADMIN_TOKEN: 'local-admin-test' });
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
async function call(token: string, name = 'whoami', args: Record<string, unknown> = {}) {
  return app.request('/mcp', { method: 'POST', headers: headers(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, bindings());
}
async function counts() {
  return {
    activity: await db.prepare('SELECT COUNT(*) AS n FROM activity').first<number>('n'),
    audit: await db.prepare('SELECT COUNT(*) AS n FROM audit_log').first<number>('n')
  };
}
beforeAll(async () => {
  db = env.DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch([
    db.prepare("INSERT INTO user VALUES ('A', 'a@example.test'), ('B', 'b@example.test')"),
    db.prepare("INSERT INTO lark_group_binding VALUES ('CRM-PoC', 'Sales test')")
  ]);
  for (const id of ['A', 'B', 'CRM-PoC']) await db.prepare('INSERT INTO mcp_credential VALUES (?, ?, ?, 0)')
    .bind(await tokenHash(`local-${id}-test`), id === 'CRM-PoC' ? 'group' : 'user', id).run();
}, 30000);
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM audit_log'), db.prepare('DELETE FROM activity'),
    db.prepare('UPDATE agent_kill_switch SET enabled = 0'), db.prepare('UPDATE mcp_credential SET revoked = 0')
  ]);
});
describe('credential identity and guarded writes', () => {
  it('rejects missing, invalid and revoked credentials', async () => {
    expect((await app.request('/mcp', { method: 'POST' }, bindings())).status).toBe(401);
    expect((await call('invalid')).status).toBe(401);
    await db.prepare('UPDATE mcp_credential SET revoked = 1 WHERE subject_id = ?').bind('A').run();
    expect((await call('local-A-test')).status).toBe(401);
  });
  it('returns distinct users and group identity from credentials', async () => {
    for (const id of ['A', 'B', 'CRM-PoC']) {
      const response = await (await call(`local-${id}-test`)).json() as any;
      expect(JSON.parse(response.result.content[0].text).subject_id).toBe(id);
    }
  });
  it('ignores a spoofed actor and writes the authenticated B with audit', async () => {
    await call('local-B-test', 'add_activity', { lead_ref: 'L1', note: 'Follow up', acting_user: 'A' });
    expect(await counts()).toEqual({ activity: 1, audit: 1 });
    expect(await db.prepare('SELECT subject_id FROM activity').first('subject_id')).toBe('B');
    expect(await db.prepare('SELECT initiating_user FROM audit_log').first('initiating_user')).toBe('B');
    expect(await db.prepare('SELECT executing_actor FROM audit_log').first('executing_actor')).toBe('goclaw');
  });
  it('does not assign a human initiating user to a group credential', async () => {
    await call('local-CRM-PoC-test', 'add_activity', { lead_ref: 'L1', note: 'Group note', acting_user: 'A' });
    expect(await db.prepare('SELECT initiating_user FROM audit_log').first('initiating_user')).toBeNull();
  });
  it('authenticates switch operations and blocks all writes until disabled', async () => {
    expect((await app.request('/admin/kill-switch', { method: 'POST', headers: headers('invalid'), body: '{"enabled":true}' }, bindings())).status).toBe(401);
    expect((await app.request('/admin/kill-switch', { method: 'POST', headers: headers('local-A-test'), body: '{"enabled":true}' }, bindings())).status).toBe(401);
    await app.request('/admin/kill-switch', { method: 'POST', headers: headers('local-admin-test'), body: '{"enabled":true}' }, bindings());
    const response = await (await call('local-A-test', 'add_activity', { lead_ref: 'L1', note: 'Blocked' })).json() as any;
    expect(response.result.isError).toBe(true);
    expect(JSON.parse(response.result.content[0].text).code).toBe('KILL_SWITCH_ON');
    expect(await counts()).toEqual({ activity: 0, audit: 0 });
    await app.request('/admin/kill-switch', { method: 'POST', headers: headers('local-admin-test'), body: '{"enabled":false}' }, bindings());
    await call('local-A-test', 'add_activity', { lead_ref: 'L1', note: 'Allowed' });
    expect(await counts()).toEqual({ activity: 1, audit: 1 });
  });
  it('rolls back activity if audit insertion fails', async () => {
    await db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    try {
      expect((await call('local-A-test', 'add_activity', { lead_ref: 'L1', note: 'Atomic' })).status).toBe(500);
      expect(await counts()).toEqual({ activity: 0, audit: 0 });
    } finally { await db.exec('DROP TRIGGER reject_test_audit;'); }
  });
  it('keeps direct health and protected activity reads independent of GoClaw', async () => {
    expect((await app.request('/health', {}, bindings())).status).toBe(200);
    expect((await app.request('/admin/activity', {}, bindings())).status).toBe(401);
    expect((await app.request('/admin/activity', { headers: headers('local-admin-test') }, bindings())).status).toBe(200);
  });
  it('implements initialization, discovery and notification acknowledgement', async () => {
    for (const method of ['initialize', 'tools/list', 'notifications/initialized']) {
      const notification = method.startsWith('notifications/');
      const response = await app.request('/mcp', { method: 'POST', headers: headers('local-A-test'),
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: 1 }), method }) }, bindings());
      expect(response.status).toBe(notification ? 202 : 200);
      if (method === 'tools/list') expect((await response.json() as any).result.tools.map((t: any) => t.name)).toEqual(['whoami', 'add_activity']);
    }
  });
});
