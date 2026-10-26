import type { Context } from 'hono';
import { sinkFrom, type AppBindings } from './env';
import type { GuardedTx } from './guarded-tx';
import { notify } from './notify';

/**
 * Won/Lost, assignment and owner-change requests wait on the team Leader, so the Leader gets a CRM
 * notification. An ordinary stage change is confirmed by the owner on the web and notifies nobody.
 */
export const approvalNeedsLeader = (kind: string, toStage?: string | null) =>
  kind === 'owner_change' || kind === 'agent_assign' || (kind === 'agent_stage_change' && (toStage === 'won' || toStage === 'lost'));

/** Active Leaders of the lead's team (or of its department for a queue lead), never the requester. */
export async function activeLeaders(db: D1Database, lead: { team_id: string | null; department_id: string }, requesterId: string | null) {
  const [column, value] = lead.team_id ? ['team_id', lead.team_id] : ['department_id', lead.department_id];
  const rows = await db.prepare(`SELECT id, display_name FROM app_user
    WHERE ${column} = ? AND role = 'leader' AND status = 'active'
      AND id IS NOT ?`).bind(value, requesterId).all<{ id: string; display_name: string }>();
  return rows.results;
}

/** After a command commits, sends the in-app/push notifications its events need. */
export function notifyCommitted(c: Context<AppBindings>) {
  const sink = sinkFrom(c);
  const actor = c.get('actor');
  return async (tx: GuardedTx) => {
    for (const event of tx.events) {
      const payload = event.payload as {
        approvalId?: string;
        leadId?: string;
        kind?: string;
        toStage?: string | null;
        requesterId?: string | null;
        taskId?: string;
        assigneeUserId?: string;
      };
      if (event.type === 'approval.requested' && approvalNeedsLeader(payload.kind ?? '', payload.toStage)) {
        if (payload.approvalId) {
          const leadRow = await c.env.DB.prepare(`
            SELECT l.team_id, l.department_id, l.code
            FROM approval ap
            JOIN lead l ON l.id = ap.lead_id
            WHERE ap.id = ?`)
            .bind(payload.approvalId)
            .first<{ team_id: string | null; department_id: string; code: string }>();
          if (leadRow) {
            const leaders = await activeLeaders(c.env.DB, leadRow, payload.requesterId ?? actor.id);
            await notify(sink, {
              organizationId: actor.organizationId,
              userIds: leaders.map((l) => l.id),
              kind: 'approval',
              title: 'Yêu cầu duyệt',
              body: `Lead ${leadRow.code} có yêu cầu chờ duyệt`,
              link: '/approvals',
              dedupeKey: `approval:${payload.approvalId}`,
            });
          }
        }
      }
      if (
        (event.type === 'task.created' || event.type === 'task.assigned') &&
        payload.taskId &&
        payload.assigneeUserId &&
        payload.assigneeUserId !== actor.id
      ) {
        const taskRow = await c.env.DB.prepare('SELECT title FROM task WHERE id = ?')
          .bind(payload.taskId)
          .first<{ title: string }>();
        await notify(sink, {
          organizationId: actor.organizationId,
          userIds: [payload.assigneeUserId],
          kind: 'task_assigned',
          title: `${actor.displayName} giao việc cho bạn`,
          body: taskRow?.title ?? undefined,
          link: `/tasks/${payload.taskId}`,
          dedupeKey: `task-assigned:${payload.taskId}:${payload.assigneeUserId}`,
        });
      }
    }
  };
}
