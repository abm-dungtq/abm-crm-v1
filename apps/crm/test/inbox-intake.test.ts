import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { applyCompletionResult } from '../src/worker/inbox/conversation-flow';
import { claimCommands } from '../src/worker/inbox/dispatcher';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { enqueueExtraction, mergeIntakeFields, parseExtraction } from '../src/worker/inbox/intake';
import { runScheduled } from '../src/worker/inbox/scheduled';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const SECRET = 'test-bridge-secret';
const STAMP = '2026-10-08T03:00:00.000Z';
const testEnv = { ...env, DEMO_MODE: '1', BRIDGE_SECRET: SECRET, APP_URL: 'https://crm.example' };

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
    VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP).run();
});
afterEach(() => vi.restoreAllMocks());

let msgSeq = 0;
const customerSays = (text: string, threadId = 'cust-1') => ingestEvents(db, [{
  type: 'message', accountExternalId: 'zalo-acc-1', threadId, threadKind: 'direct', msgId: `zm-${++msgSeq}`, fromSelf: false,
  senderExternalId: threadId, senderName: 'Chị Hoa', text, sentAt: new Date().toISOString(),
}]);
const conversation = (threadId = 'cust-1') =>
  db.prepare('SELECT * FROM conversation WHERE external_thread_id = ?').bind(threadId).first<any>();
const extractCommands = () => db.prepare(`SELECT * FROM channel_command
    WHERE kind = 'run_completion' AND json_extract(payload_json, '$.purpose') = 'extract' ORDER BY created_at, rowid`).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })));
const intakes = () => db.prepare('SELECT * FROM lead_intake ORDER BY created_at').all<any>()
  .then((r) => r.results.map((row) => ({ ...row, fields: JSON.parse(row.fields_json) })));

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Claims the command as the bridge would, then posts the extractor's answer through the signed result API. */
async function answer(commandId: string, text: string) {
  const claimed = (await claimCommands(db, 'bridge', 100)).find((c) => c.id === commandId);
  expect(claimed, 'command was claimable').toBeTruthy();
  const raw = JSON.stringify({ attempts: claimed!.attempts, ok: true, text });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)));
  const res = await app.fetch(new Request(`${ORIGIN}/api/bridge/commands/${commandId}/result`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Timestamp': timestamp, 'X-Bridge-Signature': signature }, body: raw,
  }), testEnv);
  expect(res.status).toBe(200);
}

/** A conversation with a customer message and one extraction answered with `fields`. */
async function intakeFrom(fields: Record<string, string>) {
  await customerSays('Em tên Hoa, muốn học tiếng Anh giao tiếp');
  const conv = await conversation();
  const commandId = await enqueueExtraction(db, conv.id);
  await answer(commandId!, JSON.stringify(fields));
  const [intake] = await intakes();
  return { conv, intake };
}

const nextAction = () => ({ title: 'Gọi tư vấn', dueAt: new Date(Date.now() + 86_400_000).toISOString() });

test('a handoff queues one stateless crm-extractor run over the conversation', async () => {
  await customerSays('Cho em hỏi lịch học');
  const conv = await conversation();
  await applyCompletionResult(db, testEnv, conv.id, 'Dạ em chuyển nhân viên tư vấn ạ\n[HANDOFF: khách muốn chốt]');
  const last = await db.prepare('SELECT id FROM message WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .bind(conv.id).first<{ id: string }>();
  const [command, ...rest] = await extractCommands();
  expect(rest).toHaveLength(0);
  expect(command).toMatchObject({ target: 'bridge', status: 'pending', conversation_id: conv.id, dedupe_key: `extract:${conv.id}:${last!.id}` });
  expect(command.payload).toMatchObject({ agentKey: 'crm-extractor', conversationId: conv.id, purpose: 'extract' });
  expect(command.payload.userId).toMatch(/^crm-extract:[0-9a-f-]{36}$/);
  expect(command.payload.text).toContain('Khách: Cho em hỏi lịch học');
  expect(command.payload.text).toContain('Bot: Dạ em chuyển nhân viên tư vấn ạ');
  expect((await conversation()).last_extracted_at).toBeTruthy();
});

test('handing the conversation back to the bot queues an extraction', async () => {
  await customerSays('Cho em hỏi học phí');
  const conv = await conversation();
  expect((await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/mode`, { mode: 'human' })).status).toBe(200);
  expect(await extractCommands()).toHaveLength(0);
  expect((await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/mode`, { mode: 'ai' })).status).toBe(200);
  expect(await extractCommands()).toHaveLength(1);
});

test('a fenced JSON answer fills a pending intake and is never sent to the customer', async () => {
  await customerSays('Em là Hoa, số em 0912 345 678');
  const conv = await conversation();
  const commandId = await enqueueExtraction(db, conv.id);
  await answer(commandId!, '```json\n{"name": "Nguyễn Thị Hoa", "phone": "0912 345 678", "email": ""}\n```');
  const [intake, ...rest] = await intakes();
  expect(rest).toHaveLength(0);
  expect(intake).toMatchObject({ conversation_id: conv.id, status: 'pending', organization_id: 'org-abm' });
  expect(intake.fields).toEqual({ name: 'Nguyễn Thị Hoa', phone: '0912 345 678' });
  expect(await db.prepare('SELECT status FROM channel_command WHERE id = ?').bind(commandId).first()).toEqual({ status: 'done' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'send_zalo'").first()).toEqual({ n: 0 });
});

test('an answer that is not JSON fails the command with EXTRACT_INVALID and writes nothing', async () => {
  await customerSays('Alo');
  const conv = await conversation();
  const commandId = await enqueueExtraction(db, conv.id);
  await answer(commandId!, 'Xin lỗi, tôi không tìm thấy thông tin nào.');
  expect(await intakes()).toHaveLength(0);
  const row = await db.prepare('SELECT status, result_json FROM channel_command WHERE id = ?').bind(commandId).first<any>();
  expect(row.status).not.toBe('done');
  expect(JSON.parse(row.result_json)).toEqual({ error: 'EXTRACT_INVALID' });
  // A phone the schema rejects counts as invalid too.
  expect(parseExtraction('{"phone": "12"}')).toBeNull();
  expect(parseExtraction('[1, 2]')).toBeNull();
});

test('a different value is only proposed until staff confirm it', async () => {
  const { conv } = await intakeFrom({ name: 'Nguyễn Thị Hoa', phone: '0912345678' });
  await customerSays('À số mới của em là 0987 654 321, email hoa@example.com');
  const second = await enqueueExtraction(db, conv.id);
  await answer(second!, '{"name": "Nguyễn Thị Hoa", "phone": "0987 654 321", "email": "hoa@example.com"}');

  const [intake, ...rest] = await intakes();
  expect(rest).toHaveLength(0);
  expect(intake.fields).toEqual({ name: 'Nguyễn Thị Hoa', phone: '0912345678', email: 'hoa@example.com', proposed: { phone: '0987 654 321' } });

  const list = await web('u-lan', 'GET', `/inbox/intakes?status=pending&conversationId=${conv.id}`);
  expect(list.status).toBe(200);
  expect(list.json.data).toHaveLength(1);
  expect(list.json.data[0]).toMatchObject({
    id: intake.id, conversationId: conv.id, channel: 'zalo', externalThreadId: 'cust-1', status: 'pending',
    fields: { name: 'Nguyễn Thị Hoa', phone: '0912345678', email: 'hoa@example.com' }, proposed: { phone: '0987 654 321' },
  });

  const confirmed = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/confirm-field`, { field: 'phone' });
  expect(confirmed.status).toBe(200);
  const [after] = await intakes();
  expect(after.fields).toEqual({ name: 'Nguyễn Thị Hoa', phone: '0987 654 321', email: 'hoa@example.com' });
  expect((await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/confirm-field`, { field: 'phone' })).status).toBe(422);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'lead_intake' AND entity_id = ?").bind(intake.id).first())
    .toEqual({ n: 1 });
});

test('merging keeps the first value and drops a proposal the newest answer no longer makes', () => {
  expect(mergeIntakeFields({ phone: '0912345678', proposed: { phone: '0999999999' } }, { phone: '+84 912 345 678' }))
    .toEqual({ phone: '0912345678' });
  expect(mergeIntakeFields({}, { need: 'IELTS' })).toEqual({ need: 'IELTS' });
});

test('classifying as b2b creates the lead with createLead and links the Zalo customer', async () => {
  const { conv, intake } = await intakeFrom({ name: 'Nguyễn Thị Hoa', phone: '0912345678' });
  const res = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, {
    pipeline: 'b2b',
    input: { contactName: 'Nguyễn Thị Hoa', phone: '0912345678', needSummary: 'Đào tạo tiếng Anh cho nhân viên', nextAction: nextAction(), source: 'website' },
  });
  expect(res.status).toBe(200);
  const { leadId, contactId } = res.json.data;
  const lead = await db.prepare('SELECT pipeline, source, contact_id, owner_user_id FROM lead WHERE id = ?').bind(leadId).first();
  expect(lead).toEqual({ pipeline: 'b2b', source: 'zalo', contact_id: contactId, owner_user_id: 'u-lan' });
  expect(await db.prepare("SELECT value FROM contact_point WHERE contact_id = ? AND type = 'zalo_uid'").bind(contactId).all()
    .then((r) => r.results)).toEqual([{ value: 'cust-1' }]);
  expect((await conversation()).contact_id).toBe(contactId);
  const [after] = await intakes();
  expect(after).toMatchObject({ status: 'classified', lead_id: leadId, contact_id: contactId, classified_by_user_id: 'u-lan' });
  const note = await db.prepare("SELECT summary FROM activity WHERE lead_id = ? AND type = 'note'").bind(leadId).first<{ summary: string }>();
  expect(note!.summary).toContain('Khách: Em tên Hoa, muốn học tiếng Anh giao tiếp');
  expect(conv.id).toBe(after.conversation_id);

  const again = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, { pipeline: 'b2b', input: {} });
  expect(again.status).toBe(409);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM lead WHERE contact_id = ?').bind(contactId).first()).toEqual({ n: 1 });
});

test('a suspected duplicate is returned to staff; only their explicit confirmation creates the lead', async () => {
  const { intake } = await intakeFrom({ name: 'Nguyễn Thị Hoa', phone: '0900100001' });
  const input = { contactName: 'Nguyễn Thị Hoa', phone: '0900100001', needSummary: 'Hỏi khoá học', nextAction: nextAction() };
  const leadsBefore = await db.prepare('SELECT COUNT(*) AS n FROM lead').first<{ n: number }>();

  const duplicate = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, { pipeline: 'b2b', input });
  expect(duplicate.status).toBe(409);
  expect(duplicate.json.error.code).toBe('DUPLICATE_SUSPECTED');
  expect((await intakes())[0].status).toBe('pending');
  expect(await db.prepare('SELECT COUNT(*) AS n FROM lead').first()).toEqual(leadsBefore);

  const confirmed = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, { pipeline: 'b2b', input: { ...input, confirmNotDuplicate: true } });
  expect(confirmed.status).toBe(200);
  expect((await intakes())[0].status).toBe('classified');
});

test('a duplicate names the matched customer only when it is in the actor customer scope, so staff can link to it', async () => {
  const { intake } = await intakeFrom({ name: 'Nguyễn Thị Hoa', phone: '0900100001' });
  const input = { contactName: 'Nguyễn Thị Hoa', phone: '0900100001', needSummary: 'Hỏi khoá học', nextAction: nextAction() };
  const classify = (user: string) => web(user, 'POST', `/inbox/intakes/${intake.id}/classify`, { pipeline: 'b2b', input });

  // The matched lead L-0001 is Lan's, but its customer belongs to Huy: the lead is described, the customer is not.
  await db.prepare("UPDATE contact SET owner_user_id = 'u-huy' WHERE id = 'ct-1'").run();
  const foreign = await classify('u-lan');
  expect(foreign.json.error.code).toBe('DUPLICATE_SUSPECTED');
  expect(foreign.json.error.details).toEqual([{ field: 'phone', code: 'L-0001', stage: expect.any(String), owner: 'Đỗ Ngọc Lan' }]);
  expect(JSON.stringify(foreign.json)).not.toContain('ct-1');
  const huy = await classify('u-huy');
  expect(huy.json.error.details).toEqual([expect.objectContaining({ code: null, contactId: 'ct-1', contactName: 'Trần Thị Mai Anh' })]);

  // An archived customer cannot be linked, so it is not offered either.
  await db.prepare("UPDATE contact SET owner_user_id = 'u-lan', archived_at = ? WHERE id = 'ct-1'").bind(STAMP).run();
  expect((await classify('u-lan')).json.error.details[0]).not.toHaveProperty('contactId');

  await db.prepare("UPDATE contact SET archived_at = NULL WHERE id = 'ct-1'").run();
  const own = await classify('u-lan');
  expect(own.json.error.details).toEqual([
    { field: 'phone', code: 'L-0001', stage: expect.any(String), owner: 'Đỗ Ngọc Lan', contactId: 'ct-1', contactName: 'Trần Thị Mai Anh' },
  ]);
  const linked = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/link-contact`, { contactId: own.json.error.details[0].contactId });
  expect(linked.status).toBe(200);
  expect((await intakes())[0]).toMatchObject({ status: 'classified', lead_id: null, contact_id: 'ct-1' });
});

test('a learner classification without a next action is rejected and the intake stays pending', async () => {
  const { intake } = await intakeFrom({ name: 'Nguyễn Thị Hoa', phone: '0912345678' });
  const res = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, {
    pipeline: 'learner', input: { contactName: 'Nguyễn Thị Hoa', phone: '0912345678', needSummary: 'Học giao tiếp' },
  });
  expect(res.status).toBe(422);
  expect(res.json.error.code).toBe('VALIDATION_FAILED');
  expect((await intakes())[0]).toMatchObject({ status: 'pending', lead_id: null });

  const created = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, {
    pipeline: 'learner', input: { contactName: 'Nguyễn Thị Hoa', phone: '0912345678', needSummary: 'Học giao tiếp', nextAction: nextAction() },
  });
  expect(created.status).toBe(200);
  expect(await db.prepare('SELECT pipeline, source FROM lead WHERE id = ?').bind(created.json.data.leadId).first())
    .toEqual({ pipeline: 'learner', source: 'zalo' });
});

test('the cron extracts a direct conversation idle for 15 minutes once', async () => {
  const idleAt = new Date(Date.now() - 16 * 60_000).toISOString();
  const recentAt = new Date(Date.now() - 5 * 60_000).toISOString();
  await db.batch([
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, mode,
        last_message_at, last_inbound_at, created_at, updated_at)
      VALUES ('conv-idle', 'org-abm', 'ca-1', 'direct', 'cust-idle', 'Anh Nam', 'ai', ?1, ?1, ?1, ?1),
        ('conv-recent', 'org-abm', 'ca-1', 'direct', 'cust-recent', 'Chị Lan', 'ai', ?2, ?2, ?2, ?2),
        ('conv-group', 'org-abm', 'ca-1', 'group', 'grp-1', 'Nhóm lớp', 'ai', ?1, ?1, ?1, ?1)`).bind(idleAt, recentAt),
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
      VALUES ('m-idle', 'conv-idle', 'in', 'customer', 'Bên mình có lớp tối không', 'received', ?1),
        ('m-recent', 'conv-recent', 'in', 'customer', 'Chào bạn', 'received', ?2),
        ('m-group', 'conv-group', 'in', 'customer', 'Chào cả nhóm', 'received', ?1)`).bind(idleAt, recentAt),
  ]);
  await runScheduled(testEnv, '* * * * *');
  const queued = await extractCommands();
  expect(queued.map((c) => c.conversation_id)).toEqual(['conv-idle']);
  expect(queued[0].dedupe_key).toBe('extract:conv-idle:m-idle');

  await runScheduled(testEnv, '* * * * *');
  expect(await extractCommands()).toHaveLength(1);
});

test('linking an intake to an existing customer in scope classifies it without a lead', async () => {
  const { conv, intake } = await intakeFrom({ name: 'Nguyễn Thị Hoa' });
  await db.batch([
    db.prepare(`INSERT INTO contact (id, organization_id, display_name, owner_user_id, created_at, updated_at)
      VALUES ('ct-own', 'org-abm', 'Nguyễn Thị Hoa', 'u-lan', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO contact (id, organization_id, display_name, owner_user_id, created_at, updated_at)
      VALUES ('ct-other', 'org-abm', 'Anh Huy khách', 'u-huy', ?, ?)`).bind(STAMP, STAMP),
  ]);
  const outside = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/link-contact`, { contactId: 'ct-other' });
  expect(outside.status).toBe(404);
  expect((await intakes())[0].status).toBe('pending');

  const linked = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/link-contact`, { contactId: 'ct-own' });
  expect(linked.status).toBe(200);
  expect((await conversation()).contact_id).toBe('ct-own');
  expect(await db.prepare("SELECT value FROM contact_point WHERE contact_id = 'ct-own' AND type = 'zalo_uid'").all().then((r) => r.results))
    .toEqual([{ value: 'cust-1' }]);
  expect((await intakes())[0]).toMatchObject({ status: 'classified', lead_id: null, contact_id: 'ct-own', classified_by_user_id: 'u-lan' });
});

test('discarding an intake writes nothing else, and a group cannot be extracted on request', async () => {
  const { intake } = await intakeFrom({ name: 'Nguyễn Thị Hoa' });
  expect((await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/discard`)).status).toBe(200);
  expect((await intakes())[0]).toMatchObject({ status: 'discarded', lead_id: null, contact_id: null });
  expect((await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/discard`)).status).toBe(409);
  expect((await web('u-lan', 'GET', '/inbox/intakes')).json.data).toEqual([]);

  await ingestEvents(db, [{
    type: 'message', accountExternalId: 'zalo-acc-1', threadId: 'grp-9', threadKind: 'group', msgId: 'zm-grp', fromSelf: false,
    senderExternalId: 'member-1', senderName: 'Thành viên', text: 'Chào cả nhóm', sentAt: new Date().toISOString(),
  }]);
  const group = await conversation('grp-9');
  expect((await web('u-lan', 'POST', `/inbox/conversations/${group.id}/extract`)).status).toBe(422);
  const direct = await web('u-lan', 'POST', `/inbox/conversations/${(await conversation()).id}/extract`);
  expect(direct.status).toBe(200);
  expect(direct.json.data.commandId).toBeTruthy();
});

test('extraction for a customer with an open lead logs a note activity on that lead instead of creating a pending intake', async () => {
  // ct-1 in demo seed has open lead ld-1 (L-0001).
  await customerSays('Em muốn đăng ký học khóa AI cơ bản ạ');
  const conv = await conversation();
  await db.prepare("UPDATE conversation SET contact_id = 'ct-1' WHERE id = ?").bind(conv.id).run();

  const commandId = await enqueueExtraction(db, conv.id);
  await answer(commandId!, JSON.stringify({ need: 'Học khóa AI cơ bản', program: '199k' }));

  expect(await intakes()).toHaveLength(0);
  const note = await db.prepare("SELECT actor_kind, type, summary FROM activity WHERE lead_id = 'ld-1' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .first<{ actor_kind: string; type: string; summary: string }>();
  expect(note).toMatchObject({ actor_kind: 'system', type: 'note' });
  expect(note!.summary).toContain('Nhu cầu: Học khóa AI cơ bản');
  expect(note!.summary).toContain('Chương trình: 199k');
});

test('a returning zalo_oa customer in a new conversation is linked to the existing contact without creating a duplicate contact', async () => {
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-oa', 'org-abm', 'zalo_oa', 'oa-acc-1', 'Zalo OA ABM', 'sales-bot', 'connected', ?1, ?1)`).bind(STAMP),
    db.prepare(`INSERT INTO contact (id, organization_id, display_name, owner_user_id, created_at, updated_at)
      VALUES ('ct-oa-existing', 'org-abm', 'Phạm Minh Tuấn', 'u-lan', ?1, ?1)`).bind(STAMP),
    db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, is_primary, created_at)
      VALUES ('cp-oa-existing', 'ct-oa-existing', 'zalo_oa_uid', 'oa-thread-99', 'oa-thread-99', 0, ?1)`).bind(STAMP),
  ]);

  await ingestEvents(db, [{
    type: 'message', accountExternalId: 'oa-acc-1', threadId: 'oa-thread-99', threadKind: 'direct',
    msgId: 'oa-msg-1', fromSelf: false, senderExternalId: 'oa-thread-99', senderName: 'Phạm Minh Tuấn',
    text: 'Cho anh đăng ký học khóa tiếp theo, số anh 0918111222', sentAt: new Date().toISOString(),
  }]);

  const conv = await conversation('oa-thread-99');
  const commandId = await enqueueExtraction(db, conv.id);
  await answer(commandId!, JSON.stringify({ name: 'Phạm Minh Tuấn', phone: '0918111222', need: 'Học khóa tiếp theo' }));

  expect((await conversation('oa-thread-99')).contact_id).toBe('ct-oa-existing');
  const [intake] = await intakes();
  expect(intake.contact_id).toBe('ct-oa-existing');

  const contactsBefore = await db.prepare('SELECT COUNT(*) AS n FROM contact').first<{ n: number }>();
  const classified = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, {
    pipeline: 'learner',
    input: { contactName: 'Phạm Minh Tuấn', phone: '0918111222', needSummary: 'Học khóa tiếp theo', nextAction: nextAction() },
  });
  expect(classified.status, JSON.stringify(classified.json)).toBe(200);
  expect(classified.json.data.contactId).toBe('ct-oa-existing');
  const contactsAfter = await db.prepare('SELECT COUNT(*) AS n FROM contact').first<{ n: number }>();
  expect(contactsAfter!.n).toBe(contactsBefore!.n);
  expect(await db.prepare("SELECT type, value FROM contact_point WHERE contact_id = 'ct-oa-existing' AND type = 'zalo_oa_uid'").all().then((r) => r.results))
    .toEqual([{ type: 'zalo_oa_uid', value: 'oa-thread-99' }]);
});

test('classifying an intake assigns the conversation to the lead owner and queues one private Lark notice with the lead code', async () => {
  await db.prepare("UPDATE app_user SET lark_open_id = 'ou_lan_123' WHERE id = 'u-lan'").run();
  const prod = await web('u-admin', 'POST', '/commands/upsertProduct', { name: 'Khóa AI 199K', priceVnd: 199000, active: true });
  const productId = prod.json.data.id as string;

  const { conv, intake } = await intakeFrom({ name: 'Nguyễn Văn An', phone: '0912345678' });
  await db.prepare('DELETE FROM channel_command').run();

  const res = await web('u-lan', 'POST', `/inbox/intakes/${intake.id}/classify`, {
    pipeline: 'learner',
    input: { contactName: 'Nguyễn Văn An', phone: '0912345678', productId, needSummary: 'Học AI 199k', nextAction: nextAction() },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const { leadId, contactId } = res.json.data as { leadId: string; contactId: string };
  const lead = await db.prepare('SELECT code, owner_user_id FROM lead WHERE id = ?').bind(leadId).first<{ code: string; owner_user_id: string }>();

  expect((await conversation(conv.external_thread_id)).assignee_user_id).toBe('u-lan');
  expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command = 'inbox.assign' AND entity_id = ?").bind(conv.id).first())
    .toEqual({ n: 1 });

  const larkCmds = await db.prepare("SELECT payload_json FROM channel_command WHERE kind = 'send_lark' ORDER BY created_at, rowid").all<{ payload_json: string }>()
    .then((r) => r.results.map((row) => JSON.parse(row.payload_json)));
  const privateCmds = larkCmds.filter((p) => p.openId === 'ou_lan_123');
  expect(privateCmds).toHaveLength(1);
  expect(privateCmds[0].text).toContain(lead!.code);
  expect(privateCmds[0].text).toContain('Nguyễn Văn An');
  expect(privateCmds[0].text).toContain('Khóa AI 199K');
  expect(privateCmds[0].text).toContain(`https://crm.example/learners/${contactId}`);
});

test('pronouns and honorific short names are dropped while real names are kept, and program 199k matches the 199,000đ product', async () => {
  expect(parseExtraction('{"name": "Chị", "phone": "0912345678"}')).toEqual({ phone: '0912345678' });
  expect(parseExtraction('{"name": "Sếp Tú", "phone": "0912345678"}')).toEqual({ phone: '0912345678' });
  expect(parseExtraction('{"name": "anh Long", "phone": "0912345678"}')).toEqual({ phone: '0912345678' });
  expect(parseExtraction('{"name": "Nguyễn Văn An", "phone": "0912345678"}')).toEqual({ name: 'Nguyễn Văn An', phone: '0912345678' });

  const prod = await web('u-admin', 'POST', '/commands/upsertProduct', { name: 'Lớp AI Ứng Dụng 199K', priceVnd: 199000, active: true });
  const productId = prod.json.data.id as string;

  const { intake } = await intakeFrom({ name: 'Nguyễn Văn An', phone: '0912345678', program: '199k' });
  expect(intake.fields).toEqual({
    name: 'Nguyễn Văn An',
    phone: '0912345678',
    program: '199k',
    productId,
  });
});

