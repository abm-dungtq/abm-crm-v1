# Kết quả sửa lỗi phase 04

Đã sửa 10 nhóm trong danh sách chốt của [phase 04](../phase-04-fix-confirmed-bugs.md). Bản cuối đạt 223/223 test, typecheck và build. Mã chưa được stage hoặc commit; không đổi trạng thái plan, checkpoint hay phase khác.

## Các lỗi đã sửa

| Nhóm | Kết quả | Test hoặc kiểm chứng |
| --- | --- | --- |
| Kill switch overview | Dùng cùng biểu thức với command: `enabled = 0` hoặc không có dòng switch thì bot được ghi. | `overview.test.ts`: cả 0, 1 và thiếu dòng. |
| Dashboard bị cắt ở 500 lead | SQL theo scope đếm lead, giá trị, pipeline, Won/Lost, lý do Lost, số theo Sale và việc. Thêm `truncated` cho các phần giới hạn. | `list-limits.test.ts`: 542 lead, hơn 300 task và Sale khác; `domain-read-models.test.ts`: scope, tiền và ranh giới tháng Việt Nam. |
| Search và tạo lead đọc cả bảng | SQL giới hạn tối đa 2.000 ứng viên trước khi fold/lọc trong Worker. Contact point được kiểm bằng `EXISTS`, chỉ trả cờ khớp, không tải các giá trị ngoài trang. | `list-limits.test.ts`: hơn 2.000 lead/account; quan sát số dòng D1 thật; vẫn phát hiện công ty trùng trong cửa sổ. |
| MCP replay bỏ qua kiểm tra | Nhánh replay gần và nhánh thắng cạnh tranh dùng chung `replayInScope`, kiểm role, kill switch và quyền thấy lead. | `mcp-gateway.test.ts`: bật switch giữa hai lần gọi; đổi owner làm mất scope. Test đổi scope đã đạt trước sửa nhờ bước tra mã lead hiện có. |
| Bot nhận audit lead | Agent không truy vấn hoặc nhận trường `audit`; web giữ contract cũ. | `mcp-gateway.test.ts`: bot Admin không có `audit`; các test web/audit hiện có vẫn đạt. |
| Thông báo gửi trùng | `UPDATE` có điều kiện giành lượt `sending`; chỉ gửi khi `meta.changes = 1`. Có thu hồi lease quá 5 phút, kiểm ownership trước từng người nhận và khi kết thúc. Resend đọc lại trạng thái trước response/audit. | `approval-notify.test.ts`: lượt gọi chồng nhau, lease cũ, sender mất lease và admin đọc trạng thái cũ. Dùng network stub hiện có; không gọi Lark thật. |
| Lead/khách hàng lọc cục bộ | Web gửi query vào API: lead có `q/status/stage/department`; khách hàng có `q`. Count tab không có từ khóa được SQL đếm đầy đủ; khi tìm kiếm thì ẩn count. | `web-bugfixes.test.ts`: query builder; `list-limits.test.ts`: lọc lead và tìm account ngoài 300 dòng mặc định. |
| Won có dấu phẩy | Chấp nhận `350,000,000`, dấu chấm hoặc khoảng trắng chia nhóm 3 chữ số. Nhập sai hiện lỗi dưới ô; không xóa ký tự rồi âm thầm đổi số. | `web-bugfixes.test.ts`: số hợp lệ, số thập phân, malformed, 0 và vượt giới hạn contract. |
| Root route thiếu màn lỗi | Có màn lỗi tiếng Việt, nút thử lại và tải lại; không hiển thị nội dung exception. | Typecheck web và build, theo chỉ dẫn coordinator. |
| Sale mở audit | Hàm quyền `.ts` được component gọi; Sale thấy cảnh báo và không gọi `/audit`. | `web-bugfixes.test.ts`: Sale bị loại; Leader/Head/Director/Admin được phép. |

Lỗi switch, MCP replay, audit bot, KPI dashboard và gửi trùng đã có assertion đỏ trước khi sửa. Một test cạnh tranh ban đầu bị timeout do cách lồng fetch spy; đã sửa test bằng callback đồng bộ rồi tái hiện được gửi hai lần. Fixture tạo lead ban đầu thiếu phone/email và so tên công ty không đầy đủ; đã sửa fixture để kiểm đúng duplicate thật.

## Contract cộng thêm đã được duyệt

- `/api/leads` và `/api/accounts` mặc định vẫn trả `data` dạng mảng. Chỉ `?view=page` trả `data: { items, truncated }`; lead có thêm `counts` hoặc `null`. `truncated` là boolean cho biết cắt trang hoặc cắt tập ứng viên; không phải API phân trang có cursor. Types nằm trong `src/web/types.ts`.
- Count tab lead khi không có `q` bao gồm mọi trạng thái, nhưng vẫn áp dụng scope, stage, department và các bộ lọc khác. Khi có `q`, `counts = null`; không hiển thị số đếm không đầy đủ.
- Dashboard có `truncated.leads/tasks/attention/upcoming`, mỗi trường là `null` hoặc `{ shown, total }`. `attention.total` chỉ đếm phần lead đã tải nếu `truncated.leads` khác `null`.
- Theo duyệt riêng của coordinator, `firstContactBreaches`, `staleLeads` và `bySale.stale` vẫn tính trên mẫu tối đa 500 lead gần nhất. Khi bị cắt, UI ghi số tối thiểu bằng `≥`, có cảnh báo và không khẳng định mọi lead đều đúng SLA từ mẫu trống. Các KPI count/value/task còn lại tính toàn scope bằng SQL.
- `sent_at` chỉ là thời điểm gửi khi `status = 'sent'`. Trong `sending`, nó là thời điểm bắt đầu lease; ở `failed/skipped/no_recipient` được xóa. Không có API/UI hiện tại xuất `sent_at` như thời điểm đã gửi; đã kiểm nguồn. Admin đếm cả `sending` trong số chờ gửi; overview có nhãn “Đang gửi”. Không cần migration.

## Kiểm tra bản cuối

Chạy bằng PowerShell từ `D:/TQD/CRM`, khoảng 22:18–22:19 ngày 04/10/2026, múi giờ Asia/Saigon.

| Lệnh | Kết quả |
| --- | --- |
| `pnpm -F @abm/crm test` | Exit 0; 16 file, 223/223 test đạt; 11,66 giây. |
| `pnpm -F @abm/crm typecheck` | Exit 0; Worker, test và web đều đạt. |
| `pnpm -F @abm/crm build` | Exit 0; Vite 2,70 giây. Bundle JS 529,72 kB, gzip 157,52 kB; vẫn có cảnh báo >500 kB. |
| `git diff --check -- apps/crm/src apps/crm/test packages/contracts/src` | Exit 0. |

Đã dùng ak-test và ak-code-review. Reviewer độc lập chỉ đọc không thấy Critical/High; phát hiện một lỗi Medium về response/audit resend cũ, đã sửa và được reviewer kiểm lại là đóng. Review đơn giản hóa không đề xuất thay đổi cần thiết; không chạy delegate chỉnh code do phạm vi chỉ cho phép reviewer/test chỉ đọc.

Typecheck lần đầu báo TS6142 vì test SSR import `.tsx` trong cấu hình Worker không bật JSX. Theo chỉ dẫn coordinator, đã bỏ cách tải bằng `vi.importActual`, chuyển test sang các hàm `.ts` thực sự được component dùng; không sửa tsconfig, không cài công cụ. Không tuyên bố đã chạy browser/SSR trên bản cuối. D1 trong test là môi trường cô lập có migration/seed tái tạo; không thao tác DB vận hành hoặc tạo server nền. Không tạo journal vì task cấm ghi thư mục này.

## Tệp thay đổi

Các thư mục dưới đây tương đối với root `D:/TQD/CRM`; tên tệp được nhóm theo thư mục:

- `apps/crm/src/worker/`: `admin-routes.ts`, `approval-notify.ts`, `commands.ts`, `index.ts`, `mcp-tools.ts`, `overview.ts`, `queries.ts`.
- `apps/crm/src/web/`: `actor-context.ts`, `format.ts`, `list-query.ts` (mới), `router.tsx`, `types.ts`, `components/lead-actions.tsx`, `pages/audit.tsx`, `pages/customers.tsx`, `pages/dashboard.tsx`, `pages/leads.tsx`, `pages/overview.tsx`.
- `apps/crm/test/`: `approval-notify.test.ts`, `mcp-gateway.test.ts`, `overview.test.ts`, `list-limits.test.ts` (mới), `web-bugfixes.test.ts` (mới).
- Báo cáo: `plans/261004-2139-codebase-debug-optimization/reports/fix-log.md` (mới).

Không sửa contracts, migration, các tệp cấm hoặc thay đổi có sẵn của user. Không deploy, remote D1, GoClaw, Lark thật hay network post. Trạng thái chung và việc commit thuộc coordinator.

## Giới hạn và việc để lại

- Search tiếng Việt và kiểm công ty trùng theo tên có thể bỏ sót ngoài 2.000 ứng viên. Cần cột tên đã fold hoặc cơ chế tìm kiếm/pagination ở phase 05; phase này chỉ giới hạn tải theo duyệt.
- SLA dashboard vẫn là số tối thiểu khi vượt 500 lead, như contract đã duyệt. Số SLA/heatmap/workload trong overview hiện hữu là mục Medium riêng, để phase 05.
- Lease chặn gửi trùng do hai lượt còn hạn. Nếu Lark đã nhận tin nhưng Worker dừng trước khi ghi kết quả, thu hồi lease có thể gửi lại; không bảo đảm exactly-once qua network. Resend khi một người nhận đã thành công và người khác thất bại cũng có thể gửi lại cho người đã nhận.
- Không sửa khóa đăng nhập 423, index, audit quản trị, task cũ sau đổi owner, tách bundle, a11y hay các trùng lặp khác theo danh sách loại trừ của phase.
- Không có blocker hoặc câu hỏi chưa được trả lời trong phase 04. Coordinator cần kiểm scope và chạy lại các gate trước khi nhận delivery theo checkpoint.
