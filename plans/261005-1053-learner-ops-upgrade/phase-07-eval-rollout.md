---
phase: 7
title: "Deploy eval và kiểm thử theo vai trò"
status: pending
priority: P1
effort: "0.5d"
dependencies: [6]
---

# Phase 07: Deploy eval

## Goal

Đưa migration `0006` đến `0011` và code mới lên `abm-crm-eval`, có bản sao lưu trước. Kiểm bằng máy: API sống, dữ liệu cũ còn nguyên. Sau đó trao user một danh sách kiểm thử theo từng vai trò để chạy trên trình duyệt.

Chỉ làm trên eval. Không có production.

Mọi lệnh chạy từ `D:\TQD\CRM\apps\crm`, dùng PowerShell. Lệnh `wrangler` phải gọi qua `pnpm exec`.

## Tasks

### Task 7.1: Kiểm toàn bộ trước khi deploy

- Steps: từ `D:\TQD\CRM`, chạy lần lượt:
  - `pnpm -F @abm/crm test`
  - `pnpm -F @abm/crm typecheck`
  - `pnpm -F @abm/crm build`
- Verify: cả 3 lệnh exit 0.

### Task 7.2: Hỏi user trước khi đụng eval

- Goal: thao tác lên D1 thật chỉ diễn ra khi user đồng ý.
- Steps:
  1. Báo user bằng tiếng Việt dễ hiểu:
     - sẽ chạy 6 migration;
     - hai bảng `app_user` và `lead` sẽ được dựng lại;
     - đã có bản sao lưu ở bước sau.
  2. Chờ user trả lời "đồng ý".
- Verify: user đã trả lời "đồng ý". Chưa có thì STOP.

### Task 7.3: Sao lưu D1

- Steps: chạy `pnpm exec wrangler d1 export abm-crm-eval --remote --output ..\..\exports\abm-crm-eval-before-learner-ops-<yyyyMMdd-HHmm>.sql`, thay `<yyyyMMdd-HHmm>` bằng thời điểm hiện tại theo giờ VN.
- Verify: file tồn tại và kích thước > 100000 byte. Kiểm bằng `(Get-Item <file>).Length`.

### Task 7.4: Đếm dữ liệu trước

- Steps: chạy `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "select (select count(*) from app_user) u, (select count(*) from lead) l, (select count(*) from audit_log) a"`, rồi ghi lại 3 số.
- Verify: lệnh exit 0.

### Task 7.5: Áp migration

- Steps: chạy `pnpm exec wrangler d1 migrations apply abm-crm-eval --remote`.
- Verify:
  - Lệnh exit 0 và output có `0011_privacy_requests.sql`.
  - Chạy lại câu đếm của Task 7.4. `u` và `l` phải bằng trước. `a` phải lớn hơn hoặc bằng trước.

### Task 7.6: Deploy

- Steps: chạy `pnpm run deploy`.
- Verify:
  - Output có `Current Version ID`.
  - `Invoke-WebRequest https://abm-crm-eval.ngulongyquan.workers.dev/api/health -UseBasicParsing` trả StatusCode 200.
  - Gọi `POST /api/auth/login` với email không tồn tại, kèm header `Origin: https://abm-crm-eval.ngulongyquan.workers.dev`, trả 401.

### Task 7.7: Danh sách kiểm thử cho user

- Goal: user tự đăng nhập và chạy thử từng vai trò. Agent không biết và không được dùng mật khẩu của ai.
- Steps:
  1. Ghi báo cáo `plans/reports/deploy-<yyMMdd-HHmm>-learner-ops-eval.md`, gồm:
     - phiên bản đã deploy, file sao lưu, các số đếm trước và sau;
     - checklist theo vai trò. Mỗi dòng là một thao tác kèm kết quả mong đợi, lấy từ phần "Tiêu chí nghiệm thu" của `plan.md`;
     - bước tạo tài khoản kiểm thử: Admin dùng **Quản trị → Người dùng → Nhập file** với 3 vai trò mới, rồi cấp mật khẩu tạm.
  2. Hỏi user nhân sự thật nào giữ vai trò Học vụ, Giáo viên và Kế toán. Gợi ý: Thanh (`dangthanh420@gmail.com`) làm Kế toán.
- Verify: file báo cáo tồn tại.

### Task 7.8: Cập nhật kế hoạch

- Steps: đổi `status` của các phase và của `plan.md` thành `completed`. Thêm một mục "Kết quả deploy" vào `plan.md`, có link tới báo cáo ở Task 7.7.
- Verify: chạy `Select-String -Path plans/261005-1053-learner-ops-upgrade/plan.md -Pattern "status: completed"`, phải ra 1 dòng.

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

- **Code:** chạy `pnpm exec wrangler rollback` để quay về phiên bản trước.
- **Dữ liệu:**
  1. Báo user trước khi làm.
  2. Tạo D1 mới, hoặc xóa toàn bộ bảng của `abm-crm-eval`.
  3. Nạp lại file sao lưu ở Task 7.3 bằng `pnpm exec wrangler d1 execute abm-crm-eval --remote --file <file sao lưu>`.

  Không tự làm các bước này khi chưa được user đồng ý.
