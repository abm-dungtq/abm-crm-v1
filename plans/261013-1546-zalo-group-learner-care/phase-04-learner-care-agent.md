# Phase 4: Agent `cham-soc-hoc-vien` và bộ kiến thức

Người làm: Opus, ở thư mục ngoài repo `D:\Goclaw\plans\261013-cham-soc-hoc-vien\`. User đã đồng ý tạo agent mới. Bộ kiến thức chỉ được nạp sau khi user duyệt.

## Bước

### 4.1 Soạn bộ kiến thức nháp

- Nguồn:
  - bộ v8 (`exports/bo-nap-chatbot-v8/`): phần khoá học, công cụ, cách thực hành, câu hỏi thường gặp về học tập;
  - dữ liệu khoá học trong CRM eval (bảng khoá, lớp, buổi học), chỉ lấy tên khoá và lịch chung;
  - bản dựng `out/` của `sale-tu-van` để giữ giọng văn của Long.
- Loại bỏ hoàn toàn: giá, cọc, số tài khoản, khuyến mãi, chính sách hoàn tiền. Dữ liệu cá nhân học viên cũng không đưa vào.
- Kiểm: `Select-String` trên các file nháp không được khớp các mẫu sau:
  - `STK`;
  - số tài khoản MB;
  - `VNĐ` hoặc `đ` đứng sau một số;
  - `cọc`;
  - `chuyển khoản`.

### 4.2 Phần vận hành nhóm (SOUL)

- Long là "chuyên viên hỗ trợ kĩ thuật của ABM, sẵn sàng hỗ trợ anh chị trong quá trình học tập và thực hành".
- Mỗi tin có dòng `[Nhóm Zalo "…"] Tên: nội dung`, có thể kèm dòng `[Hồ sơ Zalo của khách: …]`. Long gọi người hỏi theo giới tính và tên. Không cần chào lại khi người hỏi đã quen.
- Trả lời ngắn, văn bản thuần, đúng chính tả. Không Markdown.
- Không nhắc tới số tiền, số tài khoản hay thông tin cá nhân trong nhóm. Ai hỏi học phí thì mời "anh/chị nhắn riêng cho Long nhé".
- Câu cần người thật (lịch, link lớp, đổi lớp, khiếu nại, lỗi tài khoản, câu chưa có trong kiến thức):
  - Long nói tự nhiên, ví dụ "Long ghi nhận rồi, sẽ phản hồi anh/chị sớm".
  - Kết thúc bằng dòng `[HANDOFF: lý do]`.
  - Không nói "chuyển nhân viên".
- Nếu A.I không chắc, nói không chắc. Không bịa link hay lịch.
- Ghi đè kịch bản làm quen của GoClaw: không hỏi khu vực, múi giờ hay ngôn ngữ.

### 4.3 Tạo agent và nạp

- Sao lưu danh sách agent hiện tại vào `D:\Goclaw\backups\`.
- Tạo agent `cham-soc-hoc-vien`, provider và model `deepseek-flash`, không gắn tool. Script và RPC theo mẫu `D:\Goclaw\plans\261013-sale-tu-van-kb\` (`goclaw-rpc.mjs`, `apply-kb-v8.mjs`).
- Gửi user bản tóm tắt bộ kiến thức nháp. Chỉ chạy `--apply` sau khi user duyệt.

### 4.4 Thử

- Chạy khoảng 15 ca, mỗi ca dùng một user thử riêng; phiên thử bị xoá sau khi chạy. Các ca gồm:
  - hỏi cách dùng công cụ;
  - lỗi khi thực hành;
  - hỏi lịch học (phải HANDOFF);
  - hỏi học phí (mời nhắn riêng, không có số);
  - người hỏi có hồ sơ là nữ (gọi "chị");
  - tin không có tên;
  - câu ngoài phạm vi.
- Đạt khi: không ca nào có Markdown, số tiền, STK hoặc "chuyển nhân viên"; ca lịch học có HANDOFF.

## Rollback

Xoá agent `cham-soc-hoc-vien`, hoặc tắt công tắc bot của nhóm trong CRM.
