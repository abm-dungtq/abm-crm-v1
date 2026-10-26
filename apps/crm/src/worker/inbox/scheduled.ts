import type { Env, Sink } from '../env';
import { postInboxNotice } from '../inbox-notices';
import { notifyRows } from '../notify';
import { linkBase, slaDueSql } from './assignment';
import { abandonStaleReplies, sweepStuckOutgoing } from './conversation-flow';
import { runDueSchedules } from './group-schedules';
import { enqueueDailyGroupSummaries } from './group-summaries';
import { extractIdleConversations } from './intake';
import { processWorkerCommands } from './worker-commands';
import { backfillOaSenderAvatars } from './zalo-oa-webhook';
import { refreshZaloOaTokens } from './zalo-oa-oauth';

/** Cron Trigger work. Every task logs and continues on failure, so the scheduled handler never throws. */

export const EVERY_MINUTE_CRON = '* * * * *';
/** 14:00 UTC = 21:00 Vietnam time. */
export const DAILY_SUMMARY_CRON = '0 14 * * *';
const SLA_BATCH = 50;

type ScheduledEnv = Pick<Env, 'DB' | 'MEDIA' | 'APP_URL' | 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>
  & Partial<Pick<Env, 'CHAT_HUB' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>>;

interface OverdueRow {
  id: string;
  organization_id: string;
  display_name: string | null;
  external_thread_id: string;
  sla_due_at: string;
  account_name: string;
  assignee_name: string | null;
}

/**
 * Reminds the CRM inbox group of direct `human` conversations whose customer has waited past the reply deadline,
 * then moves the deadline one reply window ahead. The reminder is deduplicated per conversation and
 * deadline, and the deadline moves only once the reminder is stored and only if nobody changed it meanwhile,
 * so a failed reminder is tried again next run. Returns the number of reminders.
 */
export async function checkSla(db: D1Database, sink: Sink, now = new Date(), appUrl?: string): Promise<number> {
  const nowIso = now.toISOString();
  const base = linkBase(appUrl);
  const overdue = await db.prepare(`SELECT c.id, c.organization_id, c.display_name, c.external_thread_id, c.sla_due_at, a.display_name AS account_name,
      u.display_name AS assignee_name
    FROM conversation c JOIN channel_account a ON a.id = c.channel_account_id LEFT JOIN app_user u ON u.id = c.assignee_user_id
    WHERE c.kind = 'direct' AND c.mode = 'human' AND c.sla_due_at IS NOT NULL AND c.sla_due_at < ?
    ORDER BY c.sla_due_at LIMIT ?`).bind(nowIso, SLA_BATCH).all<OverdueRow>();
  const ensuredOrgs = new Set<string>();
  let reminded = 0;
  for (const conv of overdue.results) {
    const text = `Quá hạn trả lời: ${conv.display_name ?? conv.external_thread_id} (${conv.account_name}) – `
      + `${conv.assignee_name ?? 'chưa giao'} – ${base}/inbox/${conv.id}`;
    try {
      const posted = await postInboxNotice(sink, db, {
        organizationId: conv.organization_id,
        text,
        link: `/inbox/${conv.id}`,
        dedupeKey: `sla:${conv.id}:${conv.sla_due_at}`,
        ensuredOrgs,
      });
      if (!posted) continue;
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

const DUE_TASK_BATCH = 5;
const DUE_TASK_WINDOW_MS = 30 * 60_000;
/** Web Push sends per cron run; the remaining due-task notices stay in-app only. */
const DUE_TASK_PUSH_LIMIT = 15;

/**
 * Notifies assignees of open/in_progress tasks due within the next 30 minutes.
 * Processes at most 5 tasks per run with one batched insert, one subscription read and at most 15 pushes;
 * the dedupe key drains any backlog on subsequent runs.
 */
export async function notifyDueTasks(sink: Sink, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + DUE_TASK_WINDOW_MS).toISOString();
  const rows = await sink.env.DB.prepare(`
    SELECT tk.id, tk.title, tk.due_at, tk.assignee_user_id, u.organization_id
    FROM task tk
    JOIN app_user u ON u.id = tk.assignee_user_id
    WHERE tk.status IN ('open', 'in_progress')
      AND tk.due_at IS NOT NULL
      AND tk.due_at >= ?1
      AND tk.due_at <= ?2
      AND u.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM notification n
        WHERE n.dedupe_key = ('task-due:' || tk.id || ':' || tk.due_at || ':' || tk.assignee_user_id)
      )
    ORDER BY tk.due_at ASC, tk.id ASC
    LIMIT ?3`)
    .bind(nowIso, untilIso, DUE_TASK_BATCH)
    .all<{
      id: string;
      title: string;
      due_at: string;
      assignee_user_id: string;
      organization_id: string;
    }>();

  await notifyRows(
    sink,
    rows.results.map((t) => ({
      organizationId: t.organization_id,
      userId: t.assignee_user_id,
      kind: 'task_due' as const,
      title: 'Việc sắp đến hạn',
      body: t.title,
      link: `/tasks/${t.id}`,
      dedupeKey: `task-due:${t.id}:${t.due_at}:${t.assignee_user_id}`,
    })),
    DUE_TASK_PUSH_LIMIT,
  );
  return rows.results.length;
}

/** Entry point of the Cron Trigger: per-minute work, and the daily group summaries at 21:00 Vietnam time. */
export async function runScheduled(
  env: ScheduledEnv,
  cron: string,
  ctxOrNow?: ExecutionContext | Date,
  maybeNow?: Date,
): Promise<void> {
  const now = ctxOrNow instanceof Date ? ctxOrNow : (maybeNow ?? new Date());
  const ctx = ctxOrNow && !(ctxOrNow instanceof Date) ? ctxOrNow : undefined;
  const sink: Sink = {
    env: env as Env,
    waitUntil: (w) => {
      if (ctx) {
        try {
          ctx.waitUntil(w);
          return;
        } catch {
          /* fall through */
        }
      }
      void w.catch(() => undefined);
    },
  };
  if (cron === DAILY_SUMMARY_CRON) {
    await step('group_summaries', () => enqueueDailyGroupSummaries(env.DB, now));
    return;
  }
  if (cron !== EVERY_MINUTE_CRON) return;
  await step('stale_replies', () => abandonStaleReplies(env.DB, env, now, sink));
  await step('offline_session_commands', () => failOfflineSessionCommands(env.DB, now));
  if (now.getUTCMinutes() % 10 === 0) {
    await step('zalo_oa_refresh', () => refreshZaloOaTokens(env.DB, env, now, sink));
  }
  await step('oa_avatar_backfill', () => backfillOaSenderAvatars(env.DB, env, now));
  await step('worker_commands', () => processWorkerCommands(env, sink));
  await step('sla', () => checkSla(env.DB, sink, now, env.APP_URL));
  await step('stuck_outgoing', () => sweepStuckOutgoing(env.DB, now));
  await step('extract_idle', () => extractIdleConversations(env.DB, now));
  await step('group_schedules', () => runDueSchedules(env.DB, now));
  await step('due_tasks', () => notifyDueTasks(sink, now));
}
