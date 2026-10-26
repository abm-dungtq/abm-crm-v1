import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { sha256 } from '../src/worker/commands';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const testEnv = { ...env, DEMO_MODE: '1' };
const tokens: Record<string, string> = {};

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.prepare('INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET enabled = 0').run();
  for (const user of ['u-lan', 'u-hung']) {
    tokens[user] = crypto.randomUUID();
    await db.prepare("INSERT INTO agent_token (id, user_id, token_hash, created_at) VALUES (?, ?, ?, '2026-10-04T00:00:00Z')")
      .bind(`tok-${user}`, user, await sha256(tokens[user]!)).run();
  }
});
afterEach(() => vi.restoreAllMocks());

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
const approvalNotices = () => db.prepare("SELECT user_id, title, body, link, dedupe_key FROM notification WHERE kind = 'approval' ORDER BY user_id")
  .all<{ user_id: string; title: string; body: string | null; link: string | null; dedupe_key: string | null }>().then((r) => r.results);
const commandCount = () => db.prepare('SELECT COUNT(*) AS n FROM channel_command').first<{ n: number }>().then((r) => r!.n);
const wonArgs = { lead_code: 'L-0014', to_stage: 'won', won_value: 320000000, won_note: 'Hợp đồng đã ký' };

test('a won proposal through the bot notifies the team Leader in the CRM, not the requester, with no Lark message', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const commandsBefore = await commandCount();
  const res = await tool('u-lan', 'change_stage', wonArgs);
  expect(res.status).toBe('pending_approval');
  expect(res.message).toBe('Đã tạo yêu cầu, Leader sẽ nhận thông báo trên CRM');

  expect(await approvalNotices()).toEqual([{
    user_id: 'u-hung',
    title: 'Yêu cầu duyệt',
    body: 'Lead L-0014 có yêu cầu chờ duyệt',
    link: '/approvals',
    dedupe_key: `approval:${res.approvalId}:u-hung`,
  }]);
  // No channel command (the old `send_lark` route) and no outside request.
  expect(await commandCount()).toBe(commandsBefore);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('the notice never carries the customer phone or email', async () => {
  await tool('u-lan', 'change_stage', wonArgs);
  const points = (await db.prepare(`SELECT cp.value, cp.normalized_value FROM contact_point cp JOIN lead l ON l.contact_id = cp.contact_id WHERE l.id = 'lead-14'`)
    .all<{ value: string; normalized_value: string }>()).results;
  expect(points.length).toBeGreaterThan(0);
  const [notice] = await approvalNotices();
  for (const p of points) {
    expect(`${notice!.title} ${notice!.body}`).not.toContain(p.value);
    expect(`${notice!.title} ${notice!.body}`).not.toContain(p.normalized_value);
  }
});

test('an ordinary stage proposal records the request but notifies nobody', async () => {
  const res = await tool('u-lan', 'change_stage', { lead_code: 'L-0004', to_stage: 'qualified' });
  expect(res.status).toBe('pending_approval');
  expect(await approvalNotices()).toEqual([]);
});

test('a leader is never notified about their own request', async () => {
  const res = await tool('u-hung', 'assign_lead', { lead_code: 'L-0020', owner_email: 'long@demo.abm.example' });
  expect(res.status).toBe('pending_approval');
  expect((await approvalNotices()).map((n) => n.user_id)).not.toContain('u-hung');
});

test('an owner change asked on the web also reaches the leader', async () => {
  const res = await web('u-lan', '/commands/requestOwnerChange', { leadId: 'lead-04', expectedVersion: 1, toUserId: 'u-long', reason: 'Khách ở khu vực anh Long' },
    { 'Idempotency-Key': crypto.randomUUID() });
  expect(res.status).toBe(200);
  expect((await approvalNotices()).map((n) => n.user_id)).toEqual(['u-hung']);
});

test('no Worker or web source reads a LARK_ setting', () => {
  const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
  expect(Object.keys(sources).length).toBeGreaterThan(20);
  const readers = Object.entries(sources).filter(([, text]) => /\bLARK_[A-Z_]+/.test(text)).map(([path]) => path);
  expect(readers).toEqual([]);
});
