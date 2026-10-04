# Phase 01 — Đúng nghiệp vụ và API: báo cáo kiểm thử

Ngày: 2026-10-04 · Worker: claude · Baseline: commit 92cf488 · Cây làm việc: `D:/TQD/CRM` (chung với phase 02)

## Kết quả chính

Đã thêm 49 test mới trong 3 file `apps/crm/test/domain-*.test.ts`. Cả 49 test đều pass trên mã hiện tại, cùng với 20 test cũ. Tìm thấy 13 phát hiện (1 high, 6 medium, 6 low), không có critical.

Lỗi đáng chú ý nhất nằm ngay trong suite hiện có: test nhả lead dựa vào timestamp cố định trong seed nên **sẽ tự đỏ từ 2026-10-06 14:29:57 +07** (D-01). Các lỗi nghiệp vụ còn lại tập trung ở tìm kiếm và kiểm trùng tiếng Việt (D-02 đến D-05) và ở ràng buộc dữ liệu đầu vào (D-06, D-07).

Theo yêu cầu phase, các hành vi sai được ghi lại kèm bước tái hiện, không commit test đỏ. Để tái hiện, tôi đã dùng một file probe tạm (`apps/crm/test/domain-zz-probe.test.ts`) và đã xóa nó sau khi chạy xong.

## Lệnh và kết quả

Mọi lệnh chạy từ `D:/TQD/CRM`.

| Lệnh | Kết quả |
| --- | --- |
| `pnpm -F @abm/crm test` (baseline, trước khi sửa) | 1 file, 20/20 pass |
| `npx vitest run test/commands.test.ts test/domain-*.test.ts` (cwd `apps/crm`) | 4 file, 69/69 pass |
| `pnpm -F @abm/crm test` (cây chung, tính cả file của phase 02) | 6 file, 109/109 pass |
| `pnpm -F @abm/contracts typecheck` | sạch |
| `pnpm -F @abm/crm typecheck` | **fail 1 lỗi**, nằm ở `test/security-integrity.test.ts(138,57)` TS2345, là file của phase 02 (worker codex) chứ không phải file của phase này |
| `tsc -p tsconfig.worker.json` lọc theo `domain-*` / `commands.test` | 0 lỗi |
| `tsc -p tsconfig.web.json` | sạch |

Tiêu chí "typecheck pass" đạt với phần việc của phase 01. Trên cây kết hợp, typecheck chỉ xanh khi phase 02 sửa lỗi TS2345 kia.

## Test đã thêm

| File | Số test | Phạm vi |
| --- | --- | --- |
| `apps/crm/test/domain-working-time.test.ts` | 14 | `workingMinutesBetween` và `addWorkingMinutes/Hours` tại biên 08:00/17:30, cuối tuần, qua nửa đêm UTC, round-trip; ngưỡng `leadHealth` (ok, warn 3h, breach 4h, release 24h), SLA stage, Next Action quá hạn |
| `apps/crm/test/domain-commands.test.ts` | 27 | State machine đi đủ từng bước (bước nhảy, lùi stage, Won sớm đều bị chặn và không ghi gì); lead đã đóng bị khóa; Lost reason/note; mọi loại liên hệ đặt `first_contact_at`; task SLA 4 giờ khi giao lead; biên nhả lead đúng 24 giờ ±5 phút; bất biến Forced Next Action kiểm trên toàn DB qua cả hành trình lead; quyền duyệt, reject, quyết định hai lần, stale; kiểm trùng phone/email/MST/tên công ty |
| `apps/crm/test/domain-read-models.test.ts` | 8 | Phân nhóm task theo ngày VN; dashboard khớp với `/leads` theo từng vai trò; Won/Lost theo biên tháng VN; cộng số tiền lớn (9×10¹² đồng) chính xác; search theo phạm vi; accountDetail theo phạm vi |

Mọi fixture phụ thuộc thời gian đều tính tương đối so với `Date.now()`, không dựa vào timestamp cố định trong seed.

## Kết luận theo góc kiểm tra

| # | Góc | Kết luận |
| --- | --- | --- |
| 1 | State machine stage | **Đạt.** Chỉ tiến một bước, Won chỉ từ Chờ chốt, Lost cần lý do và "Khác" cần ghi chú, lead won/lost/queue bị khóa. Có một khoảng trống: Won không bị kiểm "bằng chứng chốt và giá trị" (D-07). |
| 2 | Liên hệ lần đầu, SLA 4h, nhả 24h | **Đạt một phần.** Loại liên hệ, SLA 4 giờ và biên 24 giờ đều đúng. Lỗi: được ghi lùi `occurredAt` không giới hạn (D-06). Test cũ có "bom hẹn giờ" (D-01). |
| 3 | Forced Next Action | **Đạt** trên mọi luồng command hiện có (kiểm bất biến trên toàn DB). Có một lỗi tiềm ẩn khi lead có hơn một task mở (D-08). |
| 4 | Giờ làm việc | **Đạt.** Lịch ngày nghỉ lễ chưa được kiểm vì mã cố ý chưa hỗ trợ (ghi chú trong `working-time.ts`). |
| 5 | Duyệt | **Đạt** cho quyền duyệt, stale theo `lead.version`, reject, quyết định hai lần. Thiếu hết hạn và payload hash so với spec (D-13). |
| 6 | Read model | **Lỗi.** Dashboard, task bucket và accountDetail đều đúng. Search sai với chữ hoa có dấu và với truy vấn lẫn số (D-02, D-03). `listAccounts.owners` lộ tên ngoài phạm vi (D-09). |
| 7 | Kiểm trùng | **Lỗi.** Định dạng phone, `84→0` và email hoa/thường đều đúng. Sai: tên công ty viết hoa có dấu (D-04), phone không có chữ số (D-05), `0084` (D-11), MST không có tên công ty bị bỏ (D-10). |
| 8 | Tiền | **Chỉ kiểm được phía đọc.** Cộng số nguyên lớn chính xác. Không có command nào ghi `expected_value`, và schema không có ràng buộc (D-12). Phần "không âm / số nguyên / giới hạn" khi ghi chưa kiểm được vì không có đường ghi. |

## Phát hiện

Mỗi bước tái hiện dưới đây dùng helper `call(user, method, path, body)` giống `apps/crm/test/commands.test.ts:28`, chạy trên seed demo.

### D-01 — high — Test nhả lead sẽ tự đỏ từ 2026-10-06 14:29:57 +07

- **Vị trí:** `apps/crm/test/commands.test.ts:185-191`, `apps/crm/seed/demo.sql` (lead-01..03 có `assigned_at` tuyệt đối), `apps/crm/seed/generate-demo-seed.mjs:9`.
- **Mô tả:** Test mong đợi lead-02 (giao lúc `2026-10-02T02:29:57.438Z`) "chưa đủ 24 giờ làm việc". Theo `addWorkingHours(assigned_at, 24)`, mốc này là `2026-10-06T07:29:57Z`. Sau thời điểm đó lệnh nhả thành công và assertion `VALIDATION_FAILED` fail. Seed ghi chú rằng phải "regenerate right before seeding", nhưng test dùng file seed đã commit.
- **Tái hiện:** chạy `pnpm -F @abm/crm test` sau 2026-10-06 14:30 +07. Tính mốc bằng `addWorkingHours(new Date('2026-10-02T02:29:57.438Z'), 24)` → `2026-10-06T07:29:57.438Z`.
- **Mong đợi / thực tế:** test tất định / test đỏ theo lịch, chặn mọi gate CI.
- **Nguồn quy tắc:** ak-test principles §7 (deterministic), `docs/engineering/test-strategy.md`.
- **Hướng sửa:** trong test, cập nhật `assigned_at` tương đối so với now trước khi assert, như `domain-commands.test.ts` đang làm. Phase này không được sửa file test cũ.

### D-02 — medium — Search có chữ số khớp mọi phone chứa các chữ số đó

- **Vị trí:** `apps/crm/src/worker/queries.ts:95`.
- **Mô tả:** Mọi chữ số trong `q` bị gom lại rồi so `LIKE` với `normalized_value` của phone. Truy vấn có tên hoặc mã kèm số sẽ trả về hầu hết lead.
- **Tái hiện:**
  - `GET /api/search?q=L-0010` (u-lan) → `[L-0004, L-0014, L-0001, L-0006, L-0018, L-0008, L-0011]`, trong khi L-0010 không thuộc phạm vi của Lan.
  - `q=Lộc Thọ 1` → 7 lead.
  - `q=lienhe4@khachhang-demo.example` → `[L-0004, L-0014]`.
- **Mong đợi / thực tế:** chỉ trả lead khớp mã/tên/email / gần như toàn bộ lead của người dùng.
- **Nguồn quy tắc:** plan eval UI (tìm kiếm toàn cục), PRD luồng 35.3.

### D-03 — medium — Search không tìm được tên có chữ hoa có dấu, và không chuẩn hóa `+84`

- **Vị trí:** `apps/crm/src/worker/queries.ts:93-95`.
- **Mô tả:** `lower()` của SQLite/D1 chỉ hạ chữ ASCII (`lower('ĐÔNG Á')` = `ĐÔng Á`), còn `q` được hạ bằng JS. Vì vậy tên có Đ/Á/Ô… viết hoa không bao giờ khớp. Ngoài ra, search phone không áp dụng `normalizePhone` như kiểm trùng.
- **Tái hiện:**
  - `GET /api/search?q=Đông Á` (u-hung) → `[]`, trong khi `q=cơ khí` → `[L-0009]` (cùng "Công ty CP Cơ khí Đông Á Demo").
  - `q=+84 900 100 004` (u-lan) → `[]`.
- **Mong đợi / thực tế:** tìm được L-0009 và L-0004 / rỗng.
- **Nguồn quy tắc:** ERD (chuẩn hóa contact point); kiểm trùng dùng `normalizePhone` nên hai hành vi không nhất quán.

### D-04 — medium — Kiểm trùng tên công ty bỏ sót khác biệt hoa/thường có dấu và khoảng trắng thừa

- **Vị trí:** `apps/crm/src/worker/commands.ts:204`.
- **Tái hiện:** `POST /commands/createLead` (u-hung) với `{contactName:'Khách Thử', source:'website', needSummary:'x', phone:'0911000001', companyName:'CÔNG TY TNHH DƯỢC PHẨM LỘC THỌ DEMO'}` → tạo mới, không có `DUPLICATE_SUSPECTED`. Tương tự với `'Công ty TNHH  Dược phẩm Lộc Thọ Demo'` (hai dấu cách).
- **Mong đợi / thực tế:** cảnh báo trùng với L-0004 / tạo account trùng.
- **Nguồn quy tắc:** state-machines-v1 §1 (duplicate check khi tạo Lead), ERD `duplicate_candidate`.
- **Hướng sửa:** lưu sẵn tên chuẩn hóa (JS `toLowerCase` + gộp khoảng trắng, có thể bỏ dấu) và so trên cột đó.

### D-05 — medium — Phone không có chữ số vẫn qua validation, lead không có kênh liên hệ nào

- **Vị trí:** `packages/contracts/src/index.ts:121,129`, `apps/crm/src/worker/commands.ts:187,238`.
- **Tái hiện:** `createLead` với `{..., phone:'abc'}` (u-hung) → `ok`. Sau đó `SELECT COUNT(*) FROM contact_point` cho contact của lead đó → `0`.
- **Mong đợi / thực tế:** `VALIDATION_FAILED` ở trường `phone` / lead được tạo mà không có phone và email, vượt qua quy tắc "cần số điện thoại hoặc email".
- **Nguồn quy tắc:** refine trong `createLeadInput` ("Cần số điện thoại hoặc email").

### D-06 — medium — `occurredAt` được ghi lùi không giới hạn, làm sai lệch SLA liên hệ lần đầu

- **Vị trí:** `apps/crm/src/worker/commands.ts:330-334`.
- **Tái hiện:** `logActivity` (u-lan) với `{leadId:'lead-01', expectedVersion:1, type:'call', summary:'x', occurredAt:'2020-01-01T00:00:00Z'}` → `ok`. Khi đó `first_contact_at = 2020-01-01`, trong khi `assigned_at` và `created_at` là `2026-10-02`.
- **Mong đợi / thực tế:** chặn thời điểm trước khi lead được tạo hoặc giao (hoặc giới hạn độ lùi) / Sale có thể "đúng hạn" hồi tố sau khi đã vi phạm SLA 4 giờ.
- **Nguồn quy tắc:** QĐ4 (SLA liên hệ lần đầu), state-machines-v1 §1 ("First contact sau 4 giờ làm việc nhắc Owner và Leader").
- **Cần quyết định:** giới hạn ghi lùi là quy tắc nghiệp vụ chưa chốt.

### D-07 — medium — Won không kiểm bằng chứng chốt và giá trị

- **Vị trí:** `apps/crm/src/worker/commands.ts:156-171`.
- **Tái hiện:** `UPDATE lead SET expected_value = NULL WHERE id='lead-14'`, rồi `changeStage` (u-lan) `{leadId:'lead-14', expectedVersion:1, toStage:'won'}` → `ok`.
- **Mong đợi / thực tế:** Won cần giá trị Deal (và bằng chứng) / Won với giá trị rỗng, làm `wonValue` trên dashboard thấp hơn thực tế.
- **Nguồn quy tắc:** state-machines-v1 §1, dòng "Chờ chốt → Won: Bằng chứng chốt và giá trị Deal".
- **Ghi chú:** điều này không nằm trong danh sách "rút gọn có chủ đích" của plan eval UI.

### D-08 — low — Hoàn thành một task không phải Next Action kèm `nextAction` để lại hai task mở

- **Vị trí:** `apps/crm/src/worker/commands.ts:354-362`.
- **Mô tả:** Task mới được tạo và con trỏ `next_action_task_id` chuyển sang nó, nhưng Next Action cũ vẫn `open` và không còn được trỏ tới.
- **Tái hiện:**
  1. `INSERT INTO task (id, lead_id, title, due_at, assignee_user_id, status, created_at, updated_at) VALUES ('task-x','lead-04','Nhắc phụ',<now>,'u-lan','open',<now>,<now>)`.
  2. `completeTask` (u-lan) `{taskId:'task-x', expectedVersion:1, nextAction:{title:'Mới', dueAt:<now>}}` → `ok`.
  3. Lead-04 lúc này có hai task open (`task-4` và task mới).
- **Mong đợi / thực tế:** đúng một việc tiếp theo mở / hai việc mở, trong đó một việc mồ côi.
- **Nguồn quy tắc:** QĐ13, state-machines-v1 §2.
- **Mức độ:** hiện chưa có command nào tạo được task mở thứ hai, nên lỗi chỉ tiềm ẩn. Nó sẽ lộ ra khi thêm "tạo việc / nhắc" cho agent.

### D-09 — low — `listAccounts.owners` lộ tên owner ngoài phạm vi

- **Vị trí:** `apps/crm/src/worker/queries.ts:318-319`.
- **Mô tả:** Subquery `owners` không áp `leadScope`.
- **Tái hiện:**
  1. u-long gọi `createLead` với `taxCode:'0310000004', confirmNotDuplicate:true, source:'self', nextAction` (gắn vào acc-4 của Lan).
  2. `GET /api/accounts?q=0310000004` (u-long) → `owners: "Đỗ Ngọc Lan,Vũ Đức Long"`, dù `leadCount: 1`.
- **Mong đợi / thực tế:** chỉ owner của lead trong phạm vi / lộ owner của lead mà Sale không được xem.
- **Nguồn quy tắc:** permission-matrix-v1 ("Ownership một Deal không tự cho xem toàn Account").
- **Ghi chú:** nên để phase 02 (bảo mật) xác nhận mức độ.

### D-10 — low — MST nhập mà không có tên công ty bị bỏ im lặng

- **Vị trí:** `apps/crm/src/worker/commands.ts:222-230`.
- **Tái hiện:** `createLead` (u-hung) với `{..., phone:'0911000003', taxCode:'0399999999'}` → `ok`, nhưng `lead.account_id = NULL` và MST không được lưu ở đâu.
- **Mong đợi / thực tế:** báo lỗi thiếu tên công ty, hoặc lưu MST / mất dữ liệu, và lần nhập sau không phát hiện trùng theo MST.
- **Nguồn quy tắc:** ERD (`account.tax_code`).

### D-11 — low — Chuẩn hóa phone khác ERD và không xử lý tiền tố `00`

- **Vị trí:** `apps/crm/src/worker/commands.ts:112-115`.
- **Mô tả:** Mã chuẩn hóa về dạng nội địa `0…`, trong khi ERD ghi "chuẩn hóa … điện thoại E.164". Số `0084 900 100 004` thành `0084900100004`, nên không khớp với L-0004.
- **Tái hiện:** `createLead` (u-hung) với `{..., phone:'0084 900 100 004'}` → tạo mới, không có cảnh báo trùng.
- **Nguồn quy tắc:** `docs/architecture/erd-v1.md:413`.

### D-12 — low — Tiền: không có đường ghi `expected_value` và schema không có ràng buộc

- **Vị trí:** `apps/crm/migrations/0001_init.sql:107`; `packages/contracts/src/index.ts` (không schema nào có trường giá trị).
- **Mô tả:** Cột `INTEGER` nhưng không có `CHECK (expected_value >= 0)` hay kiểm kiểu. Giá trị chỉ đến từ seed, nên không kiểm được "số nguyên đồng, không âm, giới hạn lớn" ở phía ghi. Phía đọc đã được kiểm và cộng chính xác tới 9×10¹² đồng.
- **Nguồn quy tắc:** ERD (`amount_minor INTEGER`), góc kiểm tra 8.

### D-13 — low — Approval chưa có hết hạn và payload hash

- **Vị trí:** bảng `approval` trong `0001_init.sql`; `decideApproval` tại `commands.ts:398-437`.
- **Mô tả:** Spec yêu cầu `expires_at` và `payload_hash` do core tính, cùng các trạng thái `expired` và `executed`. Bản eval chỉ có `pending/approved/rejected/stale` và chỉ kiểm stale theo `target_version`.
- **Nguồn quy tắc:** state-machines-v1 §3.
- **Ghi chú:** có thể coi là phần rút gọn của bản đánh giá (plan chỉ ghi "hàng chờ duyệt gồm đổi owner và đề xuất mẫu"), nhưng plan không ghi rõ điều này.

## Audit suite hiện có (`commands.test.ts`)

- **Important — test bị "bom hẹn giờ":** D-01.
- **Important — assertion yếu:** `commands.test.ts:228-239`. Với 4 vai trò, dashboard chỉ được kiểm `ok === true`, không kiểm số liệu. Đã bổ sung kiểm số liệu trong `domain-read-models.test.ts`.
- **Minor — thiếu kiểm hệ quả:**
  - Test nhả lead (dòng 185) không kiểm task bị hủy.
  - Test hoàn thành Next Action (dòng 139) không kiểm task cũ chuyển `completed`.
  - Cả hai đã được bổ sung trong `domain-commands.test.ts`.
- Không thấy test bị skip, test rỗng hay assertion tautology. Test concurrency (dòng 115) cho cùng kết quả dù hai request chạy xen kẽ hay tuần tự (một thành công, một `STALE_VERSION`).

## Chưa kiểm tra và lý do

- **Lịch ngày nghỉ lễ:** mã cố ý chưa hỗ trợ (`packages/contracts/src/working-time.ts:2-3`).
- **Trạng thái `paused` và Deal tách khỏi Lead:** ngoài phạm vi bản eval (plan eval UI, mục "Rút gọn").
- **Ghi tiền (không âm, số nguyên, giới hạn):** không có command ghi (D-12).
- **Agent kill switch / `APPROVAL_REQUIRED`:** bản eval không có agent write.
- **Mutation testing để chứng minh test mới bắt được lỗi:** không làm, vì phase cấm sửa mã sản phẩm, kể cả tạm thời. Thay vào đó, các assertion được viết theo giá trị cụ thể (biên phút, số đếm, số tiền).

## Câu hỏi chưa giải quyết

1. Có giới hạn ghi lùi `occurredAt` cho activity (D-06) không, và giới hạn bao nhiêu?
2. Won có bắt buộc `expected_value` trong bản eval không, hay để MVP1 thật (D-07)?
3. Hết hạn approval và payload hash (D-13) có thuộc phần rút gọn có chủ đích không?
