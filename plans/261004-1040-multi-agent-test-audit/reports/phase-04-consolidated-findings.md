# Tổng hợp lỗi — kiểm thử đa chiều CRM

Ngày 2026-10-04. Coordinator tổng hợp theo yêu cầu user ("dừng đi tổng hợp bug rồi /ak:fix"), thay cho phase 04 bằng worker riêng. Phase 03 dừng sớm theo lệnh user; phần chưa kiểm ghi trong báo cáo phase 03.

Nguồn: [phase 01](phase-01-domain-api-correctness.md) (Claude, D-xx), [phase 02](phase-02-security-data-integrity.md) (Codex, S-xx), [phase 03](phase-03-ui-e2e-accessibility.md) (Antigravity, U-xx).

## Kết quả

31 phát hiện, gộp còn 30 lỗi riêng biệt (D-09 trùng S-06). Không có critical. 3 high: D-01, S-01, S-02. Bằng chứng tái hiện của D/S là probe Vitest trong báo cáo gốc; U là bước thao tác + ảnh ngoài repo. Trạng thái "đã tái hiện" ở bảng dưới là do agent phát hiện tự chạy; coordinator kiểm lại khi sửa (test hồi quy phải đỏ trước khi sửa).

## Bảng hợp nhất

| ID | Mức | Vùng | Lỗi | Hướng xử lý | Cần quyết định |
|---|---|---|---|---|---|
| D-01 | high | test | Test nhả lead tự đỏ từ 06/10 14:29 vì seed có mốc tuyệt đối | Đặt `assigned_at` tương đối trong test | — |
| S-01 | high | quyền | Audit (quyền PROPOSED) đang bật cho Leader/Head/BGĐ/Admin, trái ma trận quyền | Theo quyết định | Có |
| S-02 | high | quyền | DUPLICATE_SUSPECTED lộ mã lead, stage, owner ngoài phạm vi | Chi tiết chỉ cho lead trong scope; ngoài scope chỉ báo "đã có trong hệ thống" | — |
| S-03 | medium | idempotency | Cùng key khác actor không conflict theo ADR-003/005 | Theo quyết định (đổi khoá thành key toàn org cần migration) | Có |
| S-04 | medium | idempotency | Replay trả kết quả cũ dù actor đã mất quyền target | Kiểm lại quyền target trước khi trả replay | — |
| S-06 / D-09 | medium | quyền | `listAccounts.owners` lộ tên owner ngoài phạm vi | Áp `leadScope` cho subquery | — |
| S-07 | medium | ghi đồng thời | Hai yêu cầu chuyển owner song song tạo hai approval pending | Guard trong batch: chỉ một pending/lead | — |
| S-09 | medium | quyền | Owner tự duyệt đề xuất Lost/Won của agent | Lost/Won chỉ Leader đúng team (action-risk matrix) | — |
| D-02 | medium | tìm kiếm | Truy vấn có chữ số khớp mọi phone chứa các chữ số đó | Chỉ so phone khi truy vấn giống số điện thoại | — |
| D-03 | medium | tìm kiếm | Không tìm được chữ hoa có dấu; không chuẩn hoá `+84` | So khớp sau chuẩn hoá Unicode phía Worker; dùng `normalizePhone` | — |
| D-04 | medium | kiểm trùng | Tên công ty khác hoa/thường có dấu hoặc thừa khoảng trắng không bị bắt | So tên đã chuẩn hoá | — |
| D-05 | medium | đầu vào | Phone không có chữ số vẫn tạo lead không có kênh liên hệ | Zod: phone phải có ≥ 9 chữ số | — |
| D-06 | medium | nghiệp vụ | `occurredAt` ghi lùi không giới hạn, làm đẹp SLA liên hệ | Theo quyết định | Có |
| D-07 | medium | nghiệp vụ | Won không cần giá trị/bằng chứng | Theo quyết định (chưa có đường ghi giá trị, D-12) | Có |
| U-01 | medium | a11y | Drawer mobile đóng vẫn nhận Tab | `inert`/`visibility:hidden` khi đóng | — |
| U-05 | medium | quyền UI | Admin vào `/leads`, `/leads/new` bằng URL | Chặn route nghiệp vụ cho Admin, chuyển về `/admin` | — |
| D-08 | low | nghiệp vụ | Hoàn thành task không phải Next Action kèm `nextAction` để lại Next Action cũ mồ côi | Huỷ Next Action cũ hoặc không đổi con trỏ | — |
| D-10 | low | đầu vào | MST không kèm tên công ty bị bỏ im lặng | Báo lỗi validate | — |
| D-11 | low | kiểm trùng | `0084…` không chuẩn hoá | `normalizePhone` xử lý tiền tố `00` | — |
| D-12 | low | dữ liệu | Không có đường ghi `expected_value`, schema không CHECK | Gắn với D-07 | Có |
| D-13 | low | duyệt | Approval chưa có hết hạn và payload hash | Đề xuất hoãn MVP1 | Có |
| S-05 | low | đầu vào | Trường lạ bị bỏ qua thay vì từ chối | Theo quyết định (strict có thể làm vỡ client gửi thừa) | Có |
| S-08 | low | schema | DB chỉ kiểm next action non-null, không kiểm task tồn tại/mở | Đề xuất hoãn (cần migration D1 remote) | Có |
| S-10 | low | đầu vào | Từ khoá tìm kiếm rất dài gây 500 | Giới hạn độ dài `q` → 422 | — |
| U-02 | low | a11y | Drawer mobile không đóng bằng Esc | Thêm phím Esc | — |
| U-03 | low | UI | Hai nút "Tạo lead" trên mobile `/leads` | Ẩn nút trong page-head ở mobile | — |
| U-04 | low | UI | Tiêu đề cột kanban bị cắt ở mép phải mobile | Cột hẹp hơn để thấy rõ cột kế hoặc cắt chữ có dấu … | — |
| U-06 | low | UI | Ngày giờ không có năm (audit cần ≥ 5 năm) | Hiện năm khi khác năm hiện tại; audit luôn có năm | — |
| U-07 | low | a11y | Tiêu đề bảng tương phản 4.45:1 < 4.5:1 | Đậm màu `th` | — |
| U-08 | low | UI | Trang audit 403 vẫn hiện bộ lọc và banner | Ẩn công cụ khi lỗi quyền | — |

## Quyết định của user (2026-10-04 11:43)

- S-01: duyệt quyền audit đang có — Leader theo team, Trưởng phòng theo phòng, BGĐ toàn công ty; Admin không xem audit nghiệp vụ. Cập nhật ma trận quyền, bỏ banner PROPOSED.
- D-06: thời điểm hoạt động không sớm hơn lúc tạo/giao lead và không quá 7 ngày trước hiện tại.
- D-07/D-12: Won bắt buộc giá trị chốt (số nguyên đồng > 0) và ghi chú bằng chứng, lưu vào lead.
- S-08, D-13: hoãn MVP1, ghi vào phần rút gọn có chủ đích.
- S-03, S-05: không chọn sửa → giữ hành vi hiện tại (key idempotency theo từng actor; trường lạ bị bỏ qua). Ghi là sai lệch đã chấp nhận so với ADR-003/005.
- Sau khi sửa và test pass: redeploy Cloudflare.

## Vùng chưa kiểm

UI: bấm Won/Lost và duyệt stale trên giao diện (dừng sớm). Chung: lịch nghỉ lễ, remote concurrency/restore, Access/Lark/MCP, kill switch, agent write — chưa có trong bản đánh giá.

## Ghi chú chất lượng test mới

Phase 01 và 02 thêm 90 test, đều pass trên mã hiện tại và đã chạy chung 110/110. Fixture thời gian của test mới tính tương đối so với now. Chưa có mutation testing.
