import { completeCommand, enqueueCommand, failCommand } from './dispatcher';
import { VN_OFFSET_MS, vnDate, vnDayStart } from './group-schedules';

/**
 * Daily group summaries: at 21:00 Vietnam time every group with summaries on and at least one customer message
 * today is sent to the `group-summarizer` agent (a fresh GoClaw session each time), and its answer is posted to
 * the Lark inbox group. A summary is never sent into the Zalo group.
 */

export const SUMMARY_AGENT_KEY = 'group-summarizer';
/** Messages of the day sent to the summarizer, newest last. */
export const SUMMARY_MESSAGE_COUNT = 300;
/** One message longer than this is cut, so a pasted document cannot crowd out the rest of the day. */
const LINE_MAX_CHARS = 1000;
const GROUP_BATCH = 500;

const SPEAKER: Record<string, string> = { bot: 'Tin tự động', staff_web: 'Nhân viên', staff_phone: 'Nhân viên' };

/** dd/mm of the Vietnam day that contains `at`. */
const dayMonth = (at: Date) => {
  const [, month, day] = vnDate(at).split('-');
  return `${day}/${month}`;
};

interface GroupRow { id: string; channel_account_id: string; display_name: string | null; external_thread_id: string }
interface LineRow { sender_kind: string; sender_external_id: string | null; body: string; created_at: string }

/** The day's latest 300 messages of a group (system notes left out), oldest first, as `HH:MM Speaker: text`. */
async function dayTranscript(db: D1Database, conversationId: string, sinceIso: string) {
  const rows = await db.prepare(`SELECT sender_kind, sender_external_id, body, created_at FROM message
    WHERE conversation_id = ? AND created_at >= ? AND sender_kind <> 'system'
    ORDER BY created_at DESC, rowid DESC LIMIT ?`).bind(conversationId, sinceIso, SUMMARY_MESSAGE_COUNT).all<LineRow>();
  return rows.results.reverse().map((m) => {
    const time = new Date(Date.parse(m.created_at) + VN_OFFSET_MS).toISOString().slice(11, 16);
    const who = m.sender_kind === 'customer' ? `Thành viên ${m.sender_external_id ?? '?'}` : SPEAKER[m.sender_kind] ?? 'Khác';
    const text = m.body.replace(/\s+/g, ' ').trim();
    return `${time} ${who}: ${text.length > LINE_MAX_CHARS ? `${text.slice(0, LINE_MAX_CHARS)}…` : text}`;
  });
}

/**
 * Cron `0 14 * * *`: queues one summary run per group with `summary_enabled = 1` that received a member message
 * since 00:00 Vietnam time today. The dedupe key holds the group and the day, so running twice queues one.
 * Returns how many groups were queued; one group failing is logged and does not hold back the others.
 */
export async function enqueueDailyGroupSummaries(db: D1Database, now = new Date()): Promise<number> {
  const since = vnDayStart(now).toISOString();
  const day = vnDate(now);
  const groups = await db.prepare(`SELECT c.id, c.channel_account_id, c.display_name, c.external_thread_id FROM conversation c
    WHERE c.kind = 'group' AND c.summary_enabled = 1
      AND EXISTS (SELECT 1 FROM message m WHERE m.conversation_id = c.id AND m.direction = 'in' AND m.created_at >= ?)
    ORDER BY c.id LIMIT ?`).bind(since, GROUP_BATCH).all<GroupRow>();
  let queued = 0;
  for (const group of groups.results) {
    try {
      const lines = await dayTranscript(db, group.id, since);
      await enqueueCommand(db, {
        kind: 'run_completion', target: 'bridge', channelAccountId: group.channel_account_id, conversationId: group.id,
        payload: {
          agentKey: SUMMARY_AGENT_KEY, userId: `group-summary:${crypto.randomUUID()}`, conversationId: group.id, purpose: 'group_summary',
          text: lines.join('\n'),
        },
        dedupeKey: `summary:${group.id}:${day}`,
      });
      queued += 1;
    } catch (error) {
      console.error('group_summary_enqueue_error', error instanceof Error ? error.message : 'unknown');
    }
  }
  return queued;
}

export interface SummaryCommand { id: string; attempts: number; conversationId: string | null }

/**
 * Applies the summarizer's answer for a claimed command: completes it and queues the Lark post
 * `Tóm tắt nhóm <group> (<account>) ngày <dd/mm>:\n<summary>`, dated by the day the summary was queued.
 * An empty answer fails the command. Returns false when the claim no longer owns the command (result dropped).
 */
export async function applyGroupSummaryResult(db: D1Database, command: SummaryCommand, text: string): Promise<boolean> {
  const summary = text.trim();
  if (!summary) return failCommand(db, command.id, command.attempts, 'SUMMARY_EMPTY');
  const row = command.conversationId
    ? await db.prepare(`SELECT c.id, c.display_name, c.external_thread_id, a.display_name AS account_name, cc.created_at AS queued_at
        FROM channel_command cc JOIN conversation c ON c.id = ? JOIN channel_account a ON a.id = c.channel_account_id
        WHERE cc.id = ?`).bind(command.conversationId, command.id)
      .first<{ id: string; display_name: string | null; external_thread_id: string; account_name: string; queued_at: string }>()
    : null;
  if (!row) return failCommand(db, command.id, command.attempts, 'INVALID_PAYLOAD');
  if (!(await completeCommand(db, command.id, command.attempts, { summarized: true }))) return false;
  const header = `Tóm tắt nhóm ${row.display_name ?? row.external_thread_id} (${row.account_name}) ngày ${dayMonth(new Date(row.queued_at))}:`;
  await enqueueCommand(db, {
    kind: 'send_lark', target: 'worker', conversationId: row.id, payload: { text: `${header}\n${summary}` }, dedupeKey: `summary-lark:${command.id}`,
  });
  return true;
}
