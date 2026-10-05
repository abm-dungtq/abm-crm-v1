# Kiểm tra sau phase 03, quyết định đi tiếp phase 04

Ngày: 2026-10-05. Người xem: Opus 5.5. Báo cáo này chỉ tư vấn. Tôi không sửa mã, test hay file plan nào.

**Đầu vào đã đọc:**
- `plan.md`, `phase-03`, `phase-04`.
- Báo cáo kiểm tra phase 02 (C1-C14) và báo cáo executor phase 03.
- `0008_academic.sql`, `academic-commands.ts`, `academic-queries.ts`, `academic.test.ts`.
- `guarded-tx.ts`, `commands.ts` (`runCommand` và `replayInScope`), `learner-commands.ts` (`loadLearnerLead`, `winLearnerLead`).
- Diff của `contracts/src/index.ts`, `index.ts`, `reset-db.ts`, `layout.tsx` và `router.tsx`.
- `learner-detail.tsx` (từ dòng 215 đến 320), `class-detail.tsx` và `format.ts`.

Bên gọi đã chạy test (20 file, 280 test), typecheck và build, và tất cả đều xanh. Tôi định chạy lại riêng `academic.test.ts` nhưng `pnpm` không có trong PATH của PowerShell trong phiên này, nên tôi tin kết quả của bên gọi.

## Kết luận: GO-with-fixes

Phase 03 đạt Goal, và cả 10 test của Task 3.6 đều có mặt. Phần lõi an toàn:
- GuardedTx đúng.
- Version được kiểm ở mọi lệnh.
- Sĩ số chỉ đếm `confirmed` và `studying`.
- Bảo lưu và học lại đúng.
- Có kiểm đồng ý.
- Giáo viên nhận 403.
- Không lộ tiền.

Tuy vậy, **văn bản phase 03 chưa từng được vá theo C1-C14**: `git diff` của file phase chỉ đổi tiêu đề và trạng thái. Grok làm theo văn bản cũ, nên bốn điểm C bị lệch. Có thêm hai lỗi mã thật mà test không bắt được. Cần sửa mã trước khi chạy phase 04, vì phase 04 xây thẳng lên chúng.

## 1. Đối chiếu Goal, Task, Verify và C1-C14

| Mục | Kết quả | Chứng cứ |
|---|---|---|
| Task 3.1, migration | Đạt | `0008_academic.sql:1-84`. Đủ 6 bảng, CHECK, index. `class_teacher` không có cột version. |
| Task 3.1 bước 7, `GuardedTable` | Đạt | `guarded-tx.ts:3-5` |
| Task 3.1 bước 8, thứ tự reset-db (C8) | Đạt | `reset-db.ts:5`: sáu bảng mới đứng **đầu** mảng, trước cả `contact` |
| Task 3.2, hợp đồng | Đạt, trừ C1 | `contracts:395-488`. Roles đúng bảng lệnh. `addSession.kind` chỉ nhận `regular` và `trial`. |
| **C1, `expectedVersion`** | **Không đạt** | `contracts:461` và `:464` dùng `version` cho `bookTrial` và `reserveSeat`. Bốn lệnh lead học viên của phase 02 đều dùng `expectedVersion` (`contracts:343-367`). |
| C3, import từ `command-result` và gộp handler | Đạt | `academic-commands.ts:8`, `commands.ts:57` |
| **C4, đọc lead đã thắng cho `reserveSeat`** | **Lệch** | Grok không export `loadLearnerLead` kèm tham số `statuses` mà viết bản sao `loadWritableLead` (`academic-commands.ts:71-78`), lặp đúng `mayEdit` của `learner-commands.ts:250`. Hành vi đúng, nhưng giờ có hai bản quy tắc quyền sửa lead học viên. |
| **C5, `markStepDone` dùng chung** | **Không đạt** | `markPlaced` là hàm cục bộ, không export (`academic-commands.ts:222-228`). `winLearnerLead` vẫn tự cập nhật bước `enrolled` bằng tay (`learner-commands.ts:316`). Rủi ro mà kongming nêu ở phase 02 đang thành sự thật. |
| `confirmEnrollment` chạy với vai trò academic | Đạt | Lead đọc qua `enrollment.lead_id` (`:63-68`), không qua scope sale. Đồng ý được kiểm hai lần: đọc trước (`:236-238`) và `tx.assert` trong batch (`:242`). |
| **C6, `bookTrial`** | **Đạt một phần** | Không đụng `lead_step.trial`, đúng. Thiếu kiểm "chưa có `trial_booking` đang `booked`". Hiện được che gián tiếp vì stage phải là `qualified`. Không kiểm lớp của buổi thử còn `open`. |
| C7, chuyển lớp | Đạt | Lớp đích phải `open` và khác lớp cũ. Ghi danh mới chép đủ `organization_id`, `lead_id`, `contact_id` (`:279-288`). |
| C9, cột "Khóa học" | Đạt | `learner-queries.ts:66-73` |
| **C10, `GET /teachers`** | **Thay bằng cách khác** | Không có route. Danh sách ứng viên giáo viên nằm trong `classDetail().teacherCandidates` (`academic-queries.ts:84-86`), lọc `role IN ('teacher','admin')` và `status = 'active'`. Vẫn đúng QĐ10 và ít sửa hơn. Chấp nhận, ghi lại vào plan. |
| C11, products | Đạt | Chỉ thêm `products.tsx` và route GET. |
| C12, user test | Đạt | `academic.test.ts:24-25`, `:44-45` tự chèn `u-academic` và `u-teacher`. Không bỏ vế "khoản tiền không đổi" mà thay bằng `moneyRows()` (`:29-35`). Vì chưa có bảng tiền, kiểm này luôn là 0 = 0 (test giả). |
| **C13, director xem `/classes/:id`** | **Không đạt** | `academic-queries.ts:75`: director được xem `/courses` nhưng nhận 403 ở trang chi tiết lớp. Không nhất quán, rủi ro thấp. |
| C14, loại activity | Đạt | `note` cho giữ chỗ, xác nhận, chuyển lớp. `stage_changed` cho `bookTrial`. |
| Test `setClassTeachers` | Đạt | `academic.test.ts:243-253`: admin và teacher thì OK, sale thì `VALIDATION_FAILED`, và hai dòng cũ còn nguyên. |
| Teacher gọi `/classes/:id` nhận 403 | Đạt | `academic-queries.ts:74`, test `:213-217` |
| Verify | Đạt | Theo bằng chứng của bên gọi |

## 2. Đúng đắn và an toàn

**Đúng:**

- **GuardedTx và dòng neo.** Mọi handler đều có một dòng có version làm neo trước khi gọi `audit` hoặc `activity`:
  - `bookTrial` và `reserveSeat` bump `lead`.
  - `confirmEnrollment` neo vào `lead_step` nếu bước `placed` còn mở, ngược lại neo vào `enrollment`.
  - `setClassTeachers` gọi `tx.update('class_group')` trước, rồi mới `DELETE` và `INSERT` thô (`:136-141`). Nếu guard hỏng, `_guard CHECK (ok = 1)` làm hỏng cả batch, nên phần DELETE và INSERT không bao giờ chạy nửa chừng.
- **Xung đột version.** Mọi lệnh đều kiểm version trước khi ghi, và kiểm lại trong batch bằng `WHERE version = ?` cộng guard. Hai người cùng `reserveSeat` một lead thì người sau nhận `STALE_VERSION`.
- **Sĩ số** chỉ đếm `COUNTED_ENROLLMENT` bằng truy vấn con trong SQL (`academic-queries.ts:37`). Index `enrollment(class_id, status)` có sẵn.
- **Bảo lưu.** `until` bắt buộc theo `dateOnly` (`contracts:476`). Bảng còn có thêm CHECK. Học lại kiểm `status_before_defer` thuộc `confirmed` hoặc `studying`, rồi xóa cả hai cột (`:266-268`). Test thử cả hai nhánh.
- **Chuyển lớp** không có bảng tiền nào để đụng.
- **Phân quyền.** `runCommand` kiểm vai trò. Mọi truy vấn đều lọc theo `organization_id`. Bot không gọi được các lệnh này vì `/commands` đòi session.
- **Lộ tiền và dữ liệu cá nhân.** `/courses`, `/classes/:id` và `/enrollments/overdue-deferrals` không trả giá, không trả số điện thoại. Chỉ trả tên khách và mã lead cho academic và admin.
- **Bảo lưu quá hạn** so theo ngày Việt Nam (`vietnamToday`), đúng.

**Lỗi cần sửa:**

- **A1 (High). Giờ buổi học lưu sai múi giờ.** `class-detail.tsx:118` gửi thẳng giá trị thô của `datetime-local`, ví dụ `"2026-10-10T19:00"`, không có múi giờ. Repo đã có `fromLocalInput` (`format.ts:73-76`), và `lead-actions.tsx:29` vẫn dùng hàm đó.
  - Server nhận mọi chuỗi mà `Date.parse` đọc được (`contracts:213`, `:444`, `:454`) và lưu nguyên văn (`academic-commands.ts:151`, `:164`).
  - Hậu quả: Worker chạy UTC nên đọc 19:00 là 19:00 UTC, tức 02:00 sáng hôm sau giờ Việt Nam. Bảng còn trộn hai định dạng: chuỗi từ web và ISO kèm `Z` từ test.
  - Phase 04 so `starts_at` với `ended_at` (dạng `tx.now` ISO) và chia buổi "sắp tới" với "đã qua". So chuỗi kiểu này sẽ lệch 7 giờ và sai thứ tự.
  - Test không bắt được, vì test gửi `toISOString()`.
- **A2 (High). Một lead có thể có nhiều ghi danh đang sống.** `reserveSeat` (`:191-208`) không chặn ghi danh trùng.
  - Sale bấm "Giữ chỗ" hai lần (lần sau tải lại version) sẽ tạo hai ghi danh `pending`, cùng lớp hoặc khác lớp. Academic xác nhận cả hai thì sĩ số đếm đôi.
  - Phase 05 sẽ tạo khoản phải thu theo ghi danh, nên học phí cũng bị nhân đôi.
  - `transferEnrollment` cũng không kiểm lớp đích đã có ghi danh sống của cùng lead hay chưa.

**Rủi ro thấp, ghi để biết:**

- `confirmEnrollment` không kiểm lớp còn `open`.
- `reserveSeat` không kiểm khóa còn `active`. Admin vẫn thấy lớp `open` của khóa `closed` trong `pickClasses` (`learner-detail.tsx:221-225`).
- `bookTrial` nhận cả buổi thử đã qua giờ.
- Hủy buổi thử (`updateSession` với `status = 'cancelled'`) để `trial_booking` vẫn ở `booked`, và lead kẹt ở `trial_booked`. Lối ra là `skipTrial` theo C6.
- Academic đăng nhập thì mở `/`, tức dashboard B2B rỗng. Nav đã ẩn mục này nhưng route vẫn mở.

## 3. Migration 0008 trên eval D1

**An toàn khi áp theo thứ tự.** File chỉ có `CREATE TABLE` và `CREATE INDEX`, không đụng dữ liệu cũ. Khóa ngoại trỏ tới `organization`, `product`, `lead`, `contact` và `app_user`, tất cả đã tồn tại sau `0006` và `0007`. Eval chưa có `0006` và `0007`: phase 07 áp từ `0006` đến `0011` trong một lần, có sao lưu và chạy thử trên D1 nháp trước (`phase-07:43-68`). Vì vậy `0008` chỉ an toàn khi chạy sau `0006` và `0007`, và đó chính là thứ tự của wrangler.

Hệ quả cần nhớ: từ giờ `lead`, `contact` và `app_user` có thêm các bảng con là `enrollment`, `trial_booking` và `class_teacher`. Nếu một migration sau này dựng lại các bảng cha đó theo mẫu "xóa rồi tạo lại", nó phải chép cả bảng con ra trước, theo đúng bài học của phase 01.

## 4. Sửa cụ thể

### Sửa mã ngay, trước khi chạy phase 04

1. **A1, giờ buổi học.**
   - `class-detail.tsx:118`: gửi `startsAt: fromLocalInput(form.startsAt)`.
   - `academic-commands.ts:151` và `:164`: chuẩn hóa ở server bằng `new Date(input.startsAt).toISOString()`, để mọi `starts_at` cùng một định dạng, kể cả khi gọi API thẳng.
   - Thêm test: gửi `"2026-10-10T19:00:00+07:00"` thì DB lưu `"2026-10-10T12:00:00.000Z"`.
2. **A2, ghi danh trùng.**
   - `reserveSeat`, sau `academic-commands.ts:199`: thêm `tx.assert("SELECT COUNT(*) = 0 FROM enrollment WHERE lead_id = ? AND status IN ('pending','confirmed','studying','deferred')", [lead.id])`. Mỗi lead là một nhu cầu, và muốn học khóa khác thì tạo lead khác.
   - `transferEnrollment`: assert tương tự nhưng loại trừ chính `row.id`.
   - Thêm test: giữ chỗ lần hai cho cùng lead thì lỗi.
   - Nếu user muốn một lead được ghi danh nhiều khóa, đổi điều kiện thành theo `(lead_id, class_id)`. Đây là quyết định của user.
3. **C5, gom về `markStepDone`.**
   - Chuyển `markPlaced` (`academic-commands.ts:222-228`) thành `export async function markStepDone(db, tx, actorId, leadId, stepCode)` trong `learner-commands.ts`. Hàm không lỗi khi bước đã `done` hoặc `skipped`.
   - `confirmEnrollment` gọi hàm này với `'placed'`, và `winLearnerLead` (`learner-commands.ts:314-316`) gọi với `'enrolled'`.
   - Phase 04 sẽ dùng nó cho `started` và `trial`, phase 05 cho `tuition_paid`.
4. **C4, gom bộ đọc lead.**
   - Xóa `loadWritableLead` (`academic-commands.ts:71-78`).
   - Export `loadLearnerLead` (`learner-commands.ts:247`) và thêm tham số `statuses: readonly string[] = ['active']`.
   - `reserveSeat` gọi với `['won']`. `bookTrial` dùng mặc định, nên bỏ được kiểm `lead.status !== 'active'` thủ công ở `:178`.
5. **C1, đổi tên field.** Đổi `version` thành `expectedVersion` ở:
   - `contracts:461`, `:464`;
   - `academic-commands.ts:175`, `:184`, `:192`, `:199`;
   - `learner-detail.tsx:244`, `:276`;
   - `academic.test.ts:97`, `:108`, `:207`.

   Làm ngay vì rẻ: contract chưa deploy, và bot chưa dùng.

### Sửa văn bản phase 03 (ghi nhận lệch đã chấp nhận)

6. **Task 3.4 bước 1-2.** Ghi lại:
   - `/courses` trả `trialSessions` cho cả hai scope;
   - `/classes/:id` kèm `teacherCandidates` và `transferTargets`;
   - director nhận 403 ở `/classes/:id` (C13 chưa làm, hoặc thêm `'director'` vào `academic-queries.ts:75`, tùy user).
7. **Task 3.5 bước 4.** Thay câu "`GET /team-members?role=…`" bằng "`teacherCandidates` trong `GET /classes/:id`". Từ đây C10 được coi là đã đóng.
8. **Task 3.6 bước 5.** Ghi rõ vế "khoản tiền không đổi" ở phase này là kiểm rỗng, và phase 05 bổ sung kiểm thật.
9. **Mục Files.** Thêm `guarded-tx.ts` và `learner-commands.ts` (sau sửa 3-4).

### Sửa văn bản `phase-04-teacher-attendance.md`

- **P4-1, mục Files (dòng 27-38).**
  - Thêm Modify `apps/crm/src/worker/guarded-tx.ts` (đã có ở Task 4.1 bước 3 nhưng thiếu trong danh sách).
  - Thêm Modify `apps/crm/src/worker/academic-queries.ts` (xem P4-8).
  - Thêm Modify `apps/crm/src/worker/academic-commands.ts` (export `ENROLLMENT_FROM`, xem P4-4).
- **P4-2, Task 4.1 bước 2 (dòng 51).** Ghi cụ thể: chèn `'attendance'` vào **đầu** `TABLES` (`reset-db.ts:5`), trước `trial_booking`.
- **P4-3, Task 4.3, câu mở đầu.**
  - Import `fail`, `ok`, `Ctx` và `ApiFail` từ `./command-result`.
  - Đánh dấu bước hành trình **chỉ** qua `markStepDone` (sửa 3). Không viết bản cập nhật `lead_step` riêng.
  - Actor `teacher` nằm ngoài `loadLearnerLead`. Đọc lead qua `enrollment.lead_id` hoặc `trial_booking.lead_id`, theo đúng cách của `confirmEnrollment`.
- **P4-4, Task 4.3 bước 3, gạch đầu dòng 1 (dòng 80).** Thêm `confirmed → studying` vào bảng `ENROLLMENT_FROM` (`academic-commands.ts:13-20`) dưới khóa `markAttendance: ['confirmed']`, export bảng, và kiểm qua bảng đó. Ghi danh `studying` giữ nguyên, không lỗi.
- **P4-5, Task 4.3 bước 3, gạch đầu dòng 2 (dòng 81).**
  - Đổi stage lead sang `trial_done` bằng `tx.update('lead', id, version đọc trong handler, …)`.
  - Chỉ đổi khi `lead.pipeline = 'learner'`, `status = 'active'` và `stage = 'trial_booked'`.
  - Bước `trial` chỉ đánh `done` khi còn `open`. Nếu đã `skipped` (sale bỏ qua rồi thắng), giữ nguyên và không đổi stage.
  - Ghi activity `stage_changed`.
- **P4-6, Task 4.3 bước 2, gạch đầu dòng 1 (dòng 72).**
  - So `ended_at > starts_at` chỉ đúng sau sửa A1. Ghi rõ "cả hai cột là ISO UTC dạng `toISOString()`".
  - Ghi danh mới sinh từ chuyển lớp có `confirmed_at = tx.now`. Nếu muốn buổi trước ngày chuyển không hiện học viên mới, thêm điều kiện `COALESCE(confirmed_at, created_at) <= starts_at`. Nếu không thì ghi rõ là cố ý.
- **P4-7, Task 4.3 bước 4 (`createMakeupSession`).**
  - Tạo bằng `tx.insertVersioned('class_session', { kind: 'makeup', makeup_for_attendance_id, … })`, chuẩn hóa `startsAt` như A1.
  - `addSession` vẫn cấm `makeup` (`contracts:445`), giữ nguyên.
  - Lớp phải `open`.
- **P4-8, Task 4.4 bước 4 (dòng 101).** `classDetail` (`academic-queries.ts:73-118`) chưa trả điểm danh. Thêm vào response một mảng `absences` gồm `attendanceId`, `enrollmentId`, `sessionId`, `status` (`absent` hoặc `excused`) và `startsAt`, để nút "Tạo buổi học bù" có dữ liệu.
- **P4-9, Task 4.4 bước 1 (dòng 96).** Hiện teacher và academic vẫn mở route `/`, tức dashboard B2B rỗng. Thêm bước: route `/` chuyển hướng `teacher` sang `/my-classes`, và `academic` sang `/courses`. Nếu không làm, phải ghi vào danh sách kiểm thử của phase 07.
- **P4-10, Task 4.3 bước 1 (`canTeach`).** Với teacher, ghép `class_teacher` với `app_user.status = 'active'`. Session đã kiểm actor còn hoạt động, nên đây chỉ là phòng hờ. Ghi rõ admin và academic luôn được dạy.
- **P4-11, Task 4.5, phần dựng dữ liệu.**
  - Seed không có user `academic` hay `teacher`. Dùng lại `addUser`, `makeClass`, `winLead`, `reserve` và `grantConsent` của `academic.test.ts:24-102`.
  - Nên tách các hàm này ra `test/helpers/learner-fixtures.ts` thay vì chép lại.
  - Teacher được gán bằng `setClassTeachers`.
- **P4-12, Task 4.5 bước 6 (dòng 113).** `Select-String` chỉ là kiểm tĩnh. Ghi nó là kiểm tĩnh, không phải test hành vi. Test hành vi thật thuộc phase 05.
- **P4-13, Task 4.5, thêm test 8.** Teacher nhận 403 ở `GET /classes/:id` (giữ nguyên từ phase 03) và chỉ thấy lớp mình trong `/my-classes`. Thêm test ghi danh `deferred` không vào roster của buổi `regular`.

## Rủi ro kế tiếp cần theo dõi

**Thời gian và tiền đổ lên ghi danh.** Phase 04 so giờ buổi học, còn phase 05 tạo khoản phải thu cho từng ghi danh. Nếu chạy phase 04 trước khi sửa A1 và A2:
- roster và "buổi đã qua" sẽ lệch 7 giờ;
- một lead có hai ghi danh sẽ thành hai khoản học phí.

Cả hai lỗi đều không lộ trong test hiện có, vì test luôn gửi ISO kèm `Z` và chỉ giữ chỗ một lần. Thứ cần chặn ở phase 04 và 05: mọi chỗ đánh bước hành trình đều đi qua `markStepDone`, và mọi chuyển trạng thái ghi danh đều đi qua `ENROLLMENT_FROM`.

## Câu hỏi còn mở

- Một lead có được ghi danh nhiều lớp sống cùng lúc không? Câu trả lời quyết định điều kiện assert của sửa 2. Mặc định đề xuất là không.
- Director có cần xem chi tiết lớp (C13) không?
