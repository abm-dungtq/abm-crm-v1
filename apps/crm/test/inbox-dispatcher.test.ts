import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import {
  accountSendsToday, cancelCommand, claimCommands, completeCommand, enqueueCommand, failCommand,
} from '../src/worker/inbox/dispatcher';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const STAMP = '2026-10-08T03:00:00.000Z';
const at = (iso: string) => new Date(iso);
const T0 = at('2026-10-08T03:00:00.000Z');
const plusSeconds = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch(['ca-1', 'ca-2'].map((id) => db.prepare(`INSERT INTO channel_account (id, organization_id, channel, display_name, created_at, updated_at)
    VALUES (?, 'org-abm', 'zalo', ?, ?, ?)`).bind(id, id, STAMP, STAMP)));
});

type Row = { status: string; attempts: number; next_run_at: string; lease_expires_at: string | null; result_json: string | null };
const row = async (id: string) =>
  (await db.prepare('SELECT status, attempts, next_run_at, lease_expires_at, result_json FROM channel_command WHERE id = ?').bind(id).first<Row>())!;

const enqueueSend = (dedupeKey: string | null = null, channelAccountId = 'ca-1') => enqueueCommand(db, {
  kind: 'send_zalo', target: 'bridge', channelAccountId, payload: { messageId: 'm-1', text: 'chào' }, dedupeKey, runAt: T0,
});

test('the same dedupe key creates one command and returns its id', async () => {
  const first = await enqueueSend('send:m-1');
  const second = await enqueueSend('send:m-1');
  expect(second).toBe(first);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE dedupe_key = 'send:m-1'").first<{ n: number }>();
  expect(count!.n).toBe(1);
  expect(await enqueueSend(null)).not.toBe(await enqueueSend(null));
  const pending = await row(first);
  expect(pending).toMatchObject({ status: 'pending', attempts: 0, next_run_at: T0.toISOString() });
});

test('a command is not claimed before its run time or by another target', async () => {
  const id = await enqueueSend();
  expect(await claimCommands(db, 'bridge', 10, 300, plusSeconds(T0, -1))).toEqual([]);
  expect(await claimCommands(db, 'worker', 10, 300, T0)).toEqual([]);
  const claimed = await claimCommands(db, 'bridge', 10, 300, T0);
  expect(claimed.map((c) => c.id)).toEqual([id]);
});

test('a command under a live lease is not claimed twice', async () => {
  const id = await enqueueSend();
  const claimed = await claimCommands(db, 'bridge', 10, 300, T0);
  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({
    id, kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: null, attempts: 1,
    payload: { messageId: 'm-1', text: 'chào' },
    claimedAt: T0.toISOString(), leaseExpiresAt: plusSeconds(T0, 300).toISOString(),
  });
  expect(await claimCommands(db, 'bridge', 10, 300, plusSeconds(T0, 299))).toEqual([]);
  expect(await row(id)).toMatchObject({ status: 'claimed', attempts: 1 });
});

test('the claim limit is respected', async () => {
  for (let i = 0; i < 3; i += 1) await enqueueSend(`k-${i}`);
  expect(await claimCommands(db, 'bridge', 2, 300, T0)).toHaveLength(2);
  expect(await claimCommands(db, 'bridge', 2, 300, T0)).toHaveLength(1);
  expect(await claimCommands(db, 'bridge', 2, 300, T0)).toHaveLength(0);
});

test('an expired lease is claimed again with the next attempt number', async () => {
  const id = await enqueueSend();
  await claimCommands(db, 'bridge', 10, 300, T0);
  const reclaimed = await claimCommands(db, 'bridge', 10, 300, plusSeconds(T0, 301));
  expect(reclaimed.map((c) => [c.id, c.attempts])).toEqual([[id, 2]]);
  expect(await row(id)).toMatchObject({ status: 'claimed', attempts: 2, lease_expires_at: plusSeconds(T0, 601).toISOString() });
});

test('a result from an expired lease is ignored and leaves the command unchanged', async () => {
  const id = await enqueueSend();
  const [stale] = await claimCommands(db, 'bridge', 10, 300, T0);
  const [current] = await claimCommands(db, 'bridge', 10, 300, plusSeconds(T0, 301));
  const before = await row(id);
  expect(await completeCommand(db, id, stale!.attempts, { ok: true })).toBe(false);
  expect(await failCommand(db, id, stale!.attempts, 'late failure', plusSeconds(T0, 302))).toBe(false);
  expect(await row(id)).toEqual(before);
  expect(await completeCommand(db, id, current!.attempts, { ok: true, externalMsgId: 'ext-9' })).toBe(true);
  expect(await row(id)).toMatchObject({ status: 'done', attempts: 2, result_json: JSON.stringify({ ok: true, externalMsgId: 'ext-9' }) });
  expect(await completeCommand(db, id, current!.attempts, { ok: true })).toBe(false);
  expect(await claimCommands(db, 'bridge', 10, 300, plusSeconds(T0, 10_000))).toEqual([]);
});

test('a failed attempt backs off 2^attempts minutes and the fifth failure is final', async () => {
  const id = await enqueueSend();
  let now = T0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const [claimed] = await claimCommands(db, 'bridge', 10, 300, now);
    expect(claimed!.attempts).toBe(attempt);
    expect(await failCommand(db, id, attempt, `lỗi ${attempt}`, now)).toBe(true);
    const after = await row(id);
    if (attempt < 5) {
      const nextRunAt = new Date(now.getTime() + 2 ** attempt * 60_000);
      expect(after).toMatchObject({ status: 'pending', attempts: attempt, next_run_at: nextRunAt.toISOString(), lease_expires_at: null });
      if (attempt === 1) expect(after.next_run_at).toBe('2026-10-08T03:02:00.000Z');
      expect(await claimCommands(db, 'bridge', 10, 300, plusSeconds(nextRunAt, -1))).toEqual([]);
      now = nextRunAt;
    } else {
      expect(after).toMatchObject({ status: 'failed', attempts: 5, result_json: JSON.stringify({ error: 'lỗi 5' }) });
    }
  }
  expect(await claimCommands(db, 'bridge', 10, 300, plusSeconds(now, 86_400))).toEqual([]);
});

test('only a pending command can be cancelled', async () => {
  const pending = await enqueueSend('a');
  const claimed = await enqueueSend('b');
  await claimCommands(db, 'bridge', 1, 300, T0);
  expect((await row(pending)).status).toBe('claimed');
  expect(await cancelCommand(db, pending, 'cancelled')).toBe(false);
  expect(await cancelCommand(db, claimed, 'account removed')).toBe(true);
  expect(await row(claimed)).toMatchObject({ status: 'failed', result_json: JSON.stringify({ error: 'account removed' }) });
});

test('daily sends count waiting, claimed and done sends of one account since the day start', async () => {
  const dayStart = '2026-10-07T17:00:00.000Z';
  const yesterday = at('2026-10-07T16:59:00.000Z');
  const old = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', payload: {}, dedupeKey: 'old', runAt: yesterday });
  await claimCommands(db, 'bridge', 10, 300, yesterday);
  expect(await completeCommand(db, old, 1, { ok: true })).toBe(true);

  const done = await enqueueSend('done');
  const claimed = await enqueueSend('claimed');
  const failed = await enqueueSend('failed');
  await enqueueSend('pending');
  await enqueueSend('other-account', 'ca-2');
  await enqueueCommand(db, { kind: 'send_lark', target: 'bridge', channelAccountId: 'ca-1', payload: {}, dedupeKey: 'lark', runAt: T0 });
  await enqueueCommand(db, { kind: 'send_messenger', target: 'worker', channelAccountId: 'ca-1', payload: {}, dedupeKey: 'fb', runAt: T0 });

  expect(await claimCommands(db, 'bridge', 100, 300, T0)).toHaveLength(6);
  expect(await claimCommands(db, 'worker', 100, 300, T0)).toHaveLength(1);
  expect(await completeCommand(db, done, 1, { ok: true })).toBe(true);
  // A send that failed for good today does not count; one that went back to waiting still does.
  await db.prepare("UPDATE channel_command SET status = 'failed', attempts = 5 WHERE id = ?").bind(failed).run();
  await db.prepare("UPDATE channel_command SET status = 'pending', claimed_at = NULL, created_at = ? WHERE dedupe_key = 'pending'").bind(STAMP).run();

  expect((await row(claimed)).status).toBe('claimed');
  // done + claimed + pending + messenger; excludes yesterday, failed, the other account and Lark.
  expect(await accountSendsToday(db, 'ca-1', dayStart)).toBe(4);
  expect(await accountSendsToday(db, 'ca-2', dayStart)).toBe(1);
});

test('sends queued while the bridge is offline count toward the daily cap by creation time', async () => {
  const dayStart = '2026-10-07T17:00:00.000Z';
  // Never claimed: the bridge has not polled since they were queued.
  await enqueueSend('waiting-1');
  await enqueueSend('waiting-2');
  await db.prepare("UPDATE channel_command SET created_at = ? WHERE dedupe_key LIKE 'waiting-%'").bind(STAMP).run();
  expect(await accountSendsToday(db, 'ca-1', dayStart)).toBe(2);
  // A send still waiting from before the day start is yesterday's.
  await enqueueSend('waiting-old');
  await db.prepare("UPDATE channel_command SET created_at = '2026-10-07T16:59:00.000Z' WHERE dedupe_key = 'waiting-old'").run();
  expect(await accountSendsToday(db, 'ca-1', dayStart)).toBe(2);
  // Once claimed, the claim time decides.
  await claimCommands(db, 'bridge', 100, 300, T0);
  expect(await accountSendsToday(db, 'ca-1', dayStart)).toBe(3);
  expect(await accountSendsToday(db, 'ca-1', '2026-10-08T17:00:00.000Z')).toBe(0);
});
