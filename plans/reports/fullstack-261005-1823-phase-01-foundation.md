# Phase 01 foundation: implementation report

Status: completed. Every Verify step passes. Remote D1 untouched, nothing deployed, nothing committed.

## Files changed

Created:
- `apps/crm/migrations/0006_learner_foundation.sql` (rebuilds `app_user` and `lead` via backup table, adds contact owner/hold columns, `product`, `customer_product`, `consent`)
- `apps/crm/test/helpers/reset-db.ts`
- `apps/crm/test/learner-foundation.test.ts` (12 tests)
- `docs/adr/adr-007-learner-pipeline-and-fees.md`

Modified:
- `packages/contracts/src/index.ts` (ROLES x8, PIPELINES, LEARNER_STAGES, `stageLabel(code, pipeline)`, LEARNER_LOST_REASONS, LEARNER_JOURNEY(+VERSION), CONSENT_PURPOSES, `upsertProductInput`, `recordConsentInput`, `COMMANDS`, `updateUserInput.role` from ROLES)
- `apps/crm/src/worker/guarded-tx.ts`, `scope.ts` (`customerScope`), `roster.ts`, `commands.ts` (`upsertProduct`, `recordConsent`), `queries.ts` (`listProducts`, `canReadProducts`), `index.ts` (`GET /products`)
- `apps/crm/src/web/components/layout.tsx`, `apps/crm/src/web/pages/admin-users.tsx`
- `docs/security/permission-matrix-v1.md` (new section "Luồng học viên")
- Test files converted to `resetDb`: business-rules-hardening, commands, domain-commands, domain-read-models, overview, plus admin-users, agent-foundation, approval-notify, auth-login, lark-link, list-limits, mcp-gateway, security-api, security-integrity
- phase-01 file: `status: completed`

## Verify results

| Command | Result |
| --- | --- |
| `pnpm -F @abm/crm test` | pass, exit 0 (17 files, 235 tests) |
| `Select-String -Path apps/crm/test/*.test.ts -Pattern "const TABLES"` | pass, 0 lines |
| `pnpm -F @abm/crm test -- learner-foundation` (verbose) | pass, exit 0, 12 tests, no failures |
| `pnpm -F @abm/crm typecheck` | pass, exit 0 |
| `pnpm -F @abm/crm build` | pass, exit 0 |
| ADR-007 `Select-String` for the PRD and brainstorm file names | pass, 2 lines, both names present |

## Deviations

1. **Nine extra test files converted to `resetDb`.** The plan said five files had `TABLES`, but nine more declare a lowercase `const tables`, and the case-insensitive Verify matched them (9 lines). On kongming's advice they were converted too, keeping each file's own extra setup after `resetDb`. Plan text should say "all test files with a tables list".
2. **`admin-users.test.ts` role fixture.** One roster row used "Kế toán" as an invalid role. The plan makes "Kế toán" valid, so the row now uses "Bảo vệ" (still invalid). Kongming advised this exact edit.
3. **`canReadAudit` tightened** in `queries.ts`: the three new roles now get 403 instead of an empty list. Not in the plan; it only affects the new roles.
4. **`recordConsent` returns NOT_FOUND** for a contact that does not exist in the organization, and FORBIDDEN when it exists but is outside `customerScope`. The plan only specified FORBIDDEN.
5. The vitest default reporter does not print passing file names when not on a TTY, so the "output has `learner-foundation.test.ts`" check was confirmed with `--reporter=verbose`.
6. Additional `RolePicker` description strings and `NO_PLACEMENT_ROLES` in `admin-users.tsx` were needed to satisfy typecheck and the plan's hide-department rule.

## Notes for later phases

- In Git Bash `pnpm` finds no `node`; run through `powershell.exe` with `C:\Program Files\nodejs` and `%APPDATA%\npm` on PATH.
- Existing contacts have `owner_user_id = NULL`, so `customerScope` matches none for Sale/Leader until phase 02 assigns owners; Admin/BGĐ match by organization.
- `GuardedTable` now lists `contact`, `product`, `customer_product`; later phases add their own versioned tables.
