# Kiểm tra sau phase 04, quyết định đi tiếp phase 05

Ngày: 2026-10-05. Người xem: Opus 5.5. Báo cáo này chỉ tư vấn. Tôi không sửa mã, test hay file plan nào.

**Đầu vào đã đọc:**
- `plan.md`, `phase-04-teacher-attendance.md`, `phase-05-accounting-fees.md`.
- Báo cáo Grok phase 04 và báo cáo kiểm tra phase 03 (A1, A2, C1-C14, P4-1 đến P4-13).
- `0009_attendance.sql`, `attendance.ts`, `attendance.test.ts`, `my-classes.tsx`, `session-attendance.tsx`.
- `guarded-tx.ts`, `commands.ts` (`runCommand`, `replayInScope`), `learner-commands.ts` (`markStepDone`), `academic-commands.ts` (`ENROLLMENT_FROM`, `reserveSeat`, `transferEnrollment`), `academic-queries.ts` (`classDetail`), `reset-db.ts`, `class-detail.tsx`, `dashboard.tsx`, `layout.tsx`, `router.tsx`, `api.ts` (`useCommand`), và diff của `contracts/src/index.ts`, `index.ts`.

Bên gọi đã chạy test (21 file, 289 test), typecheck và build, và tất cả đều xanh. Tôi định chạy lại `attendance.test.ts` nhưng `node` không có trong PATH của shell trong phiên này, nên tôi tin kết quả của bên gọi.

## Kết luận: GO-with-fixes

Phase 04 đạt Goal, và đủ 8 mục test của Task 4.5. Các sửa A1 và A2 của phase 03 đã vào mã:
- `isoUtc` nằm ở `academic-commands.ts:37-40`.
- assert "một ghi danh sống mỗi lead" nằm ở `academic-commands.ts:198` và `:273`.

`markStepDone` đã được export. C13 cũng đã làm: `MANAGE_ROLES` có `director`.

Còn bốn lỗi thật mà test không bắt được. Lỗi đáng lo nhất là màn điểm danh gửi lại **cả buổi** và ghi đè dấu của người khác mà không báo gì. Nên sửa trước phase 05, vì cả bốn đều rẻ.

## 1. Đối chiếu Goal, Task, Verify

| Mục | Kết quả | Chứng cứ |
|---|---|---|
| Task 4.1, migration | Đạt | `0009_attendance.sql:4-20`: đủ cột, CHECK 5 trạng thái, CHECK đúng một trong hai id, 2 unique index một phần. |
| Task 4.1, `reset-db` | Đạt | `reset-db.ts:5`: `'attendance'` đứng đầu, trước `trial_booking`. |
| Task 4.1, `GuardedTable` | Đạt | `guarded-tx.ts:5` |
| Task 4.2, hợp đồng | Đạt | `ATTENDANCE_STATUSES`, `markAttendanceInput` (1-200 dòng, refine đúng một id), `createMakeupSessionInput`. Roles đúng plan. `addSession.kind` vẫn chỉ nhận `regular` và `trial`. |
| Task 4.3.1, `canTeach` | Đạt | `attendance.ts:40-47`. Admin và academic luôn được dạy. Teacher cần `class_teacher` và `u.status = 'active'`. |
| Task 4.3.2, roster | Đạt | `attendance.ts:91-132`. Lọc `COALESCE(confirmed_at, created_at) <= starts_at`. Ghi danh đã kết thúc lọc theo `ended_at > starts_at`. Buổi thử nhận `booked` và `done`. Buổi bù chỉ có đúng ghi danh của lần vắng gốc. Mỗi dòng chỉ có tên. |
| Task 4.3.3, `markAttendance` | Đạt, có lỗi F1 và F2 | `attendance.ts:236-269` |
| Task 4.3.4, `createMakeupSession` | Đạt, có lỗi F3 | `attendance.ts:271-295`. Kiểm `absent`/`excused` và có ghi danh, lớp `open`, `insertVersioned`, giờ chuẩn ISO UTC. Lần vắng gốc giữ nguyên. |
| Task 4.3.5, route GET | Đạt, có lỗi F4 | `index.ts`: `/my-classes`, `/sessions/:id/attendance` |
| Task 4.4, web | Đạt | Nav "Lớp của tôi" (`layout.tsx`). `/` chuyển teacher sang `/my-classes` và academic sang `/courses` (`dashboard.tsx:11-15`). Form học bù dùng `fromLocalInput` (`class-detail.tsx:170-187`). |
| Task 4.5, test 1-8 | Đạt | `attendance.test.ts:47-174`. Kiểm tĩnh `charge\|payment` không ra dòng nào. |
| Verify | Đạt | Theo bằng chứng của bên gọi |

**Các invariant:**

| Invariant | Kết quả | Chứng cứ |
|---|---|---|
| Bước hành trình chỉ đổi qua `markStepDone` | Đạt trong phase 04 | `attendance.ts:214`, `:233`. Còn hai chỗ ghi `lead_step` khác là `markJourneyStep` (`learner-commands.ts:287`) và `skipTrial` (`:303`). Cả hai là lệnh tay của phase 02, có luật riêng. Ghi lại để phase 05 không thêm chỗ thứ tư (xem P5-6). |
| Đổi trạng thái ghi danh qua `ENROLLMENT_FROM` | Đạt | `academic-commands.ts:20` có `markAttendance: ['confirmed']`. `attendance.ts:210-211` kiểm qua bảng này. |
| Thời gian là ISO UTC | Đạt | `isoUtc` (`attendance.ts:61-64`). `marked_at = tx.now`. Hàm này là bản sao của `academic-commands.ts:37-40` (xem F6). |
| Có dòng neo có version trước idempotency | Đạt | Câu đầu của `markAttendance` luôn là insert hoặc update `attendance`. `createMakeupSession` neo vào `class_session`. Activity và audit đều đứng sau dòng neo. |
| Teacher chỉ thấy lớp mình và chỉ thấy tên | Đạt | `myClasses` join `class_teacher`. `sessionAttendance` kiểm `canTeach`. Không có phone hay tiền. `/classes/:id` trả 403. `/products` chặn teacher. |
| `canTeach` cần teacher đang hoạt động, admin dạy được (QĐ10) | Đạt, có lỗi UX F4 | `attendance.ts:41-45` |
| Học thử chỉ sang `trial_done` khi lead đang `active`, ở `trial_booked`, và bước `trial` còn mở | Gần đạt (F5) | `attendance.ts:229` kiểm `!== 'skipped'` chứ không kiểm `=== 'open'`. Với các trạng thái có thể xảy ra, hai cách cho cùng kết quả. |
| Buổi bù có version, lớp phải `open`, lần vắng gốc giữ nguyên | Đạt | `attendance.ts:284-292` |
| `/` chuyển hướng teacher và academic | Đạt | `dashboard.tsx:11-15`. Đây là chuyển ở phía client. Server `/dashboard` vẫn trả rỗng cho hai vai này vì `leadScope` chặn. |

## 2. Đúng đắn, an toàn, đồng thời

### F1 (High): ghi đè mất dấu khi hai người điểm danh cùng buổi

Có hai lý do cộng lại:
- `session-attendance.tsx:29-35` gửi **mọi** dòng của roster, kể cả dòng người dùng không bấm. Dòng không bấm mang trạng thái lúc tải trang.
- `markAttendance` không nhận version từ client (`expectedVersion: false`). Handler đọc version mới nhất ngay trong lệnh (`attendance.ts:241`, `:193-196`), nên guard luôn khớp.

Ví dụ: giáo viên mở trang lúc 18:00. Lúc 18:10, academic (hoặc giáo viên thứ hai, `setClassTeachers` cho tối đa 10 người) đánh học viên X là "Vắng". Lúc 18:20, giáo viên bấm "Lưu" và X bị đặt lại thành "Chưa điểm danh". Không có lỗi, không có cảnh báo. Lần lưu đầu tiên cũng tạo một dòng `unmarked` cho cả lớp, dù không ai bấm.

Roster đã trả `version` cho từng dòng, nhưng client không dùng.

### F2 (Medium): lần điểm danh đầu tiên chạy song song trả lỗi 500

Hai người cùng lưu một buổi chưa có dòng `attendance` nào. Cả hai đọc roster với `attendanceId = null`, nên cả hai đều `insertVersioned`. Batch thứ hai vấp `attendance_session_enrollment` (UNIQUE).

`runCommand` (`commands.ts:120-127`) chỉ đổi lỗi guard thành `STALE_VERSION`. Lỗi UNIQUE bị `throw` ra ngoài và người dùng nhận 500. Dữ liệu không hỏng vì batch là nguyên khối, nhưng người dùng thấy lỗi hệ thống thay vì "Tải lại rồi thử lại".

Mọi bảng có unique index mà lệnh tạo dòng trước khi kiểm (phase 05: `charge.code`, `org_setting.organization_id`) đều có cùng lỗ hổng.

### F3 (Medium): một lần vắng tạo được nhiều buổi bù

`createMakeupSession` không kiểm lần vắng đã có buổi bù hay chưa. Sau khi tạo xong, form trong `class-detail.tsx:145-146` và `:170-187` vẫn hiện cho lần vắng đó (`absences` không biết buổi bù đã có). Academic bấm lần hai là có buổi bù thứ hai. PRD nói "học bù là một buổi mới, nối với lần vắng", tức quan hệ một-một.

### F4 (Medium): admin dạy lớp thấy mọi lớp của trung tâm trong "Lớp của tôi"

Theo QĐ10 (`plan.md:70`), giáo viên thật lúc ra mắt là Dũng và Tú, cả hai giữ vai `admin`. `myClasses` (`attendance.ts:145-150`) chỉ join `class_teacher` khi role là `teacher`. Vì vậy admin thấy **mọi** lớp và mọi buổi, không thấy riêng lớp mình dạy.

Đây là đường đi chính của người dùng thật, và test không phủ, vì test chỉ dùng `u-teacher`. Quyền vẫn đúng: admin được điểm danh mọi lớp. Lỗi nằm ở chỗ màn hình không đúng tên gọi "Lớp của tôi".

### F5 (Low): điều kiện của bước `trial`

`attendance.ts:229` dùng `step?.status !== 'skipped'`. Invariant nói "bước còn mở". Nên đổi thành `step?.status === 'open'` để code nói đúng invariant.

### F6 (Low): hàm `isoUtc` có hai bản

`attendance.ts:61-64` và `academic-commands.ts:37-40` giống hệt nhau. Phase 05 cần chuẩn hóa `receivedAt` và sẽ thành bản thứ ba. Nên export một bản duy nhất trước phase 05.

### Đúng, đã kiểm

- **Phần chạy song song còn lại đúng:**
  - dòng `attendance` đã có thì update có version, người sau nhận `STALE_VERSION`;
  - ghi danh bị bảo lưu đúng lúc điểm danh thì guard của `tx.update('enrollment')` hỏng, cả batch lùi;
  - lead bị sale đổi đúng lúc điểm danh học thử thì guard `lead` hỏng, cả batch lùi.
- **Lưu nhiều lần** không vấp UNIQUE, vì server đọc lại roster ở mỗi lệnh.
- **Không đụng tiền:** `attendance.ts` không đọc hay ghi bảng tiền nào.
- **Phạm vi tổ chức:** `loadSession` và `createMakeupSession` lọc theo `co.organization_id`. Các lần đọc `enrollment`, `trial_booking` và `lead` sau đó đều đi từ roster đã lọc phạm vi.
- **Phát lại idempotency:** `replayInScope` chỉ kiểm vai trò cho hai lệnh này. Kết quả lưu chỉ gồm id và trạng thái, không có dữ liệu cá nhân. Chấp nhận được.

### Ghi để biết, rủi ro thấp

- Điểm danh được cả buổi chưa diễn ra. Đánh "Có mặt" cho buổi tuần sau sẽ chuyển ghi danh sang `studying` và đánh bước "Vào học". Test hiện dùng buổi ở tương lai (`attendance.test.ts:23`), nên muốn chặn thì phải là quyết định của user (xem Câu hỏi).
- Học viên đang bảo lưu biến khỏi roster của các buổi **đã qua**, nên không sửa được dấu cũ của họ. Dấu cũ vẫn còn trong DB.
- `makeupRoster` không lọc theo trạng thái ghi danh, nên buổi bù của một ghi danh đã rút vẫn điểm danh được.
- `myClasses` của admin và academic không có giới hạn số dòng (số lớp nhân số buổi). Với quy mô hiện tại thì ổn.
- Đổi lại "Có mặt" thành "Vắng" không đưa ghi danh về `confirmed`. Đây là chủ ý: chuyển trạng thái chỉ đi một chiều.

## 3. Migration 0009 trên eval D1

**An toàn khi áp theo thứ tự.** File chỉ có `CREATE TABLE attendance` và hai `CREATE UNIQUE INDEX`, không đụng dữ liệu cũ.

Khóa ngoại trỏ tới:
- `class_session`, `enrollment`, `trial_booking` (tạo ở `0008`);
- `app_user` (đã có).

Vì vậy `0009` chỉ chạy được sau `0008`. Phase 07 áp từ `0006` đến `0011` trong một lần, có sao lưu và chạy thử trên D1 nháp trước, nên đúng thứ tự. Cả hai index đều là partial, và SQLite dùng được chúng cho các join `a.enrollment_id = e.id`.

**Hệ quả cần nhớ:**
- `app_user` giờ có thêm bảng con `attendance` (qua `marked_by_user_id`).
- `class_session.makeup_for_attendance_id` là id thường, không có FK. Hiện không có lệnh xóa, nên không sinh id mồ côi.
- Nếu sau này có migration dựng lại `app_user`, `class_session` hoặc `enrollment` theo kiểu "xóa rồi tạo lại", phải chép `attendance` ra trước.

## 4. Phase 05 đã lỗi thời so với mã phase 01-04

| # | Chỗ | Lệch |
|---|---|---|
| P5-1 | Files (`phase-05:35-44`) | Thiếu `guarded-tx.ts` (Task 5.1 bước 7 có sửa), `learner-commands.ts` (P5-6), `dashboard.tsx` (P5-11), `test/helpers/learner-fixtures.ts`, `seed/demo.sql` (P5-3). |
| P5-2 | Task 5.1 bước 6 (`:66`), thứ tự reset-db | Câu "đặt trước `enrollment` và `contact`" giờ mơ hồ, vì `TABLES` bắt đầu bằng `attendance`. Cần ghi thứ tự cụ thể. |
| P5-3 | Task 5.1 bước 1 (`:54`) và bước 6, `org_setting` | (a) Dòng `org-abm` ghi cứng trong migration. Nếu eval có tổ chức khác thì FK hỏng hoặc thiếu dòng. (b) `resetDb` xóa mọi bảng trong `TABLES` rồi chỉ nạp `seed/demo.sql`. Nếu `org_setting` nằm trong `TABLES`, dòng do migration chèn sẽ mất, và `updateOrgBank` cùng `/guide` sẽ hỏng trong test. |
| P5-4 | Task 5.1 bước 7 (`:68`) | Dẫn "`guarded-tx.ts` dòng 34". Nay là dòng 36. |
| P5-5 | Task 5.3 bước 1 (`:98`) | Dẫn "`commands.ts` khoảng dòng 305-315". Mẫu `lead_counter` nay nằm ở `commands.ts:349-362`. |
| P5-6 | Task 5.3 bước 9 (`:126-130`), `syncTuitionStep` | (a) Chữ ký `(tx, db, contactId)` ngược quy ước `(db, tx, actorId, …)`, và thiếu `actorId` mà `markStepDone` cần. (b) "đặt lại `open`" sẽ là chỗ ghi `lead_step` thứ tư nằm ngoài `markStepDone`. (c) Khoản `tuition` không có `enrollmentId` thì không gắn được vào lead nào. (d) Khoản `adjustment` âm (giảm giá) không bao giờ làm số còn lại của `tuition` về 0, nên học viên được giảm giá không bao giờ xong bước. |
| P5-7 | Task 5.2 (`:78-90`), tên field version | Phải nói rõ quy tắc: `expectedVersion` dùng cho lệnh neo vào lead, còn `version` dùng cho lệnh neo vào thực thể khác (enrollment, session, class, product). Phase 05 dùng `version`, đúng quy tắc, nhưng plan chưa ghi quy tắc. Plan cũng chưa cho `riskLevel`, `idempotent`, `expectedVersion` của từng lệnh, mà `CommandDefinition` bắt buộc cả ba (Grok đã phải tự đoán ở phase 04, mục Deviations 1). |
| P5-8 | Task 5.3 bước 1, `createCharge` | Không kiểm `enrollment.contact_id = contactId`, ghi danh cùng tổ chức, và ghi danh còn sống. Với luật một ghi danh sống mỗi lead (A2), ghi danh sống có trạng thái `pending`, `confirmed`, `studying` hoặc `deferred`. |
| P5-9 | Task 5.3 bước 3, `recordPayment` tự phân bổ | Thiếu `tx.assert` tổng phân bổ ≤ `charge.amount_vnd`. Một người phân bổ tay đồng thời có thể làm vượt số. Thiếu chuẩn hóa `receivedAt` thành ISO UTC. |
| P5-10 | Task 5.3 bước 5 và 8 | `revokeAllocation` không kiểm `revoked_at IS NULL`. `moveEnrollmentCharges` không nói rõ là không đổi `status` của ghi danh. |
| P5-11 | Task 5.5 | Accountant đăng nhập vẫn vào `/`, tức dashboard B2B (giống lỗi P4-9). Form "chọn học viên và ghi danh" không có nguồn dữ liệu, vì accountant không thuộc `LEARNER_READERS` (`learner-queries.ts:7`) và cũng không thuộc `MANAGE_ROLES`. |
| P5-12 | Task 5.4 bước 2 (`:144`) | Chỉ rà `/learners/:contactId` và `/classes/:id`. Thiếu `/my-classes`, `/sessions/:id/attendance` và `/courses`. |
| P5-13 | Task 5.6 | Seed không có user `accountant`. Phải dùng `addUser` của `learner-fixtures.ts`. Test 12 nên điểm danh bằng `u-academic` qua `confirmSeat`, theo mẫu `attendance.test.ts:14-21`. |
| P5-14 | Tiêu đề Rủi ro (`:200`) | Câu "Test 3 kiểm việc này" sai. Test 3 chạy tuần tự, không kiểm hai người phân bổ cùng lúc. |

## 5. Sửa cụ thể

### Sửa mã ngay, trước phase 05

1. **F1, `session-attendance.tsx:29-35`.** Chỉ gửi các dòng có trong `draft`. Tắt nút "Lưu" khi `draft` rỗng. Thêm `version: z.number().int().nullable()` vào `attendanceEntryInput` (contracts), gửi `row.version` của từng dòng. Trong `attendance.ts:248-250`, nếu `entry.version !== item.version` thì trả `STALE_VERSION`. Theo P5-7, đây là thực thể không phải lead, nên dùng tên `version`.
2. **F2, `commands.ts:125-126`.** Thêm nhánh: lỗi có `UNIQUE constraint failed` thì trả `STALE_VERSION`. Không gộp mọi `constraint failed`, để lỗi CHECK thật vẫn hiện ra. Thêm test: hai `markAttendance` chạy `Promise.all` trên buổi mới, một lệnh nhận 200, lệnh kia nhận 409 `STALE_VERSION`.
3. **F3, `attendance.ts:287`.** Trước `insertVersioned`, thêm `tx.assert("SELECT COUNT(*) = 0 FROM class_session WHERE makeup_for_attendance_id = ? AND status = 'scheduled'", [absence.id])`. Nên đọc trước để trả `VALIDATION_FAILED` có thông điệp rõ. `academic-queries.ts:100-103` trả thêm `makeupSessionId`, và `class-detail.tsx:145` ẩn form khi đã có buổi bù. Thêm test: tạo buổi bù lần hai thì lỗi.
4. **F4, `attendance.ts:145-150`.** Trả thêm cờ `assigned` cho từng lớp (join trái `class_teacher` theo `actor.id` với mọi vai). `my-classes.tsx` hiện "Lớp tôi dạy" trước, rồi "Lớp khác" (thu gọn) cho admin và academic. Thêm test: admin được gán một lớp thì lớp đó có `assigned: true`.
5. **F5, `attendance.ts:229`.** Đổi thành `step?.status === 'open'`. Thêm test: bước `trial` đã `skipped` thì điểm danh có mặt không đổi stage.
6. **F6.** Export `isoUtc` từ một chỗ, ví dụ `command-result.ts`. Xóa bản ở `attendance.ts:61-64` và `academic-commands.ts:37-40`.
7. **Test còn thiếu (`attendance.test.ts`).** Thêm test sửa lại một dấu đã có, để chạy nhánh `tx.update` ở `attendance.ts:193-196`. Nhánh này hiện chưa có test nào chạy.
### Sửa văn bản plan

8. **`plan.md:112-115`.** Đổi trạng thái phase 01-04 thành `completed`. File phase đã `completed`, nhưng bảng chỉ mục vẫn ghi `pending`.
9. **`phase-04-teacher-attendance.md:27-41`.** Thêm vào Files: Modify `dashboard.tsx`, Create `test/helpers/learner-fixtures.ts`, Modify `test/academic.test.ts`.
10. **P5-1, `phase-05:35-44`.** Thêm Modify `guarded-tx.ts`, `learner-commands.ts`, `web/pages/dashboard.tsx`, `test/helpers/learner-fixtures.ts`, `seed/demo.sql`.
11. **P5-2, `phase-05:66`.** Đổi thành: "Chèn `'payment_allocation', 'payment', 'charge'` vào **đầu** `TABLES`, trước `'attendance'`. Chèn `'fee_counter', 'org_setting'` ngay trước `'organization'`."
12. **P5-3, `phase-05:54`.** Đổi thành `INSERT INTO org_setting (id, organization_id, created_at, updated_at, version) SELECT id, id, <now>, <now>, 1 FROM organization`, không ghi cứng `org-abm`. Thêm vào `seed/demo.sql` một dòng `INSERT OR IGNORE INTO org_setting … 'org-abm' …`, để `resetDb` nạp lại sau khi xóa.
13. **P5-4, P5-5.** `guarded-tx.ts` dòng 34 → 36. `commands.ts` dòng 305-315 → 349-362.
14. **P5-6, `phase-05:126-130`.**
    - Chữ ký đổi thành `syncTuitionStep(db, tx, actorId, contactId)`.
    - Đánh `done` **chỉ** qua `markStepDone(db, tx, actorId, leadId, 'tuition_paid')`.
    - Mở lại bằng một hàm mới `reopenStep(db, tx, leadId, stepCode)`, export từ `learner-commands.ts` ngay cạnh `markStepDone`, chỉ đổi `done → open`. Không viết `UPDATE lead_step` ở `fees.ts`.
    - Contract: `kind = 'tuition'` bắt buộc có `enrollmentId`.
    - Luật xong bước: ghi danh sống duy nhất của lead (luật A2) có ít nhất một `tuition` `open`, và tổng số còn lại của mọi khoản `open` gắn ghi danh đó (gồm cả `adjustment` âm) ≤ 0. Nếu user muốn luật khác cho `deposit`, ghi vào đây.
15. **P5-7, `phase-05:78-90`.** Thêm câu: "Lệnh neo vào lead dùng `expectedVersion`, lệnh neo vào thực thể khác dùng `version`." Thêm cột vào bảng lệnh:
    - `createCharge`: medium, `expectedVersion: false`.
    - `voidCharge`: high, `true`.
    - `recordPayment`: high, `false`.
    - `allocatePayment`: high, `true`.
    - `revokeAllocation`: high, `false`.
    - `setInvoiceRef`: low, `true`.
    - `moveEnrollmentCharges`: medium, `false`.
    - `updateOrgBank`: high, `true`.
    - Mọi lệnh có `idempotent: true` và `agentNeedsApproval: false`.
16. **P5-8, Task 5.3 bước 1.** Thêm: ghi danh phải cùng tổ chức, `enrollment.contact_id = contactId`, và trạng thái thuộc `pending`, `confirmed`, `studying` hoặc `deferred`.
17. **P5-9, Task 5.3 bước 3.** Thêm cùng `tx.assert` tổng phân bổ theo `charge_id` như bước 4. Chuẩn hóa `receivedAt` bằng `isoUtc` dùng chung, và web gửi qua `fromLocalInput`.
18. **P5-10.** `revokeAllocation`: dòng phải có `revoked_at IS NULL`, nếu không thì trả `VALIDATION_FAILED`. `moveEnrollmentCharges`: ghi "không đổi `enrollment.status`, nên không đi qua `ENROLLMENT_FROM`; nguồn kiểm `status = 'transferred'`".
19. **P5-11, Task 5.5.**
    - Thêm bước: `dashboard.tsx` chuyển `accountant` sang `/fees`.
    - Thêm route `GET /fees/contacts?q=` (chỉ `MONEY_ROLES`) trả tên, mã lead và ghi danh sống (lớp, khóa, sản phẩm), làm nguồn cho form tạo khoản.
20. **P5-12, `phase-05:144`.** Thêm `/my-classes`, `/sessions/:id/attendance` và `/courses` vào danh sách rà "không có trường tiền".
21. **P5-13, Task 5.6.** Thêm: dùng `addUser('u-accountant', 'accountant')` và các fixture trong `learner-fixtures.ts`. Test 12 điểm danh bằng `u-academic`. Thêm test 13: hai `allocatePayment` chạy `Promise.all` vượt số tiền thì đúng một lệnh thành công.
22. **P5-14, `phase-05:200`.** Đổi "Test 3" thành "Test 13".

## Rủi ro kế tiếp cần theo dõi

**Ghi đè trong im lặng và các chỗ ghi đi vòng invariant.** Phase 05 là sổ tiền. Lỗi F1 cho thấy mẫu "server tự đọc version" ghi đè mà không báo. Lỗi F2 cho thấy lỗi UNIQUE khi chạy song song thành 500.

Phase 05 có ba chỗ dễ lặp lại các lỗi này:
- `revokeAllocation` và `moveEnrollmentCharges` không nhận version từ client;
- `charge.code` có unique index;
- `syncTuitionStep` cần mở lại một bước hành trình.

Cần chặn:
- mọi lần ghi tiền chạy song song đều phải có `tx.assert` tổng trong batch, kèm test `Promise.all`;
- `lead_step` chỉ đổi qua `markStepDone` và `reopenStep`.

## Câu hỏi còn mở

- Có chặn điểm danh "Có mặt" hoặc "Đi trễ" cho buổi chưa tới giờ không? Nếu có thì nên cho trễ bao lâu (ví dụ 30 phút trước giờ học), và phải sửa test đang dùng buổi ở tương lai.
- Điểm danh có cần mục đồng ý `attendance` (`CONSENT_PURPOSES`) không? Hiện plan không đòi, và mã không kiểm.
- Giảm giá được ghi bằng `adjustment` âm, hay sửa thẳng `amount_vnd` của khoản `tuition`? Câu trả lời quyết định luật xong bước "Thu học phí" (P5-6).
