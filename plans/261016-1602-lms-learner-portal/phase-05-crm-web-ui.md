---
phase: 5
title: "CRM web: staff screens"
status: completed
priority: P2
effort: "1.5d"
dependencies: [2, 3, 4]
---

# Phase 05: CRM web — staff screens

## Goal
Staff manage LMS from the CRM: an "Chương trình học online" section on the class page (and a teacher-reachable page for the same section), a class picker and account summary in the partner import, and a "Tài khoản học viên" page with the default-password setting. Visual reference: `plans/reports/brainstorm-261016-1538-lms-class-program-demo.html` (tabs "Demo CRM: …"); match the existing CRM look (`apps/crm/src/web/styles.css` tokens, components from `apps/crm/src/web/components/ui.tsx`), not the demo's exact CSS.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. All text in Vietnamese, matching existing wording style.
- Reads use `useApi(path)`; writes use `useCommand(name)` (`apps/crm/src/web/api.ts:62-102`). Follow `pages/class-detail.tsx` for section layout and `pages/partner-detail.tsx` `ImportCard` (l.109–170) for preview → commit.
- Never display or log the default password after submit; clear the field.

## Files to Create / Modify
- Create: `apps/crm/src/web/components/class-online-program.tsx`
- Create: `apps/crm/src/web/pages/class-online.tsx`
- Create: `apps/crm/src/web/pages/learner-accounts.tsx`
- Modify: `apps/crm/src/web/pages/class-detail.tsx` (render the section)
- Modify: `apps/crm/src/web/pages/my-classes.tsx` (link per class)
- Modify: `apps/crm/src/web/pages/partner-detail.tsx` (`ImportCard`)
- Modify: `apps/crm/src/web/router.tsx` (two routes), `apps/crm/src/web/components/layout.tsx` (one nav leaf)
- Modify: `apps/crm/src/web/types.ts` only to add response types used here

## API used (built in phases 02–04)
- `GET /api/classes/:id/lms`, `GET /api/classes/:id/lms/preview-url`, `GET /api/lms/programs`, `GET /api/lms/open-classes`, `GET /api/lms/accounts?q=&classId=&passwordState=`, `GET /api/lms/settings`
- Commands: `updateLmsProgram`, `cloneLmsProgram`, `addLessonVideo`, `updateLessonVideo`, `deleteLessonVideo`, `createClassLearnerAccounts`, `createLearnerAccount`, `resetLearnerPassword`, `setLearnerAccountStatus`, `grantProgramAccess`, `revokeProgramAccess`, `setLearnerDefaultPassword`, `importContractLearners` (with `classId`).

## Tasks

### Task 5.1 — `ClassOnlineProgram` component
- Goal: one component shows and edits a class's online program.
- Target: `components/class-online-program.tsx`, export `ClassOnlineProgram({ classId }: { classId: string })`.
- Steps:
  1. Load `useApi('/classes/' + classId + '/lms')`. Loading → `<Loading/>`; 403 → `<Alert tone="warn">Bạn không có quyền xem chương trình của lớp này</Alert>`.
  2. **No program:** `<Empty title="Lớp chưa có chương trình học online">` with text "Agent đăng cẩm nang bằng script, hoặc nhân bản từ lớp khác." and, for academic/admin, a select of `GET /lms/programs` (label "Nhân bản từ lớp…") + button "Nhân bản" → `cloneLmsProgram({ fromClassId, toClassId: classId })`; note under it: "Chỉ chép các phần bài học, không chép video."
  3. **Header:** title, `Badge` "Phiên bản N · <publishedAt formatted with existing format helpers in web/format.ts>", counts "X/Y học viên có tài khoản · Z chưa có email", review-days display "Xem lại sau khi lớp kết thúc: N ngày" or "không giới hạn", with "Sửa" opening a `Modal` (title + review days number input; empty = không giới hạn) → `updateLmsProgram`. Buttons: "Xem như học viên" (fetch preview-url then `window.open(url, '_blank', 'noopener')`), "Tạo tài khoản cho cả lớp" (academic/admin) → `createClassLearnerAccounts`, then toast "Đã tạo N tài khoản" and list skipped names in an `Alert`.
  4. If `hasDefaultPassword` is false: `<Alert tone="warn">Admin chưa đặt mật khẩu mặc định cho học viên — học viên chưa đăng nhập được.</Alert>`.
  5. **Learners without account** (`learnersWithoutAccount`): small table name/email; rows without email get an email input + "Tạo tài khoản" → `createLearnerAccount({ contactId, email })`; rows with email get "Tạo tài khoản" → `createLearnerAccount({ contactId })`.
  6. **Lessons table:** columns "Phần" (`sectionId` mono), "Tiêu đề" (+ `groupTitle` muted), "Video" (list of video titles with Sửa/Xoá; Xoá asks `confirm('Xoá video này khỏi phần?')`), action "+ Video". Hidden lessons are listed last with `Badge tone="warn"` "Đã gỡ khỏi cẩm nang".
  7. **Add video modal:** fields "Tiêu đề" (required), segmented choice "ID video Stream" / "Link MP4 công khai"; send `streamUid` or `sourceUrl` accordingly → `addLessonVideo`. Show `FormError` for failures (e.g. "Chưa cấu hình Cloudflare Stream").
  8. **Edit video modal:** title + position → `updateLessonVideo` with `version`.
  9. Hide write controls the actor cannot use: teachers see video controls only; director sees read-only. Read actor role the way other pages do (search `useActor` / actor context in `web/actor-context.ts`).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 5.2 — Place the component
- Steps:
  1. `class-detail.tsx`: render `<ClassOnlineProgram classId={classId} />` as a full-width section after the existing sections.
  2. `pages/class-online.tsx`: page with a back link and `<ClassOnlineProgram classId={classId}/>` (param `classId`).
  3. `router.tsx`: add `createRoute({ getParentRoute: () => rootRoute, path: '/classes/$classId/online', component: ClassOnlinePage })` next to `/classes/$classId`.
  4. `my-classes.tsx`: in each class card add `<Link to="/classes/$classId/online" params={{ classId: klass.id }} className="btn btn-sm">Chương trình online</Link>`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 5.3 — Partner import with class
- Target: `partner-detail.tsx` `ImportCard`.
- Steps:
  1. Load `useApi('/lms/open-classes')`; add `<Field label="Ghi danh vào lớp">` select with first option "Không ghi danh (chỉ tạo lead như trước)" (value empty) and one option per class `"<name> — <courseName>"` plus " · có chương trình online" when `hasProgram`.
  2. Include `classId` in `body(commit)` only when chosen.
  3. When a class is chosen, the preview shows `summary` as badges: "N tạo tài khoản mới" (ok), "N đã có tài khoản → chỉ thêm lớp" (info), "N thiếu email → ghi danh, chưa có tài khoản" (warn), "N email đã dùng" (warn), and an "Tài khoản" column per row.
  4. Commit button text with class: `Xác nhận nhập ${n} học viên vào lớp ${className}`; without class: unchanged.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 5.4 — "Tài khoản học viên" page
- Target: `pages/learner-accounts.tsx`, route `/learner-accounts`, nav leaf `{ to: '/learner-accounts', label: 'Tài khoản học viên', roles: ['academic', 'admin', 'director'] }` in the "Đào tạo" group of `layout.tsx`.
- Steps:
  1. Admin-only card "Mật khẩu mặc định của học viên": state from `GET /lms/settings` ("Đã đặt" / "Chưa đặt"); form with two password inputs (min 8, must match) → `setLearnerDefaultPassword`; warning text "Đổi mật khẩu mặc định sẽ áp dụng cho mọi học viên chưa tự đổi mật khẩu."
  2. Filters: search box (`useDebounced`), select of programs from `GET /lms/programs` (sends `classId`), select "Mọi trạng thái mật khẩu / Còn mật khẩu mặc định / Đã đổi mật khẩu" (`passwordState` `''|'default'|'changed'`).
  3. Table: "Học viên" (name + email), "Chương trình" (titles; `Badge tone="agent"` "cấp tay" for grants, `Badge tone="danger"` "chặn" for blocks), "Mật khẩu" (`Badge warn` "Mặc định" / `ok` "Đã đổi"), "Trạng thái" (Hoạt động / Đã khoá / Tạm khoá đến hh:mm when `lockedUntil` in the future), "Đăng nhập gần nhất".
  4. Row actions (academic/admin): "Đặt lại MK" (confirm "Đưa tài khoản về mật khẩu mặc định?") → `resetLearnerPassword`; "Khoá"/"Mở khoá" → `setLearnerAccountStatus`; "Cấp/chặn chương trình" modal (program select, mode grant/block, optional expiry date, note) → `grantProgramAccess`; per grant/block "Thu hồi" → `revokeProgramAccess`.
  5. Director: read-only (no buttons).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 5.5 — Build and regression
- Verify: from `D:\TQD\CRM`: `pnpm -r typecheck` exits 0; `pnpm --filter @abm/crm build` exits 0; `pnpm --filter @abm/crm test` exits 0.
- Report `plans/reports/agy-261016-phase-05-crm-web.md` with a list of screens and which role sees what; last line `Status: DONE`. (Opus checks the screens in a browser in phase 08.)

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

## Supervisor amendments (kongming checkpoint after phase 04) — these override the tasks above
1. Partner import with a class: `summary` and the per-row `account` value exist only when `classId` is set. Row-level messages in `errors` (e.g. "Học viên đã có trong lớp", "Trùng học viên với dòng khác trong file") are shown next to their line, not as a page-level failure. Changing the class or the file after a preview clears the preview; the commit sends the same `classId` and CSV as the preview.
2. `ClassOnlineProgram` decides visible controls from one `can` object computed from the actor role (teacher: videos only; director: read-only; academic/admin: everything). After any successful command, re-fetch `/classes/:id/lms` so counts and the version badge update.
