import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { pickRoundRobin } from '../src/worker/inbox/assignment';
import { handoff } from '../src/worker/inbox/conversation-flow';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { processWorkerCommands } from '../src/worker/inbox/worker-commands';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const APP_URL = 'https://crm.example';
const lark = { LARK_APP_ID: 'cli_fake', LARK_APP_SECRET: 'fake-secret-value-123', LARK_INBOX_CHAT_ID: 'oc_inbox' };
const testEnv = { ...env, DEMO_MODE: '1', APP_URL };

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('conv-1', 'org-abm', 'ca-1', 'direct', 'cust-1', 'Chị Hoa', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO app_user (id, organization_id, display_name, email, role, created_at, updated_at)
      VALUES ('u-teacher', 'org-abm', 'Giáo viên A', 'teacher@demo.abm.example', 'teacher', ?, ?)`).bind(STAMP, STAMP),
  ]);
});
afterEach(() => vi.restoreAllMocks());

const onDuty = (...userIds: string[]) => db.batch(userIds.map((id) => db.prepare('INSERT INTO inbox_roster (user_id, on_duty) VALUES (?, 1)').bind(id)));
const setMode = (mode: 'manual' | 'round_robin') => db.prepare('UPDATE inbox_setting SET assign_mode = ? WHERE id = 1').bind(mode).run();
const conversation = () => db.prepare("SELECT * FROM conversation WHERE id = 'conv-1'").first<any>();
const larkCommands = () => db.prepare("SELECT * FROM channel_command WHERE kind = 'send_lark' ORDER BY created_at, rowid").all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })));
const at = (minute: number) => new Date(Date.parse(STAMP) + minute * 60_000);

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Fakes Lark: the token call succeeds and every message is recorded. */
function fakeLark() {
  const sent: { url: string; receiveId: string; text: string }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v3/tenant_access_token/internal')) return json({ code: 0, tenant_access_token: 't-fake', expire: 7200 });
    if (url.includes('/im/v1/messages')) {
      const body = JSON.parse(String(init!.body)) as { receive_id: string; content: string };
      sent.push({ url, receiveId: body.receive_id, text: JSON.parse(body.content).text });
      return json({ code: 0, data: {} });
    }
    return json({ code: 404 }, 404);
  });
  return { spy, sent };
}

test('round-robin takes turns among the people on duty', async () => {
  await onDuty('u-lan', 'u-long', 'u-hung');
  const picks = [];
  for (let i = 0; i < 4; i += 1) picks.push((await pickRoundRobin(db, 'org-abm', at(i)))?.id);
  // Never-assigned people come first (by id), then the one assigned longest ago.
  expect(picks).toEqual(['u-hung', 'u-lan', 'u-long', 'u-hung']);
  expect(await db.prepare("SELECT last_assigned_at FROM inbox_roster WHERE user_id = 'u-hung'").first()).toEqual({ last_assigned_at: at(3).toISOString() });
});

test('round-robin skips people off duty, disabled accounts and roles outside sales', async () => {
  await onDuty('u-mai', 'u-head', 'u-admin');
  await db.prepare("INSERT INTO inbox_roster (user_id, on_duty) VALUES ('u-lan', 0)").run();
  await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-mai'").run();
  expect(await pickRoundRobin(db, 'org-abm')).toBeNull();

  await db.prepare("UPDATE inbox_roster SET on_duty = 1 WHERE user_id = 'u-lan'").run();
  expect((await pickRoundRobin(db, 'org-abm'))?.id).toBe('u-lan');
  expect((await pickRoundRobin(db, 'org-abm'))?.id).toBe('u-lan');
});

test('a handoff in manual mode leaves the conversation unassigned', async () => {
  await onDuty('u-lan');
  await handoff(db, { APP_URL }, 'conv-1', 'khách hỏi học phí');
  expect(await conversation()).toMatchObject({ mode: 'human', assignee_user_id: null });
  const notices = await larkCommands();
  expect(notices.map((n) => n.payload.text)).toEqual([`Handoff: Chị Hoa (Số tư vấn 1) – khách hỏi học phí – ${APP_URL}/inbox/conv-1`]);
});

test('a handoff in round-robin mode assigns the next person on duty and tells Lark who has it', async () => {
  await setMode('round_robin');
  await onDuty('u-lan');
  await db.prepare("UPDATE app_user SET lark_open_id = 'ou_lan' WHERE id = 'u-lan'").run();
  await handoff(db, { APP_URL }, 'conv-1', 'khách hỏi học phí');

  const conv = await conversation();
  expect(conv).toMatchObject({ mode: 'human', assignee_user_id: 'u-lan' });
  expect(conv.assigned_at).toBeTruthy();
  const notices = await larkCommands();
  const assignText = `Giao Chị Hoa cho Đỗ Ngọc Lan – ${APP_URL}/inbox/conv-1`;
  expect(notices.map((n) => n.payload)).toEqual([
    { text: assignText },
    { text: assignText, openId: 'ou_lan' },
    { text: `Handoff: Chị Hoa (Số tư vấn 1) – khách hỏi học phí – ${APP_URL}/inbox/conv-1` },
  ]);
  expect(await db.prepare("SELECT actor_kind, actor_user_id, after_json FROM audit_log WHERE command = 'inbox.assign'").first<any>())
    .toEqual({ actor_kind: 'system', actor_user_id: null, after_json: JSON.stringify({ assigneeUserId: 'u-lan', via: 'round_robin' }) });

  const { sent } = fakeLark();
  await processWorkerCommands({ ...env, ...lark });
  expect(sent).toHaveLength(3);
  expect(sent).toEqual(expect.arrayContaining([
    { url: expect.stringContaining('receive_id_type=chat_id'), receiveId: 'oc_inbox', text: assignText },
    { url: expect.stringContaining('receive_id_type=open_id'), receiveId: 'ou_lan', text: assignText },
    { url: expect.stringContaining('receive_id_type=chat_id'), receiveId: 'oc_inbox', text: expect.stringContaining('Handoff:') },
  ]));
});

test('a handoff keeps an existing assignee and notes when nobody is on duty', async () => {
  await setMode('round_robin');
  await db.prepare("UPDATE conversation SET assignee_user_id = 'u-long' WHERE id = 'conv-1'").run();
  await onDuty('u-lan');
  await handoff(db, { APP_URL }, 'conv-1', 'lý do');
  expect((await conversation()).assignee_user_id).toBe('u-long');
  expect(await larkCommands()).toHaveLength(1);

  await db.prepare("UPDATE conversation SET assignee_user_id = NULL WHERE id = 'conv-1'").run();
  await db.prepare('DELETE FROM channel_command').run();
  await db.prepare('UPDATE inbox_roster SET on_duty = 0').run();
  await handoff(db, { APP_URL }, 'conv-1', 'lý do');
  expect((await conversation()).assignee_user_id).toBeNull();
  const [notice] = await larkCommands();
  expect(notice.payload.text).toBe(`Handoff: Chị Hoa (Số tư vấn 1) – lý do – chưa có người trực – ${APP_URL}/inbox/conv-1`);
});

test('a sale may only claim an unassigned conversation for themselves', async () => {
  const other = await web('u-lan', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-long' });
  expect(other.status).toBe(403);
  expect(other.json.error.code).toBe('FORBIDDEN');

  const claim = await web('u-lan', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-lan' });
  expect(claim).toEqual({ status: 200, json: { ok: true, data: { assigneeUserId: 'u-lan', assigneeName: 'Đỗ Ngọc Lan' } } });
  expect((await conversation()).assignee_user_id).toBe('u-lan');
  expect((await larkCommands()).map((n) => n.payload)).toEqual([{ text: `Giao Chị Hoa cho Đỗ Ngọc Lan – ${APP_URL}/inbox/conv-1` }]);
  expect(await db.prepare("SELECT actor_user_id, after_json FROM audit_log WHERE command = 'inbox.assign'").first())
    .toEqual({ actor_user_id: 'u-lan', after_json: JSON.stringify({ assigneeUserId: 'u-lan', via: 'manual' }) });

  const late = await web('u-long', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-long' });
  expect(late.status).toBe(409);
  expect((await conversation()).assignee_user_id).toBe('u-lan');
});

test('managers assign to any active inbox staff member; invalid targets are refused', async () => {
  const res = await web('u-hung', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-long' });
  expect(res.json.data).toEqual({ assigneeUserId: 'u-long', assigneeName: 'Vũ Đức Long' });
  expect((await web('u-bgd', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-lan' })).status).toBe(200);
  expect((await conversation()).assignee_user_id).toBe('u-lan');

  // Assigning the current assignee again changes nothing and sends no notice.
  const before = (await larkCommands()).length;
  expect((await web('u-hung', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-lan' })).status).toBe(200);
  expect(await larkCommands()).toHaveLength(before);

  expect((await web('u-hung', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-teacher' })).status).toBe(422);
  await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-huy'").run();
  expect((await web('u-hung', 'POST', '/inbox/conversations/conv-1/assign', { userId: 'u-huy' })).status).toBe(422);
  expect((await web('u-hung', 'POST', '/inbox/conversations/conv-1/assign', {})).status).toBe(422);
  expect((await web('u-hung', 'POST', '/inbox/conversations/missing/assign', { userId: 'u-lan' })).status).toBe(404);
});

test('leaders and admins manage the assignment settings and the duty roster', async () => {
  expect((await web('u-lan', 'GET', '/inbox/settings')).json.data).toMatchObject({ assignMode: 'manual', slaMinutes: 15 });
  expect((await web('u-lan', 'PUT', '/inbox/settings', { assignMode: 'round_robin' })).status).toBe(403);
  expect((await web('u-lan', 'PUT', '/inbox/roster', { userId: 'u-lan', onDuty: true })).status).toBe(403);

  const updated = await web('u-hung', 'PUT', '/inbox/settings', { assignMode: 'round_robin', slaMinutes: 30 });
  expect(updated.json.data).toMatchObject({ assignMode: 'round_robin', slaMinutes: 30, updatedByUserId: 'u-hung' });
  expect((await web('u-admin', 'PUT', '/inbox/settings', { slaMinutes: 0 })).status).toBe(422);
  expect((await web('u-admin', 'PUT', '/inbox/settings', { slaMinutes: 1441 })).status).toBe(422);
  expect((await web('u-admin', 'PUT', '/inbox/settings', { assignMode: 'random' })).status).toBe(422);
  expect((await web('u-admin', 'PUT', '/inbox/settings', {})).status).toBe(422);

  expect((await web('u-admin', 'PUT', '/inbox/roster', { userId: 'u-lan', onDuty: true })).json.data).toEqual({ userId: 'u-lan', onDuty: true });
  expect((await web('u-admin', 'PUT', '/inbox/roster', { userId: 'u-head', onDuty: true })).status).toBe(422);
  expect((await web('u-admin', 'PUT', '/inbox/roster', { userId: 'u-teacher', onDuty: true })).status).toBe(422);
  const roster = (await web('u-lan', 'GET', '/inbox/roster')).json.data as any[];
  expect(roster.find((r) => r.userId === 'u-lan')).toMatchObject({ onDuty: true, roundRobin: true, role: 'sale' });
  expect(roster.find((r) => r.userId === 'u-head')).toMatchObject({ onDuty: false, roundRobin: false });
  expect(roster.some((r) => r.userId === 'u-teacher')).toBe(false);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command IN ('inbox.updateSettings', 'inbox.setDuty')").first()).toEqual({ n: 2 });

  // The new mode applies to the next handoff.
  await handoff(db, { APP_URL }, 'conv-1', 'lý do');
  expect((await conversation()).assignee_user_id).toBe('u-lan');
});

test('the reply deadline starts when people take over and clears when staff answer', async () => {
  await db.prepare("UPDATE inbox_setting SET sla_minutes = 20 WHERE id = 1").run();
  const before = Date.now();
  await handoff(db, { APP_URL }, 'conv-1', 'lý do');
  const due = Date.parse((await conversation()).sla_due_at);
  expect(due).toBeGreaterThanOrEqual(before + 20 * 60_000);
  expect(due).toBeLessThanOrEqual(Date.now() + 20 * 60_000);

  expect((await web('u-lan', 'POST', '/inbox/conversations/conv-1/messages', { text: 'Em chào chị' })).status).toBe(200);
  expect((await conversation()).sla_due_at).toBeNull();

  // A new customer message in human mode starts the deadline again; a later one keeps the earliest deadline.
  const customer = (msgId: string) => ({
    type: 'message' as const, accountExternalId: 'zalo-acc-1', threadId: 'cust-1', threadKind: 'direct' as const, msgId,
    fromSelf: false, senderExternalId: 'cust-1', senderName: 'Chị Hoa', text: 'Dạ', sentAt: new Date().toISOString(),
  });
  await ingestEvents(db, [customer('zm-1')]);
  const first = (await conversation()).sla_due_at;
  expect(first).toBeTruthy();
  await ingestEvents(db, [customer('zm-2')]);
  expect((await conversation()).sla_due_at).toBe(first);

  // Staff answering from the shared phone also clears it.
  await ingestEvents(db, [{ ...customer('zm-3'), fromSelf: true, senderExternalId: 'zalo-acc-1', text: 'Em gọi chị nhé' }]);
  expect((await conversation()).sla_due_at).toBeNull();

  // Switching back to ai drops the deadline; taking over again starts it.
  await ingestEvents(db, [customer('zm-4')]);
  expect((await web('u-lan', 'POST', '/inbox/conversations/conv-1/mode', { mode: 'ai' })).status).toBe(200);
  expect((await conversation()).sla_due_at).toBeNull();
  await web('u-lan', 'POST', '/inbox/conversations/conv-1/mode', { mode: 'human' });
  expect((await conversation()).sla_due_at).toBeTruthy();
});
