# Ảnh trong Inbox: hiện ảnh khách gửi, nhân viên gửi ảnh, menu dễ đọc

Status: in progress · Owner: Opus (giám sát) · Executors: Gemini 4 Argon (giao diện + soát code), Grok 4.7 (Worker + bridge)

## Mục tiêu
1. Menu trái tối dễ đọc: chữ menu và chữ phụ đạt tương phản ≥ 4.5:1 trên nền tối. Giữ hướng 3 (nền tối).
2. Ảnh khách gửi (Zalo OA, Zalo cá nhân, Facebook) hiện thẳng trong khung chat. Bấm vào để xem lớn. Ẩn chữ "[Hình ảnh]" / "[Tệp đính kèm]" khi đã có ảnh.
3. Nhân viên gửi ảnh cho khách bằng nút (+) hoặc dán ảnh (Ctrl+V) vào ô chat, có xem trước và gửi kèm chữ tùy chọn. Kênh: Zalo OA và Zalo cá nhân.

## Quyết định của owner (15/10)
- Ảnh nhân viên gửi lưu vĩnh viễn trong R2 riêng tư `abm-crm-media`. Chỉ người đăng nhập CRM xem được.
- Facebook gửi ảnh: chưa làm vì chưa kết nối kênh Facebook nào.
- Opus giám sát kỹ code của Grok; Gemini soát code song song.

## Ràng buộc
- Ảnh được nén trên trình duyệt thành JPEG ≤ 1 MB trước khi tải lên. Zalo OA chỉ nhận jpg/png ≤ 1 MB.
- Ảnh khách gửi giữ nguyên đường dẫn CDN Zalo/Facebook; không chép về R2. Đã kiểm 15/10: ảnh từ 07/10 vẫn mở được.
- Tin ảnh không được tạo bản sao khi Zalo gửi lại sự kiện "echo" của chính tin mình gửi.
- Thứ tự triển khai: tạo bucket R2 → Worker + UI → khởi động lại bridge.

## Phase
| # | Việc | Người làm | File được sửa | Trạng thái |
|---|------|-----------|---------------|------------|
| A | Menu tương phản + ảnh trong bong bóng chat + xem lớn | Gemini | `src/web/styles.css`, `src/web/components/inbox-thread.tsx` (chỉ phần hiển thị tin), `src/web/components/ui.tsx` | xong 15/10, Opus đã soát diff; báo cáo `plans/reports/agy-261015-inbox-images-a-ui.md` |
| B | R2, tải ảnh lên, phục vụ ảnh, gửi ảnh OA + Zalo cá nhân, echo, test | Grok | `wrangler.jsonc`, `src/worker/**`, `packages/contracts`, `apps/zalo-bridge/**`, test | xong 15/10; đã sửa 5 lỗi từ soát code |
| C | Ô chat: nút (+), dán ảnh, nén, xem trước, gửi | Gemini | `src/web/**` | xong 15/10; Opus sửa ảnh của tin đang gửi |
| R | Soát code B (Gemini + Opus), chụp màn hình, test thật trên eval | Opus | — | soát xong (`plans/reports/agy-261015-inbox-images-review-b.md`); đã deploy eval bản `eb36c491`, cầu nối Zalo đã khởi động lại; chờ owner gửi ảnh thật |

## Triển khai 15/10
- Bucket R2 `abm-crm-media` đã tạo (riêng tư).
- Worker + giao diện: bản `eb36c491-35ea-4e32-bec2-e0ad6005e625`. Không có migration.
- Cầu nối Zalo đã khởi động lại qua Task Scheduler.
- Đã kiểm: `/api/inbox/media/*` và `/api/bridge/media` trả 401 khi chưa đăng nhập hoặc không có chữ ký.
- Lỗi poll 500 của cầu nối (14/10) chưa rõ nguyên nhân. Token wrangler không có quyền đọc Workers Logs; cần xem trên dashboard Cloudflare.

Brief: `%TEMP%\grok-crm\task-inbox-images-*.md`.

## Tiêu chí nghiệm thu
1. Menu: chữ đọc rõ; ảnh chụp màn hình được soát.
2. Ảnh khách gửi hiện ảnh thu nhỏ trong khung chat; ảnh lỗi thì hiện liên kết "Mở ảnh".
3. Nhân viên gửi ảnh qua Zalo OA và Zalo cá nhân thành công trên eval; khách nhận đúng ảnh; CRM hiện ảnh đã gửi đúng một lần.
4. `pnpm -F @abm/crm typecheck/test/build` và `pnpm -F @abm/zalo-bridge typecheck/test` đều đạt.
