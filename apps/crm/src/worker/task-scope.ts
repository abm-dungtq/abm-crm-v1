import type { Actor } from './env';
import { leadScope, type SqlFragment } from './scope';

export function internalTaskScope(actor: Actor, a = 'tk'): SqlFragment {
  if (actor.role === 'director' || actor.role === 'admin') {
    return {
      sql: `(${a}.kind = 'internal' AND EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${a}.assignee_user_id AND au.organization_id = ?))`,
      binds: [actor.organizationId],
    };
  }
  let inner = `${a}.created_by_user_id = ? OR ${a}.assignee_user_id = ? OR EXISTS (SELECT 1 FROM task_member m WHERE m.task_id = ${a}.id AND m.user_id = ?)`;
  const binds: unknown[] = [actor.id, actor.id, actor.id];
  if (actor.role === 'leader') {
    inner += ` OR EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${a}.assignee_user_id AND au.team_id = ?)`;
    binds.push(actor.teamId);
  } else if (actor.role === 'head') {
    inner += ` OR EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${a}.assignee_user_id AND au.department_id = ?)`;
    binds.push(actor.departmentId);
  }
  return { sql: `(${a}.kind = 'internal' AND (${inner}))`, binds };
}

function crmTaskScope(actor: Actor): SqlFragment {
  if (actor.role === 'sale') return { sql: 'tk.assignee_user_id = ?', binds: [actor.id] };
  return leadScope(actor);
}

export function taskScope(actor: Actor): SqlFragment {
  const crm = crmTaskScope(actor);
  const internal = internalTaskScope(actor);
  return {
    sql: `((tk.kind = 'crm' AND (${crm.sql})) OR ${internal.sql})`,
    binds: [...crm.binds, ...internal.binds],
  };
}

export async function canSeeTask(db: D1Database, actor: Actor, taskId: string): Promise<boolean> {
  const scope = taskScope(actor);
  const row = await db.prepare(`SELECT 1 AS ok FROM task tk LEFT JOIN lead l ON l.id = tk.lead_id WHERE tk.id = ? AND ${scope.sql}`)
    .bind(taskId, ...scope.binds).first();
  return Boolean(row);
}
