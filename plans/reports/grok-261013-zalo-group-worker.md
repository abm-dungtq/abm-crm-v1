# Phase 2 report: worker group replies

Phase: `plans/261013-1546-zalo-group-learner-care/phase-02-worker-group-replies.md`
Task: 2.9
Verify that failed:

- `pnpm -F @abm/crm test` must exit 0, with all tests passed apart from the pre-existing skipped ones.
- `pnpm -F @abm/crm typecheck` must exit 0.

Both commands were run from `D:\TQD\CRM` after the phase 2 edits. Both exited 1. No code was edited after either failure.

## What changed

`apps/crm/src/worker/inbox/group-schedules.ts` was not edited. The daily-cap exclusion is only in `accountSendsToday` (`dispatcher.ts`).

- `apps/crm/migrations/0019_zalo_group_bot.sql` (untracked): adds `conversation.bot_reply_enabled` (default 0), `group_agent_key`, `bot_paused_until`, tables `zalo_group_member` and `zalo_staff_member`, and `UPDATE conversation SET mode = 'ai', staff_context_pending = NULL WHERE kind = 'group'`.
- `apps/crm/src/worker/inbox/conversation-flow.ts` (+214/−, part of the worker diff): group gate `groupBotMayReply`, `scheduleGroupReply` (no 8s coalesce), `cancelPendingGroupReplies`, group branch in `applyCompletionResult` before `botMayReply`, `notifyGroupHelp` (loads the conversation by id), group `staffSend` pause without changing mode or assignee, stale-reply path notifies groups and still hands off direct chats. `queueOutgoing` stores `@${senderName} ${text}` when `replyTo` has a non-blank name. Direct `botMayReply` is unchanged.
- `apps/crm/src/worker/inbox/ingest.ts`: group messages take a separate path (mention, quote, or NFC "Long ơi"); staff members cancel pending replies; a non-echo `fromSelf` pauses that group for 30 minutes and leaves `mode` at `ai`. `ingestGroupMembers` upserts the roster. `ingestEvents` no longer skips `group_members`.
- `apps/crm/src/worker/inbox/bridge-routes.ts`: last failed group reply calls `notifyGroupHelp`; direct still uses `handOffSilentBot`. Success passes the parsed completion payload, including `commandId`, into `applyCompletionResult`.
- `apps/crm/src/worker/inbox/dispatcher.ts`: `accountSendsToday` excludes a `send_zalo` whose message is `sender_kind = 'bot'` in a `kind = 'group'` conversation. That join also excludes scheduled group posts, which `queueRun` stores as bot messages.
- `apps/crm/src/worker/inbox/inbox-routes.ts`: group PATCH accepts `botReplyEnabled` (leader or admin) and `agentKey` (admin); GET members returns `isStaff`; PUT staff requires a `zalo_group_member` row and `settingsManager`.
- `apps/crm/test/inbox-flow.test.ts`: the plain group message case still expects no `run_completion` (`mentionsSelf` false, `quotesSelf` false, text `Mai học bài gì ạ`).
- `apps/crm/test/inbox-group-bot.test.ts` (untracked): cases (a)–(j), echo, web staff send, unicode, failed and stale Lark notices, and the daily cap.

`test/helpers/reset-db.ts` was not edited. No commit, push, deploy, or wrangler.

Task 2.1 (`pnpm -F @abm/crm test -- inbox-groups`) was run before these TypeScript edits and exited 0. pnpm did not filter the file; vitest ran the whole suite (464 passed, 2 skipped) and `inbox-groups` passed, so migration 0019 applied.

## Verify results

Commands, in order, from `D:\TQD\CRM`:

1. `pnpm -F @abm/crm typecheck` — exit 1. Pass condition was exit 0.
2. `pnpm -F @abm/crm test` — exit 1. Pass condition was exit 0 with only pre-existing skips. Result: 2 failed, 477 passed, 2 skipped (481). Files: 1 failed, 37 passed, 1 skipped (39). Duration 42.65s. Start 17:06:01.

Stopped. Did not edit, retry, or run another command against the suite.

### Failed command: typecheck

```text
pnpm -F @abm/crm typecheck
```

Full output:

```text
$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit
src/worker/inbox/inbox-routes.ts:599:44 - error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.

599   const group = await loadGroup(db, actor, c.req.param('id'));
                                               ~~~~~~~~~~~~~~~~~

test/inbox-group-bot.test.ts:268:23 - error TS2352: Conversion of type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' to type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' is missing the following properties from type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }': threadKind, msgId, fromSelf, senderExternalId, and 5 more.

268   expect(await ingest({
                          ~
269     type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'g-1', members,
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
270   } as ReturnType<typeof groupMessage>)).toEqual({ accepted: 1, rejected: 0 });
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

test/inbox-group-bot.test.ts:272:16 - error TS2352: Conversion of type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' to type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' is missing the following properties from type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }': threadKind, msgId, fromSelf, senderExternalId, and 5 more.

272   await ingest({
                   ~
273     type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'g-1',
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
274     members: [{ id: 'm-0', name: 'Lan updated' }, { id: 'm-new', name: 'Mới' }],
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
275   } as ReturnType<typeof groupMessage>);
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

test/inbox-group-bot.test.ts:279:23 - error TS2352: Conversion of type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' to type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' is missing the following properties from type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }': threadKind, msgId, fromSelf, senderExternalId, and 5 more.

279   expect(await ingest({
                          ~
280     type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'missing-group', members: [{ id: 'x', name: 'X' }],
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
281   } as ReturnType<typeof groupMessage>)).toEqual({ accepted: 1, rejected: 0 });
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

test/inbox-group-bot.test.ts:298:16 - error TS2352: Conversion of type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' to type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ type: "group_members"; accountExternalId: string; threadId: string; members: { id: string; name: string; }[]; }' is missing the following properties from type '{ type: 'message'; accountExternalId: string; threadId: string; threadKind: 'group'; msgId: string; fromSelf: boolean; senderExternalId: string; senderName: string; text: string; sentAt: string; mentionsSelf: boolean; quotesSelf: boolean; }': threadKind, msgId, fromSelf, senderExternalId, and 5 more.

298   await ingest({
                   ~
299     type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'g-1',
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
300     members: [{ id: 'hv-an', name: 'An' }, { id: 'hv-lan', name: 'Lan' }, { id: 'hv-minh', name: 'Minh' }],
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
301   } as ReturnType<typeof groupMessage>);
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


Found 5 errors in 2 files.

Errors  Files
     1  src/worker/inbox/inbox-routes.ts:599
     4  test/inbox-group-bot.test.ts:268

[ELIFECYCLE] Command failed with exit code 1.
Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

  × "pnpm recursive run" failed in D:\TQD\CRM\apps\crm
```

`loadGroup` takes `id: string` (`inbox-routes.ts:525`). The reported call is the PUT staff handler. The same `c.req.param('id')` calls at lines 547 and 580 were not reported.

The four test errors are `group_members` objects cast with `as ReturnType<typeof groupMessage>` into `ingest()`, whose parameter is that message type.

### Failed command: test

```text
pnpm -F @abm/crm test
```

Vitest printed one line per file. The failure records and the summary are below. Exit code 1.

```text
 FAIL  test/inbox-group-bot.test.ts > a decomposed "Long ơi" matches and "Long ới" does not
AssertionError: expected '[Nhóm Zalo "Lớp IELTS K1"] Lan: Long …' to contain 'Long ơi'

Expected: "Long ơi"
Received: "[Nhóm Zalo "Lớp IELTS K1"] Lan: Long ơi"

 ❯ test/inbox-group-bot.test.ts:123:35
    121|   const replies = await commands('run_completion');
    122|   expect(replies).toHaveLength(1);
    123|   expect(replies[0].payload.text).toContain('Long ơi');
       |                                   ^
    124| });

 FAIL  test/inbox-group-bot.test.ts > a failed or stale group reply notifies Lark once and does not change mode
AssertionError: expected undefined to deeply equal { ignored: false }

- Expected:
{
  "ignored": false,
}

+ Received:
undefined

 ❯ test/inbox-group-bot.test.ts:240:28
    238|     .bind(new Date(Date.now() + 60_000).toISOString(), reply.id).run();
    239|   const failed = await bridge(`/commands/${reply.id}/result`, { body: …
    240|   expect(failed.json.data).toEqual({ ignored: false });
       |                            ^
    241|   const notices = await commands('send_lark');
    242|   expect(notices).toHaveLength(1);

 Test Files  1 failed | 37 passed | 1 skipped (39)
      Tests  2 failed | 477 passed | 2 skipped (481)
   Start at  17:06:01
   Duration  42.65s (transform 27.59s, setup 0ms, import 341.62s, tests 157.24s, environment 10ms)

[ELIFECYCLE] Test failed. See above for more details.
Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

  × "pnpm recursive run" failed in D:\TQD\CRM\apps\crm
```

On the unicode test, `toHaveLength(1)` passed, so the decomposed `'Long \u01A1i'.normalize('NFD')` did queue one reply. The stored payload text still contains the decomposed `ơ` (U+006F U+031B), and the assertion asked for composed `ơi`. The later expects in the failed-reply test (Lark notice, mode, stale reply) did not run.

The other new tests in `inbox-group-bot.test.ts`, including the daily-cap case, were not in the failure list. Existing inbox tests, including direct flow, were not in the failure list. The two pre-existing skips remain `test/demo-learner-generate.test.ts`.

## Not done

- Task 2.9 pass conditions are not met.
- Phase status in the plan was not updated.
- Nothing was committed.

Status: BLOCKED
Summary: Phase 2 worker code and tests are written, and 477 tests passed, but Task 2.9 stopped because `pnpm -F @abm/crm test` failed two new assertions and `pnpm -F @abm/crm typecheck` failed five errors in `inbox-routes.ts` and `inbox-group-bot.test.ts`.
