# Report: LMS Video Links (`importLessonVideos` & `/lms-videos`)

## Files Changed / Created
- `packages/contracts/src/index.ts` — Added `importLessonVideosInput` schema and registered `importLessonVideos` in `COMMANDS` (`roles: ['academic', 'admin', 'teacher']`, `riskLevel: 'medium'`, `idempotent: true`, `expectedVersion: false`, `agentNeedsApproval: false`).
- `apps/crm/src/worker/lms-programs.ts` — Refactored `attachVideo` to accept an optional explicit `position`, implemented `importLessonVideos` (parsing Cloudflare Stream links/bare UIDs, title extraction, class/section matching, manual overrides, duplicate and `canTeach` checks, single-query position lookup and batch commit), and included non-hidden lessons in `listPrograms`.
- `apps/crm/src/worker/index.ts` — Allowed `teacher` role on `GET /lms/programs` so teachers can use the `/lms-videos` page.
- `apps/crm/src/web/pages/lms-videos.tsx` (new) — Built the "Video bài học" page with Section 1 ("Dán link video" bulk paste, default program selector, preview table with Vietnamese status chips, per-row lesson override selector grouped by program, and commit action) and Section 2 ("Video đã gắn" program selector, lesson/video list with shortened UID, inline rename via `updateLessonVideo`, and delete with confirmation via `deleteLessonVideo`).
- `apps/crm/src/web/router.tsx` — Added `/lms-videos` route.
- `apps/crm/src/web/components/layout.tsx` — Added "Video bài học" nav item next to "Tài khoản học viên" for roles `['academic', 'admin', 'teacher']`.
- `apps/crm/src/web/types.ts` — Added `LmsProgramOptionLesson`, `ImportLessonVideoStatus`, `ImportLessonVideoRow`, and `ImportLessonVideosResult` types.
- `apps/crm/test/lms-videos.test.ts` (new) — Added 8 Vitest tests covering all Cloudflare Stream URL formats, bare UIDs, invalid hosts, missing titles, class name matching (longest match, accent/case-insensitive) vs default program, whole-word `section_id` matching, manual overrides (valid and hidden/invalid), DB and in-paste duplicates, teacher permission checks, preview dry-run vs commit with consecutive positions, and the 100-line limit.

## Verification & Test Counts
- `pnpm --filter @abm/crm typecheck`: Exit 0
- `pnpm --filter @abm/crm exec vitest run lms`: 5 test files passed, 39 tests passed (including 8 new tests in `test/lms-videos.test.ts`)
- `pnpm --filter @abm/crm test`: 49 test files passed (1 skipped), 605 tests passed (2 skipped)
- `pnpm --filter @abm/crm build`: Exit 0

## Open Issues
- None.

Status: DONE
Summary: Implemented the `importLessonVideos` backend command and the `/lms-videos` ("Video bài học") CRM page for bulk matching and attaching Cloudflare Stream video UIDs to online program lessons, alongside listing, renaming, and deleting attached videos. All 605 tests (including 8 new tests in `lms-videos.test.ts`), typechecks, and production build pass with exit code 0.
Concerns/Blockers: None
