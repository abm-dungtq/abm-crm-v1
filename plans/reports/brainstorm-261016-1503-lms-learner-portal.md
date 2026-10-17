# Brainstorm: Cổng học LMS cho học viên ABM, xác thực bằng CSDL CRM

Ngày 16/10/2026. Chế độ `--advice` (kongming đã soát hướng kiến trúc: GO kèm 2 điều chỉnh).

## Kết quả mong muốn

Học viên đăng nhập một trang học riêng bằng email + mật khẩu mặc định do CRM cấp. Trang chủ liệt kê các chương trình họ được học; mở chương trình thấy từng phần bài học (theo cẩm nang HTML giảng viên làm) và ô "Video bài học" của từng phần, gồm video record Zoom để học lại. Giảng viên làm module, Claude Code trên máy tách phần và đẩy lên LMS.

## Quyết định của user (16/10)

| Mục | Chọn |
|---|---|
| Cách dựng | Cổng học riêng (Worker `abm-lms`), dùng chung D1 `abm-crm-eval` với CRM. Repo LMS mã nguồn mở chỉ dùng tham khảo giao diện. |
| Cấp quyền | Theo ghi danh lớp trong CRM, cộng cấp tay cho trường hợp lẻ. |
| Video | Cloudflare Stream. |
| Mật khẩu | Một mật khẩu mặc định chung; có thông báo nhắc đổi, không bắt buộc đổi. |
| Cấp video | Mỗi phần/mục trong menu cẩm nang (theo `section id`, ví dụ `b1p1`, `b2m3`), mỗi phần gắn được nhiều video. |
| Tên miền | abmedu.vn chưa trên Cloudflare: tạm dùng `*.workers.dev`, đổi tên miền sau. |
| Quên mật khẩu | Học vụ bấm đặt lại về mật khẩu mặc định trong CRM. Không gửi email. |
| Agent đăng bài | Claude Code trên máy (skill/lệnh "đăng bài") gọi API có khóa. Bot Lark để sau nếu cần. |

## Ràng buộc

- Cloudflare gói miễn phí cho Worker/D1 (PBKDF2 50 000 vòng, CPU ~10 ms). Stream là dịch vụ trả phí riêng.
- Chỉ `apps/crm/migrations` sở hữu schema; `abm-lms` không bao giờ chạy migration.
- Học viên dùng bảng và cookie riêng (`learner_account`, `learner_session`), không đụng `app_user`/`user_session` của nhân viên.
- Sao lưu D1 trước mọi migration.

## Hướng thiết kế

- **Dữ liệu (migration mới trong CRM):** `learner_account` (contact_id, email, hash mật khẩu, cờ "nên đổi mật khẩu", khóa tạm sau nhiều lần sai), `learner_session`, `lms_program` (+ phiên bản HTML lưu R2), `lms_lesson` (program, section_id, tiêu đề, thứ tự — agent điền khi đăng), `lms_lesson_video` (lesson, Stream video id hoặc URL, tiêu đề, thứ tự), `class_group_program` (lớp → chương trình), `lms_access` (cấp/thu hồi tay, ai cấp, hạn), `lms_progress` (đã xem phần nào).
- **Quyền xem** = ghi danh lớp có trạng thái `confirmed/studying/completed` gắn chương trình, CỘNG cấp tay, TRỪ thu hồi.
- **Cách ly HTML:** cẩm nang có JavaScript do giảng viên/agent viết, nên phục vụ từ một origin nội dung riêng không có cookie (Worker/domain thứ hai), link ký có hạn ngắn, iframe `sandbox`, CSP chặn gửi dữ liệu ra ngoài (`connect-src 'none'`). Agent chèn một script nhỏ để trang học điều khiển chuyển phần và ghi tiến độ qua `postMessage`.
- **Video:** Stream bật "require signed URLs"; Worker cấp token xem cho học viên có quyền. Record Zoom tải MP4 về rồi đẩy lên Stream (agent làm được).
- **CRM (nhân viên):** Học vụ/Admin cấp tài khoản học viên, đặt lại mật khẩu, gắn chương trình cho lớp, cấp tay, sửa video từng phần.
- **Tái dùng code:** `password.ts`, `session.ts` của CRM (không phụ thuộc gì) đưa vào package chung.

## Trade-offs

- **Cổng riêng + chung D1 (đã chọn):** dựa vào giả định chỉ CRM chạy migration; hỏng đầu tiên khi có người deploy migration từ LMS hoặc khi hai app sửa cùng bảng lệch nhau.
- **Trong CRM (/learn):** hỏng đầu tiên ở chỗ học viên và nhân viên chung origin/cookie, và mỗi lần deploy LMS có thể làm gián đoạn cron hộp thư.
- **Moodle/LearnHouse + đồng bộ:** hỏng đầu tiên ở đồng bộ hai chiều tài khoản/ghi danh và chi phí VPS; cẩm nang HTML không tận dụng được bộ soạn bài của chúng. Chỉ đáng xem lại khi cần SCORM, chấm bài, chứng chỉ.

## Rủi ro user đã chấp nhận hoặc cần biết

- **Mật khẩu chung, không bắt đổi:** ai biết email của một học viên có thể vào tài khoản đó. Giảm nhẹ không thêm rào chắn: khóa tạm sau nhiều lần sai, giới hạn đăng nhập theo email/IP, banner nhắc đổi, Học vụ thấy ai chưa đổi.
- **Stream vs R2:** kongming gợi ý lưu MP4 trên R2 (miễn phí băng thông) để rẻ hơn; user chọn Stream (xem mượt, có token chống chia link). Ước tính: record 3 giờ/buổi ≈ 180 phút lưu; Stream tính khoảng 5 USD/1 000 phút lưu/tháng và 1 USD/1 000 phút xem — cần kiểm giá hiện hành trước khi bật.
- Chưa có tên miền trên Cloudflare: hai Worker `*.workers.dev` khác nhau vẫn là hai origin, nên cách ly vẫn giữ được.

## Ngoài phạm vi

Bài kiểm tra chấm điểm, chứng chỉ, app di động, thanh toán trong LMS, bot Lark đăng bài, gửi email đặt lại mật khẩu.

## Tiêu chí nghiệm thu

1. Học viên được ghi danh lớp có chương trình thì đăng nhập thấy chương trình đó; học viên không có quyền mở link trực tiếp bị từ chối (cả trang, nội dung HTML lẫn video).
2. Đăng nhập bằng mật khẩu mặc định chạy được, có banner nhắc đổi; đổi mật khẩu xong đăng nhập lại bằng mật khẩu mới.
3. Học vụ đặt lại mật khẩu, cấp/thu hồi tay, gắn chương trình cho lớp, thêm/sửa video từng phần trên CRM.
4. Đăng cẩm nang BSR mẫu bằng agent: tạo đủ 27 phần theo `section id`, hiển thị đúng trong iframe; ô video từng phần phát được video Stream.
5. Script trong cẩm nang không đọc được cookie trang học và không gọi được mạng ra ngoài (kiểm thử).
6. Typecheck và test toàn repo xanh; migration chạy trên bản sao lưu trước.

## Repo tham khảo giao diện (không cài đặt)

- LearnHouse (Next.js + FastAPI, AGPL) — giao diện khóa/chương/bài.
- ClassroomIO (SvelteKit + Supabase) — dashboard học viên cho đào tạo doanh nghiệp.
- Frappe LMS (Python) — mô hình khóa → chương → bài.
Không repo nào chạy trên Workers + D1; AGPL nên chỉ tham khảo, không chép mã.

## Bước tiếp theo

`/ak:plan --advice` từ báo cáo này, rồi `/ak:cook`.

## Vòng 2 (16/10 15:38) — chương trình theo lớp, nhập nhân viên doanh nghiệp

Bản HTML có demo giao diện: `brainstorm-261016-1538-lms-class-program-demo.html`.

- **Mỗi lớp một chương trình riêng:** `lms_program.class_id` UNIQUE (cho phép NULL để agent đăng trước khi có lớp). Bỏ bảng `class_group_program`. Thêm lệnh "Nhân bản chương trình từ lớp cũ" (copy phần, dùng chung file HTML R2 bất biến, không copy video, lưu `cloned_from_program_id`).
- **Khối doanh nghiệp:** mở rộng `importContractLearners` (`apps/crm/src/worker/learner-commands.ts`): chọn thêm lớp; mỗi dòng tạo/dùng lại contact, tạo lead `partner` trạng thái won bằng cách ghi thẳng (thêm tuỳ chọn `outcome: 'won'` cho `writeLearnerLead`, không gọi `winLearnerLead`), enrollment `confirmed`, consent `enrollment`, và `learner_account` nếu có email. Giữ `enrollment.lead_id` NOT NULL.
- **Trùng:** tìm theo SĐT và email trong một truy vấn; đã có tài khoản thì chỉ thêm lớp, không đặt lại mật khẩu; email khác tài khoản cũ thì gắn cờ, không tạo tài khoản; khách đang được Sale khác giữ không chặn nhập theo hợp đồng; lead học viên đang mở vẫn chặn như hiện tại.
- **Mật khẩu mặc định không băm từng người:** `learner_account.password_hash NULL` nghĩa là dùng mật khẩu mặc định, so với một bản băm duy nhất lưu ở `org_setting`; đặt lại = đặt NULL. Tránh 200 lần PBKDF2 (~2 s) khi nhập. Đo lô 200 dòng trên eval; nếu chậm hạ giới hạn lệnh này xuống 100.
- Kongming: GO với các điều chỉnh trên.

Câu hỏi mở: nhân bản có copy video không (đề xuất: không); học viên đối tác có lọc khỏi báo cáo Sale không (đề xuất: lọc theo nguồn `partner`); sau khi lớp kết thúc còn xem lại bao lâu.

### Trả lời câu hỏi mở vòng 2 (16/10 15:57)

1. Nhân bản chương trình sang lớp mới **không** chép video.
2. Học viên đối tác (lead `partner` won do nhập file) được **lọc khỏi báo cáo Sale** theo nguồn `partner`.
3. Thời gian xem lại sau khi lớp kết thúc **đặt trong CRM theo từng chương trình**: thêm trường `lms_program.review_days` (số ngày; để trống = không giới hạn), sửa ở tab "Chương trình học online" của lớp. Mốc "lớp kết thúc" = buổi học cuối cùng (`class_session` không bị huỷ, `starts_at` lớn nhất) của lớp; hết hạn thì học viên vẫn thấy thẻ chương trình nhưng ở trạng thái "Đã hết hạn xem lại", không mở được nội dung và video. Cấp tay (`lms_access.expires_at`) vẫn có thể gia hạn riêng cho từng người.

Không còn câu hỏi mở. Bước tiếp theo: `/ak:plan --advice`.
