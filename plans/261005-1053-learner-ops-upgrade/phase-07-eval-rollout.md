---
phase: 7
title: "Deploy eval và kiểm thử theo vai trò"
status: in-progress
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

### Task 7.1b: Commit trước khi deploy

- Goal: có một commit để revert, và báo cáo deploy ghi được SHA của bản đang chạy. Toàn bộ phase 01–06 chưa commit. Phase 06 ghi rollback bằng cách revert commit, nhưng chưa có commit nào để revert.
- Steps:
  1. Hỏi user: có cho commit trước khi deploy không? Commit một lần cho cả phase 01–06, hay mỗi phase một commit?
  2. Controller chỉ commit khi user đã đồng ý. Chưa đồng ý thì không commit và không deploy.
  3. Ghi SHA vào báo cáo ở Task 7.7.
- Verify: user đã trả lời đồng ý, `git rev-parse HEAD` in ra SHA, và báo cáo có SHA đó. Chưa đồng ý thì STOP.

### Task 7.2: Hỏi user trước khi đụng eval

- Goal: thao tác lên D1 thật chỉ diễn ra khi user đồng ý.
- Steps:
  1. Báo user bằng tiếng Việt dễ hiểu:
     - sẽ chạy 6 migration;
     - 6 migration chạy từng file; nếu một file lỗi, các file trước đã áp;
     - hai bảng `app_user` và `lead` sẽ được dựng lại;
     - đã có bản sao lưu ở bước sau;
     - cách quay lại là Time Travel về mốc B0.
  2. Chờ user trả lời "đồng ý".
- Verify: user đã trả lời "đồng ý". Chưa có thì STOP.

### Task 7.3: Sao lưu D1 và lấy mốc Time Travel

- Steps:
  1. Chạy `pnpm exec wrangler d1 export abm-crm-eval --remote --output ..\..\exports\abm-crm-eval-before-learner-ops-<yyyyMMdd-HHmm>.sql`, thay `<yyyyMMdd-HHmm>` bằng thời điểm hiện tại theo giờ VN.
  2. Ngay sau export, chạy `pnpm exec wrangler d1 time-travel info abm-crm-eval` và ghi bookmark B0 vào báo cáo Task 7.7. Đây là mốc để quay lại bằng một lệnh.
- Verify:
  - `Select-String -Path <file> -Pattern "CREATE TABLE app_user","CREATE TABLE lead","INSERT INTO" -SimpleMatch` có kết quả cho cả 3 mẫu.
  - Có bookmark B0 đã ghi lại.

### Task 7.4: Đếm dữ liệu trước và lấy mốc khóa ngoại

- Steps:
  1. Chạy `PRAGMA foreign_key_check` **trước** migration, để Task 7.5 có mốc so sánh. Nếu eval đã có dòng vi phạm từ trước, verify sau này không đổ nhầm cho migration:
     `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "PRAGMA foreign_key_check"`.
     Ghi lại các dòng (có thể rỗng).
  2. Chạy `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "select (select count(*) from app_user) u, (select count(*) from lead) l, (select count(*) from audit_log) a, (select count(*) from task) t, (select count(*) from activity) ac, (select count(*) from user_session) s, (select count(*) from agent_token) k, (select count(*) from contact) c, (select count(*) from approval) ap, (select count(*) from d1_migrations) m"`, rồi ghi lại 10 số. Kỳ vọng `m = 5`.
- Verify: cả hai lệnh exit 0. Đã ghi 10 số và kết quả `foreign_key_check`.

### Task 7.4b: Diễn tập trên D1 nháp

- Goal: chứng minh việc dựng lại `app_user` và `lead` chạy được trên bản sao D1 thật trước khi đụng eval.
- D1 nháp chứa hash mật khẩu và email thật. Không bao giờ thêm binding của D1 nháp vào `apps/crm/wrangler.jsonc`. Nếu bất kỳ bước nào STOP, vẫn phải chạy bước 5 (xóa D1 nháp) trước khi gọi kongming.
- Steps:
  1. `pnpm exec wrangler d1 create abm-crm-rehearsal`. Wrangler 4 có thể hỏi có thêm binding vào `wrangler.jsonc` không. Trả lời **không**. Không thêm binding bằng tay.
  2. Nạp file sao lưu Task 7.3: `pnpm exec wrangler d1 execute abm-crm-rehearsal --remote --file <file sao lưu>`. Nếu nạp lỗi ở dòng `sqlite_sequence`, xóa 2 dòng `DELETE FROM sqlite_sequence` và `INSERT INTO "sqlite_sequence"` trong một **bản sao** của file, rồi nạp bản sao đó. File sao lưu gốc giữ nguyên.
  3. Áp migration bằng cách chạy từng file. Không dùng file cấu hình tạm và không dùng `migrations apply` (lệnh đó cần binding trong `wrangler.jsonc`):
     - `pnpm exec wrangler d1 execute abm-crm-rehearsal --remote --file migrations/0006_learner_foundation.sql`
     - rồi lần lượt `migrations/0007_admissions.sql`, `migrations/0008_academic.sql`, `migrations/0009_attendance.sql`, `migrations/0010_fees.sql`, `migrations/0011_privacy_requests.sql`.
  4. Chạy `PRAGMA foreign_key_check` và câu đếm 10 số của Task 7.4 trên D1 nháp.
  5. Xóa D1 nháp: `pnpm exec wrangler d1 delete abm-crm-rehearsal`. Bước này luôn chạy, kể cả khi một bước trên STOP.
- Verify:
  - Mọi lệnh exit 0, `foreign_key_check` không trả dòng nào, 10 số đếm khớp quy tắc ở Task 7.5.
  - Từ `D:\TQD\CRM`, `git diff --quiet apps/crm/wrangler.jsonc` exit 0.
  - D1 nháp đã bị xóa.

### Task 7.5: Áp migration

- Steps:
  1. Chạy `pnpm exec wrangler d1 migrations apply abm-crm-eval --remote`.
  2. Lệnh này áp từng file một. Nếu file thứ k lỗi, các file trước đó **đã áp xong**. Khi đó STOP. Sau khi user đồng ý, restore về bookmark B0 theo mục Rollback. Không nạp file sao lưu vào DB đang dở để sửa.
- Verify:
  - Lệnh exit 0 và output có `0011_privacy_requests.sql`.
  - Chạy lại câu đếm 10 số của Task 7.4. Mọi số bằng trước, trừ `a` lớn hơn hoặc bằng trước và `m = 11`.
  - `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "PRAGMA foreign_key_check"` không có dòng vi phạm nào mới so với mốc Task 7.4. Nếu mốc trước rỗng thì sau cũng rỗng.
  - `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "select id, organization_id from org_setting"` trả đúng 1 dòng `org-abm` (cả `id` và `organization_id`).
  - `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "select name from sqlite_master where type='index' and tbl_name in ('app_user','lead') order by name"` có đủ:
    - `app_user_lark_open_id`, `app_user_org`;
    - `lead_account`, `lead_contact`, `lead_department`, `lead_org_updated`, `lead_owner`, `lead_pipeline_contact`, `lead_team`;
    - cùng các `sqlite_autoindex_*` của các cột UNIQUE.

## Thứ tự các task còn lại

Chạy **7.6 → 7.7b → 7.6b → 7.7 → 7.8**.

7.7b đứng trước 7.6b. Nếu user nhập 200 học viên (7.6b) mà chọn Hằng làm sale phụ trách, 7.7b sẽ STOP vì Hằng còn `held_contacts > 0`. Báo cáo 7.7 cần kết quả của 7.7b: đã có tài khoản Thanh và có bước cấp mật khẩu tạm.

### Task 7.6: Deploy

- Steps:
  1. Từ `D:\TQD\CRM`, `git diff --quiet apps/crm/wrangler.jsonc` phải exit 0. Nếu không, STOP: binding D1 nháp không được đi theo bản deploy.
  2. Chạy `pnpm run deploy`.
- Verify:
  - Output có `Current Version ID`.
  - `Invoke-WebRequest https://abm-crm-eval.ngulongyquan.workers.dev/api/health -UseBasicParsing` trả StatusCode 200.
  - Gọi `POST /api/auth/login` với email không tồn tại, kèm header `Origin: https://abm-crm-eval.ngulongyquan.workers.dev`, trả 401.
  - `GET /api/reports/learner` không kèm cookie phải trả 401: `Invoke-WebRequest https://abm-crm-eval.ngulongyquan.workers.dev/api/reports/learner -UseBasicParsing`.
  - `POST /api/mcp` không kèm Bearer phải trả 401: `Invoke-WebRequest https://abm-crm-eval.ngulongyquan.workers.dev/api/mcp -Method POST -UseBasicParsing`.
  - Hai kiểm 401 sau xác nhận route mới vẫn đi qua middleware đăng nhập.

### Task 7.7b: Gán nhân sự vào vai trò mới

- Goal: áp quyết định số 10 của `plan.md`. Agent không đặt mật khẩu. Chạy task này trước Task 7.6b và Task 7.7.
- Steps:
  1. Kiểm Hằng còn việc Sale dở không: `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "select (select count(*) from lead l join app_user u on u.id = l.owner_user_id where u.email = 'thanhhangle0197@gmail.com' and l.stage not in ('won','lost','not_fit')) open_leads, (select count(*) from contact c join app_user u on u.id = c.owner_user_id where u.email = 'thanhhangle0197@gmail.com') held_contacts, (select count(*) from task t join app_user u on u.id = t.assignee_user_id where u.email = 'thanhhangle0197@gmail.com' and t.status = 'open') open_tasks, (select count(*) from approval a join app_user u on u.id = a.requested_by_user_id where u.email = 'thanhhangle0197@gmail.com' and a.status = 'pending') pending_approvals"`. Ghi cả `open_tasks` và `pending_approvals`.
  2. Nếu `open_leads` hoặc `held_contacts` lớn hơn 0 thì STOP và hỏi user giao lại cho ai.
  3. Sao lưu bảng `app_user`: `pnpm exec wrangler d1 export abm-crm-eval --remote --table app_user --output ..\..\exports\abm-crm-eval-app_user-before-new-roles-<yyyyMMdd-HHmm>.sql`.
  4. Dùng trang **Quản trị → Người dùng** (user đăng nhập bằng tài khoản Admin; agent không mượn mật khẩu):
     - Sửa Hằng: vai trò "Tổ chức", **xóa cả Phòng ban và Nhóm trong cùng một lần lưu**. `placementError` (`roster.ts:45-46`) từ chối nếu còn một trong hai.
     - Tạo Thanh bằng màn **Nhập danh sách nhân sự**. `updateUser` không tạo được người mới. Màn này chỉ thêm người, không khóa người vắng mặt trong file (`roster.ts:172-188`). File có dòng tiêu đề `Họ tên,Email,Phòng ban,Nhóm,Vai trò` và đúng một dòng dữ liệu: `Thanh,dangthanh420@gmail.com,,,Kế toán`.
     - Nếu email Thanh đã có và đang bị khóa: bấm "Mở khóa" (`/users/:id/status`), rồi sửa vai trò.
     Nếu agent không có phiên Admin thì viết script SQL vào `exports/` (theo mẫu `exports/add-hang-20261005.sql`, có dòng `audit_log`) và chạy bằng `wrangler d1 execute --file`. Script phải đặt `department_id = NULL`, `team_id = NULL`, `version = version + 1`, `last_txn_id`, `updated_at`, và có dòng `audit_log`.
  5. Dũng và Đặng Tú giữ `admin`. Không đổi gì.
- Verify: `select email, role, team_id, department_id, status from app_user where email in ('thanhhangle0197@gmail.com','dangthanh420@gmail.com')` trả đúng 2 dòng. Cả hai có `status = 'active'` và `department_id` null. Hằng `academic` với `team_id` null, Thanh `accountant` với `team_id` null.

### Task 7.6b: Thử nhập 200 học viên trên web eval

- Goal: biết một file CSV 200 dòng có chạy được trên eval sau khi deploy hay không. Chạy sau Task 7.7b.
- Dữ liệu thử ở lại eval. 200 học viên thử, cùng doanh nghiệp và hợp đồng đối tác thử, nằm lại trên eval. Ẩn danh chỉ ẩn, không xóa. Trước khi làm, hỏi user: có chấp nhận để lại vĩnh viễn không? Nếu không, giảm còn 20 dòng, hoặc bỏ task này.
- Steps:
  1. User tự làm trên web eval (agent không nhập hộ và không gọi wrangler cho bước này). Mở một hợp đồng đối tác đang hiệu lực. Sale phụ trách là người **không** đổi vai trò (không chọn Hằng). Tên học viên phải rõ là thử, ví dụ `Thử 001`. Số điện thoại phải là số giả, ví dụ `0900000001`.
  2. Bấm xem trước, rồi bấm xác nhận nhập. Ghi thời gian và kết quả (thành công, hoặc lỗi) vào báo cáo deploy.
  3. Nếu lỗi `D1_ERROR` hoặc vượt CPU: hạ trần xuống 100 ở đúng hai chỗ trong `apps/crm/src/worker/learner-commands.ts`. Không chia batch.
     - Chỗ tra số điện thoại là hằng `MAX_PHONE_LOOKUP` (dòng 24), hiện bằng `ROSTER_MAX_ROWS`.
     - Chỗ từ chối file quá dài là dòng 520, nơi so `records.length - 1` với `ROSTER_MAX_ROWS`.
     - Sau khi hạ trần: chạy lại Task 7.1, commit (chỉ khi user đồng ý, như Task 7.1b), rồi deploy lại theo Task 7.6.
- Verify: báo cáo có thời gian và kết quả. Nếu phải hạ trần thì `MAX_PHONE_LOOKUP` và chỗ từ chối ở dòng 520 đều bằng 100, và `pnpm -F @abm/crm test` vẫn exit 0. File thử dùng tên và số giả như trên.

### Task 7.7: Danh sách kiểm thử cho user

- Goal: user tự đăng nhập và chạy thử từng vai trò. Agent không biết và không được dùng mật khẩu của ai. Chạy sau Task 7.6b, khi Task 7.7b đã xong.
- Steps:
  1. Ghi báo cáo `plans/reports/deploy-<yyMMdd-HHmm>-learner-ops-eval.md`, gồm:
     - SHA đã commit ở Task 7.1b, phiên bản đã deploy, file sao lưu, bookmark B0, các số đếm trước và sau (10 số);
     - kết quả Task 7.7b: đã có tài khoản Thanh, và bước cấp mật khẩu tạm cho Hằng và Thanh (Admin làm trên web);
     - checklist theo vai trò. Mỗi dòng là một thao tác kèm kết quả mong đợi, lấy từ phần "Tiêu chí nghiệm thu" của `plan.md`.
- Verify: file báo cáo tồn tại và có SHA, bookmark B0, và kết quả tài khoản Thanh.

### Task 7.8: Cập nhật kế hoạch

- Steps: đổi `status` của các phase và của `plan.md` thành `completed`. Thêm một mục "Kết quả deploy" vào `plan.md`, có link tới báo cáo ở Task 7.7.
- Verify: chạy `Select-String -Path plans/261005-1053-learner-ops-upgrade/plan.md -Pattern "status: completed"`, phải ra 1 dòng.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Nếu Task 7.4b đang dang dở, xóa D1 nháp `abm-crm-rehearsal` trước khi gọi kongming. D1 nháp chứa hash mật khẩu và email thật. Không thêm binding của D1 nháp vào `apps/crm/wrangler.jsonc`.
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
  1. Báo user trước khi làm. Chỉ làm khi user đồng ý.
  2. Quay D1 về mốc đã ghi: `pnpm exec wrangler d1 time-travel restore abm-crm-eval --bookmark=<B0>`.

  Không tạo D1 mới và không xóa bảng rồi nạp lại file sao lưu. D1 mới có `database_id` khác, nên phải sửa `wrangler.jsonc` và deploy lại. Nạp file vào DB còn bảng thì `CREATE TABLE app_user` sẽ lỗi. File export ở Task 7.3 chỉ giữ làm dự phòng thứ hai.

  Không tự làm các bước này khi chưa được user đồng ý.
