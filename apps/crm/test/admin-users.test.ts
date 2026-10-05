import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import demoRoster from '../seed/demo-roster.csv?raw';
import app from '../src/worker/index';
import { hashPassword } from '../src/worker/password';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
beforeEach(() => resetDb(db, seedSql));

async function call(user: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: await res.json() as any, headers: res.headers };
}
const admin = (path: string, body?: unknown, method?: string) => call('u-admin', path, body, method);
const count = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;
const version = async (id: string) => count(`SELECT version AS n FROM app_user WHERE id = '${id}'`);
const HEADER = 'Họ tên,Email,Phòng ban,Nhóm,Vai trò';

async function passwordLogin(email: string, password: string) {
  const res = await app.fetch(new Request(`${ORIGIN}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }),
  }), { ...env, AUTH_MODE: 'password' });
  return { status: res.status, json: await res.json() as any, cookie: /abm_session=([^;]*)/.exec(res.headers.get('Set-Cookie') ?? '')?.[0] };
}

test('only admin reaches user management', async () => {
  for (const user of ['u-lan', 'u-hung', 'u-head', 'u-bgd']) {
    expect((await call(user, '/admin/roster/preview', { csv: demoRoster })).status).toBe(403);
    expect((await call(user, '/admin/users/u-lan/temp-password', { version: 1 })).status).toBe(403);
  }
});

test('preview shows what the demo roster would change without writing', async () => {
  const users = await count('SELECT COUNT(*) AS n FROM app_user');
  const r = await admin('/admin/roster/preview', { csv: demoRoster });
  expect(r.status).toBe(200);
  expect(r.json.data.errors).toEqual([]);
  expect(r.json.data.counts).toEqual({ create: 3, update: 0, unchanged: 8 });
  expect(r.json.data.newDepartments).toEqual(['Phòng Chăm sóc khách hàng']);
  expect(r.json.data.newTeams).toEqual([{ departmentName: 'Phòng Kinh doanh', name: 'Kinh doanh 3' }]);
  expect(await count('SELECT COUNT(*) AS n FROM app_user')).toBe(users);
});

test('commit creates users with one-time temporary passwords; re-import changes nothing', async () => {
  const r = await admin('/admin/roster/commit', { csv: demoRoster });
  expect(r.status).toBe(200);
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(r.json.data.counts.create).toBe(3);
  expect(r.json.data.tempPasswords).toHaveLength(3);
  expect(await count('SELECT COUNT(*) AS n FROM app_user')).toBe(11);
  const sale = await db.prepare(`SELECT u.role, t.name AS team, d.name AS dept, u.must_change_password AS mc FROM app_user u
    JOIN team t ON t.id = u.team_id JOIN department d ON d.id = u.department_id WHERE u.email = 'sale-moi@demo.abm.example'`).first<any>();
  expect(sale).toMatchObject({ role: 'sale', team: 'Kinh doanh 3', dept: 'Phòng Kinh doanh', mc: 1 });

  const audits = await count('SELECT COUNT(*) AS n FROM audit_log');
  const again = await admin('/admin/roster/commit', { csv: demoRoster });
  expect(again.json.data.counts).toEqual({ create: 0, update: 0, unchanged: 11 });
  expect(again.json.data.tempPasswords).toEqual([]);
  expect(await count('SELECT COUNT(*) AS n FROM audit_log')).toBe(audits);

  for (const t of r.json.data.tempPasswords) {
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE COALESCE(after_json,'') || COALESCE(before_json,'') LIKE '%${t.password}%'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM idempotency_key WHERE result_json LIKE '%${t.password}%'`)).toBe(0);
  }
  const issued = r.json.data.tempPasswords.find((t: any) => t.email === 'sale-moi@demo.abm.example');
  const login = await passwordLogin(issued.email, issued.password);
  expect(login.status).toBe(200);
  expect(login.json.data.mustChangePassword).toBe(true);
});

test('semicolon CSV reads like comma CSV, and changed rows become updates', async () => {
  const csv = `${HEADER.replaceAll(',', ';')}\r\n"Đỗ Ngọc Lan (đổi)";LAN@demo.abm.example;phòng kinh doanh;KINH DOANH 2;sale\r\n`;
  const r = await admin('/admin/roster/preview', { csv });
  expect(r.json.data.errors).toEqual([]);
  expect(r.json.data.counts).toEqual({ create: 0, update: 1, unchanged: 0 });
  expect(r.json.data.users[0].changes).toEqual(['Họ tên', 'Nhóm']);
  expect((await admin('/admin/roster/commit', { csv })).status).toBe(200);
  expect(await db.prepare("SELECT team_id, display_name FROM app_user WHERE id = 'u-lan'").first()).toEqual({ team_id: 'team-kd2', display_name: 'Đỗ Ngọc Lan (đổi)' });
});

test('invalid rows are reported per line and block the commit', async () => {
  const csv = [HEADER,
    'A,dup@demo.abm.example,,,BGĐ',
    'B,dup@demo.abm.example,,,BGĐ',
    'C,,,,BGĐ',
    'D,d@demo.abm.example,,,Bảo vệ',
    'E,e@demo.abm.example,Phòng Kinh doanh,,Sale',
    'F,f@demo.abm.example,Phòng Kinh doanh,,BGĐ',
  ].join('\n');
  const r = await admin('/admin/roster/preview', { csv });
  const lines = r.json.data.errors.map((e: any) => e.line);
  expect(lines).toEqual([3, 4, 5, 6, 7]);
  expect(r.json.data.errors.find((e: any) => e.line === 5).message).toContain('Vai trò');
  const users = await count('SELECT COUNT(*) AS n FROM app_user');
  const commit = await admin('/admin/roster/commit', { csv });
  expect(commit.status).toBe(422);
  expect(await count('SELECT COUNT(*) AS n FROM app_user')).toBe(users);
  expect((await admin('/admin/roster/preview', { csv: 'Tên,Mail\nA,a@x.vn' })).json.data.errors[0].message).toContain('Thiếu cột');
});

test('admin cannot lock or demote themself, and the last active admin stays', async () => {
  expect((await admin('/admin/users/u-admin/status', { version: await version('u-admin'), status: 'disabled' })).status).toBe(422);
  expect((await admin('/admin/users/u-admin', { version: await version('u-admin'), role: 'director' }, 'PATCH')).status).toBe(422);
  const roster = `${HEADER}\nQuản trị hệ thống,admin@demo.abm.example,,,BGĐ\n`;
  expect((await admin('/admin/roster/preview', { csv: roster })).json.data.errors[0].message).toContain('vai trò của mình');

  // A second admin can be locked while the first remains; the reverse would leave none.
  await admin('/admin/roster/commit', { csv: demoRoster });
  const second = await db.prepare("SELECT id, version FROM app_user WHERE email = 'admin2@demo.abm.example'").first<any>();
  expect((await admin(`/admin/users/${second.id}/status`, { version: second.version, status: 'disabled' })).status).toBe(200);
  await db.prepare("UPDATE app_user SET status = 'active' WHERE id = ?").bind(second.id).run();
  await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-admin'").run();
  // Only the second admin is active now; it is the last one and must not be locked or demoted by anyone.
  await db.prepare("UPDATE app_user SET status = 'active', role = 'admin' WHERE id = 'u-admin'").run();
  await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = ?").bind(second.id).run();
  const r = await admin(`/admin/users/${second.id}/status`, { version: await version(second.id), status: 'active' });
  expect(r.status).toBe(200);
  const lastCheck = await call(second.id, '/admin/users/u-admin', { version: await version('u-admin'), role: 'director' }, 'PATCH');
  expect(lastCheck.status).toBe(200);
  const blocked = await call(second.id, `/admin/users/${second.id}/status`, { version: await version(second.id), status: 'disabled' });
  expect(blocked.status).toBe(422);
  expect(await count("SELECT COUNT(*) AS n FROM app_user WHERE role = 'admin' AND status = 'active'")).toBe(1);
});

test('temporary password is returned once, never stored in plaintext, and works for login', async () => {
  const r = await admin('/admin/users/u-lan/temp-password', { version: await version('u-lan') });
  expect(r.status).toBe(200);
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  const { password } = r.json.data;
  expect(password).toHaveLength(12);
  expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE COALESCE(after_json,'') || COALESCE(before_json,'') LIKE '%${password}%'`)).toBe(0);
  expect(await count(`SELECT COUNT(*) AS n FROM idempotency_key WHERE result_json LIKE '%${password}%'`)).toBe(0);
  expect(await count(`SELECT COUNT(*) AS n FROM app_user WHERE password_hash LIKE '%${password}%'`)).toBe(0);
  const login = await passwordLogin('lan@demo.abm.example', password);
  expect(login.status).toBe(200);
  expect(login.json.data.mustChangePassword).toBe(true);
  // A stale version is refused rather than overwriting a concurrent change.
  expect((await admin('/admin/users/u-lan/temp-password', { version: 1 })).status).toBe(409);
});

test('locking a user revokes their open sessions', async () => {
  const p = await hashPassword('Lan-mat-khau-2026');
  await db.prepare('UPDATE app_user SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?').bind(p.hash, p.salt, p.iterations, 'u-lan').run();
  const login = await passwordLogin('lan@demo.abm.example', 'Lan-mat-khau-2026');
  expect(login.status).toBe(200);
  expect((await admin('/admin/users/u-lan/status', { version: await version('u-lan'), status: 'disabled' })).status).toBe(200);
  expect(await count("SELECT COUNT(*) AS n FROM user_session WHERE user_id = 'u-lan' AND revoked_at IS NULL")).toBe(0);
  expect((await admin('/admin/users/u-lan/status', { version: await version('u-lan'), status: 'active' })).status).toBe(200);
  const res = await app.fetch(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: login.cookie! } }), { ...env, AUTH_MODE: 'password' });
  expect(res.status).toBe(401);
});

test('editing a user validates placement and reports duplicate email', async () => {
  const v = await version('u-lan');
  expect((await admin('/admin/users/u-lan', { version: v, teamName: null }, 'PATCH')).status).toBe(422);
  expect((await admin('/admin/users/u-lan', { version: v, teamName: 'Nhóm chưa có' }, 'PATCH')).status).toBe(422);
  const dup = await admin('/admin/users/u-lan', { version: v, email: 'long@demo.abm.example' }, 'PATCH');
  expect(dup.status).toBe(422);
  expect(dup.json.error.message).toContain('Email đã dùng');
  const moved = await admin('/admin/users/u-lan', { version: v, role: 'leader', teamName: 'kinh doanh 2' }, 'PATCH');
  expect(moved.status).toBe(200);
  expect(await db.prepare("SELECT role, team_id FROM app_user WHERE id = 'u-lan'").first()).toEqual({ role: 'leader', team_id: 'team-kd2' });
  expect((await admin('/admin/users/u-lan', { version: v, name: 'Cũ' }, 'PATCH')).status).toBe(409);
});
