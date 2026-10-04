---
title: Dashboard "Toàn cảnh" cho Admin và Giám đốc
status: in-progress
created: 2026-10-04
mode: advice
contract: ../reports/brainstorm-261004-1620-executive-overview-dashboard.md
---

# Dashboard "Toàn cảnh" cho Admin và Giám đốc

Trang `/overview` gom toàn bộ thông tin CRM vào một màn hình kiểu kanban. Chỉ `admin` và `director` được xem. Trang chỉ đọc. Không cần migration.

Kế hoạch này viết để giao cho một executor yếu hơn. Mỗi phase có Failure Protocol riêng: dừng lại khi kiểm tra không đạt là hành vi đúng, không phải bị kẹt.

## Phases

| # | Phase | Status | Phụ thuộc |
|---|---|---|---|
| 01 | [API `/api/overview` + KPI + kanban + chờ duyệt + bot/Lark](phase-01-overview-api-and-kanban.md) | completed | — |
| 02 | [Ma trận nhiệt, khối lượng Sale, nguồn lead, audit gần đây, lọc lead theo phòng ban](phase-02-heat-matrix-and-panels.md) | completed | 01 |
| 03 | [Deploy lên eval (cần user đồng ý)](phase-03-deploy-eval.md) | pending | 02 |

## Acceptance criteria

- Admin (`u-admin`) và Giám đốc (`u-bgd`) thấy menu "Toàn cảnh" và gọi `GET /api/overview` nhận 200.
- `u-head`, `u-hung`, `u-lan` không thấy menu; gọi API nhận 403 với code `FORBIDDEN`.
- KPI và số đếm từng cột khớp với truy vấn SQL trực tiếp trên seed. Có test cho Giám đốc có `department_id`.
- Response không chứa giá trị nào trong `contact_point`, và không có khóa `before`/`after`/`phone`/`email`.
- Tỉ lệ chốt = won / (won + lost), chỉ tính lead đóng trong kỳ. Trả `null` khi chưa có lead nào đóng.
- Trang không có thanh cuộn ngang ở khổ 375px. Bảng kanban được tự cuộn ngang bên trong.
- `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm build` đều exit 0.

## Quyết định đã chốt

- Kỳ: `month` (mặc định), `quarter`, `year`, tính từ đầu kỳ đến nay theo lịch Asia/Saigon. Giá trị lạ thì quay về `month`.
- Pipeline đang mở là ảnh chụp tại thời điểm xem, không lọc theo kỳ.
- Không dùng lại `GET /admin/overview`.
- Head không được xem trong lần này. Code vẫn xây trên `leadScope()` để sau này mở thêm cho rẻ.

## Ràng buộc chung

- Chỉ sửa các file mà từng phase liệt kê.
- Không đưa mã plan hay tên phase vào code, tên test hoặc commit message.
- Commit theo conventional commits, không nhắc tới AI. Cuối commit message có hai dòng attribution của session.
- Deploy (phase 03) cần user đồng ý rõ ràng.

## Ghi chú thực hiện

- 202/202 test, typecheck và build đều qua sau phase 02.
- Chưa kiểm bằng mắt ở 375px: có hai trình duyệt Chrome cùng kết nối, phải hỏi user chọn một, nên bước này bỏ qua để không chặn chế độ tự chạy. Bảng kanban và ma trận đều nằm trong vùng tự cuộn (`.board`, `.table-wrap`).
