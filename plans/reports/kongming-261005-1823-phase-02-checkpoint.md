# Kiểm tra sau phase 02, quyết định đi tiếp phase 03

Ngày: 2026-10-05. Người xem: kongming (chạy trên Claude Fable 5.1). Chỉ tư vấn, không sửa mã.

Đầu vào đã xem: `git status` và `git diff` của toàn bộ thay đổi chưa commit; `apps/crm/migrations/0007_admissions.sql`; `apps/crm/src/worker/learner-hold.ts`, `learner-commands.ts`, `learner-queries.ts`, `command-result.ts`, `guarded-tx.ts`, `commands.ts`, `queries.ts`, `overview.ts`, `scope.ts`, `mcp-tools.ts`, `actor.ts`, `index.ts`; `apps/crm/test/admissions.test.ts`, `test/helpers/reset-db.ts`; `apps/crm/src/web/pages/learner-detail.tsx`, `tasks.tsx`, `dashboard.tsx`; báo cáo executor phase 02; phase 02, 03, 04, 06, 07 và `plan.md`; trang giới hạn D1 của Cloudflare (đọc hôm nay). Người gọi đã chạy lại test (19 file, 270 test xanh), typecheck và build; tôi tin kết quả đó và không chạy lại.

## Kết luận: GO-with-fixes

Phase 02 đạt Goal và đủ tiêu chí nghiệm thu. Quy tắc giữ khách, hồ chung, che số điện thoại, nhận khách và đổi sale đúng và an toàn khi chạy đồng thời. Có **một chỗ cần sửa mã ngay** (lo ngại (a) của executor là thật: dashboard và overview B2B đang gộp lead học viên), và **14 chỗ cần sửa văn bản phase 03** trước khi chạy. Lo ngại (b) là thật nhưng nhẹ, xử lý ở phase 07. Không có lỗi nào chặn phase 03.

## 1. Giữ khách, hồ chung, che số, nhận khách, đổi sale: đúng và an toàn chưa

Đúng. Từng điểm đã kiểm:

- **Một quy tắc, hai bản song sinh.** `isHeld` (`learner-hold.ts:32-36`) và `IN_POOL_SQL` (`learner-hold.ts:47`) cùng nói: không owner hoặc owner không còn là `sale`/`leader` đang hoạt động thì ở hồ chung; có owner hợp lệ thì chỉ ở hồ chung khi hết hạn **và** chưa thắng. `COALESCE(c.hold_expires_at, '') <= ?` xử lý đúng ca `hold_expires_at` NULL (chuỗi rỗng luôn nhỏ hơn ISO, nên vào hồ chung, khớp với `isHeld` trả `false` khi NULL). Sửa F4 của lần trước đã vào mã. Test phủ: hết hạn, đã thắng, owner đổi vai, owner bị khóa, không owner (`admissions.test.ts:234-298`).
- **Nhận khách (`claimCustomer`, `learner-commands.ts:360-371`) khi chạy đồng thời.** Kiểm `heldNow` là pre-read, nhưng mọi ghi đi qua `tx.update('contact', id, version, …)` (`:341`) và `tx.update('lead', …)` cho từng lead đang mở (`:345`), mỗi lệnh đều có `_guard` theo nonce (`guarded-tx.ts:35-43, 113-118`). Hai người cùng nhận một khách với cùng `version`: người sau có `UPDATE` không trúng dòng, guard chèn `ok = 0`, cả batch hỏng, `runCommand` trả `STALE_VERSION` (`commands.ts:123`). Nếu owner cũ đang chốt thắng cùng lúc: lead đổi version nên claim hỏng toàn bộ, hoặc claim xong trước thì `loadLearnerLead` của owner cũ trả `NOT_FOUND` vì `mayEdit` không còn đúng (`learner-commands.ts:250`). Không có nhánh nào ghi nửa chừng.
- **Đổi sale (`changeCustomerOwner`, `:373-386`).** Leader chỉ đổi khi owner cũ và mới cùng nhóm (`:380`), Admin đổi mọi khách, người nhận phải là `sale`/`leader` đang hoạt động có nhóm (`loadOwnerCandidate`, `:31-35`). Dùng chung `reassignCustomer` với claim nên hạn giữ reset, lead và task đổi theo, có activity và audit.
- **Tạo trùng số khi chạy đồng thời.** `writeLearnerLead` đặt `tx.assert(COUNT(*) = 0 …)` trong batch cho khách mới có số điện thoại (`:125-128`), nên hai sale tạo cùng số cùng lúc chỉ một người thành công. Khách "của mình" được bump version bằng `tx.update('contact', …, {})` (`:143`) nên không đè lên claim hoặc consent đang chạy.
- **Che số điện thoại.** `mayInspect` (`learner-queries.ts:15-18`) dùng ở cả ba nơi trả số: danh sách (`:81-86`), hồ sơ (`:104-113`) và học viên của hợp đồng (`:227-229`). Ô tìm kiếm không khớp số bị che (`:83`), nên không dò được số từng chữ. `search` của B2B đi qua `leadWhere` có `l.pipeline = 'b2b'` (`queries.ts:99`), nên lead học viên không lộ qua `/search`. Một chỗ còn hở là `GET /leads/:id` và tool `get_lead`, xem mục 3.
- **Hành trình.** `markJourneyStep` chỉ nhận `contacted` và `need_confirmed` ở schema (`contracts:329`), kiểm thứ tự bước và cập nhật `lead_step` có version (`learner-commands.ts:262-279`). `winLearnerLead` đòi `need_confirmed` xong và `trial` xong hoặc bỏ qua (`:308-313`). Đúng tiêu chí nghiệm thu của plan.
- **Xem trước nhập CSV.** `hasAnchor` (`guarded-tx.ts:30-32`) và lối ra sớm ở `commands.ts:113` chỉ bỏ qua idempotency và commit khi handler không dàn dòng nào. Mọi handler hiện có đều dàn ít nhất một dòng có version, nên lối ra này không làm lệnh nào khác mất kiểm tra kill switch của bot.

Hai điểm nhỏ, không chặn:

- `reassignCustomer` chỉ đổi lead `status = 'active'` (`:342`). Khách có lead đã thắng chỉ về hồ chung khi owner bị khóa hoặc đổi vai; khi đó lead thắng vẫn mang tên owner cũ. Báo cáo theo sale ở phase 06 cần biết điều này.
- Owner có khách hết hạn bấm "Nhận" lại chính khách mình thì activity ghi "Nhận khách từ hồ chung: Lan → Lan". Chỉ là chữ.

## 2. Hai lo ngại của executor

### (a) Dashboard và overview gộp lead học viên: **thật, sửa mã ngay**

`dashboard` (`queries.ts:206-216`) và `overviewData` (`overview.ts:40-48, 67, 79, 82`) dùng `leadScope` trần, không có `l.pipeline = 'b2b'`. Hệ quả cụ thể:

- `kpi.activeLeads`, `pipelineValue`, `bySale`, `wonCount` của dashboard đếm cả lead học viên, trong khi `attention` và `active` cùng màn đó lấy từ `listLeads` đã lọc B2B. Số không khớp nhau ngay trong một response.
- Overview của Admin/BGĐ lấy thẻ bằng `LEAD_SELECT … WHERE inView` (`overview.ts:48`). Stage `new`, `contacted`, `qualified`, `won`, `lost` của học viên trùng mã với B2B, nên lead học viên **hiện thành thẻ trong cột kanban B2B**, vào ma trận phòng/nhóm và vào `workload`.
- Tool `dashboard_summary` của bot dùng cùng hàm `dashboard` (`mcp-tools.ts:196`).

Đây là vi phạm "Lead B2B cũ … vẫn chạy như trước" của plan, dù chỉ lộ khi eval có lead học viên (sau phase 07). Sửa nhỏ, nên làm ngay như phần bổ sung của phase 02 (Task 2.5 "Giữ luồng B2B không đổi"), trước khi chạy phase 03:

1. `scope.ts`: thêm `b2bLeadScope(actor, alias = 'l')` gói `leadScope` và nối `AND ${alias}.pipeline = 'b2b'`.
2. `queries.ts:97-99` (`leadWhere`): dùng `b2bLeadScope`, bỏ chuỗi lọc viết tay.
3. `queries.ts:206` (`dashboard`): `const scope = b2bLeadScope(actor)`.
4. `overview.ts:40`: `const base = b2bLeadScope(actor)`.
5. Giữ nguyên `taskScope` và các câu đếm task: việc của lead học viên vẫn nằm trong danh sách việc, đúng như sai lệch 5 của executor.
6. Test: trong `admissions.test.ts`, ca "B2B commands refuse a learner lead and B2B lists leave it out" thêm: `GET /dashboard` của `u-lan` có `kpi.activeLeads` bằng trước khi tạo lead học viên; overview của `u-admin` không có thẻ nào mang `leadId` đó.

Kèm một sửa UX cùng lô, vì cùng nguyên nhân: `tasks.tsx:50,72` và `dashboard.tsx:128` link mọi việc tới `/leads/$leadId`. Việc của lead học viên sẽ mở trang lead B2B, trang này trả `permissions.changeStage: true` và nút đổi stage B2B (`queries.ts:398-406`), bấm vào nhận 422. Sửa: `listTasks` (`queries.ts:171-175`) trả thêm `l.pipeline` và `l.contact_id`; hai trang web link `/learners/$contactId` khi `pipeline === 'learner'`.

### (b) Nhập 200 dòng trong một batch D1: **thật nhưng nhẹ, xử lý ở phase 07**

Đếm trên `writeLearnerLead` (`learner-commands.ts:117-177`): khách mới có số và email là 14 câu lệnh (assert, contact + guard, 2 contact_point, counter, lead + guard, counter update, task + guard, lead_step, activity, audit), không email là 13. 200 dòng ≈ 2.800 câu lệnh, cộng 3 câu chung. Trang giới hạn D1 hôm nay ghi: giới hạn theo từng câu (100 KB, 100 tham số, 30 giây) "áp cho từng câu trong batch", không ghi trần số câu trong một batch; số truy vấn mỗi lần gọi Worker không bị chạm vì cả import chỉ có 4-5 lần gọi D1 (`batch()` tính là một). Rủi ro còn lại là CPU 10 ms của gói miễn phí khi dựng 2.800 `prepare().bind()` và đọc CSV 500 KB bằng vòng lặp từng ký tự; chưa có số đo. Vì batch là một transaction, hỏng thì hỏng sạch, không có trạng thái nửa chừng, người dùng chỉ cần chia file.

Không sửa mã bây giờ. Thêm vào phase 07 (sau Task 7.5): nhập một file 200 dòng vào hợp đồng thử trên eval, chạy `commit: false` rồi `commit: true`, ghi thời gian và kết quả. Nếu lỗi `D1_ERROR` hoặc vượt CPU: hạ trần bằng một hằng `LEARNER_IMPORT_MAX_ROWS = 100` thay cho `ROSTER_MAX_ROWS` tại `learner-commands.ts:24` và `:498`, không cần chia batch.

## 3. Hồi quy cho B2B và MCP

Không có hồi quy chặn. Đã kiểm:

- `leadScope` 5 vai trò cũ không đổi (`scope.ts:13-32`). Bốn lệnh B2B và hai proposal của bot từ chối lead học viên bằng `VALIDATION_FAILED` (`commands.ts:424, 435, 511, 520, 617, 627`), có test.
- MCP: danh sách tool vẫn cứng (`mcp-tools.ts:20-64`), không lộ 13 lệnh mới. Agent token chỉ xác thực ở `/mcp` (`index.ts:31-33`); `/commands/:name` đi qua `requireActor` dùng session (`actor.ts:55-75`), nên bot không gọi được lệnh học viên.
- `replayInScope` (`commands.ts:137-147`) kiểm `canSeeLead` cho lệnh có `leadId`; owner, Leader cùng nhóm và Admin đều trong `leadScope` của lead học viên, nên replay không bị chặn nhầm.

Ba điểm cần ghi vào phase 06, không chặn phase 03:

- **`head` thấy số điện thoại học viên qua cửa sau.** `leadDetail` (`queries.ts:366-375`) trả `contactPoints` cho mọi lead trong `leadScope`; lead học viên có `department_id` của owner nên Trưởng phòng KD mở được `/leads/:id` và tool `get_lead` (`mcp-tools.ts:190-194`) của lead học viên, dù `GET /learners` trả 403 cho `head` (test `admissions.test.ts:323`). Việc của lead học viên cũng hiện trong danh sách việc của `head`. Sửa ở phase 06 Task 6.3 bước 2: khi `row.pipeline === 'learner'`, áp `mayInspect` (`learner-queries.ts:15-18`, cần export) lên `contactPoints` của `leadDetail`; `head` không nằm trong `customerScope` nên bị che.
- **`agentNeedsApproval: true` của `winLearnerLead`, `closeLearnerLead`, `changeCustomerOwner` chưa có cơ chế.** `runCommand` chỉ tạo proposal cho `changeStage` và `assignLead` (`commands.ts:108`). Hiện vô hại vì bot không chạm được lệnh học viên. Phase 06 phải ghi rõ: không đưa lệnh học viên vào bot (đúng non-goal của plan), và thêm test `tools/list` không có tool nào gọi được chúng.
- Lead thắng của owner đã nghỉ vẫn mang tên owner cũ (mục 1), ảnh hưởng báo cáo theo sale.

## 4. Phase 03 đã cũ ở đâu so với mã phase 02

Tất cả là sửa văn bản `phase-03-academic-classes-enrollment.md`. Executor làm "Bước 0" như phase 02 đã làm.

**C1. Task 3.2, bảng lệnh.** `bookTrial` và `reserveSeat` nhắm vào `lead`, nên trường phải là `expectedVersion` theo quy ước phase 02 Task 2.3 bước 2 (`contracts:329, 334, 337`): `bookTrial {leadId, expectedVersion, sessionId}`, `reserveSeat {leadId, expectedVersion, classId}`. Các lệnh nhắm `enrollment`, `class_group`, `class_session` giữ `version`.

**C2. Mục Files.** Thêm Modify `apps/crm/src/worker/learner-commands.ts` (export `loadLearnerLead`, `loadSteps`, xem C4-C5) và `apps/crm/src/worker/guarded-tx.ts` (đã có ở Task 3.1 bước 7 nhưng thiếu trong danh sách).

**C3. Task 3.3, câu mở đầu.** `fail`, `ok`, `Ctx`, `ApiFail` import từ `./command-result` (`command-result.ts:5-12`), không phải từ `commands.ts`; mẫu là `learner-commands.ts:9`. Đăng ký bằng `…learnerHandlers, …academicHandlers` tại `commands.ts:56`.

**C4. Task 3.3 bước 5-6.** `loadLearnerLead` (`learner-commands.ts:247-255`) trả `VALIDATION_FAILED 'Lead đã đóng'` khi `status !== 'active'`, nên `reserveSeat` trên lead `won` (status `won`) sẽ hỏng nếu dùng nguyên. Sửa: export hàm và thêm tham số `statuses: readonly string[] = ['active']`; `reserveSeat` gọi với `['won']`, `bookTrial` dùng mặc định. Đây là chỗ sửa mã duy nhất trong file của phase 02.

**C5. Task 3.3 bước 8 (`confirmEnrollment`).** Actor là `academic`, không nằm trong `mayEdit` của `loadLearnerLead`; đọc lead qua `enrollment.lead_id` trực tiếp, không qua scope. Bước `placed`: `SELECT id, version FROM lead_step WHERE lead_id = ? AND step_code = 'placed'` rồi `tx.update('lead_step', …)` như `learner-commands.ts:275`. Đồng ý: `SELECT granted FROM consent WHERE contact_id = ? AND purpose = 'enrollment' ORDER BY recorded_at DESC, rowid DESC LIMIT 1` (cột theo `learner-queries.ts:140`). Nên export một hàm `markStepDone(db, tx, leadId, stepCode, actorId)` ở `learner-commands.ts` để phase 04 (`started`, `trial`) và phase 05 (`tuition_paid`) dùng chung.

**C6. Task 3.3 bước 5 (`bookTrial`).** Không đụng `lead_step.trial`; phase 04 đánh `done` khi có mặt (`phase-04:81`). Thêm điều kiện: lead chưa có `trial_booking` đang `booked`. Ghi chú: `skipTrial` vẫn gọi được sau khi đã đặt (`learner-commands.ts:289` chỉ đòi bước còn `open`), đó là lối ra khi học viên không đến; không cần lệnh hủy học thử ở phase này.

**C7. Task 3.3 bước 11 (`transferEnrollment`).** Lớp đích phải `open`; ghi danh mới chép `organization_id`, `lead_id`, `contact_id` từ ghi danh cũ.

**C8. Task 3.1 bước 8 (`reset-db.ts`).** `TABLES` hiện ở `reset-db.ts:4-9`. `enrollment` có FK `contact`, nên sáu bảng mới phải đứng trước cả `contact`, không chỉ `lead`, `product`, `app_user`. Cách ít lỗi nhất: chèn `'trial_booking', 'enrollment', 'class_session', 'class_teacher', 'class_group', 'course'` vào **đầu** mảng.

**C9. Task 3.4 bước 4.** Cột `course` là subquery tại `learner-queries.ts:66-67`, bộ lọc tại `:77` và `:84`. Thay subquery bằng `COALESCE((tên khóa từ enrollment chưa kết thúc), (tên sản phẩm đang gắn))`.

**C10. Task 3.5 bước 4.** `teamMembers(db, teamId)` (`queries.ts:275-279`) lọc theo nhóm và chỉ `sale`/`leader`; `GET /team-members` không có tham số `role`. Cách ít sửa nhất: route mới `GET /teachers` trong `academic-queries.ts` trả user `active` có `role IN ('teacher','admin')`, cho `academic`, `admin`. Không sửa `teamMembers`.

**C11. Task 3.5 bước 1-2.** `GET /products` (`index.ts:83-87`, `canReadProducts` = mọi vai trừ `teacher`) và `upsertProduct` (`commands.ts`, roles `academic`, `admin`) đã có từ phase 01. Phase 03 chỉ thêm trang `products.tsx`.

**C12. Task 3.6.** `seed/demo.sql` không có user `academic` hay `teacher`. Test phải tự tạo (INSERT vào `app_user` với role mới, không phòng ban, không nhóm) hoặc đổi vai một user seed bằng SQL như `admissions.test.ts:278`. Test 5: chưa có bảng tiền ở phase 03, bỏ vế "số khoản tiền không đổi"; phase 05 thêm lại.

**C13. Task 3.4 bước 2.** `GET /classes/:id` nên cho `director` đọc, nhất quán với `/courses` (bước 1) và F5. `teacher` vẫn 403.

**C14. Task 3.3 bước 13.** `activity.type` không có CHECK (`0001_init.sql:156`). Dùng `note` cho đặt học thử, giữ chỗ, xác nhận, chuyển lớp; `stage_changed` cho đổi stage của `bookTrial`, theo mẫu `learner-commands.ts:276`.

## Rủi ro kế tiếp cần theo dõi

**Máy trạng thái ghi danh trải trên ba phase.** Phase 03 có 8 trạng thái và 7 lệnh chuyển; phase 04 chuyển `confirmed → studying` từ điểm danh; phase 05 đánh `tuition_paid`. Ba actor khác nhau (`academic`, `teacher`, `accountant`) đều ngoài `loadLearnerLead`, mỗi phase dễ viết một cách đọc lead và cập nhật `lead_step` riêng. Chốt ở phase 03: một bảng chuyển trạng thái hằng số (phase đã ghi) **và** một hàm `markStepDone` dùng chung (C5). Nếu phase 04 hoặc 05 viết đường riêng, hãy dừng và đưa về hàm đó.

## Giả định

- Người gọi đã chạy lại test, typecheck, build trên đúng cây làm việc này; tôi không chạy lại. Độ tin: cao.
- `db.batch()` tính là một truy vấn với giới hạn "truy vấn mỗi lần gọi Worker" của D1, và không có trần số câu lệnh trong một batch. Dựa trên trang giới hạn D1 đọc hôm nay (không ghi trần) và ghi nhớ đã kiểm ngày 2026-10-04. Độ tin: trung bình; bước thử ở phase 07 là cách biến giả định thành bằng chứng.
- Sửa (a) nên làm ngay thay vì đợi phase 06. Lý do: 4 dòng mã, cùng phạm vi Task 2.5, và tránh mang một số liệu sai qua ba phase. Nếu user muốn giữ phase 02 đúng như báo cáo thì chuyển cả khối sang Bước 0 của phase 03. Độ tin: cao.
- `head` không được xem khách học viên (vì không nằm trong `customerScope` và `/learners` trả 403). Nếu user muốn Trưởng phòng KD xem được thì bỏ mục sửa `leadDetail` ở phase 06 và thêm `head` vào `customerScope`. Độ tin: trung bình; user quyết.
