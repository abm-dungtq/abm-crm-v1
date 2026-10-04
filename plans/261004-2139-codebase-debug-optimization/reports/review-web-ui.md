# Báo cáo review frontend giao diện web CRM

Thực hiện ngày 04/10/2026, múi giờ Asia/Ho_Chi_Minh. Phạm vi thực hiện là Phase 03: Đọc và rà soát toàn bộ mã nguồn frontend web (`apps/crm/src/web/**`, `apps/crm/index.html`, `apps/crm/vite.config.*`, `apps/crm/package.json`), kiểm tra kích thước bundle build và lập báo cáo. Không sửa đổi mã nguồn ứng dụng, không thay đổi file plan hay checkpoint.

---

## 1. Kết quả kiểm tra công cụ

Các lệnh kiểm tra được thực thi bằng PowerShell từ thư mục gốc `D:\TQD\CRM`:

| Lệnh | Exit code | Kết quả và ghi chú |
| --- | --- | --- |
| `pnpm -F @abm/crm typecheck` | 0 | TypeScript typecheck đạt (cả worker và web), 0 lỗi. |
| `pnpm -F @abm/crm build` | 0 | Vite build hoàn tất trong 3,06s, sinh ra 3 file: `index.html` (0.83 kB), `index.css` (19.04 kB / gzip 4.75 kB), và **`index-zZyLkkYZ.js` (527.77 kB / gzip 156.91 kB)**. Có cảnh báo chunk JS vượt ngưỡng 500 kB. |

---

## 2. Bảng tổng hợp các phát hiện

Mọi phát hiện đã được kiểm tra trực tiếp trên mã nguồn và phân loại xác thực:
- **CONFIRMED**: Lỗi/điểm yếu đã được kiểm chứng rõ ràng qua mã nguồn và logic thực thi.
- **PLAUSIBLE**: Điểm yếu tiềm ẩn có nguy cơ gây lỗi trong một số tình huống biên hoặc khi mở rộng.

| STT | Trạng thái | Mức độ | Vị trí (`file:dòng`) | Vấn đề | Đề xuất khắc phục |
| --- | --- | --- | --- | --- | --- |
| 1 | CONFIRMED | **High** | `apps/crm/src/web/pages/leads.tsx:30-38` | `LeadsPage` bỏ qua tham số `q`, `stage`, `status` khi gọi API, chỉ lọc trên 500 lead gần nhất và làm sai số đếm tab | Truyền đầy đủ `q`, `stage`, `status` vào query URL của API `/leads` |
| 2 | CONFIRMED | **High** | `apps/crm/src/web/pages/customers.tsx:12-14` | `CustomersPage` lọc client-side trên danh sách tối đa 300 Account, không tìm được khách hàng ngoài top 300 | Gọi API `/accounts?q=...` với từ khóa debounce thay vì lọc client |
| 3 | CONFIRMED | **High** | `apps/crm/src/web/components/lead-actions.tsx:106, 119` | `ChangeStageDialog`: Nhập hoặc dán số tiền có dấu phẩy khiến nút "Xác nhận Won" bị vô hiệu hóa âm thầm | Chuẩn hóa hàm parse tiền tệ, loại bỏ dấu phẩy phân cách hàng nghìn hoặc báo lỗi rõ ràng |
| 4 | CONFIRMED | **High** | `apps/crm/src/web/main.tsx:20-28`, `router.tsx:56-59` | Ứng dụng thiếu React Error Boundary và router `errorComponent`, lỗi runtime rendering sẽ làm trắng trang (WSOD) | Thêm `errorComponent` cho `rootRoute` và bọc component `ErrorBoundary` |
| 5 | CONFIRMED | **High** | `apps/crm/src/web/router.tsx:7-20`, `vite.config.ts:4-12` | Bundle JavaScript chính vượt ngưỡng 500 kB (527.77 kB) do toàn bộ 14 trang import tĩnh, không code splitting | Áp dụng lazy loading (`React.lazy` / TanStack Router) và chia chunk rollup |
| 6 | CONFIRMED | **High** | `apps/crm/src/web/pages/audit.tsx:9-14` | `AuditPage` (`/audit`) không kiểm tra quyền vai trò của `actor`, người dùng `sale` vào trực tiếp bị lỗi API 403 khó hiểu | Thêm role guard hiển thị cảnh báo phân quyền hoặc redirect |
| 7 | CONFIRMED | **Medium** | `apps/crm/src/web/api.ts:90`, `pages/admin-users.tsx:16` | Invalidation của TanStack Query gọi `invalidateQueries()` toàn cục không có queryKey, gây overfetching sau mỗi lệnh ghi | Cấu trúc lại query key dạng mảng phân cấp và chỉ invalidate query liên quan |
| 8 | CONFIRMED | **Medium** | `apps/crm/src/web/router.tsx:64-94` | Thiếu cơ chế Route Guard tập trung (`beforeLoad`): 14 routes để lọt quyền truy cập phụ thuộc từng trang tự xử lý | Sử dụng hook `beforeLoad` của TanStack Router để kiểm tra phân quyền tập trung |
| 9 | CONFIRMED | **Medium** | `apps/crm/src/web/components/layout.tsx:151-172` | Popover `GlobalSearch` dùng sai `role="listbox"` cho thẻ `<Link>` và thiếu phím điều hướng mũi tên | Chuyển đổi role phù hợp hoặc bổ sung điều hướng phím theo chuẩn WAI-ARIA |
| 10 | CONFIRMED | **Medium** | `apps/crm/src/web/components/layout.tsx:151-172` | `GlobalSearch` bỏ qua trạng thái lỗi `result.error`, không thông báo khi tìm kiếm thất bại | Hiển thị thông báo lỗi thân thiện trong popup tìm kiếm |
| 11 | CONFIRMED | **Medium** | `apps/crm/src/web/components/layout.tsx:121-130` | `UserSwitcher` bỏ qua trạng thái lỗi `users.error`, menu trắng xóa nếu API tải demo user lỗi | Thêm `ErrorState` bên trong dropdown đổi vai trò demo |
| 12 | CONFIRMED | **Medium** | `apps/crm/src/web/pages/admin-users.tsx:85-90`, `tasks.tsx:56` | Các nút thao tác trong bảng thiếu `aria-label` định danh đối tượng, gây khó khăn cho trình đọc màn hình | Bổ sung `aria-label` chi tiết (vd: "Sửa người dùng {name}") |
| 13 | CONFIRMED | **Medium** | `apps/crm/src/web/styles.css:144-149`, `layout.tsx:72-76` | Hiển thị 375px: Popover tìm kiếm `GlobalSearch` bị co hẹp (~240px) làm tràn và cắt xén tên khách hàng | Mở rộng popover full-width dạng modal trên màn hình di động |
| 14 | CONFIRMED | **Medium** | `apps/crm/src/web/components/layout.tsx:21, 142` | `Shell` và `GlobalSearch` re-render không cần thiết mỗi khi chuyển trang do subscribe trực tiếp `pathname` | Đưa mảng `nav` ra ngoài scope hoặc memoize; tối ưu subscription |
| 15 | CONFIRMED | **Medium** | `apps/crm/src/web/components/layout.tsx:140`, `pages/leads.tsx:26` | Trùng lặp mã debounce input tìm kiếm; riêng trang `CustomersPage` lại thiếu hoàn toàn debounce | Trích xuất custom hook `useDebounce` dùng chung toàn ứng dụng |
| 16 | CONFIRMED | **Medium** | `apps/crm/src/web/pages/pipeline.tsx:53`, `overview.tsx:266` | Trùng lặp cấu trúc hiển thị Deal/Lead Card trên 3 trang (`pipeline`, `overview`, `dashboard`) | Trích xuất component `<LeadCard />` dùng chung |
| 17 | PLAUSIBLE | **Medium** | `apps/crm/src/web/api.ts:90` | Lỗi mutation ngoài `STALE_VERSION` không kích hoạt invalidation, có thể để lại UI không khớp trạng thái server | Hỗ trợ cờ ép buộc refetch dữ liệu mới nhất khi gặp lỗi trạng thái |
| 18 | CONFIRMED | **Low** | `apps/crm/src/web/pages/tasks.tsx:56` | Nút "Hoàn thành" hiển thị vô điều kiện cho mọi công việc trong danh sách, kể cả việc của nhân sự khác | Kiểm tra quyền phụ trách công việc trước khi hiển thị nút thao tác nhanh |
| 19 | CONFIRMED | **Low** | `apps/crm/src/web/components/ui.tsx:101-110` | `Modal` không khôi phục focus về nút kích hoạt ban đầu sau khi đóng | Lưu `activeElement` trước khi mở và `.focus()` lại khi đóng modal |
| 20 | CONFIRMED | **Low** | `apps/crm/src/web/components/layout.tsx:48-64` | Menu điều hướng trên mobile thiếu nút "Đóng menu" (X) tường minh bên trong sidebar | Thêm nút đóng menu ở góc trên sidebar trên màn hình nhỏ |
| 21 | CONFIRMED | **Low** | `apps/crm/src/web/pages/lead-detail.tsx:83-99` | Lead ở trạng thái `active` nhưng thiếu `nextAction` sẽ hiển thị khung trống không cảnh báo | Thêm thông báo cảnh báo đỏ yêu cầu bổ sung Next Action theo QĐ13 |
| 22 | CONFIRMED | **Low** | `apps/crm/src/web/pages/audit.tsx:7` | Phụ thuộc chéo không tự nhiên: `AuditPage` import component và helper trực tiếp từ `lead-detail.tsx` | Chuyển `AuditDiff` và `commandLabel` vào module dùng chung (`ui.tsx` hoặc `format.ts`) |
| 23 | CONFIRMED | **Low** | `apps/crm/src/web/pages/leads.tsx:35-39` | `LeadsPage` tính toán lọc và đếm lặp trên mảng dữ liệu mà không dùng `useMemo` | Bọc kết quả lọc danh sách vào `useMemo` |

---

## 3. Chi tiết các phát hiện

### Nhóm 1: Tính đúng đắn dữ liệu & TanStack Query

#### 1. `LeadsPage` bỏ qua tham số tìm kiếm và lọc khi gọi API
- **Vị trí**: `apps/crm/src/web/pages/leads.tsx:30-38`
- **Bằng chứng**:
  ```tsx
  // Dòng 30:
  const all = useApi<LeadItem[]>(search.department ? `/leads?department=${encodeURIComponent(search.department)}` : '/leads');
  // Dòng 35-38:
  const rows = (all.data ?? []).filter((l) =>
    (!status || l.status === status)
    && (!search.stage || l.stage === search.stage)
    && (!needle || [l.code, l.contactName, l.account?.name, l.owner?.name, l.needSummary].some((v) => v?.toLowerCase().includes(needle))));
  ```
- **Phân tích tác động**:
  1. Backend API (`apps/crm/src/worker/queries.ts:105`) khi không nhận được `q` sẽ đặt giới hạn `LIMIT 500`. Do đó `all.data` chỉ chứa tối đa 500 lead được cập nhật mới nhất.
  2. Mọi thao tác chuyển tab (`status`), chọn stage (`stage`) và tìm kiếm (`q`) chỉ chạy cục bộ trên 500 bản ghi này. Người dùng không thể tìm thấy bất kỳ lead nào cũ hơn nằm ngoài top 500.
  3. Hàm tính số lượng trên tab `countFor(t.status)` (dòng 39) chỉ đếm trên 500 lead, khiến số lượng hiển thị trên tab "Won", "Lost", "Hàng chờ" bị sai lệch so với cơ sở dữ liệu.
  4. Bỏ phí toàn bộ logic tìm kiếm tiếng Việt không dấu (`searchMatcher`, `foldText`) và chuẩn hóa số điện thoại đã được xây dựng sẵn ở backend (`queries.ts:118-129`).
- **Đề xuất**: Đưa các tham số `status`, `stage`, `q` vào query string của `useApi`:
  `/leads?${new URLSearchParams({ ...(search.department && { department: search.department }), ...(status && { status }), ...(search.stage && { stage: search.stage }), ...(needle && { q: needle }) })}`.

#### 2. `CustomersPage` chỉ tìm kiếm trên 300 khách hàng đầu tiên
- **Vị trí**: `apps/crm/src/web/pages/customers.tsx:12-14`
- **Bằng chứng**:
  ```tsx
  const list = useApi<AccountItem[]>('/accounts');
  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle) || (a.taxCode ?? '').includes(needle));
  ```
- **Phân tích tác động**:
  Backend `apps/crm/src/worker/queries.ts:354` giới hạn `LIMIT 300` khi không có `q`. Frontend lại tải toàn bộ một lần không kèm tham số và lọc client-side. Nếu doanh nghiệp có từ 301 khách hàng trở lên, các khách hàng ngoài top 300 sẽ không bao giờ xuất hiện trong kết quả tìm kiếm theo tên hoặc mã số thuế.
- **Đề xuất**: Debounce từ khóa `q` và gọi `/accounts?q=${encodeURIComponent(needle)}`.

#### 3. `ChangeStageDialog`: Nhập/dán số tiền chứa dấu phẩy làm vô hiệu hóa nút submit
- **Vị trí**: `apps/crm/src/web/components/lead-actions.tsx:106, 119, 145`
- **Bằng chứng**:
  ```tsx
  // Dòng 106:
  const wonAmount = wonValue.includes(',') ? 0 : Number(wonValue.replace(/[.\s]/g, ''));
  // Dòng 119:
  disabled={mutation.isPending || needsContact || wonIncomplete} // wonIncomplete = to === 'won' && (!wonAmount || !wonNote.trim())
  // Dòng 145:
  onChange={(e) => setWonValue(e.target.value.replace(/[^\d.,\s]/g, ''))}
  ```
- **Phân tích tác động**: Input cho phép gõ dấu phẩy (dòng 145), nhưng dòng 106 lại quy định hễ có dấu phẩy thì `wonAmount = 0`. Người dùng copy số tiền dạng `350,000,000` (định dạng chuẩn của nhiều phần mềm kế toán/ngân hàng) dán vào ô, nút "Xác nhận Won" sẽ bị disabled vĩnh viễn mà không hề có bất kỳ dòng thông báo lỗi nào.
- **Đề xuất**: Nếu dấu phẩy theo sau bởi đúng 3 chữ số, coi là dấu phân cách hàng nghìn và strip bỏ; hoặc nếu coi là lỗi thì phải hiển thị dòng báo lỗi validation ngay dưới ô nhập.

#### 4. TanStack Query invalidation toàn cục gây lãng phí tài nguyên
- **Vị trí**: `apps/crm/src/web/api.ts:90`, `apps/crm/src/web/pages/admin-users.tsx:16`
- **Bằng chứng**:
  ```ts
  // api.ts:90
  if (!error || error.code === 'STALE_VERSION') void client.invalidateQueries();
  ```
- **Phân tích tác động**:
  Việc gọi `client.invalidateQueries()` không truyền `queryKey` sẽ đánh dấu stale và kích hoạt refetch tất cả các query đang active trên màn hình, bao gồm cả query cấu hình hệ thống (`/auth/mode` - vốn có `staleTime: Infinity`), query số lượng chờ duyệt trên sidebar, và các query danh mục khác. Nguyên nhân gốc rễ là `useApi` lưu `queryKey: [memoryUser, path]` dưới dạng chuỗi URL thô, khiến việc invalidation theo nhóm tài nguyên (`leads`, `tasks`) không thực hiện được.
- **Đề xuất**: Chuyển đổi queryKey thành dạng mảng có cấu trúc: `[memoryUser, 'leads', { id, filters }]` và chỉ invalidate phạm vi cần thiết.

---

### Nhóm 2: Quyền truy cập & Định tuyến (RBAC & Routing)

#### 5. `AuditPage` (`/audit`) thiếu kiểm tra quyền vai trò người dùng
- **Vị trí**: `apps/crm/src/web/pages/audit.tsx:9-14`
- **Bằng chứng**:
  Trong khi sidebar (`layout.tsx:40`) chỉ hiện mục Audit cho `['leader', 'head', 'director', 'admin']`, trang `AuditPage` lại không có bất kỳ dòng kiểm tra quyền nào:
  ```tsx
  export function AuditPage() {
    const q = useApi<AuditItem[]>('/audit');
    // ... trực tiếp render bảng
  ```
  Backend (`apps/crm/src/worker/queries.ts:253` và `index.ts:79`) chặn vai trò `sale` và trả về lỗi HTTP 403 Forbidden.
- **Phân tích tác động**: Khi nhân viên Sale truy cập trực tiếp URL `/audit`, trang gọi API và nhận lỗi 403, dẫn đến hiển thị hộp đỏ `ErrorState`: "Vai trò hiện tại không xem được mục này" kèm nút bấm "Thử lại" vô nghĩa. Trải nghiệm không đồng nhất với các trang được bảo vệ khác (`admin.tsx`, `overview.tsx` hiển thị cảnh báo phân quyền màu vàng ngay từ đầu).
- **Đề xuất**: Thêm guard ở đầu component: `if (actor.role === 'sale') return <Alert tone="warn">Chỉ Leader, Trưởng phòng, Ban Giám đốc và Admin mới có quyền xem nhật ký audit.</Alert>;`.

#### 6. Toàn bộ 14 routes thiếu Route Guard tập trung
- **Vị trí**: `apps/crm/src/web/router.tsx:64-94`
- **Bằng chứng**: Các route đều chỉ dùng `createRoute({ getParentRoute, path, component })`.
- **Phân tích tác động**: Logic kiểm tra quyền bị thả nổi cho từng component trang tự kiểm tra (dẫn đến việc trang nhớ trang quên như `AuditPage`).
- **Đề xuất**: Sử dụng hook `beforeLoad` của TanStack Router để kiểm tra danh sách quyền được phép truy cập của từng route, chuyển hướng (redirect) hoặc hiển thị trang từ chối quyền chuẩn mực.

#### 7. Nút "Hoàn thành" hiển thị cho việc của người khác trong `TasksPage`
- **Vị trí**: `apps/crm/src/web/pages/tasks.tsx:56`
- **Bằng chứng**:
  Dòng 56 render nút `<button className="btn btn-sm" onClick={() => setCompleting(t)}>Hoàn thành</button>` cho tất cả các item.
- **Phân tích tác động**: Khi Leader hoặc Admin xem trang việc, danh sách bao gồm công việc của mọi thành viên. Nút "Hoàn thành" hiển thị đại trà cho tất cả dòng, dễ gây bấm nhầm hoàn thành thay cho nhân viên cấp dưới.

---

### Nhóm 3: Xử lý lỗi, Loading & Trạng thái rỗng (Error Handling & States)

#### 8. Thiếu React Error Boundary toàn cục
- **Vị trí**: `apps/crm/src/web/main.tsx:20-28`, `router.tsx:56-59`
- **Bằng chứng**: `createRootRoute` chỉ định nghĩa `notFoundComponent`, không có `errorComponent`. Toàn bộ ứng dụng không có class component hay package ErrorBoundary nào.
- **Phân tích tác động**: Bất kỳ lỗi runtime rendering JavaScript nào (ví dụ: dữ liệu null không mong muốn, lỗi format ngày giờ, lỗi parse JSON diff audit) sẽ khiến toàn bộ ứng dụng sập thành màn hình trắng, người dùng không thể thao tác gì ngoài việc mở DevTools hoặc F5 toàn bộ trang.
- **Đề xuất**: Cấu hình `errorComponent` cho `createRootRoute` hiển thị giao diện báo lỗi kèm nút khôi phục trạng thái.

#### 9. Bỏ qua trạng thái lỗi trong `GlobalSearch` và `UserSwitcher`
- **Vị trí**:
  - `apps/crm/src/web/components/layout.tsx:151-172` (`GlobalSearch`)
  - `apps/crm/src/web/components/layout.tsx:121-130` (`UserSwitcher`)
- **Bằng chứng**: Cả 2 component chỉ kiểm tra cờ `isLoading` và dữ liệu `data`. Nếu `result.error` hoặc `users.error` xuất hiện (do rớt mạng hoặc lỗi 422 từ khóa quá dài), giao diện hoàn toàn im lặng và để trống popup.
- **Đề xuất**: Bổ sung hiển thị thông báo lỗi ngắn gọn khi `error` khác null.

#### 10. Trạng thái rỗng không có cảnh báo cho lead active mất `nextAction`
- **Vị trí**: `apps/crm/src/web/pages/lead-detail.tsx:83-99`
- **Bằng chứng**: Dòng 87 đọc `lead.nextAction?.title`. Nếu lead đang mở nhưng `nextAction` là null (vi phạm QĐ13), thẻ Next Action hiển thị khung trắng không có thông tin và không có nút tạo việc mới để khắc phục.

---

### Nhóm 4: Khả năng tiếp cận & Trải nghiệm di động 375px (Accessibility & Mobile 375px)

#### 11. Cấu trúc WAI-ARIA không hợp lệ trong `GlobalSearch`
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:151-172`
- **Bằng chứng**: Khung popover mang `role="listbox"`, nhưng các phần tử con trực tiếp là các thẻ `<Link>` (`<a>`) thay vì các phần tử mang `role="option"`. Đồng thời input không hỗ trợ phím ArrowDown/ArrowUp để chọn kết quả bằng bàn phím.
- **Phân tích tác động**: Trình đọc màn hình thông báo lỗi cấu trúc ARIA; người dùng chỉ sử dụng bàn phím không thể chọn được kết quả tìm kiếm trong danh sách thả xuống.

#### 12. Nút bấm trong các bảng danh sách thiếu `aria-label` định danh
- **Vị trí**: `apps/crm/src/web/pages/admin-users.tsx:85-90`, `tasks.tsx:56`, `leads.tsx:112`
- **Bằng chứng**: Các nút hành động lặp lại trên từng dòng chỉ có nhãn tĩnh: "Sửa", "Khóa", "Cấp mật khẩu tạm", "Hoàn thành", "Giao".
- **Phân tích tác động**: Trình đọc màn hình khi duyệt phím Tab sẽ chỉ đọc "Sửa, button", "Khóa, button" liên tục, người dùng không thể biết nút đó tương ứng với bản ghi người dùng hay công việc nào.

#### 13. Popover `GlobalSearch` bị co hẹp nghiêm trọng ở khổ 375px
- **Vị trí**: `apps/crm/src/web/styles.css:144-149`, `apps/crm/src/web/components/layout.tsx:72-76`
- **Bằng chứng**: Ở màn hình 375px, thanh topbar chứa menu button (36px), search container, và nút "Tạo lead" (36px). Chiều rộng thực của `.search` chỉ còn khoảng 240px. Do `.search-pop` định vị tuyệt đối theo `.search` (`left: 0; right: 0;`), popover kết quả cũng chỉ rộng 240px.
- **Phân tích tác động**: Mỗi dòng kết quả gồm mã lead (`L-2026-0001` ~85px) và badge stage (~95px), chiếm tổng cộng 180px, chỉ còn vỏn vẹn ~60px cho tên khách hàng. Tên khách bị cắt cụt (truncate) chỉ còn hiển thị 3-4 ký tự, gây khó khăn lớn khi tra cứu trên điện thoại.
- **Đề xuất**: Trên màn hình di động (dưới 600px), hiển thị popover tìm kiếm dạng full-width overlay bám theo màn hình.

#### 14. Sidebar di động thiếu nút "Đóng menu" tường minh
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:48-64`
- **Bằng chứng**: Khi sidebar mở trượt ra trên màn hình nhỏ (`open === true`), không có nút đóng (biểu tượng X) nào bên trong aside. Người dùng buộc phải chạm vào vùng scrim phía sau hoặc nhấn Escape (nếu có bàn phím).

#### 15. Modal không khôi phục focus khi đóng
- **Vị trí**: `apps/crm/src/web/components/ui.tsx:101-110`
- **Bằng chứng**: Component `Modal` gọi `dialog.close()` nhưng không lưu lại và khôi phục focus về nút kích hoạt ban đầu. Sau khi đóng modal, focus rơi tự do về `document.body`.

---

### Nhóm 5: Bundle lớn, Code Splitting & Render thừa

#### 16. Bundle JavaScript chính quá lớn (527.77 kB) do thiếu Code Splitting
- **Vị trí**: `apps/crm/src/web/router.tsx:7-20`, `apps/crm/vite.config.ts:4-12`
- **Bằng chứng**: Lệnh build cảnh báo:
  ```
  dist/assets/index-zZyLkkYZ.js   527.77 kB │ gzip: 156.91 kB
  (!) Some chunks are larger than 500 kB after minification.
  ```
  Tất cả 14 trang (bao gồm các trang quản trị nặng như `admin-users.tsx` 23.6 KB, `overview.tsx` 15.8 KB, `lead-actions.tsx` 19.9 KB) đều được import tĩnh đồng bộ vào chunk chính.
- **Phân tích tác động**: Người dùng thông thường (Sale) phải tải toàn bộ mã nguồn quản trị, bảng nhiệt, nhập xuất CSV nhân sự ngay lần đầu mở ứng dụng, làm chậm đáng kể thời gian tải trang ban đầu (FCP, LCP), lãng phí băng thông di động.

#### 17. Re-render không cần thiết trong `Shell` và `GlobalSearch`
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:21, 142`
- **Bằng chứng**: Cả `Shell` và `GlobalSearch` đều độc lập gọi `useRouterState({ select: (s) => s.location.pathname })`. Đồng thời mảng `nav` chứa 10 phần tử được tạo mới trên mỗi lượt render của `Shell`.
- **Phân tích tác động**: Mỗi lần click chuyển trang, toàn bộ layout shell, sidebar, và topbar đều bị kích hoạt re-render hoàn toàn.

---

### Nhóm 6: Trùng lặp code giữa các trang (Code Duplication)

#### 18. Trùng lặp logic debounce tìm kiếm
- **Vị trí**: `apps/crm/src/web/components/layout.tsx:140`, `apps/crm/src/web/pages/leads.tsx:26`, `apps/crm/src/web/pages/customers.tsx:13`
- **Bằng chứng**: `layout.tsx` và `leads.tsx` mỗi nơi tự viết một `setTimeout` trong `useEffect` với thời gian trễ khác nhau (200ms và 250ms); trong khi `customers.tsx` lại không có debounce. Cần trích xuất thành hook `useDebounce`.

#### 19. Trùng lặp cấu trúc hiển thị thẻ Lead (`deal-card`)
- **Vị trí**: `apps/crm/src/web/pages/pipeline.tsx:53-71`, `overview.tsx:266-279`, `dashboard.tsx:54-72`
- **Bằng chứng**: Cả 3 trang đều tự viết lại cấu trúc thẻ lead với mã số, tên khách hàng, giá trị dự kiến, health badges, hạn next action. Cần chuẩn hóa thành component `<LeadCard />` duy nhất.

#### 20. Phụ thuộc chéo giữa các trang độc lập
- **Vị trí**: `apps/crm/src/web/pages/audit.tsx:7`
- **Bằng chứng**: `import { AuditDiff, commandLabel } from './lead-detail';`. Trang Audit phụ thuộc trực tiếp vào file của trang Lead Detail. Cần đưa `AuditDiff` và `commandLabel` về component chung (`ui.tsx` hoặc `format.ts`).

---

## 4. Cơ hội tối ưu (Tách riêng)

Dưới đây là các đề xuất tối ưu hóa hiệu năng và kiến trúc kỹ thuật dành cho frontend (không gây breaking changes):

### 4.1. Tối ưu hóa kích thước Bundle & Tải tài nguyên
1. **Áp dụng Route-level Code Splitting**:
   Sử dụng hàm tải động `React.lazy` hoặc tính năng route splitting của TanStack Router cho các trang quản trị (`/admin`, `/admin/users`, `/overview`, `/audit`). Điều này sẽ tách ngay hơn 100 kB mã nguồn ra khỏi bundle ban đầu.
2. **Cấu hình Rollup Manual Chunks**:
   Trong `apps/crm/vite.config.ts`, tách rõ ràng các thư viện vendor của bên thứ ba:
   ```ts
   build: {
     rollupOptions: {
       output: {
         manualChunks: {
           'vendor-react': ['react', 'react-dom'],
           'vendor-tanstack': ['@tanstack/react-query', '@tanstack/react-router'],
         },
       },
     },
   }
   ```
   Điều này giúp trình duyệt lưu cache lâu dài các thư viện nền tảng khi mã nguồn ứng dụng thay đổi.

### 4.2. Tối ưu hóa TanStack Query & Caching Strategy
1. **Chuẩn hóa Query Keys có cấu trúc phân cấp**:
   Thay thế raw string `[memoryUser, path]` bằng mảng:
   - `['leads', { status, stage, department, q }]`
   - `['lead', leadId]`
   - `['accounts', { q }]`
   - `['tasks', status]`
2. **Scoped Invalidation**:
   Khi một command hoàn thành (ví dụ: `completeTask`), chỉ gọi:
   `client.invalidateQueries({ queryKey: ['tasks'] })` và `client.invalidateQueries({ queryKey: ['lead', leadId] })`.
   Tránh gọi `client.invalidateQueries()` không đối số làm tải lại cả những dữ liệu không liên quan.
3. **Thiết lập `staleTime` hợp lý**:
   Các danh mục tĩnh ít biến động như danh sách vai trò, phòng ban, thông tin auth mode nên đặt `staleTime: 5 * 60 * 1000` (5 phút) hoặc `Infinity` để giảm số lượng request HTTP thừa.

### 4.3. Tối ưu hóa Tìm kiếm & Truy vấn Server-side
1. **Kết nối tìm kiếm tiếng Việt xuống backend**:
   Đưa tham số tìm kiếm của `LeadsPage` và `CustomersPage` về server-side để tận dụng bộ lọc chuẩn hóa tiếng Việt không dấu và regex số điện thoại trong SQLite D1, đồng thời loại bỏ giới hạn hiển thị cục bộ 500 lead / 300 account.

### 4.4. Cải thiện trải nghiệm di động & Trợ năng (A11y)
1. **Tối ưu kích thước vùng chạm (Touch Targets)**:
   Tăng chiều cao tối thiểu của các nút bấm trên di động lên tối thiểu 36-40px, thêm khoảng cách an toàn (margin/gap tối thiểu 8-12px) giữa các nút hành động nhạy cảm ("Khóa tài khoản", "Nhả lead") để tránh thao tác nhầm trên màn hình cảm ứng.
2. **Modal tìm kiếm chuyên dụng cho Mobile**:
   Ở màn hình nhỏ (< 600px), khi focus vào ô tìm kiếm toàn cục, mở một lớp phủ toàn màn hình (Full-screen Search Overlay) để hiển thị đầy đủ thông tin mã lead, tên khách hàng và nhãn stage mà không bị co kéo hay cắt chữ.

---

## 5. Kết luận và tình trạng bàn giao

- **Số lượng phát hiện**: 23 phát hiện (trong đó 6 High, 11 Medium, 6 Low), bao gồm 22 CONFIRMED và 1 PLAUSIBLE.
- **Tệp thay đổi**: Duy nhất 01 tệp báo cáo mới `plans/261004-2139-codebase-debug-optimization/reports/review-web-ui.md`.
- **Trạng thái Git**: Không có tệp mã nguồn nào bị chỉnh sửa; không thực hiện lệnh `git add` hay `git commit`. Thư mục `dist` đã nằm trong `.gitignore`.
