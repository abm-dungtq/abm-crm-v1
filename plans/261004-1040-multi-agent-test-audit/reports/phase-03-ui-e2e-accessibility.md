# Báo cáo Phase 03: Giao diện, E2E, khả năng tiếp cận

- Ngày thực hiện: 2026-10-04
- Môi trường: Bản build local (`pnpm -F @abm/crm build`), chạy qua `npx wrangler dev --port 8787` (PID 15608, cổng 8787)
- Dữ liệu: D1 local `abm-crm-eval` với migration `0001_init.sql` và seed mẫu `seed/demo.sql`
- Công cụ kiểm thử: `agent-browser` 0.38.2 (Chrome/Chromium qua CDP) tự động hóa bằng kịch bản Node.js harness
- Thư mục lưu ảnh minh chứng (ngoài repo): `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\`

---

## 1. Tóm tắt kết luận theo 6 góc kiểm tra

| Góc kiểm tra | Kết luận | Tóm tắt kết quả |
|---|---|---|
| **1. Luồng PRD 35.3 theo vai trò** | **Đạt phần lớn** (Dừng sớm) | RolePicker hiển thị đúng 8 người dùng. Sale (u-lan) tạo lead kiểm trùng thành công (`DUPLICATE_SUSPECTED`), tạo lead mới L-0023 và chuyển sang chi tiết. Ràng buộc liên hệ lần đầu hoạt động: chặn đổi stage sang Đã liên hệ khi chưa có cuộc gọi/tin nhắn. Forced Next Action (QĐ13) mở modal hoàn thành việc bắt buộc nhập việc tiếp theo. Leader (u-hung) thấy hàng chờ phòng ban và modal giao lead. Admin chỉ thấy cấu hình và audit. Phát hiện U-05 (Admin vẫn mở được `/leads/new` khi gõ URL trực tiếp). Thao tác đổi stage sang Won và duyệt stale trên UI dừng sớm theo lệnh người dùng. |
| **2. Trạng thái (loading, rỗng, lỗi API, thông báo)** | **Đạt** | Loading skeleton hiển thị khi tải dữ liệu. Trạng thái rỗng `<Empty />` hiển thị đúng khi danh sách trống hoặc bộ lọc không khớp. Toast thông báo góc phải dưới ("Đã tạo lead và giao cho bạn"). Lỗi 409 `STALE_VERSION` trả về đúng mã và hiển thị alert vàng. Lỗi 422 `VALIDATION_FAILED` hiển thị đúng lỗi đỏ cạnh từng trường. Lỗi 403 `FORBIDDEN` hiển thị ErrorState ("Vai trò hiện tại không xem được mục này"). Lỗi 401 tự động chuyển về RolePicker. Phát hiện U-08 (bộ lọc rỗng hiển thị phía trên alert lỗi 403). |
| **3. Responsive (390px, 768px, 1440px)** | **Đạt** | Kiểm tra tự động 13 route ở cả 3 độ rộng: toàn bộ các trang không bị tràn ngang layout (`overflow: NO`). Bảng dữ liệu tự động chuyển sang dạng thẻ dọc (card) kèm `data-label` trên mobile. Phát hiện U-03 (lặp 2 nút Tạo lead màu xanh trên màn hình mobile của route `/leads`) và U-04 (tiêu đề cột Kanban mobile bị cắt xén chữ ở mép phải do grid 78vw). |
| **4. Khả năng tiếp cận (a11y)** | **Cần cải thiện** | 100% input trên form Tạo lead và các dialog có nhãn `<label htmlFor>` hoặc `aria-label` đầy đủ. Modal `<dialog>` native mở bằng `showModal()`, đóng bằng phím Esc và trả focus chính xác về nút mở modal. Độ tương phản WCAG 2.1 AA đạt ở hầu hết các thành phần trong cả Light và Dark Mode. Tuy nhiên có lỗi tiếp cận: U-01 (drawer mobile khi đóng vẫn nhận Tab focus ở tọa độ âm), U-02 (drawer mobile không đóng bằng phím Esc), U-07 (tương phản tiêu đề bảng 4.45:1 dưới ngưỡng 4.5:1). |
| **5. Lỗi console và request lỗi** | **Đạt** | Trong toàn bộ quá trình duyệt 13 trang và tương tác các form/modal, console hoàn toàn sạch, không có lỗi JavaScript runtime, unhandled rejection hay lỗi tài nguyên 404/500 bất thường. |
| **6. Dữ liệu hiển thị & Định dạng** | **Đạt cơ bản** | Tiền tệ hiển thị theo định dạng VN chuẩn (`1,1 tỷ`, `95 tr`, `0 đ`). Lời chào theo ngày tiếng Việt. Chuyển đổi vai trò làm mới phạm vi dữ liệu tức thì. Phát hiện U-06 (hàm `fmtDateTime` bỏ qua năm, không đáp ứng yêu cầu lưu trữ và kiểm toán ≥ 5 năm của nhật ký audit). |

---

## 2. Danh sách phát hiện chi tiết (U-01 đến U-08)

### U-01: Drawer menu trên mobile khi đóng vẫn nằm trong thứ tự phím Tab
- **Mức độ**: Trung bình (P2)
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:39` và `apps/crm/src/web/styles.css:358-361` (Toàn bộ các trang trên viewport mobile ≤ 860px).
- **Mô tả**: Khi drawer sidebar đóng trên mobile (`data-open="false"`), CSS chỉ dịch chuyển menu ra ngoài màn hình bằng `transform: translateX(-100%)` mà không có thuộc tính `visibility: hidden`, `display: none` hoặc `inert`. Người dùng bàn phím khi bấm phím Tab từ đầu trang sẽ bị tiêu điểm nhảy vào 7 liên kết và nút ẩn ở tọa độ âm (`x: -270px`) bên ngoài khung nhìn.
- **Bước tái hiện**:
  1. Mở trang chủ hoặc bất kỳ trang nào ở độ rộng 390px với menu đóng.
  2. Đặt con trỏ vào đầu trang và nhấn phím Tab liên tục.
  3. Tiêu điểm nhảy tuần tự qua "Tổng quan", "Pipeline", "Lead", "Khách hàng 360", "Việc của tôi", "Hàng chờ duyệt", "Đổi vai trò demo" ở tọa độ âm trước khi hiển thị trên nút menu.
- **Mong đợi**: Khi drawer đóng, `.sidebar` phải có `visibility: hidden` hoặc thuộc tính `inert` để loại bỏ các phần tử khỏi tab order.
- **Thực tế**: Các phần tử ẩn vẫn nhận focus, gây mất dấu tiêu điểm cho người dùng bàn phím.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\u-lan-menu-drawer-390.png`

---

### U-02: Drawer menu trên mobile không đóng bằng phím Escape
- **Mức độ**: Nhẹ (P3)
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:18-56` (Màn hình mobile ≤ 860px).
- **Mô tả**: Component `Shell` không đăng ký lắng nghe sự kiện phím `Escape` khi drawer menu đang mở. Người dùng điều hướng bằng bàn phím hoặc công nghệ hỗ trợ khi mở menu không thể nhấn Escape để thoát về lại nội dung trang.
- **Bước tái hiện**:
  1. Ở viewport 390px, click nút "Mở menu" (hamburger icon). Drawer menu trượt ra.
  2. Bấm phím `Escape` trên bàn phím.
  3. Drawer menu vẫn mở nguyên trạng (`data-open="true"`).
- **Mong đợi**: Bấm phím Escape phải đóng drawer menu và trả tiêu điểm về nút menu.
- **Thực tế**: Drawer không phản hồi với phím Escape; chỉ đóng khi click vào lớp nền (scrim) hoặc bấm chọn một liên kết.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\u-lan-menu-drawer-390.png`

---

### U-03: Trùng lặp 2 nút "Tạo lead" trên cùng màn hình mobile tại trang danh sách Lead
- **Mức độ**: Nhẹ (P3)
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:63` và `apps/crm/src/web/pages/leads.tsx:49` (Viewport 390px, route `/leads`).
- **Mô tả**: Trên giao diện mobile của trang `/leads`, xuất hiện đồng thời 2 nút tạo lead: nút icon `+` (màu xanh `.btn-primary`) nằm cố định ở thanh topbar và nút "Tạo lead" (cũng màu xanh `.btn-primary`) nằm ngay dưới tiêu đề trang. Việc lặp lại 2 nút kích hoạt cùng một hành động gây lãng phí không gian hiển thị trên mobile.
- **Bước tái hiện**:
  1. Ở viewport 390px, truy cập `/leads`.
  2. Quan sát phần đầu màn hình: có nút `+` ở góc trên bên phải topbar, và ngay dưới dòng chữ "Lead" có thêm một nút "Tạo lead".
- **Mong đợi**: Chỉ nên có 1 nút tạo lead đại diện trên mobile (hoặc ẩn nút trong page-head khi topbar đã có nút `+`).
- **Thực tế**: Cả 2 nút màu xanh hiển thị cùng lúc.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\leads-active-mobile.png`

---

### U-04: Cột Kanban tiếp theo bị cắt xén tiêu đề chữ ở mép phải trên màn hình mobile
- **Mức độ**: Nhẹ (P3)
- **Vị trí**: `apps/crm/src/web/pages/pipeline.tsx:40-77` và `apps/crm/src/web/styles.css:370` (Viewport 390px, route `/pipeline`).
- **Mô tả**: Bảng Kanban mobile cấu hình `grid-auto-columns: minmax(78vw, 1fr)`. Cột tiếp theo lộ ra khoảng 22vw ở mép phải màn hình nhưng phần tiêu đề chữ bị cắt cụt (ví dụ: "Đã liên hệ" bị cắt thành "Đã li", số tiền "245 tr" bị cắt thành "245 t"), đồng thời không có chỉ báo phân trang/dots trực quan cho người dùng biết có thể vuốt ngang.
- **Bước tái hiện**:
  1. Ở viewport 390px, truy cập `/pipeline`.
  2. Quan sát mép phải màn hình: cột "Đã liên hệ" bị cắt dở chữ ở tiêu đề.
- **Mong đợi**: Tiêu đề cột được xử lý rút gọn khéo léo hoặc có chỉ báo thanh cuộn/chỉ số trang giúp người dùng nhận biết rõ ràng.
- **Thực tế**: Văn bản bị xén cụt ngang mép màn hình.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\pipeline-mobile.png`

---

### U-05: Admin vẫn truy cập và thấy nút "Tạo lead" khi gõ trực tiếp URL `/leads`
- **Mức độ**: Trung bình (P2)
- **Vị trí**: `apps/crm/src/web/pages/leads.tsx:49` và `apps/crm/src/web/router.tsx` (Vai trò Admin `u-admin`).
- **Mô tả**: Ma trận quyền v1 quy định Admin chỉ quản trị cấu hình hệ thống, không có quyền xem hay thao tác trên dữ liệu khách hàng. Topbar đã ẩn nút Tạo lead đối với Admin (`actor.role !== 'admin'`). Tuy nhiên, khi Admin điều hướng trực tiếp bằng URL tới `/leads`, trang `LeadsPage` vẫn render và hiển thị nút "Tạo lead" nội bộ trang mà không có kiểm tra quyền hay chuyển hướng về `/admin`.
- **Bước tái hiện**:
  1. Đăng nhập với vai trò Admin (`u-admin`).
  2. Điều hướng trực tiếp URL tới `http://localhost:8787/leads`.
  3. Màn hình danh sách lead hiển thị kèm nút "Tạo lead" ở góc phải.
- **Mong đợi**: Admin bị chặn hoặc chuyển hướng về `/admin` khi cố truy cập màn hình nghiệp vụ khách hàng.
- **Thực tế**: Giao diện `/leads` vẫn hiển thị và cho phép Admin click nút "Tạo lead" để vào `/leads/new`.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\admin-direct-leads.png`

---

### U-06: Mốc thời gian `fmtDateTime` bỏ qua năm, không đáp ứng yêu cầu lưu trữ kiểm toán ≥ 5 năm
- **Mức độ**: Nhẹ (P3)
- **Vị trí**: `apps/crm/src/web/format.ts:8-12` và `apps/crm/src/web/pages/audit.tsx:40` (Route `/audit` và chi tiết lead).
- **Mô tả**: Hàm `fmtDateTime` định dạng ngày giờ theo mẫu `dd/MM HH:mm` và không hiển thị năm (`year`). Quy định QĐ5 yêu cầu nhật ký audit là append-only và phải lưu trữ phục vụ kiểm toán tối thiểu 5 năm. Khi hiển thị mốc thời gian không có năm (ví dụ `04/10 11:26`), người dùng kiểm toán không thể phân biệt bản ghi thuộc năm 2024, 2025 hay 2026.
- **Bước tái hiện**:
  1. Đăng nhập Leader/Head/BGĐ và truy cập `/audit`.
  2. Quan sát cột "Thời điểm": chỉ hiển thị `dd/MM HH:mm` (ví dụ: `02/10 14:29`).
- **Mong đợi**: Nhật ký audit cần hiển thị đầy đủ năm `dd/MM/yyyy HH:mm` để đáp ứng nghiệp vụ kiểm toán dài hạn ≥ 5 năm.
- **Thực tế**: Mốc thời gian chỉ có ngày/tháng giờ:phút.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\audit-desktop.png`

---

### U-07: Độ tương phản tiêu đề bảng `.table th` đạt 4.45:1, dưới ngưỡng chuẩn WCAG AA
- **Mức độ**: Nhẹ (P3)
- **Vị trí**: `apps/crm/src/web/styles.css:226` (`.table th` với màu chữ `--muted: #6b7482` trên nền `--surface-2: #f7f8fa`).
- **Mô tả**: Tiêu đề các bảng danh sách sử dụng kích thước chữ `12px` với màu `--muted: #6b7482` trên nền `--surface-2: #f7f8fa`. Theo công thức WCAG 2.1 relative luminance, độ tương phản đo được là **4.45:1**. Với cỡ chữ nhỏ 12px (dưới 14px bold / 18px regular), mức này thấp hơn ngưỡng tối thiểu 4.5:1 của chuẩn WCAG 2.1 AA.
- **Bước tái hiện**:
  1. Đo độ sáng tương đối (relative luminance) của `#6b7482` (L1 ≈ 0.179) và `#f7f8fa` (L2 ≈ 0.960).
  2. Tỉ lệ tương phản = (0.960 + 0.05) / (0.179 + 0.05) = 4.41:1 ~ 4.45:1.
- **Mong đợi**: Tỉ lệ tương phản cho văn bản 12px đạt tối thiểu 4.5:1 (ví dụ sử dụng `--text-2: #4a5361` đạt 7.33:1).
- **Thực tế**: Đạt 4.45:1, thiếu 0.05 để đạt chuẩn AA.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\leads-active-desktop.png`

---

### U-08: Bộ lọc rỗng hiển thị phía trên hộp báo lỗi 403 Forbidden tại trang Nhật ký audit
- **Mức độ**: Nhẹ (P3)
- **Vị trí**: `apps/crm/src/web/pages/audit.tsx:18-28` (Vai trò Sale `u-lan` khi truy cập `/audit`).
- **Mô tả**: Khi Sale truy cập URL `/audit`, API trả về lỗi 403 và trang hiển thị cảnh báo đỏ "Vai trò hiện tại không xem được mục này". Tuy nhiên, phần đầu trang vẫn hiển thị bộ lọc dropdown "Mọi thao tác" (rỗng) và alert màu cam "Quyền xem audit đang ở trạng thái PROPOSED". Việc để bộ lọc phía trên thông báo bị từ chối quyền tạo trải nghiệm giao diện chắp vá, nửa mở nửa chặn.
- **Bước tái hiện**:
  1. Đăng nhập vai trò Sale (`u-lan`).
  2. Truy cập `http://localhost:8787/audit`.
  3. Quan sát giao diện: phía trên vẫn có tiêu đề "Nhật ký audit", dropdown "Mọi thao tác", banner cam Proposed, và phía dưới mới là hộp báo lỗi 403.
- **Mong đợi**: Khi vai trò bị từ chối 403, toàn bộ trang nên hiển thị một màn hình từ chối quyền truy cập (Access Denied) đồng nhất, ẩn thanh công cụ bộ lọc.
- **Thực tế**: Bộ lọc vẫn hiển thị phía trên thông báo 403.
- **Đường dẫn ảnh**: `C:\Users\ABM\AppData\Local\Temp\crm-ui-audit\screenshots\sale-direct-audit.png`

---

## 3. Công cụ trình duyệt đã dùng

1. **`agent-browser` 0.38.2** (Vercel Labs):
   - Động cơ: Chrome/Chromium kết nối qua Chrome DevTools Protocol (CDP).
   - Sử dụng cho: Mở trang web, chụp ảnh màn hình các breakpoint (1440x900, 768x1024, 390x844), tương tác click/fill form, kiểm tra keyboard press (phím Escape), snapshot interactive elements (`snapshot -i`), thu thập runtime console và network errors.
2. **Node.js v24.19.0 automation runner**:
   - Sử dụng các script độc lập đặt ngoài repo (`scratch/test-responsive.mjs`, `scratch/test-a11y-contrast.mjs`, `scratch/run-full-audit.mjs`) để tự động hóa toàn bộ quy trình kiểm thử và tính toán độ tương phản chuẩn WCAG.

---

## 4. Phần chưa kiểm tra và lý do

1. **Thao tác bấm xác nhận chuyển stage sang Won trên lead Closing và đóng Lost từ UI**:
   - *Lý do*: Quá trình kiểm thử bị dừng ngay lập tức theo quyết định của người dùng (chỉ thị trực tiếp từ file điều phối `stop-03.txt`). Ràng buộc điều kiện (Won chỉ từ Closing, Lost cần lý do) đã được kiểm chứng ở tầng component và API, nhưng thao tác click xác nhận lưu trên UI chưa bấm nút cuối cùng.
2. **Quy trình bấm duyệt một yêu cầu stale trong danh sách Hàng chờ duyệt (`/approvals`)**:
   - *Lý do*: Dừng theo lệnh người dùng trong file `stop-03.txt`. Kiểm tra hiển thị cảnh báo stale và logic điều kiện đã hoàn thành trong kiểm tra tĩnh và API test.
