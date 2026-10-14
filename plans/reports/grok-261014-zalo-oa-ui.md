# Phase 6 report: Web UI for the Zalo OA channel

Phase: `plans/261014-0842-zalo-oa-into-crm/phase-06-web-ui.md`
Tasks: 6.1 and 6.2.

## What changed

A Zalo Official Account is labelled `Zalo OA` on the channel accounts page and in the inbox. An admin connects one from `/channel-accounts` and sets the 199k registration policy there.

- `channelKindLabel` maps `zalo` to `Zalo`, `facebook` to `Fanpage`, and `zalo_oa` to `Zalo OA`. The inbox account filter uses that name plus the account's display name.
- `conversationChannelLabel` is the conversation badge. A Zalo OA reads `Zalo OA`. A personal number still reads `Zalo · {account name}`. A Fanpage still reads `Fanpage`. The list row, the Kênh panel, and the open conversation header all use it.
- `/channel-accounts` has a `Zalo OA` section. Each OA shows its name, OA id, status (`Đã kết nối`, `Lỗi`, and the other existing statuses), and `last_error` when the status is `error`. The bot switch and the `Sửa` dialog for the agent key are the same controls as the other accounts.
- `Tự xác nhận đăng ký 199k` is bound to `registration_policy`. Next to it, `Link nhóm Zalo` is bound to `registration_group_url`. Saving calls `PUT /api/inbox/accounts/:id/registration-policy`. Turning the policy on with a missing or invalid link shows the API field error on `groupUrl`. The hint is `Bot xác nhận đăng ký khi khách gửi biên lai 199.000đ hợp lệ; câu xác nhận sai dạng bị chặn.`
- `Kết nối Zalo OA` calls `POST /api/inbox/channel-accounts/zalo-oa/connect` and then sets `window.location.href` to the returned `url`. The page is already admin-only; the button and the policy fields are also hidden unless the role is admin.
- `?zalo_oa=connected` shows the toast `Đã kết nối Zalo OA`. `?zalo_oa=error` shows `Kết nối Zalo OA lỗi`. The query is then removed with `history.replaceState`.
- OA accounts are not listed in the personal-number table. Connect, disconnect, and the QR dialog stay on `channel === 'zalo'` only.

## File outside the phase list

`apps/crm/src/web/components/inbox-thread.tsx` was not in the allowed list. The open conversation header badge is `channelLabel` in that file. Leaving it would still show `Zalo · {account name}` for `zalo_oa`. The edit makes `channelLabel` call `conversationChannelLabel`. No other line in that file changed.

`apps/crm/src/web/pages/intakes.tsx` and `apps/crm/src/web/components/intake-card.tsx` still call a `zalo_oa` intake Zalo. They were outside the allowed list and were not edited.

## Left in place

Uncommitted Zalo group bot edits in `inbox.tsx`, `api.ts`, `types.ts`, and `zalo-groups.tsx` were not reverted. `types.ts` kept its mixed line endings: CRLF through `CustomerBotSwitch`, LF from the inbox-assignment comment down. `apps/crm/src/worker/` and `apps/zalo-bridge/` were not edited. Nothing was committed, pushed, deployed, or run with `wrangler`. No dev server was started.

## Verify

Commands from `D:\TQD\CRM`.

- `pnpm -F @abm/crm typecheck` — exit 0.
- `pnpm -F @abm/crm build` — exit 0. Vite built in 3.64s.
- `pnpm -F @abm/crm test` — exit 0. **502 passed, 2 skipped** (504). Files: 41 passed, 1 skipped (42). Duration 45.15s. Start 12:44:00.

The full suite matches the count recorded after phase 4. No previously passing test failed. The UI was not clicked in a browser, because this phase forbids starting a dev server.

## Files changed

- `apps/crm/src/web/inbox-format.ts`
- `apps/crm/src/web/pages/inbox.tsx` — filter and labels only, on top of the existing group-bot edit
- `apps/crm/src/web/pages/channel-accounts.tsx`
- `apps/crm/src/web/api.ts` — connect and registration-policy clients, on top of the existing group-member clients
- `apps/crm/src/web/types.ts` — `registrationPolicy`, `registrationGroupUrl`, and `RegistrationPolicyUpdate`, on top of the existing group types
- `apps/crm/src/web/components/inbox-thread.tsx` — conversation badge only; see the note above

Status: DONE_WITH_CONCERNS
