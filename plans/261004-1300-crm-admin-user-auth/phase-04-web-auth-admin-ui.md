---
phase: 04
title: "Giao diện: đăng nhập, đổi mật khẩu, màn hình Người dùng"
status: completed
dependsOn: [02, 03]
---

# Phase 04 — Giao diện đăng nhập và quản lý người dùng

## Goal

Ở chế độ password, web hiện trang đăng nhập, bắt đổi mật khẩu tạm, có nút đăng xuất. Admin có màn hình Người dùng để nhập file, sửa, khóa/mở, cấp mật khẩu tạm và liên kết Lark. Chế độ demo giữ nguyên.

## Bối cảnh cần biết

- Shell: dùng PowerShell. Skill thiết kế: dùng phong cách sẵn có trong `apps/crm/src/web/styles.css` và component ở `apps/crm/src/web/components/ui.tsx` (`Alert`, `Badge`, `ErrorState`, `Loading`…). Không thêm thư viện UI.
- Gốc ứng dụng: `apps/crm/src/web/router.tsx` (`Root` hiện hiện `RolePicker` khi chưa chọn người dùng demo).
- Request API: `apps/crm/src/web/api.ts` (`request`, gửi `X-Demo-User`). Cookie phiên tự đi kèm vì cùng origin.
- Menu và đổi người dùng demo: `apps/crm/src/web/components/layout.tsx` (`Shell`, `UserSwitcher`, `RolePicker`).
- Trang Admin hiện tại: `apps/crm/src/web/pages/admin.tsx` (chỉ đọc).
- Giao diện tiếng Việt, có dấu.

## Files

| Path | Action |
|---|---|
| `apps/crm/src/worker/auth-routes.ts` | modify (thêm `GET /api/auth/mode`, công khai) |
| `apps/crm/src/web/api.ts` | modify |
| `apps/crm/src/web/router.tsx` | modify |
| `apps/crm/src/web/pages/login.tsx` | create |
| `apps/crm/src/web/pages/change-password.tsx` | create |
| `apps/crm/src/web/pages/admin-users.tsx` | create |
| `apps/crm/src/web/components/layout.tsx` | modify |
| `apps/crm/src/web/types.ts` | modify |
| `apps/crm/src/web/styles.css` | modify (chỉ khi cần class mới) |
| `apps/crm/scripts/bootstrap-admin.mjs` | create |
| `.gitignore` | modify (thêm `.admin-bootstrap.local`) |

## Tasks

### Task 4.1 — Biết chế độ đăng nhập
- Goal: web biết đang ở `password` hay `demo`.
- Steps:
  1. Worker: `GET /api/auth/mode` (đặt trước `requireActor`) trả `{ ok: true, data: { mode: c.env.AUTH_MODE === 'password' ? 'password' : 'demo' } }`.
  2. `api.ts`: thêm `api.post(path, body)` cho JSON POST (không Idempotency-Key); chỉ gửi `X-Demo-User` khi mode là `demo`.
- Verify: no verification needed (Task 4.6).

### Task 4.2 — Trang đăng nhập `login.tsx`
- Goal: form email + mật khẩu.
- Steps:
  1. Hai ô có `<label>`, `autocomplete="username"` và `autocomplete="current-password"`, nút "Đăng nhập" có trạng thái đang gửi.
  2. Lỗi hiển thị bằng `Alert` với message từ API (sai mật khẩu, bị khóa 5 phút, mật khẩu tạm hết hạn).
  3. Thành công → invalidate queries và tải lại `/me`.
- Verify: no verification needed (Task 4.6).

### Task 4.3 — Trang đổi mật khẩu `change-password.tsx`
- Goal: bắt buộc khi `mustChangePassword`; cũng mở được từ menu người dùng.
- Steps:
  1. Ba ô: mật khẩu hiện tại (hoặc mật khẩu tạm), mật khẩu mới, nhập lại. Kiểm phía client: ≥ 8 ký tự, hai ô mới trùng nhau.
  2. Gọi `POST /api/auth/change-password`; thành công → về trang chủ.
- Verify: no verification needed (Task 4.6).

### Task 4.4 — `Root` và menu
- Goal: luồng hiển thị đúng theo chế độ.
- Steps:
  1. `router.tsx` `Root`: gọi `/auth/mode`. Ở chế độ `password`: `/me` trả 401 → `LoginPage`; `/me` có `mustChangePassword` (thêm trường này vào response `/me` trong Worker) → `ChangePasswordPage`; còn lại → `Shell`. Ở chế độ `demo`: giữ nguyên `RolePicker`.
  2. `layout.tsx`: ở chế độ password, thay `UserSwitcher` bằng khối tên + vai trò, kèm hai nút "Đổi mật khẩu" và "Đăng xuất" (gọi `POST /api/auth/logout`, xóa cache query, về trang đăng nhập).
  3. Menu Admin: thêm mục "Người dùng" (`/admin/users`, icon có sẵn) trên mục "Cấu hình".
- Verify: no verification needed (Task 4.6).

### Task 4.5 — Màn hình Người dùng `admin-users.tsx`
- Goal: Admin làm mọi thao tác của phase 02–03.
- Steps:
  1. Route `/admin/users` trong `router.tsx`; người không phải Admin thấy `Alert` "Chỉ Admin quản lý người dùng".
  2. Bảng người dùng: tên, email, vai trò, phòng ban/nhóm, trạng thái (Hoạt động/Đã khóa), mật khẩu (Chưa cấp / Mật khẩu tạm, hạn … / Đã đặt), Lark (Đã liên kết / Không tìm thấy / Lỗi / Chưa kiểm). Dùng class bảng `table responsive` sẵn có.
  3. Nút mỗi dòng: Sửa (dialog sửa tên, email, vai trò, phòng ban, nhóm), Khóa/Mở (có hộp xác nhận), Cấp mật khẩu tạm, Thử liên kết Lark. Ẩn Khóa và đổi vai trò ở dòng của chính Admin.
  4. Khối "Nhập danh sách": link tải mẫu `/mau-danh-sach-nhan-su.csv` và link hướng dẫn; chọn file `.csv` (đọc bằng `FileReader` dạng UTF-8) → gọi preview → bảng xem trước (tạo mới / cập nhật / không đổi / lỗi theo dòng, phòng ban/nhóm sẽ tạo) → nút "Xác nhận nhập" bị khóa khi còn lỗi.
  5. Hộp hiện mật khẩu tạm (sau khi nhập hoặc cấp lại): bảng tên, email, mật khẩu, hạn; nút "Sao chép" từng dòng và nút "Tải file CSV" (tạo bằng `Blob` phía trình duyệt, không gửi lên server). Dòng cảnh báo: "Mật khẩu chỉ hiện một lần. Đóng hộp này là không xem lại được." Đóng hộp thì xóa mật khẩu khỏi state.
  6. Nút "Liên kết Lark cho mọi người" và thông báo kết quả (đã liên kết / không tìm thấy / lỗi kèm message).
- Verify: no verification needed (Task 4.6).

### Task 4.6 — Script cấp mật khẩu tạm cho Admin đầu tiên
- Goal: có cách cấp mật khẩu cho Admin đầu tiên mà agent không nhìn thấy mật khẩu.
- Target: `apps/crm/scripts/bootstrap-admin.mjs`; thêm `.admin-bootstrap.local` vào `.gitignore` ở gốc repo.
- Steps:
  1. Tham số: `--local` hoặc `--remote` (bắt buộc chọn một), `--email <email>`.
  2. Tạo mật khẩu 12 ký tự cùng bảng chữ với `generateTempPassword`. Băm PBKDF2-SHA256 bằng `node:crypto` `pbkdf2Sync`, độ dài 32 byte, salt 16 byte. File `.mjs` không import được từ `.ts`, nên **chép** hằng `PASSWORD_ITERATIONS` sang script kèm comment "giữ bằng giá trị trong src/worker/password.ts". Hash và salt mã hoá base64 chuẩn có padding (không phải base64url), giống `password.ts`.
  3. Ghi file SQL tạm vào `os.tmpdir()`: `UPDATE app_user SET password_hash=…, password_salt=…, password_iterations=…, must_change_password=1, temp_password_expires_at=<now+48h>, failed_login_count=0, locked_until=NULL WHERE email=… AND role='admin' AND status='active';`. Chạy `npx wrangler d1 execute abm-crm-eval --local|--remote --file <tmp>` (cwd `apps/crm`), rồi xóa file tạm.
  4. Kiểm lại bằng `SELECT COUNT(*) AS n FROM app_user WHERE email=… AND must_change_password=1`. `n` khác 1 thì thoát mã 1 và không ghi file mật khẩu.
  5. Ghi mật khẩu vào `apps/crm/.admin-bootstrap.local` với flag `wx` (không ghi đè). Chỉ in "Đã ghi mật khẩu tạm vào .admin-bootstrap.local". **Không in mật khẩu hay hash.**
- Verify: `git check-ignore apps/crm/.admin-bootstrap.local` exits 0. Script được chạy thật ở Task 4.7.

### Task 4.7 — Kiểm local
- Goal: build sạch và luồng API chạy với Worker local ở chế độ password.
- Steps:
  1. Chạy `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm build`.
  2. Chạy `pnpm -F @abm/crm test`.
  3. Reset D1 local: xóa thư mục `apps/crm/.wrangler/state`, chạy `pnpm -F @abm/crm db:migrate:local` rồi `pnpm -F @abm/crm db:seed:local`.
  4. Đặt mật khẩu tạm cho `u-admin` trên D1 local: `node scripts/bootstrap-admin.mjs --local --email admin@demo.abm.example` (cwd `apps/crm`). Mật khẩu nằm ở `apps/crm/.admin-bootstrap.local`; **không** in ra. Xóa file này sau bước 6.
  5. Chạy nền `npx wrangler dev --port 8787 --var AUTH_MODE:password` trong `apps/crm` (ghi PID; dừng ở bước 7).
  6. Bằng PowerShell `Invoke-WebRequest`. Không dùng `-WebSession`: .NET không gửi lại cookie `Secure` tới `http://127.0.0.1`. Thay vào đó, lấy `abm_session=...` từ header `Set-Cookie` của response đăng nhập (và của response đổi mật khẩu) rồi gửi bằng `-Headers @{ Cookie = ...; Origin = 'http://127.0.0.1:8787' }`. Mọi POST đều kèm `Origin`. Các bước: `GET http://127.0.0.1:8787/api/auth/mode` có `"password"`; đăng nhập bằng mật khẩu đọc từ `.admin-bootstrap.local` vào biến (không echo) → 200; `GET /api/leads` → 403 `PASSWORD_CHANGE_REQUIRED`; đổi mật khẩu → 200; `GET /api/admin/overview` → 200.
  7. Dừng `wrangler dev` đã chạy (`Stop-Process -Id <PID>`).
- Verify: typecheck, build, test đều exit 0; bốn status ở bước 6 lần lượt là 200 (mode chứa `password`), 200, 403, 200 và 200. Sau bước 7, `Get-NetTCPConnection -LocalPort 8787 -State Listen` không trả gì.

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

`git checkout` các file web và Worker đã sửa, xóa file mới.
