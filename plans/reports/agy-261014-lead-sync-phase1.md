# Báo cáo Phase 1: Đồng bộ dữ liệu Lead từ Chatbot vào CRM (Worker)

## 1. Phạm vi thực hiện

Đã hoàn thành đầy đủ các Task 1.1 – 1.7 trong `D:\TQD\CRM\plans\261014-1451-chatbot-crm-lead-sync\phase-01-worker-lead-sync.md`:

- **Task 1.1 — Migration `0021_lead_program_sync.sql` & Contracts (`packages/contracts/src/index.ts`)**:
  - Tạo `apps/crm/migrations/0021_lead_program_sync.sql`: thêm cột `product_id` và `course_id` vào bảng `lead`; dựng lại bảng `contact_point` mở rộng `CHECK (type IN ('phone', 'email', 'zalo_uid', 'fb_psid', 'zalo_oa_uid'))`, chuyển các bản ghi `zalo_uid` khớp `conversation.external_thread_id` của kênh `zalo_oa` sang `zalo_oa_uid`, và tạo lại index `contact_point_lookup`.
  - Cập nhật `packages/contracts/src/index.ts`: bổ sung `contactId?`, `productId?`, `courseId?` vào `createLeadInput`; `productId?`, `courseId?` vào `createLearnerLeadInput`; thêm `setLeadProgramInput` và đăng ký lệnh `setLeadProgram` trong `COMMANDS`.

- **Task 1.2 — Gắn chương trình/đợt học trên Lead & điều kiện chốt thắng (`learner-commands.ts`, `commands.ts`, `queries.ts`, `learner-queries.ts`)**:
  - Kiểm tra `productId` (phải đang bán `active = 1` trong cùng tổ chức) và `courseId` (nếu có phải thuộc `productId` đó) khi chạy `createLearnerLead`, `createLead`, và lệnh mới `setLeadProgram`.
  - Trong `winLearnerLead`, bắt buộc lead phải có `product_id` (nếu thiếu trả lỗi `422 VALIDATION_FAILED` kèm `"chương trình học"` trong danh sách thiếu).
  - Trả thêm `productId`, `productName`, `courseId`, `courseName` trong danh sách/chi tiết lead (`queries.ts`) và danh sách/chi tiết học viên (`learner-queries.ts`).

- **Task 1.3 — Chặn mở 2 Lead học viên cùng lúc cho một khách & ghi nhận thông tin trích thêm vào Lead đang mở (`learner-commands.ts`, `intake.ts`)**:
  - Trong `decideContact` (`learner-commands.ts`), nếu khách đã thuộc quyền giữ của sale nhưng đang có lead `pipeline = 'learner'` và `status = 'active'`, trả lỗi `409 DUPLICATE_SUSPECTED` (`"Khách đã có lead học viên đang mở"`). Thêm `tx.assert` kiểm tra số lead học viên `active` của khách bằng `1` trong `writeLearnerLead`.
  - Trong `applyExtractionResult` (`intake.ts`), nếu khách của hội thoại đã có lead mở (`status IN ('queue', 'active')`), không tạo thêm `lead_intake` `pending` mà ghi một `activity` loại `note` (`actor_kind = 'system'`) vào lead đang mở mới nhất với các trường trích được.

- **Task 1.4 — Nhận diện khách quay lại qua định danh kênh (`intake.ts`, `commands.ts`)**:
  - Trong `applyExtractionResult`: khi `conversation.contact_id` đang trống, tra cứu `contact_point` theo loại ứng với kênh (`facebook` → `fb_psid`, `zalo` → `zalo_uid`, `zalo_oa` → `zalo_oa_uid`) và `value = conversation.external_thread_id` (chỉ lấy khách chưa lưu trữ `archived_at IS NULL`); nếu khớp thì gắn `conversation.contact_id` và `lead_intake.contact_id`.
  - Trong `classifyIntake`: truyền `contactId` đã biết của hội thoại/intake vào `createLead` và `createLearnerLead` để tái sử dụng khách cũ thay vì tạo `contact` thứ hai.
  - Trong `linkStatements`: lưu đúng `type = 'zalo_oa_uid'` cho kênh `zalo_oa`, `'fb_psid'` cho `facebook`, và `'zalo_uid'` cho `zalo`.

- **Task 1.5 — Tự động giao hội thoại cho chủ Lead và báo Lark khi phân loại (`assignment.ts`, `intake.ts`, `inbox-routes.ts`)**:
  - Bổ sung `assignConversationToLeadOwner` trong `assignment.ts`: nếu hội thoại chưa giao hoặc đang giao cho người khác với `lead.owner_user_id`, tự động giao cho `lead.owner_user_id` và ghi `audit_log` `inbox.assign`.
  - Trong `classifyIntake`: nếu người phụ trách lead có `lark_open_id`, xếp đúng một lệnh `send_lark` riêng có dạng `"Bạn có lead mới <mã lead> – <tên khách> – <chương trình nếu có> – <link>"` (không gửi trùng tin giao hội thoại riêng).

- **Task 1.6 — Dừng thử lại ngay khi gặp lỗi Lark cố định 230013 (`worker-commands.ts`)**:
  - Trong `processWorkerCommands` (`worker-commands.ts`), khi gửi Lark gặp `LarkError` chứa `code 230013`, cập nhật `app_user.lark_link_status = 'error'` và gọi `failCommand(db, command.id, command.attempts, error.message, now, true)` (`final = true`) để chuyển trạng thái lệnh sang `failed` ngay ở lần thử đầu tiên.

- **Task 1.7 — Lọc đại từ xưng hô khỏi tên khách và tự động khớp chương trình học (`intake.ts`)**:
  - Cập nhật `EXTRACT_INSTRUCTION` và bổ sung trường `program` vào `INTAKE_FIELDS`.
  - Trong `parseExtraction`, loại bỏ `name` nếu chỉ là đại từ xưng hô hoặc bắt đầu bằng đại từ xưng hô kèm tối đa 1 từ (ví dụ `"Chị"`, `"Sếp Tú"`, `"anh Long"`), giữ nguyên họ tên thật (ví dụ `"Nguyễn Văn An"`).
  - Trong `applyExtractionResult`, khớp `program` với `product` đang active theo mệnh giá tiền (ví dụ `"199k"`, `"199.000"` → `price_vnd = 199000`) hoặc theo tên chương trình không phân biệt hoa thường, lưu `productId` gợi ý vào `lead_intake.fields_json`.

## 2. Danh sách file đã tạo/sửa

- `apps/crm/migrations/0021_lead_program_sync.sql` (mới)
- `packages/contracts/src/index.ts`
- `apps/crm/src/worker/learner-commands.ts`
- `apps/crm/src/worker/commands.ts`
- `apps/crm/src/worker/queries.ts`
- `apps/crm/src/worker/learner-queries.ts`
- `apps/crm/src/worker/inbox/intake.ts`
- `apps/crm/src/worker/inbox/inbox-routes.ts`
- `apps/crm/src/worker/inbox/assignment.ts`
- `apps/crm/src/worker/inbox/worker-commands.ts`
- `apps/crm/test/helpers/reset-db.ts`
- `apps/crm/test/helpers/learner-fixtures.ts`
- `apps/crm/test/inbox-zalo-oa-schema.test.ts`
- `apps/crm/test/admissions.test.ts`
- `apps/crm/test/inbox-intake.test.ts`
- `apps/crm/test/inbox-assignment.test.ts`

## 3. Kết quả kiểm tra

- `pnpm -F @abm/crm typecheck`: **PASS** (exit 0)
- `pnpm -F @abm/crm test`: **PASS** (41 test files passed, 1 skipped; 519 tests passed, 2 skipped; exit 0)
- `pnpm -F @abm/crm build`: **PASS** (exit 0)

Status: DONE
Summary: Hoàn thành toàn bộ Phase 1 (Tasks 1.1–1.7) đồng bộ dữ liệu lead từ chatbot vào CRM ở tầng Worker, bổ sung migration 0021, contracts, logic nghiệp vụ và bộ test tự động; toàn bộ test, typecheck và build đều đạt (exit 0).
