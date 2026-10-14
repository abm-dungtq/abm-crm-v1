# Phase 2: Giao diện hướng 3, khung ứng dụng và Inbox mới, lead hiện đủ chỗ

Làm sau phase 1, dùng các API và kiểu dữ liệu mới của phase 1.

Hướng giao diện đã chốt ngày 14/10: **hướng 3, kết hợp**.
- Menu chính và cột chọn kênh nền tối.
- Vùng làm việc nền sáng.
- Dải số liệu (KPI) ở trên cùng.
- Cột phải là hồ sơ khách và thẻ lead.

Thiết kế chi tiết:
- `plans/reports/agy-261014-1440-crm-ui-redesign.md`: mục 2 (token, khung ứng dụng, Inbox), mục 3 (hướng 3), mục 4 (giai đoạn 1, các component dùng chung, rủi ro).
- Bản mẫu: `plans/reports/ui-mockup-261014-inbox.html`. Inbox thật phải giống bản mẫu này về bố cục và màu.

## Task 2.1: Token, khung ứng dụng, component dùng chung
- `styles.css`:
  - thêm bộ token (màu nền, chữ, màu theo kênh Zalo OA, Zalo, Zalo nhóm, Facebook, AI);
  - bỏ giới hạn `max-width: 1440px` của `.content`;
  - thêm breakpoint 1440px: dưới mức này cột kênh gập lại được và cột hồ sơ đóng mở được.
- `components/layout.tsx`: menu nền tối, có huy hiệu số tin chưa đọc.
- `components/icons.tsx`: thêm các icon còn thiếu mà báo cáo liệt kê.
- `components/ui.tsx`: thêm 7 component dùng chung:
  - `ChannelBadge`, `Drawer`, `SegmentedControl`, `KpiCard`, `LinkedLeadCard`, `QuickActionTile`, `CopyableText`.
  - Chỉ dùng CSS đang có cùng token mới, không thêm thư viện UI.

## Task 2.2: Inbox mới
- `pages/inbox.tsx`, `components/inbox-thread.tsx`, `components/intake-card.tsx`:
  - dải KPI trên cùng, chỉ dùng số liệu API đang có hoặc đếm được từ danh sách. Không bịa số;
  - cột kênh có số đếm;
  - dòng hội thoại có ảnh đại diện, huy hiệu kênh, số tin chưa đọc và nhãn chế độ;
  - người phụ trách và công tắc AI / Nhân viên / Tạm dừng đặt ở đầu khung chat.
- **Cột phải "Khách trong CRM"**, khi hội thoại có `contactId`:
  - thẻ khách: tên, người giữ khách, SĐT có nút sao chép;
  - danh sách lead của khách bằng `LinkedLeadCard`. Mỗi thẻ hiện mã, pipeline (Học viên/B2B), giai đoạn, người phụ trách, chương trình/khóa học, và đường dẫn: lead học viên mở `/learners/<contactId>`, lead B2B mở `/leads/<leadId>`;
  - nếu Worker chưa có API trả về lead theo `contactId` cho Inbox, thêm một endpoint đọc nhỏ trong `inbox-routes.ts`, theo phạm vi quyền như các endpoint đọc khác.
- **Khi khách đã có lead đang mở:**
  - thẻ "Lead chờ phân loại" không mời tạo lead nữa;
  - đổi nút "Cập nhật CRM" thành "Lấy thông tin mới vào lead". Nút này ghi ghi chú vào lead, đúng như phase 1.
- Thông báo sau khi phân loại có đường dẫn "Mở lead L-xxxx".
- **Form phân loại:**
  - mặc định dùng khách đang gắn với hội thoại;
  - có ô chọn chương trình và khóa học, điền sẵn theo `productId` gợi ý;
  - ô khóa học chỉ liệt kê khóa của chương trình đã chọn.

## Task 2.3: Lead học viên trong Danh sách lead, Pipeline và Tổng quan
- `worker/scope.ts` (`b2bLeadScope`) và `queries.ts`:
  - danh sách lead và pipeline nhận tham số `pipeline` (`b2b` | `learner` | `all`), mặc định `all`;
  - quyền xem lead học viên theo luật đang dùng ở trang Học viên.
- **Danh sách lead:** thêm bộ lọc pipeline, cột "Chương trình" và nhãn Học viên/B2B.
- **Pipeline:** cho chọn pipeline để xem. Kanban học viên dùng `LEARNER_STAGES`, kanban B2B giữ nguyên.
- **Tổng quan:** số liệu lead tính cả lead học viên, có tách theo pipeline.
- Ở chi tiết lead (B2B) và chi tiết học viên: có ô chọn và sửa chương trình/khóa học, gọi lệnh sửa của phase 1.
- Trang Sản phẩm đổi nhãn hiển thị thành "Chương trình". Giá 0 hiện là "Miễn phí / báo giá riêng" (xem mô tả).
- **Đạt khi:** có test query, `pipeline=all` trả cả lead học viên, `pipeline=b2b` thì không.

## Task 2.4: Leader được sửa chương trình và khóa học
Chủ dự án đã quyết định ngày 14/10.
- Trong `packages/contracts/src/index.ts`, thêm `leader` vào `roles` của `upsertProduct` và `upsertCourse`. Nếu tạo lớp cũng cần quyền này thì giữ nguyên quyền tạo lớp như cũ.
- Phía web, cập nhật `canEditCatalogue` (và hàm kiểm quyền tương tự, nếu có) để Leader thấy nút Sửa.
- **Đạt khi:** có test cho thấy Leader gọi được `upsertProduct` và `upsertCourse`, còn Sale bị `FORBIDDEN`.

## Files được sửa
- `packages/contracts/src/index.ts` (chỉ cho Task 2.4)
- `apps/crm/src/web/**`
- `apps/crm/src/worker/inbox/inbox-routes.ts`, `scope.ts`, `queries.ts`, `learner-queries.ts`
- `apps/crm/test/**`

## Kiểm tra cuối phase
- `pnpm -F @abm/crm test`, `typecheck` và `build` đều exit 0.
- Ghi vào báo cáo các màn đã đổi. Opus sẽ mở trình duyệt để soát.

## Failure Protocol
Giống phase 1.
