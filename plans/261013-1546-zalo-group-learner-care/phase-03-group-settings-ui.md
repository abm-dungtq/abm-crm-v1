# Phase 3: Group settings UI

Executor: Grok via Paseo. Supervisor: Opus. Phase 2 must be done (API exists). UI text is Vietnamese.

## Context

- `apps/crm/src/web/pages/zalo-groups.tsx`:
  - `ZaloGroupsPage` (line 64), `ZaloGroupPage` (129).
  - `GroupSwitches` (208–231): the summary checkbox at 217–221 calls `updateGroup(g.id, { summaryEnabled })` via `useInboxMutation`.
  - The copy at lines 79 and 187 says "Bot không trả lời trong nhóm" and is now wrong.
- `apps/crm/src/web/types.ts:407-420`: `ZaloGroup`, `ZaloGroupUpdate`.
- API client functions for groups live next to `updateGroup`. Find them with a search for `updateGroup(`.
- The current user's role is available the same way other pages gate admin controls. Follow the existing pattern in this file or its imports.
- Role sets must match the API exactly. The API uses `SETTINGS_ROLES` (leader, admin) for `botReplyEnabled` and for marking staff, and admin only for `agentKey`. The web has `MANAGER_ROLES` in `inbox.tsx:25`, which also includes head and director, so it is NOT the right set. Add and export a web constant `SETTINGS_ROLES = ['leader', 'admin']` next to it and use it for these controls.

## Files you may modify

- `apps/crm/src/web/pages/zalo-groups.tsx`
- `apps/crm/src/web/types.ts`
- The web API client file that defines `updateGroup`
- `apps/crm/src/web/pages/inbox.tsx` (only to add the `SETTINGS_ROLES` export)
- Existing web tests for this page, if any

## Tasks

### Task 3.1: Types and API client

- Steps:
  1. Add `botReplyEnabled: boolean`, `agentKey: string | null` and `botPausedUntil: string | null` to `ZaloGroup`.
  2. Add `botReplyEnabled?` and `agentKey?: string | null` to `ZaloGroupUpdate`.
  3. Add a `ZaloGroupMember` type: `{ externalUserId, displayName: string | null, isStaff: boolean, updatedAt: string }`.
  4. Add client functions `listGroupMembers(id)` and `setGroupStaff(id, externalUserId, isStaff)`.
- Verify: no verification needed (covered by Task 3.4).

### Task 3.2: Switches

- Target: `GroupSwitches`.
- Steps:
  1. Add the checkbox "Long trả lời trong nhóm". Its hint is "Khi học viên @tag Long, trả lời vào tin của Long hoặc gõ “Long ơi”". It is enabled for leader and admin only, the same roles as the API.
  2. When `botPausedUntil` is in the future, show "Long đang tạm im đến HH:mm" (local time).
  3. For admin only, add a small text input "Agent" with placeholder `cham-soc-hoc-vien`. Saving sends `agentKey` (empty means `null`).
  4. Replace the copy at lines 79 and 187 with "Long chỉ trả lời trong nhóm đã bật, khi được gọi tên hoặc @tag."
- Verify: no verification needed (covered by Task 3.4).

### Task 3.3: Members card

- Target: `ZaloGroupPage`. Add a card "Thành viên nhóm" below the switches.
- Steps:
  1. Load the list with `listGroupMembers` (react-query, as in the rest of the page).
  2. Show one row per member: the name (or `externalUserId` when there is no name) and a checkbox "Người ABM" bound to `setGroupStaff`. The checkbox is disabled for roles other than leader and admin.
  3. Above the list, show the note "Long không trả lời người ABM và nhường câu hỏi khi người ABM đã trả lời. Danh sách tự cập nhật mỗi 6 giờ và khi có người nhắn."
  4. Show a search box when there are more than 30 members.
- Verify: no verification needed (covered by Task 3.4).

### Task 3.4: Checks

- Verify:
  - `pnpm -F @abm/crm typecheck` exits 0.
  - `pnpm -F @abm/crm test` exits 0.
  - `pnpm -F @abm/crm build` exits 0, if a `build` script exists.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Write the failure into your report and end with `Status: BLOCKED`, including:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.

The supervisor (Opus, controller session) replaces `kongming` for this project. It reads the report and sends guidance; then re-run the Verify step. Never continue by self-reasoning.

## Report

Write `plans/reports/grok-261013-zalo-group-ui.md`.
