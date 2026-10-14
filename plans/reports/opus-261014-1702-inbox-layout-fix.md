# Sửa bố cục Inbox sau phase 2 (Opus tự sửa, do Gemini hết hạn mức)

Gemini (Paseo, agent a8e605cb) dừng ngay vì "Individual quota reached", hạn mức tự mở lại sau khoảng 2h40m. Nó không sửa file nào, nên Opus tự sửa.

## Lỗi và nguyên nhân
- **Cột "Kênh kết nối" vỡ (biểu tượng to ~150px, chữ mờ).** CSS mới đặt tên `.ch-nav-btn`, `.ch-nav-count`, `.inbox-channels-title`, còn `inbox.tsx` dùng `.inbox-channel-btn`, `.count`, `.inbox-channels-head`. Nút vì thế không có style nào, còn SVG không có kích thước. Lớp thu gọn `inbox-channels-collapsed` cũng không khớp với CSS `[data-channels-collapsed]`.
- **Dòng hội thoại mất tên khách và tin cuối.** CSS đặt `.conv-row` thành lưới 2 cột (36px + phần còn lại), nhưng JSX chỉ có một phần tử con. Cả nội dung bị nhét vào cột 36px.
- **Màn 1280px mất tên khách ở đầu khung chat.** Nút chọn chế độ AI/Nhân viên/Tạm dừng chiếm hết chỗ.

## Đã sửa
- `apps/crm/src/web/styles.css`:
  - đổi tên selector cho khớp với JSX;
  - SVG 16px;
  - `.conv-row` về dạng khối;
  - huy hiệu chưa đọc nằm cùng dòng;
  - lớp thu gọn cột kênh;
  - đầu khung chat được xuống dòng.
- `apps/crm/src/web/components/inbox-thread.tsx`: khối tên khách giữ tối thiểu 160px và có `title` để xem tên đầy đủ.

## Kiểm tra
- Chụp lại màn hình ở 1600px và 1280px: tên khách, tin cuối, huy hiệu kênh và cột kênh đều hiển thị đúng.
- `pnpm -F @abm/crm typecheck`: đạt.
- `pnpm -F @abm/crm test`: 523 đạt, 2 bỏ qua.
- `pnpm -F @abm/crm build`: đạt.

Status: DONE
Summary: Sửa 2 lỗi CSS (tên lớp không khớp, lưới dòng hội thoại sai) và đầu khung chat ở màn hẹp; typecheck, test và build đều đạt.
