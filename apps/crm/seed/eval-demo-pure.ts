import { posix, win32, type PlatformPath } from 'node:path';

/** Workers expose a POSIX default path. Drive-letter paths still need Windows rules. */
function pathApi(filePath: string, repoRoot: string): PlatformPath {
  const windows = /^[A-Za-z]:[\\/]/.test(filePath) || /^[A-Za-z]:[\\/]/.test(repoRoot) || filePath.startsWith('\\\\') || repoRoot.startsWith('\\\\');
  return windows ? win32 : posix;
}

/** Slot token -> role. Substitutions and the remote user list come only from these keys. */
export const SLOT_ROLES = {
  'slot-admin-1': 'admin',
  'slot-sale-1': 'sale',
  'slot-sale-2': 'sale',
  'slot-sale-3': 'sale',
  'slot-leader-1': 'leader',
  'slot-leader-2': 'leader',
  'slot-head-1': 'head',
  'slot-academic-1': 'academic',
  'slot-teacher-1': 'teacher',
  'slot-teacher-2': 'teacher',
  'slot-accountant-1': 'accountant',
} as const;

export type Slot = keyof typeof SLOT_ROLES;

/** Sale and leader slots, and the team key their app_user.team_id must equal. */
export const SLOT_TEAM_KEY: Partial<Record<Slot, 'kd1' | 'kd2'>> = {
  'slot-sale-1': 'kd1',
  'slot-sale-2': 'kd2',
  'slot-sale-3': 'kd2',
  'slot-leader-1': 'kd1',
  'slot-leader-2': 'kd2',
};

export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * B2B working-hour dates and the learner timeline are both anchored at generation
 * time. First-contact SLA is 4 working hours, so a sample older than 60 minutes is stale.
 */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/** Business tables the loader requires to be empty. outbox and idempotency_key are omitted. */
export const BUSINESS_EMPTY_TABLES = [
  'privacy_request', 'payment_allocation', 'payment', 'charge', 'attendance', 'trial_booking',
  'enrollment', 'class_session', 'class_teacher', 'class_group', 'course', 'consent', 'customer_product',
  'product', 'approval', 'activity', 'task', 'lead_step', 'lead',
  'partner_contract_step', 'partner_contract', 'contact_point', 'account_contact', 'contact', 'account', '_guard',
] as const;

/** audit_log rows that still belong to demo data. Other audit rows are not part of the empty check. */
export const DEMO_AUDIT_WHERE = "id LIKE 'demo-%' OR entity_id LIKE 'demo-%'";

export const BACKUP_PRIVACY_WARNING = '--backup-file contains all staff emails and session rows and must be kept private';

const ORG_BOUND_ROLES = new Set(['admin', 'academic', 'teacher', 'accountant']);

export const REGENERATE_COMMANDS = [
  'node seed/generate-demo-seed.mjs --demo-eval',
  'set DEMO_EXPORT=1&& pnpm exec vitest run test/demo-learner-generate.test.ts -u',
].join('\n');

const TOP_KEYS = new Set(['organizationId', 'department', 'teams', 'users']);
const TEAM_KEYS = ['kd1', 'kd2'] as const;

export interface EvalDemoMap {
  organizationId: string;
  departmentId: string;
  teams: { kd1: string; kd2: string };
  users: Record<Slot, string>;
  replacements: [string, string][];
}

export interface StaffRow {
  id: string;
  role: string;
  status: string;
  team_id: string | null;
  department_id: string | null;
  organization_id: string;
}

export interface SampleTargetCounts {
  tables: Readonly<Record<string, number>>;
  leadCounterRows: number;
  leadNext: number | null;
  feeCounterRows: number;
  demoAuditRows: number;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must match ${ID_PATTERN}`);
  }
  return value;
}

/** Reject unknown or invalid keys before any value can reach SQL. */
export function parseMap(input: unknown): EvalDemoMap {
  const root = asRecord(input, 'map');
  for (const key of Object.keys(root)) {
    if (!TOP_KEYS.has(key)) throw new Error(`Unknown map key ${key}`);
  }
  const organizationId = requireId(root.organizationId, 'organizationId');
  const departmentId = requireId(root.department, 'department');
  const teamRecord = asRecord(root.teams, 'teams');
  for (const key of Object.keys(teamRecord)) {
    if (key !== 'kd1' && key !== 'kd2') throw new Error(`Unknown team key ${key}`);
  }
  const teams = {
    kd1: requireId(teamRecord.kd1, 'teams.kd1'),
    kd2: requireId(teamRecord.kd2, 'teams.kd2'),
  };
  const userRecord = asRecord(root.users, 'users');
  for (const key of Object.keys(userRecord)) {
    if (!(key in SLOT_ROLES)) throw new Error(`Unknown user slot ${key}`);
  }
  const users = {} as Record<Slot, string>;
  for (const slot of Object.keys(SLOT_ROLES) as Slot[]) {
    users[slot] = requireId(userRecord[slot], `users.${slot}`);
  }
  assertUniqueSaleLeader(users);
  assertDistinctTeachers(users);
  const replacements: [string, string][] = [
    ...(Object.keys(SLOT_ROLES) as Slot[]).map((slot) => [slot, users[slot]] as [string, string]),
    ['team-kd1', teams.kd1],
    ['team-kd2', teams.kd2],
    ['dep-kd', departmentId],
    ['org-abm', organizationId],
  ];
  replacements.sort((a, b) => b[0].length - a[0].length || b[0].localeCompare(a[0]));
  for (const key of TEAM_KEYS) requireId(teams[key], `teams.${key}`);
  return { organizationId, departmentId, teams, users, replacements };
}

/** Ids in SLOT_ROLES order. Every id was already checked against ID_PATTERN. */
export function userIdsInSlotOrder(map: EvalDemoMap): string[] {
  return (Object.keys(SLOT_ROLES) as Slot[]).map((slot) => map.users[slot]);
}

/** Quote ids for a SQL IN list. Refuses anything that did not pass ID_PATTERN. */
export function sqlIdList(ids: string[]): string {
  return ids.map((id) => {
    if (!ID_PATTERN.test(id)) throw new Error('Refusing to interpolate an unvalidated id');
    return `'${id}'`;
  }).join(', ');
}

export function substituteSql(sql: string, replacements: readonly [string, string][]): string {
  let next = sql;
  for (const [token, value] of replacements) {
    if (!ID_PATTERN.test(value)) throw new Error(`Refusing to substitute unvalidated value for ${token}`);
    next = next.replaceAll(token, value);
  }
  return next;
}

export function withDeferredForeignKeys(sql: string): string {
  const firstCode = sql.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('--'));
  if (firstCode?.startsWith('PRAGMA defer_foreign_keys')) return sql;
  return `PRAGMA defer_foreign_keys = ON;\n${sql}`;
}

/** Slot, team, or department tokens still present after substitution. */
export function leftoverTokens(sql: string, organizationId: string, mappedToSelf: readonly string[] = []): string[] {
  const found: string[] = [];
  const slot = /slot-[A-Za-z0-9-]+/.exec(sql);
  if (slot?.[0]) found.push(slot[0]);
  for (const token of ['team-kd1', 'team-kd2', 'dep-kd']) {
    if (!mappedToSelf.includes(token) && sql.includes(token)) found.push(token);
  }
  if (organizationId !== 'org-abm' && sql.includes('org-abm')) found.push('org-abm');
  return found;
}

export function generatedAtMillis(sql: string): number | null {
  const match = /^-- generated-at: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s*$/m.exec(sql);
  if (!match?.[1]) return null;
  const value = Date.parse(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function freshness(input: {
  stamps: (number | null)[];
  now: number;
  check: boolean;
  apply: boolean;
  allowStale: boolean;
}): { action: 'ok' | 'warn' | 'refuse'; message: string } {
  const remote = input.check || input.apply;
  if (input.allowStale && remote) {
    return {
      action: 'refuse',
      message: `--allow-stale is only valid for a dry run.\nRegenerate from apps/crm:\n${REGENERATE_COMMANDS}`,
    };
  }
  const stale = input.stamps.some((stamp) => stamp === null || input.now - stamp > STALE_AFTER_MS);
  if (!stale) return { action: 'ok', message: '' };
  const message = `Sample SQL is older than 60 minutes. Regenerate from apps/crm:\n${REGENERATE_COMMANDS}`;
  return remote ? { action: 'refuse', message } : { action: 'warn', message };
}

/** Problems that block a sample load. Empty means the documented cleanup left a loadable target. */
export function sampleTargetProblems(counts: SampleTargetCounts): string[] {
  const problems: string[] = [];
  for (const table of BUSINESS_EMPTY_TABLES) {
    const n = Number(counts.tables[table] ?? 0);
    if (n !== 0) problems.push(`${table} is not empty (${n})`);
  }
  if (Number(counts.demoAuditRows) !== 0) problems.push(`audit_log still has demo rows (${counts.demoAuditRows})`);
  if (Number(counts.leadCounterRows) !== 1 || Number(counts.leadNext) !== 1) {
    problems.push('lead_counter must be exactly one row with next_value 1');
  }
  if (Number(counts.feeCounterRows) !== 0) problems.push('fee_counter must have no row');
  return problems;
}

export function assertBackupNotExists(exists: boolean): void {
  if (exists) throw new Error('Refusing to overwrite an existing backup file');
}

function assertUniqueSaleLeader(users: Record<Slot, string>): void {
  const seen = new Map<string, Slot>();
  for (const slot of Object.keys(SLOT_ROLES) as Slot[]) {
    if (SLOT_ROLES[slot] !== 'sale' && SLOT_ROLES[slot] !== 'leader') continue;
    const previous = seen.get(users[slot]);
    if (previous) throw new Error(`Slots ${previous} and ${slot} map to the same user`);
    seen.set(users[slot], slot);
  }
}

function assertDistinctTeachers(users: Record<Slot, string>): void {
  if (users['slot-teacher-1'] === users['slot-teacher-2']) {
    throw new Error('Slots slot-teacher-1 and slot-teacher-2 map to the same user');
  }
}

/** Teacher slots accept a teacher or an admin. Head accepts a head or an admin. */
const ACCEPTED_ROLES: Partial<Record<Slot, readonly string[]>> = {
  'slot-teacher-1': ['teacher', 'admin'],
  'slot-teacher-2': ['teacher', 'admin'],
  'slot-head-1': ['head', 'admin'],
};

function acceptedRoles(slot: Slot): readonly string[] {
  return ACCEPTED_ROLES[slot] ?? [SLOT_ROLES[slot]];
}

/** True when the resolved path is not the repo root and not inside it. */
export function isOutsideRepo(filePath: string, repoRoot: string): boolean {
  const api = pathApi(filePath, repoRoot);
  const rel = api.relative(api.resolve(repoRoot), api.resolve(filePath));
  if (rel === '') return false;
  if (api.isAbsolute(rel)) return true;
  return rel === '..' || rel.startsWith(`..${api.sep}`);
}

export function assertOutsideRepo(filePath: string, repoRoot: string, label: string): string {
  if (!filePath || filePath.startsWith('-') || /[\r\n\0]/.test(filePath)) {
    throw new Error(`${label} must be a path outside the repository`);
  }
  const api = pathApi(filePath, repoRoot);
  const absolute = api.resolve(filePath);
  if (!isOutsideRepo(absolute, repoRoot)) {
    throw new Error(`${label} must live outside the repository: ${absolute}`);
  }
  return absolute;
}

export function assertStaffPlacement(input: {
  users: StaffRow[];
  teams: { id: string; department_id: string }[];
  department: { id: string; organization_id: string } | null;
  map: EvalDemoMap;
}): void {
  const byId = new Map(input.users.map((row) => [row.id, row]));
  for (const [slot, role] of Object.entries(SLOT_ROLES) as [Slot, string][]) {
    const row = byId.get(input.map.users[slot]);
    if (!row) throw new Error(`Mapped user for ${slot} does not exist`);
    if (row.status !== 'active') throw new Error(`Mapped user for ${slot} is not active`);
    const allowed = acceptedRoles(slot);
    if (!allowed.includes(row.role)) {
      throw new Error(`Mapped user for ${slot} has role ${row.role}, expected ${allowed.join(' or ')}`);
    }
    if (ORG_BOUND_ROLES.has(role) && row.organization_id !== input.map.organizationId) {
      throw new Error(`Mapped user for ${slot} is not in the mapped organization`);
    }
    const teamKey = SLOT_TEAM_KEY[slot];
    if (teamKey && row.team_id !== input.map.teams[teamKey]) {
      throw new Error(`Mapped user for ${slot} is on team ${row.team_id ?? 'none'}, expected ${input.map.teams[teamKey]}`);
    }
  }
  const head = byId.get(input.map.users['slot-head-1']);
  if (head && head.role !== 'admin' && head.department_id !== input.map.departmentId) {
    throw new Error('Head user is not in the mapped department');
  }
  const teamsById = new Map(input.teams.map((row) => [row.id, row]));
  for (const key of TEAM_KEYS) {
    const team = teamsById.get(input.map.teams[key]);
    if (!team) throw new Error(`Mapped team ${key} does not exist`);
    if (team.department_id !== input.map.departmentId) {
      throw new Error(`Mapped team ${key} is not in the mapped department`);
    }
  }
  if (!input.department || input.department.id !== input.map.departmentId) {
    throw new Error('Mapped department does not exist');
  }
  if (input.department.organization_id !== input.map.organizationId) {
    throw new Error('Mapped department is not in the mapped organization');
  }
}
