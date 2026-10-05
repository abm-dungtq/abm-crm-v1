---
phase: 4
title: "Giáo viên và điểm danh, học bù, hoàn tất học thử"
status: completed
priority: P1
effort: "1d"
dependencies: [3]
---

# Phase 04: Giáo viên và điểm danh

## Goal

Theo PRD §10:

- Giáo viên chỉ mở lớp của mình và chỉ thấy tên học viên.
- Giáo viên điểm danh từng buổi với 5 trạng thái: chưa điểm danh, có mặt, vắng, có phép, đi trễ. Mặc định là "chưa điểm danh".
- Học bù là một buổi mới, nối với lần vắng. Lần vắng gốc vẫn còn.
- Lần đầu có mặt hoặc đi trễ thì bước "Vào học" của lead được đánh dấu, và ghi danh chuyển `confirmed` sang `studying`.
- Học thử có mặt hoặc đi trễ thì bước "Học thử" xong và lead sang `trial_done`.
- Điểm danh không đổi học phí.

## Quyết định đã chốt

- Điểm danh "Có mặt" hoặc "Đi trễ" cho buổi chưa tới giờ vẫn được phép.
- Điểm danh không yêu cầu mục đồng ý `attendance`.

Chạy phase này **trước** phase 05. Hai phase sửa chung nhiều file, nên không chạy song song.

Mọi lệnh chạy từ `D:\TQD\CRM`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0009_attendance.sql`
- Create: `apps/crm/src/worker/attendance.ts` (handler và truy vấn)
- Modify: `apps/crm/src/worker/commands.ts` (đăng ký `attendanceHandlers`)
- Modify: `apps/crm/src/worker/index.ts`
- Modify: `apps/crm/src/worker/guarded-tx.ts` (thêm `'attendance'` vào `GuardedTable`)
- Modify: `apps/crm/src/worker/academic-queries.ts` (`classDetail` trả `absences`)
- Modify: `apps/crm/src/worker/academic-commands.ts` (export `ENROLLMENT_FROM`)
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/crm/test/helpers/reset-db.ts`
- Create: `apps/crm/src/web/pages/my-classes.tsx`, `session-attendance.tsx`
- Modify: `apps/crm/src/web/pages/class-detail.tsx` (nút "Tạo buổi học bù" cạnh lần vắng)
- Modify: `apps/crm/src/web/pages/dashboard.tsx`
- Modify: `apps/crm/src/web/router.tsx`, `layout.tsx`
- Create: `apps/crm/test/helpers/learner-fixtures.ts`
- Modify: `apps/crm/test/academic.test.ts`
- Create: `apps/crm/test/attendance.test.ts`

## Tasks

### Task 4.1: Migration 0009

- Target: `apps/crm/migrations/0009_attendance.sql`.
- Steps:
  1. `attendance`:
     - cột: `id`, `session_id` (FK class_session), `enrollment_id TEXT` (FK enrollment, có thể null), `trial_booking_id TEXT` (FK trial_booking, có thể null), `status TEXT NOT NULL CHECK (status IN ('unmarked','present','absent','excused','late'))`, `marked_by_user_id`, `marked_at`, `created_at`, `updated_at`, `version`, `last_txn_id`;
     - `CHECK ((enrollment_id IS NULL) <> (trial_booking_id IS NULL))`;
     - unique index `(session_id, enrollment_id) WHERE enrollment_id IS NOT NULL`;
     - unique index `(session_id, trial_booking_id) WHERE trial_booking_id IS NOT NULL`.
  2. Thêm `attendance` vào `TABLES` của `reset-db.ts`. Chèn `'attendance'` vào đầu mảng, trước `trial_booking`.
  3. Thêm `'attendance'` vào type `GuardedTable` trong `guarded-tx.ts`.
- Verify: `pnpm -F @abm/crm test` exit 0.

### Task 4.2: Hợp đồng dùng chung

- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Thêm `ATTENDANCE_STATUSES` với nhãn: Chưa điểm danh, Có mặt, Vắng, Có phép, Đi trễ.
  2. Thêm `markAttendanceInput`: `{ sessionId, entries: [{ enrollmentId? , trialBookingId?, status }] (1-200 phần tử) }`. Mỗi entry có đúng một trong hai id.
     Thêm lệnh `markAttendance`, roles teacher, academic, admin, `agentNeedsApproval: false`, `expectedVersion: false`.
  3. Thêm `createMakeupSessionInput`: `{ attendanceId, startsAt, durationMinutes, note? }`.
     Thêm lệnh `createMakeupSession`, roles academic, admin.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 4.3: Handler và truy vấn

- Target: `apps/crm/src/worker/attendance.ts`.
- Import `fail`, `ok`, `Ctx` và `ApiFail` từ `./command-result`.
- Đánh dấu bước hành trình chỉ qua `markStepDone` đã export từ `learner-commands.ts`. Không viết lệnh cập nhật `lead_step` riêng.
- Actor `teacher` nằm ngoài `loadLearnerLead`. Đọc lead qua `enrollment.lead_id` hoặc `trial_booking.lead_id`, theo cách `confirmEnrollment` đọc lead của ghi danh.
- Steps:
  1. Hàm `canTeach(db, actor, classId)`: `admin` và `academic` luôn trả true. `teacher` chỉ khi có dòng `class_teacher` và `app_user.status = 'active'`. Session đã kiểm actor còn hoạt động, nên điều kiện status chỉ là phòng hờ.
  2. **Danh sách điểm danh của một buổi.** Hàm `sessionRoster(db, sessionId)` trả:
     - buổi `regular`: ghi danh của lớp có status `confirmed`, `studying`, hoặc đã `completed`/`transferred`/`withdrawn` sau `starts_at` của buổi. Ghi danh `pending`, `deferred`, `cancelled` không vào danh sách.
       Cả `ended_at` và `starts_at` đều là ISO UTC dạng `toISOString()`, nên so sánh chuỗi chỉ đúng khi buổi học đã được chuẩn hóa như vậy.
       Học viên chuyển vào lớp chỉ xuất hiện ở buổi có `starts_at` bằng hoặc sau lúc ghi danh của họ bắt đầu: `COALESCE(confirmed_at, created_at) <= starts_at`. Ghi danh mới sinh từ chuyển lớp có `confirmed_at = tx.now`.
     - buổi `trial`: các `trial_booking` có status `booked` hoặc `done`;
     - buổi `makeup`: đúng ghi danh của lần vắng gốc.
     - Mỗi dòng gồm: `enrollmentId` hoặc `trialBookingId`, **chỉ tên học viên**, `status` (không có dòng attendance thì là `unmarked`), `attendanceId`, `version`.
  3. **`markAttendance`**
     - Phải `canTeach`. Buổi phải `scheduled`. Mỗi entry phải nằm trong `sessionRoster`.
     - Upsert từng dòng: chưa có thì `insertVersioned`, có rồi thì `update` theo version hiện tại đọc trong cùng handler.
     - Khi `present` hoặc `late`:
       - buổi `regular` hoặc `makeup`, ghi danh đang `confirmed` thì chuyển sang `studying`. Thêm `markAttendance: ['confirmed']` vào bảng `ENROLLMENT_FROM`, export bảng đó, và kiểm chuyển trạng thái qua bảng. Ghi danh đang `studying` giữ nguyên, không lỗi. Bước `started` của lead nếu còn `open` thì thành `done`, chỉ qua `markStepDone`;
       - buổi `trial`: `trial_booking` thành `done`. Đổi stage lead sang `trial_done` bằng `tx.update('lead', id, version đọc trong handler, …)`, chỉ khi `lead.pipeline = 'learner'`, `status = 'active'` và `stage = 'trial_booked'`. Bước `trial` chỉ đánh `done` qua `markStepDone` khi còn `open`. Nếu bước đã `skipped` (sale bỏ qua rồi thắng), giữ nguyên và không đổi stage. Ghi activity `stage_changed`.
     - **Không** đụng bảng tiền.
  4. **`createMakeupSession`**
     - Lần vắng gốc phải có `status` là `absent` hoặc `excused` và gắn với một `enrollment`.
     - Lớp phải `open`.
     - Tạo `class_session` mới bằng `tx.insertVersioned('class_session', { kind: 'makeup', makeup_for_attendance_id, … })`, cùng lớp. Chuẩn hóa `startsAt` thành ISO UTC bằng `new Date(x).toISOString()`, giống buổi học thường.
     - `addSession` vẫn cấm `kind = 'makeup'` ở contract, giữ nguyên.
     - Lần vắng gốc giữ nguyên.
  5. Các route GET, gắn trong `index.ts`:
     - `GET /my-classes`: teacher thấy các lớp được gán kèm buổi sắp tới và các buổi đã qua. Academic và admin thấy mọi lớp. Không trả số tiền. Không trả tổng số học viên của cả trung tâm.
     - `GET /sessions/:id/attendance`: phải `canTeach`, trả `sessionRoster`, thông tin buổi và link học (`note`).
- Verify: no verification needed (Task 4.5).

### Task 4.4: Web

- Target: `my-classes.tsx`, `session-attendance.tsx`, `class-detail.tsx`, `router.tsx`, `layout.tsx`.
- Steps:
  1. Thêm mục nav "Lớp của tôi" (`/my-classes`), roles teacher, academic, admin. Với teacher, đây là mục nav duy nhất ngoài đổi mật khẩu.
     Route `/` chuyển hướng `teacher` sang `/my-classes`, và `academic` sang `/courses`.
  2. `/my-classes`: danh sách lớp và buổi, mỗi buổi có nút "Điểm danh".
  3. `/sessions/$sessionId`:
     - mỗi học viên một dòng với 5 nút trạng thái, mặc định "Chưa điểm danh";
     - nút "Lưu" gửi một lệnh `markAttendance` cho cả buổi.
  4. `class-detail.tsx`: dòng điểm danh `absent`/`excused` có nút "Tạo buổi học bù" (chọn ngày giờ và thời lượng).
     `classDetail` thêm mảng `absences` gồm `attendanceId`, `enrollmentId`, `sessionId`, `status` (`absent` hoặc `excused`) và `startsAt`, để nút có dữ liệu.
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 4.5: Test

- Target: `apps/crm/test/attendance.test.ts`.
- Seed không có user `academic` hay `teacher`. Tách `addUser`, `makeClass`, `winLead`, `reserve` và `grantConsent` từ `academic.test.ts` ra `test/helpers/learner-fixtures.ts` rồi dùng lại, thay vì chép. Teacher được gán bằng `setClassTeachers`.
- Steps: viết các test sau.
  1. Buổi mới tạo: roster có học viên đã xác nhận với `status = 'unmarked'`. Học viên `pending` và `deferred` không có trong roster.
  2. Teacher không được gán lớp gọi `markAttendance` thì `FORBIDDEN`. Teacher được gán thì OK.
  3. Đánh `late` lần đầu: ghi danh thành `studying`, bước `started` là `done`.
  4. Đánh `absent` rồi tạo học bù: buổi mới có `kind = 'makeup'`, lần vắng gốc vẫn `absent`. Roster của buổi bù chỉ có học viên đó.
  5. Trial: đánh `present` thì lead thành `trial_done` và bước `trial` là `done`.
  6. Kiểm tĩnh, không phải test hành vi: chạy `Select-String -Path apps/crm/src/worker/attendance.ts -Pattern "charge|payment"`, phải không ra dòng nào. Test hành vi (số liệu tiền không đổi sau khi điểm danh) thuộc phase 05.
  7. Response của `GET /sessions/:id/attendance` cho teacher không có khóa `phone` và không có khóa nào chứa `amount`.
  8. Teacher nhận 403 ở `GET /classes/:id` (giữ từ phase trước) và chỉ thấy lớp mình trong `/my-classes`. Ghi danh `deferred` không vào roster của buổi `regular`.
- Verify: `pnpm -F @abm/crm test` exit 0. Output có `attendance.test.ts` và không có `failed`.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.

## Rủi ro và rollback

- **Rollback:** revert commit.
