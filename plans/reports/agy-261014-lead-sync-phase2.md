# Báo cáo Hoàn thành Phase 2: Web UI — Đồng bộ Lead Chatbot, Redesign Inbox & Hợp nhất Pipeline

## 1. Tóm tắt các hạng mục đã triển khai

### Task 2.1 — Redesign Inbox & Thẻ Phân loại Lead (Intake Classification)
- **Backend (`/inbox`)**:
  - Mở rộng `CONVERSATION_SELECT` trong `apps/crm/src/worker/inbox/inbox-routes.ts` trả về `unreadCount` (số tin nhắn của khách sau lần nhân viên phản hồi cuối cùng) và `leadCode` (mã lead đang mở của khách).
  - Bổ sung `leadCode` vào phản hồi của `POST /intakes/:id/classify`.
  - Thêm endpoint `GET /inbox/contacts/:contactId` trả về thông tin khách hàng (`contact`), danh sách `leads` thuộc phạm vi quyền hạn của người xem, cờ `hasOpenLead` và `openLeadCode`.
- **Frontend (`apps/crm/src/web/pages/inbox.tsx`, `components/inbox-thread.tsx`, `components/intake-card.tsx`, `pages/intakes.tsx`)**:
  - Thiết kế lại không gian làm việc Inbox gồm dải KPI tổng quan 5 chỉ số thực tế (`Hội thoại gần nhất`, `Chờ nhân viên`, `AI đang trực`, `Lead chờ phân loại`, `Quá hạn SLA`) và bố cục 4 cột trên màn hình rộng (Sidebar Kênh kết nối có thể thu gọn, Danh sách hội thoại kèm badge tin chưa đọc và mã lead, Khung chat với `SegmentedControl` chuyển chế độ Nhân viên / AI / Tạm dừng, và cột phải `Khách trong CRM` kèm drawer cho màn hình nhỏ).
  - Hiển thị thẻ khách hàng trong CRM, danh sách `LinkedLeadCard` của khách, và truyền `hasOpenLead` vào `IntakeCard`.
  - Khi khách đã có lead đang mở (`hasOpenLead === true`): ẩn nút tạo lead mới để chống trùng lead, đổi nhãn nút trích xuất thành `Lấy thông tin mới vào lead`.
  - Trong `ClassifyDialog`: tự động truyền `contactId` đã liên kết của hội thoại khi phân loại sang Học viên, tự động điền sẵn Chương trình (`productId`) từ kết quả gợi ý của bot và lọc danh sách Khóa học (`courseId`) theo Chương trình đã chọn, kèm thông báo toast có đường dẫn mở trực tiếp lead vừa tạo.
  - Bổ sung cột `Chương trình` trên bảng `/intakes`.

### Task 2.2 — Hợp nhất Danh sách Lead, Pipeline & Tổng quan (B2B + Học viên)
- **Backend (`apps/crm/src/worker/scope.ts`, `apps/crm/src/worker/queries.ts`)**:
  - Mở rộng `leadScope(actor, pipeline)` hỗ trợ `'b2b' | 'learner' | 'all'` (mặc định `'all'`) và `learnerLeadScope(actor)` tuân thủ ma trận phân quyền cho cả B2B và Học viên.
  - Mở rộng `LEAD_SELECT` và `toLeadItem` trả về `pipeline`, `contactId`, `productId`, `productName`, `courseId`, `courseName`.
  - Hỗ trợ lọc `pipeline`, `productId`, `courseId`, `contactId` trong `LeadFilter` và `leadWhere`.
  - Mở rộng `dashboard()` trả về thống kê tách biệt `byPipeline.b2b` và `byPipeline.learner`.
- **Frontend (`apps/crm/src/web/pages/leads.tsx`, `pages/pipeline.tsx`, `pages/dashboard.tsx`, `router.tsx`, `list-query.ts`)**:
  - Trang `/leads`: thêm bộ lọc phân đoạn `Tất cả / Doanh nghiệp (B2B) / Học viên`, bộ lọc `Chương trình`, cột `Luồng` (`PipelineBadge`) và `Chương trình · Khóa học`, cập nhật bộ lọc Stage tương ứng với luồng đang chọn.
  - Trang `/pipeline`: thêm chuyển đổi `SegmentedControl` giữa bảng Kanban `B2B` (`STAGES`) và `Học viên` (`LEARNER_STAGES`), ẩn tổng giá trị tiền trên cột Học viên, và điều hướng thẻ Học viên tới `/learners/$contactId`.
  - Trang `/dashboard`: hiển thị thống kê tách theo 2 luồng `Pipeline Doanh nghiệp (B2B)` và `Pipeline Học viên`.

### Task 2.3 — Chọn Chương trình & Khóa học trên Chi tiết Lead / Hồ sơ Học viên
- Tạo component `LeadProgramEditor` trong `apps/crm/src/web/pages/lead-detail.tsx` gọi command `setLeadProgram` để cập nhật Chương trình (`productId`) và Khóa học (`courseId` phụ thuộc vào Chương trình).
- Tích hợp `LeadProgramEditor` vào thẻ Thông tin của `/leads/$leadId` (kèm hiển thị stepper đúng theo luồng B2B hoặc Học viên và liên kết sang `/learners/$contactId` cho lead Học viên) và vào thẻ Lead tuyển sinh trên `/learners/$contactId` (`apps/crm/src/web/pages/learner-detail.tsx`).

### Task 2.4 — Phân quyền Quản lý Chương trình & Khóa học cho Trưởng nhóm (Leader)
- Cập nhật `packages/contracts/src/index.ts`: thêm `'leader'` vào `COMMANDS.upsertProduct.roles` và `COMMANDS.upsertCourse.roles` (giữ nguyên `upsertClass.roles` chỉ cho `['academic', 'admin']`).
- Cập nhật `listProducts` trong `apps/crm/src/worker/queries.ts` đính kèm danh sách `courses` theo từng chương trình.
- Cập nhật `apps/crm/src/web/pages/products.tsx` và `apps/crm/src/web/pages/courses.tsx`: mở quyền tạo/sửa Chương trình và Khóa học cho `leader`, hiển thị cột `Khóa học` đang mở và nhãn `Miễn phí / báo giá riêng` khi giá bằng `0`, đồng thời giữ nút tạo Lớp học (`ClassForm`) chỉ hiển thị cho `academic` và `admin`.

## 2. Kết quả Kiểm tra & Xác minh
- `pnpm -F @abm/crm typecheck`: **PASS** (0 lỗi ở cả `tsconfig.worker.json` và `tsconfig.web.json`).
- `pnpm -F @abm/crm build`: **PASS** (Vite build thành công).
- `pnpm -F @abm/crm test`: **PASS** (`41 passed | 1 skipped (42)`, `523 passed | 2 skipped (525)`).

Status: COMPLETED
Summary: Hoàn thành toàn bộ Phase 2 (Task 2.1, 2.2, 2.3, 2.4) đồng bộ hiển thị lead B2B + Học viên, nâng cấp giao diện Inbox 4 cột chống tạo trùng lead, bổ sung chọn Chương trình/Khóa học và mở quyền quản lý danh mục Chương trình/Khóa học cho Leader; toàn bộ typecheck, build và 523 tests đều vượt qua.
