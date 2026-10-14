# Phase 1: Bridge group signals, quoted replies, member lists

Executor: Grok via Paseo. Supervisor: Opus (controller session). Read `plan.md` first for the fixed decisions and rules.

## Context

- Zalo account used only by the chatbot. zca-js 2.2.0. Types are in `apps/zalo-bridge/node_modules/zca-js/dist/models/Message.d.ts`, `dist/apis/sendMessage.d.ts`, `dist/apis/getGroupInfo.d.ts`, `dist/apis/getGroupMembersInfo.d.ts`. Read them before coding.
  - Group messages have `data.mentions?: { uid, pos, len, type }[]`.
  - All messages have `data.quote?: { ownerId, cliMsgId, globalMsgId, ... }`.
  - `sendMessage(content, threadId, type)` accepts `{ msg, quote?: SendMessageQuote, mentions?: { pos, uid, len }[] }`.
- Bridge event contract: `packages/contracts/src/index.ts` (`bridgeMessageEvent` ~line 746, `bridgeEventSchema` ~785).
- Message normalisation: `apps/zalo-bridge/src/zalo-client.ts` (`IncomingMessage` ~31, `ZaloSession` ~62, `normalizeMessage` ~156, `ZcaSession` ~191, `send` ~217, `listGroups` ~230).
- Event emission: `apps/zalo-bridge/src/account-manager.ts` (`attach` 169, `pushGroups` 190, `emitMessage` 251).
- Commands: `apps/zalo-bridge/src/command-runner.ts` (`send_zalo` zod ~33, `sendZalo` ~278).

## Files you may modify

- `packages/contracts/src/index.ts`
- `apps/zalo-bridge/src/zalo-client.ts`
- `apps/zalo-bridge/src/account-manager.ts`
- `apps/zalo-bridge/src/command-runner.ts`
- `apps/zalo-bridge/test/*.test.ts` (existing files, plus new `apps/zalo-bridge/test/zalo-group-signals.test.ts`)

Do not touch `apps/crm` in this phase, except the one-line `group_members` skip in `apps/crm/src/worker/inbox/ingest.ts` described in Task 1.7. A type error in `apps/crm` caused by the contract change is expected only if the change is not backward compatible, so keep every new field optional.

## Tasks

### Task 1.1: Extend the message event contract

- Goal: the Worker can learn that a group message addresses the bot.
- Target: `packages/contracts/src/index.ts`, `bridgeMessageEvent`.
- Steps:
  1. Add `mentionsSelf: z.boolean().optional()` and `quotesSelf: z.boolean().optional()`.
  2. Add a new event schema `bridgeGroupMembersEvent`:
     `{ type: z.literal('group_members'), accountExternalId: externalRef, threadId: externalRef, members: z.array(z.object({ id: externalRef, name: z.string().max(200) })).max(5000) }`.
     Add it to the `bridgeEventSchema` union and export its type.
- Success: both schemas compile and are exported.
- Verify: `pnpm -F @abm/contracts typecheck` exits 0. If that script does not exist, run `pnpm -F @abm/zalo-bridge typecheck`, which must exit 0.

### Task 1.2: Detect mention and quote of the bot

- Goal: `IncomingMessage` carries `mentionsSelf` and `quotesSelf`.
- Target: `zalo-client.ts`, `IncomingMessage` and `normalizeMessage`.
- Steps:
  1. Change the signature to `normalizeMessage(message: Message, ownId: string)`. Update the caller in `ZcaSession`.
  2. Set `mentionsSelf`: true when `data.mentions` has an entry with `String(uid) === ownId`. A mention-all entry has `type === 1` or `uid === '-1'`; it does not count.
  3. Set `quotesSelf`: true when `String(data.quote?.ownerId ?? '') === ownId`.
  4. Both are false for direct messages and when the fields are absent.
- Success: unit tests cover mention of the bot, mention of someone else, @all, quote of the bot, quote of someone else, and no fields.
- Verify: `pnpm -F @abm/zalo-bridge test` exits 0 and the new tests are listed as passed.

### Task 1.3: Forward the flags in the event

- Target: `account-manager.ts`, `emitMessage`.
- Steps: add `...(message.threadKind === 'group' ? { mentionsSelf: message.mentionsSelf, quotesSelf: message.quotesSelf } : {})`.
- Verify: no verification needed (covered by Task 1.7 tests).

### Task 1.4: Cache raw messages so a reply can quote them

- Goal: the bridge can build a `SendMessageQuote` for a recent incoming group message.
- Target: `ZcaSession` in `zalo-client.ts`.
- Steps:
  1. Keep a `Map<string, TMessage-like raw data>` of the last 1000 incoming group messages, keyed by `msgId`. Evict the oldest first.
  2. Add a private helper that converts a cached raw message into the `SendMessageQuote` shape from `sendMessage.d.ts`, copying exactly the fields that type requires.
- Verify: no verification needed (covered by Task 1.5).

### Task 1.5: Send with quote and mention

- Goal: a group reply quotes the asker's message and tags the asker.
- Target: `ZaloSession.send` and `ZcaSession.send` in `zalo-client.ts`; the `send_zalo` zod schema and `sendZalo` in `command-runner.ts`.
- Steps:
  1. Change the signature to `send(threadId, threadKind, text, reply?: { msgId: string; senderId: string; senderName: string })`.
  2. When `reply` is given and `threadKind === 'group'`:
     - set `msg` to `@${senderName} ${text}`;
     - set `mentions` to `[{ pos: 0, uid: senderId, len: senderName.length + 1 }]`;
     - add `quote` if `msgId` is in the cache. If it is not, send without a quote; that is not an error.
     - If `senderName` is blank, skip the mention and send `text`.
  3. In `command-runner.ts`, extend the `send_zalo` payload zod with optional `replyTo: z.object({ msgId: z.string().min(1), senderId: z.string().min(1), senderName: z.string().max(200) })`.
  4. In `sendZalo`, pass `replyTo` only for the first chunk.
- Success: tests prove all of the following:
  - the first chunk carries the mention and quote;
  - later chunks are plain;
  - a cache miss sends without a quote;
  - a direct thread ignores `replyTo`.
- Verify: `pnpm -F @abm/zalo-bridge test` exits 0.

### Task 1.6: Push group member lists

- Goal: the CRM gets each group's members (id, display name) so staff can mark ABM people.
- Target: `ZaloSession` gets `listGroupMembers(groupId): Promise<{ id: string; name: string }[]>`; `ZcaSession` implements it; `account-manager.ts` `pushGroups`.
- Steps:
  1. In `ZcaSession.listGroupMembers`:
     - call `api.getGroupInfo(groupId)` and read the member ids from `gridInfoMap[groupId].memVerList`. Entries look like `"<uid>_<ver>"`; take the part before the last `_`. If `memVerList` is empty, fall back to `currentMems[].id` when present.
     - call `api.getGroupMembersInfo(ids)` in batches of 50 and read `profiles[id].displayName || profiles[id].zaloName`.
     - check the exact response shapes in the d.ts files before coding.
  2. In `pushGroups`, after emitting `group_list`, call `listGroupMembers` for each group one after another. Emit `{ type: 'group_members', accountExternalId, threadId, members }` per group.
     - A failure for one group logs `account.group_members_failed` with `{ accountId, code }` and continues.
     - Never log member names.
  3. Add a 6-hour refresh. In `attach`, start an interval that calls `pushGroups` again; clear it when the session closes or the manager stops. Follow the existing timer and cleanup patterns in that file.
- Success: tests with a fake session prove three things:
  - `group_members` events are emitted after `group_list`;
  - one failing group does not stop the others;
  - the interval is cleared on close.
- Verify: `pnpm -F @abm/zalo-bridge test` exits 0.

### Task 1.7: Tests and typecheck

- Steps:
  1. Put the normalizeMessage and send tests in `apps/zalo-bridge/test/zalo-group-signals.test.ts`.
  2. Extend `account-manager.test.ts` for the member events and the flags in `emitMessage`.
  3. Extend `command-runner.test.ts` for `replyTo`.
  4. Update existing fakes that implement `ZaloSession` to add `listGroupMembers`.
  5. In `apps/crm/src/worker/inbox/ingest.ts`, `ingestEvents`, add one minimal branch that skips `event.type === 'group_members'`, written in that loop's style. This is the only `apps/crm` edit allowed in phase 1. Without it, the new union member reaches `ingestGroupList` and the crm typecheck fails. Phase 2 replaces the branch with the real handler.
  6. Thread `replyTo` through `AccountManager.send` (account-manager.ts) and the sender interface used by `command-runner.ts` (around line 46), not only `ZaloSession.send`.
- Verify:
  - `pnpm -F @abm/zalo-bridge test` exits 0.
  - `pnpm -F @abm/zalo-bridge typecheck` exits 0.
  - `pnpm -F @abm/crm typecheck` exits 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Write the failure into your report and end with `Status: BLOCKED`, including:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
The supervisor (Opus, controller session) replaces `kongming` for this project. It will read the report and send guidance; then re-run the Verify step. Never continue by self-reasoning.

## Report

Write `plans/reports/grok-261013-zalo-group-bridge.md`. Include:
- what changed, per file;
- the zca-js fields you relied on, quoted from the d.ts files;
- the test and typecheck output summary.
