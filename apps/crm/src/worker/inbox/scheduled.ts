import type { Env } from '../env';
import { linkBase, slaDueSql } from './assignment';
import { abandonStaleReplies, sweepStuckOutgoing } from './conversation-flow';
import { enqueueCommand } from './dispatcher';
import { runDueSchedules } from './group-schedules';
import { enqueueDailyGroupSummaries } from './group-summaries';
import { extractIdleConversations } from './intake';
import { processWorkerCommands } from './worker-commands';

/** Cron Trigger work. Every task logs and continues on failure, so the scheduled handler never throws. */

export const EVERY_MINUTE_CRON = '* * * * *';
/** 14:00 UTC = 21:00 Vietnam time. */
export const DAILY_SUMMARY_CRON = '0 14 * * *';
const SLA_BATCH = 50;

type ScheduledEnv = Pick<Env, 'DB' | 'LARK_APP_ID' | 'LARK_APP_SECRET' | 'LARK_INBOX_CHAT_ID' | 'APP_URL'>;

interface OverdueRow {
  id: string;
  display_name: string | null;
  external_thread_id: string;
  sla_due_at: string;
  account_name: string;
  assignee_name: string | null;
}

/**
 * Reminds the Lark inbox group of direct `human` conversations whose customer has waited past the reply deadline,
 * then moves the deadline one reply window ahead. The reminder is deduplicated per conversation and
 * deadline, and the deadline moves only if nobody changed it meanwhile. Returns the number of reminders.
 */
export async function checkSla(db: D1Database, now = new Date(), appUrl?: string): Promise<number> {
  const nowIso = now.toISOString();
  const base = linkBase(appUrl);
  const overdue = await db.prepare(`SELECT c.id, c.display_name, c.external_thread_id, c.sla_due_at, a.display_name AS account_name,
      u.display_name AS assignee_name
    FROM conversation c JOIN channel_account a ON a.id = c.channel_account_id LEFT JOIN app_user u ON u.id = c.assignee_user_id
    WHERE c.kind = 'direct' AND c.mode = 'human' AND c.sla_due_at IS NOT NULL AND c.sla_due_at < ?
    ORDER BY c.sla_due_at LIMIT ?`).bind(nowIso, SLA_BATCH).all<OverdueRow>();
  let reminded = 0;
  for (const conv of overdue.results) {
    const text = `Quá hạn trả lời: ${conv.display_name ?? conv.external_thread_id} (${conv.account_name}) – `
      + `${conv.assignee_name ?? 'chưa giao'} – ${base}/inbox/${conv.id}`;
    try {
      await enqueueCommand(db, {
        kind: 'send_lark', target: 'worker', conversationId: conv.id, payload: { text }, dedupeKey: `sla:${conv.id}:${conv.sla_due_at}`,
      });
      await db.prepare(`UPDATE conversation SET sla_due_at = ${slaDueSql('?1')} WHERE id = ?2 AND sla_due_at = ?3`)
        .bind(nowIso, conv.id, conv.sla_due_at).run();
      reminded += 1;
    } catch (error) {
      // One conversation failing must not hold back the reminders of the others.
      console.error('sla_reminder_error', error instanceof Error ? error.message : 'unknown');
    }
  }
  return reminded;
}

/** A login or logout the bridge never claimed is given up after this long. */
export const SESSION_COMMAND_STALE_MS = 3 * 60_000;

/**
 * Marks bridge session commands the bridge is not serving as failed with BRIDGE_OFFLINE:
 * a zalo_login or zalo_logout still pending and never attempted after 3 minutes, and a claimed
 * zalo_login whose lease has passed (the claim query would otherwise run that login again).
 * Send commands are left alone. Each command update is guarded. The account update follows it in
 * the same batch, so it runs only when that command row is actually failed and the account is not
 * connected. A login the bridge claimed in between stays claimed, and the account stays as it was.
 */
export async function failOfflineSessionCommands(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SESSION_COMMAND_STALE_MS).toISOString();
  const nowIso = now.toISOString();
  const stale = await db.prepare(`SELECT id, kind, channel_account_id, status FROM channel_command
    WHERE target = 'bridge' AND status = 'pending' AND attempts = 0 AND kind IN ('zalo_login', 'zalo_logout') AND created_at <= ?
    UNION ALL
    SELECT id, kind, channel_account_id, status FROM channel_command
    WHERE target = 'bridge' AND status = 'claimed' AND kind = 'zalo_login' AND lease_expires_at < ?`)
    .bind(cutoff, nowIso)
    .all<{ id: string; kind: string; channel_account_id: string | null; status: string }>();
  if (!stale.results.length) return 0;
  const result = JSON.stringify({ error: 'BRIDGE_OFFLINE' });
  const statements: D1PreparedStatement[] = [];
  for (const row of stale.results) {
    if (row.status === 'claimed') {
      statements.push(db.prepare(`UPDATE channel_command
          SET status = 'failed', result_json = ?, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND target = 'bridge' AND status = 'claimed' AND kind = 'zalo_login' AND lease_expires_at < ?`)
        .bind(result, nowIso, row.id, nowIso));
    } else {
      statements.push(db.prepare(`UPDATE channel_command
          SET status = 'failed', result_json = ?, updated_at = ?
        WHERE id = ? AND target = 'bridge' AND status = 'pending' AND attempts = 0`)
        .bind(result, nowIso, row.id));
    }
    if (row.kind === 'zalo_login' && row.channel_account_id) {
      statements.push(db.prepare(`UPDATE channel_account
          SET status = 'error', last_error = 'BRIDGE_OFFLINE', qr_image = NULL, qr_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status <> 'connected' AND EXISTS (SELECT 1 FROM channel_command WHERE id = ? AND status = 'failed')
          AND NOT EXISTS (SELECT 1 FROM channel_command WHERE channel_account_id = ? AND kind = 'zalo_login'
            AND status IN ('pending', 'claimed') AND id <> ?)`)
        .bind(nowIso, row.channel_account_id, row.id, row.channel_account_id, row.id));
    }
  }
  await db.batch(statements);
  return stale.results.length;
}

async function step(name: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    console.error('scheduled_task_error', name, error instanceof Error ? error.message : 'unknown');
  }
}

/** Entry point of the Cron Trigger: per-minute work, and the daily group summaries at 21:00 Vietnam time. */
export async function runScheduled(env: ScheduledEnv, cron: string, now = new Date()): Promise<void> {
  if (cron === DAILY_SUMMARY_CRON) {
    await step('group_summaries', () => enqueueDailyGroupSummaries(env.DB, now));
    return;
  }
  if (cron !== EVERY_MINUTE_CRON) return;
  // Before the Worker's commands, so the Lark notice of a handoff goes out in the same minute.
  await step('stale_replies', () => abandonStaleReplies(env.DB, env, now));
  await step('offline_session_commands', () => failOfflineSessionCommands(env.DB, now));
  await step('worker_commands', () => processWorkerCommands(env));
  await step('sla', () => checkSla(env.DB, now, env.APP_URL));
  await step('stuck_outgoing', () => sweepStuckOutgoing(env.DB, now));
  await step('extract_idle', () => extractIdleConversations(env.DB, now));
  await step('group_schedules', () => runDueSchedules(env.DB, now));
}
