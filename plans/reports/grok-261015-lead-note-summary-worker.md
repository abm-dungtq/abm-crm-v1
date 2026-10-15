# Worker: ghi chú lead bằng tóm tắt hội thoại

Phần Worker của hợp đồng `plans/261015-1113-lead-note-summary/plan.md`. Không sửa `apps/crm/src/web/**`.

## Đã đổi

- `apps/crm/src/worker/inbox/intake.ts`
  - Thêm `summary` vào `INTAKE_FIELDS` và `extractedSchema`: chuỗi, trim, tối đa 1500 ký tự. `null` hoặc chuỗi trắng được bỏ, giống các trường khác. Dài hơn 1500 thì cả JSON trích xuất không hợp lệ.
  - Câu lệnh trích xuất yêu cầu thêm khoá `summary`.
  - `mergeIntakeFields`: trường khác giữ nguyên (trống thì điền, khác thì để xuất, trùng thì xoá đề xuất). `summary` mới ghi đè bản đang lưu, không đưa vào `proposed`. Lần trích sau không có `summary` thì giữ bản cũ.
  - Ghi chú tự động trên lead đang mở (`Trích xuất tự động từ hội thoại: ...`) bỏ `summary`. Chỉ còn các trường ngắn. Nếu chỉ có `summary` đổi thì không ghi thêm dòng nào.
  - `classifyIntake` không còn chép tin nhắn. Có tóm tắt: `Tóm tắt hội thoại <kênh>:\n<summary>`. Không có: `Tạo từ hội thoại <kênh>.` Nhãn kênh giữ nguyên: Facebook, Zalo OA, Zalo.
  - Xoá `ACTIVITY_MESSAGE_COUNT`. Hàm `transcript` vẫn dùng để gửi hội thoại cho bộ trích xuất.
- `apps/crm/src/worker/inbox/inbox-routes.ts`
  - `POST /api/inbox/intakes/:id/classify` nhận `summary` tùy chọn ở cấp trên cùng, cạnh `pipeline` và `input`. Sau trim tối đa 1500 ký tự. Chuỗi trắng hoặc `null` coi như không gửi. Dài hơn trả 422, intake vẫn `pending`. Giá trị được truyền vào `ClassifyRequest`.
- `apps/crm/test/inbox-intake.test.ts`
  - Sửa test tạo lead B2B: ghi chú đúng câu `Tạo từ hội thoại Zalo.` và không chứa lời khách.
  - Sửa test lead đang mở: ghi chú không chứa bản tóm tắt; đổi mỗi `summary` không thêm ghi chú.

## Câu lệnh trích xuất mới

```text
Trích thông tin khách hàng từ hội thoại dưới đây. Chỉ trả về một JSON object với các khoá name, phone, email, program, need, interest, note, summary; bỏ khoá không có thông tin; không thêm chữ ngoài JSON. Các khoá name, phone, email, program, need, interest, note chỉ lấy thông tin do khách nói. Chỉ lấy họ tên thật khách tự giới thiệu; không lấy đại từ xưng hô (anh, chị, em, cô, chú, bác, sếp, bạn…) hay biệt danh; khoá program ghi tên chương trình/khóa học hoặc mức phí khách nói đã đóng (ví dụ "199k"). Khoá summary là tóm tắt tiếng Việt từ 3 đến 6 dòng ngắn, mỗi dòng bắt đầu bằng "- ". Nêu khách hỏi hoặc cần gì; bên mình đã báo hoặc đã gửi gì (giá, lịch, tài liệu); phần đã thống nhất hoặc đã hứa và bước tiếp theo. Không chép nguyên tin nhắn, không bịa thêm thông tin, không ghi số điện thoại, email hay số tài khoản ngân hàng.
```

Quy tắc chỉ lấy lời khách áp cho các khoá hồ sơ. `summary` được phép ghi cả phần bên mình đã trả lời.

## Test

Trong `apps/crm/test/inbox-intake.test.ts`:

- Có `summary`: ghi chú đúng `Tóm tắt hội thoại Zalo:\n` cộng bản tóm tắt, không chứa câu `Em tên Hoa, muốn học tiếng Anh giao tiếp`.
- Không gửi `summary`: ghi chú là `Tạo từ hội thoại Zalo.`
- `summary` 1501 ký tự `à`: HTTP 422, intake vẫn `pending`.
- `parseExtraction` nhận `summary` đã trim, bỏ `null` và chuỗi trắng, nhận đủ 1500 ký tự, và trả `null` khi dài 1501.
- `mergeIntakeFields` ghi đè `summary`, kể cả khi đang có đề xuất cũ; số điện thoại khác vẫn chỉ là đề xuất.
- Lần trích thứ hai trên intake đang chờ thay `summary` đã lưu, không tạo `proposed`.
- Lead đang mở: ghi chú tự động có nhu cầu và chương trình, không có đoạn tóm tắt.

## Kiểm tra

Chạy từ `D:\TQD\CRM` lúc 2026-10-15:

- `pnpm -F @abm/crm typecheck` — thoát 0. Cả `tsconfig.worker.json` và `tsconfig.web.json` đều sạch. Không có lỗi typecheck phía web cần ghi nhận.
- `pnpm -F @abm/crm test` — thoát 0. 43 file qua, 1 file bỏ qua; 552 test qua, 2 test bỏ qua. `test/inbox-intake.test.ts`: 24 test qua.
- Trước đó `pnpm -F @abm/crm exec vitest run test/inbox-intake.test.ts` cũng thoát 0.

Không commit, không deploy, không chạy wrangler remote, không đụng VPS, GoClaw hay D1 remote.

```
Status: DONE
Summary: Worker trích `summary` tối đa 1500 ký tự, lần trích sau ghi đè, và ghi chú lúc tạo lead chỉ còn bản tóm tắt hoặc một câu ngắn. Typecheck và toàn bộ test của `@abm/crm` đều thoát 0.
```
