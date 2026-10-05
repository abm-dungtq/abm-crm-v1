---
phase: 3
title: "Học vụ: khóa, lớp online, buổi học, học thử, giữ chỗ, xác nhận, bảo lưu, chuyển lớp"
status: pending
priority: P1
effort: "2d"
dependencies: [2]
---

# Phase 03: Học vụ

## Goal

Học vụ làm được các việc sau theo PRD §7-§8:

- mở khóa (mỗi khóa thuộc một sản phẩm), lớp và buổi học;
- gán giáo viên cho lớp;
- xác nhận chỗ, bảo lưu, học lại, chuyển lớp, kết thúc hoặc rút ghi danh.

Tuyển sinh làm được các việc sau:

- đặt buổi học thử cho lead đủ điều kiện;
- giữ chỗ cho lead đã thắng (tạo ghi danh chờ);
- hủy ghi danh đang chờ của lead mình phụ trách.

Số học viên của lớp chỉ đếm ghi danh `confirmed` và `studying`.

Mọi lệnh chạy từ `D:\TQD\CRM`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0008_academic.sql`
- Create: `apps/crm/src/worker/academic-commands.ts`, `apps/crm/src/worker/academic-queries.ts`
- Modify: `apps/crm/src/worker/commands.ts` (đăng ký `academicHandlers`)
- Modify: `apps/crm/src/worker/index.ts` (route GET)
- Modify: `apps/crm/src/worker/learner-queries.ts` (cột "Khóa học" lấy tên khóa từ ghi danh chưa kết thúc)
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/crm/test/helpers/reset-db.ts`
- Create: `apps/crm/src/web/pages/products.tsx`, `courses.tsx`, `class-detail.tsx`
- Modify: `apps/crm/src/web/pages/learner-detail.tsx` (nút Đặt học thử, Giữ chỗ, Hủy chờ), `router.tsx`, `layout.tsx`
- Create: `apps/crm/test/academic.test.ts`

## Tasks

### Task 3.1: Migration 0008

- Target: `apps/crm/migrations/0008_academic.sql`. Mọi bảng đều có `created_at`, `updated_at`, `version`, `last_txn_id`.
- Steps:
  1. `course`: `id`, `organization_id`, `product_id` (FK product, NOT NULL), `name TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed'))`.
  2. `class_group`. Không đặt tên bảng là `class` để tránh từ khóa và nhầm lẫn.
     - Cột: `id`, `course_id` (FK course), `name TEXT NOT NULL`, `schedule_text TEXT`, `note TEXT` (chỗ dán link học), `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled','finished'))`.
  3. `class_teacher`: `id`, `class_id` (FK class_group), `user_id` (FK app_user), `created_at`, `UNIQUE (class_id, user_id)`.
  4. `class_session`:
     - cột: `id`, `class_id` (FK class_group), `starts_at TEXT NOT NULL`, `duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0)`, `kind TEXT NOT NULL CHECK (kind IN ('regular','trial','makeup'))`, `status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled'))`, `note TEXT`, `makeup_for_attendance_id TEXT`;
     - phase 04 mới tạo bảng attendance. Không đặt FK ở đây, kiểm trong lệnh;
     - index `(class_id, starts_at)`.
  5. `enrollment`:
     - cột: `id`, `organization_id`, `lead_id` (FK lead), `contact_id` (FK contact), `class_id` (FK class_group), `status TEXT NOT NULL CHECK (status IN ('pending','confirmed','studying','deferred','transferred','completed','withdrawn','cancelled'))`, `deferred_until TEXT`, `status_before_defer TEXT`, `transferred_from_enrollment_id TEXT`, `confirmed_at TEXT`, `ended_at TEXT`;
     - `CHECK (status <> 'deferred' OR deferred_until IS NOT NULL)`;
     - index `(class_id, status)` và `(contact_id)`.
  6. `trial_booking`: `id`, `lead_id` (FK lead), `session_id` (FK class_session), `status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','done','cancelled'))`.
  7. Thêm các bảng mới vào `TABLES` của `reset-db.ts`. Đặt bảng con trước bảng cha: `trial_booking`, `enrollment`, `class_session`, `class_teacher`, `class_group`, `course` phải đứng trước `lead`, `product`, `app_user`.
- Verify: `pnpm -F @abm/crm test` exit 0.

### Task 3.2: Hợp đồng dùng chung

- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Thêm `ENROLLMENT_STATUSES` với nhãn: Chờ, Đã xác nhận, Đang học, Bảo lưu, Đã chuyển, Đã học xong, Đã rút, Đã hủy.
     Thêm `COUNTED_ENROLLMENT = ['confirmed','studying']`.
  2. Thêm schema và lệnh. Mọi lệnh đều `agentNeedsApproval: false`.

     | Lệnh | Input | Roles |
     |---|---|---|
     | `upsertCourse` | `{id?, version?, productId, name, status}` | academic, admin |
     | `upsertClass` | `{id?, version?, courseId, name, scheduleText?, note?, status}` | academic, admin |
     | `setClassTeachers` | `{classId, version, teacherUserIds: id[] (max 10)}` | academic, admin |
     | `addSession` | `{classId, startsAt, durationMinutes, kind: 'regular' \| 'trial', note?}` | academic, admin |
     | `updateSession` | `{sessionId, version, startsAt?, durationMinutes?, note?, status?}` | academic, admin |
     | `bookTrial` | `{leadId, version, sessionId}` | sale, leader, admin |
     | `reserveSeat` | `{leadId, version, classId}` | sale, leader, admin |
     | `cancelPendingEnrollment` | `{enrollmentId, version}` | sale, leader, admin |
     | `confirmEnrollment` | `{enrollmentId, version}` | academic, admin |
     | `deferEnrollment` | `{enrollmentId, version, until: isoDate}` | academic, admin |
     | `resumeEnrollment` | `{enrollmentId, version}` | academic, admin |
     | `transferEnrollment` | `{enrollmentId, version, toClassId}` | academic, admin |
     | `endEnrollment` | `{enrollmentId, version, outcome: 'completed' \| 'withdrawn'}` | academic, admin |

- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 3.3: Handler học vụ

- Target: `apps/crm/src/worker/academic-commands.ts`. Export `academicHandlers` rồi gộp vào map `handlers` trong `commands.ts`.
- Steps:
  1. `upsertCourse`: sản phẩm phải tồn tại. Khóa không có giá riêng.
  2. `upsertClass`: hủy lớp là đổi `status = 'cancelled'`, không xóa gì.
  3. `setClassTeachers`:
     - mỗi user phải có `role = 'teacher'` và đang hoạt động;
     - xóa các dòng `class_teacher` cũ rồi chèn lại;
     - bump version của `class_group` bằng `tx.update` để chống ghi đè đồng thời.
  4. `addSession` / `updateSession`: hủy buổi là đổi `status = 'cancelled'`. Không ai được tạo `kind = 'makeup'` ở đây, vì buổi học bù thuộc phase 04.
  5. `bookTrial`:
     - lead `learner` có `stage = 'qualified'` và thuộc quyền sửa của actor;
     - buổi có `kind = 'trial'` và đang `scheduled`;
     - tạo `trial_booking`, chuyển stage sang `trial_booked`, ghi activity.
  6. `reserveSeat`:
     - lead phải `stage = 'won'`, thuộc quyền sửa của actor, và lớp phải `open`;
     - tạo `enrollment` với `status = 'pending'`, `contact_id` lấy từ lead;
     - không có lựa chọn người trả, người trả luôn là học viên.
  7. `cancelPendingEnrollment`: chỉ ghi danh `pending` của lead mà actor là owner, Leader cùng nhóm hoặc Admin. Chuyển sang `cancelled`.
  8. `confirmEnrollment`:
     - chỉ từ `pending`;
     - khách phải có đồng ý `enrollment` mới nhất là `granted = 1`, nếu không trả `VALIDATION_FAILED`, "Khách chưa đồng ý mục Quản lý ghi danh";
     - không kiểm sức chứa của lớp;
     - đặt `confirmed`, `confirmed_at`;
     - bước `placed` của lead chuyển thành `done`.
  9. `deferEnrollment`:
     - từ `confirmed` hoặc `studying`;
     - lưu `status_before_defer`, đặt `deferred_until`, chuyển sang `deferred`;
     - không đụng học phí.
  10. `resumeEnrollment`: từ `deferred` quay về `status_before_defer`, rồi xóa `deferred_until` và `status_before_defer`. Hết hạn bảo lưu không tự đổi gì.
  11. `transferEnrollment`:
      - từ `confirmed`, `studying` hoặc `deferred`;
      - ghi danh cũ chuyển sang `transferred` và có `ended_at`;
      - tạo ghi danh mới ở lớp đích với `status = 'confirmed'` và `transferred_from_enrollment_id`;
      - **không** tạo hay đổi khoản tiền nào, việc đó thuộc phase 05.
  12. `endEnrollment`: từ `confirmed`, `studying` hoặc `deferred`, chuyển sang `completed` hoặc `withdrawn`, có `ended_at`.
  13. Mọi handler đều ghi `tx.audit`. Thao tác gắn với lead (book, reserve, confirm, transfer) ghi thêm `tx.activity` lên lead.
- Verify: no verification needed (Task 3.6).

### Task 3.4: Truy vấn

- Target: `apps/crm/src/worker/academic-queries.ts`, `apps/crm/src/worker/index.ts`, `apps/crm/src/worker/learner-queries.ts`.
- Steps:
  1. `GET /courses`: danh sách khóa kèm các lớp. Mỗi lớp có `studentCount` (đếm `COUNTED_ENROLLMENT` trong SQL) và số buổi.
     - Roles: academic, admin, director. Riêng sale và leader chỉ thấy lớp `open` để giữ chỗ, kèm `id`, `name`, `scheduleText` và tên khóa.
  2. `GET /classes/:id`:
     - academic và admin: lớp, giáo viên, các buổi, mọi ghi danh (tên học viên, trạng thái, lead code), các trial booking.
     - teacher: trả `FORBIDDEN`. Màn hình của giáo viên thuộc phase 04.
  3. `GET /enrollments/overdue-deferrals`: các ghi danh `deferred` có `deferred_until < now`. Roles: academic, admin.
  4. Trong `learner-queries.ts`, cột `course` đổi thành tên các khóa lấy từ ghi danh có status thuộc `pending`, `confirmed`, `studying`, `deferred`. Nếu không có thì dùng tên sản phẩm đang gắn như phase 02. Bộ lọc `course` khớp đúng chuỗi đang hiện.
- Verify: no verification needed (Task 3.6).

### Task 3.5: Web

- Target: `products.tsx`, `courses.tsx`, `class-detail.tsx`, `learner-detail.tsx`, `router.tsx`, `layout.tsx`.
- Steps:
  1. Thêm 2 mục nav:
     - "Sản phẩm" (`/products`), roles academic, admin, sale, leader. Sale và leader chỉ xem.
     - "Khóa & lớp" (`/courses`), roles academic, admin.
  2. `/products`: bảng danh mục. Academic và admin có form thêm/sửa, có bật/tắt "còn bán".
  3. `/courses`:
     - danh sách khóa và lớp kèm số học viên;
     - form tạo khóa (chọn sản phẩm) và tạo lớp;
     - một khối "Bảo lưu quá hạn".
  4. `/classes/$classId`:
     - thông tin lớp và link học;
     - gán giáo viên (chọn nhiều user có `role = 'teacher'`; cần thêm route `GET /team-members?role=teacher` hoặc dùng danh sách user của admin, chọn cách ít sửa nhất);
     - các buổi: thêm, hủy, sửa ghi chú;
     - ghi danh, mỗi dòng có nút Xác nhận, Bảo lưu (kèm ngày), Học lại, Chuyển lớp, Kết thúc.
  5. `learner-detail.tsx`:
     - nút "Đặt học thử" khi stage là `qualified`;
     - nút "Giữ chỗ" khi lead `won`;
     - danh sách ghi danh của khách, ghi danh `pending` có nút "Hủy chờ".
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 3.6: Test

- Target: `apps/crm/test/academic.test.ts`. Dựng dữ liệu bằng các lệnh của phase 01-02: sản phẩm, lead học viên thắng, đồng ý.
- Steps: viết các test sau.
  1. `reserveSeat` trên lead chưa `won` thì lỗi. Trên lead `won` thì tạo `pending`, và `studentCount` vẫn là 0.
  2. `confirmEnrollment` khi chưa có đồng ý `enrollment` thì lỗi. Có đồng ý thì OK, `studentCount` là 1 và bước `placed` là `done`.
  3. Hai học viên khác nhau cùng vào một lớp đều được xác nhận, `studentCount` là 2.
  4. `deferEnrollment` khi thiếu `until` thì `VALIDATION_FAILED`. Bảo lưu thì `studentCount` giảm. `resumeEnrollment` thì quay về đúng trạng thái trước đó, thử cả `confirmed` lẫn `studying`.
  5. `transferEnrollment`: ghi danh cũ là `transferred`, ghi danh mới là `confirmed` ở lớp đích, số khoản tiền không đổi.
  6. `cancelPendingEnrollment` do sale khác gọi thì `FORBIDDEN`.
  7. `bookTrial` thì stage thành `trial_booked`.
  8. `teacher` gọi `GET /classes/:id` thì nhận 403. `sale` gọi `confirmEnrollment` thì `FORBIDDEN`.
  9. Ghi danh quá hạn bảo lưu xuất hiện trong `overdue-deferrals`.
- Verify: `pnpm -F @abm/crm test` exit 0. Output có `academic.test.ts` và không có `failed`.

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

- **Trạng thái ghi danh nhiều nhánh.** Viết một bảng chuyển trạng thái hợp lệ dưới dạng hằng số trong `academic-commands.ts`, rồi kiểm mọi lệnh qua bảng đó.
- **Rollback:** revert commit.
