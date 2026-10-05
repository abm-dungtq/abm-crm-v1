---
phase: 6
title: "Báo cáo theo vai trò, yêu cầu dữ liệu cá nhân, quyền bot, tài liệu"
status: completed
priority: P1
effort: "1.5d"
dependencies: [4, 5]
---

# Phase 06: Báo cáo, dữ liệu cá nhân, bot, tài liệu

## Goal

- **Báo cáo theo PRD §11:**
  - Admin và BGĐ thấy: pipeline học viên, số học viên theo lớp, các buổi hôm nay chưa điểm danh, học viên vắng liên tiếp từ hai buổi, tuổi nợ, tiền vào theo ngày, giờ dạy.
  - Tuyển sinh thấy số lead theo nguồn và theo hợp đồng.
  - Tổ chức không thấy tên doanh nghiệp trong báo cáo.
  - Giáo viên chỉ thấy điểm danh và giờ dạy của lớp mình.
- **Dữ liệu cá nhân:**
  - Nhân viên ghi được yêu cầu truy cập, sửa, rút đồng ý hoặc xóa hồ sơ.
  - Admin ẩn danh hồ sơ: ẩn tên và số điện thoại, giữ chứng từ tiền.
- **Bot:**
  - Công cụ MCP chỉ hiện với vai trò được dùng.
  - Lead học viên của sale khác bị che số điện thoại.
- **Tài liệu** được cập nhật.

Mọi lệnh chạy từ `D:\TQD\CRM`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0011_privacy_requests.sql`
- Create: `apps/crm/src/worker/learner-reports.ts`, `apps/crm/src/worker/privacy.ts`
- Modify: `apps/crm/src/worker/commands.ts`, `index.ts`, `mcp-tools.ts`, `mcp-routes.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/crm/test/helpers/reset-db.ts`
- Create: `apps/crm/src/web/pages/learner-reports.tsx`, `privacy-requests.tsx`
- Modify: `apps/crm/src/web/router.tsx`, `layout.tsx`, `learner-detail.tsx` (nút "Ghi yêu cầu dữ liệu cá nhân")
- Create: `apps/crm/test/learner-reports.test.ts`, `apps/crm/test/privacy.test.ts`
- Modify: `apps/crm/test/mcp-gateway.test.ts`
- Docs:
  - Create: `docs/guides/learner-ops-user-guide.md`
  - Modify: `docs/architecture/erd-v1.md`, `docs/guides/staff-roster-template.md`, `apps/crm/public/mau-danh-sach-nhan-su.csv`, `docs/README.md`, `docs/security/permission-matrix-v1.md`

## Tasks

### Task 6.1: Migration 0011 và lệnh dữ liệu cá nhân

- Target: `apps/crm/migrations/0011_privacy_requests.sql`, `packages/contracts/src/index.ts`, `apps/crm/src/worker/privacy.ts`.
- Steps:
  1. Tạo bảng `privacy_request`:
     - cột: `id`, `organization_id`, `contact_id` (FK contact), `kind TEXT NOT NULL CHECK (kind IN ('access','correct','withdraw_consent','delete'))`, `detail TEXT`, `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','rejected'))`, `resolution TEXT`, `created_by_user_id`, `resolved_by_user_id`, `resolved_at`, cùng các cột version.
     - Thêm `privacy_request` vào `TABLES`, đặt trước `contact`.
     - Thêm `'privacy_request'` vào type `GuardedTable` trong `guarded-tx.ts`.
  2. Thêm các lệnh:

     | Lệnh | Input | Roles |
     |---|---|---|
     | `createPrivacyRequest` | `{contactId, kind, detail?}` | sale, leader, academic, accountant, admin |
     | `resolvePrivacyRequest` | `{requestId, version, status: 'done' \| 'rejected', resolution}` | admin |
     | `anonymizeContact` | `{contactId, version, requestId}` | admin |

  3. Handler `createPrivacyRequest`: Sale và Leader chỉ ghi được cho khách trong `customerScope`. Các vai trò khác ghi được cho mọi khách có lead học viên.
  4. Handler `anonymizeContact`:
     - `requestId` phải là yêu cầu `delete` đang `open` của chính khách này;
     - đổi `contact.display_name` thành `Đã ẩn danh`;
     - đổi `value` và `normalized_value` của mọi `contact_point` thuộc khách thành `'***'`. Đổi `normalized_value` thành `'***' || id` để không trùng khi tra cứu;
     - đặt `archived_at`;
     - ghi `consent` với `granted = 0` cho cả 5 mục đích;
     - giữ nguyên `charge`, `payment`, `payment_allocation`;
     - `charge.contact_id` vẫn trỏ vào khách đã ẩn danh, nên màn học phí hiện "Đã ẩn danh". Đó là hành vi đúng;
     - `searchFeeContacts` hiện không lọc `archived_at`. Phải lọc `archived_at IS NULL`, để không tạo khoản mới cho khách đã ẩn danh. `createCharge` đã từ chối khách đó, nhưng ô tìm vẫn hiện;
     - chữ tự do có thể còn chứa tên hoặc số điện thoại: `payment.memo`, `payment.payer_note`, `lead.need_summary`, `consent.note`. Giữ các cột này cùng chứng từ tiền. Câu hỏi có xóa chữ đó khi ẩn danh hay không vẫn mở;
     - đánh dấu yêu cầu là `done`;
     - ghi audit với `before_json` **không** chứa tên hay số điện thoại cũ, chỉ ghi `{anonymized: true}`.
- Verify: no verification needed (Task 6.6).

### Task 6.2: Báo cáo

- Target: `apps/crm/src/worker/learner-reports.ts`, route `GET /reports/learner` trong `index.ts`. Mọi số liệu tính bằng SQL tổng hợp, không lặp trong JS, để giữ CPU thấp.
- Steps:
  1. **`admin` và `director`** nhận các khối sau:
     - `pipeline`: đếm lead `learner` theo stage.
     - `classCounts`: mỗi lớp `open` một dòng, đếm ghi danh thuộc `COUNTED_ENROLLMENT`.
     - `unmarkedToday`: các buổi `scheduled` có `starts_at` trong ngày hôm nay theo giờ VN mà còn ít nhất một học viên của buổi chưa có attendance hoặc có attendance `unmarked`. Học viên của buổi dùng đúng `sessionRoster` đã export từ `attendance.ts`, không viết lại và không dùng `COUNTED_ENROLLMENT`: buổi `regular` gồm ghi danh `confirmed` hoặc `studying`, hoặc ghi danh đã kết thúc (`completed`, `transferred`, `withdrawn`) với `ended_at > starts_at`; buổi `trial` gồm `trial_booking` ở trạng thái `booked` hoặc `done`; buổi `makeup` gồm đúng một học viên từ `makeup_for_attendance_id`.
     - `absenceStreaks`: ghi danh có **2 buổi gần nhất đã điểm danh** đều `absent`. Dùng window function trên attendance của buổi `regular`, sắp theo `starts_at`.
     - `debtAging`: tổng số còn lại của các khoản `open` theo 4 nhóm tuổi (tính từ `charge.created_at`): 0-30, 31-60, 61-90, trên 90 ngày. Dùng `chargeBalanceSql` export từ `fees.ts`, chỉ khoản `open`, có tính adjustment âm.
     - `cashByDay`: tổng payment `in` trừ payment `refund` theo ngày VN của `payment.received_at`, 30 ngày gần nhất. Có index `payment_org_received`.
     - `teachingHours`: tổng `duration_minutes / 60` của buổi `scheduled` đã qua, loại `regular`, `makeup` và `trial`, theo giáo viên, trong tháng hiện tại. `class_teacher` gán giáo viên theo lớp, không theo buổi, và một lớp có thể có nhiều giáo viên: mỗi giáo viên được gán nhận đủ giờ của buổi. Ghi chú rõ đây không phải lương. `myHours` dùng cùng định nghĩa này.
  2. **`sale` và `leader`** nhận `bySource` và `byContract`, là số lead học viên trong scope. `byContract` có tên hợp đồng và tên doanh nghiệp. Không có khối tiền nào.
  3. **`academic`** nhận `classCounts`, `unmarkedToday`, `absenceStreaks`, và `bySource` đếm toàn đơn vị nhưng **không** có `byContract` và không có tên doanh nghiệp.
  4. **`teacher`** nhận `myAttendance` (số buổi theo trạng thái điểm danh, chỉ các lớp của mình) và `myHours`. Không có số học viên toàn trung tâm, không có tiền.
  5. **`accountant`** nhận `debtAging` và `cashByDay`.
  6. Báo cáo theo sale đọc owner trên chính lead. Lead học viên đã thắng (`status = 'won'`) không đổi owner khi khách về hồ chung vì owner nghỉ, bị khóa hoặc đổi vai: lệnh đổi sale chỉ cập nhật lead đang `active`. Lead thắng vẫn mang tên owner cũ.
- Verify: no verification needed (Task 6.6).

### Task 6.3: Quyền của bot (MCP)

- Target: `apps/crm/src/worker/mcp-tools.ts` (mảng `tools`, `callTool`), `apps/crm/src/worker/mcp-routes.ts` (`tools/list`).
- Steps:
  1. Gắn cho mỗi tool một danh sách roles. Trong `tools/list`, chỉ trả tool khi role của actor nằm trong danh sách đó. `tools/call` cũng kiểm lại điều kiện này.
     - `academic`, `teacher`, `accountant` chỉ có `whoami`.
  2. Kiểm `search_leads` và `get_lead` có đi qua `leadScope` hay không. Nếu có, sale đã không thấy lead học viên của người khác.
     - Thêm che số điện thoại theo quy tắc tuyển sinh cho mọi chỗ trả `phone` của lead `pipeline = 'learner'`. Dùng chung một hàm `maskPhoneForActor`, đặt trong `learner-queries.ts` và export ra.
     - `GET /leads/:id` (`leadDetail`) trả `contactPoints` cho mọi lead trong `leadScope`. Lead học viên mang `department_id` của owner, nên Trưởng phòng KD mở được `/leads/:id` và tool `get_lead` dù `GET /learners` trả 403 cho `head`. Khi `pipeline === 'learner'`, áp `mayInspect(actor, row: {owner_user_id, owner_team_id}, held)` (đang là hàm nội bộ của `learner-queries.ts`, cần export) lên `contactPoints`. `held` tính bằng `heldNow` / `isHeld` trong `learner-hold.ts`: chủ còn là sale hoặc leader đang hoạt động, và khách có lead học viên đã thắng hoặc hạn giữ chưa hết. `leadDetail` phải đọc `contact.owner_user_id` cùng `hold_expires_at`, tư cách chủ còn hiệu lực, và cờ lead đã thắng. `head` không nằm trong `customerScope` nên số bị che. Việc của lead học viên vẫn hiện trong danh sách việc của `head`; chỉ che số, không giấu việc.
  3. `change_stage` và `assign_lead` trên lead học viên đã bị chặn (Task 2.5). Thêm test xác nhận.
  4. Không đưa lệnh học viên vào bot. `agentNeedsApproval: true` của `winLearnerLead`, `closeLearnerLead` và `changeCustomerOwner` chưa có cơ chế: `runCommand` chỉ tạo đề xuất cho `changeStage` và `assignLead`. Bot hiện không gọi được các lệnh học viên. Giữ vậy, không thêm tool cho chúng. Thêm test `tools/list` không có tool nào gọi được ba lệnh đó.
- Verify: no verification needed (Task 6.6).

### Task 6.4: Web

- Target: `learner-reports.tsx`, `privacy-requests.tsx`, `learner-detail.tsx`, `router.tsx`, `layout.tsx`.
- Steps:
  1. Thêm 2 mục nav:
     - "Báo cáo học viên" (`/reports/learner`), mọi vai trò trừ `head`. Trang hiện đúng các khối API trả về.
     - "Dữ liệu cá nhân" (`/privacy`), chỉ `admin`. Trang có danh sách yêu cầu, nút Xong, Từ chối, và nút "Ẩn danh hồ sơ" cho yêu cầu xóa. Nút ẩn danh phải hỏi xác nhận trước khi chạy.
  2. `learner-detail.tsx`: thêm nút "Ghi yêu cầu dữ liệu cá nhân".
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 6.5: Tài liệu

- Target: các file docs ở mục Files.
- Steps:
  1. `docs/guides/learner-ops-user-guide.md`: hướng dẫn tiếng Việt cho từng vai trò (Tuyển sinh, Tổ chức, Giáo viên, Kế toán, Admin). Mỗi vai trò có các bước chính trên màn hình. Không quá 200 dòng.
  2. `docs/architecture/erd-v1.md`: thêm các bảng mới vào sơ đồ Mermaid và thêm một mục "Luồng học viên".
  3. `docs/guides/staff-roster-template.md` và `mau-danh-sach-nhan-su.csv`: thêm 3 vai trò `Tổ chức`, `Giáo viên`, `Kế toán`. Cả ba để trống phòng ban và nhóm.
  4. `docs/README.md`: thêm link tới ADR-007, hướng dẫn mới và PRD.
  5. `docs/security/permission-matrix-v1.md`: dòng học phí của Admin đang ghi `R`, sửa thành `R/W` cho khớp code (accountant và admin đều ghi). BGĐ ghi `R`. Chỉ Admin sửa tài khoản ngân hàng.
- Verify: chạy `Select-String -Path docs/README.md -Pattern "adr-007"`, phải ra ít nhất 1 dòng.

### Task 6.6: Test

- Target: `learner-reports.test.ts`, `privacy.test.ts`, `mcp-gateway.test.ts`.
- Steps:
  1. **Báo cáo:**
     - Admin nhận đủ 7 khối.
     - Teacher không có `classCounts` và không có khóa nào chứa `amount` hay `cash`.
     - Academic không có `byContract` và response không chứa tên doanh nghiệp đã seed.
     - Sale không có `debtAging`.
     - `absenceStreaks` có học viên vắng 2 buổi liên tiếp, không có học viên vắng xen kẽ có mặt.
     - Tạo một buổi `starts_at` là hôm nay, chưa điểm danh: buổi đó có trong `unmarkedToday`. Điểm danh đủ thì buổi biến mất khỏi danh sách.
     - Tạo khoản 1.000.000, sửa `created_at` về 45 ngày trước bằng SQL: `debtAging` nhóm 31-60 có 1.000.000.
  2. **Dữ liệu cá nhân:**
     - Ẩn danh xong thì `GET /learners/:id` trả tên `Đã ẩn danh`, không lộ số điện thoại cũ ở bất kỳ đâu, số dòng `charge` và `payment` không đổi, và tổng `amount_vnd` của `charge` cùng `payment_allocation` không đổi.
     - `anonymizeContact` không có yêu cầu `delete` đang mở thì lỗi.
     - Sale gọi `anonymizeContact` thì `FORBIDDEN`.
  3. **MCP:**
     - Token của user `accountant` gọi `tools/list` chỉ thấy `whoami`.
     - Sale B gọi `get_lead` cho lead học viên của sale A thì không thấy lead đó, hoặc thấy với `phone` null.
     - `head` gọi `get_lead` và `GET /leads/:id` cho lead học viên thì `phone` null (và mọi `contactPoints` bị che).
     - `change_stage` trên lead học viên thì báo lỗi.
     - `tools/list` không có tool nào gọi `winLearnerLead`, `closeLearnerLead` hoặc `changeCustomerOwner`.
- Verify: `pnpm -F @abm/crm test` exit 0 và không có `failed`. `pnpm -F @abm/crm typecheck` exit 0.

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

- **Ẩn danh là thao tác không đảo ngược được trên dữ liệu thật.** Trên eval chỉ thử với khách tạo để kiểm thử. UI phải hỏi xác nhận.
- **Rollback:** revert commit.
