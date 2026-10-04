import { env, applyD1Migrations } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { deliverApprovalDm } from '../src/worker/approval-notify';
import { sha256 } from '../src/worker/commands';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const tables = ['agent_token', 'user_session', '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead',
  'lead_counter', 'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];
const lark = { LARK_APP_ID: 'cli_fake', LARK_APP_SECRET: 'fake-secret-value-123' };
const testEnv = { ...env, DEMO_MODE: '1', ...lark };
const tokens: Record<string, string> = {};

beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(tables.map(t => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter(l => l.startsWith('INSERT')).map(l => db.prepare(l)));
  await db.prepare('INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET enabled = 0').run();
  await db.prepare("UPDATE app_user SET lark_link_status = 'linked', lark_open_id = 'ou_hung' WHERE id = 'u-hung'").run();
  for (const user of ['u-lan', 'u-hung']) {
    tokens[user] = crypto.randomUUID();
    await db.prepare("INSERT INTO agent_token (id, user_id, token_hash, created_at) VALUES (?, ?, ?, '2026-10-04T00:00:00Z')")
      .bind(`tok-${user}`, user, await sha256(tokens[user]!)).run();
  }
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Fakes Lark: the token call succeeds; messages answer with `messageStatus`. Records every message sent. */
function fakeLark(messageStatus = 200) {
  const sent: { receiveId: string; text: string; auth: string | null }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v3/tenant_access_token/internal')) return json({ code: 0, tenant_access_token: 't-fake', expire: 7200 });
    if (url.includes('/im/v1/messages')) {
      const body = JSON.parse(String(init!.body)) as { receive_id: string; content: string };
      sent.push({ receiveId: body.receive_id, text: JSON.parse(body.content).text, auth: new Headers(init!.headers).get('Authorization') });
      return messageStatus === 200 ? json({ code: 0, data: {} }) : json({ code: 99991, msg: 'server error' }, messageStatus);
    }
    return json({ code: 404 }, 404);
  });
  return { spy, sent };
}

async function tool(user: string, name: string, args: Record<string, unknown>) {
  const res = await app.fetch(new Request(`${ORIGIN}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[user]}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), testEnv);
  return JSON.parse(((await res.json()) as any).result.content[0].text);
}
async function web(user: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-User': user, ...headers }, body: JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}
const requestOutbox = (approvalId: string) =>
  db.prepare("SELECT * FROM outbox WHERE event_type = 'approval.requested' AND json_extract(payload_json, '$.approvalId') = ?").bind(approvalId).first<any>();
const wonArgs = { lead_code: 'L-0014', to_stage: 'won', won_value: 320000000, won_note: 'Hợp đồng đã ký' };

test('a won proposal through the bot sends the team leader a Lark DM', async () => {
  const { sent } = fakeLark();
  const res = await tool('u-lan', 'change_stage', wonArgs);
  expect(res.status).toBe('pending_approval');
  const row = await requestOutbox(res.approvalId);
  expect(row).toMatchObject({ status: 'sent', attempts: 1 });
  expect(row.sent_at).toBeTruthy();
  expect(sent.map((m) => m.receiveId)).toEqual(['ou_hung']);
  expect(sent[0]!.text).toContain('Đỗ Ngọc Lan (qua bot) đề nghị chốt Won cho lead L-0014');
  expect(sent[0]!.text).toContain(`${ORIGIN}/approvals`);
});

test('the message never carries the customer phone or email', async () => {
  const { sent } = fakeLark();
  await tool('u-lan', 'change_stage', wonArgs);
  const points = (await db.prepare(`SELECT cp.value, cp.normalized_value FROM contact_point cp JOIN lead l ON l.contact_id = cp.contact_id WHERE l.id = 'lead-14'`)
    .all<{ value: string; normalized_value: string }>()).results;
  expect(points.length).toBeGreaterThan(0);
  for (const p of points) {
    expect(sent[0]!.text).not.toContain(p.value);
    expect(sent[0]!.text).not.toContain(p.normalized_value);
  }
});

test('an ordinary stage proposal records the request but messages nobody', async () => {
  const { sent } = fakeLark();
  const res = await tool('u-lan', 'change_stage', { lead_code: 'L-0004', to_stage: 'qualified' });
  const row = await requestOutbox(res.approvalId);
  expect(row.status).toBe('pending');
  expect(sent).toHaveLength(0);
  expect(await deliverApprovalDm(testEnv, row.id, ORIGIN)).toBe('skipped');
  expect(sent).toHaveLength(0);
});

test('a leader never messages themself about their own request', async () => {
  const { sent } = fakeLark();
  const res = await tool('u-hung', 'assign_lead', { lead_code: 'L-0020', owner_email: 'long@demo.abm.example' });
  expect((await requestOutbox(res.approvalId)).status).toBe('no_recipient');
  expect(sent).toHaveLength(0);
});

test('an owner change asked on the web also reaches the leader', async () => {
  const { sent } = fakeLark();
  const res = await web('u-lan', '/commands/requestOwnerChange', { leadId: 'lead-04', expectedVersion: 1, toUserId: 'u-long', reason: 'Khách ở khu vực anh Long' },
    { 'Idempotency-Key': crypto.randomUUID() });
  expect(res.status).toBe(200);
  expect((await requestOutbox(res.json.data.approvalId)).status).toBe('sent');
  expect(sent[0]!.text).toContain('Đỗ Ngọc Lan đề nghị chuyển người phụ trách sang Vũ Đức Long');
});

test('a Lark failure leaves the approval pending and admin can resend it', async () => {
  fakeLark(500);
  const res = await tool('u-lan', 'change_stage', wonArgs);
  const approval = await db.prepare('SELECT status FROM approval WHERE id = ?').bind(res.approvalId).first<{ status: string }>();
  expect(approval!.status).toBe('pending');
  const failed = await requestOutbox(res.approvalId);
  expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
  expect(failed.last_error).toContain('HTTP 500');
  expect(failed.last_error).not.toContain('Bearer');
  expect(failed.last_error).not.toContain('t-fake');

  vi.restoreAllMocks();
  const { sent } = fakeLark();
  expect((await web('u-lan', `/admin/outbox/${failed.id}/resend`, {})).status).toBe(403);
  const resent = await web('u-admin', `/admin/outbox/${failed.id}/resend`, {});
  expect(resent.json.data.status).toBe('sent');
  expect(await requestOutbox(res.approvalId)).toMatchObject({ status: 'sent', attempts: 2 });
  expect(sent).toHaveLength(1);
  const audit = await db.prepare("SELECT actor_user_id FROM audit_log WHERE command = 'resendApprovalDm'").first<{ actor_user_id: string }>();
  expect(audit!.actor_user_id).toBe('u-admin');
});
