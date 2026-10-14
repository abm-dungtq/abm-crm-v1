# Phase 1 report: bridge group signals

Phase: `plans/261013-1546-zalo-group-learner-care/phase-01-bridge-group-signals.md`
Task: 1.7
Verify that failed: `pnpm -F @abm/zalo-bridge typecheck` must exit 0.

## What changed

- `packages/contracts/src/index.ts`: `bridgeMessageEvent` gained optional `mentionsSelf` and `quotesSelf`. Added `bridgeGroupMembersEvent` (`type: 'group_members'`) to `bridgeEventSchema` and exported `BridgeGroupMembersEvent`.
- `apps/zalo-bridge/src/zalo-client.ts`: `normalizeMessage(message, ownId)` sets `mentionsSelf` and `quotesSelf`. `ZcaSession` caches the last 1000 incoming group messages and `send` accepts an optional reply (mention + quote on group threads only). `listGroupMembers` reads `memVerList`, falls back to `currentMems`, and loads profiles in batches of 50. Exported `ZaloSendReply` and `openZcaSession`.
- `apps/zalo-bridge/src/account-manager.ts`: `send` forwards `reply` to the session. `emitMessage` adds the two flags on group messages. `pushGroups` emits `group_members` per group and logs `account.group_members_failed` with `{ accountId, code }` on a per-group failure. A 6-hour interval repeats `pushGroups` and is cleared on session close and on `closeSession` (logout / stop).
- `apps/zalo-bridge/src/command-runner.ts`: `send_zalo` payload accepts optional `replyTo`. `RunnerAccounts.send` takes that reply. `sendZalo` passes it only when the chunk index is 0.
- `apps/crm/src/worker/inbox/ingest.ts`: one-line skip, `if (event.type === 'group_members') continue`, so the new union member does not fall through into `ingestGroupList`.
- `apps/zalo-bridge/test/zalo-group-signals.test.ts`: new file for normalize, send, cache, and `listGroupMembers`.
- `apps/zalo-bridge/test/account-manager.test.ts`: `FakeSession.listGroupMembers`, flag forwarding, `replyTo` pass-through, member events, failing group, 6-hour interval cleared on fatal close.
- `apps/zalo-bridge/test/command-runner.test.ts`: `replyTo` is present only on the first `accounts.send` call.

## zca-js fields used (2.2.0)

From `apps/zalo-bridge/node_modules/zca-js/dist/models/Message.d.ts`:

```ts
export type TGroupMessage = TMessage & {
    mentions: TMention[] | undefined;
};
export type TQuote = {
    ownerId: string;
    cliMsgId: number;
    globalMsgId: number;
    cliMsgType: number;
    ts: number;
    msg: string;
    attach: string;
    fromD: string;
    ttl: number;
};
export type TMention = {
    uid: string;
    pos: number;
    len: number;
    type: 0 | 1;
};
```

`TMessage` also has `quote: TQuote | undefined` and the raw fields copied into a quote: `content`, `msgType`, `propertyExt`, `uidFrom`, `msgId`, `cliMsgId`, `ts`, `ttl`.

From `dist/apis/sendMessage.d.ts`:

```ts
export type SendMessageQuote = {
    content: TMessage["content"];
    msgType: TMessage["msgType"];
    propertyExt: TMessage["propertyExt"];
    uidFrom: TMessage["uidFrom"];
    msgId: TMessage["msgId"];
    cliMsgId: TMessage["cliMsgId"];
    ts: TMessage["ts"];
    ttl: TMessage["ttl"];
};
export type Mention = { pos: number; uid: string; len: number };
export type MessageContent = {
    msg: string;
    quote?: SendMessageQuote;
    mentions?: Mention[];
};
```

From `dist/apis/getGroupInfo.d.ts` and `dist/models/Group.d.ts`:

```ts
gridInfoMap: {
    [groupId: string]: GroupInfo & { memVerList: string[]; pendingApprove: GroupInfoPendingApprove };
};
export type GroupCurrentMem = { id: string; dName: string; zaloName: string; /* ... */ };
// GroupInfo.currentMems: GroupCurrentMem[]
```

From `dist/apis/getGroupMembersInfo.d.ts`:

```ts
export type GroupMemberProfile = { displayName: string; zaloName: string; /* ... */ id: string };
export type GetGroupMembersInfoResponse = {
    profiles: { [memberId: string]: GroupMemberProfile };
    unchangeds_profile: unknown[];
};
```

## Verify results

Attempted, in order:

1. Task 1.1: `pnpm -F @abm/contracts typecheck` — exit 0 (`tsc --noEmit`).
2. Tasks 1.2, 1.5, 1.6, and the test half of 1.7: `pnpm -F @abm/zalo-bridge test` — exit 0. Vitest 4.1.11, 8 files, 76 tests passed, including `test/zalo-group-signals.test.ts` (12), `test/account-manager.test.ts` (14), `test/command-runner.test.ts` (19).
3. Task 1.7: `pnpm -F @abm/zalo-bridge typecheck` — exit 1. Pass condition was exit 0. Stopped. Did not edit after this failure.
4. `pnpm -F @abm/crm typecheck` had already been started in parallel and exited 0 (`tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`). No further commands after the bridge typecheck failure.

### Failed command

```text
pnpm -F @abm/zalo-bridge typecheck
```

Full output:

```text
$ tsc --noEmit
test/account-manager.test.ts:191:49 - error TS2345: Argument of type '(groupId: string) => Promise<{ id: string; name: string; }[]>' is not assignable to parameter of type '() => Promise<{ id: string; name: string; }[]>'.
  Target signature provides too few arguments. Expected 1 or more, but got 0.

191     session.listGroupMembers.mockImplementation(async (groupId: string) => {
                                                    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

test/zalo-group-signals.test.ts:188:44 - error TS2493: Tuple type '[]' of length '0' has no element at index '0'.

188     expect(sendMessage.mock.calls.at(-1)?.[0]).toEqual({
                                               ~

test/zalo-group-signals.test.ts:193:44 - error TS2493: Tuple type '[]' of length '0' has no element at index '0'.

193     expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
                                               ~


Found 3 errors in 2 files.

Errors  Files
     1  test/account-manager.test.ts:191
     2  test/zalo-group-signals.test.ts:188

[ELIFECYCLE] Command failed with exit code 1.
Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

  × "pnpm recursive run" failed in D:\TQD\CRM\apps\zalo-bridge
```

The three errors are in tests only. `FakeSession.listGroupMembers` and the harness `sendMessage` are `vi.fn` instances inferred with zero parameters, so a one-argument `mockImplementation` and `mock.calls[...][0]` do not typecheck. Vitest still ran those tests and they passed.

Status: BLOCKED
Summary: Phase 1 behavior is implemented and the bridge unit tests, contracts typecheck, and CRM typecheck passed. `pnpm -F @abm/zalo-bridge typecheck` exited 1 on three test-file mock typings, so the phase stopped before a green typecheck.
