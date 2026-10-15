# Báo cáo Phase A: Tăng tương phản menu tối và hiển thị ảnh trực tiếp trong khung chat

## 1. Các thay đổi đã thực hiện

### 1.1. Tương phản thanh điều hướng tối (`.sidebar`) và cột kênh Inbox (`.inbox-channels`)
- File: `apps/crm/src/web/styles.css`
- Giữ nguyên nền tối theo quyết định của owner (`--rail-bg: #0b1120`, `--subnav-bg: #0f172a`).
- Nâng token `--rail-muted` từ `#64748b` lên `#94a3b8` để toàn bộ chữ phụ (`.brand-sub`, `.nav-section`, `.inbox-channels-head`) vượt ngưỡng 4.5:1 trên cả hai nền tối.
- Đổi màu chữ liên kết menu `.nav a` từ `#94a3b8` sang `var(--rail-ink)` (`#e2e8f0`), tăng cỡ chữ lên `14.5px`, giữ `font-weight: 500`, và đặt `font-weight: 600` cho trạng thái đang chọn (`.is-active`, `[data-status='active']`).
- Đồng bộ màu chữ `.inbox-channel-btn` và huy hiệu đếm `.inbox-channel-btn .count` sang `var(--rail-ink)` (`#e2e8f0`); chỉnh nền `.inbox-channel-btn[aria-current='true'] .count` sang `rgba(15, 23, 42, 0.35)` để chữ `#ffffff` trên nút đang chọn đạt tương phản cao.

### 1.2. Hiển thị ảnh trực tiếp trong bong bóng chat và xem ảnh lớn (Lightbox)
- File: `apps/crm/src/web/components/inbox-thread.tsx`, `apps/crm/src/web/components/ui.tsx`, `apps/crm/src/web/styles.css`
- Cập nhật `parseAttachments` để giữ nguyên trường `mimeType` và chấp nhận cả đường dẫn tuyệt đối `http(s)://` lẫn đường dẫn nội bộ tương đối bắt đầu bằng `/` (ví dụ `/api/inbox/media/<key>`).
- Thêm hàm `isImageAttachment`:
  - Trả về `true` khi `mimeType` bắt đầu bằng `image/`.
  - Khi không có `mimeType`, trả về `true` nếu đường dẫn URL kết thúc bằng `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` hoặc tên miền thuộc `zdn.vn`, `fbcdn.net`, `fbsbx.com`.
- Trong `MessageBubble`:
  - Hiển thị các tệp ảnh hợp lệ dưới dạng ảnh thu nhỏ (`.msg-image`, tối đa `260x260px`, bo góc, `loading="lazy"`, `referrerPolicy="no-referrer"`, `alt="Ảnh khách gửi"` đối với tin khách gửi hoặc `alt="Ảnh đã gửi"` đối với tin gửi đi). Nhiều ảnh trong cùng một tin nhắn tự động xếp thành lưới 2 cột (`.msg-images[data-grid='true']`).
  - Khi ảnh tải lỗi (`onError`), tự động thay thế ảnh lỗi bằng liên kết `"Mở ảnh"` trỏ tới URL ảnh.
  - Tự động ẩn dòng chữ giữ chỗ trong `.msg-body` khi bong bóng có ít nhất một ảnh và nội dung `body` (sau khi `trim`) nằm trong tập `""`, `"[Hình ảnh]"`, `"[Tệp đính kèm]"`, `"[Ảnh]"`.
  - Các tệp đính kèm không phải ảnh giữ nguyên kiểu liên kết `"Tệp đính kèm"`.
  - Không chỉnh sửa `Composer`.
- Thêm component `ImageLightbox` trong `apps/crm/src/web/components/ui.tsx` và tích hợp vào `InboxThread`:
  - Hiển thị ảnh lớn trên nền tối mờ (`rgba(11, 17, 32, 0.88)`).
  - Đóng khi nhấn phím `Escape`, bấm ra ngoài vùng ảnh, hoặc bấm nút đóng (`Đóng`).
  - Có liên kết `"Mở ảnh gốc"` với `target="_blank" rel="noopener noreferrer"`.
- Trang nhóm Zalo (`apps/crm/src/web/pages/zalo-groups.tsx`) dùng trực tiếp `InboxThread` nên tự động thừa hưởng toàn bộ cơ chế hiển thị ảnh thu nhỏ và Lightbox.

## 2. Bảng tỷ lệ tương phản màu (WCAG 2.x)

| Thành phần | Màu chữ | Màu nền | Tỷ lệ tương phản | Yêu cầu | Kết quả |
|---|---|---|---|---|---|
| Tên thương hiệu (`.brand-name`) | `#ffffff` | `#0b1120` (`--rail-bg`) | **18.83 : 1** | ≥ 4.5 : 1 | Đạt (AAA) |
| Phụ đề thương hiệu (`.brand-sub`) | `#94a3b8` (`--rail-muted`) | `#0b1120` (`--rail-bg`) | **7.34 : 1** | ≥ 4.5 : 1 | Đạt (AAA) |
| Nhãn phân mục (`.nav-section`) | `#94a3b8` (`--rail-muted`) | `#0b1120` (`--rail-bg`) | **7.34 : 1** | ≥ 4.5 : 1 | Đạt (AAA) |
| Liên kết menu (`.nav a`) | `#e2e8f0` (`--rail-ink`) | `#0b1120` (`--rail-bg`) | **15.27 : 1** | ≥ 7.0 : 1 | Đạt (AAA) |
| Liên kết menu khi hover (`.nav a:hover`) | `#ffffff` | `#1e293b` (`--rail-active`) | **14.63 : 1** | ≥ 7.0 : 1 | Đạt (AAA) |
| Liên kết menu đang chọn (`.nav a.is-active`) | `#ffffff` | `#2563eb` (`--subnav-active`) | **5.17 : 1** | ≥ 4.5 : 1 | Đạt (AA) |
| Huy hiệu đếm trên menu (`.nav .count`) | `#ffffff` | `#dc2626` | **4.83 : 1** | ≥ 4.5 : 1 | Đạt (AA) |
| Tiêu đề cột kênh (`.inbox-channels-head`) | `#94a3b8` (`--rail-muted`) | `#0f172a` (`--subnav-bg`) | **6.96 : 1** | ≥ 4.5 : 1 | Đạt (AA+) |
| Nút thu gọn cột kênh | `#94a3b8` | `#0f172a` (`--subnav-bg`) | **6.96 : 1** | ≥ 4.5 : 1 | Đạt (AA+) |
| Nút kênh Inbox (`.inbox-channel-btn`) | `#e2e8f0` (`--rail-ink`) | `#0f172a` (`--subnav-bg`) | **14.48 : 1** | ≥ 7.0 : 1 | Đạt (AAA) |
| Nút kênh khi hover (`.inbox-channel-btn:hover`) | `#ffffff` | `#1e293b` (`--subnav-hover`) | **14.63 : 1** | ≥ 7.0 : 1 | Đạt (AAA) |
| Nút kênh đang chọn (`.inbox-channel-btn[aria-current='true']`) | `#ffffff` | `#2563eb` (`--subnav-active`) | **5.17 : 1** | ≥ 4.5 : 1 | Đạt (AA) |
| Số đếm kênh thường (`.inbox-channel-btn .count`) | `#e2e8f0` (`--rail-ink`) | `#272e3f` (`rgba(255,255,255,0.1)` trên `#0f172a`) | **10.93 : 1** | ≥ 4.5 : 1 | Đạt (AAA) |
| Số đếm kênh đang chọn (`.inbox-channel-btn[aria-current='true'] .count`) | `#ffffff` | `#1d48a7` (`rgba(15,23,42,0.35)` trên `#2563eb`) | **8.31 : 1** | ≥ 4.5 : 1 | Đạt (AAA) |

## 3. Kết quả kiểm tra (Verify)

- `pnpm -F @abm/crm typecheck`: **Exit 0** (`tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`)
- `pnpm -F @abm/crm build`: **Exit 0** (`vite build` hoàn tất trong 4.02s, tạo `dist/assets/index-Cmw1PCSO.css` và `dist/assets/index-CMB6Pv_f.js`)
- `pnpm -F @abm/crm test`: **Exit 0** (`42 passed | 1 skipped`, `531 passed | 2 skipped` trong 54.23s)

Status: DONE
Summary: Đã nâng độ tương phản của menu tối và cột kênh Inbox đạt chuẩn (liên kết menu ~14.5:1–15.3:1, chữ phụ ~7.0:1–7.3:1) và bổ sung hiển thị ảnh thu nhỏ kèm Lightbox xem lớn trong khung chat Inbox và nhóm Zalo.
