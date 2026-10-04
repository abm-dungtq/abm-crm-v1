import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { sha256 } from '../src/worker/commands';
import { hashPassword } from '../src/worker/password';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const tables = ['agent_token', 'user_session', '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead',
  'lead_counter', 'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];
const tokens: Record<string, string> = {};
beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(tables.map(t => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter(l => l.startsWith('INSERT')).map(l => db.prepare(l)));
  await db.prepare('INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET enabled = 0').run();
  for (const user of ['u-lan', 'u-hung', 'u-admin']) {
    tokens[user] = crypto.randomUUID();
    await db.prepare("INSERT INTO agent_token (id, user_id, token_hash, created_at) VALUES (?, ?, ?, '2026-10-04T00:00:00Z')")
      .bind(`tok-${user}`, user, await sha256(tokens[user]!)).run();
  }
});

async function mcp(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const res = await app.fetch(new Request(`${ORIGIN}/api/mcp`, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: res.status === 200 ? await res.json() as any : null };
}
const bearer = (user: string) => ({ Authorization: `Bearer ${tokens[user]}` });
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params });
async function tool(user: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(rpc('tools/call', { name, arguments: args }), bearer(user));
  const result = res.json.result;
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text) };
}
async function web(user: string, name: string, body: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api/commands/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-User': user, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: await res.json() as any };
}
const lead = (id: string) => db.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first<any>();
const approvalFor = (leadId: string, kind: string) =>
  db.prepare("SELECT * FROM approval WHERE lead_id = ? AND kind = ? AND status = 'pending'").bind(leadId, kind).first<any>();
const decide = (user: string, approval: { id: string; version: number }) =>
  web(user, 'decideApproval', { approvalId: approval.id, expectedVersion: approval.version, decision: 'approve' });

describe('auth', () => {
  test('rejects calls without a valid bearer token', async () => {
    expect((await mcp(rpc('tools/list'))).status).toBe(401);
    expect((await mcp(rpc('tools/list'), { Authorization: 'Bearer not-a-token' })).status).toBe(401);
    expect((await mcp(rpc('tools/list'), { 'X-Demo-User': 'u-admin' })).status).toBe(401);
  });

  test('a valid admin web session never stands in for the bearer token', async () => {
    const p = await hashPassword('Admin-mat-khau-2026');
    await db.prepare('UPDATE app_user SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?').bind(p.hash, p.salt, p.iterations, 'u-admin').run();
    const login = await app.fetch(new Request(`${ORIGIN}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: 'admin@demo.abm.example', password: 'Admin-mat-khau-2026' }),
    }), { ...env, AUTH_MODE: 'password' });
    const cookie = /abm_session=([^;]*)/.exec(login.headers.get('Set-Cookie') ?? '')?.[0];
    expect(cookie).toBeTruthy();
    const res = await app.fetch(new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie! }, body: JSON.stringify(rpc('tools/list')),
    }), { ...env, AUTH_MODE: 'password' });
    expect(res.status).toBe(401);
  });

  test('refuses browser origins, revoked tokens, disabled users and GET', async () => {
    expect((await mcp(rpc('tools/list'), { ...bearer('u-lan'), Origin: ORIGIN })).status).toBe(403);
    await db.prepare("UPDATE agent_token SET revoked_at = '2026-10-04T01:00:00Z' WHERE user_id = 'u-lan'").run();
    expect((await mcp(rpc('tools/list'), bearer('u-lan'))).status).toBe(401);
    await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-hung'").run();
    expect((await mcp(rpc('tools/list'), bearer('u-hung'))).status).toBe(401);
    expect((await mcp(null, bearer('u-admin'), 'GET')).status).toBe(405);
  });

  test('records when a token was last used', async () => {
    await mcp(rpc('ping'), bearer('u-lan'));
    const row = await db.prepare("SELECT last_used_at FROM agent_token WHERE user_id = 'u-lan'").first<{ last_used_at: string | null }>();
    expect(row?.last_used_at).toBeTruthy();
  });
});

describe('protocol', () => {
  test('initialize and tools/list expose exactly the eleven tools', async () => {
    expect((await mcp(rpc('initialize', {}), bearer('u-lan'))).json.result.serverInfo.name).toBe('abm-crm');
    const names = (await mcp(rpc('tools/list'), bearer('u-lan'))).json.result.tools.map((t: any) => t.name);
    expect(names).toHaveLength(11);
    expect(names.some((n: string) => /decide|release/.test(n))).toBe(false);
  });
});

describe('read', () => {
  test('tools read with the token owner scope', async () => {
    expect((await tool('u-lan', 'whoami')).data).toMatchObject({ id: 'u-lan', displayName: 'Đỗ Ngọc Lan', role: 'sale', team: 'Kinh doanh 1' });
    const other = await tool('u-lan', 'get_lead', { lead_code: 'L-0003' });
    expect(other.isError).toBe(true);
    expect(other.data.code).toBe('NOT_FOUND');
    expect((await tool('u-lan', 'get_lead', { lead_code: 'L-0004' })).data.lead.code).toBe('L-0004');
    const found = (await tool('u-admin', 'search_leads', { status: 'active' })).data;
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(20);
    expect(new Set(found.map((l: any) => l.owner)).size).toBeGreaterThan(1);
    expect(found.some((l: any) => l.phones.length > 0)).toBe(true);
  });
});

describe('write', () => {
  const activities = async (leadId: string) =>
    (await db.prepare("SELECT COUNT(*) AS n FROM activity WHERE lead_id = ? AND summary = 'Gọi xác nhận lịch'").bind(leadId).first<{ n: number }>())!.n;
  const call = { lead_code: 'L-0004', type: 'call', summary: 'Gọi xác nhận lịch' };

  test('a sale logs activity as themself through the bot, and a quick retry does not duplicate it', async () => {
    const first = await tool('u-lan', 'log_activity', call);
    expect(first.isError).toBe(false);
    const row = await db.prepare("SELECT actor_kind, actor_user_id FROM activity WHERE lead_id = 'lead-04' AND summary = 'Gọi xác nhận lịch'").first<any>();
    expect(row).toEqual({ actor_kind: 'agent', actor_user_id: 'u-lan' });
    expect((await tool('u-lan', 'log_activity', call)).data).toEqual(first.data);
    expect(await activities('lead-04')).toBe(1);
  });

  test('the same words much later are a new activity', async () => {
    await tool('u-lan', 'log_activity', call);
    await db.prepare("UPDATE idempotency_key SET created_at = ? WHERE actor_user_id = 'u-lan'").bind(new Date(Date.now() - 10 * 60_000).toISOString()).run();
    expect((await tool('u-lan', 'log_activity', call)).isError).toBe(false);
    expect(await activities('lead-04')).toBe(2);
  });

  test('a sale stage change becomes a proposal the owner confirms on the web', async () => {
    const res = await tool('u-lan', 'change_stage', { lead_code: 'L-0004', to_stage: 'qualified' });
    expect(res.data).toMatchObject({ status: 'pending_approval', kind: 'agent_stage_change' });
    expect(res.data.message).toContain(`${ORIGIN}/approvals`);
    expect((await lead('lead-04')).stage).toBe('contacted');
    const approval = await approvalFor('lead-04', 'agent_stage_change');
    expect(approval.requested_by_kind).toBe('agent');
    expect((await decide('u-lan', approval)).status).toBe(200);
    expect((await lead('lead-04')).stage).toBe('qualified');
  });

  test('an impossible stage proposal is refused instead of queued', async () => {
    const res = await tool('u-lan', 'change_stage', { lead_code: 'L-0004', to_stage: 'won', won_value: 1, won_note: 'x' });
    expect(res.data.code).toBe('VALIDATION_FAILED');
    expect(await approvalFor('lead-04', 'agent_stage_change')).toBeNull();
  });

  test('a won proposal from a sale needs the team leader', async () => {
    const res = await tool('u-lan', 'change_stage', { lead_code: 'L-0014', to_stage: 'won', won_value: 320000000, won_note: 'Hợp đồng đã ký' });
    expect(res.data.message).toBe('Đã tạo yêu cầu, Leader sẽ được báo qua Lark');
    const approval = await approvalFor('lead-14', 'agent_stage_change');
    expect((await decide('u-lan', approval)).status).toBe(403);
    expect((await decide('u-hung', approval)).status).toBe(200);
    expect((await lead('lead-14')).status).toBe('won');
  });

  test('a leader assignment through the bot becomes an agent_assign the leader confirms', async () => {
    const res = await tool('u-hung', 'assign_lead', { lead_code: 'L-0020', owner_email: 'long@demo.abm.example' });
    expect(res.data).toMatchObject({ status: 'pending_approval', kind: 'agent_assign' });
    expect((await lead('lead-20')).owner_user_id).toBeNull();
    const approval = await approvalFor('lead-20', 'agent_assign');
    expect((await decide('u-hung', approval)).status).toBe(200);
    expect(await lead('lead-20')).toMatchObject({ owner_user_id: 'u-long', status: 'active', team_id: 'team-kd1' });
  });

  test('admin writes straight through the bot and the audit says so', async () => {
    const won = await tool('u-admin', 'change_stage', { lead_code: 'L-0015', to_stage: 'won', won_value: 520000000, won_note: 'PO số 15' });
    expect(won.data).toMatchObject({ stage: 'won' });
    expect((await lead('lead-15')).status).toBe('won');
    const audit = await db.prepare("SELECT actor_kind, actor_user_id FROM audit_log WHERE entity_id = 'lead-15' AND command = 'changeStage'").first<any>();
    expect(audit).toEqual({ actor_kind: 'agent', actor_user_id: 'u-admin' });
    expect((await tool('u-admin', 'assign_lead', { lead_code: 'L-0021', owner_email: 'huy@demo.abm.example' })).isError).toBe(false);
    expect((await lead('lead-21')).owner_user_id).toBe('u-huy');
  });

  test('admin must name a department to create a lead, and it lands there', async () => {
    const args = { contact_name: 'Khách bot', phone: '0912 000 111', source: 'zalo', need_summary: 'Hỏi giá' };
    expect((await tool('u-admin', 'create_lead', args)).data.code).toBe('VALIDATION_FAILED');
    const created = await tool('u-admin', 'create_lead', { ...args, department: 'phong kinh doanh' });
    expect(created.isError).toBe(false);
    expect((await lead(created.data.leadId)).department_id).toBe('dep-kd');
  });

  test('on the web a chosen department is checked against the organization', async () => {
    const body = { contactName: 'Khách web', phone: '0912 000 222', source: 'website', needSummary: 'Hỏi giá' };
    expect((await web('u-admin', 'createLead', { ...body, departmentId: 'dep-unknown' })).status).toBe(422);
    const created = await web('u-admin', 'createLead', { ...body, departmentId: 'dep-kd' });
    expect((await lead(created.json.data.leadId)).department_id).toBe('dep-kd');
  });

  test('kill switch stops admin writes through the bot', async () => {
    await db.prepare('UPDATE agent_kill_switch SET enabled = 1 WHERE id = 1').run();
    expect((await tool('u-admin', 'log_activity', { lead_code: 'L-0010', type: 'note', summary: 'x' })).data.code).toBe('KILL_SWITCH_ON');
  });

  test('identity hints in args are ignored', async () => {
    await tool('u-lan', 'log_activity', { ...call, acting_user: 'u-admin', user_id: 'u-hung' });
    const row = await db.prepare("SELECT actor_user_id FROM activity WHERE lead_id = 'lead-04' AND summary = 'Gọi xác nhận lịch'").first<any>();
    expect(row.actor_user_id).toBe('u-lan');
  });
});
