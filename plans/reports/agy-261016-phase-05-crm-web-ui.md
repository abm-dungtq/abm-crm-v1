# Phase 05 Report: CRM web — staff screens

## Tasks Executed

- **Task 5.1 — `ClassOnlineProgram` component (`apps/crm/src/web/components/class-online-program.tsx`)**:
  - Loads `GET /api/classes/:id/lms` via `useApi`, handling loading (`<Loading />`), 403 (`<Alert tone="warn">Bạn không có quyền xem chương trình của lớp này</Alert>`), and general errors (`<ErrorState />`).
  - Computes one `can` object from `actor.role` per Supervisor Amendment 2 (`manageProgram`, `manageAccounts`, `manageVideos`) and re-fetches `/classes/:id/lms` after every successful command so counts and the version badge stay current.
  - Renders the empty-program state with clone-from-class picker (`GET /api/lms/programs`, `cloneLmsProgram`) for `academic`/`admin`.
  - Renders program header (title, `Phiên bản N · <publishedAt>` badge, enrolled/account/email counts, review-days display + edit modal via `updateLmsProgram`, "Xem như học viên" preview-url button, and "Tạo tài khoản cho cả lớp" via `createClassLearnerAccounts` with skipped-learner alert).
  - Displays warning alert when `hasDefaultPassword` is `false`, a table of `learnersWithoutAccount` with individual email entry + "Tạo tài khoản" (`createLearnerAccount`), and the lessons table (visible lessons first, hidden lessons last with `Đã gỡ khỏi cẩm nang` badge) with add/edit/delete video modals (`addLessonVideo`, `updateLessonVideo`, `deleteLessonVideo`).
- **Task 5.2 — Place the component**:
  - Rendered `<ClassOnlineProgram classId={classId} />` as a full-width section at the bottom of `apps/crm/src/web/pages/class-detail.tsx`.
  - Created `apps/crm/src/web/pages/class-online.tsx` (`ClassOnlinePage`) with a back link to `/my-classes`.
  - Registered `/classes/$classId/online` in `apps/crm/src/web/router.tsx`.
  - Added `<Link to="/classes/$classId/online" params={{ classId: klass.id }} className="btn btn-sm">Chương trình online</Link>` to each class card in `apps/crm/src/web/pages/my-classes.tsx`.
- **Task 5.3 — Partner import with class (`apps/crm/src/web/pages/partner-detail.tsx`)**:
  - Loaded `GET /api/lms/open-classes` in `ImportCard` and added the "Ghi danh vào lớp" select (`Không ghi danh (chỉ tạo lead như trước)` or `<name> — <courseName>[ · có chương trình online]`).
  - Per Supervisor Amendment 1: changing the class, owner, or CSV file clears `preview`; `classId` is sent only when selected, and commit sends the exact same `classId` and CSV as preview; `summary` badges and the per-row `Tài khoản` column are shown only when `classId` is set; row-level `errors` (`line !== null`) are displayed next to their line number rather than as a page-level failure.
  - Updated the commit button label to `Xác nhận nhập ${n} học viên vào lớp ${className}` when a class is chosen.
- **Task 5.4 — "Tài khoản học viên" page (`apps/crm/src/web/pages/learner-accounts.tsx`)**:
  - Added route `/learner-accounts` in `apps/crm/src/web/router.tsx` and nav leaf `{ to: '/learner-accounts', label: 'Tài khoản học viên', roles: ['academic', 'admin', 'director'] }` under the "Đào tạo" group in `apps/crm/src/web/components/layout.tsx`.
  - Added Admin-only "Mật khẩu mặc định của học viên" card (`GET /api/lms/settings`, `setLearnerDefaultPassword` with two matching password inputs ≥ 8 chars, clearing inputs immediately on submit without displaying or logging the password).
  - Added debounced search (`useDebounced`), program filter (`classId` from `GET /api/lms/programs`), and password-state filter (`'' | 'default' | 'changed'`).
  - Rendered accounts table with program badges (`cấp tay` / `chặn` + per-grant `Thu hồi` via `revokeProgramAccess`), password badge (`Mặc định` / `Đã đổi`), status badge (`Hoạt động` / `Đã khoá` / `Tạm khoá đến hh:mm`), last login time, and row actions for `academic`/`admin` (`Đặt lại MK` → `resetLearnerPassword`, `Khoá`/`Mở khoá` → `setLearnerAccountStatus`, `Cấp/chặn chương trình` modal → `grantProgramAccess`).

## Screens & Role Visibility

| Screen / Section | Route | Roles & Permissions |
|---|---|---|
| Mục "Chương trình học online" trong chi tiết lớp | `/classes/$classId` | `academic`, `admin`: toàn quyền (nhân bản, sửa tiêu đề/số ngày xem lại, tạo tài khoản cả lớp/từng người, thêm/sửa/xoá video, xem thử). `director`: chỉ xem + xem thử. |
| Trang "Chương trình học online" của lớp | `/classes/$classId/online` (từ `/my-classes`) | `teacher` (được phân công lớp): xem chương trình, xem như học viên, thêm/sửa/xoá video bài học (`can.manageVideos = true`, ẩn toàn bộ nút sửa chương trình và tạo tài khoản). `academic`, `admin`: toàn quyền. `director`: chỉ xem. |
| Nhập học viên từ CSV (trang Đối tác) | `/partners/$id` | `sale`, `leader`, `admin`: chọn lớp đang mở để ghi danh + tạo tài khoản học viên khi nhập CSV, xem trước tóm tắt tài khoản và lỗi theo dòng. `director`: chỉ xem trang đối tác. |
| Trang "Tài khoản học viên" | `/learner-accounts` (nhóm "Đào tạo") | `admin`: đặt mật khẩu mặc định + toàn bộ thao tác Học vụ. `academic`: tìm/lọc, đặt lại MK mặc định, khoá/mở khoá, cấp/chặn và thu hồi quyền chương trình. `director`: chỉ xem (ẩn thẻ mật khẩu mặc định và mọi nút thao tác). |

## Files Created / Modified

- Created: `apps/crm/src/web/components/class-online-program.tsx`
- Created: `apps/crm/src/web/pages/class-online.tsx`
- Created: `apps/crm/src/web/pages/learner-accounts.tsx`
- Modified: `apps/crm/src/web/pages/class-detail.tsx`
- Modified: `apps/crm/src/web/pages/my-classes.tsx`
- Modified: `apps/crm/src/web/pages/partner-detail.tsx`
- Modified: `apps/crm/src/web/router.tsx`
- Modified: `apps/crm/src/web/components/layout.tsx`
- Modified: `apps/crm/src/web/types.ts`
- Created: `plans/reports/agy-261016-phase-05-crm-web-ui.md`

## Verify Commands & Results

1. **Task 5.1 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

2. **Task 5.2 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

3. **Task 5.3 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

4. **Task 5.4 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

5. **Task 5.5 Verify (workspace typecheck)**: `pnpm -r typecheck`
   - Result: PASS (exit code 0)
   - Output: All 6 workspace projects (`packages/contracts`, `packages/lms-core`, `poc/d1-guard`, `poc/goclaw-identity`, `apps/zalo-bridge`, `apps/crm`) typechecked with 0 errors.

6. **Task 5.5 Verify (CRM web build)**: `pnpm --filter @abm/crm build`
   - Result: PASS (exit code 0)
   - Output: `vite v7.3.6 building client environment for production... ✓ 300 modules transformed. ✓ built in 3.21s`

7. **Task 5.5 Verify (CRM tests)**: `pnpm --filter @abm/crm test`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 48 passed | 1 skipped (49)`, `Tests 597 passed | 2 skipped (599)`

Status: DONE
