# Phase 6: Web UI for the Zalo OA channel

Executor: Grok via Paseo. Supervisor: Opus. Needs phase 4's API.

## Context

- `apps/crm/src/web/pages/channel-accounts.tsx`: the channel accounts page, route `/channel-accounts`. It lists Zalo personal numbers (QR login) and Facebook pages.
- `apps/crm/src/web/api.ts`, `apps/crm/src/web/types.ts`: the client and types.
- `apps/crm/src/web/inbox-format.ts`: channel labels.
- `apps/crm/src/web/pages/inbox.tsx`: the channel filter and badges.

## Files you may modify

- `apps/crm/src/web/pages/channel-accounts.tsx`
- `apps/crm/src/web/api.ts`, `apps/crm/src/web/types.ts`, `apps/crm/src/web/inbox-format.ts`
- `apps/crm/src/web/pages/inbox.tsx` (filter and labels only)

## Tasks

### Task 6.1: Labels

- Steps: everywhere a channel is labelled, `zalo_oa` shows `Zalo OA`. A conversation's badge reads `Zalo OA`.
- Verify: `pnpm -F @abm/crm typecheck` exits 0.

### Task 6.2: Connect card (admin)

- Steps:
  1. On `/channel-accounts`, add a section `Zalo OA`, listing `zalo_oa` accounts with:
     - name and OA id;
     - status (`Đã kết nối`, `Lỗi`) and `last_error`;
     - the bot on/off switch and agent key, same controls as the other accounts;
     - a checkbox `Tự xác nhận đăng ký 199k`, bound to `registration_policy` (admin only), with the hint `Bot xác nhận đăng ký khi khách gửi biên lai 199.000đ hợp lệ; câu xác nhận sai dạng bị chặn.`
  2. Add a button `Kết nối Zalo OA` (admin only). It calls the connect endpoint and then sets `window.location.href = url`.
  3. When the page loads with `?zalo_oa=connected` or `?zalo_oa=error`, show a toast `Đã kết nối Zalo OA` or `Kết nối Zalo OA lỗi`, then remove the query.
  4. Hide the QR, login and logout controls for `zalo_oa` accounts. Those belong to personal numbers only.
- Verify: `pnpm -F @abm/crm typecheck` and `pnpm -F @abm/crm build` both exit 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Never continue by self-reasoning. Write the report to `plans/reports/grok-261014-zalo-oa-ui.md` ending with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.
