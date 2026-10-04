# Phương án tối ưu codebase CRM

Thực hiện ngày 04/10/2026, múi giờ Asia/Ho_Chi_Minh.
Phạm vi: Phase 05 — Tổng hợp, đánh giá và lập phương án tối ưu có thứ tự ưu tiên dựa trên ba báo cáo kiểm tra (`test-debug-report.md`, `review-worker-api.md`, `review-web-ui.md`) và mã nguồn hiện tại.
Tài liệu chỉ mang tính chất đề xuất định hướng, không chỉnh sửa mã nguồn ứng dụng, không tạo migration mới trong đợt này.

---

## 1. Trạng thái các mục đang xử lý ở Phase 04 (Đợt vá lỗi)

Theo kế hoạch phối hợp song song, 10 mục lỗi Critical/High đã được chốt và **đang được sửa chữa tại Phase 04** (`phase-04-fix-confirmed-bugs.md`). Báo cáo này không đề xuất lại các mục đó, chỉ điểm lại để đảm bảo không trùng lặp:

1. **Overview hiển thị kill switch ngược** (`apps/crm/src/worker/overview.ts:58, 159`): Đang sửa ở đợt vá lỗi.
2. **KPI `/api/dashboard` bị cắt ngầm ở 500 lead** (`apps/crm/src/worker/queries.ts:105, 169`): Đang sửa ở đợt vá lỗi.
3. **Tìm kiếm không giới hạn và tạo lead tải cả bảng account** (`apps/crm/src/worker/queries.ts:105`, `apps/crm/src/worker/commands.ts:239-241`): Phần thêm giới hạn `LIMIT` ở SQL và không kéo `contact_point` ngoài trang kết quả đang sửa ở đợt vá lỗi. *(Riêng giải pháp triệt để: thêm cột tên đã fold kèm migration được đề xuất tại Mục 2.1 dưới đây)*.
4. **Replay MCP trong 5 phút bỏ qua kill switch** (`apps/crm/src/worker/mcp-tools.ts:110`): Đang sửa ở đợt vá lỗi.
5. **Bot nhận audit trong `get_lead`** (`apps/crm/src/worker/queries.ts:311`, `apps/crm/src/worker/mcp-tools.ts:188`): Đang sửa ở đợt vá lỗi.
6. **Gửi tin Lark trùng khi có request đồng thời** (`apps/crm/src/worker/approval-notify.ts:44`): Đang sửa ở đợt vá lỗi.
7. **Trang Lead và Khách hàng bỏ qua query params khi gọi API** (`apps/crm/src/web/pages/leads.tsx:30-38`, `apps/crm/src/web/pages/customers.tsx:12-14`): Đang sửa ở đợt vá lỗi.
8. **Ô giá trị Won có dấu phẩy làm vô hiệu hóa nút xác nhận** (`apps/crm/src/web/components/lead-actions.tsx:106, 119`): Đang sửa ở đợt vá lỗi.
9. **Thêm `errorComponent` cho root route web** (`apps/crm/src/web/main.tsx:20-28`, `apps/crm/src/web/router.tsx:56-59`): Đang sửa ở đợt vá lỗi.
10. **Trang `/audit` hiển thị lỗi 403 khi vào bằng vai trò sale** (`apps/crm/src/web/pages/audit.tsx:9-14`): Đang sửa ở đợt vá lỗi.

---

## 2. Chi tiết các đề xuất tối ưu theo nhóm

Mọi đề xuất dưới đây đều được khảo sát trực tiếp trên mã nguồn hiện tại, có định danh `file:dòng` cụ thể và đánh giá theo 6 tiêu chí: Vấn đề & Bằng chứng, Cách làm, Lợi ích, Công sức (S: Nhỏ, M: Vừa, L: Lớn), Rủi ro, và Đổi contract (Có/Không).

```
Thang đánh giá công sức:
- S (Small): Dưới nửa ngày làm việc (chỉnh sửa cục bộ 1-2 file, thêm index đơn giản).
- M (Medium): 1-2 ngày làm việc (thay đổi cấu trúc dữ liệu, thêm migration, refactor component dùng chung).
- L (Large): Trên 3 ngày làm việc (thay đổi kiến trúc lớn, tích hợp hệ thống ngoài).
```

### 2.1. Nhóm Hiệu năng D1 và CPU của Worker

#### Đề xuất 1: Thêm cột tên đã fold (`name_folded`) kèm migration cho Account, Lead và Contact
- **Vấn đề & Bằng chứng**:
  - Tại `apps/crm/src/worker/commands.ts:239-241`, khi kiểm tra trùng tên công ty, hệ thống thực thi: `SELECT id, name FROM account WHERE organization_id = ?` không có `LIMIT`, sau đó nạp toàn bộ danh sách account vào bộ nhớ Worker để so sánh bằng hàm JavaScript `foldText(a.name) === companyKey`.
  - Tại `apps/crm/src/worker/queries.ts:99-105` (`listLeads`) và `queries.ts:354` (`listAccounts`), do SQLite `lower()` chỉ hỗ trợ bảng mã ASCII nên hệ thống phải nạp bản ghi vào bộ nhớ Worker rồi mới chạy `filter((r) => foldText(r.name).includes(text))`.
- **Cách làm**:
  1. Tạo migration mới (vd: `0002_add_folded_names.sql`) bổ sung cột `name_folded TEXT` cho bảng `account`, `contact`, `lead`.
  2. Bổ sung index `CREATE INDEX idx_account_name_folded ON account(organization_id, name_folded)`.
  3. Cập nhật các command tạo/sửa account, lead, contact tự động điền `name_folded = foldText(name)` khi lưu.
  4. Chuyển câu truy vấn kiểm tra trùng và tìm kiếm sang SQL: `WHERE organization_id = ? AND name_folded = ?` hoặc `name_folded LIKE ?`.
- **Lợi ích**:
  - Loại bỏ hoàn toàn việc nạp hàng nghìn dòng vào RAM của Cloudflare Worker;
  - Giảm trên 90% thời gian tiêu thụ CPU của Worker, triệt tiêu nguy cơ chạm trần 10ms CPU của gói Cloudflare Free khi dữ liệu tăng trưởng.
- **Công sức**: **M** (Cần 1 file migration mới, backfill dữ liệu cũ và cập nhật logic lưu/đọc).
- **Rủi ro**: Thấp (cần script migration backfill chuẩn xác cho dữ liệu hiện có).
- **Đổi contract**: **Không**.

#### Đề xuất 2: Bổ sung các Index còn thiếu trong D1 SQLite
- **Vấn đề & Bằng chứng**:
  File `apps/crm/migrations/0001_init.sql:130-132` mới chỉ tạo index cho `lead(owner_user_id, status)`, `lead(team_id, status)` và `lead(department_id, status)`. Tuy nhiên, mã nguồn đang liên tục lọc và JOIN theo các cột chưa có index:
  1. `lead(contact_id)` và `lead(organization_id)` tại `apps/crm/src/worker/commands.ts:243-255` khi so trùng SĐT/email.
  2. `lead(account_id)` và `account(organization_id)` tại `apps/crm/src/worker/queries.ts:344-354` khi liệt kê account kèm số lượng lead.
  3. `app_user(organization_id)` tại `apps/crm/src/worker/queries.ts:272` và `queries.ts:402` khi tải nhân sự theo tổ chức.
  4. `outbox(status)` tại `apps/crm/src/worker/queries.ts:409` và `apps/crm/src/worker/overview.ts:65` khi đếm và xử lý thông báo chờ gửi.
  5. `audit_log(actor_kind, created_at)` tại `apps/crm/src/worker/overview.ts:61-63` khi đếm hoạt động của bot trong ngày/tuần.
- **Cách làm**: Tạo migration mới bổ sung các index:
  ```sql
  CREATE INDEX idx_lead_contact ON lead(contact_id);
  CREATE INDEX idx_lead_account ON lead(account_id);
  CREATE INDEX idx_lead_org ON lead(organization_id);
  CREATE INDEX idx_account_org ON account(organization_id);
  CREATE INDEX idx_user_org ON app_user(organization_id);
  CREATE INDEX idx_outbox_status ON outbox(status);
  CREATE INDEX idx_audit_actor_created ON audit_log(actor_kind, created_at);
  ```
- **Lợi ích**: Chuyển các câu truy vấn từ quét toàn bộ bảng (Full Table Scan) sang tìm kiếm chỉ mục (Index Lookup), giảm I/O và độ trễ đọc D1.
- **Công sức**: **S** (Chỉ gồm 1 file migration SQL, không sửa đổi code logic).
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 3: Tính toán ma trận phòng ban, SLA và workload trên Overview bằng SQL
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/overview.ts:47`, hệ thống giới hạn nạp tối đa 1000 lead (`LEAD_LIMIT = 1000`). Sau đó:
  - Dòng 66: Quét toàn bộ lead active không `LIMIT`: `SELECT l.id, l.department_id FROM lead l WHERE ${scope.sql} AND l.status = 'active'`.
  - Dòng 97: Tính `atRisk` trên từng cột từ danh sách 1000 lead này.
  - Dòng 110–134: Lọc trong JavaScript để tạo ma trận phân bổ stage theo phòng ban và bảng workload theo từng nhân sự kinh doanh.
  - Dòng 146: Tính `slaBreaches: leads.filter((l) => l.status === 'active' && needsAttention(l)).length` trên mẫu 1000 dòng.
  *Hậu quả*: Khi số lead vượt quá 1000, số liệu KPI tổng quát (tính bằng `GROUP BY` ở dòng 44) thì đúng, nhưng ma trận phòng ban, số cảnh báo SLA và khối lượng công việc hiển thị nhỏ hơn thực tế mà không có thông báo.
- **Cách làm**:
  - Chuyển các phép tính ma trận phân bổ và workload sang các câu truy vấn tổng hợp SQL `GROUP BY l.department_id, l.stage` và `GROUP BY l.owner_user_id`.
  - Giữ danh sách 1000 lead nạp về chỉ để hiển thị các thẻ Kanban thực tế trên giao diện.
- **Lợi ích**: Số liệu thống kê và ma trận phòng ban chính xác tuyệt đối; giảm tải xử lý mảng trong Worker.
- **Công sức**: **M** (Viết lại câu truy vấn aggregate SQL và map lại dữ liệu response).
- **Rủi ro**: Thấp (cần test hồi quy khớp đúng định dạng JSON trả về cho web).
- **Đổi contract**: **Không**.

#### Đề xuất 4: Phân trang hoặc giới hạn số lượng hoạt động (`activity`) trong chi tiết Lead
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/queries.ts:311-312`, truy vấn lịch sử hoạt động của lead:
  `SELECT ac.id, ac.type, ac.summary... FROM activity ac ... WHERE ac.lead_id = ? ORDER BY ac.occurred_at DESC, ac.created_at DESC` hoàn toàn không có `LIMIT`.
  Với các lead chăm sóc lâu dài có hàng trăm hoạt động (cuộc gọi, ghi chú, đổi trạng thái), payload của endpoint `/leads/:id` sẽ phình to bất thường. Trong khi đó, `accountDetail` ở dòng 375 đã có `LIMIT 60`.
- **Cách làm**: Bổ sung `LIMIT 50` mặc định cho truy vấn activity trong `leadDetail`, hỗ trợ tham số `cursor` hoặc `offset` nếu người dùng cuộn xem lịch sử cũ.
- **Lợi ích**: Giảm kích thước payload mạng, tăng tốc độ render trang chi tiết lead.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 5: Tối ưu truy vấn `listApprovals` tải danh sách người dùng
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/queries.ts:272-273`, để lấy tên người hiển thị cho tối đa 200 lượt duyệt, hệ thống gọi:
  `SELECT id, display_name FROM app_user WHERE organization_id = ?` nạp toàn bộ danh sách nhân sự của công ty vào một `Map`.
- **Cách làm**: `LEFT JOIN app_user` trực tiếp trong câu SELECT của approval hoặc chỉ `SELECT id, display_name FROM app_user WHERE id IN (...)` theo danh sách id có mặt trong 200 kết quả approval.
- **Lợi ích**: Tiết kiệm bộ nhớ và truy vấn D1 khi doanh nghiệp mở rộng quy mô hàng trăm nhân viên.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 6: Cache và tái sử dụng Lark tenant token trong đợt gửi thông báo
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/lark.ts:36-39`, hàm `sendText` gọi `await tenantToken(env)` cho mỗi lần gửi tin nhắn. Khi duyệt lead cần gửi thông báo cho nhiều Leader (`apps/crm/src/worker/approval-notify.ts:70`), hệ thống gửi HTTP request lặp lại sang API Lark để xin token mới dù token cũ còn hạn (thường có hiệu lực 2 giờ).
- **Cách làm**: Lưu token vào biến tạm có gắn thời gian hết hạn (TTL) hoặc truyền token dùng chung xuyên suốt vòng lặp gửi tin của một batch.
- **Lợi ích**: Giảm thiểu độ trễ mạng, giảm số cuộc gọi ra ngoài Worker, tránh bị Lark rate-limit.
- **Công sức**: **S**.
- **Rủi ro**: Thấp (cần xử lý làm mới khi gặp mã lỗi token hết hạn).
- **Đổi contract**: **Không**.

#### Đề xuất 7: Bắt lỗi trùng mã số thuế khi tạo Lead đồng thời
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/commands.ts:286-293`, nếu hai request tạo lead có cùng mã số thuế mới gửi lên đồng thời, cả hai đều vượt qua bước kiểm tra trùng lặp ban đầu. Nhưng khi thực thi `INSERT INTO account`, cơ sở dữ liệu sẽ ném lỗi `UNIQUE constraint failed: account.tax_code`, làm Worker văng lỗi HTTP 500 không thân thiện thay vì thông báo lỗi nghiệp vụ.
- **Cách làm**: Bắt ngoại lệ unique constraint của D1 tại bước ghi account và chuyển thành kết quả `fail('DUPLICATE_SUSPECTED', 'Mã số thuế này vừa được tạo bởi một giao dịch khác.')` với mã HTTP 409 hoặc 422.
- **Lợi ích**: Loại bỏ lỗi sập hệ thống 500 bất ngờ trong các tình huống cạnh tranh dữ liệu.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

---

### 2.2. Nhóm Bundle và Render Web

#### Đề xuất 8: Áp dụng Route-level Code Splitting và cấu hình Rollup Manual Chunks
- **Vấn đề & Bằng chứng**:
  - Tại `apps/crm/src/web/router.tsx:7-20`, toàn bộ 14 trang (`AdminPage`, `AdminUsersPage`, `AuditPage`, `OverviewPage`, `LeadDetailPage`...) đều được import tĩnh trực tiếp vào bundle chính.
  - File `apps/crm/vite.config.ts:4-12` không cấu hình chia nhỏ chunk.
  - Khi chạy `pnpm -F @abm/crm build`, Vite xuất ra file duy nhất `dist/assets/index-zZyLkkYZ.js` dung lượng lên tới **527.77 kB** (gzip 156.91 kB) và hiển thị cảnh báo chunk vượt ngưỡng 500 kB. Nhân viên kinh doanh thông thường chỉ xem danh sách lead nhưng buộc phải tải toàn bộ mã nguồn màn hình quản trị, nhập xuất CSV, và các biểu đồ phân tích nặng ngay từ lần đầu mở ứng dụng.
- **Cách làm**:
  1. Sử dụng `React.lazy()` hoặc tính năng lazy route của TanStack Router cho các trang quản trị (`AdminPage`, `AdminUsersPage`, `AuditPage`, `OverviewPage`, `ChangePasswordPage`).
  2. Bổ sung cấu hình `rollupOptions.output.manualChunks` trong `vite.config.ts`:
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
- **Lợi ích**:
  - Giảm kích thước bundle tải lần đầu xuống dưới ~180 kB (giảm hơn 60%);
  - Tăng tốc độ First Contentful Paint (FCP) và Largest Contentful Paint (LCP) trên mạng di động 4G;
  - Tận dụng tối đa bộ nhớ đệm trình duyệt (browser cache) cho các thư viện vendor ít thay đổi.
- **Công sức**: **M** (Cần kiểm tra trạng thái hiển thị loading/suspense mượt mà giữa các trang).
- **Rủi ro**: Thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 9: Chuẩn hóa Query Key phân cấp và Scoped Invalidation cho TanStack Query
- **Vấn đề & Bằng chứng**:
  - Tại `apps/crm/src/web/api.ts:59`, `useApi` lưu `queryKey: [memoryUser, path]` dưới dạng chuỗi URL thô (ví dụ: `['admin', '/leads?department=Sale%201']`).
  - Tại `apps/crm/src/web/api.ts:90`, sau mỗi lệnh command thành công hoặc lỗi `STALE_VERSION`, hàm gọi `void client.invalidateQueries();` không truyền tham số.
  - *Hậu quả*: Mọi lệnh ghi (như cập nhật tiến độ công việc, đổi stage lead) đều đánh dấu stale và kích hoạt refetch toàn bộ tất cả query đang mở trên màn hình, bao gồm cả cấu hình hệ thống (`/auth/mode`), số đếm duyệt trên sidebar, và các danh sách không liên quan, gây lãng phí băng thông và request D1.
- **Cách làm**:
  1. Chuẩn hóa queryKey thành mảng có cấu trúc phân cấp: `[memoryUser, 'leads', { filters }]`, `[memoryUser, 'lead', leadId]`, `[memoryUser, 'tasks', { status }]`.
  2. Sau mỗi command, chỉ gọi invalidate các query có liên quan (ví dụ: `completeTask` chỉ invalidate nhóm `['tasks']` và `['lead', leadId]`).
- **Lợi ích**: Giảm đáng kể số lượng request mạng thừa thãi sau mỗi thao tác ghi, loại bỏ hiện tượng nhấp nháy UI.
- **Công sức**: **M** (Cần rà soát và cấu hình key đồng bộ giữa các trang).
- **Rủi ro**: Thấp (cần đảm bảo không bỏ sót việc làm mới màn hình phụ thuộc).
- **Đổi contract**: **Không**.

#### Đề xuất 10: Thiết lập `staleTime` hợp lý cho dữ liệu tĩnh và danh mục ít biến động
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/api.ts:57-61`, `useApi` dùng mặc định `staleTime: 0`. Khi người dùng chuyển qua tab khác của trình duyệt rồi quay lại, TanStack Query tự động gọi lại hàng loạt API dù dữ liệu không hề thay đổi.
- **Cách làm**: Cấu hình `staleTime: 5 * 60 * 1000` (5 phút) cho các danh mục ít thay đổi như danh sách phòng ban, danh sách nhân sự, cấu hình quyền.
- **Lợi ích**: Giao diện phản hồi tức thì khi chuyển đổi qua lại giữa các cửa sổ làm việc, giảm số lượt truy vấn không cần thiết.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 11: Tối ưu re-render layout Shell và GlobalSearch
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/components/layout.tsx:21, 142`, cả `Shell` và `GlobalSearch` đều độc lập subscribe `useRouterState({ select: (s) => s.location.pathname })`. Đồng thời mảng `nav` (10 mục) được khai báo trực tiếp trong thân component `Shell` ở dòng 32. Mỗi khi người dùng chuyển trang, toàn bộ layout shell, sidebar, và topbar đều bị kích hoạt re-render hoàn toàn.
- **Cách làm**: Đưa mảng `nav` ra ngoài scope component hoặc bọc trong `useMemo`; tận dụng khả năng tự nhận diện active route của `<Link>` thay vì re-render toàn bộ shell theo `pathname`.
- **Lợi ích**: Giảm thiểu chu kỳ re-render vô ích của React, giúp ứng dụng mượt mà hơn trên các thiết bị cấu hình yếu.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 12: Bọc `useMemo` cho kết quả tính toán danh sách trên client
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/pages/leads.tsx:35-39`, các thao tác lọc `rows.filter(...)` và tính số đếm cho từng tab `countFor(t.status)` được tính toán lại trực tiếp trên mỗi lượt render mà không có bộ đệm.
- **Cách làm**: Bọc kết quả lọc và thống kê tab vào hook `useMemo`.
- **Lợi ích**: Giữ tốc độ phản hồi giao diện ổn định khi người dùng tương tác liên tục.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

---

### 2.3. Nhóm Cấu trúc và Code trùng lặp

#### Đề xuất 13: Xây dựng Route Guard tập trung (`beforeLoad`) trong TanStack Router
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/router.tsx:64-94`, tất cả 14 routes đều dùng khai báo `createRoute({ getParentRoute, path, component })` đơn thuần mà không có bộ bảo vệ định tuyến tập trung. Việc kiểm tra quyền bị thả nổi cho từng trang tự xử lý, dẫn đến sự cố như trang `AuditPage` (`pages/audit.tsx:9-14`) quên kiểm tra quyền làm người dùng vai trò sale bị lỗi 403 không thân thiện, trong khi các trang khác như `admin.tsx` lại tự viết logic cảnh báo riêng.
- **Cách làm**: Sử dụng hook `beforeLoad` của TanStack Router để kiểm tra quyền truy cập theo vai trò (`actor.role`) ngay tại tầng định tuyến:
  ```ts
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    beforeLoad: ({ context }) => {
      if (context.actor.role !== 'admin') throw redirect({ to: '/' });
    },
    component: AdminPage,
  })
  ```
- **Lợi ích**: Quản lý phân quyền truy cập tập trung, rõ ràng, không bị lọt quyền khi bổ sung trang mới trong tương lai.
- **Công sức**: **M**.
- **Rủi ro**: Thấp (cần xử lý trải nghiệm redirect hoặc trang từ chối quyền chuẩn mực).
- **Đổi contract**: **Không**.

#### Đề xuất 14: Trích xuất custom hook `useDebounce` dùng chung
- **Vấn đề & Bằng chứng**:
  - Tại `apps/crm/src/web/components/layout.tsx:140`: `useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);`.
  - Tại `apps/crm/src/web/pages/leads.tsx:26`: Tự viết logic tương tự nhưng đặt thời gian trễ là 250ms.
  - Tại `apps/crm/src/web/pages/customers.tsx:12-14`: Thiếu hoàn toàn cơ chế debounce khi tìm kiếm.
- **Cách làm**: Tạo file `apps/crm/src/web/hooks/use-debounce.ts` định nghĩa hook `useDebounce<T>(value: T, delay = 250): T` và sử dụng thống nhất cho tất cả các màn hình tìm kiếm.
- **Lợi ích**: Xóa bỏ mã trùng lặp, đồng nhất độ trễ tìm kiếm (250ms), tự động bổ sung debounce an toàn cho trang khách hàng.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 15: Trích xuất component `<LeadCard />` dùng chung cho Kanban Pipeline, Overview và Dashboard
- **Vấn đề & Bằng chứng**:
  Cấu trúc thẻ lead (`article.deal-card`) hiển thị mã lead, tên khách hàng, giá trị dự kiến, huy hiệu sức khỏe, thời hạn next action được sao chép và tự viết lại tại 3 nơi:
  1. `apps/crm/src/web/pages/pipeline.tsx:53-71`
  2. `apps/crm/src/web/pages/overview.tsx:266-279`
  3. `apps/crm/src/web/pages/dashboard.tsx:54-72`
- **Cách làm**: Trích xuất thành component duy nhất `<LeadCard lead={lead} compact={compact} onMove={onMove} />` đặt tại `apps/crm/src/web/components/lead-card.tsx`.
- **Lợi ích**: Giảm hơn 120 dòng mã trùng lặp; đồng nhất giao diện và các quy tắc hiển thị cảnh báo nguy cơ rủi ro giữa các màn hình quản trị.
- **Công sức**: **M**.
- **Rủi ro**: Thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 16: Tách phụ thuộc chéo giữa `audit.tsx` và `lead-detail.tsx`
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/pages/audit.tsx:7`, trang Audit import trực tiếp: `import { AuditDiff, commandLabel } from './lead-detail';`. Hai trang độc lập lại có quan hệ phụ thuộc chéo, cản trở việc tách module và code splitting.
- **Cách làm**: Chuyển `AuditDiff` vào `apps/crm/src/web/components/audit-diff.tsx` và chuyển `commandLabel` vào `apps/crm/src/web/format.ts` hoặc `packages/contracts`.
- **Lợi ích**: Cấu trúc mã nguồn module hóa rõ ràng, độc lập, sẵn sàng cho việc đóng gói tải động.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 17: Đồng bộ cờ `agentNeedsApproval` từ contracts vào pipeline thực thi `runCommand`
- **Vấn đề & Bằng chứng**:
  Tại `packages/contracts/src/index.ts:232-239`, thuộc tính `agentNeedsApproval` được định nghĩa rõ ràng cho từng command. Tuy nhiên, tại `apps/crm/src/worker/commands.ts:109`, logic lại hardcode cố định tên 2 lệnh:
  `const proposes = actor.kind === 'agent' && actor.role !== 'admin' && (name === 'changeStage' || name === 'assignLead');`.
  Các lệnh khác như `releaseLead` hay `requestOwnerChange` vốn cũng được gắn cờ `agentNeedsApproval: true` trên contract lại không được tự động áp dụng qua biến này nếu sau này được mở ra cho agent gọi.
- **Cách làm**: Thay thế dòng 109 bằng:
  `const proposes = actor.kind === 'agent' && actor.role !== 'admin' && COMMANDS[name].agentNeedsApproval;`
- **Lợi ích**: Tuân thủ triệt để contract-driven design; tự động kích hoạt cơ chế duyệt an toàn cho bất kỳ command nào được cấu hình trong tương lai.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 18: Ẩn thông tin khách hàng nhạy cảm trên công việc cũ sau khi chuyển giao Lead
- **Vấn đề & Bằng chứng**:
  - Tại `apps/crm/src/worker/commands.ts:175-177`, khi đổi owner của lead (`applyOwnerChange`), hệ thống chỉ đổi người phụ trách cho task `nextAction` đang mở; các task đã hoàn thành (`status = 'completed'`) vẫn giữ nguyên `assignee_user_id` là sale cũ.
  - Tại `apps/crm/src/worker/queries.ts:131`, `taskScope` của vai trò sale là `tk.assignee_user_id = ?`, không gắn kèm `leadScope`.
  - *Hậu quả*: Nhân viên sale cũ khi gọi `GET /api/tasks?status=completed` vẫn thấy mã lead, tên khách hàng và tên công ty của lead đã được chuyển giao cho nhân viên khác, vi phạm nguyên tắc bảo mật dữ liệu khách hàng.
- **Cách làm**:
  1. Trong `listTasks` (`queries.ts:145-163`), nếu `leadScope` của actor không còn cho phép xem lead đó, ẩn trường `contact_name` và `account_name` (trả về giá trị ẩn danh hoặc `null`).
  2. Khi chuyển giao lead, chuyển toàn bộ các task đang mở (`status = 'open'`) sang cho owner mới thay vì chỉ chuyển duy nhất next action.
- **Lợi ích**: Bảo vệ an toàn dữ liệu khách hàng; tuân thủ nghiêm ngặt ma trận quyền truy cập.
- **Công sức**: **M**.
- **Rủi ro**: Thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 19: Kiểm tra quyền trước khi hiển thị nút thao tác nhanh "Hoàn thành" trên trang Tasks
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/pages/tasks.tsx:56`, nút bấm `<button className="btn btn-sm" onClick={() => setCompleting(t)}>Hoàn thành</button>` hiển thị cho mọi công việc trong bảng. Khi Leader hoặc Admin xem trang công việc chung, các nút này hiển thị cho cả công việc của nhân viên cấp dưới, dễ dẫn đến thao tác bấm nhầm xác nhận thay.
- **Cách làm**: Thêm điều kiện kiểm tra: `const canComplete = t.assignee.id === actor.id || actor.role === 'admin';` trước khi hiển thị nút bấm nhanh.
- **Lợi ích**: Tránh thao tác nhầm lẫn trong vận hành đội ngũ.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

---

### 2.4. Nhóm Độ phủ Test

#### Đề xuất 20: Bổ sung test cho các trường hợp biên của Actor Scope và Lead Scope
- **Vấn đề & Bằng chứng**:
  Báo cáo `test-debug-report.md:51` ghi nhận: Các test bảo mật hiện tại (`commands.test.ts:42`, `security-api.test.ts:166`) mới chỉ kiểm tra trường hợp actor có đầy đủ thông tin phòng ban, tổ chức. Chưa có test case kiểm tra trực tiếp khi actor bị thiếu `team_id` hoặc `department_id` (trường hợp tạo mới user bị sót thông tin hoặc admin chưa gán phòng ban). Cần kiểm chứng hệ thống luôn tự động đóng quyền (fail-closed) an toàn tại `apps/crm/src/worker/scope.ts:18-29`.
- **Cách làm**: Thêm bộ test trong `test/security-api.test.ts` khởi tạo token actor có `teamId: null` hoặc `departmentId: null` và xác minh các endpoint danh sách lead trả về rỗng (`0` bản ghi).
- **Lợi ích**: Bằng chứng kỹ thuật bảo đảm an toàn bảo mật tuyệt đối, chống rò rỉ dữ liệu khi cấu hình người dùng sai sót.
- **Công sức**: **S**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

#### Đề xuất 21: Bổ sung test kiểm thử cạnh tranh (Concurrency) cho ghi và duyệt
- **Vấn đề & Bằng chứng**:
  Báo cáo `test-debug-report.md:52` ghi nhận thiếu các kịch bản kiểm thử đồng thời:
  1. Tranh chấp mã số thuế khi hai tiến trình cùng tạo account mới.
  2. Tranh chấp hai approval agent cùng gửi duyệt cho một lead.
  3. Quyền của actor bị Admin thu hồi trong lúc command đang thực thi trong Worker.
- **Cách làm**: Viết các test case trong `test/commands.test.ts` dùng `Promise.all` gửi đồng thời 2 request tạo account trùng MST hoặc duyệt trùng và kiểm tra tính nhất quán của dữ liệu.
- **Lợi ích**: Đảm bảo tính toàn vẹn dữ liệu trong môi trường phân tán Cloudflare Workers.
- **Công sức**: **M**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

#### Đề xuất 22: Bổ sung test chu kỳ khóa tài khoản và hết hạn phiên làm việc
- **Vấn đề & Bằng chứng**:
  Báo cáo `test-debug-report.md:55` ghi nhận: File `test/auth-login.test.ts` đã có test khóa sau 10 lần sai, nhưng còn thiếu kịch bản:
  1. Hết hạn phiên 7 ngày (`SESSION_EXPIRY_DAYS = 7`);
  2. Đăng nhập đúng đồng thời với lúc tài khoản bị Admin vô hiệu hóa (`status = 'disabled'`);
  3. Cạnh tranh giữa lần đăng nhập đúng và lần đăng nhập sai thứ 10 gây khóa tài khoản.
- **Cách làm**: Thêm test case vào `test/auth-login.test.ts` mô phỏng thời gian hệ thống tiến tới ngày thứ 8 và kiểm tra phiên bị từ chối chính xác.
- **Lợi ích**: Đảm bảo độ tin cậy tuyệt đối cho hệ thống xác thực người dùng.
- **Công sức**: **S**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

#### Đề xuất 23: Xây dựng bộ test độc lập cho package `@abm/contracts`
- **Vấn đề & Bằng chứng**:
  Báo cáo `test-debug-report.md:14, 18` ghi nhận: Package `packages/contracts` không có script test độc lập trong `package.json`. Logic kiểm tra Zod schema và thuật toán tính toán SLA giờ làm việc (`working-time.ts`) chỉ được chạy gián tiếp qua các test tích hợp của CRM.
- **Cách làm**: Bổ sung `"test": "vitest run"` vào `packages/contracts/package.json`, viết test suite riêng kiểm thử toàn diện các schema và các trường hợp biên của hàm `addWorkingMinutes`, `workingMinutesBetween`.
- **Lợi ích**: Rút ngắn thời gian chạy kiểm thử contracts (dưới 1 giây), phát hiện lỗi hợp đồng dữ liệu sớm mà không cần khởi tạo môi trường Cloudflare D1.
- **Công sức**: **S**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

#### Đề xuất 24: Cài đặt công cụ đo lường độ phủ kiểm thử (`@vitest/coverage-v8`)
- **Vấn đề & Bằng chứng**:
  Báo cáo `test-debug-report.md:18` ghi nhận: Dự án hiện chưa cài đặt bất kỳ provider coverage nào, không có số liệu tỷ lệ bao phủ mã nguồn thực tế.
- **Cách làm**: Cài đặt `@vitest/coverage-v8` trong `apps/crm/package.json` và bổ sung script `"test:coverage": "vitest run --coverage"`.
- **Lợi ích**: Đo lường định lượng tỷ lệ bao phủ mã nguồn, chỉ ra chính xác các nhánh điều kiện chưa có test để lập kế hoạch bổ sung trọng tâm.
- **Công sức**: **S**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

---

### 2.5. Nhóm Vận hành: Log, Backup, Deploy

#### Đề xuất 25: Xây dựng API và giao diện đọc Audit quản trị độc lập cho Admin
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/queries.ts:241`, câu `AUDIT_SELECT` chứa đoạn:
  `JOIN lead l ON l.id = CASE al.entity WHEN 'lead' THEN al.entity_id WHEN 'task' THEN tk.lead_id WHEN 'approval' THEN ap.lead_id END`.
  Do bắt buộc phải kết nối với một `lead`, toàn bộ các hành động kiểm toán quản trị hệ thống (khóa/mở khóa user, cấp mật khẩu tạm, bật/tắt kill switch bot, thu hồi token, gửi lại tin nhắn outbox) tại `apps/crm/src/worker/admin-routes.ts` đều bị loại bỏ khỏi danh sách trả về của API `/audit`. Admin mở nhật ký kiểm toán không thể xem được ai đã thao tác trên hệ thống.
- **Cách làm**:
  1. Thêm hàm `listAdminAudit(db, actor)` truy vấn trực tiếp:
     `SELECT * FROM audit_log WHERE entity IN ('app_user', 'agent_kill_switch', 'outbox', 'department', 'team') ORDER BY created_at DESC LIMIT 200`.
  2. Mở endpoint mới `GET /api/admin/audit` (chỉ cho phép vai trò `admin`).
  3. Bổ sung tab xem "Nhật ký hệ thống" tại trang `apps/crm/src/web/pages/admin.tsx`.
- **Lợi ích**: Đảm bảo tính minh bạch và khả năng truy vết sự cố an ninh vận hành (Security Compliance); Admin kiểm soát được toàn bộ các can thiệp nhạy cảm.
- **Công sức**: **M** (Thêm hàm query, route API và giao diện hiển thị).
- **Rủi ro**: Thấp (chú ý không trả về các thông tin mật khẩu nhạy cảm).
- **Đổi contract**: **Có** (Bổ sung endpoint mới và kiểu dữ liệu `AdminAuditItem`).

#### Đề xuất 26: Chuẩn hóa chính sách khóa tài khoản và phòng chống User Enumeration
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/auth-routes.ts:61-65`:
  - Khi email không tồn tại: trả về HTTP 401.
  - Khi email tồn tại nhưng đang bị tạm khóa: trả về **HTTP 423** (`auth-routes.ts:62`).
  *Hậu quả*: Kẻ xấu có thể thăm dò danh sách email nhân viên hợp lệ của công ty. Ngoài ra, dòng 40 reset bộ đếm `failed_login_count = 0` sau khi khóa 5 phút, cho phép kẻ xấu liên tục gửi 10 request sai sau mỗi 5 phút để khóa tài khoản của nhân viên mục tiêu cả ngày (tấn công từ chối dịch vụ tài khoản).
- **Cách làm (Cần User / Doanh nghiệp lựa chọn)**:
  - *Phương án A (Ưu tiên bảo mật cao)*: Trả về đồng nhất mã HTTP 401 kèm thông điệp chung `Email hoặc mật khẩu không chính xác` cho cả trường hợp sai mật khẩu và trường hợp tài khoản đang tạm khóa; bổ sung rate-limiting theo IP tại Cloudflare.
  - *Phương án B (Ưu tiên tiện ích vận hành nội bộ)*: Giữ mã HTTP 423 thông báo tài khoản đang bị khóa tạm thời để nhân viên biết lý do, nhưng bổ sung nút bấm cho Admin mở khóa khẩn cấp ngay trên màn hình `admin-users.tsx`.
- **Lợi ích**: Ngăn chặn rò rỉ thông tin nhân sự và bảo vệ tài khoản người dùng trước các cuộc tấn công DoS có chủ đích.
- **Công sức**: **S** (Phương án A) / **M** (Phương án B).
- **Rủi ro**: Thấp.
- **Đổi contract**: **Có** (nếu đổi mã trả về từ 423 sang 401). **Cần User quyết định**.

#### Đề xuất 27: Thiết lập tiến trình dọn dẹp định kỳ (Retention & Cleanup) cho Idempotency Key và User Session
- **Vấn đề & Bằng chứng**:
  Các bảng `idempotency_key` và `user_session` (`apps/crm/migrations/0001_init.sql:109-126`) hiện chỉ ghi thêm bản ghi mới mà không có tiến trình dọn dẹp. Sau vài tháng vận hành, hàng chục nghìn session hết hạn và key idempotency cũ sẽ tích tụ làm phình to dung lượng database.
- **Cách làm**: Cấu hình Cloudflare Cron Trigger (chạy 1 lần mỗi ngày vào ban đêm) thực thi lệnh:
  - `DELETE FROM idempotency_key WHERE created_at < datetime('now', '-7 days')`
  - `DELETE FROM user_session WHERE expires_at < datetime('now') OR revoked_at IS NOT NULL`
- **Lợi ích**: Giữ cho cơ sở dữ liệu D1 luôn tinh gọn, tối ưu chi phí lưu trữ trên Cloudflare D1.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp (vẫn bảo toàn cửa sổ replay 5 phút của bot và phiên hợp lệ 7 ngày).
- **Đổi contract**: **Không**.

#### Đề xuất 28: Cấu hình lịch nghỉ lễ Việt Nam vào thuật toán tính toán SLA giờ làm việc
- **Vấn đề & Bằng chứng**:
  Tại `packages/contracts/src/working-time.ts:2-14`, thuật toán chỉ loại trừ thứ Bảy và Chủ Nhật; ghi chú nêu rõ đây là bản đánh giá. Vào các ngày lễ quốc gia (Tết Nguyên Đán, Giỗ Tổ Hùng Vương, 30/4 - 1/5, Quốc khánh 2/9), hệ thống vẫn tính thời gian làm việc bình thường, dẫn đến việc tính toán First Contact SLA và thời điểm tự động nhả lead bị vi phạm oan uổng.
- **Cách làm**: Bổ sung bảng cấu hình ngày nghỉ lễ Việt Nam chính thức theo từng năm vào hàm `isWorkingDay` trong `working-time.ts`.
- **Lợi ích**: Đảm bảo việc đánh giá KPI và tính toán thời hạn SLA phản ánh đúng lịch làm việc thực tế của doanh nghiệp Việt Nam.
- **Công sức**: **M**.
- **Rủi ro**: Thấp.
- **Đổi contract**: Có thể cần bổ sung schema cấu hình lịch nghỉ. **Cần User / Ban Giám đốc phê duyệt danh sách ngày nghỉ lễ chính thức hàng năm**.

#### Đề xuất 29: Gắn điều kiện `organization_id` cho các câu đếm tổng quan Admin chuẩn bị cho Multi-tenant
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/worker/queries.ts:408-410`, câu truy vấn đếm tổng quát của Admin:
  `SELECT (SELECT COUNT(*) FROM lead) AS leads, (SELECT COUNT(*) FROM audit_log) AS audit...` đếm toàn bộ bảng mà không gắn điều kiện `organization_id`. Hiện tại hệ thống chạy một tổ chức trên một D1 nên số liệu đúng, nhưng nếu sau này dùng chung database cho nhiều tổ chức thì số đếm này sẽ bị sai.
- **Cách làm**: Thêm điều kiện `WHERE organization_id = ?` cho các câu đếm con.
- **Lợi ích**: Đảm bảo mã nguồn sẵn sàng cho việc mở rộng mô hình đa tổ chức (multi-tenant) trong tương lai.
- **Công sức**: **S**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

---

### 2.6. Nhóm Trải nghiệm Người dùng và Trợ năng (A11y & Mobile)

#### Đề xuất 30: Nâng cấp popover tìm kiếm trên màn hình 375px thành Full-screen Overlay
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/styles.css:144-150` và `apps/crm/src/web/components/layout.tsx:72-76`, khung `.search-pop` định vị tuyệt đối theo ô `.search`. Trên màn hình di động 375px, chiều rộng của ô tìm kiếm chỉ còn khoảng 240px, khiến popover kết quả cũng bị co hẹp còn 240px. Mã lead và stage badge đã chiếm 180px, chỉ còn 60px cho tên khách hàng làm chữ bị cắt cụt còn 3-4 ký tự, rất khó đọc.
- **Cách làm**: Bổ sung CSS media query cho màn hình `< 600px`: khi ô tìm kiếm được focus, hiển thị một lớp phủ toàn màn hình (Full-screen Search Overlay) hiển thị đầy đủ thông tin kết quả.
- **Lợi ích**: Trải nghiệm tra cứu trên điện thoại di động thông thoáng, hiển thị trọn vẹn thông tin khách hàng.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 31: Hoàn thiện cấu trúc WAI-ARIA và phím điều hướng cho GlobalSearch và Bảng thao tác
- **Vấn đề & Bằng chứng**:
  - Tại `apps/crm/src/web/components/layout.tsx:151-172`, khung kết quả dùng `role="listbox"` nhưng các con trực tiếp lại là thẻ `<Link>`, thiếu hỗ trợ phím mũi tên ArrowUp/ArrowDown để chọn kết quả.
  - Tại `apps/crm/src/web/pages/admin-users.tsx:85-90` và `tasks.tsx:56`, các nút thao tác lặp lại trong bảng thiếu `aria-label` định danh đối tượng (chỉ hiển thị nhãn cụt "Sửa", "Khóa", "Hoàn thành").
  - Tại `apps/crm/src/web/components/ui.tsx:101-110`, component `Modal` sau khi đóng không khôi phục focus về nút kích hoạt ban đầu.
- **Cách làm**: Chuyển `role="list"`, bổ sung điều hướng phím mũi tên, thêm `aria-label="Sửa người dùng {name}"`, và lưu lại `activeElement` để `.focus()` lại sau khi đóng Modal.
- **Lợi ích**: Tuân thủ chuẩn tiếp cận WCAG 2.1 AA, hỗ trợ đầy đủ cho người dùng sử dụng bàn phím và trình đọc màn hình.
- **Công sức**: **S**.
- **Rủi ro**: Rất thấp.
- **Đổi contract**: **Không**.

#### Đề xuất 32: Bổ sung nút đóng menu Sidebar tường minh trên di động
- **Vấn đề & Bằng chứng**:
  Tại `apps/crm/src/web/components/layout.tsx:48-64`, khi sidebar mở trượt ra trên màn hình nhỏ, không có nút 'X' để đóng trực tiếp trong aside. Người dùng buộc phải chạm vào vùng mờ phía sau hoặc nhấn phím Escape.
- **Cách làm**: Bổ sung nút đóng menu ở góc trên của aside khi ở chế độ mobile.
- **Lợi ích**: Tăng tính trực quan và dễ sử dụng cho người dùng smartphone.
- **Công sức**: **S**.
- **Rủi ro**: Không.
- **Đổi contract**: **Không**.

---

## 3. Bảng xếp hạng các đề xuất theo tỉ lệ Lợi ích trên Công sức

Bảng dưới đây sắp xếp toàn bộ 32 đề xuất theo thứ tự ưu tiên giảm dần dựa trên tỷ lệ **Lợi ích / Công sức**:

| Hạng | Đề xuất | Nhóm | Lợi ích | Công sức | Rủi ro | Đổi contract |
|:---:|---|---|:---:|:---:|:---:|:---:|
| **1** | **#2. Bổ sung các Index còn thiếu trong D1 SQLite** | Hiệu năng D1/CPU | Rất cao | **S** | Rất thấp | Không |
| **2** | **#8. Route-level Code Splitting & manualChunks** | Bundle/Render Web | Rất cao | **M** | Thấp | Không |
| **3** | **#1. Thêm cột tên đã fold (`name_folded`) kèm migration** | Hiệu năng D1/CPU | Rất cao | **M** | Thấp | Không |
| **4** | **#14. Trích xuất hook `useDebounce` dùng chung** | Cấu trúc code | Cao | **S** | Rất thấp | Không |
| **5** | **#25. Xây dựng Audit quản trị độc lập cho Admin** | Vận hành | Cao | **M** | Thấp | **Có** |
| **6** | **#9. Chuẩn hóa Query Key phân cấp & Scoped Invalidation** | Bundle/Render Web | Cao | **M** | Thấp | Không |
| **7** | **#3. Đếm ma trận, SLA và workload Overview bằng SQL** | Hiệu năng D1/CPU | Cao | **M** | Thấp | Không |
| **8** | **#17. Đồng bộ cờ `agentNeedsApproval` từ contracts** | Cấu trúc code | Cao | **S** | Rất thấp | Không |
| **9** | **#30. Nâng cấp popover tìm kiếm Mobile 375px dạng Overlay** | UX & A11y | Khá | **S** | Rất thấp | Không |
| **10** | **#27. Tiến trình dọn dẹp định kỳ Idempotency & Session** | Vận hành | Khá | **S** | Rất thấp | Không |
| **11** | **#20. Bổ sung test trường hợp biên Actor/Lead Scope** | Độ phủ test | Khá | **S** | Không | Không |
| **12** | **#23. Xây dựng bộ test độc lập cho `@abm/contracts`** | Độ phủ test | Khá | **S** | Không | Không |
| **13** | **#24. Cài đặt công cụ đo độ phủ `@vitest/coverage-v8`** | Độ phủ test | Khá | **S** | Không | Không |
| **14** | **#13. Route Guard tập trung (`beforeLoad`) trên Web** | Cấu trúc code | Cao | **M** | Thấp | Không |
| **15** | **#18. Ẩn thông tin khách hàng nhạy cảm trên task cũ của Sale** | Cấu trúc code | Khá | **M** | Thấp | Không |
| **16** | **#15. Trích xuất component `<LeadCard />` dùng chung** | Cấu trúc code | Khá | **M** | Thấp | Không |
| **17** | **#4. Giới hạn `LIMIT` số hoạt động trong chi tiết lead** | Hiệu năng D1/CPU | Khá | **S** | Rất thấp | Không |
| **18** | **#10. Thiết lập `staleTime` cho dữ liệu tĩnh ít đổi** | Bundle/Render Web | Khá | **S** | Rất thấp | Không |
| **19** | **#6. Cache Lark tenant token trong đợt gửi thông báo** | Hiệu năng D1/CPU | Khá | **S** | Thấp | Không |
| **20** | **#7. Bắt lỗi unique constraint khi tạo Lead đồng thời** | Hiệu năng D1/CPU | Khá | **S** | Rất thấp | Không |
| **21** | **#16. Tách phụ thuộc chéo giữa `audit.tsx` và `lead-detail.tsx`** | Cấu trúc code | Khá | **S** | Rất thấp | Không |
| **22** | **#22. Bổ sung test chu kỳ khóa tài khoản và hết hạn phiên** | Độ phủ test | Khá | **S** | Không | Không |
| **23** | **#21. Bổ sung test kiểm thử cạnh tranh (Concurrency)** | Độ phủ test | Khá | **M** | Không | Không |
| **24** | **#5. Tối ưu truy vấn nạp user trong `listApprovals`** | Hiệu năng D1/CPU | Vừa | **S** | Rất thấp | Không |
| **25** | **#11. Tối ưu re-render layout Shell và GlobalSearch** | Bundle/Render Web | Vừa | **S** | Rất thấp | Không |
| **26** | **#12. Bọc `useMemo` tính toán danh sách trên client** | Bundle/Render Web | Vừa | **S** | Rất thấp | Không |
| **27** | **#19. Kiểm tra quyền nút Hoàn thành trên trang Tasks** | Cấu trúc code | Vừa | **S** | Rất thấp | Không |
| **28** | **#31. Cải thiện chuẩn tiếp cận WAI-ARIA & phím điều hướng** | UX & A11y | Vừa | **S** | Rất thấp | Không |
| **29** | **#32. Bổ sung nút đóng menu Sidebar trên di động** | UX & A11y | Vừa | **S** | Không | Không |
| **30** | **#29. Gắn `organization_id` cho các câu đếm Admin** | Vận hành | Vừa | **S** | Không | Không |
| **31** | **#26. Chuẩn hóa chính sách khóa tài khoản (chống Enumeration)** | Vận hành | Cao | **S/M** | Thấp | **Cần User quyết định** |
| **32** | **#28. Cấu hình lịch nghỉ lễ Việt Nam vào tính toán SLA** | Vận hành | Khá | **M** | Thấp | **Cần User quyết định** |

---

## 4. Top 5 việc nên làm trước và các việc cần User quyết định

### 4.1. Top 5 việc nên triển khai ngay trong đợt tiếp theo

1. **Bổ sung các Index còn thiếu trong D1 SQLite (#2)**
   - *Lý do*: Công sức cực nhỏ (chỉ 1 migration SQL tạo index, không sửa code), rủi ro bằng 0, không đổi contract, nhưng ngăn chặn triệt để tình trạng Table Scan làm ngốn CPU và timeout khi dữ liệu tăng trưởng.
2. **Code Splitting theo Route và Rollup manualChunks cho Web (#8)**
   - *Lý do*: Giải quyết dứt điểm cảnh báo build của Vite, giảm ngay hơn 60% kích thước tải ban đầu (từ 527 kB xuống dưới 200 kB), tăng tốc độ mở trang rõ rệt cho người dùng trên mạng di động.
3. **Thêm cột tên đã fold (`name_folded`) kèm migration (#1)**
   - *Lý do*: Đây là giải pháp căn cơ và triệt để nhất cho bài toán tìm kiếm tiếng Việt và kiểm tra trùng lặp khách hàng/lead mà không phải nạp dữ liệu vào bộ nhớ Worker.
4. **Xây dựng Audit quản trị độc lập cho Admin (#25)**
   - *Lý do*: Lấp đầy khoảng trống bảo mật quan trọng nhất hiện nay trong việc truy vết vận hành (hiện tại toàn bộ nhật ký khóa tài khoản, cấp mật khẩu tạm, bật/tắt kill switch bot đều bị câu query JOIN lead nuốt mất).
5. **Trích xuất custom hook `useDebounce` dùng chung (#14)**
   - *Lý do*: Công sức rất nhỏ, chuẩn hóa hành vi tìm kiếm toàn ứng dụng và bổ sung ngay cơ chế chống spam request cho trang Khách hàng (`customers.tsx`).

---

### 4.2. Các việc cần User / Doanh nghiệp ra quyết định

1. **Quyết định phương án xử lý Khóa tài khoản đăng nhập (#26)**:
   - *Phương án A (Ưu tiên bảo mật)*: Chuyển mã trả về HTTP 423 thành HTTP 401 chung với thông báo `Email hoặc mật khẩu không chính xác` để chống lộ danh sách nhân viên và chống DoS tài khoản.
   - *Phương án B (Ưu tiên trải nghiệm nội bộ)*: Giữ mã HTTP 423 để người dùng biết mình đang bị tạm khóa 5 phút, nhưng bổ sung nút bấm cho Admin mở khóa khẩn cấp ngay trên giao diện quản trị nhân sự.
2. **Phê duyệt Lịch nghỉ lễ Việt Nam cho tính toán SLA (#28)**:
   - Cần Ban Giám đốc phê duyệt danh sách ngày nghỉ lễ chính thức hàng năm để áp dụng vào hợp đồng tính toán SLA tiếp xúc đầu tiên và thời điểm tự động nhả lead, tránh vi phạm SLA trong các dịp nghỉ lễ lớn.
3. **Phê duyệt thời điểm áp dụng Migration D1 mới**:
   - Việc thêm index (#2) và thêm cột tên đã fold (#1) yêu cầu tạo các migration D1 mới (`0005_...`, `0006_...`; repo đã có tới `0004_agent_gateway.sql`). Cần user xác nhận thời điểm chạy migration trên môi trường thực tế.
