# Kiểm tra sau phase 01, quyết định đi tiếp phase 02

Ngày: 2026-10-05. Người xem: kongming (chạy trên Claude Fable 5.1). Chỉ tư vấn, không sửa mã.

Đầu vào đã xem: `git diff` toàn bộ thay đổi chưa commit, `apps/crm/migrations/0006_learner_foundation.sql`, `apps/crm/src/worker/guarded-tx.ts`, `scope.ts`, `commands.ts`, `queries.ts`, `roster.ts`, `admin-routes.ts`, `apps/crm/test/learner-foundation.test.ts`, `apps/crm/test/helpers/reset-db.ts`, ADR-007, ma trận quyền, phase 01, phase 02, phase 07, và tài liệu D1 của Cloudflare về `PRAGMA defer_foreign_keys` và `migrations apply`.

## Kết luận: GO-with-fixes

Phase 01 đạt Goal và đủ tiêu chí nghiệm thu. Không có lỗi nào chặn phase 02. Có 7 chỗ cần sửa **văn bản kế hoạch** (phase 02 và phase 07) trước khi chạy phase 02, cộng 1 rủi ro nghiệp vụ cần theo dõi. Không cần sửa mã phase 01.

## 1. Migration 0006 có an toàn trên D1 eval không

Có, với điều kiện cả file chạy trong một transaction. Chi tiết đã kiểm:

- **Trình tự backup → drop → create → insert → drop backup** đúng. Với `PRAGMA defer_foreign_keys = ON`, lệnh `DROP TABLE app_user` làm `DELETE` ngầm và chỉ đếm vi phạm khóa ngoại; các dòng chèn lại từ `app_user_backup` đưa số vi phạm về 0 trước khi commit. Test "rows and foreign keys survive migrating a populated database" (`learner-foundation.test.ts:28-57`) chứng minh điều này trên dữ liệu có `task`, `activity`, `approval` trỏ tới `lead` và `app_user`, và `PRAGMA foreign_key_check` trả rỗng.
- **Danh sách cột**: `app_user` 22 cột = 12 cột của `0001_init.sql:35-48` + 10 cột của `0003_user_auth.sql:2-12`, cả `INSERT` lẫn `SELECT` liệt kê đúng 22 cột (`0006:35-41`). `lead` 28 cột = 27 cột của `0001:97-124` + `won_note` của `0002`; `INSERT`/`SELECT` liệt kê đúng 28 cột, hai cột mới `pipeline`, `partner_contract_id` ở cuối và nhận giá trị mặc định (`0006:89-95`).
- **CHECK**: giữ nguyên 3 CHECK cũ của `lead`, thêm 2 CHECK mới theo kế hoạch. CHECK `role` và các CHECK của 0003 giữ nguyên.
- **Index tạo lại đủ**: `app_user` có 2 index trong toàn bộ migration cũ (`app_user_lark_open_id` ở 0003:13, `app_user_org` ở 0005:8), `lead` có 6 (`lead_owner`, `lead_team`, `lead_department` ở 0001:130-132; `lead_org_updated`, `lead_contact`, `lead_account` ở 0005:4-6). 0006 tạo lại đúng 8 index này. Không có trigger hay view nào trong 0001-0005 (đã grep `trigger`), nên không có gì bị mất.
- **Bảng con bị ảnh hưởng** (đều có dữ liệu thật trên eval): `task`, `activity`, `approval` trỏ `lead`; `lead`, `task`, `activity`, `approval`, `user_session`, `agent_token` trỏ `app_user`. Tất cả tham chiếu theo tên bảng nên sau khi tạo lại, khóa ngoại tự khớp. Phiên đăng nhập (`user_session`) giữ nguyên, user không bị đăng xuất.
- **Về D1 từ xa**: tài liệu Cloudflare nói "D1 runs every query inside an implicit transaction", `defer_foreign_keys` "allows you to violate foreign key constraints temporarily until the end of the current transaction", và với `migrations apply`: "If applying a migration results in an error, this migration will be rolled back" và "After applying, a backup will be captured". Migration 0004 đã dùng đúng mẫu PRAGMA này trên eval và chạy được. Điểm chưa có bằng chứng trực tiếp từ xa: 0004 xóa bảng `approval` không có bảng con, nên chưa chứng minh được tình huống "xóa bảng cha có dữ liệu con rồi chèn lại" trên D1 remote. Rủi ro còn lại thấp, nhưng vì eval có dữ liệu thật, phase 07 nên thêm hai bước (xem mục 5, sửa F6 và F7).

Lỗi nhỏ không chặn: `lead_backup`/`app_user_backup` tạo bằng `CREATE TABLE AS` nên mất NOT NULL và DEFAULT, nhưng chỉ là bảng tạm trong cùng transaction, không sao.

## 2. GuardedTable và quy tắc dòng neo

Đúng.

- `GuardedTable` thêm `contact | product | customer_product` (`guarded-tx.ts:3`). Ba bảng đều có `version`, `last_txn_id`, `updated_at` trong 0006, là điều kiện để `update`/`insertVersioned`/`guard` chạy được.
- `tx.update('contact', id, version, {})` với `set` rỗng sinh ra `UPDATE contact SET version = version + 1, last_txn_id = ?, updated_at = ? WHERE id = ? AND version = ?` (`guarded-tx.ts:33`, có xử lý dấu phẩy khi `cols.length` = 0). Hợp lệ.
- `recordConsent` (`commands.ts:252-267`) gọi `tx.update('contact', …)` trước `tx.raw(INSERT INTO consent …)`, nên `anchor` đã có khi `runCommand` gọi `tx.idempotency` (`commands.ts:115`). `tx.audit('consent', …)` cũng đi qua `insertDependent` và chỉ commit cùng dòng neo. Đúng mẫu ADR-003.
- `upsertProduct` (`commands.ts:235-250`) có pre-check `STALE_VERSION` và guard trong batch. Test có ca 409. Đúng.
- Hệ quả cần biết cho phase 02: mỗi lần ghi đồng ý, `contact.version` tăng 1. Lệnh `claimCustomer`/`changeCustomerOwner` của phase 02 dùng `contact.version` nên có thể nhận `STALE_VERSION` nếu vừa có người ghi đồng ý. Đây là hành vi đúng của optimistic lock, màn hình chỉ cần tải lại.

## 3. Vai trò B2B còn chạy đúng không

Còn. `leadScope` cho `sale`, `leader`, `head`, `director`, `admin` không đổi, chỉ thêm nhánh `default` (`scope.ts:27-30`). `B2B_ROLES` trong `layout.tsx:19` gồm đủ 5 vai trò, nên mục điều hướng B2B vẫn hiện cho họ. `placementError` (`roster.ts:38-48`) và `PATCH /admin/users/:id` (`admin-routes.ts:171-179`) xử lý vai trò mới qua nhánh "không phòng ban, không nhóm" giống BGĐ/Admin. `canReadAudit` siết thêm 3 vai trò mới, không đụng 5 vai trò cũ. 235 test cũ và mới đều xanh. MCP không tự liệt kê `COMMANDS` (`mcp-tools.ts:20-61` là danh sách cứng), nên `upsertProduct` và `recordConsent` không lộ ra bot. Đúng với non-goal của plan.

Điểm nhỏ, không chặn: `listProducts` cho `head` và `director` thấy cả sản phẩm đã tắt (`queries.ts:322` chỉ lọc `active` cho `sale`/`leader`). Ma trận quyền không định nghĩa hai vai trò này cho danh mục; chấp nhận được.

## 4. Thiếu gì so với Goal và tiêu chí phase 01

Không thiếu. Đối chiếu từng task:

| Task | Trạng thái |
|---|---|
| 1.1 reset-db | Xong, 14 file (báo cáo đã ghi lý do), `const TABLES` không còn trong test |
| 1.2 migration + test giữ dữ liệu | Xong, test tự dựng DB, kiểm số dòng, `foreign_key_check`, `pipeline` |
| 1.3 contracts | Xong, đủ `ROLES` x8, `PIPELINES`, `LEARNER_STAGES`, `stageLabel(code, pipeline)`, `LEARNER_LOST_REASONS`, `LEARNER_JOURNEY` + `VERSION`, `CONSENT_PURPOSES`, 2 schema, 2 lệnh, `updateUserInput.role` từ `ROLES` |
| 1.4 scope + roster | Xong |
| 1.5 lệnh và route | Xong, có `canReadProducts` |
| 1.6 web | Xong |
| 1.7 test | Xong, 12 test, phủ đủ 8 ca kế hoạch |
| 1.8 ADR + ma trận | Xong, ADR có 2 link yêu cầu |

Bốn sai lệch của executor đều hợp lý và không mở rộng phạm vi. Riêng "khách cũ chưa có owner" là đúng thiết kế: khách B2B không đi luồng học viên, danh sách học viên ở phase 02 chỉ lấy khách có lead `learner`.

## 5. Chỗ phase 02 và phase 07 đã cũ hoặc cần sửa

Các dòng dưới đây là sửa văn bản kế hoạch. Không dòng nào cần sửa mã phase 01.

**F1. Phase 02, Task 2.4 bước 1** (`phase-02:121`). Câu "tạo `contact` theo mẫu `createLead` (`commands.ts` khoảng dòng 290-300)" cần đổi thành: "tạo `contact` bằng `tx.insertVersioned('contact', { id, organization_id, display_name, owner_user_id, hold_started_at, hold_expires_at })`, rồi chèn `contact_point` theo mẫu `createLead` (`commands.ts:333-341`)". Lý do: `createLead` hiện chèn `contact` bằng `tx.raw` (`commands.ts:333`), không qua guard; `contact` nay đã là bảng có version trong `GuardedTable`, và dòng `contact` mới là dòng neo tự nhiên của lệnh.

**F2. Phase 02, Task 2.4 bước 10** (`phase-02:161`). "`parseRosterCsv` dòng 76-100" đổi thành "`parseRosterCsv` từ `roster.ts:79`". `foldText` import từ `@abm/contracts` (`roster.ts:1`), không phải hàm của `roster.ts`.

**F3. Phase 02, Task 2.6 bước 4** (`phase-02:197`). "`search` (`queries.ts` dòng 454)" đổi thành "`queries.ts:465`". `searchMatcher` vẫn ở dòng 149, giữ nguyên.

**F4. Phase 02, Task 2.6 bước 1, câu `view=pool`** (`phase-02:188`). SQL `c.hold_expires_at <= ? AND NOT EXISTS (…)` bỏ sót khách có `owner_user_id IS NULL` (so sánh với NULL cho NULL, khách bị loại khỏi hồ chung mãi mãi). Sửa thành `(c.owner_user_id IS NULL OR c.hold_expires_at <= ?) AND NOT EXISTS (…)`. Cùng logic với `isHeld` ở Task 2.2: không owner thì không giữ.

**F5. Phase 02, Task 2.6 và 2.7: vai trò `director`.** `customerScope` (`scope.ts:40-50`, theo đúng phase 01) cho `director` thấy toàn tổ chức, nhưng phase 02 chỉ ghi "Admin thấy mọi khách" và nav `['sale','leader','admin']`. Đề xuất: thêm `director` vào quyền **đọc** `GET /learners`, `GET /learners/:id`, `GET /partners*` và vào `roles` của 2 mục nav, không thêm vào lệnh ghi nào. Lý do: nhất quán với B2B, BGĐ đọc toàn công ty. Nếu user muốn BGĐ không thấy học viên thì sửa ngược lại: bỏ `director` khỏi `customerScope`. Đây là quyết định cần user xác nhận; mặc định đề xuất là cho đọc.

**F6. Phase 07, Task 7.5 Verify** (`phase-07:53-57`). Thêm: chạy `pnpm exec wrangler d1 execute abm-crm-eval --remote --json --command "PRAGMA foreign_key_check"` và kết quả phải rỗng; thêm `(select count(*) from task) t, (select count(*) from activity) ac, (select count(*) from user_session) s` vào câu đếm của Task 7.4 và so bằng trước/sau.

**F7. Phase 07, thêm bước diễn tập trước Task 7.5** (tùy chọn nhưng nên làm vì eval có dữ liệu thật): tạo một D1 tạm (`wrangler d1 create abm-crm-rehearsal`), nạp file export của Task 7.3 vào đó bằng `wrangler d1 execute abm-crm-rehearsal --remote --file <export>`, rồi `wrangler d1 migrations apply abm-crm-rehearsal --remote` với cùng thư mục migrations, kiểm `foreign_key_check` rỗng và số dòng bằng nhau, rồi xóa D1 tạm. Đây là bằng chứng trực tiếp trên D1 remote cho tình huống xóa bảng cha có dữ liệu con, thứ mà 0004 chưa chứng minh. Nếu không làm bước này thì vẫn còn Time Travel của D1 và file export để khôi phục.

Gợi ý không bắt buộc cho phase 02, Task 2.3: các lệnh nhắm vào `lead` (`markJourneyStep`, `skipTrial`, `winLearnerLead`, `closeLearnerLead`) nên đặt tên trường là `expectedVersion` thay vì `version`, cho giống `changeStage`, `lead-actions.tsx:111` và `mcp-tools.ts:150`. Lệnh nhắm vào `contact`, `product`, `customer_product` có thể giữ `version` như `upsertProductInput`. Nếu người viết phase 02 muốn một tên duy nhất thì chọn `expectedVersion` cho tất cả lệnh mới.

## Rủi ro kế tiếp cần theo dõi

**Khách bị kẹt khi owner không còn là tuyển sinh.** Plan quyết định 10: Hằng rời Sale sang `academic`. `customerScope` của Leader lọc theo `app_user.team_id` của owner (`scope.ts:45`), nên khách Hằng đang giữ biến mất khỏi màn Leader KD1; `isHeld` của phase 02 (`phase-02:69`) vẫn tính Hằng đang giữ cho tới khi hết 3 tháng, nên khách không về hồ chung và Sale khác tạo trùng số sẽ nhận `FORBIDDEN`. Hai cách xử lý, chọn một khi viết phase 02:

- Thêm điều kiện vào `isHeld` và SQL hồ chung: owner phải là user `active` có role `sale`/`leader`. Khách của người đã đổi vai hoặc bị khóa tự về hồ chung. Gọn, không cần thao tác tay.
- Hoặc giữ `isHeld` như plan và ghi vào phase 07 bước Admin chạy `changeCustomerOwner` cho mọi khách của Hằng trước khi đổi vai trò. Dễ quên.

Tôi khuyên cách thứ nhất và ghi vào Task 2.2 của phase 02. Trên eval hiện tại chưa có khách học viên nên chưa gây lỗi ngay, nhưng sẽ gây lỗi khi có người nghỉ việc hoặc đổi vai.

## Giả định

- Executor đã chạy `pnpm -F @abm/crm test` và `typecheck` trên đúng cây làm việc này; tôi tin theo báo cáo của người gọi (đã tự chạy lại), không chạy lại nữa. Độ tin: cao.
- `wrangler d1 migrations apply --remote` gửi cả file 0006 (khoảng 30 câu lệnh) trong một transaction. Dựa trên tài liệu D1 (implicit transaction, rollback khi lỗi) và việc 0004 đã chạy mẫu PRAGMA này trên eval. Độ tin: trung bình-cao. F7 là cách biến giả định này thành bằng chứng.
- BGĐ được đọc dữ liệu học viên (F5). Độ tin: trung bình; user quyết.
