import type { ApiResult } from '@abm/contracts';
import { fail, ok } from '../command-result';
import type { Actor } from '../env';
import { MANAGER_ROLES } from './assignment';
import { accountSendsToday } from './dispatcher';

/**
 * Recurring posts into Zalo groups that have customers. A schedule runs only after a manager other than its
 * author approved it, and every run passes the anti-ban guards in order: the organization-wide switch, the
 * customer bot switch, a connected and unpaused account, the group not opted out, the account's quiet hours,
 * and the account's daily send cap. A failed guard never queues anything; it records why and moves the run.
 */

/** Vietnam time is UTC+7 all year. */
export const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
/** Each run is moved by a random 0–10 whole minutes so posts do not go out on the exact minute. */
export const MAX_JITTER_MINUTES = 10;
/** Quiet hours of an account that has none configured. */
export const DEFAULT_QUIET_START = '21:00';
export const DEFAULT_QUIET_END = '08:00';
export const SCHEDULE_TEXT_MAX = 2000;
const RUN_BATCH = 50;

export const SCHEDULE_STATUSES = ['draft', 'pending_approval', 'active', 'paused'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type SkipReason = 'feature_off' | 'bot_switch_on' | 'account_unavailable' | 'group_opted_out' | 'quiet_hours' | 'daily_cap';
export type Random = () => number;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm: string) {
  const match = HHMM.exec(hhmm);
  if (!match) throw new Error(`invalid HH:MM time: ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** yyyy-mm-dd of the Vietnam calendar day that contains `at`. */
export const vnDate = (at: Date) => new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/** Start (00:00 Vietnam time) of the Vietnam calendar day that contains `at`. */
export function vnDayStart(at: Date) {
  const shifted = at.getTime() + VN_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - VN_OFFSET_MS);
}

const jitterMs = (random: Random) => {
  const r = Math.min(Math.max(random(), 0), 0.999_999);
  return Math.floor(r * (MAX_JITTER_MINUTES + 1)) * 60_000;
};

/**
 * The first instant after `from` that matches the schedule — a weekday in `mask` (bit 0 = Monday … bit 6 =
 * Sunday) at `timeOfDay` (HH:MM Vietnam time) — plus a random 0–10 minutes. Returns an ISO UTC instant.
 */
export function computeNextRun(mask: number, timeOfDay: string, from: Date, random: Random = Math.random): string {
  if (!Number.isInteger(mask) || mask < 1 || mask > 127) throw new Error('weekdays mask must be 1..127');
  const offset = minutesOf(timeOfDay) * 60_000;
  const firstDay = vnDayStart(from).getTime();
  for (let i = 0; i <= 7; i += 1) {
    const day = firstDay + i * DAY_MS;
    const candidate = day + offset;
    const weekday = (new Date(day + VN_OFFSET_MS).getUTCDay() + 6) % 7;
    if (candidate > from.getTime() && (mask & (1 << weekday)) !== 0) return new Date(candidate + jitterMs(random)).toISOString();
  }
  throw new Error('no matching day within a week');
}

/** When `now` falls inside the account's quiet hours, the instant they end; otherwise null. */
export function quietHoursEnd(quietStart: string | null, quietEnd: string | null, now: Date): Date | null {
  const start = minutesOf(quietStart ?? DEFAULT_QUIET_START);
  const end = minutesOf(quietEnd ?? DEFAULT_QUIET_END);
  if (start === end) return null;
  const minute = Math.floor((now.getTime() - vnDayStart(now).getTime()) / 60_000);
  const quiet = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!quiet) return null;
  let endAt = vnDayStart(now).getTime() + end * 60_000;
  if (endAt <= now.getTime()) endAt += DAY_MS;
  return new Date(endAt);
}

// ---------- running due schedules ----------

interface DueRow {
  id: string;
  conversation_id: string;
  template_text: string;
  weekdays_mask: number;
  time_of_day: string;
  next_run_at: string;
  external_thread_id: string;
  scheduled_opt_out: number;
  channel_account_id: string;
  account_status: string;
  send_paused: number;
  daily_send_cap: number;
  quiet_start: string | null;
  quiet_end: string | null;
  feature: number | null;
  bot_switch: number | null;
}

/** Guards 1–4: a failed one skips this run entirely. */
function blockedReason(row: DueRow): SkipReason | null {
  if (row.feature !== 1) return 'feature_off';
  if (row.bot_switch !== 0) return 'bot_switch_on';
  if (row.account_status !== 'connected' || row.send_paused !== 0) return 'account_unavailable';
  if (row.scheduled_opt_out !== 0) return 'group_opted_out';
  return null;
}

/** Moves a due run without sending; compare-and-set on the run time so a concurrent cron changes it once. */
const moveRun = (db: D1Database, row: DueRow, nextRunAt: string, reason: SkipReason, now: string) =>
  db.prepare(`UPDATE group_schedule SET next_run_at = ?, last_skip_reason = ?, updated_at = ?
    WHERE id = ? AND status = 'active' AND next_run_at = ?`).bind(nextRunAt, reason, now, row.id, row.next_run_at).run();

/**
 * Takes the run (compare-and-set on its run time), then inserts the outgoing group message and its `send_zalo`
 * command in the same batch. Both run only for the cron that took the run, and only when no command with the
 * day's dedupe key exists yet, so a schedule posts at most once per Vietnam day. True when a send was queued.
 */
async function queueRun(db: D1Database, row: DueRow, now: Date, nextRunAt: string) {
  const nowIso = now.toISOString();
  const messageId = crypto.randomUUID();
  const dedupeKey = `schedule:${row.id}:${vnDate(now)}`;
  const payload = { messageId, threadId: row.external_thread_id, threadKind: 'group', text: row.template_text };
  const guard = 'EXISTS (SELECT 1 FROM group_schedule WHERE id = ? AND last_run_at = ? AND next_run_at = ?)';
  const guardBinds = [row.id, nowIso, nextRunAt];
  const results = await db.batch([
    db.prepare(`UPDATE group_schedule SET last_run_at = ?, next_run_at = ?, last_skip_reason = NULL, updated_at = ?
      WHERE id = ? AND status = 'active' AND next_run_at = ?`).bind(nowIso, nextRunAt, nowIso, row.id, row.next_run_at),
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
      SELECT ?, ?, 'out', 'bot', ?, 'pending', ?
      WHERE ${guard} AND NOT EXISTS (SELECT 1 FROM channel_command WHERE dedupe_key = ?)`)
      .bind(messageId, row.conversation_id, row.template_text, nowIso, ...guardBinds, dedupeKey),
    db.prepare(`INSERT INTO channel_command
        (id, kind, target, channel_account_id, conversation_id, payload_json, next_run_at, dedupe_key, created_at, updated_at)
      SELECT ?, 'send_zalo', 'bridge', ?, ?, ?, ?, ?, ?, ?
      WHERE ${guard} AND EXISTS (SELECT 1 FROM message WHERE id = ?)
      ON CONFLICT(dedupe_key) DO NOTHING`)
      .bind(crypto.randomUUID(), row.channel_account_id, row.conversation_id, JSON.stringify(payload), nowIso, dedupeKey, nowIso, nowIso,
        ...guardBinds, messageId),
    db.prepare('UPDATE conversation SET last_message_at = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM message WHERE id = ?)')
      .bind(nowIso, nowIso, row.conversation_id, messageId),
  ]);
  return results[2]!.meta.changes === 1;
}

export interface RunSummary { sent: number; skipped: number }

/**
 * Cron, every minute: runs every active schedule whose run time has come. Guards 1–4 failing skip the run to
 * the next scheduled time; quiet hours move it to their end; a reached daily cap moves it to the next scheduled
 * day. Otherwise one `send_zalo` group command is queued. Each schedule is handled on its own; a failure is logged.
 */
export async function runDueSchedules(db: D1Database, now = new Date(), random: Random = Math.random): Promise<RunSummary> {
  const nowIso = now.toISOString();
  const due = await db.prepare(`SELECT s.id, s.conversation_id, s.template_text, s.weekdays_mask, s.time_of_day, s.next_run_at,
      c.external_thread_id, c.scheduled_opt_out, c.channel_account_id,
      a.status AS account_status, a.send_paused, a.daily_send_cap, a.quiet_start, a.quiet_end,
      (SELECT scheduled_sends_enabled FROM inbox_setting WHERE id = 1) AS feature,
      (SELECT enabled FROM customer_bot_switch WHERE id = 1) AS bot_switch
    FROM group_schedule s JOIN conversation c ON c.id = s.conversation_id JOIN channel_account a ON a.id = c.channel_account_id
    WHERE s.status = 'active' AND s.next_run_at IS NOT NULL AND s.next_run_at <= ?
    ORDER BY s.next_run_at LIMIT ?`).bind(nowIso, RUN_BATCH).all<DueRow>();
  const summary: RunSummary = { sent: 0, skipped: 0 };
  for (const row of due.results) {
    try {
      const blocked = blockedReason(row);
      if (blocked) {
        await moveRun(db, row, computeNextRun(row.weekdays_mask, row.time_of_day, now, random), blocked, nowIso);
        summary.skipped += 1;
        continue;
      }
      const quietEnd = quietHoursEnd(row.quiet_start, row.quiet_end, now);
      if (quietEnd) {
        await moveRun(db, row, new Date(quietEnd.getTime() + jitterMs(random)).toISOString(), 'quiet_hours', nowIso);
        summary.skipped += 1;
        continue;
      }
      const dayStart = vnDayStart(now);
      if (await accountSendsToday(db, row.channel_account_id, dayStart.toISOString()) >= row.daily_send_cap) {
        // The first scheduled time on a later Vietnam day, when the cap has reset.
        const lastMomentToday = new Date(dayStart.getTime() + DAY_MS - 1);
        await moveRun(db, row, computeNextRun(row.weekdays_mask, row.time_of_day, lastMomentToday, random), 'daily_cap', nowIso);
        summary.skipped += 1;
        continue;
      }
      if (await queueRun(db, row, now, computeNextRun(row.weekdays_mask, row.time_of_day, now, random))) summary.sent += 1;
    } catch (error) {
      console.error('group_schedule_run_error', row.id, error instanceof Error ? error.message : 'unknown');
    }
  }
  return summary;
}

// ---------- lifecycle ----------

export interface ScheduleView {
  id: string;
  conversationId: string;
  conversationName: string | null;
  externalThreadId: string;
  channelAccountId: string;
  accountName: string;
  templateText: string;
  weekdaysMask: number;
  timeOfDay: string;
  status: ScheduleStatus;
  createdByUserId: string | null;
  createdByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSkipReason: SkipReason | null;
  createdAt: string;
  updatedAt: string;
}

const SCHEDULE_SELECT = `SELECT s.id, s.conversation_id AS conversationId, c.display_name AS conversationName,
    c.external_thread_id AS externalThreadId, c.channel_account_id AS channelAccountId, a.display_name AS accountName,
    s.template_text AS templateText, s.weekdays_mask AS weekdaysMask, s.time_of_day AS timeOfDay, s.status,
    s.created_by_user_id AS createdByUserId, cu.display_name AS createdByName, s.approved_by_user_id AS approvedByUserId,
    au.display_name AS approvedByName, s.approved_at AS approvedAt, s.next_run_at AS nextRunAt, s.last_run_at AS lastRunAt,
    s.last_skip_reason AS lastSkipReason, s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM group_schedule s
  JOIN conversation c ON c.id = s.conversation_id
  JOIN channel_account a ON a.id = c.channel_account_id
  LEFT JOIN app_user cu ON cu.id = s.created_by_user_id
  LEFT JOIN app_user au ON au.id = s.approved_by_user_id`;

/** A schedule of the actor's organization. */
export const getSchedule = (db: D1Database, actor: Actor, id: string) =>
  db.prepare(`${SCHEDULE_SELECT} WHERE s.id = ? AND c.organization_id = ?`).bind(id, actor.organizationId).first<ScheduleView>();

/** Schedules of the organization, optionally of one group, newest first. */
export async function listSchedules(db: D1Database, actor: Actor, conversationId?: string): Promise<ScheduleView[]> {
  const rows = conversationId
    ? await db.prepare(`${SCHEDULE_SELECT} WHERE c.organization_id = ? AND s.conversation_id = ? ORDER BY s.created_at DESC, s.id`)
      .bind(actor.organizationId, conversationId).all<ScheduleView>()
    : await db.prepare(`${SCHEDULE_SELECT} WHERE c.organization_id = ? ORDER BY s.created_at DESC, s.id LIMIT 500`)
      .bind(actor.organizationId).all<ScheduleView>();
  return rows.results;
}

const auditSchedule = (db: D1Database, actor: Actor, command: string, id: string, before: unknown, after: unknown, now: string) =>
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, 'group_schedule', ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor.id, actor.kind, command, id,
    JSON.stringify(before), JSON.stringify(after), now);

const scheduleNotFound = () => fail('NOT_FOUND', 'Không tìm thấy lịch trong phạm vi của bạn');
const wrongStatus = () => fail('STALE_VERSION', 'Lịch không ở trạng thái cho phép thao tác này. Tải lại để xem bản mới nhất.');
const notAllowed = (message: string) => fail('FORBIDDEN', message);

/** The author of a schedule and managers may change it. */
const mayManage = (actor: Actor, schedule: ScheduleView) => schedule.createdByUserId === actor.id || MANAGER_ROLES.has(actor.role);

export interface ScheduleContent { templateText: string; weekdaysMask: number; timeOfDay: string }
export type SaveScheduleRequest =
  | ({ id?: undefined; conversationId: string } & ScheduleContent)
  | ({ id: string } & Partial<ScheduleContent>);

function invalidContent(content: Partial<ScheduleContent>) {
  const fields: Record<string, string> = {};
  if (content.templateText !== undefined && (!content.templateText.trim() || content.templateText.length > SCHEDULE_TEXT_MAX)) {
    fields.templateText = `Cần 1–${SCHEDULE_TEXT_MAX} ký tự`;
  }
  if (content.weekdaysMask !== undefined && (!Number.isInteger(content.weekdaysMask) || content.weekdaysMask < 1 || content.weekdaysMask > 127)) {
    fields.weekdaysMask = 'Chọn ít nhất một ngày';
  }
  if (content.timeOfDay !== undefined && !HHMM.test(content.timeOfDay)) fields.timeOfDay = 'Định dạng HH:MM';
  return Object.keys(fields).length ? fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', { fields }) : null;
}

/**
 * Creates a draft schedule for a group of the organization (any inbox role), or edits one (its author or a
 * manager). Editing the text or the timing of an active or paused schedule sends it back for approval.
 */
export async function saveSchedule(db: D1Database, actor: Actor, request: SaveScheduleRequest): Promise<ApiResult<ScheduleView>> {
  const invalid = invalidContent(request);
  if (invalid) return invalid;
  const now = new Date().toISOString();

  if (request.id === undefined) {
    const conv = await db.prepare('SELECT id, kind FROM conversation WHERE id = ? AND organization_id = ?')
      .bind(request.conversationId, actor.organizationId).first<{ id: string; kind: string }>();
    if (!conv) return fail('NOT_FOUND', 'Không tìm thấy nhóm trong phạm vi của bạn');
    if (conv.kind !== 'group') {
      return fail('VALIDATION_FAILED', 'Chỉ đặt lịch cho nhóm Zalo', { fields: { conversationId: 'Không phải nhóm' } });
    }
    const id = crypto.randomUUID();
    const content = { templateText: request.templateText, weekdaysMask: request.weekdaysMask, timeOfDay: request.timeOfDay };
    await db.batch([
      db.prepare(`INSERT INTO group_schedule (id, conversation_id, template_text, weekdays_mask, time_of_day, status, created_by_user_id,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
        .bind(id, conv.id, content.templateText, content.weekdaysMask, content.timeOfDay, actor.id, now, now),
      auditSchedule(db, actor, 'inbox.createGroupSchedule', id, null, { conversationId: conv.id, ...content, status: 'draft' }, now),
    ]);
    return ok((await getSchedule(db, actor, id))!);
  }

  const current = await getSchedule(db, actor, request.id);
  if (!current) return scheduleNotFound();
  if (!mayManage(actor, current)) return notAllowed('Chỉ người tạo lịch hoặc quản lý được sửa lịch');
  const next: ScheduleContent = {
    templateText: request.templateText ?? current.templateText,
    weekdaysMask: request.weekdaysMask ?? current.weekdaysMask,
    timeOfDay: request.timeOfDay ?? current.timeOfDay,
  };
  const before: ScheduleContent = { templateText: current.templateText, weekdaysMask: current.weekdaysMask, timeOfDay: current.timeOfDay };
  const changed = next.templateText !== before.templateText || next.weekdaysMask !== before.weekdaysMask || next.timeOfDay !== before.timeOfDay;
  if (!changed) return ok(current);
  // An approval covers the exact text and timing; any change needs a new one.
  const reapprove = current.status === 'active' || current.status === 'paused';
  const status: ScheduleStatus = reapprove ? 'pending_approval' : current.status;
  const res = await db.prepare(`UPDATE group_schedule SET template_text = ?1, weekdays_mask = ?2, time_of_day = ?3, status = ?4,
      approved_by_user_id = CASE WHEN ?5 = 1 THEN NULL ELSE approved_by_user_id END,
      approved_at = CASE WHEN ?5 = 1 THEN NULL ELSE approved_at END,
      next_run_at = CASE WHEN ?5 = 1 THEN NULL ELSE next_run_at END,
      updated_at = ?6 WHERE id = ?7 AND status = ?8 AND updated_at = ?9`)
    .bind(next.templateText, next.weekdaysMask, next.timeOfDay, status, reapprove ? 1 : 0, now, current.id, current.status, current.updatedAt)
    .run();
  if (res.meta.changes !== 1) return wrongStatus();
  await auditSchedule(db, actor, 'inbox.updateGroupSchedule', current.id, { ...before, status: current.status }, { ...next, status }, now).run();
  return ok((await getSchedule(db, actor, current.id))!);
}

/**
 * Compare-and-set of a schedule from one of `from` to `to`, with extra columns, then an audit row.
 * Returns the schedule after the move, or the reason it did not move.
 */
async function moveSchedule(db: D1Database, actor: Actor, current: ScheduleView, from: readonly ScheduleStatus[], to: ScheduleStatus,
  command: string, set: { sql: string; binds: unknown[] } = { sql: '', binds: [] }): Promise<ApiResult<ScheduleView>> {
  if (!from.includes(current.status)) return wrongStatus();
  const now = new Date().toISOString();
  const res = await db.prepare(`UPDATE group_schedule SET status = ?, updated_at = ?${set.sql}
    WHERE id = ? AND status = ? AND updated_at = ?`).bind(to, now, ...set.binds, current.id, current.status, current.updatedAt).run();
  if (res.meta.changes !== 1) return wrongStatus();
  await auditSchedule(db, actor, command, current.id, { status: current.status }, { status: to }, now).run();
  return ok((await getSchedule(db, actor, current.id))!);
}

/** Draft → pending approval, by its author or a manager. */
export async function submitSchedule(db: D1Database, actor: Actor, id: string): Promise<ApiResult<ScheduleView>> {
  const current = await getSchedule(db, actor, id);
  if (!current) return scheduleNotFound();
  if (!mayManage(actor, current)) return notAllowed('Chỉ người tạo lịch hoặc quản lý được gửi duyệt');
  return moveSchedule(db, actor, current, ['draft'], 'pending_approval', 'inbox.submitGroupSchedule');
}

/**
 * Pending approval (or paused, to resume) → active, by a leader, head, director or admin who is not the author.
 * The first run is computed from now.
 */
export async function approveSchedule(db: D1Database, actor: Actor, id: string, now = new Date(), random: Random = Math.random):
  Promise<ApiResult<ScheduleView>> {
  const current = await getSchedule(db, actor, id);
  if (!current) return scheduleNotFound();
  if (!MANAGER_ROLES.has(actor.role)) return notAllowed('Chỉ trưởng nhóm, trưởng phòng, giám đốc hoặc quản trị được duyệt lịch');
  if (current.createdByUserId === actor.id) return notAllowed('Người tạo lịch không tự duyệt được');
  const nextRunAt = computeNextRun(current.weekdaysMask, current.timeOfDay, now, random);
  return moveSchedule(db, actor, current, ['pending_approval', 'paused'], 'active', 'inbox.approveGroupSchedule', {
    sql: ', approved_by_user_id = ?, approved_at = ?, next_run_at = ?, last_skip_reason = NULL',
    binds: [actor.id, now.toISOString(), nextRunAt],
  });
}

/** Active → paused, by its author or a manager. */
export async function pauseSchedule(db: D1Database, actor: Actor, id: string): Promise<ApiResult<ScheduleView>> {
  const current = await getSchedule(db, actor, id);
  if (!current) return scheduleNotFound();
  if (!mayManage(actor, current)) return notAllowed('Chỉ người tạo lịch hoặc quản lý được tạm dừng');
  return moveSchedule(db, actor, current, ['active'], 'paused', 'inbox.pauseGroupSchedule', { sql: ', next_run_at = NULL', binds: [] });
}

/** Deletes a schedule in any status, by its author or a manager. Posts already queued are not withdrawn. */
export async function deleteSchedule(db: D1Database, actor: Actor, id: string): Promise<ApiResult<{ id: string }>> {
  const current = await getSchedule(db, actor, id);
  if (!current) return scheduleNotFound();
  if (!mayManage(actor, current)) return notAllowed('Chỉ người tạo lịch hoặc quản lý được xoá lịch');
  const now = new Date().toISOString();
  const res = await db.prepare('DELETE FROM group_schedule WHERE id = ? AND updated_at = ?').bind(current.id, current.updatedAt).run();
  if (res.meta.changes !== 1) return wrongStatus();
  await auditSchedule(db, actor, 'inbox.deleteGroupSchedule', current.id,
    { status: current.status, conversationId: current.conversationId, templateText: current.templateText }, null, now).run();
  return ok({ id: current.id });
}
