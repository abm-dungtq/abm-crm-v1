# Phase 3 report: Zalo group settings UI

Phase: `plans/261013-1546-zalo-group-learner-care/phase-03-group-settings-ui.md`
Tasks: 3.1, 3.2, 3.3, 3.4

## What changed

- `apps/crm/src/web/types.ts`: `ZaloGroup` gained `botReplyEnabled`, `agentKey`, and `botPausedUntil`. `ZaloGroupUpdate` gained optional `botReplyEnabled` and `agentKey` (`null` clears a custom agent). Added `ZaloGroupMember`.
- `apps/crm/src/web/api.ts`: `listGroupMembers` is `GET /inbox/groups/:id/members`. `setGroupStaff` is `PUT /inbox/groups/:id/members/:externalUserId/staff` with `{ isStaff }`.
- `apps/crm/src/web/pages/inbox.tsx`: exported `SETTINGS_ROLES = ['leader', 'admin']` next to `MANAGER_ROLES`. Head and director stay out of this set.
- `apps/crm/src/web/pages/zalo-groups.tsx`:
  - The list subtitle and the group-page note now say "Long chỉ trả lời trong nhóm đã bật, khi được gọi tên hoặc @tag."
  - `GroupSwitches` adds "Long trả lời trong nhóm". The hint is "Khi học viên @tag Long, trả lời vào tin của Long hoặc gõ “Long ơi”". The checkbox is enabled for leader and admin only.
  - While `botPausedUntil` is in the future, the switch shows "Long đang tạm im đến HH:mm" in Asia/Ho_Chi_Minh.
  - Admins get an "Agent" field, placeholder `cham-soc-hoc-vien`. Lưu or Enter sends `agentKey`; a blank value sends `null`.
  - `ZaloGroupPage` adds a card "Thành viên nhóm" under the chat panel (the switches sit in that panel's side column). Each row shows the name, or `externalUserId` when there is no name, and a "Người ABM" checkbox bound to `setGroupStaff`. The checkbox is disabled except for leader and admin. The note above the list is the phase text about ABM staff and the 6-hour refresh. A search box appears when the roster has more than 30 members.
- No web test covers this page, so none was edited. Worker code was not changed.

No commit, push, deploy, wrangler, or dev server.

## Verify

Commands from `D:\TQD\CRM`, in order:

1. `pnpm -F @abm/crm typecheck` — exit 0.
2. `pnpm -F @abm/crm test` — exit 0. 38 files passed, 1 skipped; 479 tests passed, 2 skipped. Duration 41.79s.
3. `pnpm -F @abm/crm build` — exit 0 (`vite build`, 3.59s). Vite printed its existing chunk-size notice; the command still exited 0.

The UI was not clicked in a browser. The phase forbids starting a dev server.

Status: DONE
Summary: Group pages now let a leader or admin turn Long on, let an admin set the group's agent, and let a leader or admin mark ABM staff. Typecheck, the CRM test suite, and the production build all exited 0.
