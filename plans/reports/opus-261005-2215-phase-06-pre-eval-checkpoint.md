# Checkpoint sau Phase 06 và trước khi lên eval

Ngày: 2026-10-05. Người duyệt: Opus 5.5. Chỉ duyệt, không sửa code hay plan.

## Kết luận: **GO-with-fixes**

- **Code phase 06 đạt.** Từng Task 6.x đã làm đúng plan, có test.
- **Migration 0006-0011 an toàn** trên D1 eval đang có người dùng thật. Bước dựng lại bảng `app_user` và `lead` giữ được dữ liệu của mọi bảng con.
- **Không có lỗi code nào bắt buộc phải sửa trước khi deploy.** Có 1 lỗi rò số điện thoại nhỏ, nên sửa trước (C1). Sửa mất khoảng 5 phút.
- **Phase 07 cần sửa câu chữ ở 11 chỗ.** Các chỗ quan trọng nhất:
  - lấy mốc Time Travel trước khi chạy migration, để quay lại bằng một lệnh;
  - commit code trước khi deploy;
  - đổi thứ tự Task 7.7b lên trước 7.6b;
  - sửa cách tạo tài khoản Thanh (trang "Sửa người dùng" không tạo được người mới).

### Bằng chứng tôi tự chạy

- `vitest run` 4 file: `learner-reports`, `privacy`, `mcp-gateway`, `learner-foundation`. Kết quả: 4/4 file, 49/49 test đạt.
  - `learner-foundation` có test dựng lại bảng trên DB đã có dữ liệu. Test chạy `PRAGMA foreign_key_check` và đếm số dòng trước và sau.
- Số liệu toàn bộ test, typecheck và build lấy theo controller: 24 file, 327 test, exit 0.
- Tôi đã đọc file sao lưu eval cũ `exports/abm-crm-eval-before-0005-20261005-0752.sql` và script `exports/real-staff-swap-20261005.sql`.

---

## 1. Kiểm từng Task 6.x

| Task | Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|---|
| 6.1 | Bảng `privacy_request`, 3 lệnh, đúng quyền | Đạt | `0011_privacy_requests.sql`. Quyền ở `contracts/src/index.ts:690-692`. Handler ở `privacy.ts:9-71`. |
| 6.1 | Ẩn danh chỉ ẩn tên và số điện thoại | Đạt | `privacy.ts:59-60`: đổi tên thành "Đã ẩn danh". Mọi `contact_point` thành `'***'`, `normalized_value` thành `'***' \|\| id`. |
| 6.1 | Tổng tiền không đổi | Đạt | Không có lệnh nào đụng `charge`, `payment` hay `payment_allocation`. Test so số dòng và tổng tiền trước và sau (`privacy.test.ts:34,45`). |
| 6.1 | Audit không chứa tên hay số cũ | Đạt | `privacy.ts:69` ghi `{anonymized: true}`. Test ở `privacy.test.ts:46-49`. |
| 6.1 | Giữ ghi chú tự do | Đạt | Đúng mặc định của controller. Câu hỏi có xóa hay không vẫn mở. |
| 6.1 | Ô tìm khách thu tiền bỏ hồ sơ đã ẩn danh | Đạt | `fees.ts:485` có `c.archived_at IS NULL`. `createCharge` cũng chặn (`fees.ts:160`). |
| 6.1 | Kiểm yêu cầu ngay trong batch | Đạt | `privacy.ts:65`: assert yêu cầu xóa còn mở. Version guard trên `privacy_request` và `contact`. |
| 6.2 | Mọi số liệu tính bằng SQL tổng hợp | Đạt | `learner-reports.ts`: mỗi khối là một câu SQL có `GROUP BY` hoặc `SUM`. Không lặp trong JS. |
| 6.2 | Giáo viên, sale, leader không thấy tiền | Đạt | `learner-reports.ts:225-239`. Test ở `learner-reports.test.ts:54-73`. |
| 6.2 | Tổ chức không thấy tên doanh nghiệp | Đạt | Khối của academic (`:230-234`) không có `byContract`. `bySource` chỉ trả `source` và số đếm. |
| 6.2 | `unmarkedToday` dùng quy tắc danh sách lớp | Đạt | Dùng chung `regularRosterOn`, `trialRosterOn`, `makeupRosterOn`, `unmarkedSql` export từ `attendance.ts:69-94`. Màn điểm danh `sessionRoster` cũng dùng các hàm này (`:116,129,143`), nên không có hai bản logic. |
| 6.2 | Giờ dạy khi lớp có nhiều giáo viên | Đạt | `hoursSql` join `class_teacher` (`:148`), nên mỗi giáo viên được gán nhận đủ giờ của buổi. Có ghi chú "không phải lương" (`:10`). |
| 6.2 | Tuổi nợ dùng lại `chargeBalanceSql` | Đạt | `:117`. Chỉ lấy khoản `open`, theo 4 nhóm tuổi. Có test nhóm 31-60. |
| 6.2 | Tiền theo ngày VN | Đạt | `vnDate` cộng 7 giờ (`:33`). Cửa sổ 30 ngày tính từ nửa đêm giờ VN (`:137`). `received_at` đã chuẩn hóa sang ISO UTC (`fees.ts:211`). |
| 6.2 | Lead thắng của sale đã nghỉ vẫn mang owner cũ | Đạt | `learner-commands.ts:364` chỉ đổi owner của lead `active`. Có comment ở `learner-reports.ts:189`. |
| 6.3 | academic, teacher, accountant chỉ có `whoami` | Đạt | `mcp-tools.ts:20-21` và `toolsFor`. `callTool` kiểm lại vai trò (`:243-245`). Test với accountant. |
| 6.3 | Che số điện thoại qua bot | Đạt, còn 1 kẽ hở (C1) | `get_lead` gọi `leadDetail`, che toàn bộ `contactPoints` (`queries.ts:391-395`). `search_leads` dùng `b2bLeadScope`, nên không bao giờ trả lead học viên. Phần che ở `mcp-tools.ts:206-214` là code phòng hờ. |
| 6.3 | `head` xem số qua `/leads/:id` và `get_lead` | Đạt khi khách đang được giữ | Test ở `mcp-gateway.test.ts`. Khách ở hồ chung thì vẫn lộ (C1). |
| 6.3 | `agentNeedsApproval` của lệnh học viên chưa có cơ chế | Chấp nhận | Agent chỉ vào qua `/mcp` (`loadAgentActor` chỉ có ở `mcp-routes.ts:24`). Bot không có tool nào gọi lệnh học viên. Có test. |
| 6.4 | Web: nav, xác nhận trước khi ẩn danh, nút ghi yêu cầu | Đạt | `layout.tsx:52,58`. Hộp xác nhận ở `privacy-requests.tsx:112-123`. Nút ở `learner-detail.tsx:63`. |
| 6.5 | Hướng dẫn ≤ 200 dòng, tiếng Việt dễ hiểu, dùng nhãn "Tổ chức (quản lý học viên)" | Đạt | 43 dòng. Mục `## Tổ chức (quản lý học viên)`. |
| 6.5 | Mẫu nhân sự có vai trò mới | Đạt | CSV có 3 dòng mới. `roster.ts:29-30` nhận alias "Tổ chức" và "Tổ chức (quản lý học viên)". |
| 6.5 | Ma trận quyền: Admin học phí R/W | Đạt | `permission-matrix-v1.md:54`. **Nhưng** dòng Điểm danh ở `:53` sai với code (D1). |
| 6.5 | `README` có link ADR-007 | Đạt | |
| 6.6 | Test | Đạt, còn mỏng | Thiếu test giờ dạy khi lớp có 2 giáo viên, thiếu test `cashByDay`. Test giáo viên dùng user chưa có lớp, nên kiểm "không có tiền" chỉ đạt vì dữ liệu rỗng. Không chặn deploy. |

## 2. Danh sách sửa

### Code now

**C1 (Medium, nên sửa trước deploy). `head` thấy số điện thoại khách học viên ở hồ chung.**

- Chỗ sửa: `apps/crm/src/worker/learner-queries.ts:38`.
- Lỗi:
  - `mayInspect` trả `true` khi khách không được giữ (`!held`, dòng 16).
  - Khi owner nghỉ, hết hạn giữ, hoặc lead đã đóng, khách về hồ chung. Lúc đó `GET /leads/:id` và tool `get_lead` trả số điện thoại cho `head`.
  - Trong khi đó `head` bị chặn 403 ở `/learners`.
  - Test hiện tại chỉ dùng khách đang được giữ, nên không bắt được lỗi này.
- Cách sửa: chỉ người đọc được màn học viên mới thấy số.
  ```ts
  visible.set(row.lead_id, row.pipeline === 'learner'
    ? canReadLearners(actor) && maskPhoneForActor(actor, row, heldNow(row, now), 'kept') !== null
    : true);
  ```
- Thêm test: đặt `hold_expires_at` về quá khứ, gọi `get_lead` bằng `u-head`, mọi `contactPoints` phải là `null`.

**C2 (Low, có thể để sau). `absenceStreaks` còn liệt kê học viên đã nghỉ hoặc học xong.**

- Chỗ sửa: `apps/crm/src/worker/learner-reports.ts:96`.
- Cách sửa: thêm `AND e.status IN ('confirmed','studying')`.

### Docs

**D1 (Low). Dòng Điểm danh trong ma trận quyền sai với code.**

- Chỗ sửa: `docs/security/permission-matrix-v1.md:53`.
- Code ở `attendance.ts:41`: `admin` và `academic` điểm danh được **mọi lớp**. Hướng dẫn cũng ghi như vậy (`learner-ops-user-guide.md:20`).
- Ma trận lại ghi Tổ chức `R`, Admin "điểm danh khi được gán làm giáo viên".
- Cách sửa: Tổ chức `R/W mọi lớp`, Admin `R/W mọi lớp`.

### Plan text (phase 07)

**P1. `phase-07:43-44` (Task 7.3). Lấy mốc Time Travel.**

- Sau khi export, chạy `pnpm exec wrangler d1 time-travel info abm-crm-eval` và ghi lại bookmark B0 vào báo cáo.
- Kế hoạch bot gateway đã dùng cách này trên eval (`plans/261004-1457-crm-bot-gateway/phase-05-rollout-live-test.md:191`).
- Verify thêm: có bookmark.

**P2. `phase-07:128-136` (Rollback dữ liệu). Bỏ cách nạp lại file sao lưu.**

- Bỏ bước 2-3 "Tạo D1 mới, hoặc xóa toàn bộ bảng, rồi nạp lại".
- Thay bằng: `pnpm exec wrangler d1 time-travel restore abm-crm-eval --bookmark=<B0>`. Vẫn phải được user đồng ý trước.
- Lý do bỏ cách cũ:
  - Một D1 mới có `database_id` khác, nên phải sửa `wrangler.jsonc` và deploy lại.
  - Nạp file vào DB còn bảng thì `CREATE TABLE app_user` sẽ lỗi.
- File export chỉ giữ làm dự phòng thứ hai.

**P3. `phase-07:48` (Task 7.4). Đếm thêm và kiểm khóa ngoại trước.**

- Thêm vào câu đếm: `(select count(*) from agent_token) k, (select count(*) from contact) c, (select count(*) from approval) ap, (select count(*) from d1_migrations) m`. Kỳ vọng `m = 5`.
- Chạy `PRAGMA foreign_key_check` **trước** migration để có mốc so sánh. Nếu eval đã có dòng vi phạm từ trước, verify ở 7.5 sẽ báo sai nguyên nhân.
- Sửa "6 số" thành "10 số". Quy tắc ở 7.5: mọi số bằng trước, trừ `a ≥ trước` và `m = 11`.

**P4. `phase-07:55-60` (Task 7.4b). Bốn chỗ cần sửa.**

- **Bước 1.** `d1 create` của wrangler 4 có thể hỏi có thêm binding vào `wrangler.jsonc` không. Trả lời **không**. Trước Task 7.6, `git diff --quiet apps/crm/wrangler.jsonc` phải exit 0.
- **Bước 3.** Chọn hẳn cách chạy từng file: `d1 execute abm-crm-rehearsal --remote --file migrations/0006_learner_foundation.sql`, và lần lượt đến `0011`. Không dùng file cấu hình tạm.
- **Bước 2.** Nếu nạp file lỗi ở dòng `sqlite_sequence`, thì xóa 2 dòng `DELETE FROM sqlite_sequence` / `INSERT INTO "sqlite_sequence"` trong một **bản sao** của file rồi nạp lại. File sao lưu gốc giữ nguyên.
- **Xóa D1 nháp.** D1 nháp chứa hash mật khẩu và email thật. Nếu bất kỳ bước nào STOP, vẫn phải chạy bước 5 (xóa D1 nháp) trước khi gọi kongming.

**P5. `phase-07:64-68` (Task 7.5). Ba chỗ cần sửa.**

- **Ghi rõ rủi ro áp dở dang.** `migrations apply` áp từng file một. Nếu file thứ k lỗi, các file trước đó **đã áp xong**. Khi đó STOP và restore về B0 sau khi user đồng ý.
- **Thêm kiểm `org_setting`.** `select id, organization_id from org_setting` phải trả đúng 1 dòng `org-abm`.
- **Thêm kiểm index.** `select name from sqlite_master where type='index' and tbl_name in ('app_user','lead') order by name` phải có:
  - `app_user_lark_open_id`, `app_user_org`;
  - `lead_account`, `lead_contact`, `lead_department`, `lead_org_updated`, `lead_owner`, `lead_pipeline_contact`, `lead_team`;
  - cùng các `sqlite_autoindex_*` của các cột UNIQUE.

**P6. Thêm Task 7.1b sau `phase-07:28`. Commit trước khi deploy.**

- Toàn bộ phase 01-06 chưa commit.
- Phase 06 ghi "Rollback: revert commit", nhưng chưa có commit nào để revert.
- Báo cáo deploy cũng cần SHA để biết bản nào đang chạy.
- Cần user đồng ý commit. Xem câu hỏi Q2.

**P7. `phase-07:72-76` (Task 7.6). Thêm 2 kiểm 401.**

- `GET /api/reports/learner` không kèm cookie phải trả 401.
- `POST /mcp` không kèm Bearer phải trả 401.
- Hai kiểm này xác nhận route mới vẫn đi qua middleware đăng nhập.

**P8. Thứ tự task. Chạy 7.7b trước 7.6b và 7.7.**

- Nếu user nhập 200 học viên (7.6b) mà chọn Hằng làm sale phụ trách, 7.7b sẽ STOP vì Hằng còn `held_contacts > 0`.
- Báo cáo 7.7 cần kết quả của 7.7b: có tài khoản Thanh và có bước cấp mật khẩu tạm.
- Thứ tự mới: 7.6 → 7.7b → 7.6b → 7.7 → 7.8.

**P9. `phase-07:101,104-109` (Task 7.7b).**

- **Bước 1.** Thêm 2 số đếm:
  - việc đang mở: `(select count(*) from task t join app_user u on u.id = t.assignee_user_id where u.email = 'thanhhangle0197@gmail.com' and t.status = 'open') open_tasks`;
  - đề xuất đang chờ: `(select count(*) from approval a join app_user u on u.id = a.requested_by_user_id where u.email = 'thanhhangle0197@gmail.com' and a.status = 'pending') pending_approvals`.
- **Bước 4, Hằng.** Trên trang Người dùng, sửa Hằng: vai trò "Tổ chức", **xóa cả Phòng ban và Nhóm trong cùng một lần lưu**. `placementError` (`roster.ts:45-46`) từ chối nếu còn một trong hai.
- **Bước 4, Thanh.** `updateUser` **không tạo được người mới**. Chỉ màn "Nhập danh sách nhân sự" tạo được, và màn này chỉ thêm người, không khóa người vắng mặt trong file (`roster.ts:172-188`).
  - Dùng một file CSV 1 dòng: `Thanh,dangthanh420@gmail.com,,,Kế toán`.
  - Nếu email đã có và đang bị khóa: bấm "Mở khóa" (`/users/:id/status`), rồi sửa vai trò.
- **Đường SQL dự phòng.** Phải đặt `department_id = NULL`, `team_id = NULL`, `version = version + 1`, `last_txn_id`, `updated_at`, và có dòng `audit_log`.
- **Verify.** Câu kiểm thêm cột `department_id` và `status`. Cả hai dòng phải có `status = 'active'` và `department_id` null.

**P10. `phase-07:84-85` (Task 7.6b).**

- **Tên chỗ sửa cho đúng code.** Chỗ tra số điện thoại là hằng `MAX_PHONE_LOOKUP` ở `learner-commands.ts:24`. Chỗ từ chối file quá dài ở `:520`.
- **Sau khi hạ trần.** Chạy lại 7.1, commit, rồi deploy lại theo 7.6.
- **Dữ liệu thử ở lại eval.**
  - 200 học viên thử, cùng doanh nghiệp và hợp đồng đối tác thử, sẽ nằm lại vĩnh viễn trên eval. Ẩn danh chỉ ẩn, không xóa.
  - Bắt buộc dùng tên rõ là thử, ví dụ "Thử 001", và số điện thoại giả, ví dụ `0900000001`.
  - Sale phụ trách là người không đổi vai trò.
  - Xem câu hỏi Q1.

**P11. `phase-07:33-38` (Task 7.2). Thêm vào lời báo user:**

- 6 migration chạy từng file. Nếu một file lỗi, các file trước đã áp.
- Cách quay lại là Time Travel về mốc B0.

## 3. Migration 0006-0011 trên D1 eval thật

**Kết luận: an toàn.**

### Bảng con của `app_user` lúc 0006 chạy

Đọc từ 0001-0005:

| Bảng con | Cột trỏ tới `app_user` | Dữ liệu trên eval |
|---|---|---|
| `lead` | `owner_user_id`, `created_by_user_id` | rỗng |
| `task` | `assignee_user_id`, `created_by_user_id` | rỗng (script swap đã xóa) |
| `activity` | `actor_user_id` | rỗng |
| `approval` | `requested_by_user_id`, `decided_by_user_id` | rỗng |
| `user_session` | `user_id` | **có** |
| `agent_token` | `user_id` | **có** |

Các cột sau **không có khóa ngoại**, nên không bị ảnh hưởng: `audit_log.actor_user_id`, `idempotency_key.actor_user_id`, `agent_kill_switch.updated_by_user_id`.

### Vì sao dựng lại bảng mà không mất dữ liệu

`PRAGMA defer_foreign_keys = ON` hoãn việc kiểm khóa ngoại đến cuối migration. Trong lúc chạy:

1. `DROP TABLE app_user` ngầm xóa mọi dòng. Mỗi dòng con mất cha được ghi thành một vi phạm "treo", chưa báo lỗi ngay.
2. `INSERT` lại các dòng `app_user` với cùng `id` xóa đúng chừng ấy vi phạm.
3. Lúc commit, số vi phạm bằng 0.

Cách "tạo `_new` rồi đổi tên" của 0004 không làm được bước 2, nên migration này chép ra bảng backup rồi chép vào. Test `learner-foundation.test.ts:27-62` chứng minh điều này trên dữ liệu `lead`, `task` và `activity`.

Phần `user_session` và `agent_token` chạy cùng cơ chế. Bước diễn tập 7.4b trên bản sao eval sẽ xác nhận với dữ liệu thật.

### Các điểm khác

- **Cột.** `app_user` mới có đủ 22 cột: 12 cột của 0001 và 10 cột của 0003. Lệnh `INSERT … SELECT` liệt kê cột theo tên, không dùng `*`.
- **Index.** `app_user_lark_open_id` và `app_user_org` được tạo lại. Sáu index của `lead` từ 0001 và 0005 cũng được tạo lại. 0007 thêm `lead_pipeline_contact`. Các cột UNIQUE (`email`, `code`) khai trong định nghĩa bảng, nên tự có index.
- **`approval`.** Bảng này có khóa ngoại tới `lead`, đã được dựng lại ở 0004 với tên trong ngoặc kép `"approval"`. `DROP TABLE lead` khi `lead` rỗng không ghi vi phạm nào.
- **`org_setting`.** `0010_fees.sql:17-18` chèn từ bảng `organization`, nên eval nhận đúng 1 dòng `org-abm`. `fee_counter` để trống, và mã code tự tạo dòng khi ghi khoản đầu tiên.
- **0007-0011** chỉ tạo bảng và index mới. Lỗi F7 cũ đã sửa: `charge` có `UNIQUE (organization_id, code)`.
- **Code cũ chạy trên schema mới,** trong vài phút giữa 7.5 và 7.6: vẫn chạy. Lead mới nhận mặc định `pipeline = 'b2b'`, và CHECK chỉ được nới rộng.

## 4. Câu hỏi cho user

- **Q1.** Có chấp nhận để lại 200 học viên thử, cùng một doanh nghiệp và hợp đồng đối tác thử, vĩnh viễn trên eval không? Nếu không, giảm còn 20 dòng, hoặc bỏ Task 7.6b.
- **Q2.** Cho phép commit trước khi deploy không? Commit một lần cho cả phase 01-06, hay mỗi phase một commit?
- **Q3.** Eval có tài khoản `head` (Trưởng phòng) nào đang hoạt động không? Nếu không, C1 không gây rò thật trên eval, nhưng vẫn nên sửa.
- **Q4** (vẫn mở từ trước). Khi ẩn danh, có xóa luôn chữ tự do không? Gồm `payment.memo`, `lead.need_summary` và `privacy_request.detail`.
- **Q5.** API cho Tổ chức và Kế toán ghi yêu cầu dữ liệu cá nhân, nhưng hai vai này không mở được hồ sơ học viên, nên không có nút để bấm. Có cần nút đó cho họ không?

## 5. Rủi ro lớn nhất khi lên eval

**Migration áp dở dang trên D1 có dữ liệu nhân sự thật.**

- Wrangler áp 6 file lần lượt. Nếu một file giữa chừng lỗi, `app_user` và `lead` đã được dựng lại, còn các bảng sau thì chưa có.
- Code mới không chạy được. Đường quay lại trong plan hiện tại là nạp lại file sao lưu bằng tay, dễ sai.
- Cách giảm rủi ro:
  - diễn tập trên D1 nháp (7.4b);
  - lấy bookmark Time Travel trước khi chạy (P1);
  - dùng lệnh `time-travel restore` làm đường quay lại chính (P2).
- Rủi ro kèm theo: D1 nháp chứa hash mật khẩu thật bị để quên, hoặc `d1 create` tự ghi binding vào `wrangler.jsonc` rồi bị deploy theo (P4).

Status: DONE
Summary: Phase 06 meets every Task 6.x. Migrations 0006-0011 are safe on eval. GO-with-fixes: one small privacy fix in code (C1) and 11 plan-text fixes for phase 07.
