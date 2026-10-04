import { ACTIVE_STAGES, type StageCode } from '@abm/contracts';
import type { Actor } from './env';
import { LEAD_SELECT, needsAttention, toLeadItem, vnDate, type LeadItem, type LeadListRow } from './queries';
import { leadScope } from './scope';

/** The organization overview is for the people who run the company: Admin and the Board. */
export const canSeeOverview = (actor: Actor) => actor.role === 'admin' || actor.role === 'director';

type PeriodKey = 'month' | 'quarter' | 'year';
const LEAD_LIMIT = 2000;
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

  const [groups, rows, overdue, approvalKinds, oldest, bot, outbox] = await Promise.all([
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
  ]);

  const leads = rows.results.map((r) => toLeadItem(r, now));
  const total = groups.results.reduce((s, g) => s + g.n, 0);
  const tally = (match: (g: { status: string; stage: StageCode }) => boolean) => groups.results.filter(match)
    .reduce((acc, g) => ({ count: acc.count + g.n, value: acc.value + g.v }), { count: 0, value: 0 });

  const column = (key: 'queue' | StageCode, match: (s: { status: string; stage: string }) => boolean) => {
    const items = leads.filter(match);
    const closed = key === 'won' || key === 'lost';
    const ordered = closed
      ? [...items].sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
      : [...items.filter((l) => toCard(l).risk), ...items.filter((l) => !toCard(l).risk)];
    return {
      key, ...tally(match), atRisk: items.filter((l) => l.status === 'active' && needsAttention(l)).length,
      leads: ordered.slice(0, CARDS_PER_COLUMN).map(toCard),
    };
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
  };
}
export type Overview = Awaited<ReturnType<typeof overviewData>>;
