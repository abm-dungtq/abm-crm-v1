# Quy ước lập trình

- Sử dụng TypeScript strict và kế thừa `tsconfig.base.json`. Giữ `noUncheckedIndexedAccess` để xử lý giá trị có thể không tồn tại khi truy cập bằng chỉ số.
- Tên file mới dùng kebab-case, trừ khi định dạng công cụ yêu cầu tên cố định.
- Migration D1 đánh số theo dạng `NNNN_mo-ta.sql`. Không sửa migration đã apply; tạo migration tiếp theo để thay đổi schema.
- Mỗi command ghi audit và outbox trong cùng batch với thay đổi nghiệp vụ. Không tách các bản ghi này sang lần ghi độc lập; bằng chứng runtime của write pattern được xác minh trong PoC D1.
- Schema command, scope và risk level được khai báo tại `packages/contracts`. Sinh MCP schema từ hợp đồng đó; không tạo validator thứ hai.
- Không log secret hoặc PII. Dùng `[redacted]` trong báo cáo nếu cần biểu thị giá trị nhạy cảm; không đưa giá trị thật vào log, tài liệu hay commit.
- Không commit `.env*`, `.dev.vars*`, `.tokens.local`, private key, credential, dữ liệu local hoặc build output. Kiểm danh sách file trước khi commit.
- Dùng conventional commits, ví dụ `chore: bootstrap repository and source package`, không nhắc AI trong commit message.

Xem [cấu trúc repository](repository-structure.md) để đặt code đúng ranh giới và [mục lục tài liệu](../README.md) để tra tài liệu nguồn.
