# Kế hoạch backup và restore

Mục tiêu user: RPO ≤ 1 giờ, RTO ≤ 4 giờ; backup giữ 30 ngày, audit ≥ 5 năm, dữ liệu CRM tới khi Admin ẩn danh theo yêu cầu, GoClaw session/memory 90 ngày theo [QĐ5](../decisions/business-decisions-v1.md). Đây là kế hoạch, chưa có drill chứng minh SLA. Audit retention khác backup retention; không xóa audit sau 30 ngày.

## Nguồn phục hồi

| Thành phần | Cơ chế | Kiểm tra / retention |
| --- | --- | --- |
| D1 | Time Travel point-in-time cho RPO ≤ 1 giờ; export hằng ngày bằng `wrangler d1 export <binding> --env <env> --remote --output <protected-file.sql>`, upload R2 private | Kiểm restore point/timestamp và checksum export; daily export không tự đạt RPO 1 giờ |
| Export backups | Key riêng env/ngày/revision trong R2 private; manifest schema/bookmark/checksum | Giữ 30 ngày, cleanup chỉ backup prefix; file local SQL protected và không commit |
| File R2 | Versioning cấp ứng dụng: immutable key theo file ID/version + metadata/checksum; không overwrite version cũ | Không có native R2 bucket versioning; bảo toàn reference/version, kiểm download/hash sau restore; file ngoài CRM chưa có retention riêng được duyệt |
| Config/code | Version trong Git và deploy record, binding metadata không secret | Backup trước đổi config/schema; restore đúng schema/code/config compatibility |
| Secrets | Cloudflare secrets + kho mật khẩu của user | Kiểm nguồn khôi phục và quyền truy cập, rotate sau incident; không export vào SQL/log/repo |
| GoClaw | `pg_dump` theo runbook GoClaw, config/patch/channel metadata và secret handling riêng | User admin duy nhất; backup trước thay đổi, không dump/in secrets trong report; session 90 ngày không đồng nghĩa backup 90 ngày |

[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) hiện có window 7 ngày Free, 30 ngày Paid. Muốn PITR đủ 30 ngày cần plan thích hợp; export 30 ngày là tầng backup riêng. Phase 05 kiểm window/restore trên account thật, chưa tự mua plan hay tạo remote. [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/) không hỗ trợ GetBucketVersioning/PutBucketVersioning; coordinator cho dùng immutable keys + metadata để đạt file version recovery. Metadata nằm D1 cần export/restore nhất quán với object inventory; không coi ETag là checksum nội dung chung cho multipart.

Lịch daily export phải được tự động hóa trên Cloudflare ở bước vận hành (API/Workflows có thể thay CLI runner sau review), có cảnh báo thiếu/failed export và kiểm integrity; phase này không giả job đang chạy. Quyền xóa/version file thật cần giữ theo CRM policy, không tự áp lifecycle backup 30 ngày cho tất cả file. Runbook GoClaw thuộc phase 08; trước khi có runbook không chạy lệnh pg_dump/restore suy đoán tại production.

## Checklist khôi phục (budget RTO 4 giờ)

1. Trong 30 phút: Admin/user xác nhận incident, env, recovery point và quyền thực hiện. Bật agent kill switch, dừng dispatcher/queue consumer/cron ghi ngoài để tránh side effects; maintenance cho command ghi người dùng, giữ đọc an toàn nếu có thể. Ghi thời điểm và correlation IDs, không log secret.
2. Trong 30 phút tiếp: backup trạng thái hiện tại trước restore/schema/data change; lưu bookmark/export, object inventory, config/version và delivery ledger độc lập. Ledger sau recovery point không được mất cùng DB rollback: snapshot trước restore và đối chiếu log nhà cung cấp trước resume.
3. Trong 60 phút tiếp: user duyệt Time Travel bookmark/timestamp rồi restore D1 theo [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/). Nếu ngoài window dùng export đã kiểm vào database đích được duyệt; không nhập nhầm production, không chạy placeholder. Chọn code/schema/config tương thích, không coi Worker rollback là DB restore.
4. Trong 30 phút tiếp: khôi phục metadata/file version references từ inventory, verify checksum/object access và secrets; GoClaw chỉ restore theo runbook/consent nếu incident liên quan GoClaw, CRM phục hồi không phụ thuộc GoClaw online.
5. Trong 60 phút tiếp: test auth/RBAC, record counts/invariants, version/guard, audit liên tục và idempotency. Đối soát outbox với delivery ledger snapshot/provider acknowledgement: sent không gửi lại; uncertain quarantine, người có quyền xác minh; pending chỉ retry cùng key/payload sau kiểm destination/approval/quyền hiện tại. Queues là at-least-once, không tuyên bố exactly-once bên ngoài.
6. Trong 30 phút cuối: Admin chấp thuận reopen, bật consumer/cron/dispatcher lần lượt, theo dõi backlog/lỗi rồi kết thúc maintenance. Kill switch agent chỉ tắt sau kiểm quyền/identity. Ghi actual data loss (RPO) và elapsed time (RTO), checksum/test/outbox reconciliation, người xác nhận và follow-up; vượt SLA là fail cần xử lý, không sửa báo cáo thành pass.

## Drill và trách nhiệm

Admin sở hữu CRM recovery; user duy nhất sở hữu GoClaw. Mỗi bậc MVP0–5 có restore drill staging và báo cáo pass/fail, gồm Time Travel/export fallback/file/config/secrets access và outbox reconciliation. Trước drill có backup, remote restore/resource và downtime cần user duyệt. Phase 05 chứng minh D1 remote; phase 06 kiểm CRM khi GoClaw down; phase 08 hoàn thiện runbook. Tài liệu không thay bằng chứng thực hiện.
