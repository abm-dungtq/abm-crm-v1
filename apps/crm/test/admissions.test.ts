import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { holdExpiry } from '../src/worker/learner-hold';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string> } };

async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}
const command = (user: string, name: string, body: unknown) => call(user, 'POST', `/commands/${name}`, body);
const get = (user: string, path: string) => call(user, 'GET', path);
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

const PHONE = '0912345678';
const nextAction = () => ({ title: 'Gọi lần đầu', dueAt: new Date(Date.now() + 86_400_000).toISOString() });
const newLead = (user: string, extra: Record<string, unknown> = {}) => command(user, 'createLearnerLead', {
  contactName: 'Nguyễn Văn An', phone: PHONE, source: 'facebook', needSummary: 'Học IELTS', nextAction: nextAction(), ...extra,
});

/** Creates a customer for `user` and returns the ids needed by later calls. */
async function seedCustomer(user = 'u-lan', extra: Record<string, unknown> = {}) {
  const created = await newLead(user, extra);
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const { leadId, contactId } = created.json.data as { leadId: string; contactId: string };
  return { leadId, contactId };
}
const leadVersion = async (leadId: string) => (await db.prepare('SELECT version FROM lead WHERE id = ?').bind(leadId).first<{ version: number }>())!.version;
const contactVersion = async (contactId: string) => (await db.prepare('SELECT version FROM contact WHERE id = ?').bind(contactId).first<{ version: number }>())!.version;
const expireHold = (contactId: string) => db.prepare("UPDATE contact SET hold_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(contactId).run();
const poolIds = async (user: string) => ((await get(user, '/learners?view=pool')).json.data.items as { contactId: string }[]).map((i) => i.contactId);

async function makeProduct(name = 'Khóa IELTS 6.5', active = true) {
  const r = await command('u-admin', 'upsertProduct', { name, priceVnd: 10_000_000, active });
  return r.json.data.id as string;
}

async function makeContract(status = 'active') {
  const r = await command('u-lan', 'upsertPartnerContract', { accountName: 'Trường Đối Tác', name: 'HĐ 2026', status });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.data as { id: string; version: number };
}

/** Walks a lead to the point where it may be won: contacted, need confirmed, trial skipped. */
async function readyToWin(user: string, leadId: string) {
  for (const stepCode of ['contacted', 'need_confirmed']) {
    const r = await command(user, 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
  const skipped = await command(user, 'skipTrial', { leadId, expectedVersion: await leadVersion(leadId), reason: 'Khách đã biết trung tâm' });
  expect(skipped.status, JSON.stringify(skipped.json)).toBe(200);
}

beforeEach(() => resetDb(db, seedSql));

describe('creating a learner lead', () => {
  test('creates the customer, the lead on the learner pipeline, the Next Action and the 8 journey steps', async () => {
    const { leadId, contactId } = await seedCustomer('u-lan', { email: 'an@example.com' });
    const lead = await db.prepare('SELECT pipeline, stage, status, owner_user_id, team_id, next_action_task_id FROM lead WHERE id = ?').bind(leadId)
      .first<Record<string, string>>();
    expect(lead).toMatchObject({ pipeline: 'learner', stage: 'new', status: 'active', owner_user_id: 'u-lan', team_id: 'team-kd1' });
    expect(await count("SELECT COUNT(*) AS n FROM task WHERE lead_id = ? AND status = 'open' AND assignee_user_id = 'u-lan'", leadId)).toBe(1);
    const steps = (await db.prepare('SELECT step_code, status FROM lead_step WHERE lead_id = ? ORDER BY position').bind(leadId).all<{ step_code: string; status: string }>()).results;
    expect(steps).toHaveLength(8);
    expect(steps.filter((s) => s.status === 'done').map((s) => s.step_code)).toEqual(['recorded']);
    expect(await count('SELECT COUNT(*) AS n FROM contact_point WHERE contact_id = ?', contactId)).toBe(2);
    const contact = await db.prepare('SELECT owner_user_id, hold_started_at, hold_expires_at FROM contact WHERE id = ?').bind(contactId)
      .first<{ owner_user_id: string; hold_started_at: string; hold_expires_at: string }>();
    expect(contact!.owner_user_id).toBe('u-lan');
    expect(contact!.hold_expires_at).toBe(holdExpiry(contact!.hold_started_at));
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'lead' AND entity_id = ?", leadId)).toBe(1);
  });

  test('Admin must name a Sale or Leader; other roles may not choose one', async () => {
    expect((await newLead('u-admin')).status).toBe(422);
    expect((await newLead('u-admin', { ownerUserId: 'u-head' })).status).toBe(422);
    const ok = await newLead('u-admin', { ownerUserId: 'u-lan' });
    expect(ok.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE owner_user_id = 'u-lan' AND pipeline = 'learner'")).toBe(1);
    expect((await newLead('u-lan', { phone: '0900000001', ownerUserId: 'u-long' })).status).toBe(422);
  });

  test('another Sale creating the same phone is refused without learning who holds the customer', async () => {
    await seedCustomer('u-lan');
    const dup = await newLead('u-huy');
    expect(dup.status).toBe(403);
    expect(dup.json.error?.code).toBe('FORBIDDEN');
    expect(JSON.stringify(dup.json)).not.toContain('Lan');
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE pipeline = 'learner'")).toBe(1);
  });

  test('the holder adding a lead for the same phone reuses the customer and keeps the hold', async () => {
    const first = await seedCustomer('u-lan');
    const before = await db.prepare('SELECT hold_expires_at FROM contact WHERE id = ?').bind(first.contactId).first<{ hold_expires_at: string }>();
    const second = await newLead('u-lan', { phone: '+84 912 345 678', needSummary: 'Học thêm TOEIC' });
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    expect(second.json.data.contactId).toBe(first.contactId);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE contact_id = ? AND pipeline = 'learner'", first.contactId)).toBe(2);
    expect((await db.prepare('SELECT hold_expires_at FROM contact WHERE id = ?').bind(first.contactId).first<{ hold_expires_at: string }>())!.hold_expires_at)
      .toBe(before!.hold_expires_at);
  });

  test('a customer in the pool must be claimed first', async () => {
    const { contactId } = await seedCustomer('u-lan');
    await expireHold(contactId);
    const r = await newLead('u-huy');
    expect(r.status).toBe(422);
    expect(r.json.error?.message).toContain('Nhận');
  });

  test('partner source needs an active contract', async () => {
    const draft = await makeContract('draft');
    const rejected = await newLead('u-lan', { source: 'partner', partnerContractId: draft.id });
    expect(rejected.status).toBe(422);
    expect(await newLead('u-lan', { source: 'partner' })).toMatchObject({ status: 422 });
    const active = await makeContract('active');
    const ok = await newLead('u-lan', { source: 'partner', partnerContractId: active.id, sourceNote: 'Hội thảo' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const lead = await db.prepare('SELECT partner_contract_id, need_summary FROM lead WHERE id = ?').bind(ok.json.data.leadId).first<{ partner_contract_id: string; need_summary: string }>();
    expect(lead).toEqual({ partner_contract_id: active.id, need_summary: 'Học IELTS — Nguồn: Hội thảo' });
  });

  test('attaches only products that are still on sale', async () => {
    const on = await makeProduct('Khóa A');
    const off = await makeProduct('Khóa B', false);
    expect((await newLead('u-lan', { productIds: [on, off] })).status).toBe(422);
    const ok = await newLead('u-lan', { productIds: [on] });
    expect(ok.status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM customer_product WHERE contact_id = ? AND detached_at IS NULL', ok.json.data.contactId)).toBe(1);
  });
});

describe('journey', () => {
  test('need confirmation cannot come before contact, and only two steps are ticked by hand', async () => {
    const { leadId } = await seedCustomer();
    const early = await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode: 'need_confirmed' });
    expect(early.status).toBe(422);
    const placed = await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: 1, stepCode: 'placed' });
    expect(placed.status).toBe(422);
    expect(placed.json.error?.code).toBe('VALIDATION_FAILED');

    const contacted = await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode: 'contacted' });
    expect(contacted.status).toBe(200);
    expect((await db.prepare('SELECT stage FROM lead WHERE id = ?').bind(leadId).first<{ stage: string }>())!.stage).toBe('contacted');
    const again = await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode: 'contacted' });
    expect(again.status).toBe(422);
    const need = await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode: 'need_confirmed' });
    expect(need.status).toBe(200);
    expect((await db.prepare('SELECT stage FROM lead WHERE id = ?').bind(leadId).first<{ stage: string }>())!.stage).toBe('qualified');
    const stale = await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: 1, stepCode: 'contacted' });
    expect(stale.status).toBe(409);
  });

  test('another Sale cannot touch the lead', async () => {
    const { leadId } = await seedCustomer('u-lan');
    const r = await command('u-huy', 'markJourneyStep', { leadId, expectedVersion: 1, stepCode: 'contacted' });
    expect(r.status).toBe(404);
    expect((await command('u-hung', 'markJourneyStep', { leadId, expectedVersion: 1, stepCode: 'contacted' })).status).toBe(200);
  });

  test('winning needs the trial done or skipped; then the lead is won and enrolled', async () => {
    const { leadId } = await seedCustomer();
    for (const stepCode of ['contacted', 'need_confirmed']) {
      await command('u-lan', 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode });
    }
    const blocked = await command('u-lan', 'winLearnerLead', { leadId, expectedVersion: await leadVersion(leadId) });
    expect(blocked.status).toBe(422);
    expect(blocked.json.error?.message).toContain('Học thử');
    await command('u-lan', 'skipTrial', { leadId, expectedVersion: await leadVersion(leadId), reason: 'Khách đã biết trung tâm' });
    const won = await command('u-lan', 'winLearnerLead', { leadId, expectedVersion: await leadVersion(leadId), note: 'Đã đóng cọc' });
    expect(won.status, JSON.stringify(won.json)).toBe(200);
    expect(await db.prepare('SELECT stage, status, next_action_task_id FROM lead WHERE id = ?').bind(leadId).first())
      .toMatchObject({ stage: 'won', status: 'won', next_action_task_id: null });
    expect((await db.prepare("SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'enrolled'").bind(leadId).first<{ status: string }>())!.status).toBe('done');
    expect(await count("SELECT COUNT(*) AS n FROM task WHERE lead_id = ? AND status = 'open'", leadId)).toBe(0);
  });

  test('closing as lost or not fit needs a reason; "other" needs a note', async () => {
    const { leadId } = await seedCustomer();
    const noNote = await command('u-lan', 'closeLearnerLead', { leadId, expectedVersion: 1, outcome: 'lost', reason: 'other' });
    expect(noNote.status).toBe(422);
    expect(noNote.json.error?.code).toBe('VALIDATION_FAILED');
    const closed = await command('u-lan', 'closeLearnerLead', { leadId, expectedVersion: 1, outcome: 'not_fit', reason: 'not_fit' });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(await db.prepare('SELECT stage, status, lost_reason FROM lead WHERE id = ?').bind(leadId).first())
      .toEqual({ stage: 'not_fit', status: 'lost', lost_reason: 'not_fit' });
    expect((await command('u-lan', 'closeLearnerLead', { leadId, expectedVersion: 2, outcome: 'lost', reason: 'price' })).status).toBe(422);
  });

  test('B2B commands refuse a learner lead and B2B lists leave it out', async () => {
    const beforeDashboard = await get('u-lan', '/dashboard');
    const beforeOverview = await get('u-admin', '/overview');
    expect(beforeDashboard.status).toBe(200);
    expect(beforeOverview.status).toBe(200);
    const activeBefore = beforeDashboard.json.data.kpi.activeLeads as number;
    const openBefore = beforeOverview.json.data.kpi.openLeads as number;

    const { leadId } = await seedCustomer();
    const stage = await command('u-lan', 'changeStage', { leadId, expectedVersion: 1, toStage: 'contacted' });
    expect(stage.status).toBe(422);
    expect(stage.json.error?.code).toBe('VALIDATION_FAILED');
    expect((await command('u-hung', 'assignLead', { leadId, expectedVersion: 1, ownerUserId: 'u-long' })).status).toBe(422);
    expect((await command('u-lan', 'requestOwnerChange', { leadId, expectedVersion: 1, toUserId: 'u-long', reason: 'Bận' })).status).toBe(422);
    const list = (await get('u-lan', '/leads')).json.data as { id: string }[];
    expect(list.map((l) => l.id)).not.toContain(leadId);
    const detail = await get('u-lan', `/leads/${leadId}`);
    expect(detail.json.data.lead.health).toEqual({ firstContact: null, stageSla: null, nextActionOverdue: false });

    const dashboard = await get('u-lan', '/dashboard');
    expect(dashboard.json.data.kpi.activeLeads).toBe(activeBefore);
    const overview = await get('u-admin', '/overview');
    expect(overview.json.data.kpi.openLeads).toBe(openBefore);
    const cardIds = (overview.json.data.columns as { leads: { id: string }[] }[]).flatMap((column) => column.leads.map((card) => card.id));
    expect(cardIds).not.toContain(leadId);
  });
});

describe('customer hold and pool', () => {
  test('another Sale sees no phone and no list entry while the hold runs', async () => {
    const { contactId } = await seedCustomer('u-lan');
    const detail = await get('u-huy', `/learners/${contactId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.restricted).toBe(true);
    expect(detail.json.data.contact.phone).toBeNull();
    expect(detail.json.data.contact.ownerName).toBeNull();
    expect(detail.json.data.activities).toBeUndefined();
    expect(await poolIds('u-huy')).not.toContain(contactId);
    expect((await get('u-huy', '/learners')).json.data.items).toEqual([]);
    expect((await get('u-huy', `/learners?q=${PHONE}`)).json.data.items).toEqual([]);
    expect((await get('u-mai', '/learners')).json.data.items).toEqual([]);
    expect((await get('u-lan', '/learners')).json.data.items[0]).toMatchObject({ contactId, phone: PHONE, ownerName: 'Đỗ Ngọc Lan', stageLabel: 'Mới' });
    expect((await get('u-hung', `/learners/${contactId}`)).json.data.contact.phone).toBe(PHONE);
    expect((await get('u-admin', `/learners/${contactId}`)).json.data.contact.phone).toBe(PHONE);
    const search = await get('u-huy', `/search?q=${PHONE}`);
    expect(search.json.data.leads).toEqual([]);
  });

  test('after the hold runs out the customer is in the pool and another Sale can claim it', async () => {
    const { contactId, leadId } = await seedCustomer('u-lan');
    await expireHold(contactId);
    expect(await poolIds('u-huy')).toContain(contactId);
    const row = ((await get('u-huy', '/learners?view=pool')).json.data.items as any[]).find((i) => i.contactId === contactId);
    expect(row).toMatchObject({ ownerName: 'Chưa gắn', canClaim: true });

    const claim = await command('u-huy', 'claimCustomer', { contactId, version: row.version });
    expect(claim.status, JSON.stringify(claim.json)).toBe(200);
    expect(await db.prepare('SELECT owner_user_id, team_id, department_id FROM lead WHERE id = ?').bind(leadId).first())
      .toEqual({ owner_user_id: 'u-huy', team_id: 'team-kd2', department_id: 'dep-kd' });
    expect(await count("SELECT COUNT(*) AS n FROM task WHERE lead_id = ? AND status = 'open' AND assignee_user_id = 'u-huy'", leadId)).toBe(1);
    const contact = await db.prepare('SELECT owner_user_id, hold_started_at, hold_expires_at FROM contact WHERE id = ?').bind(contactId)
      .first<{ owner_user_id: string; hold_started_at: string; hold_expires_at: string }>();
    expect(contact).toMatchObject({ owner_user_id: 'u-huy' });
    expect(contact!.hold_expires_at).toBe(holdExpiry(contact!.hold_started_at));
    expect(await poolIds('u-huy')).not.toContain(contactId);
    // The former holder no longer sees it, and cannot claim it back while it is held.
    expect((await get('u-lan', '/learners')).json.data.items).toEqual([]);
    expect((await command('u-lan', 'claimCustomer', { contactId, version: await contactVersion(contactId) })).status).toBe(403);
    expect((await command('u-huy', 'claimCustomer', { contactId, version: await contactVersion(contactId) })).status).toBe(422);
  });

  test('a customer with an unexpired hold cannot be claimed', async () => {
    const { contactId } = await seedCustomer('u-lan');
    const r = await command('u-huy', 'claimCustomer', { contactId, version: await contactVersion(contactId) });
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe('FORBIDDEN');
  });

  test('a customer with a won lead never returns to the pool', async () => {
    const { contactId, leadId } = await seedCustomer('u-lan');
    await readyToWin('u-lan', leadId);
    expect((await command('u-lan', 'winLearnerLead', { leadId, expectedVersion: await leadVersion(leadId) })).status).toBe(200);
    await expireHold(contactId);
    expect(await poolIds('u-huy')).not.toContain(contactId);
    const claim = await command('u-huy', 'claimCustomer', { contactId, version: await contactVersion(contactId) });
    expect([403, 422]).toContain(claim.status);
    expect(await db.prepare('SELECT owner_user_id FROM contact WHERE id = ?').bind(contactId).first()).toEqual({ owner_user_id: 'u-lan' });
  });

  test('a customer whose owner moved to another role falls into the pool and can be claimed', async () => {
    const { contactId, leadId } = await seedCustomer('u-lan');
    expect(await poolIds('u-huy')).not.toContain(contactId);
    await db.prepare("UPDATE app_user SET role = 'academic', department_id = NULL, team_id = NULL WHERE id = 'u-lan'").run();
    expect(await poolIds('u-huy')).toContain(contactId);
    // The same customer cannot be re-created by another Sale until it is claimed, but it is not locked to the old owner.
    const claim = await command('u-huy', 'claimCustomer', { contactId, version: await contactVersion(contactId) });
    expect(claim.status, JSON.stringify(claim.json)).toBe(200);
    expect((await db.prepare('SELECT owner_user_id FROM lead WHERE id = ?').bind(leadId).first<{ owner_user_id: string }>())!.owner_user_id).toBe('u-huy');
  });

  test('a customer whose owner was disabled falls into the pool, even with a won lead', async () => {
    const { contactId, leadId } = await seedCustomer('u-lan');
    await readyToWin('u-lan', leadId);
    await command('u-lan', 'winLearnerLead', { leadId, expectedVersion: await leadVersion(leadId) });
    await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-lan'").run();
    expect(await poolIds('u-huy')).toContain(contactId);
  });

  test('a customer without an owner is in the pool', async () => {
    const { contactId } = await seedCustomer('u-lan');
    await db.prepare('UPDATE contact SET owner_user_id = NULL, hold_expires_at = NULL WHERE id = ?').bind(contactId).run();
    expect(await poolIds('u-huy')).toContain(contactId);
  });

  test('Leader can change the owner inside the team, not for another team; Admin can for anyone', async () => {
    const { contactId } = await seedCustomer('u-huy');
    const foreign = await command('u-hung', 'changeCustomerOwner', { contactId, version: await contactVersion(contactId), ownerUserId: 'u-lan' });
    expect(foreign.status).toBe(403);
    expect(foreign.json.error?.code).toBe('FORBIDDEN');

    const moved = await command('u-admin', 'changeCustomerOwner', { contactId, version: await contactVersion(contactId), ownerUserId: 'u-lan' });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const row = await db.prepare('SELECT owner_user_id, hold_expires_at FROM contact WHERE id = ?').bind(contactId).first<{ owner_user_id: string; hold_expires_at: string }>();
    expect(row!.owner_user_id).toBe('u-lan');
    expect(Math.abs(Date.parse(row!.hold_expires_at) - Date.parse(holdExpiry(new Date().toISOString())))).toBeLessThan(5000);

    expect((await command('u-hung', 'changeCustomerOwner', { contactId, version: await contactVersion(contactId), ownerUserId: 'u-long' })).status).toBe(200);
    expect((await command('u-hung', 'changeCustomerOwner', { contactId, version: await contactVersion(contactId), ownerUserId: 'u-huy' })).status).toBe(403);
    expect((await command('u-lan', 'changeCustomerOwner', { contactId, version: 1, ownerUserId: 'u-long' })).status).toBe(403);
  });

  test('the director reads learner screens; other roles do not', async () => {
    const { contactId } = await seedCustomer('u-lan');
    expect((await get('u-bgd', '/learners')).json.data.items).toHaveLength(1);
    expect((await get('u-bgd', `/learners/${contactId}`)).json.data.contact.phone).toBe(PHONE);
    expect((await get('u-bgd', '/partners')).status).toBe(200);
    expect((await command('u-bgd', 'claimCustomer', { contactId, version: 1 })).status).toBe(403);
    expect((await get('u-head', '/learners')).status).toBe(403);
  });
});

describe('products on a customer', () => {
  test('detaching keeps the row, re-attaching adds a new one', async () => {
    const { contactId } = await seedCustomer('u-lan');
    const productId = await makeProduct();
    const attached = await command('u-lan', 'attachProduct', { contactId, productId });
    expect(attached.status, JSON.stringify(attached.json)).toBe(200);
    expect((await command('u-lan', 'attachProduct', { contactId, productId })).status).toBe(422);
    const detached = await command('u-lan', 'detachProduct', { customerProductId: attached.json.data.id, version: 1 });
    expect(detached.status).toBe(200);
    expect((await command('u-lan', 'detachProduct', { customerProductId: attached.json.data.id, version: 2 })).status).toBe(422);
    expect((await command('u-lan', 'attachProduct', { contactId, productId })).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM customer_product WHERE contact_id = ?', contactId)).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM customer_product WHERE contact_id = ? AND detached_at IS NULL', contactId)).toBe(1);
    const detail = (await get('u-lan', `/learners/${contactId}`)).json.data;
    expect(detail.products).toHaveLength(1);
    expect(detail.detachedProducts).toHaveLength(1);
    expect((await get('u-lan', '/learners')).json.data.items[0].course).toBe('Khóa IELTS 6.5');
  });

  test('only the holder, the team Leader or Admin may change products', async () => {
    const { contactId } = await seedCustomer('u-lan');
    const productId = await makeProduct();
    const denied = await command('u-huy', 'attachProduct', { contactId, productId });
    expect(denied.status).toBe(403);
    expect(denied.json.error?.code).toBe('FORBIDDEN');
    expect((await command('u-mai', 'attachProduct', { contactId, productId })).status).toBe(403);
    expect((await command('u-hung', 'attachProduct', { contactId, productId })).status).toBe(200);
    expect((await command('u-lan', 'attachProduct', { contactId, productId: 'missing' })).status).toBe(422);
  });

  test('a withdrawn product cannot be attached', async () => {
    const { contactId } = await seedCustomer('u-lan');
    const productId = await makeProduct('Khóa cũ', false);
    expect((await command('u-lan', 'attachProduct', { contactId, productId })).status).toBe(422);
  });
});

describe('partner contracts', () => {
  test('a contract gets its own steps that can be added and ticked', async () => {
    const contract = await makeContract('draft');
    expect(await count("SELECT COUNT(*) AS n FROM account WHERE name = 'Trường Đối Tác'")).toBe(1);
    const step = await command('u-lan', 'addContractStep', { contractId: contract.id, name: 'Ký hợp đồng' });
    const second = await command('u-lan', 'addContractStep', { contractId: contract.id, name: 'Gửi danh sách' });
    expect(step.status).toBe(200);
    expect((await db.prepare('SELECT position FROM partner_contract_step WHERE id = ?').bind(second.json.data.id).first<{ position: number }>())!.position).toBe(2);
    const done = await command('u-lan', 'toggleContractStep', { stepId: step.json.data.id, version: 1, done: true });
    expect(done.status).toBe(200);
    expect((await command('u-lan', 'toggleContractStep', { stepId: step.json.data.id, version: 1, done: false })).status).toBe(409);
    const detail = (await get('u-hung', `/partners/${contract.id}`)).json.data;
    expect(detail.steps.map((s: any) => [s.name, s.doneAt !== null])).toEqual([['Ký hợp đồng', true], ['Gửi danh sách', false]]);

    const edited = await command('u-lan', 'upsertPartnerContract', { id: contract.id, version: contract.version, name: 'HĐ 2026', status: 'active', startsOn: '2026-01-01', endsOn: '2026-12-31' });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect((await command('u-lan', 'upsertPartnerContract', { id: contract.id, version: contract.version, name: 'HĐ', status: 'active' })).status).toBe(409);
    expect((await command('u-lan', 'upsertPartnerContract', { id: contract.id, version: 2, name: 'HĐ', status: 'active', startsOn: '2026-12-31', endsOn: '2026-01-01' })).status).toBe(422);
    const list = (await get('u-lan', '/partners')).json.data;
    expect(list[0]).toMatchObject({ name: 'HĐ 2026', status: 'active', stepsTotal: 2, stepsDone: 1 });
  });

  const header = 'Họ tên,Số điện thoại,Email,Nhu cầu';

  test('CSV import previews first, flags a customer held by someone else and commits the rest in one go', async () => {
    const contract = await makeContract('active');
    await seedCustomer('u-lan');
    const csv = `${header}\nTrần Bình,0988111222,,Học giao tiếp\nPhạm Chi,0988333444,chi@example.com,\nNguyễn Văn An,${PHONE},,Học IELTS`;

    const before = await count('SELECT COUNT(*) AS n FROM audit_log');
    const preview = await command('u-huy', 'importContractLearners', { contractId: contract.id, csv, commit: false });
    expect(preview.status, JSON.stringify(preview.json)).toBe(200);
    expect(preview.json.data.committed).toBe(false);
    expect(preview.json.data.create).toHaveLength(2);
    expect(preview.json.data.errors).toEqual([{ line: 4, message: 'Khách đang do sale khác giữ' }]);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE pipeline = 'learner'")).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM audit_log')).toBe(before);

    const commit = await command('u-huy', 'importContractLearners', { contractId: contract.id, csv, commit: true });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(commit.json.data).toMatchObject({ committed: true });
    expect(commit.json.data.errors).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE pipeline = 'learner' AND partner_contract_id = ?", contract.id)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE pipeline = 'learner' AND owner_user_id = 'u-huy' AND source = 'partner'")).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM task WHERE title = 'Liên hệ học viên đối tác' AND assignee_user_id = 'u-huy'")).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM lead_step s JOIN lead l ON l.id = s.lead_id WHERE l.partner_contract_id = ?", contract.id)).toBe(16);

    const detail = (await get('u-lan', `/partners/${contract.id}`)).json.data;
    expect(detail.learners).toHaveLength(2);
    expect(detail.learners.every((l: any) => l.phone === null)).toBe(true);
    expect((await get('u-huy', `/partners/${contract.id}`)).json.data.learners.map((l: any) => l.phone).sort()).toEqual(['0988111222', '0988333444']);
  });

  test('CSV import reports bad rows, repeated phones in the file and a draft contract', async () => {
    const draft = await makeContract('draft');
    expect((await command('u-lan', 'importContractLearners', { contractId: draft.id, csv: `${header}\nA,0988111222,,`, commit: false })).status).toBe(422);
    const contract = await makeContract('active');
    const csv = `${header}\n,0988111222,,x\nB,12,,x\nC,0988333444,not-an-email,x\nD,0988555666,,x\nE,0988 555 666,,x\nF,,,x`;
    const r = await command('u-lan', 'importContractLearners', { contractId: contract.id, csv, commit: true });
    expect(r.status).toBe(200);
    expect(r.json.data.create.map((c: any) => c.name)).toEqual(['D']);
    expect(r.json.data.errors.map((e: any) => e.line)).toEqual([2, 3, 4, 6, 7]);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE partner_contract_id = ?", contract.id)).toBe(1);
    const missingColumn = await command('u-lan', 'importContractLearners', { contractId: contract.id, csv: 'Họ tên,Email\nA,a@example.com', commit: false });
    expect(missingColumn.json.data.errors[0].message).toContain('Thiếu cột');
    // Admin has to name the holder, as for a single lead.
    expect((await command('u-admin', 'importContractLearners', { contractId: contract.id, csv: `${header}\nG,0988777888,,`, commit: false })).status).toBe(422);
  });
});
