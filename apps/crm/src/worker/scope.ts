import type { Actor } from './env';

export interface SqlFragment {
  sql: string;
  binds: unknown[];
}

/**
 * Lead visibility per permission-matrix-v1: Sale own/assigned, Leader team plus the
 * department intake queue it assigns from, Head department, BGĐ organization.
 * Admin has no business data access.
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
      return { sql: `${a}.organization_id = ?`, binds: [actor.organizationId] };
    default:
      return { sql: '0 = 1', binds: [] };
  }
}

export async function canSeeLead(db: D1Database, actor: Actor, leadId: string): Promise<boolean> {
  const scope = leadScope(actor);
  const row = await db.prepare(`SELECT 1 AS ok FROM lead l WHERE l.id = ? AND ${scope.sql}`)
    .bind(leadId, ...scope.binds).first();
  return Boolean(row);
}
