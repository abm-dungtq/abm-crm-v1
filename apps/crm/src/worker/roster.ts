import { foldText, normalizeEmail, type RoleCode } from '@abm/contracts';
import { z } from 'zod';
import type { Actor } from './env';

// Measured on the free plan: a 200-row commit (with temporary passwords) completes; larger files are split.
export const ROSTER_MAX_ROWS = 200;
export const ROSTER_MAX_CHARS = 512_000;

export interface RosterRow {
  line: number;
  name: string;
  email: string;
  departmentName: string | null;
  teamName: string | null;
  role: RoleCode;
}
export interface RowError { line: number | null; message: string }

// Template header (docs/guides/staff-roster-template.md), matched after folding case and diacritics.
const COLUMNS = { name: 'ho ten', email: 'email', department: 'phong ban', team: 'nhom', role: 'vai tro' } as const;
const COLUMN_LABEL = { name: 'Họ tên', email: 'Email', department: 'Phòng ban', team: 'Nhóm', role: 'Vai trò' } as const;

const ROLE_ALIASES: Record<string, RoleCode> = {
  sale: 'sale', 'nhan vien kinh doanh': 'sale',
  leader: 'leader', 'truong nhom': 'leader',
  'truong phong': 'head',
  bgd: 'director', 'ban giam doc': 'director', 'giam doc': 'director',
  admin: 'admin', 'quan tri': 'admin',
  'hoc vu': 'academic', academic: 'academic',
  'to chuc': 'academic', 'to chuc (quan ly hoc vien)': 'academic',
  'giao vien': 'teacher', teacher: 'teacher',
  'ke toan': 'accountant', accountant: 'accountant',
};
export const parseRole = (value: string): RoleCode | null => ROLE_ALIASES[foldText(value)] ?? null;

const emailSchema = z.email();

/** Which placement each role needs; null when valid. */
export function placementError(role: RoleCode, department: string | null, team: string | null): string | null {
  if (role === 'sale' || role === 'leader') {
    if (!department || !team) return 'Sale và Leader cần cả Phòng ban và Nhóm';
  } else if (role === 'head') {
    if (!department) return 'Trưởng phòng cần Phòng ban';
    if (team) return 'Trưởng phòng để trống Nhóm';
  } else if (department || team) {
    return 'BGĐ, Admin, Tổ chức, Giáo viên và Kế toán để trống Phòng ban và Nhóm';
  }
  return null;
}

/** RFC 4180 records; quoted cells may hold delimiters, quotes ("") and line breaks. */
export function readRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { record.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(cell); records.push(record); record = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || record.length) { record.push(cell); records.push(record); }
  return records.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Excel saves CSV with `,` or, under Vietnamese regional settings, `;`. */
export function detectDelimiter(headerLine: string) {
  const counts = [',', ';', '\t'].map((d) => [d, headerLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

export function parseRosterCsv(input: string): { rows: RosterRow[]; errors: RowError[] } {
  const text = input.replace(/^﻿/, '');
  if (text.length > ROSTER_MAX_CHARS) return { rows: [], errors: [{ line: null, message: 'File quá lớn (tối đa 500 KB)' }] };
  const records = readRecords(text, detectDelimiter(text.split(/\r?\n/, 1)[0] ?? ''));
  if (!records.length) return { rows: [], errors: [{ line: null, message: 'File không có dữ liệu' }] };
  const header = records[0]!.map(foldText);
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([key, label]) => [key, header.indexOf(label)])) as Record<keyof typeof COLUMNS, number>;
  const missing = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => index[k] < 0).map((k) => COLUMN_LABEL[k]);
  if (missing.length) return { rows: [], errors: [{ line: null, message: `Thiếu cột: ${missing.join(', ')}` }] };
  if (records.length - 1 > ROSTER_MAX_ROWS) return { rows: [], errors: [{ line: null, message: `Tối đa ${ROSTER_MAX_ROWS} nhân viên mỗi lần nhập; chia thành nhiều file` }] };

  const rows: RosterRow[] = [];
  const errors: RowError[] = [];
  const firstLineOfEmail = new Map<string, number>();
  records.slice(1).forEach((record, i) => {
    const line = i + 2;
    const cell = (k: keyof typeof COLUMNS) => (record[index[k]] ?? '').trim().replace(/\s+/g, ' ');
    const name = cell('name');
    const email = normalizeEmail(cell('email'));
    const departmentName = cell('department') || null;
    const teamName = cell('team') || null;
    const role = parseRole(cell('role'));
    const problems: string[] = [];
    if (!name) problems.push('Thiếu Họ tên');
    else if (name.length > 120) problems.push('Họ tên quá dài');
    if (!email) problems.push('Thiếu Email');
    else if (!emailSchema.safeParse(email).success || email.length > 160) problems.push('Email không hợp lệ');
    else if (firstLineOfEmail.has(email)) problems.push(`Email trùng với dòng ${firstLineOfEmail.get(email)}`);
    else firstLineOfEmail.set(email, line);
    if (!role) problems.push(`Vai trò không hợp lệ: "${cell('role')}"`);
    else {
      const placement = placementError(role, departmentName, teamName);
      if (placement) problems.push(placement);
    }
    if (problems.length) errors.push(...problems.map((message) => ({ line, message })));
    else rows.push({ line, name, email, departmentName, teamName, role: role! });
  });
  return { rows, errors };
}

interface UserRecord {
  id: string; email: string; display_name: string; role: RoleCode; department_id: string | null; team_id: string | null; version: number;
}
export interface PlannedUser extends RosterRow {
  action: 'create' | 'update' | 'unchanged';
  userId: string | null;
  version: number | null;
  departmentKey: string | null;
  teamKey: string | null;
  changes: string[];
  previous: { name: string; role: RoleCode; departmentId: string | null; teamId: string | null } | null;
}
export interface RosterPlan {
  users: PlannedUser[];
  errors: RowError[];
  newDepartments: { key: string; name: string }[];
  newTeams: { key: string; departmentKey: string; departmentName: string; name: string }[];
  counts: { create: number; update: number; unchanged: number };
  /** Existing department/team ids by key, so commit can resolve new and old placements alike. */
  departmentIds: Record<string, string>;
  teamIds: Record<string, string>;
}

/** Compares parsed rows with the organization's current users, departments and teams. Read-only. */
export async function planRoster(db: D1Database, actor: Actor, rows: RosterRow[], errors: RowError[]): Promise<RosterPlan> {
  const [departments, teams, users] = await Promise.all([
    db.prepare('SELECT id, name FROM department WHERE organization_id = ?').bind(actor.organizationId).all<{ id: string; name: string }>(),
    db.prepare('SELECT t.id, t.name, t.department_id FROM team t JOIN department d ON d.id = t.department_id WHERE d.organization_id = ?')
      .bind(actor.organizationId).all<{ id: string; name: string; department_id: string }>(),
    db.prepare('SELECT id, email, display_name, role, department_id, team_id, version FROM app_user WHERE organization_id = ?')
      .bind(actor.organizationId).all<UserRecord>(),
  ]);
  const departmentIds: Record<string, string> = {};
  for (const d of departments.results) departmentIds[foldText(d.name)] = d.id;
  const teamIds: Record<string, string> = {};
  const deptKeyById = Object.fromEntries(Object.entries(departmentIds).map(([k, id]) => [id, k]));
  for (const t of teams.results) teamIds[`${deptKeyById[t.department_id]}/${foldText(t.name)}`] = t.id;
  const byEmail = new Map(users.results.map((u) => [normalizeEmail(u.email), u]));

  const newDepartments = new Map<string, { key: string; name: string }>();
  const newTeams = new Map<string, { key: string; departmentKey: string; departmentName: string; name: string }>();
  const planned: PlannedUser[] = [];
  const allErrors = [...errors];
  for (const row of rows) {
    const departmentKey = row.departmentName ? foldText(row.departmentName) : null;
    const teamKey = departmentKey && row.teamName ? `${departmentKey}/${foldText(row.teamName)}` : null;
    if (departmentKey && !departmentIds[departmentKey] && !newDepartments.has(departmentKey)) {
      newDepartments.set(departmentKey, { key: departmentKey, name: row.departmentName! });
    }
    if (teamKey && !teamIds[teamKey] && !newTeams.has(teamKey)) {
      newTeams.set(teamKey, { key: teamKey, departmentKey: departmentKey!, departmentName: row.departmentName!, name: row.teamName! });
    }
    const existing = byEmail.get(row.email);
    if (existing?.id === actor.id && existing.role !== row.role) {
      allErrors.push({ line: row.line, message: 'Không tự đổi vai trò của mình' });
      continue;
    }
    const changes: string[] = [];
    if (existing) {
      if (existing.display_name !== row.name) changes.push('Họ tên');
      if (existing.role !== row.role) changes.push('Vai trò');
      if ((existing.department_id ?? null) !== (departmentKey ? departmentIds[departmentKey] ?? `new:${departmentKey}` : null)) changes.push('Phòng ban');
      if ((existing.team_id ?? null) !== (teamKey ? teamIds[teamKey] ?? `new:${teamKey}` : null)) changes.push('Nhóm');
    }
    planned.push({
      ...row, departmentKey, teamKey, changes,
      action: !existing ? 'create' : changes.length ? 'update' : 'unchanged',
      userId: existing?.id ?? null, version: existing?.version ?? null,
      previous: existing ? { name: existing.display_name, role: existing.role, departmentId: existing.department_id, teamId: existing.team_id } : null,
    });
  }
  const count = (a: PlannedUser['action']) => planned.filter((u) => u.action === a).length;
  return {
    users: planned, errors: allErrors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    newDepartments: [...newDepartments.values()], newTeams: [...newTeams.values()],
    counts: { create: count('create'), update: count('update'), unchanged: count('unchanged') },
    departmentIds, teamIds,
  };
}
