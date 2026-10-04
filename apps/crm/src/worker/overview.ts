import { ACTIVE_STAGES, type StageCode } from '@abm/contracts';
import type { Actor } from './env';
import { AUDIT_SELECT, LEAD_SELECT, needsAttention, toLeadItem, vnDate, type LeadItem, type LeadListRow } from './queries';
import { leadScope } from './scope';

/** The organization overview is for the people who run the company: Admin and the Board. */
export const canSeeOverview = (actor: Actor) => actor.role === 'admin' || actor.role === 'director';

type PeriodKey = 'month' | 'quarter' | 'year';
const LEAD_LIMIT = 1000;
const CARDS_PER_COLUMN = 8;

/** Start of the month, quarter or year to date on the Vietnam calendar. */
function periodStart(key: PeriodKey, now: Date) {
  const [year, month] = vnDate(now).split('-');
  const m = key === 'year' ? 1 : key === 'quarter' ? Math.floor((Number(month) - 1) / 3) * 3 + 1 : Number(month);
  return `${year}-${String(m).padStart(2, '0')}-01`;
}
const vnMidnightUtc = (date: string) => new Date(`${date}T00:00:00+07:00`).toISOString();
const winRate = (won: number, lost: number) => (won + lost ? won / (won + lost) : null);

function toCard(l: LeadItem) {
  return {
    id: l.id, code: l.code, title: l.account?.name ?? l.contactName, ownerName: l.owner?.name ?? null,
    value: l.expectedValue, risk: l.status === 'active' && needsAttention(l),
    nextActionDueAt: l.nextAction?.dueAt ?? null, closedAt: l.closedAt,
  };
}

export async function overviewData(db: D1Database, actor: Actor, opts: { period?: string; departmentId?: string }) {
  const now = new Date();
  const key: PeriodKey = opts.period === 'quarter' || opts.period === 'year' ? opts.period : 'month';
  const start = periodStart(key, now);
  const since = vnMidnightUtc(start);

  const departments = (await db.prepare('SELECT id, name FROM department WHERE organization_id = ? ORDER BY name')
    .bind(actor.organizationId).all<{ id: string; name: string }>()).results;
  const departmentId = departments.some((d) => d.id === opts.departmentId) ? opts.departmentId! : null;
  const base = leadScope(actor);
  const scope = departmentId ? { sql: `${base.sql} AND l.department_id = ?`, binds: [...base.binds, departmentId] } : base;
  const inView = `${scope.sql} AND (l.status IN ('queue', 'active') OR l.closed_at >= ?)`;

  const [groups, rows, overdue, approvalKinds, oldest, bot, outbox, placement, teams, people, sources, audit] = await Promise.all([
    db.prepare(`SELECT l.status, l.stage, COUNT(*) AS n, COALESCE(SUM(l.expected_value), 0) AS v FROM lead l
      WHERE ${inView} GROUP BY l.status, l.stage`).bind(...scope.binds, since)
      .all<{ status: string; stage: StageCode; n: number; v: number }>(),
    db.prepare(`${LEAD_SELECT} WHERE ${inView} ORDER BY l.updated_at DESC LIMIT ${LEAD_LIMIT}`).bind(...scope.binds, since).all<LeadListRow>(),
    db.prepare(`SELECT COUNT(*) AS n FROM task tk JOIN lead l ON l.id = tk.lead_id WHERE ${scope.sql} AND tk.status = 'open' AND tk.due_at < ?`)
      .bind(...scope.binds, now.toISOString()).first<{ n: number }>(),
    db.prepare(`SELECT ap.kind, COUNT(*) AS n FROM approval ap JOIN lead l ON l.id = ap.lead_id
      WHERE ${scope.sql} AND ap.status = 'pending' GROUP BY ap.kind ORDER BY n DESC`).bind(...scope.binds).all<{ kind: string; n: number }>(),
    db.prepare(`SELECT ap.id, ap.kind, json_extract(ap.payload_json, '$.toStage') AS to_stage, ap.requested_by_kind, ap.created_at,
        l.id AS lead_id, l.code AS lead_code, ru.display_name AS requester
      FROM approval ap JOIN lead l ON l.id = ap.lead_id LEFT JOIN app_user ru ON ru.id = ap.requested_by_user_id
      WHERE ${scope.sql} AND ap.status = 'pending' ORDER BY ap.created_at ASC LIMIT 10`).bind(...scope.binds)
      .all<{ id: string; kind: string; to_stage: string | null; requested_by_kind: 'human' | 'agent'; created_at: string; lead_id: string; lead_code: string; requester: string | null }>(),
    // Bot figures cover the whole system, whatever department is selected.
    db.prepare(`SELECT
        COALESCE((SELECT MAX(enabled) FROM agent_kill_switch), 0) AS open,
        (SELECT COUNT(*) FROM agent_token WHERE revoked_at IS NULL) AS tokens,
        (SELECT COUNT(*) FROM audit_log WHERE actor_kind = 'agent' AND created_at >= ?) AS today,
        (SELECT COUNT(*) FROM audit_log WHERE actor_kind = 'agent' AND created_at >= ?) AS week`)
      .bind(vnMidnightUtc(vnDate(now)), new Date(now.getTime() - 7 * 86_400_000).toISOString())
      .first<{ open: number; tokens: number; today: number; week: number }>(),
    db.prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status ORDER BY status').all<{ status: string; n: number }>(),
    db.prepare(`SELECT l.id, l.department_id FROM lead l WHERE ${scope.sql} AND l.status = 'active'`).bind(...scope.binds)
      .all<{ id: string; department_id: string }>(),
    db.prepare(`SELECT t.id, t.name, t.department_id FROM team t JOIN department d ON d.id = t.department_id
      WHERE d.organization_id = ? ORDER BY t.name`).bind(actor.organizationId).all<{ id: string; name: string; department_id: string }>(),
    db.prepare(`SELECT u.id, u.display_name AS name, t.name AS team_name FROM app_user u LEFT JOIN team t ON t.id = u.team_id
      WHERE u.organization_id = ? AND u.status = 'active' AND u.role IN ('sale', 'leader')${departmentId ? ' AND u.department_id = ?' : ''}
      ORDER BY u.display_name`).bind(actor.organizationId, ...(departmentId ? [departmentId] : []))
      .all<{ id: string; name: string; team_name: string | null }>(),
    db.prepare(`SELECT l.source,
        SUM(CASE WHEN l.created_at >= ? THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN l.status = 'won' AND l.closed_at >= ? THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN l.status = 'lost' AND l.closed_at >= ? THEN 1 ELSE 0 END) AS lost
      FROM lead l WHERE ${scope.sql} GROUP BY l.source`).bind(since, since, since, ...scope.binds)
      .all<{ source: string; total: number; won: number; lost: number }>(),
    // Names and codes only: the change details can hold a customer's phone or email.
    db.prepare(`${AUDIT_SELECT} WHERE ${scope.sql} ORDER BY al.created_at DESC LIMIT 20`).bind(...scope.binds)
      .all<{ id: string; command: string; entity: string; lead_id: string; lead_code: string; actor_name: string | null; actor_kind: string; created_at: string }>(),
  ]);

  const leads = rows.results.map((r) => toLeadItem(r, now));
  const total = groups.results.reduce((s, g) => s + g.n, 0);
  const tally = (match: (g: { status: string; stage: StageCode }) => boolean) => groups.results.filter(match)
    .reduce((acc, g) => ({ count: acc.count + g.n, value: acc.value + g.v }), { count: 0, value: 0 });

  const column = (key: 'queue' | StageCode, match: (s: { status: string; stage: string }) => boolean) => {
    const items = leads.filter(match);
    const closed = key === 'won' || key === 'lost';
    const cards = items.map(toCard);
    const ordered = closed
      ? cards.sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
      : [...cards.filter((c) => c.risk), ...cards.filter((c) => !c.risk)];
    return { key, ...tally(match), atRisk: cards.filter((c) => c.risk).length, leads: ordered.slice(0, CARDS_PER_COLUMN) };
  };
  const columns = [
    column('queue', (l) => l.status === 'queue'),
    ...ACTIVE_STAGES.map((stage) => column(stage, (l) => l.status === 'active' && l.stage === stage)),
    column('won', (l) => l.status === 'won'),
    column('lost', (l) => l.status === 'lost'),
  ];
  const sumOf = (k: string) => columns.find((c) => c.key === k)!;
  const active = tally((g) => g.status === 'active');
  const won = sumOf('won');
  const lost = sumOf('lost');

  const departmentOf = new Map(placement.results.map((p) => [p.id, p.department_id]));
  const activeLeads = leads.filter((l) => l.status === 'active');
  const matrixRow = (id: string, name: string, depId: string, inRow: (l: LeadItem) => boolean) => {
    const items = activeLeads.filter(inRow);
    return {
      id, name, departmentId: depId,
      cells: ACTIVE_STAGES.map((stage) => {
        const cell = items.filter((l) => l.stage === stage);
        return { stage, count: cell.length, value: cell.reduce((s, l) => s + (l.expectedValue ?? 0), 0), atRisk: cell.filter(needsAttention).length };
      }),
    };
  };
  const shownDepartments = departments.filter((d) => !departmentId || d.id === departmentId);
  const shownIds = new Set(shownDepartments.map((d) => d.id));

  const workload = people.results.map((p) => {
    const owned = leads.filter((l) => l.owner?.id === p.id);
    const open = owned.filter((l) => l.status === 'active');
    return {
      id: p.id, name: p.name, teamName: p.team_name, open: open.length,
      overdue: open.filter((l) => l.health.nextActionOverdue).length,
      stale: open.filter((l) => l.health.stageSla?.state === 'breach').length,
      won: owned.filter((l) => l.status === 'won').length, lost: owned.filter((l) => l.status === 'lost').length,
    };
  }).filter((w) => w.open + w.won + w.lost > 0).sort((a, b) => b.open - a.open);

  return {
    period: { key, start },
    departments,
    departmentId,
    truncated: total > leads.length ? { shown: leads.length, total } : null,
    kpi: {
      openLeads: active.count, pipelineValue: active.value, queueLeads: sumOf('queue').count,
      wonCount: won.count, wonValue: won.value, lostCount: lost.count, lostValue: lost.value,
      winRate: winRate(won.count, lost.count),
      overdueTasks: overdue?.n ?? 0,
      slaBreaches: leads.filter((l) => l.status === 'active' && needsAttention(l)).length,
      pendingApprovals: approvalKinds.results.reduce((s, k) => s + k.n, 0),
      agentActionsToday: bot?.today ?? 0,
    },
    columns,
    approvals: {
      byKind: approvalKinds.results.map((k) => ({ kind: k.kind, count: k.n })),
      oldest: oldest.results.map((a) => ({
        id: a.id, kind: a.kind, toStage: a.to_stage, leadId: a.lead_id, leadCode: a.lead_code,
        requester: a.requester, requestedByKind: a.requested_by_kind, createdAt: a.created_at,
      })),
    },
    bot: {
      agentWritesOpen: bot?.open === 1, activeTokens: bot?.tokens ?? 0, agentWrites7d: bot?.week ?? 0,
      outbox: outbox.results.map((o) => ({ status: o.status, count: o.n })),
    },
    matrix: {
      stages: [...ACTIVE_STAGES],
      departments: shownDepartments.map((d) => matrixRow(d.id, d.name, d.id, (l) => departmentOf.get(l.id) === d.id)),
      teams: teams.results.filter((t) => shownIds.has(t.department_id))
        .map((t) => matrixRow(t.id, t.name, t.department_id, (l) => l.team?.id === t.id)),
    },
    workload,
    sources: sources.results.filter((s) => s.total + s.won + s.lost > 0)
      .map((s) => ({ code: s.source, total: s.total, won: s.won, lost: s.lost, winRate: winRate(s.won, s.lost) }))
      .sort((a, b) => b.total - a.total),
    recentAudit: audit.results.map((a) => ({
      id: a.id, command: a.command, entity: a.entity, leadId: a.lead_id, leadCode: a.lead_code,
      actorName: a.actor_name, actorKind: a.actor_kind, createdAt: a.created_at,
    })),
  };
}
export type Overview = Awaited<ReturnType<typeof overviewData>>;
