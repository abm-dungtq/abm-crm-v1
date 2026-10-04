import {
  ACTIVE_STAGES, FIRST_CONTACT_SLA_HOURS, RELEASE_AFTER_HOURS, STAGES, allowedTransitions, foldText, normalizePhone,
  workingDaysBetween, workingMinutesBetween, type StageCode,
} from '@abm/contracts';
import type { Actor } from './env';
import { leadScope, mayDecideApproval, type SqlFragment } from './scope';

export type HealthState = 'ok' | 'warn' | 'breach';

export interface LeadHealth {
  firstContact: { state: HealthState | 'release'; minutes: number } | null;
  stageSla: { state: HealthState; days: number; limit: number } | null;
  nextActionOverdue: boolean;
}

interface LeadListRow {
  id: string; code: string; stage: StageCode; status: string; source: string; need_summary: string;
  expected_value: number | null; first_contact_at: string | null; assigned_at: string | null;
  stage_entered_at: string; last_activity_at: string | null; created_at: string; updated_at: string;
  closed_at: string | null; lost_reason: string | null; version: number;
  owner_user_id: string | null; owner_name: string | null; team_id: string | null; team_name: string | null;
  contact_name: string; account_id: string | null; account_name: string | null;
  na_id: string | null; na_title: string | null; na_due_at: string | null;
}

export function leadHealth(row: Pick<LeadListRow, 'stage' | 'status' | 'first_contact_at' | 'assigned_at' | 'stage_entered_at' | 'na_due_at'>, now = new Date()): LeadHealth {
  const health: LeadHealth = { firstContact: null, stageSla: null, nextActionOverdue: false };
  if (row.status !== 'active') return health;
  if (row.stage === 'new' && !row.first_contact_at && row.assigned_at) {
    const minutes = workingMinutesBetween(new Date(row.assigned_at), now);
    const state = minutes >= RELEASE_AFTER_HOURS * 60 ? 'release'
      : minutes >= FIRST_CONTACT_SLA_HOURS * 60 ? 'breach'
        : minutes >= FIRST_CONTACT_SLA_HOURS * 60 * 0.75 ? 'warn' : 'ok';
    health.firstContact = { state, minutes };
  }
  const limit = STAGES.find((s) => s.code === row.stage)?.slaWorkingDays;
  if (limit) {
    const days = workingDaysBetween(new Date(row.stage_entered_at), now);
    health.stageSla = { state: days > limit ? 'breach' : days > limit * 0.8 ? 'warn' : 'ok', days: Math.round(days * 10) / 10, limit };
  }
  health.nextActionOverdue = Boolean(row.na_due_at && new Date(row.na_due_at) < now);
  return health;
}

const LEAD_SELECT = `
  SELECT l.id, l.code, l.stage, l.status, l.source, l.need_summary, l.expected_value, l.first_contact_at,
    l.assigned_at, l.stage_entered_at, l.last_activity_at, l.created_at, l.updated_at, l.closed_at, l.lost_reason,
    l.version, l.owner_user_id, u.display_name AS owner_name, l.team_id, t.name AS team_name,
    c.display_name AS contact_name, a.id AS account_id, a.name AS account_name,
    na.id AS na_id, na.title AS na_title, na.due_at AS na_due_at
  FROM lead l
  JOIN contact c ON c.id = l.contact_id
  LEFT JOIN account a ON a.id = l.account_id
  LEFT JOIN app_user u ON u.id = l.owner_user_id
  LEFT JOIN team t ON t.id = l.team_id
  LEFT JOIN task na ON na.id = l.next_action_task_id`;

function toLeadItem(row: LeadListRow, now: Date) {
  return {
    id: row.id, code: row.code, stage: row.stage, status: row.status, source: row.source,
    needSummary: row.need_summary, expectedValue: row.expected_value, version: row.version,
    firstContactAt: row.first_contact_at, assignedAt: row.assigned_at, stageEnteredAt: row.stage_entered_at,
    lastActivityAt: row.last_activity_at, createdAt: row.created_at, closedAt: row.closed_at, lostReason: row.lost_reason,
    owner: row.owner_user_id ? { id: row.owner_user_id, name: row.owner_name } : null,
    team: row.team_id ? { id: row.team_id, name: row.team_name } : null,
    contactName: row.contact_name,
    account: row.account_id ? { id: row.account_id, name: row.account_name } : null,
    nextAction: row.na_id ? { id: row.na_id, title: row.na_title, dueAt: row.na_due_at } : null,
    health: leadHealth(row, now),
  };
}
export type LeadItem = ReturnType<typeof toLeadItem>;

export interface LeadFilter {
  status?: string;
  stage?: string;
  ownerId?: string;
  q?: string;
  accountId?: string;
}

export async function listLeads(db: D1Database, actor: Actor, filter: LeadFilter = {}) {
  const scope = leadScope(actor);
  const where = [scope.sql];
  const binds = [...scope.binds];
  if (filter.status === 'open') where.push(`l.status IN ('queue', 'active')`);
  else if (filter.status) { where.push('l.status = ?'); binds.push(filter.status); }
  if (filter.stage) { where.push('l.stage = ?'); binds.push(filter.stage); }
  if (filter.ownerId) { where.push('l.owner_user_id = ?'); binds.push(filter.ownerId); }
  if (filter.accountId) { where.push('l.account_id = ?'); binds.push(filter.accountId); }
  const matcher = filter.q ? searchMatcher(filter.q) : null;
  // Text search folds Vietnamese case/diacritics in JS (SQLite lower() is ASCII-only), so it
  // filters the scoped rows before the page limit instead of inside SQL.
  const select = matcher
    ? LEAD_SELECT.replace('FROM lead l', `, (SELECT group_concat(cp.normalized_value, ' ') FROM contact_point cp WHERE cp.contact_id = l.contact_id) AS points
  FROM lead l`)
    : LEAD_SELECT;
  const rows = await db.prepare(`${select} WHERE ${where.join(' AND ')} ORDER BY l.updated_at DESC${matcher ? '' : ' LIMIT 500'}`)
    .bind(...binds).all<LeadListRow & { points?: string | null }>();
  const now = new Date();
  const found = matcher
    ? rows.results.filter((r) => matcher([r.code, r.contact_name, r.account_name, r.need_summary, r.points])).slice(0, 500)
    : rows.results;
  return found.map((r) => toLeadItem(r, now));
}

/**
 * Text matches folded fields; a query that looks like a phone number (only digits and phone
 * punctuation) also matches normalized phone numbers, so plain words never match on digits.
 */
function searchMatcher(q: string) {
  const text = foldText(q);
  const digits = q.replace(/\D/g, '');
  // Only a full number or an explicit +84 is rewritten to 0…; a fragment like "8451" stays as typed.
  const phone = /^[\d\s+().-]+$/.test(q.trim()) && digits.length >= 3
    ? (q.includes('+') || digits.length >= 9 ? normalizePhone(q) : digits) : null;
  return (fields: (string | null | undefined)[]) => fields.some((f) => {
    if (!f) return false;
    if (foldText(f).includes(text)) return true;
    return phone !== null && f.split(' ').some((p) => /^\d+$/.test(p) && p.includes(phone));
  });
}

function taskScope(actor: Actor): SqlFragment {
  if (actor.role === 'sale') return { sql: 'tk.assignee_user_id = ?', binds: [actor.id] };
  return leadScope(actor);
}

const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export async function listTasks(db: D1Database, actor: Actor, status: 'open' | 'completed' = 'open') {
  const scope = taskScope(actor);
  const rows = await db.prepare(`
    SELECT tk.id, tk.title, tk.due_at, tk.status, tk.outcome, tk.completed_at, tk.version,
      tk.assignee_user_id, u.display_name AS assignee_name,
      l.id AS lead_id, l.code AS lead_code, l.stage AS lead_stage, l.status AS lead_status, l.version AS lead_version,
      (l.next_action_task_id = tk.id) AS is_next_action,
      c.display_name AS contact_name, a.name AS account_name
    FROM task tk
    JOIN lead l ON l.id = tk.lead_id
    JOIN contact c ON c.id = l.contact_id
    LEFT JOIN account a ON a.id = l.account_id
    LEFT JOIN app_user u ON u.id = tk.assignee_user_id
    WHERE ${scope.sql} AND tk.status = ?
    ORDER BY ${status === 'open' ? 'tk.due_at ASC' : 'tk.completed_at DESC'} LIMIT 300`)
    .bind(...scope.binds, status).all<Record<string, unknown> & { due_at: string; is_next_action: number }>();
  const now = new Date();
  const today = vnDate(now);
  return rows.results.map((r) => ({
    id: r.id as string, title: r.title as string, dueAt: r.due_at, status: r.status as string,
    outcome: r.outcome as string | null, completedAt: r.completed_at as string | null, version: r.version as number,
    assignee: { id: r.assignee_user_id as string, name: r.assignee_name as string },
    isNextAction: Boolean(r.is_next_action),
    lead: {
      id: r.lead_id as string, code: r.lead_code as string, stage: r.lead_stage as string, status: r.lead_status as string,
      version: r.lead_version as number, contactName: r.contact_name as string, accountName: r.account_name as string | null,
    },
    bucket: r.status !== 'open' ? 'done' : new Date(r.due_at) < now ? 'overdue' : vnDate(new Date(r.due_at)) === today ? 'today' : 'upcoming',
  }));
}

export async function dashboard(db: D1Database, actor: Actor) {
  const [leads, tasks] = await Promise.all([listLeads(db, actor), listTasks(db, actor)]);
  const now = new Date();
  const monthStart = `${vnDate(now).slice(0, 7)}-01`;
  const inMonth = (iso: string | null) => Boolean(iso && vnDate(new Date(iso)) >= monthStart);
  const active = leads.filter((l) => l.status === 'active');
  const won = leads.filter((l) => l.status === 'won' && inMonth(l.closedAt));
  const lost = leads.filter((l) => l.status === 'lost' && inMonth(l.closedAt));
  const sum = (items: LeadItem[]) => items.reduce((s, l) => s + (l.expectedValue ?? 0), 0);
  const needsAttention = (l: LeadItem) => l.health.nextActionOverdue
    || (l.health.firstContact && l.health.firstContact.state !== 'ok' && l.health.firstContact.state !== 'warn')
    || l.health.stageSla?.state === 'breach';

  const owners = new Map<string, { id: string; name: string; active: number; overdue: number; stale: number; won: number; lost: number; value: number }>();
  for (const l of leads) {
    if (!l.owner) continue;
    const o = owners.get(l.owner.id) ?? { id: l.owner.id, name: l.owner.name ?? '', active: 0, overdue: 0, stale: 0, won: 0, lost: 0, value: 0 };
    if (l.status === 'active') {
      o.active++; o.value += l.expectedValue ?? 0;
      if (l.health.nextActionOverdue) o.overdue++;
      if (l.health.stageSla?.state === 'breach') o.stale++;
    }
    if (l.status === 'won' && inMonth(l.closedAt)) o.won++;
    if (l.status === 'lost' && inMonth(l.closedAt)) o.lost++;
    owners.set(l.owner.id, o);
  }
  const lostReasons = new Map<string, number>();
  for (const l of lost) lostReasons.set(l.lostReason ?? 'other', (lostReasons.get(l.lostReason ?? 'other') ?? 0) + 1);

  return {
    kpi: {
      activeLeads: active.length,
      queueLeads: leads.filter((l) => l.status === 'queue').length,
      pipelineValue: sum(active),
      tasksToday: tasks.filter((t) => t.bucket === 'today').length,
      overdueTasks: tasks.filter((t) => t.bucket === 'overdue').length,
      firstContactBreaches: active.filter((l) => l.health.firstContact && ['breach', 'release'].includes(l.health.firstContact.state)).length,
      staleLeads: active.filter((l) => l.health.stageSla?.state === 'breach').length,
      wonCount: won.length, wonValue: sum(won), lostCount: lost.length,
    },
    pipeline: ACTIVE_STAGES.map((code) => {
      const items = active.filter((l) => l.stage === code);
      return { stage: code, count: items.length, value: sum(items) };
    }),
    bySale: actor.role === 'sale' ? [] : [...owners.values()].sort((a, b) => b.active - a.active),
    attention: active.filter(needsAttention).slice(0, 12),
    upcoming: tasks.filter((t) => t.bucket !== 'done').slice(0, 10),
    lostReasons: [...lostReasons.entries()].map(([code, count]) => ({ code, count })),
  };
}

export async function teamMembers(db: D1Database, teamId: string | null) {
  if (!teamId) return [];
  const rows = await db.prepare(`SELECT id, display_name AS name, role FROM app_user
    WHERE team_id = ? AND status = 'active' AND role IN ('sale', 'leader') ORDER BY role DESC, display_name`).bind(teamId)
    .all<{ id: string; name: string; role: string }>();
  return rows.results;
}

/** Assignable people of every team in a department, for Admin assigning a queue lead. */
async function departmentMembers(db: D1Database, departmentId: string | null) {
  if (!departmentId) return [];
  const rows = await db.prepare(`SELECT id, display_name AS name, role FROM app_user
    WHERE department_id = ? AND team_id IS NOT NULL AND status = 'active' AND role IN ('sale', 'leader')
    ORDER BY role DESC, display_name`).bind(departmentId)
    .all<{ id: string; name: string; role: string }>();
  return rows.results;
}

const AUDIT_SELECT = `
  SELECT al.id, al.command, al.entity, al.entity_id, al.before_json, al.after_json, al.created_at, al.actor_kind,
    u.display_name AS actor_name, l.id AS lead_id, l.code AS lead_code
  FROM audit_log al
  LEFT JOIN task tk ON al.entity = 'task' AND tk.id = al.entity_id
  LEFT JOIN approval ap ON al.entity = 'approval' AND ap.id = al.entity_id
  JOIN lead l ON l.id = CASE al.entity WHEN 'lead' THEN al.entity_id WHEN 'task' THEN tk.lead_id WHEN 'approval' THEN ap.lead_id END
  LEFT JOIN app_user u ON u.id = al.actor_user_id`;

const toAudit = (r: Record<string, unknown>) => ({
  id: r.id as string, command: r.command as string, entity: r.entity as string, entityId: r.entity_id as string,
  before: r.before_json ? JSON.parse(r.before_json as string) : null,
  after: r.after_json ? JSON.parse(r.after_json as string) : null,
  createdAt: r.created_at as string, actorKind: r.actor_kind as string, actorName: r.actor_name as string | null,
  lead: { id: r.lead_id as string, code: r.lead_code as string },
});

/** Business audit per permission-matrix-v1: Leader team, Trưởng phòng department, BGĐ and Admin organization; Sale none. */
export const canReadAudit = (actor: Actor) => actor.role !== 'sale';

export async function listAudit(db: D1Database, actor: Actor, leadId?: string) {
  const scope = leadScope(actor);
  const rows = await db.prepare(`${AUDIT_SELECT} WHERE ${scope.sql}${leadId ? ' AND l.id = ?' : ''}
    ORDER BY al.created_at DESC LIMIT 300`).bind(...scope.binds, ...(leadId ? [leadId] : [])).all();
  return rows.results.map(toAudit);
}

export async function listApprovals(db: D1Database, actor: Actor, status?: string, leadId?: string) {
  const scope = leadScope(actor);
  const rows = await db.prepare(`
    SELECT ap.*, l.code AS lead_code, l.owner_user_id, l.team_id, l.department_id, l.status AS lead_status, l.stage AS lead_stage, l.version AS lead_version,
      c.display_name AS contact_name, ru.display_name AS requester_name, du.display_name AS decider_name
    FROM approval ap JOIN lead l ON l.id = ap.lead_id JOIN contact c ON c.id = l.contact_id
    LEFT JOIN app_user ru ON ru.id = ap.requested_by_user_id LEFT JOIN app_user du ON du.id = ap.decided_by_user_id
    WHERE ${scope.sql}${status ? ' AND ap.status = ?' : ''}${leadId ? ' AND ap.lead_id = ?' : ''}
    ORDER BY ap.status = 'pending' DESC, ap.created_at DESC LIMIT 200`)
    .bind(...scope.binds, ...(status ? [status] : []), ...(leadId ? [leadId] : [])).all<Record<string, unknown>>();
  const names = new Map((await db.prepare('SELECT id, display_name FROM app_user WHERE organization_id = ?').bind(actor.organizationId)
    .all<{ id: string; display_name: string }>()).results.map((u) => [u.id, u.display_name]));
  return rows.results.map((r) => {
    const payload = JSON.parse(r.payload_json as string) as Record<string, string>;
    const canDecide = r.status === 'pending' && mayDecideApproval(actor, r.kind as string, payload.toStage,
      { team_id: r.team_id as string | null, owner_user_id: r.owner_user_id as string | null, department_id: r.department_id as string, status: r.lead_status as string });
    return {
      id: r.id as string, kind: r.kind as string, status: r.status as string, version: r.version as number,
      reason: r.reason as string | null, createdAt: r.created_at as string, decidedAt: r.decided_at as string | null,
      decisionNote: r.decision_note as string | null, requestedByKind: r.requested_by_kind as string,
      requester: (r.requester_name as string | null) ?? payload.agentName ?? 'Agent',
      decider: r.decider_name as string | null,
      targetVersion: r.target_version as number,
      isStale: r.status === 'pending' && r.lead_version !== r.target_version,
      payload: {
        ...payload,
        fromUserName: payload.fromUserId ? names.get(payload.fromUserId) ?? null : null,
        toUserName: payload.toUserId ? names.get(payload.toUserId) ?? null : null,
      },
      lead: { id: r.lead_id as string, code: r.lead_code as string, stage: r.lead_stage as string, contactName: r.contact_name as string },
      canDecide,
    };
  });
}

export async function leadDetail(db: D1Database, actor: Actor, leadId: string) {
  const scope = leadScope(actor);
  const row = await db.prepare(`${LEAD_SELECT} WHERE l.id = ? AND ${scope.sql}`).bind(leadId, ...scope.binds).first<LeadListRow>();
  if (!row) return null;
  const lead = toLeadItem(row, new Date());
  const extra = await db.prepare('SELECT contact_id, department_id, lost_note, won_note, created_by_user_id FROM lead WHERE id = ?').bind(leadId)
    .first<{ contact_id: string; department_id: string; lost_note: string | null; won_note: string | null; created_by_user_id: string | null }>();
  const isAdmin = actor.role === 'admin';
  const [points, account, tasks, activities, approvals, audit, members] = await Promise.all([
    db.prepare('SELECT type, value FROM contact_point WHERE contact_id = ? ORDER BY type').bind(extra?.contact_id).all<{ type: string; value: string }>(),
    row.account_id ? db.prepare('SELECT id, name, tax_code AS taxCode, industry, city FROM account WHERE id = ?').bind(row.account_id).first() : null,
    db.prepare(`SELECT tk.id, tk.title, tk.due_at AS dueAt, tk.status, tk.outcome, tk.completed_at AS completedAt, tk.version,
      u.display_name AS assigneeName FROM task tk LEFT JOIN app_user u ON u.id = tk.assignee_user_id
      WHERE tk.lead_id = ? ORDER BY tk.status = 'open' DESC, tk.due_at DESC`).bind(leadId).all(),
    db.prepare(`SELECT ac.id, ac.type, ac.summary, ac.occurred_at AS occurredAt, ac.actor_kind AS actorKind, u.display_name AS actorName
      FROM activity ac LEFT JOIN app_user u ON u.id = ac.actor_user_id WHERE ac.lead_id = ? ORDER BY ac.occurred_at DESC, ac.created_at DESC`).bind(leadId).all(),
    listApprovals(db, actor, undefined, leadId),
    canReadAudit(actor) ? listAudit(db, actor, leadId) : Promise.resolve(null),
    isAdmin && !row.team_id ? departmentMembers(db, extra?.department_id ?? null) : teamMembers(db, row.team_id ?? actor.teamId),
  ]);
  const isOwner = row.owner_user_id === actor.id;
  const isTeamLeader = actor.role === 'leader' && (row.team_id === actor.teamId || (row.status === 'queue'));
  const writer = ['sale', 'leader', 'head', 'director', 'admin'].includes(actor.role);
  return {
    lead: { ...lead, lostNote: extra?.lost_note ?? null, wonNote: extra?.won_note ?? null },
    contactPoints: points.results,
    account,
    tasks: tasks.results,
    activities: activities.results,
    approvals,
    audit,
    teamMembers: members,
    permissions: {
      assign: (isTeamLeader || isAdmin) && (row.status === 'queue' || row.status === 'active'),
      release: isTeamLeader && row.status === 'active' && lead.health.firstContact?.state === 'release',
      logActivity: writer && row.status !== 'queue',
      changeStage: writer && row.status === 'active',
      transitions: row.status === 'active' ? allowedTransitions(row.stage) : [],
      requestOwnerChange: actor.role === 'sale' && isOwner && row.status === 'active',
      completeTask: writer,
    },
  };
}

export async function listAccounts(db: D1Database, actor: Actor, q?: string) {
  const scope = leadScope(actor);
  const ownerScope = leadScope(actor, 'l2');
  const rows = await db.prepare(`
    SELECT a.id, a.name, a.tax_code AS taxCode, a.industry, a.city,
      COUNT(l.id) AS leadCount, SUM(l.status IN ('queue', 'active')) AS openCount,
      SUM(CASE WHEN l.status = 'won' THEN coalesce(l.expected_value, 0) ELSE 0 END) AS wonValue,
      SUM(CASE WHEN l.status = 'active' THEN coalesce(l.expected_value, 0) ELSE 0 END) AS pipelineValue,
      MAX(l.last_activity_at) AS lastActivityAt,
      (SELECT group_concat(DISTINCT u2.display_name) FROM lead l2 JOIN app_user u2 ON u2.id = l2.owner_user_id
        WHERE l2.account_id = a.id AND l2.status = 'active' AND ${ownerScope.sql}) AS owners
    FROM account a JOIN lead l ON l.account_id = a.id
    WHERE ${scope.sql}
    GROUP BY a.id ORDER BY lastActivityAt DESC NULLS LAST, a.name${q ? '' : ' LIMIT 300'}`)
    .bind(...ownerScope.binds, ...scope.binds).all<Record<string, unknown> & { name: string; taxCode: string | null }>();
  if (!q) return rows.results;
  const text = foldText(q);
  return rows.results.filter((r) => foldText(r.name).includes(text) || (r.taxCode ?? '').includes(q.trim())).slice(0, 300);
}

export async function accountDetail(db: D1Database, actor: Actor, accountId: string) {
  const leads = await listLeads(db, actor, { accountId });
  if (!leads.length) return null;
  const leadIds = leads.map((l) => l.id);
  const marks = leadIds.map(() => '?').join(', ');
  const [account, contacts, activities] = await Promise.all([
    db.prepare('SELECT id, name, tax_code AS taxCode, industry, city, created_at AS createdAt FROM account WHERE id = ?').bind(accountId).first(),
    db.prepare(`SELECT c.id, c.display_name AS name, c.job_title AS jobTitle, ac.role, ac.is_primary AS isPrimary,
      (SELECT group_concat(cp.type || ':' || cp.value, '|') FROM contact_point cp WHERE cp.contact_id = c.id) AS points
      FROM account_contact ac JOIN contact c ON c.id = ac.contact_id WHERE ac.account_id = ?
        AND c.id IN (SELECT contact_id FROM lead WHERE id IN (${marks}))
      ORDER BY ac.is_primary DESC, c.display_name`).bind(accountId, ...leadIds).all<Record<string, unknown>>(),
    db.prepare(`SELECT ac.id, ac.type, ac.summary, ac.occurred_at AS occurredAt, u.display_name AS actorName, l.code AS leadCode, l.id AS leadId
      FROM activity ac JOIN lead l ON l.id = ac.lead_id LEFT JOIN app_user u ON u.id = ac.actor_user_id
      WHERE ac.lead_id IN (${marks}) ORDER BY ac.occurred_at DESC LIMIT 60`).bind(...leadIds).all(),
  ]);
  return {
    account,
    contacts: contacts.results.map((c) => ({
      ...c, isPrimary: Boolean(c.isPrimary),
      points: String(c.points ?? '').split('|').filter(Boolean).map((p) => {
        const [type, ...rest] = p.split(':');
        return { type, value: rest.join(':') };
      }),
    })),
    leads,
    activities: activities.results,
  };
}

export async function search(db: D1Database, actor: Actor, q: string) {
  if (q.trim().length < 2) return { leads: [], accounts: [] };
  const [leads, accounts] = await Promise.all([listLeads(db, actor, { q }), listAccounts(db, actor, q)]);
  return { leads: leads.slice(0, 8), accounts: accounts.slice(0, 5) };
}

export async function adminOverview(db: D1Database, actor: Actor) {
  const [departments, teams, users, counts] = await Promise.all([
    db.prepare('SELECT id, name FROM department WHERE organization_id = ? ORDER BY name').bind(actor.organizationId).all(),
    db.prepare(`SELECT t.id, t.name, d.name AS departmentName FROM team t JOIN department d ON d.id = t.department_id
      WHERE d.organization_id = ? ORDER BY t.name`).bind(actor.organizationId).all(),
    db.prepare(`SELECT u.id, u.display_name AS name, u.email, u.role, u.status, u.version, t.name AS teamName, d.name AS departmentName,
        u.must_change_password = 1 AS mustChangePassword, u.password_hash IS NOT NULL AS hasPassword,
        u.temp_password_expires_at AS tempPasswordExpiresAt, u.lark_link_status AS larkLinkStatus, u.lark_checked_at AS larkCheckedAt,
        (SELECT COUNT(*) FROM agent_token at WHERE at.user_id = u.id AND at.revoked_at IS NULL) AS agentTokens
      FROM app_user u LEFT JOIN team t ON t.id = u.team_id LEFT JOIN department d ON d.id = u.department_id
      WHERE u.organization_id = ? ORDER BY u.role, u.display_name`).bind(actor.organizationId).all(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM lead) AS leads, (SELECT COUNT(*) FROM audit_log) AS audit,
      (SELECT COUNT(*) FROM outbox WHERE status = 'pending') AS outboxPending, (SELECT COUNT(*) FROM approval WHERE status = 'pending') AS approvalsPending,
      (SELECT COALESCE(MAX(enabled), 0) FROM agent_kill_switch WHERE id = 1) = 1 AS agentKillSwitch`).first(),
  ]);
  return { departments: departments.results, teams: teams.results, users: users.results, counts };
}
