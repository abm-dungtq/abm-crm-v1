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
 * Reminds the Lark inbox group of `human` conversations whose customer has waited past the reply deadline,
 * then moves the deadline one reply window ahead. The reminder is deduplicated per conversation and
 * deadline, and the deadline moves only if nobody changed it meanwhile. Returns the number of reminders.
 */
export async function checkSla(db: D1Database, now = new Date(), appUrl?: string): Promise<number> {
  const nowIso = now.toISOString();
  const base = linkBase(appUrl);
  const overdue = await db.prepare(`SELECT c.id, c.display_name, c.external_thread_id, c.sla_due_at, a.display_name AS account_name,
      u.display_name AS assignee_name
    FROM conversation c JOIN channel_account a ON a.id = c.channel_account_id LEFT JOIN app_user u ON u.id = c.assignee_user_id
    WHERE c.mode = 'human' AND c.sla_due_at IS NOT NULL AND c.sla_due_at < ?
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
  await step('worker_commands', () => processWorkerCommands(env));
  await step('sla', () => checkSla(env.DB, now, env.APP_URL));
  await step('stuck_outgoing', () => sweepStuckOutgoing(env.DB, now));
  await step('extract_idle', () => extractIdleConversations(env.DB, now));
  await step('group_schedules', () => runDueSchedules(env.DB, now));
}
