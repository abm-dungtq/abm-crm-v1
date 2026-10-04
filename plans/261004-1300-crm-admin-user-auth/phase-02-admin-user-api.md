---
phase: 02
title: "API Admin: nhập danh sách, quản lý người dùng"
status: completed
dependsOn: [01]
---

# Phase 02 — API Admin quản lý người dùng

## Goal

Admin gọi API để xem trước và nhập file CSV nhân sự, sửa người dùng, khóa/mở tài khoản và cấp mật khẩu tạm. Mọi thay đổi đi qua `GuardedTx` và ghi audit, không bao giờ lưu mật khẩu tạm.

## Bối cảnh cần biết

- Shell: dùng PowerShell.
- Mẫu CSV: `apps/crm/public/mau-danh-sach-nhan-su.csv` (UTF-8 có BOM, cột `Họ tên,Email,Phòng ban,Nhóm,Vai trò`). Quy tắc cột: `docs/guides/staff-roster-template.md`.
- `GuardedTx` ở `apps/crm/src/worker/guarded-tx.ts`; kiểu `GuardedTable` hiện chỉ có `'lead' | 'task' | 'approval'`.
- Admin hiện chỉ có `GET /api/admin/overview` (`index.ts`, `queries.ts` `adminOverview`).
- **Không** dùng `runCommand` cho các endpoint này: `runCommand` lưu kết quả vào `idempotency_key`, mà kết quả cấp mật khẩu tạm không được lưu ở đâu.

## Files

| Path | Action |
|---|---|
| `apps/crm/src/worker/roster.ts` | create (đọc CSV, chuẩn hoá, so sánh với DB) |
| `apps/crm/src/worker/admin-routes.ts` | create (Hono sub-app `/admin/...`) |
| `apps/crm/src/worker/guarded-tx.ts` | modify (thêm `department`, `team` vào `GuardedTable`; `app_user` đã thêm ở phase 01) |
| `apps/crm/src/worker/index.ts` | modify (gắn `admin-routes`) |
| `apps/crm/src/worker/queries.ts` | modify (`adminOverview` trả thêm `status`, `mustChangePassword`, `hasPassword`, `larkLinkStatus`, `version`) |
| `packages/contracts/src/index.ts` | modify (schema input admin) |
| `apps/crm/seed/demo-roster.csv` | create (dữ liệu demo giả) |
| `apps/crm/test/admin-users.test.ts` | create |

## Tasks

### Task 2.1 — Đọc CSV `roster.ts`
- Goal: chuyển chuỗi CSV thành danh sách dòng đã chuẩn hoá kèm lỗi theo dòng.
- Target: `apps/crm/src/worker/roster.ts`, export `parseRosterCsv(text): { rows: RosterRow[]; errors: RowError[] }`, `RosterRow = { line, name, email, departmentName, teamName, role }`.
- Steps:
  1. Bỏ BOM `﻿` đầu chuỗi. Tách dòng theo `\r?\n`, bỏ dòng trống.
  2. Dấu phân cách: đếm `,` `;` `\t` trong dòng tiêu đề, chọn ký tự nhiều nhất.
  3. Bộ đọc CSV hỗ trợ ô trong ngoặc kép và `""` thoát ngoặc.
  4. Khớp tiêu đề bằng `foldText`: `ho ten`, `email`, `phong ban`, `nhom`, `vai tro`. Thiếu cột → một lỗi chung "Thiếu cột …", không đọc tiếp.
  5. Vai trò, khớp bằng `foldText`: `sale`/`nhan vien kinh doanh` → `sale`; `leader`/`truong nhom` → `leader`; `truong phong` → `head`; `bgd`/`ban giam doc`/`giam doc` → `director`; `admin`/`quan tri` → `admin`. Giá trị khác → lỗi "Vai trò không hợp lệ".
  6. Email: `normalizeEmail`, kiểm định dạng bằng `z.email()`. Email trùng trong file → lỗi ở các dòng trùng.
  7. Quy tắc theo vai trò: `sale`/`leader` bắt buộc Phòng ban và Nhóm; `head` bắt buộc Phòng ban, Nhóm phải trống; `director`/`admin` hai cột phải trống.
  8. Họ tên bắt buộc, tối đa 120 ký tự. File tối đa 1000 dòng dữ liệu và 512 KB → vượt thì lỗi chung.
- Verify: no verification needed (Task 2.6).

### Task 2.2 — So sánh với DB (xem trước)
- Goal: biết dòng nào tạo mới, cập nhật, không đổi; phòng ban/nhóm nào sẽ tạo.
- Target: `roster.ts`, export `planRoster(db, actor, rows): RosterPlan`.
- Steps:
  1. Đọc mọi `department`, `team` của `actor.organizationId` và mọi `app_user` theo email.
  2. Phòng ban khớp tên bằng `foldText`; chưa có → thêm vào `newDepartments`. Nhóm khớp theo (phòng ban, tên đã fold); chưa có → `newTeams`.
  3. Mỗi dòng: email chưa có → `create`; có và khác tên/vai trò/phòng ban/nhóm → `update` kèm danh sách trường đổi; giống hệt → `unchanged`.
  4. Dòng chạm chính Admin đang thao tác mà đổi vai trò → lỗi "Không tự đổi vai trò của mình".
  5. Không tự khóa người vắng mặt trong file.
- Verify: no verification needed (Task 2.6).

### Task 2.3 — Endpoint nhập danh sách
- Goal: `POST /api/admin/roster/preview` và `POST /api/admin/roster/commit`.
- Target: `admin-routes.ts`; mọi route kiểm `actor.role === 'admin'`, sai → 403 `FORBIDDEN`.
- Steps:
  1. Body cả hai: `{ csv: string }` (schema `rosterImportInput` trong contracts, `csv` tối đa 512 000 ký tự).
  2. Preview: trả `{ rows, errors, newDepartments, newTeams, counts: { create, update, unchanged } }`. Không ghi DB.
  3. Commit: tính lại plan phía server; có lỗi → 422 `VALIDATION_FAILED` kèm `errors`. Không lỗi → một `GuardedTx` (`command = 'importRoster'`): tạo phòng ban, nhóm mới; `insertVersioned('app_user', …)` cho người mới (id `u-` + `crypto.randomUUID()`, chưa có mật khẩu); `update('app_user', id, version, …)` cho người đổi; `tx.audit('app_user', id, before, after)` cho mỗi thay đổi, với `before`/`after` chỉ gồm tên, email, vai trò, phòng ban, nhóm.
  4. Thêm `tx.assert("SELECT COUNT(*) >= 1 FROM app_user WHERE organization_id = ? AND role = 'admin' AND status = 'active'", [orgId])` vào cuối batch, **trước** `await tx.commit()`. Kiểm điều này trước bằng JS để trả message rõ ràng; assert chỉ chặn trường hợp hai request chạy cùng lúc.
  5. Commit nhận thêm `issueTempPasswords: boolean` (mặc định `true`): người **mới tạo** được cấp mật khẩu tạm ngay (theo Task 2.4).
  6. Response commit: `{ counts: { create, update, unchanged }, tempPasswords: [{ userId, name, email, password, expiresAt }] }`. Khi `create + update = 0` và không có phòng ban/nhóm mới, trả kết quả ngay, **không** gọi `tx.commit()` (batch không có anchor).
  7. Thêm `'department'` và `'team'` vào `GuardedTable` (cả hai bảng có `version`/`last_txn_id`). Dòng ghi đầu tiên của batch là anchor; audit đi sau vẫn đúng.
  8. Bắt lỗi: `isConstraintFailure` (email trùng do `UNIQUE`) → 422 `VALIDATION_FAILED` "Email đã dùng"; `isGuardFailure` → 409 `STALE_VERSION`. Hai hàm có sẵn trong `guarded-tx.ts`. Gọi `isGuardFailure` trước, vì message lỗi guard cũng chứa chữ "constraint failed".
- Verify: no verification needed (Task 2.6).

### Task 2.4 — Endpoint quản lý từng người
- Goal: sửa, khóa/mở, cấp mật khẩu tạm.
- Target: `admin-routes.ts`.
- Steps:
  1. `PATCH /api/admin/users/:id` body `{ version, name?, email?, role?, departmentName?, teamName? }`: dùng lại quy tắc vai trò ở Task 2.1; không cho Admin đổi vai trò của chính mình; đổi email thì đặt `lark_link_status='unlinked'`, `lark_open_id=NULL`. Version lệch → 409 `STALE_VERSION`.
  2. `POST /api/admin/users/:id/status` body `{ version, status: 'active'|'disabled' }`: không cho tự khóa mình; khóa → trong cùng batch `UPDATE user_session SET revoked_at = now WHERE user_id = ? AND revoked_at IS NULL`; assert còn ít nhất một Admin hoạt động.
  3. `POST /api/admin/users/:id/temp-password` body `{ version }`: `generateTempPassword()`, `hashPassword`, đặt `must_change_password=1`, `temp_password_expires_at = now + 48 giờ`, `failed_login_count=0`, `locked_until=NULL`, thu hồi phiên cũ. Response `{ password, expiresAt }`. Audit `command='issueTempPassword'`, `after_json = { expiresAt }`, **không** có mật khẩu.
  4. Thêm header `Cache-Control: no-store` cho response có mật khẩu.
  5. Mọi endpoint ghi dùng `GuardedTx` và `tx.audit`, bắt lỗi giống Task 2.3 bước 8 (email trùng → 422, guard hoặc version lệch → 409). Trước khi khóa hoặc hạ vai trò một Admin, kiểm bằng JS còn Admin hoạt động khác; nếu không còn, trả 409 "Phải còn ít nhất một Admin hoạt động".
- Verify: no verification needed (Task 2.6).

### Task 2.5 — Dữ liệu demo `demo-roster.csv`
- Goal: file CSV giả để thử nhập trên bản eval.
- Target: `apps/crm/seed/demo-roster.csv` (UTF-8 có BOM, CRLF, cùng tiêu đề với mẫu).
- Steps:
  1. Gồm 8 người demo hiện có trong `seed/generate-demo-seed.mjs` (cùng email `@demo.abm.example`, tên, vai trò, phòng ban "Phòng Kinh doanh", nhóm "Kinh doanh 1"/"Kinh doanh 2").
  2. Thêm 3 người giả mới: một Admin thứ hai `admin2@demo.abm.example`, một Sale `sale-moi@demo.abm.example` ở nhóm mới "Kinh doanh 3", một Trưởng phòng ở phòng mới "Phòng Chăm sóc khách hàng".
- Verify: no verification needed (Task 2.6 đọc file này).

### Task 2.6 — Test
- Goal: chứng minh quy tắc nhập và quản lý.
- Target: `apps/crm/test/admin-users.test.ts` (seed giống `test/security-api.test.ts`, thêm `'user_session'` vào `tables`, gọi chế độ demo `DEMO_MODE: '1'` với `X-Demo-User: u-admin`, có `Origin` không bắt buộc ở chế độ demo).
- Steps: viết các test sau, mỗi test một `test(...)`. Đọc `seed/demo-roster.csv` bằng import `?raw`:
  - Sale (`u-lan`) gọi preview → 403.
  - preview `demo-roster.csv`: `counts.create = 3`, `newTeams` chứa "Kinh doanh 3", `newDepartments` chứa "Phòng Chăm sóc khách hàng", `errors` rỗng; số dòng `app_user` không đổi.
  - commit → `tempPasswords.length = 3`; commit lại cùng file → `counts.create = 0` và `counts.update = 0`, không thêm dòng `audit_log`.
  - CSV dấu `;` đọc giống CSV dấu `,`.
  - lỗi: email trùng, thiếu email, vai trò "Kế toán", Sale thiếu Nhóm, BGĐ có Phòng ban → mỗi trường hợp có lỗi đúng dòng; commit trả 422 và DB không đổi.
  - Admin tự khóa mình → 4xx; khóa Admin còn lại khi chỉ còn một Admin → 409 và DB không đổi.
  - cấp mật khẩu tạm: response có `password` dài 12; `audit_log` mới nhất không chứa chuỗi mật khẩu; đăng nhập chế độ password với mật khẩu đó → 200 và `mustChangePassword = true`.
  - khóa người dùng thu hồi phiên: tạo phiên cho `u-lan`, khóa `u-lan` → cookie đó trả 401.
  - `SELECT COUNT(*) FROM idempotency_key WHERE result_json LIKE '%' || <password> || '%'` = 0.
- Verify: `pnpm -F @abm/crm test` exits 0, output không chứa `failed`; `pnpm -F @abm/crm typecheck` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.

## Rollback

Xóa file mới và `git checkout` các file đã sửa. Chưa chạm remote.
