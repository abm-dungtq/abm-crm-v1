import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { loadActor, loadAgentActor } from '../src/worker/actor';
import { runCommand } from '../src/worker/commands';

const db = env.DB;
const tables = ['agent_token', 'user_session', '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead',
  'lead_counter', 'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];
beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(tables.map(t => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter(l => l.startsWith('INSERT')).map(l => db.prepare(l)));
  await db.prepare('INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET enabled = 0').run();
});

async function call(user: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const res = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: await res.json() as any };
}
const note = (leadId: string) => ({ leadId, expectedVersion: 1, type: 'note', summary: 'ghi chú' });
const actor = async (id: string, kind: 'human' | 'agent') => (await (kind === 'agent' ? loadAgentActor(db, id) : loadActor(db, id)))!;
const setSwitch = (enabled: boolean) => db.prepare('UPDATE agent_kill_switch SET enabled = ? WHERE id = 1').bind(enabled ? 1 : 0).run();
const addToken = (id: string, userId: string) =>
  db.prepare("INSERT INTO agent_token (id, user_id, token_hash, created_at) VALUES (?, ?, ?, '2026-10-04T00:00:00Z')").bind(id, userId, `hash-${id}`).run();

test('activity and audit record whether a person or the bot wrote', async () => {
  expect((await runCommand(db, await actor('u-lan', 'human'), 'logActivity', note('lead-04'), 'k-human')).ok).toBe(true);
  expect((await runCommand(db, await actor('u-admin', 'agent'), 'logActivity', note('lead-10'), 'k-agent')).ok).toBe(true);
  const kinds = async (table: string, leadId: string) =>
    (await db.prepare(`SELECT DISTINCT actor_kind AS k FROM ${table} WHERE ${table === 'activity' ? "lead_id = ? AND summary = 'ghi chú'" : "entity_id = ? AND command = 'logActivity'"}`).bind(leadId).all<{ k: string }>()).results.map(r => r.k);
  expect(await kinds('activity', 'lead-04')).toEqual(['human']);
  expect(await kinds('activity', 'lead-10')).toEqual(['agent']);
  expect(await kinds('audit_log', 'lead-04')).toEqual(['human']);
  expect(await kinds('audit_log', 'lead-10')).toEqual(['agent']);
});

test('kill switch blocks every bot write, including Admin, but never the web', async () => {
  await setSwitch(true);
  for (const [id, lead] of [['u-lan', 'lead-04'], ['u-admin', 'lead-10']] as const) {
    const result = await runCommand(db, await actor(id, 'agent'), 'logActivity', note(lead), `k-${id}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('KILL_SWITCH_ON');
  }
  expect((await db.prepare('SELECT COUNT(*) AS n FROM activity WHERE actor_kind = ?').bind('agent').first<{ n: number }>())!.n).toBe(0);
  expect((await runCommand(db, await actor('u-lan', 'human'), 'logActivity', note('lead-04'), 'k-web')).ok).toBe(true);
  await setSwitch(false);
  expect((await runCommand(db, await actor('u-lan', 'agent'), 'logActivity', { ...note('lead-04'), expectedVersion: 2 }, 'k-reopen-2')).ok).toBe(true);
});

test('a missing kill switch row counts as off', async () => {
  await db.prepare('DELETE FROM agent_kill_switch').run();
  expect((await runCommand(db, await actor('u-lan', 'agent'), 'logActivity', note('lead-04'), 'k-missing')).ok).toBe(true);
});

test('only admin reads or toggles the kill switch, and toggling is audited', async () => {
  for (const user of ['u-lan', 'u-hung', 'u-head', 'u-bgd']) {
    expect((await call(user, '/admin/agent-kill-switch')).status).toBe(403);
    expect((await call(user, '/admin/agent-kill-switch', { enabled: true }, 'PUT')).status).toBe(403);
  }
  expect((await call('u-admin', '/admin/agent-kill-switch', { enabled: 'yes' }, 'PUT')).status).toBe(422);
  expect((await call('u-admin', '/admin/agent-kill-switch', { enabled: true }, 'PUT')).status).toBe(200);
  expect((await call('u-admin', '/admin/overview')).json.data.counts.agentKillSwitch).toBe(1);
  const audit = await db.prepare("SELECT actor_user_id AS who FROM audit_log WHERE command = 'setAgentKillSwitch'").all<{ who: string }>();
  expect(audit.results).toEqual([{ who: 'u-admin' }]);
});

test('admin revokes bot keys, and disabling a user revokes them too', async () => {
  await addToken('t-1', 'u-lan');
  await addToken('t-2', 'u-lan');
  await addToken('t-3', 'u-hung');
  const users = (await call('u-admin', '/admin/overview')).json.data.users;
  expect(users.find((u: any) => u.id === 'u-lan').agentTokens).toBe(2);
  expect((await call('u-lan', '/admin/users/u-lan/agent-token/revoke', {})).status).toBe(403);
  const revoked = await call('u-admin', '/admin/users/u-lan/agent-token/revoke', {});
  expect(revoked.json.data).toEqual({ revoked: 2 });
  expect(await loadAgentActor(db, 'u-hung')).not.toBeNull();
  const hung = await db.prepare("SELECT version FROM app_user WHERE id = 'u-hung'").first<{ version: number }>();
  expect((await call('u-admin', '/admin/users/u-hung/status', { version: hung!.version, status: 'disabled' })).status).toBe(200);
  const live = await db.prepare('SELECT COUNT(*) AS n FROM agent_token WHERE revoked_at IS NULL').first<{ n: number }>();
  expect(live!.n).toBe(0);
  expect(await loadAgentActor(db, 'u-hung')).toBeNull();
});

test('approval accepts the agent_assign kind', async () => {
  await db.prepare(`INSERT INTO approval (id, kind, lead_id, target_version, payload_json, status, requested_by_user_id, requested_by_kind, created_at, updated_at)
    VALUES ('ap-agent', 'agent_assign', 'lead-04', 1, '{}', 'pending', 'u-lan', 'agent', '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z')`).run();
  expect((await db.prepare("SELECT kind FROM approval WHERE id = 'ap-agent'").first<{ kind: string }>())!.kind).toBe('agent_assign');
  const indexes = (await db.prepare('PRAGMA index_list(approval)').all<{ name: string }>()).results.map(r => r.name);
  expect(indexes).toEqual(expect.arrayContaining(['approval_status', 'approval_lead_kind_status']));
});
