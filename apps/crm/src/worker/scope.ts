import type { Actor } from './env';

export interface SqlFragment {
  sql: string;
  binds: unknown[];
}

/**
 * Lead visibility per permission-matrix-v1: Sale own/assigned, Leader team plus the
 * department intake queue it assigns from, Head department, BGĐ organization.
 * Admin reads and writes organization-wide but never decides approvals.
 */
export function leadScope(actor: Actor, alias = 'l'): SqlFragment {
  const a = alias;
  switch (actor.role) {
    case 'sale':
      return { sql: `${a}.owner_user_id = ?`, binds: [actor.id] };
    case 'leader':
      return {
        sql: `(${a}.team_id = ? OR (${a}.status = 'queue' AND ${a}.department_id = ?))`,
        binds: [actor.teamId, actor.departmentId],
      };
    case 'head':
      return { sql: `${a}.department_id = ?`, binds: [actor.departmentId] };
    case 'director':
    case 'admin':
      return { sql: `${a}.organization_id = ?`, binds: [actor.organizationId] };
    default:
      return { sql: '0 = 1', binds: [] };
  }
}

/** Owner changes and agent Won/Lost proposals are decided by the team Leader only (QĐ14, action-risk matrix). */
export const leaderOnly = (kind: string, toStage?: string | null) =>
  kind === 'owner_change' || toStage === 'won' || toStage === 'lost';

export function mayDecideApproval(actor: Actor, kind: string, toStage: string | null | undefined, lead: { team_id: string | null; owner_user_id: string | null }) {
  const isTeamLeader = actor.role === 'leader' && actor.teamId != null && lead.team_id === actor.teamId;
  if (leaderOnly(kind, toStage)) return isTeamLeader;
  return isTeamLeader || (actor.role === 'sale' && lead.owner_user_id === actor.id);
}

export async function canSeeLead(db: D1Database, actor: Actor, leadId: string): Promise<boolean> {
  const scope = leadScope(actor);
  const row = await db.prepare(`SELECT 1 AS ok FROM lead l WHERE l.id = ? AND ${scope.sql}`)
    .bind(leadId, ...scope.binds).first();
  return Boolean(row);
}
