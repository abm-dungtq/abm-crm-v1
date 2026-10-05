import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
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
const count = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;

const addUser = (id: string, role: string) => db.prepare(`INSERT INTO app_user (id, organization_id, display_name, email, role, created_at, updated_at)
  VALUES (?, 'org-abm', ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).bind(id, `User ${id}`, `${id}@test.example`, role).run();

describe('table rebuild keeps existing data', () => {
  test('rows and foreign keys survive migrating a populated database', async () => {
    const existing = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
      .all<{ name: string }>()).results;
    await db.batch([db.prepare('PRAGMA defer_foreign_keys = ON'), ...existing.map((t) => db.prepare(`DROP TABLE IF EXISTS "${t.name}"`))]);

    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0006'));
    // The seed also fills tables added by later migrations; only replay rows whose table exists yet.
    const oldTables = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((t) => t.name));
    const oldSeed = seedSql.split('\n').filter((line) => oldTables.has(/^INSERT (?:OR \w+ )?INTO "?(\w+)/.exec(line)?.[1] ?? ''));
    await db.batch(oldSeed.map((line) => db.prepare(line)));
    const before = {
      users: await count('SELECT COUNT(*) AS n FROM app_user'),
      leads: await count('SELECT COUNT(*) AS n FROM lead'),
      tasks: await count('SELECT COUNT(*) AS n FROM task'),
      activities: await count('SELECT COUNT(*) AS n FROM activity'),
    };
    expect(before.users).toBeGreaterThan(0);
    expect(before.leads).toBeGreaterThan(0);
    expect(before.tasks).toBeGreaterThan(0);
    expect(before.activities).toBeGreaterThan(0);

    await applyD1Migrations(db, env.TEST_MIGRATIONS);

    expect({
      users: await count('SELECT COUNT(*) AS n FROM app_user'),
      leads: await count('SELECT COUNT(*) AS n FROM lead'),
      tasks: await count('SELECT COUNT(*) AS n FROM task'),
      activities: await count('SELECT COUNT(*) AS n FROM activity'),
    }).toEqual(before);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    const pipelines = (await db.prepare('SELECT DISTINCT pipeline FROM lead').all<{ pipeline: string }>()).results.map((r) => r.pipeline);
    expect(pipelines).toEqual(['b2b']);
  });
});

describe('learner foundation', () => {
  beforeEach(() => resetDb(db, seedSql));

  test('the three new roles can be stored on a user', async () => {
    await addUser('u-academic', 'academic');
    await addUser('u-teacher', 'teacher');
    await addUser('u-accountant', 'accountant');
    expect(await count("SELECT COUNT(*) AS n FROM app_user WHERE role IN ('academic', 'teacher', 'accountant')")).toBe(3);
    await expect(addUser('u-bad', 'wizard')).rejects.toThrow(/constraint/i);
  });

  test('existing B2B leads are on the b2b pipeline', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM lead')).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM lead WHERE pipeline <> 'b2b'")).toBe(0);
  });

  test('the new roles read no B2B leads', async () => {
    for (const [id, role] of [['u-academic', 'academic'], ['u-teacher', 'teacher'], ['u-accountant', 'accountant']] as const) {
      await addUser(id, role);
      const r = await call(id, 'GET', '/leads');
      expect(r.status, role).toBe(200);
      expect(r.json.data, role).toEqual([]);
    }
  });

  describe('products', () => {
    const product = { name: 'Khóa IELTS 6.5', description: 'Lớp tối', priceVnd: 12_000_000, active: true };

    test('Tổ chức and Admin can edit the catalogue; Sale cannot', async () => {
      await addUser('u-academic', 'academic');
      const created = await command('u-academic', 'upsertProduct', product);
      expect(created.status).toBe(200);
      const id = created.json.data.id as string;
      expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'product' AND entity_id = '${id}'`)).toBe(1);

      const renamed = await command('u-admin', 'upsertProduct', { ...product, id, version: 1, name: 'Khóa IELTS 7.0' });
      expect(renamed.status).toBe(200);
      const row = await db.prepare('SELECT name, version FROM product WHERE id = ?').bind(id).first<{ name: string; version: number }>();
      expect(row).toEqual({ name: 'Khóa IELTS 7.0', version: 2 });

      const stale = await command('u-admin', 'upsertProduct', { ...product, id, version: 1 });
      expect(stale.status).toBe(409);

      const denied = await command('u-lan', 'upsertProduct', product);
      expect(denied.status).toBe(403);
      expect(denied.json.error?.code).toBe('FORBIDDEN');
      expect(await count('SELECT COUNT(*) AS n FROM product')).toBe(1);
    });

    test('negative prices are rejected', async () => {
      const r = await command('u-admin', 'upsertProduct', { ...product, priceVnd: -1 });
      expect(r.status).toBe(422);
    });

    test('Sale and Leader see only active products; the teacher role is refused', async () => {
      await addUser('u-teacher', 'teacher');
      await addUser('u-accountant', 'accountant');
      await command('u-admin', 'upsertProduct', product);
      await command('u-admin', 'upsertProduct', { ...product, name: 'Khóa cũ', active: false });
      const names = async (user: string) => ((await call(user, 'GET', '/products')).json.data as { name: string }[]).map((p) => p.name);
      expect(await names('u-lan')).toEqual(['Khóa IELTS 6.5']);
      expect(await names('u-hung')).toEqual(['Khóa IELTS 6.5']);
      expect(await names('u-accountant')).toEqual(['Khóa IELTS 6.5', 'Khóa cũ']);
      const teacher = await call('u-teacher', 'GET', '/products');
      expect(teacher.status).toBe(403);
    });
  });

  describe('consent', () => {
    const latest = (contactId: string, purpose: string) => db.prepare(`SELECT granted FROM consent WHERE contact_id = ? AND purpose = ?
      ORDER BY recorded_at DESC, rowid DESC LIMIT 1`).bind(contactId, purpose).first<{ granted: number }>();

    beforeEach(() => db.prepare("UPDATE contact SET owner_user_id = 'u-lan' WHERE id = 'ct-1'").run());

    test('the newest row per purpose is the current state', async () => {
      const grant = await command('u-lan', 'recordConsent', { contactId: 'ct-1', purpose: 'marketing', granted: true });
      expect(grant.status).toBe(200);
      expect((await latest('ct-1', 'marketing'))?.granted).toBe(1);

      const withdraw = await command('u-lan', 'recordConsent', { contactId: 'ct-1', purpose: 'marketing', granted: false, note: 'Khách từ chối' });
      expect(withdraw.status).toBe(200);
      expect((await latest('ct-1', 'marketing'))?.granted).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM consent WHERE contact_id = 'ct-1'")).toBe(2);
      expect(await latest('ct-1', 'image')).toBeNull();
    });

    test('Leader of the owner team and Admin may record; another Sale and non-admissions roles may not', async () => {
      const body = { contactId: 'ct-1', purpose: 'enrollment', granted: true };
      expect((await command('u-hung', 'recordConsent', body)).status).toBe(200);
      expect((await command('u-admin', 'recordConsent', body)).status).toBe(200);
      const other = await command('u-huy', 'recordConsent', body);
      expect(other.status).toBe(403);
      expect(other.json.error?.code).toBe('FORBIDDEN');
      await addUser('u-academic', 'academic');
      expect((await command('u-academic', 'recordConsent', body)).status).toBe(403);
      expect((await command('u-lan', 'recordConsent', { ...body, contactId: 'no-such-contact' })).status).toBe(404);
      expect((await command('u-lan', 'recordConsent', { ...body, purpose: 'unknown' })).status).toBe(422);
    });
  });

  describe('staff roster and user admin', () => {
    const HEADER = 'Họ tên,Email,Phòng ban,Nhóm,Vai trò';

    test('a roster row for Kế toán needs no department', async () => {
      const csv = `${HEADER}\nThanh,thanh@test.example,,,Kế toán\nHằng,hang@test.example,,,Học vụ\nDũng,dung@test.example,,,Giáo viên`;
      const r = await call('u-admin', 'POST', '/admin/roster/preview', { csv });
      expect(r.status).toBe(200);
      expect(r.json.data.errors).toEqual([]);
      expect(r.json.data.counts.create).toBe(3);
    });

    test('a roster row for Kế toán with a department is refused', async () => {
      const csv = `${HEADER}\nThanh,thanh@test.example,Phòng Kinh doanh,,Kế toán`;
      const r = await call('u-admin', 'POST', '/admin/roster/preview', { csv });
      expect(r.json.data.errors).toHaveLength(1);
    });

    test('Admin can move a user to the teacher role', async () => {
      const user = await db.prepare("SELECT version FROM app_user WHERE id = 'u-lan'").first<{ version: number }>();
      const r = await call('u-admin', 'PATCH', '/admin/users/u-lan', { version: user!.version, role: 'teacher', departmentName: null, teamName: null });
      expect(r.status).toBe(200);
      expect((await db.prepare("SELECT role, team_id FROM app_user WHERE id = 'u-lan'").first<{ role: string; team_id: string | null }>()))
        .toEqual({ role: 'teacher', team_id: null });
    });
  });
});
