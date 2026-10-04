---
phase: 1
title: "Admin ghi nghiệp vụ trên web"
status: completed
priority: P1
effort: "0.5-1d"
dependencies: []
---

# Phase 01: Admin ghi nghiệp vụ trên web

## Goal

Admin được tạo lead, ghi hoạt động, hoàn thành việc, đổi giai đoạn/Won/Lost và giao lead trên toàn công ty, nhưng không bao giờ thành owner lead và không duyệt yêu cầu.

## Files to Create / Modify

- Modify: `packages/contracts/src/index.ts` (`COMMANDS`, comment dòng ~220)
- Modify: `apps/crm/src/worker/commands.ts` (`assignLead` ~dòng 300-330, `createLead` ~dòng 250)
- Modify: `apps/crm/src/worker/scope.ts`: sửa comment `leadScope` (~dòng 11). Bỏ câu "business commands stay closed to Admin", thay bằng "Admin reads and writes organization-wide but never decides approvals".
- Modify: `apps/crm/src/worker/queries.ts` (`writer` ~dòng 304, `permissions.assign` ~dòng 315)
- Modify: `apps/crm/src/web/components/layout.tsx` (`businessWriter`, mô tả vai trò Admin, `SCOPE_LABEL`), `apps/crm/src/web/pages/leads.tsx` (nút Tạo lead), `apps/crm/src/web/pages/admin.tsx` (phụ đề)
- Modify tests: `apps/crm/test/security-api.test.ts`, `apps/crm/test/commands.test.ts`, `apps/crm/test/domain-commands.test.ts`
- Modify docs: `docs/security/permission-matrix-v1.md`, `docs/security/action-risk-matrix-v1.md`

## Tasks

### Task 1.1 — Mở role cho Admin trong contracts

- Goal: `COMMANDS` cho `admin` chạy các lệnh `createLead`, `assignLead`, `logActivity`, `completeTask`, `changeStage`.
- Target: `packages/contracts/src/index.ts`, hằng `COMMANDS`.
- Steps:
  1. Thêm `'admin'` vào mảng `roles` của 5 lệnh trên.
  2. Giữ nguyên `releaseLead: ['leader']`, `requestOwnerChange: ['sale']`, `decideApproval: ['sale','leader']`.
  3. Sửa comment `roles` trong `CommandDefinition`: bỏ câu "Admin has no business write". Thay bằng: "Admin writes organization-wide but never decides approvals".
- Success criteria: 5 lệnh có `'admin'`; 3 lệnh còn lại không có.
- Verify: `pnpm -F @abm/contracts typecheck` exit 0 (nếu package không có script này thì chạy `pnpm -F @abm/crm typecheck`).

### Task 1.2 — Tổng quát `assignLead` cho Admin

- Goal: Admin giao được lead của bất kỳ nhóm nào. Leader vẫn chỉ giao trong nhóm mình.
- Target: `apps/crm/src/worker/commands.ts`, handler `assignLead` và helper `loadTeamMember`.
- Steps:
  1. Đọc handler `assignLead`. Tìm các chỗ dùng `actor.teamId`.
  2. Tính nhóm đích theo vai trò:
     - Với `leader`: giữ đúng logic hiện có, là `actor.teamId`.
     - Với `admin`: dùng `lead.team_id` khi lead đã có nhóm. Với lead hàng chờ (`status='queue'`, `team_id` null), chấp nhận người nhận thuộc **bất kỳ** nhóm nào có `department_id = lead.department_id`, và lấy `team_id` của người nhận làm nhóm mới của lead.
  3. Người nhận vẫn phải `status='active'` và role trong `('sale','leader')`. Không được là Admin.
- Success criteria: Admin giao lead hàng chờ cho một Sale trong phòng ban được; Leader nhóm X giao cho người nhóm Y vẫn bị từ chối.
- Verify: no verification needed (Task 1.6 kiểm).

### Task 1.3 — `createLead` cho Admin

- Goal: Admin tạo lead vào hàng chờ của một phòng ban rõ ràng. Admin không thành owner.
- Target: `apps/crm/src/worker/commands.ts`, handler `createLead` (chỗ rơi về phòng ban cũ nhất khi `actor.departmentId` null).
- Steps:
  1. Giữ hành vi rơi về phòng ban mặc định hiện có cho Admin/BGĐ. Đây là quyết định có sẵn cho BGĐ, nên không đổi contract input.
  2. Xác nhận `owner_user_id` chỉ được gán khi actor là `sale`. Admin tạo thì lead vào hàng chờ.
- Success criteria: lead do Admin tạo có `owner_user_id` null và `status='queue'`.
- Verify: no verification needed (Task 1.6 kiểm).

### Task 1.4 — Quyền đọc trả `permissions` đúng cho Admin

- Goal: trang chi tiết lead hiện nút ghi cho Admin.
- Target: `apps/crm/src/worker/queries.ts`, mảng `writer` và object `permissions` trong `leadDetail`.
- Steps:
  1. Thêm `'admin'` vào `writer`.
  2. Đặt `permissions.assign` là `true` khi `actor.role === 'admin'` và lead đang `queue` hoặc `active`. Giữ điều kiện cũ cho Leader.
  3. Giữ mọi quyền duyệt (`decide…`) là `false` với Admin.
  4. Sửa danh sách người nhận để giao lead. `leadDetail` hiện gọi `teamMembers(db, row.team_id ?? actor.teamId)` (~dòng 300); hàm này trả `[]` khi tham số là null (~dòng 214). Với Admin trên lead hàng chờ (`team_id` null), trả thành viên `sale`/`leader` đang hoạt động của mọi nhóm thuộc `lead.department_id`. Viết thêm hàm `departmentMembers(db, departmentId)` hoặc mở rộng `teamMembers`.
- Success criteria: `GET /api/leads/:id` với Admin trả `permissions` có ghi = true và duyệt = false.
- Verify: no verification needed (Task 1.6 kiểm).

### Task 1.5 — Giao diện

- Goal: Admin thấy nút Tạo lead, form hoạt động, đổi giai đoạn, giao lead.
- Target: `layout.tsx` (`businessWriter`, nav "Tạo lead", nhãn công việc, `SCOPE_LABEL.admin`, mô tả RolePicker), `leads.tsx` (`actor.role !== 'admin'` quanh link `/leads/new`), `admin.tsx` (phụ đề).
- Steps:
  1. Bỏ chặn Admin ở `businessWriter` và `leads.tsx`.
  2. Đổi `SCOPE_LABEL.admin` thành `'Toàn công ty + cấu hình'`. Sửa mô tả Admin cho khớp, bỏ chữ "chỉ xem".
  3. Hàng chờ duyệt vẫn hiện cho Admin nhưng không có nút duyệt (API đã trả quyền false).
- Success criteria: `pnpm -F @abm/crm build` exit 0.
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 1.6 — Test

- Goal: test thể hiện quyền mới và bất biến.
- Target: `apps/crm/test/security-api.test.ts`, `commands.test.ts`, `domain-commands.test.ts`.
- Steps:
  1. Sửa `security-api.test.ts`:
     - map `allowed` ở ~dòng 75-86 (dùng `roles.slice(0,4)`): thêm `u-admin` cho 5 lệnh đã mở;
     - `test.each` ở ~dòng 106-114: bỏ `u-admin` khỏi danh sách "ghi vào bản ghi của người khác", vì Admin giờ có quyền ghi toàn công ty;
     - kỳ vọng "admin createLead → 403" (~dòng 68, 114) đổi thành 200, kèm kiểm lead mới có `owner_user_id` null.
  2. Đổi kỳ vọng `permissions` của Admin (`commands.test.ts` ~dòng 42-56): ghi = true, duyệt = false.
  3. Thêm các test:
     - (a) Admin `logActivity` trên lead của nhóm bất kỳ → 200;
     - (b) Admin `changeStage` sang `won` → 200, lead `status='won'`;
     - (c) Admin `assignLead` lead hàng chờ cho một Sale cùng phòng ban → 200, `owner_user_id` là Sale đó;
     - (d) Admin `assignLead` cho chính Admin → bị từ chối;
     - (e) Leader nhóm khác `assignLead` → bị từ chối như trước;
     - (f) Admin `decideApproval` → 403.
- Success criteria: các test mới tồn tại và xanh.
- Verify: `pnpm -F @abm/crm test` exit 0 và output không chứa `failed`.

### Task 1.7 — Tài liệu quyền

- Goal: tài liệu khớp quyền mới.
- Target: `docs/security/permission-matrix-v1.md` (hàng Admin và ghi chú đảo ngày 2026-10-04), `docs/security/action-risk-matrix-v1.md`.
- Steps:
  1. Hàng Admin: đọc và ghi nghiệp vụ toàn tổ chức; không duyệt; không làm owner.
  2. Ghi chú: "2026-10-04 (chiều): user mở quyền ghi cho Admin trên web và bot".
  3. Trong action-risk thêm đoạn:
     - Admin gọi qua agent thì làm thẳng, không cần duyệt.
     - Audit ghi `actor_kind='agent'`.
     - Kill switch vẫn áp dụng.
- Success criteria: `Select-String -Path docs/security/permission-matrix-v1.md -Pattern "Admin"` có dòng nói ghi toàn tổ chức.
- Verify: lệnh trên trả ít nhất một dòng chứa `ghi`.

### Task 1.8 — Kiểm tổng

- Verify: `pnpm -F @abm/crm typecheck` exit 0; `pnpm -F @abm/crm test` exit 0; `pnpm -F @abm/crm build` exit 0.
- Commit: `feat(crm): let admin write business data organization-wide` (theo quy ước repo, có dòng Co-Authored-By và Claude-Session).

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.

Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same failure evidence to the user. Never continue by self-reasoning.

## Rollback

`git revert` commit của phase. Không có thay đổi dữ liệu.
