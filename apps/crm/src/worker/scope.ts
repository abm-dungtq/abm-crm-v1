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
      // academic, teacher and accountant read B2B leads nowhere; their own screens use dedicated queries.
      return { sql: '0 = 1', binds: [] };
  }
}

/** Same visibility as leadScope, limited to the B2B pipeline. Learner leads stay on the learner screens. */
export function b2bLeadScope(actor: Actor, alias = 'l'): SqlFragment {
  const scope = leadScope(actor, alias);
  return { sql: `${scope.sql} AND ${alias}.pipeline = 'b2b'`, binds: [...scope.binds] };
}

/**
 * Customer (contact) visibility in the learner flow: Sale own, Leader the team's customers,
 * Admin and BGĐ organization-wide. Other roles reach customers only through their own queries.
 */
export function customerScope(actor: Actor, alias = 'c'): SqlFragment {
  const a = alias;
  switch (actor.role) {
    case 'sale':
      return { sql: `${a}.owner_user_id = ?`, binds: [actor.id] };
    case 'leader':
      return { sql: `${a}.owner_user_id IN (SELECT id FROM app_user WHERE team_id = ?)`, binds: [actor.teamId] };
    case 'director':
    case 'admin':
      return { sql: `${a}.organization_id = ?`, binds: [actor.organizationId] };
    default:
      return { sql: '0 = 1', binds: [] };
  }
}

/** Owner changes, agent assignments and agent Won/Lost proposals are decided by the team Leader only (QĐ14, action-risk matrix). */
export const leaderOnly = (kind: string, toStage?: string | null) =>
  kind === 'owner_change' || kind === 'agent_assign' || toStage === 'won' || toStage === 'lost';

export interface ApprovalLead {
  team_id: string | null;
  owner_user_id: string | null;
  department_id: string;
  status: string;
}

/** A queue lead has no team yet, so its assignment is decided by a Leader of the lead's department. */
export function mayDecideApproval(actor: Actor, kind: string, toStage: string | null | undefined, lead: ApprovalLead) {
  const isTeamLeader = actor.role === 'leader' && actor.teamId != null && lead.team_id === actor.teamId;
  if (kind === 'agent_assign' && lead.status === 'queue') return actor.role === 'leader' && lead.department_id === actor.departmentId;
  if (leaderOnly(kind, toStage)) return isTeamLeader;
  return isTeamLeader || (actor.role === 'sale' && lead.owner_user_id === actor.id);
}

export async function canSeeLead(db: D1Database, actor: Actor, leadId: string): Promise<boolean> {
  const scope = leadScope(actor);
  const row = await db.prepare(`SELECT 1 AS ok FROM lead l WHERE l.id = ? AND ${scope.sql}`)
    .bind(leadId, ...scope.binds).first();
  return Boolean(row);
}
