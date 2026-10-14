import type { Actor } from './env';

export interface SqlFragment {
  sql: string;
  binds: unknown[];
}

export type LeadPipelineFilter = 'b2b' | 'learner' | 'all';
const PIPELINE_FILTERS = new Set<string>(['b2b', 'learner', 'all']);
const LEARNER_READERS = new Set(['sale', 'leader', 'director', 'admin']);
export const canReadLearners = (actor: Actor) => LEARNER_READERS.has(actor.role);

function b2bScope(actor: Actor, a = 'l'): SqlFragment {
  switch (actor.role) {
    case 'sale':
      return { sql: `${a}.pipeline = 'b2b' AND ${a}.owner_user_id = ?`, binds: [actor.id] };
    case 'leader':
      return {
        sql: `${a}.pipeline = 'b2b' AND (${a}.team_id = ? OR (${a}.status = 'queue' AND ${a}.department_id = ?))`,
        binds: [actor.teamId, actor.departmentId],
      };
    case 'head':
      return { sql: `${a}.pipeline = 'b2b' AND ${a}.department_id = ?`, binds: [actor.departmentId] };
    case 'director':
    case 'admin':
      return { sql: `${a}.pipeline = 'b2b' AND ${a}.organization_id = ?`, binds: [actor.organizationId] };
    default:
      return { sql: '0 = 1', binds: [] };
  }
}

export function learnerLeadScope(actor: Actor, a = 'l'): SqlFragment {
  switch (actor.role) {
    case 'sale':
      return {
        sql: `${a}.pipeline = 'learner' AND (${a}.owner_user_id = ? OR EXISTS (SELECT 1 FROM contact c WHERE c.id = ${a}.contact_id AND c.owner_user_id = ?))`,
        binds: [actor.id, actor.id],
      };
    case 'leader':
      return {
        sql: `${a}.pipeline = 'learner' AND (${a}.team_id = ? OR EXISTS (SELECT 1 FROM contact c WHERE c.id = ${a}.contact_id AND c.owner_user_id IN (SELECT id FROM app_user WHERE team_id = ?)))`,
        binds: [actor.teamId, actor.teamId],
      };
    case 'head':
      return { sql: `${a}.pipeline = 'learner' AND ${a}.department_id = ?`, binds: [actor.departmentId] };
    case 'director':
    case 'admin':
      return { sql: `${a}.pipeline = 'learner' AND ${a}.organization_id = ?`, binds: [actor.organizationId] };
    default:
      return { sql: '0 = 1', binds: [] };
  }
}

/**
 * Lead visibility per permission-matrix-v1 across B2B and Learner pipelines.
 * Accepts either (actor, pipeline?, alias?) or legacy (actor, alias).
 */
export function leadScope(actor: Actor, pipelineOrAlias: LeadPipelineFilter | string = 'all', maybeAlias?: string): SqlFragment {
  const isPipeline = PIPELINE_FILTERS.has(pipelineOrAlias);
  const pipeline: LeadPipelineFilter = isPipeline ? (pipelineOrAlias as LeadPipelineFilter) : 'all';
  const a = isPipeline ? (maybeAlias ?? 'l') : pipelineOrAlias;
  if (pipeline === 'b2b') return b2bScope(actor, a);
  if (pipeline === 'learner') return learnerLeadScope(actor, a);
  const b = b2bScope(actor, a);
  const lr = learnerLeadScope(actor, a);
  if (b.sql === '0 = 1' && lr.sql === '0 = 1') return { sql: '0 = 1', binds: [] };
  if (lr.sql === '0 = 1') return b;
  if (b.sql === '0 = 1') return lr;
  return { sql: `((${b.sql}) OR (${lr.sql}))`, binds: [...b.binds, ...lr.binds] };
}

/** Same visibility as leadScope, limited to the B2B pipeline. */
export function b2bLeadScope(actor: Actor, alias = 'l'): SqlFragment {
  return b2bScope(actor, alias);
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
