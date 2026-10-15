# Ghi chú lead bằng tóm tắt hội thoại + sửa màn hình trắng khi tạo lead

Status: in progress · Owner: Opus (giám sát) · Executors: Grok 4.7 (Worker), Gemini 4 Argon (giao diện)

## Mục tiêu
1. Bấm "Tạo lead" trong Inbox không còn màn hình trắng. Tạo xong thì tự mở trang lead: B2B mở `/leads/<id>`, học viên mở `/learners/<contactId>`.
2. Ghi chú trên lead là bản tóm tắt ngắn (3–6 ý), không chép 20 tin nhắn.
3. Bản tóm tắt do AI viết sẵn trong form "Tạo lead", nhân viên sửa được trước khi lưu.
4. Ghi chú dài trong mục Hoạt động được thu gọn, có nút "Xem thêm".

## Nguyên nhân màn hình trắng (đã xác minh trong code)
- `ToastProvider` bọc ngoài `RouterProvider` (`apps/crm/src/web/main.tsx:23`). Vì vậy khung thông báo nằm ngoài ngữ cảnh router.
- Thông báo thành công của form tạo lead (`intake-card.tsx:267`) chứa `<Link>`. Link cần router, nên lỗi làm sập cả cây React thành trang trắng.
- Lead vẫn được tạo bình thường.
- Lỗi có từ commit `b1440fb` (14/10).

## Quyết định của owner (15/10)
- Tạo lead xong thì tự mở trang lead.
- AI tóm tắt và nhân viên sửa được. Nếu AI chưa có tóm tắt, ô để trống cho nhân viên tự ghi.

## Hợp đồng giữa Worker và giao diện
- Ô trích xuất mới `summary`, nằm trong `INTAKE_FIELDS` của cả worker và web. Gồm tối đa 1500 ký tự, mỗi ý một dòng bắt đầu bằng "- ".
- `POST /api/inbox/intakes/:id/classify` nhận thêm `summary?: string` ở cấp trên cùng, cạnh `pipeline` và `input`. Độ dài tối đa 1500 ký tự sau khi trim.
- Nội dung ghi chú:
  - Có tóm tắt: `Tóm tắt hội thoại <kênh>:\n<summary>`.
  - Không có tóm tắt: `Tạo từ hội thoại <kênh>.`
  - Không bao giờ chép bản ghi hội thoại.

## Phase
| # | Việc | Người làm | File | Trạng thái |
|---|------|-----------|------|------------|
| B | AI trích thêm `summary`, classify nhận `summary`, ghi chú ngắn, test | Grok | `src/worker/**`, `test/**` | xong 15/10 |
| W | Sửa trang trắng, tự mở lead, ô tóm tắt trong form, thu gọn ghi chú dài | Gemini | `src/web/**` | xong 15/10 |
| R | Soát code, chạy test, deploy eval | Opus | — | xong: typecheck, 554 test và build đạt; eval bản `6cd15cf4`; chờ owner thử |

## Không làm
- Không sửa dữ liệu các ghi chú cũ; chỉ thu gọn khi hiển thị.
- Không đổi cấu hình GoClaw. Câu lệnh cho AI trích xuất nằm trong code CRM.
