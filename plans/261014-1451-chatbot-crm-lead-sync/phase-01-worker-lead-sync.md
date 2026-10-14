# Phase 1: Worker, đồng bộ lead từ chatbot

Đọc trước:
- [plan.md](plan.md), phần "Quyết định của chủ dự án" và "Mô hình dữ liệu";
- `plans/reports/debugger-261014-1434-chatbot-crm-data-audit.md`, các mục V1–V8 (có dòng code cụ thể).

## Task 1.1: Migration `0021_lead_program_sync.sql`
- Thêm vào `lead` hai cột không bắt buộc: `product_id TEXT REFERENCES product(id)` và `course_id TEXT REFERENCES course(id)`.
- Thêm loại `zalo_oa_uid` vào CHECK của `contact_point.type`. Phải dựng lại bảng giống cách migration 0013 đã làm: giữ dữ liệu và index, `foreign_key_check` phải rỗng.
  - Chuyển các điểm liên lạc `zalo_uid` của khách có hội thoại `zalo_oa` sang `zalo_oa_uid`: dòng nào có `value` trùng `external_thread_id` của một hội thoại thuộc channel_account `channel = 'zalo_oa'` thì đổi loại.
- Cập nhật contracts trong `packages/contracts/src/index.ts`: kiểu lead và input tạo/sửa lead có `productId?`, `courseId?`.
- **Đạt khi:** test schema mới (theo mẫu `apps/crm/test/inbox-zalo-oa-schema.test.ts`) chứng minh:
  - số dòng `contact_point` giữ nguyên;
  - CHECK nhận `zalo_oa_uid`;
  - cột mới có trên `lead`.

## Task 1.2: Chương trình/khóa học trên lead
- `createLearnerLead` (`learner-commands.ts`), `createLead` (`commands.ts`) và lệnh sửa lead hiện có nhận thêm `productId`/`courseId` không bắt buộc. Kiểm tra:
  - chương trình đang `active` và thuộc đúng tổ chức;
  - khóa học thuộc đúng chương trình đã chọn.
  - Nếu chưa có lệnh sửa lead nào nhận được trường này thì thêm lệnh `setLeadProgram`, có ghi activity và audit.
- `winLearnerLead`: thiếu `product_id` thì báo lỗi `VALIDATION_FAILED`, trong danh sách thiếu có ghi "chương trình học".
- Query danh sách lead và chi tiết lead trả về `productId`, `productName`, `courseId`, `courseName`.
- **Đạt khi:**
  - tạo lead có hoặc không có chương trình đều được;
  - chọn khóa học không thuộc chương trình thì bị từ chối;
  - chốt thắng khi thiếu chương trình thì bị chặn.

## Task 1.3: Không tạo lead trùng
- `createLearnerLead`: khách đã có lead **học viên** đang mở (`status = 'active'`) thì trả `DUPLICATE_SUSPECTED`, kể cả khi khách đó do chính người phụ trách giữ. Mỗi lead mới tạo phải có một `tx.assert` chặn việc tạo trùng khi hai yêu cầu chạy cùng lúc.
- `intake.ts`, chỗ ghi kết quả trích (đoạn tạo hoặc gộp lead chờ, quanh dòng 197–205): nếu hội thoại có `contact_id` và khách đó có lead đang mở (pipeline nào cũng được, lấy lead mới nhất) thì **không tạo lead chờ**. Thay vào đó:
  - ghi một `activity` loại `note` vào lead đó, `actor_kind = 'system'`, nội dung là các trường mới trích được. Bỏ trường rỗng và chỉ ghi khi có ít nhất một trường;
  - vẫn cập nhật `last_extracted_at`.
- Nút "Cập nhật CRM" (`inbox.requestExtraction`) dùng chung luồng trên.
- **Đạt khi:** có test cho hai trường hợp:
  - hội thoại đã gắn khách có lead mở: trích lần hai thì có 0 lead chờ mới và 1 activity note;
  - hội thoại chưa gắn khách: vẫn tạo lead chờ như cũ.

## Task 1.4: Nhận ra khách cũ khi phân loại
- Khi phân loại lead chờ (`intake.ts:278-311`): nếu hội thoại đã có `contact_id` và form không gửi `contactId` khác, thì dùng khách đó. Cụ thể là truyền `contactId` vào `createLearnerLead`/`createLead`, không tạo khách mới, và không ghi đè `conversation.contact_id` bằng một khách mới.
- Khi tạo lead chờ: nếu hội thoại chưa có `contact_id`, tìm khách theo mã kênh (`fb_psid`, `zalo_uid`, hoặc `zalo_oa_uid` với kênh `zalo_oa`) bằng `external_thread_id`. Tìm thấy thì điền `lead_intake.contact_id` và `conversation.contact_id`, rồi áp luật của Task 1.3.
- Khi phân loại, lưu điểm liên lạc của kênh `zalo_oa` là `zalo_oa_uid`, không phải `zalo_uid` (hiện ở `intake.ts:254`).
- **Đạt khi:**
  - có test phân loại hai lần trên cùng hội thoại, mỗi lần một lead chờ: còn 1 khách và lần hai bị chặn bởi `DUPLICATE_SUSPECTED`;
  - có test khách đã có `zalo_oa_uid` nhắn từ hội thoại mới thì tự được nhận ra.

## Task 1.5: Tự giao hội thoại cho người phụ trách và báo Lark
- Sau khi phân loại tạo lead xong: nếu hội thoại chưa giao ai hoặc đang giao cho người khác, thì giao cho người phụ trách lead. Dùng hàm giao việc có sẵn trong `assignment.ts`, để có audit và tin Lark kiểu cũ.
- Thêm một `send_lark` nhắn riêng cho người phụ trách: "Bạn có lead mới L-xxxx – <tên khách> – <chương trình nếu có>", kèm link `/learners/<contactId>` cho lead học viên hoặc `/leads/<leadId>` cho lead B2B.
- Không nhắn trùng: nếu việc giao vừa rồi đã sinh tin Lark cho đúng người đó, thì gộp tên lead vào tin đó.
- **Đạt khi:** có test phân loại xong thì `conversation.assignee_user_id` là người phụ trách lead, và có đúng một lệnh `send_lark` có `openId` của họ, chứa mã lead.

## Task 1.6: Lark lỗi cố định thì dừng ngay
- `worker-commands.ts`, phần gửi Lark: lỗi Lark mã 230013 (người nhận ngoài phạm vi khả dụng của app) thì gọi `failCommand(..., final = true)`, không thử lại.
- Ghi `app_user.lark_link_status = 'error'` kèm lý do, nếu bảng có cột để ghi lý do. Nếu không có cột đó thì chỉ đổi trạng thái.
- **Đạt khi:** có test Lark trả 230013 thì lệnh thành `failed` ngay ở lần thử đầu.

## Task 1.7: Không lấy đại từ xưng hô làm tên khách
- Trong câu lệnh trích (`intake.ts` quanh dòng 33): thêm quy tắc "Chỉ lấy họ tên thật khách tự giới thiệu; không lấy đại từ xưng hô (anh, chị, em, cô, chú, bác, sếp, bạn…) hay biệt danh".
- Thêm `program` vào danh sách trường trích: tên chương trình/khóa học khách quan tâm, hoặc số tiền khách đã đóng, ví dụ "199k".
- Khi kiểm tra kết quả trích ở Worker:
  - bỏ `name` nếu chỉ gồm một đại từ, hoặc bắt đầu bằng đại từ rồi theo sau là tối đa một từ (ví dụ "Chị", "Sếp Tú", "anh Long");
  - khớp `program` với `product` đang active: trước tiên theo số tiền (199k, 199.000 thì là `price_vnd = 199000`), rồi theo tên không phân biệt hoa thường. Khớp được thì lưu `productId` gợi ý vào lead chờ (trong `fields`) để form điền sẵn.
- **Đạt khi:**
  - có test "Chị" và "Sếp Tú" bị bỏ, còn "Nguyễn Văn An" được giữ;
  - có test "199k" khớp với chương trình giá 199.000đ.

## Files được sửa
- `apps/crm/migrations/0021_lead_program_sync.sql` (mới)
- `packages/contracts/src/index.ts`
- `apps/crm/src/worker/learner-commands.ts`, `commands.ts`, `queries.ts`, `learner-queries.ts`
- `apps/crm/src/worker/inbox/intake.ts`, `inbox-routes.ts`, `assignment.ts`, `worker-commands.ts`
- `apps/crm/test/**` (test mới, hoặc thêm vào test có sẵn của các file trên)

Cần sửa file khác thì DỪNG và ghi lý do vào báo cáo.

## Kiểm tra cuối phase
`pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`, `pnpm -F @abm/crm build` đều phải exit 0. Test vốn đạt trước đây thì vẫn phải đạt.

## Failure Protocol
Một bước kiểm tra sai mà nguyên nhân không nằm trong phần mình sửa: DỪNG, ghi lệnh và output vào báo cáo, rồi để Opus quyết.

## Rollback
Migration 0021 chỉ chạy trên D1 remote ở phase 4, do Opus chạy, có export trước.
