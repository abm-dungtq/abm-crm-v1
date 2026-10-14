# Pre-deploy review: Zalo group learner care (bot "Long")

Date: 2026-10-13. This was a read-only review of the uncommitted diff and the 3 untracked files.
Plan: `plans/261013-1546-zalo-group-learner-care/`.

## Checks run

- `apps/crm`: full vitest run, 479 passed and 2 skipped. `tsc --noEmit` was clean.
- `apps/zalo-bridge`: vitest, 77 passed. `tsc --noEmit` was clean.

## Earlier fixes: verified

1. **Daily cap** (`apps/crm/src/worker/inbox/dispatcher.ts:184-191`). Correct.
   - The count excludes only sends whose `payload_json` has `$.replyTo`.
   - Only `queueOutgoing` sets `replyTo`, and only for a group reply (`conversation-flow.ts:183-185`).
   - Scheduled posts (`group-schedules.ts:126`) and staff web sends carry no `replyTo`, so they still count.
   - The test at `inbox-group-bot.test.ts:320` covers both sides.
   - Every payload is written by `JSON.stringify`, so `json_extract` cannot throw on bad JSON.
2. **Member scan guard and pacing** (`apps/zalo-bridge/src/account-manager.ts:218-249`). Present and tested (`account-manager.test.ts:212`). The reconnect case is not right; see M1.
3. **Agent key regex** (`apps/crm/src/worker/inbox/inbox-routes.ts:493`). Correct.
   - The regex is `^[a-z0-9-]+$`. It runs after `.trim()`, with max 128, and allows null.
   - The UI sends `value.trim() || null`, and the error shows through `FormError`.
   - No test sends an invalid key. That is minor.

## High

None found.

## Medium

### M1. A reconnect during a member scan skips the new session's group refresh for up to 6 hours

- **Where:** `apps/zalo-bridge/src/account-manager.ts:218-219` (guard), `:239` (bail-out), `:210` (initial push).
- **Cause:** the in-flight guard is keyed by `accountId`, not by session.
- **Scenario:**
  1. Session S1 is scanning, for example 80 groups at 1.5 s plus API time, about 2-3 minutes.
  2. S1 closes (non-fatal), and the reconnect `attach()`es session S2.
  3. S2's `pushGroups` finds `scanning.has(accountId)` and returns at once.
  4. S1's loop then sees `session !== S1` at line 239 and exits without scanning anything for S2.
- **Result:**
  - No `group_list` and no `group_members` are sent for S2 until the next 6-hour tick.
  - New groups and renamed groups do not show in the CRM, and the roster that staff marking relies on stays stale.
  - Pilot step 6 ("zalo_group_member has members") can fail if the bridge restart hits a reconnect.
- **Test gap:** `account-manager.test.ts:212` covers only an overlap within one session.
- **Fix:** skip only when the running scan belongs to the same session. Keep a `Map<accountId, ZaloSession>` and return when `scanning.get(accountId) === session`; otherwise start the new scan. The old loop already exits on its own at line 239.

### M2. Member names may all come back blank if the `getGroupMembersInfo` response is keyed `uid_0`

- **Where:** `apps/zalo-bridge/src/zalo-client.ts:356`, which does `profiles[id]` with the plain uid.
- **Why this is a risk:**
  - zca-js sends `friend_pversion_map` as `uid_0` (`node_modules/zca-js/dist/apis/getGroupMembersInfo.js`).
  - The response key format is not documented. The type only says `[memberId: string]`.
  - This codebase already found that the sister endpoint `getUserInfo` returns keys as `userId | userId_0` (header comment at `zalo-client.ts:23`, and `zaloProfileFromInfo`).
  - The tests (`zalo-group-signals.test.ts:211-242`) mock plain-uid keys, so they cannot catch this.
- **Scenario:** Zalo returns `{ "123_0": {...} }`. Every member is then stored with `display_name` NULL.
  - The roster UI lists bare numeric ids.
  - Leaders cannot tell which members are ABM staff, so they cannot mark them.
  - Learners keep triggering Long while staff silently "answer" without being marked, so `staffSpokeAfter` never yields.
  - A name fills in only after that member posts in the group (`ingest.ts:137`).
- **Fix:** look up `profiles[id] ?? profiles[`${id}_0`]`. Alternatively index `Object.values(profiles)` by `profile.id`, stripping `_0`.
- **Also:** pilot step 6 should check that `display_name IS NOT NULL` for most rows, not only that rows exist.

## Focus areas with no finding

- **Migration** (`0019_zalo_group_bot.sql`):
  - It adds 3 nullable or defaulted columns. SQLite accepts `NOT NULL DEFAULT 0 CHECK(...)` in `ADD COLUMN`.
  - It creates 2 new tables with FK cascades.
  - `UPDATE ... mode='ai', staff_context_pending=NULL WHERE kind='group'` is safe:
    - `mode` CHECK allows `'ai'`, and there is no trigger.
    - Groups have `sla_due_at` NULL by construction, and the SLA cron filters `kind='direct'` (`scheduled.ts:39`).
    - `assignee_user_id` and `handoff_reason` are left as they are, with no functional effect.
    - `groupBotMayReply` ignores `mode`, so a later manual mode change cannot turn the bot on.
  - The UPDATE cannot be undone, but it is harmless under the old Worker: `botMayReply` needs `kind='direct'`.
- **Deploy order: Worker first, old bridge still running.**
  - The old bridge's `sendPayload` and `completionPayload` are non-strict zod, so `replyTo` and `triggerMessageId` are stripped or ignored. The send goes out as plain text, and its echo still matches by `commandId`.
  - The old bridge sends no `mentionsSelf` or `quotesSelf`. Both are optional in the contract.
  - `bot_reply_enabled` defaults to 0, so nothing replies before a leader turns it on.
  - The rollback order in phase 5 (stop the bridge before `wrangler rollback`) correctly handles the old Worker returning 422 on `group_members`.
- **Leak into the wrong group:**
  - The send `threadId` comes from the command's own conversation (`queueOutgoing`).
  - `replyTo` comes from the triggering event in that same conversation.
  - The quote cache is keyed by a globally unique Zalo msgId.
  - The GoClaw `userId` is per group thread (`conversation-flow.ts:115`).
  - The profile cache is keyed by `account:zaloUserId`.
  - No path found that crosses groups.
- **Echo loop:**
  - Any `fromSelf` group message returns before the trigger check (`ingest.ts:127-135`).
  - A bot reply's echo matches by `commandId`, or by whole-line body match. The stored body is `@name text`, the same as the bridge's chunk 0.
  - An unmatched echo at worst pauses the group for 30 minutes as `staff_phone`. It never re-triggers.
  - A claimed run whose result arrives after a pause or a staff message is kept as a note (`applyGroupCompletion`).
- **Web UI against the API:**
  - Field names match: `botReplyEnabled`, `agentKey`, `botPausedUntil`, and `{externalUserId, displayName, isStaff, updatedAt}`.
  - The PUT body `{ isStaff }` matches.
  - Roles match: `SETTINGS_ROLES` leader/admin on both sides, and the agent field is admin-only on both sides.
  - The members GET is limited to the organization through `loadGroup`.

## Unresolved questions

- Two ABM Zalo accounts in one learner group: each account sees the other's bot replies as "customer" messages unless the other account's uid is marked ABM. One "Long ơi" or @tag of both accounts gives two replies. There is no loop, because neither reply mentions or quotes the other account. Should the marking step cover the other CRM accounts' uids?

Status: DONE_WITH_CONCERNS
Summary: The 3 earlier fixes are correct, and there are no deploy blockers: migration, Worker-first contract compatibility, wrong-group routing and echo handling all check out. Two Medium bridge issues should be fixed or watched in the pilot: the scan guard skips a reconnected session's refresh (M1), and member names may come back blank because the profile key format is unverified (M2).
