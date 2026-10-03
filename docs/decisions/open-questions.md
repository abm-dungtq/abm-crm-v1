# Câu hỏi chốt decision pack MVP0

Ngày soạn: 2026-10-03. User ABM đã trả lời và duyệt ngày 2026-10-03 qua coordinator (message msg_c6264a19d1a1). Đề xuất mặc định dưới đây được giữ làm lịch sử; câu trả lời mới là quyết định có hiệu lực. Xem [decision pack](business-decisions-v1.md) để duyệt nội dung đầy đủ, gồm Stage Definition, Handover Schema và Entitlement Model v0.

1. [Q] QĐ1: User duyệt danh sách Lost reason và Stage Definition v0 không; SLA cụ thể cho từng stage là bao nhiêu, tính theo giờ làm việc hay giờ liên tục, nhắc ai và lúc nào?
   Đề xuất mặc định: Dùng danh sách Lost reason PRD 10.6 và bảng Stage Definition QĐ1; Khác cần giải thích. Số giờ từng stage chờ user, không tự đặt.
   Trả lời: Duyệt danh sách PRD 10.6 và Stage Definition v0. SLA ngày làm việc: Đã liên hệ 3, Tiềm năng 7, Tư vấn 7, Báo giá 5, Đàm phán 10, Chờ chốt 7. Quá hạn nhắc Owner rồi Leader.

2. [Q] QĐ4: First contact SLA và ngưỡng nhả lead là bao nhiêu giờ; ai thực hiện nhả, có cần duyệt, và thời gian ngoài giờ làm việc tính thế nào?
   Đề xuất mặc định: Nhắc Owner/Leader khi quá SLA; nhả về hàng chờ theo quy tắc user duyệt, giữ audit; số giờ chờ user.
   Trả lời: First contact 4 giờ làm việc; nhắc Owner và báo Leader khi quá hạn. Sau 24 giờ làm việc chưa liên hệ, Leader quyết định nhả về hàng chờ phòng ban; audit được giữ. Giờ làm việc 08:00–17:30 Asia/Ho_Chi_Minh.

3. [Q] QĐ2–QĐ3: User duyệt Account tách Organization, Contact liên kết 0..n Account, Lead intake/Deal qualified, Customer 360 là view và quy tắc duplicate không?
   Đề xuất mặc định: Duyệt nội dung QĐ2–QĐ3; phone/email là tín hiệu, mã số thuế unique khi có, channel identity unique trong namespace; nghi trùng không tự merge/xóa.
   Trả lời: Duyệt QĐ2 và QĐ3 như đề xuất.

4. [Q] QĐ4: Chuyển owner do Leader duyệt yêu cầu của Sale hay chỉ Leader trực tiếp thực hiện; ai sở hữu Contact/Account khi có nhiều Deal và ai duyệt phân lại khi Sale nghỉ?
   Đề xuất mặc định: Leader duyệt chuyển owner; Leader phân lại khi Sale nghỉ và ghi audit; Support chỉ xem/ghi hoạt động, không đổi stage. Owner Contact/Account chờ user xác nhận.
   Trả lời: Sale yêu cầu, Leader duyệt chuyển owner. Leader phân lại hàng loạt khi Sale nghỉ, có audit. Support chỉ xem và ghi hoạt động. Owner Contact/Account là owner Deal active gần nhất; Leader xử lý xung đột.

5. [Q] QĐ5/QĐ14: Danh sách phòng ban, nhóm Lark tương ứng và Leader mỗi phòng là gì; user duyệt phạm vi vai trò web theo QĐ5 để phase 04 lập ma trận quyền không?
   Đề xuất mặc định: Một nhóm Lark tương ứng một phòng ban theo quyết định đã chốt; web Sale Own/Assigned, Leader Team, Head Department, BGĐ Organization, Admin cấu hình; danh sách tên và người thật chờ user.
   Trả lời: Duyệt scope như đề xuất. Phòng ban/nhóm Lark/Leader: chờ danh sách — nộp trước khi lập plan MVP1; user xác nhận không chặn MVP0.

6. [Q] QĐ11: Nguồn Notion/Sheet/Zalo nào cần migrate MVP1 và nguồn nào chỉ archive/read-only; owner, loại dữ liệu, khoảng thời gian và thời điểm cutover cho từng nguồn là gì?
   Đề xuất mặc định: Customer + Pipeline + Follow-up active trước; lịch sử chưa chọn archive/read-only, tài liệu/SOP/knowledge giữ Notion/Drive. Lark Base không có dữ liệu cần migrate đã chốt. Không migrate dữ liệu thật trong MVP0.
   Trả lời: MVP1 chỉ migrate khách hàng active và pipeline active từ Google Sheet. Lịch sử, Notion và Zalo archive/read-only.

7. [Q] User chọn thời hạn lưu audit và dữ liệu CRM, chat/reference, file, session/memory và backup thế nào; ai được sửa/xóa/ẩn danh và ai duyệt export?
   Đề xuất mặc định: Audit tối thiểu 2 năm; retention các loại còn lại và quyền xử lý chờ user. RPO ≤ 1 giờ/RTO ≤ 4 giờ đã chốt, không đồng nghĩa thời hạn retention đã chốt.
   Trả lời: Audit ≥ 5 năm. Dữ liệu CRM giữ đến khi Admin ẩn danh theo yêu cầu. Session/memory GoClaw 90 ngày; backup 30 ngày. Chỉ Admin xóa/ẩn danh; BGĐ duyệt export. Không có thời hạn riêng được nêu cho chat nguồn/file ngoài CRM.

8. [Q] QĐ6: User cung cấp một sản phẩm thật (mã, tên, loại, giá/tiền tệ, version, hiệu lực) và quyền lợi mẫu (beneficiary, type, số lượng, start/due/expiry, owner, điều kiện thanh toán) nào; có duyệt Entitlement Model v0 không?
   Đề xuất mặc định: Template version gắn Product và OrderLine snapshot; sinh một lần khi payment đạt điều kiện theo sản phẩm, dùng trạng thái PRD 15. Không tự tạo sản phẩm, giá hay ngưỡng thanh toán.
   Trả lời: Duyệt Entitlement Model v0. Mẫu sản phẩm và quyền lợi thật bổ sung trước khi lập plan MVP2; user cho phép exit gate ghi ĐẠT — chốt chi tiết trước MVP2. Không tạo mẫu giả.

9. [Q] QĐ12/QĐ14: Trong Facebook, Zalo, Website, Landing Page, Form, Email, Event, Webinar, Offline, Partner, Referral, Sale Self-Sourced, Import, API, nguồn nào đang dùng; duyệt Leader phân thủ công hay cần Round Robin ở MVP1?
   Đề xuất mặc định: Lead vào hàng chờ phòng ban và Leader phân thủ công; Round Robin chưa bật; chỉ active các nguồn user xác nhận.
   Trả lời: Active: Facebook, Zalo, Website, Landing Page, Form, Referral, Partner, Sale Self-Sourced. Các nguồn còn lại inactive. Hàng chờ phòng ban, Leader phân thủ công; Round Robin tắt ở MVP1.

10. [Q] QĐ7: User duyệt từng trường mandatory/conditional Handover v0 không; ai duyệt ngoại lệ và Change Request sau Complete?
    Đề xuất mặc định: Dùng bảng QĐ7, chặn Complete khi thiếu mandatory; sau Complete ghi old/new value, requester, approver khi cần, timestamp, reason. Người duyệt chờ user xác nhận.
    Trả lời: Duyệt Handover v0 như đề xuất; Leader phòng ban duyệt ngoại lệ và Change Request sau Complete. Chi tiết hoàn thiện trước MVP2.

11. [Q] QĐ13: User duyệt bắt buộc Owner + Next Action + Deadline và tạo Next Action mới cùng thao tác khi hoàn thành không; ngoại lệ tạm hoãn cần ai duyệt?
    Đề xuất mặc định: Active luôn có việc tiếp; Won/Lost không bắt buộc; tạm hoãn có lý do và ngày mở lại; NextAction trỏ Task chung.
    Trả lời: Duyệt QĐ13. Tạm hoãn có lý do và ngày mở lại, Leader duyệt.

12. [Q] QĐ9: User xác nhận bảng Write Master, cách giữ reference và cutover theo inventory QĐ11; có nguồn nghiệp vụ nào khác cần ghi rõ không?
    Đề xuất mặc định: Giữ nguyên SoR của thiết kế và nguồn MISA/Lark đã chốt; Program/CS dùng hệ cũ trước verified cutover, không multi-master.
    Trả lời: Xác nhận bảng SoR, không có nguồn nghiệp vụ bổ sung.

13. [Q] Sau khi trả lời các mục trên, user có phê duyệt decision pack QĐ1–QĐ9/QĐ11–QĐ14 không; tên người phê duyệt và ngày xác nhận là gì?
    Đề xuất mặc định: Chỉ ghi phê duyệt sau câu trả lời thật, không tự điền danh tính hoặc ngày; QĐ10 chờ ADR phase 04. Ma trận quyền chi tiết cần phê duyệt riêng ở phase 04.
    Trả lời: Đã duyệt bởi user ABM ngày 2026-10-03 cho QĐ1–QĐ9/QĐ11–QĐ14. QĐ10 chờ ADR phase 04; ma trận chi tiết phase 04 còn phải tạo.
