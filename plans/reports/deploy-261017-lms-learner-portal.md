# Triển khai cổng học viên LMS — 17/10/2026

Kết quả: CRM, trang học và Worker nội dung đã chạy trên Cloudflare; học viên thử đăng nhập và học cẩm nang BSR (26 phần) trên trình duyệt. Phần video chờ bật Cloudflare Stream.

## Đã làm
- Kiểm tra local: typecheck 0 lỗi; build CRM và LMS; test lms-core 12, lms 17, crm 597 (2 skip), zalo-bridge 114, poc 16, script cẩm nang 3 — 0 lỗi.
- Commit: `06c06f1`, `5372a53`, `f2bb527`, `e92d997`, `40cd9bc`, `7af4fbc`.
- Sao lưu D1: `exports/abm-crm-eval-before-0024-20261017.sql` (1,1 MB) và bookmark Time Travel `000000c0-0000073c-00005107-7a1ed7a2ce6d9f136c7b688d0e50365f`.
- Migration `0024_lms.sql` đã chạy remote; 7 bảng LMS có mặt.
- R2 `abm-lms-content` đã tạo.
- `CONTENT_SIGNING_SECRET` đặt trên ba Worker (giá trị không in, lưu `~/.abm/content-signing-secret`).
- Deploy: `abm-lms-content` `77062489`, `abm-lms` `6706a022`, `abm-crm-eval` `ff45f591` (bản trước khi phát hành: `72f531e1`).

## Kiểm tra sống
- `/api/me` không cookie → 401; link nội dung sai chữ ký → 403; link đổi sang chương trình khác → 403; `/api/lms-publish` không token → 401.
- Dữ liệu thử tạo bằng lệnh CRM thật qua phiên Admin tạm (đã thu hồi ngay sau đó): mật khẩu mặc định học viên, lớp "BSR-AI-K1 (thử)" (`55025e8d-523e-43bd-9c2d-6e6179ea9465`), hợp đồng "HĐ thử cổng học" của "BSR (thử LMS)", nhập 1 học viên `dntu85@gmail.com` → 1 tài khoản mới, ghi danh confirmed.
- Token đăng bài cấp cho `dungtq.ceo@gmail.com` (lưu `~/.abm/lms-publish-token`). Đăng cẩm nang BSR → chương trình `4f9dea8d-5f0c-4934-bb90-bc309fb49800`, phiên bản 1, 26 phần.
- Trình duyệt: đăng nhập bằng mật khẩu mặc định → banner nhắc đổi, thẻ chương trình 0/26; trang bài học mở đúng phần `b2m1`, chuyển phần qua menu, ô "Video bài học" hiện "Chưa có video". Nội dung trả CSP `connect-src 'none'`, không có `Set-Cookie`. Ảnh: `assets/lms-release/`.

## Nhập thử 200 dòng (17/10 14:01, user đồng ý)
- Sao lưu trước: `exports/abm-crm-eval-before-import200-20261017.sql`, bookmark `000000c2-000000ee-00005107-4360a81ab6d4b96c4e5955fc2516b5b4`.
- Lớp "LMS-200 (thử nhập)", file `apps/crm/seed/import-200-learners-sample.csv`: xem trước 238 ms, ghi 1.042 ms, 200 tài khoản mới, 0 lỗi. Không chạm giới hạn 50 truy vấn của gói Free, không cần chia nhỏ.
- Đã xoá hết dữ liệu thử theo mã giao dịch: 200 contact, 400 contact_point, 200 lead, 1.600 lead_step, 200 enrollment, 200 consent, 200 learner_account, 400 activity, audit, idempotency, lớp, hợp đồng, khách hàng. Kiểm lại còn 0 dòng; `PRAGMA foreign_key_check` rỗng. Bộ đếm mã lead đã tăng 200 (mã lead mới sẽ nhảy số).

## Chưa làm
- Video: chờ bật Stream, token Stream, account id, signing key, customer code.
- Đổi mật khẩu, hết hạn xem lại, màn hình CRM theo từng vai: đã có test tự động; chưa thử tay trên hệ thống thật.
- Tuỳ chọn: luật WAF giới hạn đăng nhập theo IP.

## Rollback
- Worker: `npx wrangler rollback 72f531e1-4a47-4761-820d-e3e33965da60` (cwd `apps/crm`); xoá `abm-lms`, `abm-lms-content` nếu cần.
- D1: migration chỉ thêm bảng/cột; khôi phục dữ liệu bằng bookmark trên (mất mọi thay đổi sau thời điểm đó) — phải hỏi user.

## Ghi chú
- Lần thử đăng nhập đầu trên trình duyệt sai vì bộ gõ tiếng Việt làm sai email (1 lần đếm sai, không ảnh hưởng).
- Thẻ chương trình hiện "Tiếp tục: b1p1" (mã phần), nên đổi sang tên phần.

Status: DONE_WITH_CONCERNS
