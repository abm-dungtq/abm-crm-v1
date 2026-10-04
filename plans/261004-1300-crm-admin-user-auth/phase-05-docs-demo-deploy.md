---
phase: 05
title: "Tài liệu và triển khai eval với dữ liệu demo"
status: pending
dependsOn: [04]
---

# Phase 05 — Tài liệu và triển khai bản eval với dữ liệu demo

## Goal

Tài liệu ghi đúng quyết định mới. Bản eval chạy chế độ mật khẩu với dữ liệu demo. Admin demo đăng nhập được, nhập `demo-roster.csv` được, và số vòng PBKDF2 nằm trong giới hạn CPU của gói miễn phí.

## Bối cảnh cần biết

- Shell: dùng PowerShell. Không in Cloudflare account ID, token, mật khẩu hay App Secret.
- Worker eval: `abm-crm-eval`, URL https://abm-crm-eval.ngulongyquan.workers.dev, D1 `abm-crm-eval`. Lần deploy trước: backup `exports/abm-crm-eval-before-0002-20261004.sql`, migration `0002` đã áp.
- **Cần user đồng ý trong chat trước Task 5.4** (backup, migration remote, deploy) và **user tự chạy** các lệnh đặt secret ở Task 5.6.

## Files

| Path | Action |
|---|---|
| `docs/adr/adr-006-password-login.md` | create |
| `docs/adr/adr-002-web-auth.md` | modify (status `superseded by ADR-006`) |
| `docs/security/permission-matrix-v1.md` | modify (Admin quản lý người dùng) |
| `docs/engineering/environments.md` | modify (`AUTH_MODE`, `LARK_APP_ID`, `LARK_APP_SECRET`) |
| `docs/README.md` | modify (link ADR-006 và hướng dẫn mẫu nhân sự) |
| `apps/crm/wrangler.jsonc` | modify (`vars`: bỏ `DEMO_MODE`, thêm `AUTH_MODE: "password"`) |
| `apps/crm/src/worker/password.ts` | modify (chỉ khi Task 5.5 đổi số vòng) |
| `plans/261004-1300-crm-admin-user-auth/plan.md` | modify (trạng thái) |
| `plans/reports/deploy-<yyMMdd-HHmm>-crm-password-login.md` | create |

## Tasks

### Task 5.1 — Tài liệu
- Goal: ADR và tài liệu khớp với code.
- Steps:
  1. ADR-006 (theo khuôn các ADR có sẵn): bối cảnh (có nhân viên không dùng Lark; dùng nội bộ), quyết định (mật khẩu PBKDF2, mật khẩu tạm 48 giờ dùng một lần, bắt đổi, khóa 5 phút sau 10 lần sai, phiên 7 ngày cookie HttpOnly, `AUTH_MODE`), phương án bị loại (Lark OAuth, Cloudflare Access), hệ quả (số vòng phụ thuộc gói Cloudflare; Admin tự cấp mật khẩu). Ghi lớp xác thực `/mcp` cho GoClaw vẫn theo ADR-004 (credential từng người), không dùng phiên web.
  2. ADR-002: đổi trạng thái thành superseded, thêm một dòng link ADR-006.
  3. Ma trận quyền: Admin được quản lý người dùng (nhập danh sách, sửa, khóa, cấp mật khẩu tạm, liên kết Lark); vẫn không xem dữ liệu kinh doanh.
  4. `environments.md`: thêm ba biến và nói rõ `DEMO_MODE` chỉ dùng cho test/local, không đặt cùng `AUTH_MODE=password`.
- Verify: mọi link tương đối trong các file đã sửa trỏ tới file có thật. Kiểm bằng PowerShell: với mỗi link `](...md)` trong năm file, `Test-Path` của đường dẫn đã ghép trả `True`.

### Task 5.2 — Chuyển cấu hình eval sang chế độ mật khẩu
- Steps:
  1. `apps/crm/wrangler.jsonc` `vars`: xóa `DEMO_MODE`, thêm `"AUTH_MODE": "password"` kèm comment ngắn.
  2. Chạy `pnpm -F @abm/crm test` (test vẫn ở chế độ demo nhờ binding `AUTH_MODE: ''` trong `vitest.config.ts`; test demo tự truyền `DEMO_MODE: '1'`).
- Verify: `pnpm -F @abm/crm test` exits 0, output không chứa `failed`.

### Task 5.3 — Xin user đồng ý
- Goal: có câu trả lời "đồng ý" trong chat cho: backup D1 eval, áp migration `0003` lên remote, deploy, chạy script cấp mật khẩu Admin trên remote.
- Steps: hỏi user, nêu rõ bốn việc và việc bản eval sẽ **mất màn hình chọn vai trò demo** (thay bằng đăng nhập).
- Verify: user trả lời đồng ý. Nếu không đồng ý → dừng phase, không phải lỗi.

### Task 5.4 — Backup, migration, deploy
- Steps (cwd `apps/crm`):
  1. `npx wrangler d1 export abm-crm-eval --remote --output ../../exports/abm-crm-eval-before-0003-<yyyyMMdd>.sql`. Kiểm file tồn tại và chứa ít nhất một dòng `INSERT INTO lead`.
  2. `npx wrangler d1 migrations apply abm-crm-eval --remote`.
  3. `pnpm -F @abm/crm deploy`.
  4. `node scripts/bootstrap-admin.mjs --remote --email admin@demo.abm.example`.
- Verify: bước 1 có file và `Select-String 'INSERT INTO lead'` khớp ít nhất 1 dòng; bước 2 exit 0 và output chứa `0003_user_auth.sql`; bước 3 output chứa `abm-crm-eval.ngulongyquan.workers.dev`; bước 4 exit 0 và in "Đã ghi mật khẩu tạm".

### Task 5.5 — Đo CPU đăng nhập
- Goal: số vòng PBKDF2 không làm Worker vượt CPU ở gói miễn phí.
- Steps:
  1. Đọc mật khẩu từ `apps/crm/.admin-bootstrap.local` vào biến PowerShell (không echo). Đăng nhập rồi đổi sang một mật khẩu mới ngẫu nhiên do script tạo; lưu mật khẩu mới vào chính file đó (ghi đè có chủ đích) để user dùng.
  2. Gửi 20 lần `POST /api/auth/login` liên tiếp với mật khẩu đúng (Origin là URL eval).
  3. Nếu có lần nào khác 200 (đặc biệt 503 hoặc lỗi 1102 vượt CPU): giảm `PASSWORD_ITERATIONS` (50 000 → 25 000 → 10 000) ở **cả hai** nơi `src/worker/password.ts` và `scripts/bootstrap-admin.mjs`, chạy lại test, deploy lại, lặp bước 2. Mật khẩu đã băm bằng số vòng cũ vẫn dùng được, vì số vòng lưu theo từng dòng.
  4. Đo giới hạn nhập danh sách: tạo CSV giả 100 rồi 200 dòng (email `@cpu-test.example`, vai trò BGĐ), chỉ gọi `POST /api/admin/roster/preview` và `commit` cho bản 100 dòng; nếu commit lỗi CPU, hạ `ROSTER_MAX_ROWS` trong `roster.ts` về mức đo được. Sau khi đo, khóa các tài khoản thử (hoặc xóa bằng `wrangler d1 execute` sau khi backup) và ghi kết quả vào báo cáo.
- Verify: lần đổi mật khẩu ở bước 1 trả 200 (đây là đường nặng nhất: kiểm mật khẩu cũ và băm mật khẩu mới); 20/20 lần đăng nhập trả 200. Ghi số vòng cuối và giới hạn dòng đo được vào báo cáo.
- Ngay sau bước 1, kiểm bằng trình duyệt trên eval: trang đăng nhập, màn hình Người dùng (mở một hộp thoại), đăng xuất. Lỗi hiển thị → `npx wrangler rollback`.

### Task 5.6 — Secret Lark (user tự làm) và nhập dữ liệu demo
- Steps:
  1. Hướng dẫn user tự chạy (agent không thấy giá trị): `! cd D:\TQD\CRM\apps\crm; npx wrangler secret put LARK_APP_ID` và `… LARK_APP_SECRET`, lấy từ `D:\Goclaw\data\lark-app.local.txt`. Hướng dẫn user bật quyền tra ID theo email và phạm vi danh bạ toàn công ty trong trang quản trị app Lark, rồi phát hành phiên bản app.
  2. User đăng nhập trang eval bằng tài khoản Admin demo, mở Người dùng, nhập `apps/crm/seed/demo-roster.csv`, lưu mật khẩu tạm của 3 người mới, bấm "Liên kết Lark cho mọi người".
- Verify: `npx wrangler d1 execute abm-crm-eval --remote --command "SELECT COUNT(*) AS n FROM app_user"` trả `n = 11`. Liên kết Lark với email demo cho kết quả `unmatched` (email giả) hoặc `error` (chưa có quyền); cả hai đều đạt. Ghi rõ trường hợp nào. Với danh sách thật, "Không tìm thấy" thường do ô Email liên hệ trong hồ sơ Lark trống hoặc khác (Lark không tra theo hộp thư doanh nghiệp).

### Task 5.7 — Kiểm cuối và báo cáo
- Steps:
  1. Smoke: `GET /` 200; `GET /api/auth/mode` chứa `password`; `GET /api/demo-users` 403; `GET /api/leads` không cookie 401; header `X-Demo-User: u-bgd` không cookie 401. Với Sale demo `lan@demo.abm.example` (seed chưa có mật khẩu): Admin cấp mật khẩu tạm → đăng nhập 200 → Admin khóa → đăng nhập lại 401 → Admin mở lại.
  2. Viết báo cáo deploy: các bước, kết quả, số vòng PBKDF2, đường dẫn backup, việc còn chờ user. Không ghi mật khẩu, secret hay account ID.
  3. Cập nhật `plan.md`: trạng thái từng phase.
  4. Xóa `apps/crm/.admin-bootstrap.local` **chỉ sau khi** user xác nhận đã lưu mật khẩu Admin ở nơi riêng.
- Verify: mọi kết quả smoke đúng như mô tả ở bước 1; báo cáo tồn tại; `Select-String` trên báo cáo không khớp `password=`, `secret` có giá trị hay chuỗi 32 ký tự hex.

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

- Code: deploy lại bản trước bằng `npx wrangler rollback` (cwd `apps/crm`).
- Dữ liệu: migration `0003` chỉ thêm cột và bảng, bản code cũ vẫn chạy được trên schema mới. Khi cần khôi phục hẳn, dùng file backup ở Task 5.4.
- Trở về chế độ demo: đặt lại `DEMO_MODE: "1"`, bỏ `AUTH_MODE` trong `wrangler.jsonc`, rồi deploy.
