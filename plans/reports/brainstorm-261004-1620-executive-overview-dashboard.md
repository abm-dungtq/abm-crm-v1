# Brainstorm: dashboard "Toàn cảnh" cho Admin và Giám đốc

Ngày 2026-10-04. Chế độ `--advice`, kongming kết luận **GO-with-changes** (đã gộp vào bên dưới).

## Yêu cầu của user

"gỡ kết nối cũ + phát triển thêm 1 dashboard quản trị tổng hợp toàn bộ thông tin trên CRM dạng dashboard kanban trực quan nhất, chỉ admin, Giám đốc mới được xem".

Phần gỡ kết nối cũ đã làm lúc 16:15: bỏ grant MCP `abm-crm-poc` khỏi agent `crm-sales-poc`. Agent chỉ còn grant `abm-crm-main` với 11 tool. GoClaw đã được backup lúc 16:06 và không bị restart.

## Contract

**Outcome.** Trang `/overview` tên "Toàn cảnh". Menu chỉ hiện với `admin` và `director`. Trang dùng một endpoint chỉ đọc `GET /api/overview`; vai trò khác nhận 403. Nội dung:

1. **Dải KPI toàn công ty:**
   - lead đang mở và giá trị pipeline;
   - hàng chờ chưa giao;
   - Won/Lost trong kỳ (số và giá trị);
   - tỉ lệ chốt;
   - việc quá hạn;
   - vi phạm SLA;
   - yêu cầu chờ duyệt;
   - thao tác bot hôm nay.
2. **Kanban chính:**
   - cột theo thứ tự: Hàng chờ, 7 stage đang mở, Won, Lost (Won/Lost tính theo `closed_at` trong kỳ);
   - đầu cột: số lead, giá trị, số lead có rủi ro;
   - thân cột: tối đa khoảng 8 thẻ, xếp theo rủi ro, kèm link "+N nữa" sang `/leads` đã lọc.
3. **Ma trận nhiệt:**
   - hàng là phòng ban hoặc team (người xem chuyển được), cột là stage;
   - mỗi ô ghi số lead và giá trị, tô màu theo tỉ lệ lead có rủi ro;
   - bấm vào ô thì mở danh sách lead đã lọc.
4. **Các khung phụ:**
   - yêu cầu chờ duyệt theo loại và tuổi, ghi rõ người gửi hay bot gửi;
   - khối lượng việc theo Sale;
   - nguồn lead kèm tỉ lệ chốt;
   - sức khỏe bot và Lark: kill switch, số token đang dùng, số thao tác của agent trong 7 ngày, outbox theo trạng thái;
   - 20 thao tác audit gần nhất.
5. **Bộ lọc:**
   - kỳ: tháng / quý / năm tính đến hôm nay, theo lịch Asia/Saigon;
   - phòng ban: mặc định "Tất cả".

**Định nghĩa đã chốt (mặc định, không hỏi lại)**

- Kỳ được tính bằng `vnDate()` giống `dashboard()`. Won/Lost và tỉ lệ chốt lọc theo `closed_at` trong kỳ.
- Pipeline đang mở là ảnh chụp tại thời điểm xem, không lọc theo kỳ. Trang ghi rõ điều này.
- Tỉ lệ chốt = won / (won + lost) đóng trong kỳ. Lead đang mở và hàng chờ không tính vào mẫu số.
- Số đếm và giá trị tính bằng SQL. Rủi ro tính bằng `leadHealth()` trên một truy vấn lead có giới hạn.
- Nếu số lead bị cắt bớt thì trang hiện "đang hiển thị N / M", không để sai số âm thầm.
- Phạm vi dữ liệu xây trên `leadScope()`. Giám đốc có `department_id` vẫn xem toàn tổ chức; bộ lọc phòng ban do người xem tự chọn.
- Feed audit chỉ trả `command`, `entity`, mã lead, tên người làm, `actor_kind`, thời điểm. Không bao giờ trả `before_json`/`after_json`, vì hai trường này có thể chứa SĐT hoặc email.
- Không dùng lại `GET /admin/overview`: endpoint này trả thông tin token và chỉ dành cho Admin.

**Constraints**

- Không cần migration.
- Dùng lại `leadHealth`, các component và style hiện có. Không thêm thư viện biểu đồ.
- Test bằng vitest, chạy typecheck và build.
- Deploy cần user đồng ý từng lần.

**Non-goals**

- Kéo thả đổi stage.
- Xuất file.
- Đẩy dữ liệu realtime.
- Sửa dữ liệu từ dashboard.
- Mở quyền xem cho Head trong lần này.

**Acceptance**

- Admin và director thấy menu và trang. Head, Leader và Sale không thấy menu, gọi API thì nhận 403.
- Số liệu khớp với truy vấn SQL trực tiếp trên seed. Có test với director có `department_id`.
- Response không chứa SĐT hay email. Có test kiểm `phone`/`email`.
- Trang hiển thị đúng ở màn hình 375px.
- Test, typecheck và build đều qua.

## Trade-offs

| Hướng | Giả định chính | Hỏng đầu tiên khi |
|---|---|---|
| A. Trang riêng `/overview` + endpoint riêng (chọn) | Tổ chức dưới khoảng 2 000 lead đang mở | Lead tăng mạnh: phải phân trang phía server |
| B. Mở rộng trang `/` hiện có | Một trang phục vụ được mọi vai trò | Trang đầy nhánh theo vai trò, khó bảo trì |
| C. BI ngoài (Metabase) | Có người vận hành thêm hạ tầng | Thêm hệ thống, thêm đường lộ dữ liệu |

Better approaches: none — hướng được chọn chính là hướng user yêu cầu (đã đối chiếu `scope.ts`, `queries.ts` `dashboard()`, `pipeline.tsx`).

## Thứ tự giao

Giao đủ phạm vi trên, chia hai phase:

1. KPI, kanban, chờ duyệt, sức khỏe bot/Lark.
2. Ma trận nhiệt kèm chuyển phòng ban/team, khối lượng việc theo Sale, nguồn lead, feed audit.

Bước tiếp theo: lập kế hoạch bằng `ak:plan --advice`, rồi chạy `/ak:cook --advice`.

## Câu hỏi còn mở

- Sau này có làm bản giới hạn theo phòng ban cho Head không? Endpoint đã dựng trên `leadScope()` nên mở thêm sẽ rẻ.
- Kỳ mặc định khi mở trang: đang chọn "tháng này".
