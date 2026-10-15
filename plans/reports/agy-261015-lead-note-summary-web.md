# Báo cáo triển khai Web: Sửa trang trắng khi tạo lead & Tóm tắt hội thoại trong ghi chú lead

- **Thời gian:** 15/10/2026 (Asia/Saigon)
- **Phạm vi:** Giao diện web (`apps/crm/src/web/**`) và unit test web (`apps/crm/test/web-inbox.test.ts`)
- **Kỹ năng thiết kế áp dụng:** `ak-frontend-design` (Neo-grotesque product UI / Direction 3 Hybrid Dark Rail + Light Workspace)

## 1. Các thay đổi đã thực hiện

### 1.1. Sửa tận gốc lỗi màn hình trắng (`ToastProvider` trong Router)
- **[main.tsx](file:///D:/TQD/CRM/apps/crm/src/web/main.tsx):** Gỡ `ToastProvider` khỏi bên ngoài `RouterProvider`, giữ nguyên `QueryClientProvider`.
- **[router.tsx](file:///D:/TQD/CRM/apps/crm/src/web/router.tsx):** Đặt `ToastProvider` bao bọc bên trong component `Root` của `rootRoute`. Nhờ đó mọi nơi gọi `useToast()` (`PasswordRoot`, `DemoRoot`, `LoginPage`, `ChangePasswordPage`, `RolePicker`, `Shell` và `<Outlet />`) đều nằm trong ngữ cảnh của cả `ToastProvider` lẫn TanStack Router, cho phép bất kỳ toast nào chứa `<Link>` mà không làm sập cây React.

### 1.2. Tự mở trang lead sau khi bấm "Tạo lead"
- **[intake-card.tsx](file:///D:/TQD/CRM/apps/crm/src/web/components/intake-card.tsx):** Khi `classifyIntake` thành công:
  - Hiển thị thông báo ngắn: `"Đã tạo lead B2B <mã>"` hoặc `"Đã tạo lead học viên <mã>"`.
  - Đóng hộp thoại phân loại (`onClose()`).
  - Làm mới cache truy vấn (`client.invalidateQueries()`) và chuyển hướng bằng `useNavigate()` tới `/leads/$leadId` (cho B2B) hoặc `/learners/$contactId` (cho học viên).
  - Giữ nguyên luồng cảnh báo trùng (`DUPLICATE_SUSPECTED`) và gắn vào khách có sẵn (`ContactLinker`).

### 1.3. Tóm tắt hội thoại trong thẻ chờ phân loại và hộp thoại "Tạo lead"
- **[types.ts](file:///D:/TQD/CRM/apps/crm/src/web/types.ts):** Thêm `'summary'` vào `INTAKE_FIELDS`.
- **[note-format.ts](file:///D:/TQD/CRM/apps/crm/src/web/components/note-format.ts) & [intake-card.tsx](file:///D:/TQD/CRM/apps/crm/src/web/components/intake-card.tsx):**
  - Thêm nhãn `summary: 'Tóm tắt hội thoại'` vào `INTAKE_FIELD_LABEL`.
  - Tách các trường đơn dòng (`ROW_INTAKE_FIELDS`) khỏi `summary`. Hiển thị `summary` trong `IntakeDetails` dưới dạng khối danh sách chấm đầu dòng gọn gàng (`.intake-summary`, `.intake-summary-list`) có tiêu đề **"Tóm tắt hội thoại"**.
  - Trong `ClassifyDialog` (cho cả B2B và học viên), thêm ô `<textarea>` **"Tóm tắt hội thoại (lưu vào ghi chú lead)"** ngay sau trường **Nhu cầu**:
    - Điền sẵn từ `intake.fields.summary` (tối đa 1500 ký tự).
    - Cho phép nhân viên chỉnh sửa hoặc xóa trống, giới hạn `maxLength={1500}` kèm bộ đếm ký tự (`tabular-nums`, đổi màu cảnh báo khi tiến sát giới hạn `>= 1200` ký tự).
    - Dòng hướng dẫn: *"AI tóm tắt sẵn, bạn sửa lại nếu cần. Để trống nếu không cần."*
- **[api.ts](file:///D:/TQD/CRM/apps/crm/src/web/api.ts):** Mở rộng `classifyIntake(id, pipeline, input, summary)` thông qua `buildClassifyPayload`, gửi `summary` ở cấp trên cùng `{ pipeline, input, summary }` chỉ khi chuỗi sau khi `trim()` không rỗng.

### 1.4. Hiển thị và thu gọn ghi chú dài trong mục Hoạt động
- **[lead-actions.tsx](file:///D:/TQD/CRM/apps/crm/src/web/components/lead-actions.tsx), [lead-detail.tsx](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-detail.tsx), [learner-detail.tsx](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-detail.tsx):**
  - Tạo component dùng chung `ActivityTimeline` cho cả trang chi tiết lead B2B và trang chi tiết học viên.
  - Hiển thị nội dung hoạt động với `white-space: pre-wrap` (`.tl-body`) để bản tóm tắt dạng `- ` hiển thị rõ từng dòng.
  - Tự động thu gọn (`clampActivityText` + CSS `-webkit-line-clamp: 6`) mọi ghi chú dài hơn 6 dòng hoặc 600 ký tự, kèm nút **"Xem thêm" / "Thu gọn"** (`.tl-toggle` có `aria-expanded`) để các ghi chú cũ chứa nguyên bản ghi hội thoại không làm kéo dài trang.

## 2. Quyết định thiết kế (`ak-frontend-design`)
- **Design Read:** Giao diện vận hành CRM cho nhân viên tuyển sinh và sale B2B, ngôn ngữ thiết kế *Neo-grotesque product / Direction 3 Hybrid Dark Rail + Light Workspace*.
- **Hệ token & nhịp điệu:** Sử dụng toàn bộ biến màu và khoảng cách sẵn có trong [styles.css](file:///D:/TQD/CRM/apps/crm/src/web/styles.css) (`--surface-2`, `--border`, `--text`, `--text-2`, `--muted`, `--accent-text`, `--warn`, `--danger`, `--radius-sm`).
- **Trải nghiệm đọc & thao tác:**
  - Khối `.intake-summary` dùng nền `--surface-2` và viền mảnh `--border` tách biệt nhẹ với các cặp khóa–giá trị một dòng phía trên, giúp sale đọc lướt 3–6 ý chính trong vài giây.
  - Bộ đếm ký tự `.field-counter` dùng `font-variant-numeric: tabular-nums` nằm cùng hàng với dòng gợi ý bên dưới `<textarea>` (`.field-foot`), chuyển sang màu `--warn` khi đạt 1200/1500 ký tự và `--danger` khi chạm mốc 1500.

## 3. Kết quả kiểm tra (Verify)

- `pnpm -F @abm/crm typecheck` → **Exit code 0** (`tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`)
- `pnpm -F @abm/crm build` → **Exit code 0** (`vite build` hoàn tất trong 3.81s)
- `pnpm -F @abm/crm test` → **Exit code 0** (`43 passed | 1 skipped (44)`, `554 passed | 2 skipped (556)`)

```
Status: DONE
Summary: Đã chuyển ToastProvider vào trong Router để sửa dứt điểm lỗi màn hình trắng, tự động mở trang lead/học viên sau khi phân loại, bổ sung khối hiển thị và ô chỉnh sửa tóm tắt hội thoại (tối đa 1500 ký tự) trong luồng Tạo lead, đồng thời dùng chung ActivityTimeline có thu gọn/mở rộng cho ghi chú dài.
```
