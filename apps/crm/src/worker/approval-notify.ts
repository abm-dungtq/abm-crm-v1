import type { Context } from 'hono';
import { background, type AppBindings, type Env } from './env';
import type { GuardedTx } from './guarded-tx';
import { LarkError, sendText } from './lark';

/**
 * Won/Lost, assignment and owner-change requests wait on the team Leader, so the Leader gets a Lark
 * direct message. An ordinary stage change is confirmed by the owner on the web and sends nothing.
 */
export const approvalNeedsLeaderDm = (kind: string, toStage?: string | null) =>
  kind === 'owner_change' || kind === 'agent_assign' || (kind === 'agent_stage_change' && (toStage === 'won' || toStage === 'lost'));

interface Recipient { id: string; display_name: string; lark_open_id: string }

/** Linked, active Leaders of the lead's team (or of its department for a queue lead), never the requester. */
export async function leaderRecipients(db: D1Database, lead: { team_id: string | null; department_id: string }, requesterId: string | null) {
  const [column, value] = lead.team_id ? ['team_id', lead.team_id] : ['department_id', lead.department_id];
  const rows = await db.prepare(`SELECT id, display_name, lark_open_id FROM app_user
    WHERE ${column} = ? AND role = 'leader' AND status = 'active' AND lark_link_status = 'linked' AND lark_open_id IS NOT NULL
      AND id IS NOT ?`).bind(value, requesterId).all<Recipient>();
  return rows.results;
}

interface ApprovalForDm {
  kind: string; payload_json: string; requested_by_user_id: string | null; requested_by_kind: string;
  code: string; team_id: string | null; department_id: string; contact_name: string; requester: string | null;
}

/** Message text: names and lead code only, never the customer's phone or email. */
function messageText(a: ApprovalForDm, payload: { toStage?: string; toUserId?: string }, toUserName: string | null, origin: string) {
  const what = a.kind === 'owner_change' ? `chuyển người phụ trách sang ${toUserName ?? '—'}`
    : a.kind === 'agent_assign' ? `giao lead cho ${toUserName ?? '—'}`
    : payload.toStage === 'won' ? 'chốt Won' : 'đóng Lost';
  const who = `${a.requester ?? 'Người dùng'}${a.requested_by_kind === 'agent' ? ' (qua bot)' : ''}`;
  return `[CRM] ${who} đề nghị ${what} cho lead ${a.code} – ${a.contact_name}. Duyệt tại: ${origin}/approvals`;
}

/**
 * Sends the Leader DM for one `approval.requested` outbox row and records the outcome on it. It runs
 * after the commit, so a Lark failure never touches the approval; it never throws.
 */
export async function deliverApprovalDm(env: Pick<Env, 'DB' | 'LARK_APP_ID' | 'LARK_APP_SECRET'>, outboxId: string, origin: string): Promise<string | null> {
  const db = env.DB;
  const row = await db.prepare(`SELECT payload_json FROM outbox WHERE id = ? AND event_type = 'approval.requested' AND status IN ('pending', 'failed')`)
    .bind(outboxId).first<{ payload_json: string }>();
  if (!row) return null;
  const finish = async (status: string, error: string | null = null, attempted = true) => {
    await db.prepare(`UPDATE outbox SET status = ?, last_error = ?, attempts = attempts + ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`)
      .bind(status, error, attempted ? 1 : 0, status, new Date().toISOString(), outboxId).run();
    return status;
  };
  try {
    const { approvalId } = JSON.parse(row.payload_json) as { approvalId: string };
    const approval = await db.prepare(`SELECT ap.kind, ap.payload_json, ap.requested_by_user_id, ap.requested_by_kind,
        l.code, l.team_id, l.department_id, c.display_name AS contact_name, ru.display_name AS requester
      FROM approval ap JOIN lead l ON l.id = ap.lead_id JOIN contact c ON c.id = l.contact_id
      LEFT JOIN app_user ru ON ru.id = ap.requested_by_user_id WHERE ap.id = ?`).bind(approvalId).first<ApprovalForDm>();
    const payload = approval ? JSON.parse(approval.payload_json) as { toStage?: string; toUserId?: string } : {};
    if (!approval || !approvalNeedsLeaderDm(approval.kind, payload.toStage)) return finish('skipped', null, false);
    const recipients = await leaderRecipients(db, approval, approval.requested_by_user_id);
    if (!recipients.length) return finish('no_recipient', null, false);
    const toUserName = payload.toUserId
      ? (await db.prepare('SELECT display_name FROM app_user WHERE id = ?').bind(payload.toUserId).first<{ display_name: string }>())?.display_name ?? null
      : null;
    const text = messageText(approval, payload, toUserName, origin);
    const errors: string[] = [];
    for (const r of recipients) {
      try {
        await sendText(env, r.lark_open_id, text);
      } catch (error) {
        errors.push(`${r.display_name}: ${error instanceof LarkError ? error.message : 'lỗi gửi tin'}`);
      }
    }
    return finish(errors.length ? 'failed' : 'sent', errors.join('; ') || null);
  } catch (error) {
    return finish('failed', error instanceof LarkError ? error.message : 'Lỗi khi chuẩn bị tin nhắn');
  }
}

/** After a command commits, sends the Leader DMs its approval requests need, without delaying the response. */
export function notifyCommitted(c: Context<AppBindings>) {
  const origin = new URL(c.req.url).origin;
  return async (tx: GuardedTx) => {
    for (const event of tx.events) {
      const payload = event.payload as { kind?: string; toStage?: string | null };
      if (event.type === 'approval.requested' && approvalNeedsLeaderDm(payload.kind ?? '', payload.toStage)) {
        await background(c, deliverApprovalDm(c.env, event.id, origin));
      }
    }
  };
}
