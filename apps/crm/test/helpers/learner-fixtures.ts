import { env } from 'cloudflare:test';
import { expect } from 'vitest';
import app from '../../src/worker/index';

const ORIGIN = 'http://crm.test';
export type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string> } };

export const db = env.DB;

export async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}

export const command = (user: string, name: string, body: unknown) => call(user, 'POST', `/commands/${name}`, body);
export const get = (user: string, path: string) => call(user, 'GET', path);
export const leadVersion = async (leadId: string) => (await db.prepare('SELECT version FROM lead WHERE id = ?').bind(leadId).first<{ version: number }>())!.version;

export const addUser = (id: string, role: string) => db.prepare(`INSERT INTO app_user (id, organization_id, display_name, email, role, created_at, updated_at)
  VALUES (?, 'org-abm', ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).bind(id, `User ${id}`, `${id}@test.example`, role).run();

const nextAction = () => ({ title: 'Gọi lần đầu', dueAt: new Date(Date.now() + 86_400_000).toISOString() });

async function makeProduct() {
  const r = await command('u-academic', 'upsertProduct', { name: 'Khóa IELTS', priceVnd: 8_000_000, active: true });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.data.id as string;
}

export async function makeClass(name = 'Lớp A') {
  const productId = await makeProduct();
  const course = await command('u-academic', 'upsertCourse', { productId, name: 'IELTS 6.5', status: 'active' });
  expect(course.status, JSON.stringify(course.json)).toBe(200);
  const klass = await command('u-academic', 'upsertClass', { courseId: course.json.data.id, name, scheduleText: 'Tối 3-5', status: 'open' });
  expect(klass.status, JSON.stringify(klass.json)).toBe(200);
  return { productId, courseId: course.json.data.id as string, classId: klass.json.data.id as string, classVersion: klass.json.data.version as number };
}

export async function walk(user: string, leadId: string, steps: string[]) {
  for (const stepCode of steps) {
    const r = await command(user, 'markJourneyStep', { leadId, expectedVersion: await leadVersion(leadId), stepCode });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
}

export async function makeLead(name: string, phone: string, user = 'u-lan') {
  const created = await command(user, 'createLearnerLead', {
    contactName: name, phone, source: 'facebook', needSummary: 'Học IELTS', nextAction: nextAction(),
  });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  return created.json.data as { leadId: string; contactId: string };
}

export async function winLead(name: string, phone: string) {
  const { leadId, contactId } = await makeLead(name, phone);
  await walk('u-lan', leadId, ['contacted', 'need_confirmed']);
  const skipped = await command('u-lan', 'skipTrial', { leadId, expectedVersion: await leadVersion(leadId), reason: 'Đã học thử nơi khác' });
  expect(skipped.status, JSON.stringify(skipped.json)).toBe(200);
  const won = await command('u-lan', 'winLearnerLead', { leadId, expectedVersion: await leadVersion(leadId), note: 'Chốt' });
  expect(won.status, JSON.stringify(won.json)).toBe(200);
  return { leadId, contactId };
}

export async function reserve(leadId: string, classId: string) {
  const r = await command('u-lan', 'reserveSeat', { leadId, expectedVersion: await leadVersion(leadId), classId });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.data.id as string;
}

export const grantConsent = (contactId: string) => command('u-lan', 'recordConsent', { contactId, purpose: 'enrollment', granted: true });
