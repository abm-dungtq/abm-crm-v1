# Zalo customer profile on the reply completion

When the CRM queues a bot reply for a Zalo 1-1 conversation, the `run_completion` payload now carries `zaloUserId` (the thread id). The bridge resolves that id to a display name and gender and prepends one line to the text sent to GoClaw. Facebook, groups, and a missing profile leave the text unchanged. Nothing was committed, deployed, or started.

## Behaviour

- `scheduleCompletion` adds `zaloUserId` only when `channel === 'zalo'` and `kind === 'direct'`. Text coalescing still updates only `$.text`, so the id stays on the pending command. `ConversationRow` already selected `channel` and `kind`; the query did not change.
- `ZaloSession.getUserProfile` calls `api.getUserInfo`. The profile is taken from `changed_profiles`, keyed by the id, then `${id}_0`, then any other `${id}_…` key. `displayName` wins over `zaloName`. The name is clipped to 100 characters after newlines and `[` `]` are removed. Gender `0` is male, `1` is female, anything else is null.
- `AccountManager.profile` uses the live session and returns null when that account has none.
- `CommandRunner` looks the profile up only when the payload has `zaloUserId` and the command has `channelAccountId`. Cache key is `accountId:zaloUserId`: a profile object is kept 24 h, a null result 1 h, at most 2000 entries. A throw or a 5 s timeout does not fail the completion and is not cached, so the next reply tries again. Logs are `profile.lookup` (`cached`, `found`) and `profile.lookup_failed` (`code`). The name is not logged.
- With a name or a gender, the text sent to GoClaw is exactly `[Hồ sơ Zalo của khách: tên "<name>"; giới tính: <nam|nữ|không rõ>]` plus a newline plus the original text.
- `@abm/contracts` has no schema for the `run_completion` payload (`COMMAND_KINDS` only names the kind), so that package was not changed.

## zca-js 2.2.0

`dist/apis/getUserInfo.d.ts`:

```ts
export type ProfileInfo = User;
export type UserInfoResponse = {
    unchanged_profiles: Record<string, Partial<UnchangedProfileInfo>>;
    phonebook_version: number;
    changed_profiles: Record<string, ProfileInfo>;
};
```

`dist/models/User.d.ts` (the `User` / `ProfileInfo` fields used here):

```ts
displayName: string;
zaloName: string;
gender: Gender;
```

`dist/models/Enum.d.ts` confirms the encoding, so the mapping is not a guess:

```ts
export declare enum Gender {
    Male = 0,
    Female = 1
}
```

The `_0` suffix is not in the `.d.ts`. `dist/apis/getUserInfo.js` appends it before the request when the id contains no `_`:

```js
userId = userId.map((id) => {
    if (id.split("_").length > 1) {
        return id;
    }
    return `${id}_0`;
});
```

`UnchangedProfileInfo` has `oa_status`, `isFr`, `isBlocked`, and `lastActionTime` only. A user who comes back solely under `unchanged_profiles` has no name or gender in that payload, so the lookup returns null until a later `changed_profiles` entry is cached.

## Tests

- `pnpm -F @abm/zalo-bridge test`: 7 files, 59 passed, exit 0
- `pnpm -F @abm/zalo-bridge typecheck` (`tsc --noEmit`): exit 0
- `pnpm -F @abm/crm typecheck`: exit 0
- `pnpm -F @abm/crm test`: 37 files passed, 1 skipped; 464 tests passed, 2 skipped; exit 0

## Files

- `apps/crm/src/worker/inbox/conversation-flow.ts`
- `apps/crm/test/inbox-flow.test.ts`
- `apps/crm/test/inbox-facebook.test.ts`
- `apps/zalo-bridge/src/zalo-client.ts`
- `apps/zalo-bridge/src/account-manager.ts`
- `apps/zalo-bridge/src/command-runner.ts`
- `apps/zalo-bridge/test/account-manager.test.ts`
- `apps/zalo-bridge/test/command-runner.test.ts`
- `apps/zalo-bridge/test/zalo-profile.test.ts`

Status: DONE
Summary: A Zalo 1-1 reply completion now carries the thread id, and the bridge prepends the customer's Zalo name and gender (nam/nữ/không rõ) to the GoClaw text. Facebook and groups do not. Lookup failures leave the text unchanged and the completion still succeeds.
