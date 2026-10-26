# Rà lỗi LMS và trang video — 18/10/2026

Kết quả: đã sửa 12 lỗi (2 cao, 5 vừa, 5 thấp), kiểm lại bằng test tự động và bấm thử trên Chrome ẩn (bản chạy trên máy). Chưa commit, chưa deploy.

## Cách tìm
- Chạy toàn bộ typecheck, test, build: tất cả đạt ngay từ đầu, nên lỗi chỉ lộ khi dùng thật.
- Bấm thử bằng Chrome ẩn qua DevTools protocol: CRM `/lms-videos` (dán link, xem trước, chọn tay, lưu, đổi tên, xoá) và trang học (đăng nhập, mở bài, chuyển phần, quay lại tab, phiên hết hạn).
- Agent code-reviewer soát code: `code-reviewer-261018-0023-lms-bug-review.md`.

## Đã sửa
| Mức | Lỗi | Sửa |
| --- | --- | --- |
| Cao | Tên lớp dò theo chuỗi con: "BSR-AI-K10" khớp lớp "BSR-AI-K1"; lớp tên "AI" khớp "Bài…" | Dò nguyên từ, gạch nối tính là một phần của mã lớp (`lms-programs.ts` `wholeClassName`); test 7b |
| Cao | Khung cẩm nang tải lại mỗi lần trang lấy lại dữ liệu (link ký mới), người học mất chỗ đang đọc | Giữ link đã tải cho tới khi phiên bản cẩm nang đổi (`program.tsx` `frameSrc`); đã kiểm: quay lại tab không tải lại khung |
| Vừa | Xem trước lần hai lỗi thì bảng cũ vẫn còn, bấm Lưu gửi lựa chọn chưa kiểm | Lỗi xem trước thì xoá bảng |
| Vừa | Giáo viên dán nhiều lớp: mỗi lớp một truy vấn quyền, có thể vượt 50 truy vấn | Giáo viên chỉ dò trong lớp mình dạy, gộp vào truy vấn có sẵn |
| Vừa | Giáo viên thấy tên chương trình, bài học của lớp khác trong bảng xem trước | Cùng cách sửa trên; lớp khác hiện "Không nhận ra lớp"; test 5 |
| Vừa | Phiên hết hạn: trang học báo "Email hoặc mật khẩu không đúng" và không về trang đăng nhập | Máy chủ báo "Phiên đăng nhập đã hết"; mọi lỗi 401 (tải và bấm nút) đưa về `/dang-nhap` và xoá dữ liệu tạm |
| Vừa | Máy dùng chung: người đăng nhập sau thoáng thấy dữ liệu người trước | Đăng nhập xong thì xoá bộ nhớ tạm |
| Thấp | Thẻ chương trình hiện "Tiếp tục: b1p1" | API trả `nextLessonTitle`; thẻ hiện tên phần |
| Thấp | Sau khi lưu, bảng vẫn ghi "Sẵn sàng" và còn ô chọn | Hiện "Đã lưu", ẩn ô chọn |
| Thấp | Dòng tự nhận sai không sửa được trước khi lưu | Mọi dòng có ô chọn phần |
| Thấp | Ô "Chọn chương trình…" ở "Video đã gắn" tự nhảy về lớp đầu | Chỉ tự chọn một lần |
| Thấp | Trùng key React ở menu bài học khi hai nhóm cùng tên | Key gồm thứ tự nhóm |

## Không sửa (lý do)
- Hai người lưu cùng một danh sách đúng cùng lúc có thể tạo video trùng: cần index duy nhất (migration), khả năng xảy ra rất thấp, xoá tay được.
- Biết email học viên thì có thể làm khoá tài khoản 5 phút: đánh đổi đã ghi trong ADR-011; giảm bằng luật WAF theo IP (tuỳ chọn).
- Lo ngại lưu 100 video vượt 50 truy vấn: không đúng — lần nhập 200 học viên trên D1 thật ngày 17/10 ghi khoảng 3.400 dòng trong một batch và chạy được.

## Kiểm lại
- Typecheck 7 gói; test: crm 606 (2 skip), lms 17, lms-core 12, zalo-bridge 114, poc 16; build CRM, LMS — 0 lỗi.
- Chrome ẩn: luồng video CRM, đổi tên, xoá, không lỗi console; trang học: chuyển phần chỉ đổi `#`, quay lại tab không tải lại khung, phiên hết hạn về trang đăng nhập.

## Câu hỏi còn mở
- Đổi mật khẩu băm PBKDF2 hai lần trong một request; chưa đo CPU trên gói Free thật. Cần thử trên hệ thống thật với tài khoản học viên thử.

Status: DONE_WITH_CONCERNS
Summary: Sửa 12 lỗi (2 cao, 5 vừa, 5 thấp) ở trang video CRM và trang học; tất cả test và kiểm tra trình duyệt đạt.
Concerns/Blockers: Đổi mật khẩu trên gói Free chưa đo CPU thật.
