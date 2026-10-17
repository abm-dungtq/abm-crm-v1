---
phase: 1
title: "Schema, shared package, contracts"
status: completed
priority: P1
effort: "1d"
dependencies: []
---

# Phase 01: Schema, shared package, contracts

## Goal
Add migration `0024_lms.sql`, a shared workspace package `@abm/lms-core` (password hashing moved from CRM + access rules), and the zod input schemas / `COMMANDS` entries for every LMS command, with all existing tests still green.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below.
- Work from `D:\TQD\CRM`. Shell is PowerShell; `pnpm` is on PATH.

## Files to Create / Modify
- Create: `apps/crm/migrations/0024_lms.sql`
- Create: `packages/lms-core/package.json`, `packages/lms-core/tsconfig.json`, `packages/lms-core/src/index.ts`, `packages/lms-core/src/password.ts`, `packages/lms-core/src/access.ts`, `packages/lms-core/src/access.test.ts`
- Modify: `apps/crm/src/worker/password.ts` (becomes a re-export)
- Modify: `apps/crm/package.json` (add dependency `"@abm/lms-core": "workspace:*"`)
- Modify: `apps/crm/src/worker/guarded-tx.ts` (`GuardedTable` union)
- Modify: `apps/crm/test/helpers/reset-db.ts` (`TABLES` list)
- Modify: `packages/contracts/src/index.ts` (schemas + `COMMANDS` entries)
- Create: `apps/crm/test/lms-schema.test.ts`

## Tasks

### Task 1.1 — Write migration 0024
- Goal: the D1 schema holds every LMS table.
- Target: `apps/crm/migrations/0024_lms.sql` (new).
- Steps: create the file with exactly this content:

```sql
-- Learner LMS: learner accounts and sessions, one online program per class, lessons, Stream videos,
-- manual access grants/blocks and lesson progress. The abm-lms Worker shares this database but never
-- runs migrations; this directory owns the schema.

-- One hashed default password per organization. A learner_account with password_hash NULL signs in with it.
ALTER TABLE org_setting ADD COLUMN learner_default_password_hash TEXT;
ALTER TABLE org_setting ADD COLUMN learner_default_password_salt TEXT;
ALTER TABLE org_setting ADD COLUMN learner_default_password_iterations INTEGER;

CREATE TABLE learner_account (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  contact_id TEXT NOT NULL UNIQUE REFERENCES contact(id),
  -- Lower-cased, trimmed; the sign-in key.
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  CHECK ((password_hash IS NULL) = (password_salt IS NULL))
);
CREATE INDEX learner_account_org ON learner_account(organization_id);

-- The cookie carries a random token; only its SHA-256 is stored.
CREATE TABLE learner_session (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_account(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX learner_session_account ON learner_session(account_id);

CREATE TABLE lms_program (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  -- One program per class; NULL while published ahead of its class.
  class_id TEXT UNIQUE REFERENCES class_group(id),
  title TEXT NOT NULL,
  -- R2 key of the current handbook HTML in the abm-lms-content bucket; NULL until first publish.
  content_key TEXT,
  content_version INTEGER NOT NULL DEFAULT 0,
  review_days INTEGER CHECK (review_days IS NULL OR review_days >= 0),
  cloned_from_program_id TEXT REFERENCES lms_program(id),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX lms_program_org ON lms_program(organization_id);

CREATE TABLE lms_lesson (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES lms_program(id),
  -- The handbook's <section id>, e.g. b1p1.
  section_id TEXT NOT NULL,
  title TEXT NOT NULL,
  group_title TEXT,
  position INTEGER NOT NULL,
  -- Set when a later publish no longer contains this section; its videos are kept.
  hidden_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  UNIQUE (program_id, section_id)
);

CREATE TABLE lms_lesson_video (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lms_lesson(id),
  title TEXT NOT NULL,
  stream_uid TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX lms_lesson_video_lesson ON lms_lesson_video(lesson_id, position);

-- Manual exceptions on top of enrollment-derived access. A live block hides the program even from enrolled learners.
CREATE TABLE lms_access (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  program_id TEXT NOT NULL REFERENCES lms_program(id),
  mode TEXT NOT NULL CHECK (mode IN ('grant', 'block')),
  expires_at TEXT,
  note TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX lms_access_contact ON lms_access(contact_id, program_id);
CREATE INDEX lms_access_program ON lms_access(program_id);

CREATE TABLE lms_progress (
  account_id TEXT NOT NULL REFERENCES learner_account(id),
  lesson_id TEXT NOT NULL REFERENCES lms_lesson(id),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, lesson_id)
);
```
- Success criteria: file exists with the content above.
- Verify: no verification needed (Task 1.6 applies it in tests).

### Task 1.2 — Create package `@abm/lms-core` with the password module
- Goal: password hashing lives in one shared package used by both Workers.
- Target files: `packages/lms-core/*` (new), `apps/crm/src/worker/password.ts`, `apps/crm/package.json`.
- Steps:
  1. Read `packages/contracts/package.json` and `packages/contracts/tsconfig.json`; create `packages/lms-core/package.json` and `packages/lms-core/tsconfig.json` copying the same shape, but set `compilerOptions.lib` to `["ES2022", "DOM"]` and keep `"types": []` (the password and signing code use `crypto.subtle`, `atob`/`btoa`, `TextEncoder`) (name `@abm/lms-core`, `"type": "module"`, same `exports`/`main` style pointing at `src/index.ts`, same `typecheck` script). Add a `"test": "vitest run"` script and devDependency `"vitest": "4.1.11"` (same version as `apps/crm/package.json`).
  2. Move the whole body of `apps/crm/src/worker/password.ts` into `packages/lms-core/src/password.ts` unchanged (keep `PASSWORD_ITERATIONS = 50_000`, `TEMP_PASSWORD_ITERATIONS`, `TEMP_PASSWORD_HOURS`, `hashPassword`, `verifyPassword`, `generateTempPassword`, `StoredPassword`, and the comments).
  3. Replace `apps/crm/src/worker/password.ts` with one line: `export * from '@abm/lms-core/password';` — if the package `exports` map cannot express the subpath, export everything from `packages/lms-core/src/index.ts` and use `export * from '@abm/lms-core';` instead.
  4. `packages/lms-core/src/index.ts`: `export * from './password';` and `export * from './access';`.
  5. Add `"@abm/lms-core": "workspace:*"` to `dependencies` in `apps/crm/package.json`, then run `pnpm install` at `D:\TQD\CRM`.
- Success criteria: CRM compiles against the moved module with no other import changes.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.3 — Access rules as a pure function
- Goal: one tested function decides whether a learner may open a program; both Workers call it.
- Target: `packages/lms-core/src/access.ts`, `packages/lms-core/src/access.test.ts`.
- Steps:
  1. Write `access.ts` exporting:
```ts
export const ACCESS_ENROLLMENT_STATUSES = ['confirmed', 'studying', 'completed'] as const;

export interface AccessFacts {
  programId: string;
  /** True when the contact has an enrollment in ACCESS_ENROLLMENT_STATUSES for the program's class. */
  enrolled: boolean;
  /** Latest starts_at of a non-cancelled class_session of the program's class (ISO), or null. */
  lastSessionAt: string | null;
  reviewDays: number | null;
  /** Live (revoked_at IS NULL) lms_access rows for this contact and program. */
  manual: { mode: 'grant' | 'block'; expiresAt: string | null }[];
}

export type AccessState = { state: 'open'; until: string | null } | { state: 'expired'; endedAt: string } | { state: 'none' };

/** Enrollment ∪ live grant, minus live block. Review window = last session + reviewDays days. */
export function resolveAccess(f: AccessFacts, nowIso: string): AccessState
```
  2. Rules, in this order:
     - any `manual` row with `mode === 'block'` and (`expiresAt === null` or `expiresAt > nowIso`) → `{ state: 'none' }`.
     - a `grant` with (`expiresAt === null` or `expiresAt > nowIso`) → `{ state: 'open', until: expiresAt }`.
     - if `enrolled`: when `reviewDays === null` or `lastSessionAt === null` → `{ state: 'open', until: null }`; else `end = lastSessionAt + reviewDays*86400000 ms` (ISO); `nowIso < end` → `{ state: 'open', until: end }`, otherwise `{ state: 'expired', endedAt: end }`.
     - otherwise `{ state: 'none' }`.
  3. Write `access.test.ts` (vitest, plain node) covering: block beats enrollment; grant opens without enrollment; expired grant ignored; enrolled with null reviewDays open; enrolled within window open with `until`; enrolled after window → expired; expired enrollment + live grant → open.
- Success criteria: 7 cases pass.
- Verify: `pnpm --filter @abm/lms-core test` exits 0 and prints `7 passed`.

### Task 1.4 — Register new guarded tables and test reset list
- Goal: commands can write the new tables and tests start clean.
- Target: `apps/crm/src/worker/guarded-tx.ts` (type `GuardedTable`), `apps/crm/test/helpers/reset-db.ts` (`TABLES`).
- Steps:
  1. Add `'learner_account' | 'lms_program' | 'lms_lesson' | 'lms_lesson_video' | 'lms_access'` to `GuardedTable`.
  2. Add `'lms_progress', 'learner_session', 'lms_lesson_video', 'lms_access', 'lms_lesson', 'lms_program', 'learner_account'` to `TABLES` in `reset-db.ts`, placed **before** the tables they reference (`contact`, `class_group`, `organization`, `app_user`) so deletes respect foreign keys — read the existing order first and keep its child-before-parent convention.
- Success criteria: typecheck passes.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.5 — Contracts: input schemas and COMMANDS entries
- Goal: every LMS command is declared once in `packages/contracts/src/index.ts`.
- Target: `packages/contracts/src/index.ts` — near `importContractLearnersInput` (around line 461) for schemas, and the `COMMANDS` map (around lines 660–711).
- Steps:
  1. Read how `transferEnrollmentInput` (around line 540) and its `COMMANDS` entry (around line 696) are written; copy that style.
  2. Add these schemas (zod v4, same helpers as neighbours; `id` = the existing id schema used by neighbours; `version` = positive int):
     - `setLearnerDefaultPasswordInput = { password: string min 8 max 128 }`
     - `createLearnerAccountInput = { contactId: id, email?: email max 160 }`
     - `createClassLearnerAccountsInput = { classId: id }`
     - `resetLearnerPasswordInput = { accountId: id, version }`
     - `setLearnerAccountStatusInput = { accountId: id, version, status: 'active'|'disabled' }`
     - `grantProgramAccessInput = { contactId: id, programId: id, mode: 'grant'|'block', expiresAt: isoDate.optional() (existing helper, contracts ~line 260), note?: string max 500 }`
     - `revokeProgramAccessInput = { accessId: id, version }`
     - `updateLmsProgramInput = { programId: id, version, title?: string 1..200, reviewDays: int 0..3650 | null }`
     - `addLessonVideoInput = { lessonId: id, title: string 1..200, streamUid?: string regex /^[a-f0-9]{32}$/, sourceUrl?: https URL max 2000 }` with a refine: exactly one of `streamUid`/`sourceUrl`.
     - `updateLessonVideoInput = { videoId: id, version, title?: string 1..200, position?: int 0..999 }`
     - `deleteLessonVideoInput = { videoId: id, version }`
     - `cloneLmsProgramInput = { fromClassId: id, toClassId: id }`
  3. Extend `importContractLearnersInput` with optional `classId: id` (keep all existing fields unchanged).
  4. Do NOT add `COMMANDS` entries here. `apps/crm/src/worker/commands.ts:64` types `handlers` as `{ [K in CommandName]: Handler<...> }`, so every `COMMANDS` key needs its handler in the same change; phases 02 and 03 add each entry together with its handler. The role lists to use there:
     - `setLearnerDefaultPassword` → `['admin']`
     - `createLearnerAccount`, `createClassLearnerAccounts`, `resetLearnerPassword`, `setLearnerAccountStatus`, `grantProgramAccess`, `revokeProgramAccess`, `updateLmsProgram`, `cloneLmsProgram` → `['academic', 'admin']`
     - `addLessonVideo`, `updateLessonVideo`, `deleteLessonVideo` → `['academic', 'admin', 'teacher']` (teacher limited to own class in the handler)
     - `riskLevel`, `idempotent`, `agentNeedsApproval` copied from `transferEnrollment`; `expectedVersion: true` when the input has `version`, else `false`.
  5. Export the inferred input types (`export type XInput = z.infer<typeof xInput>`) like neighbours. Use the existing `id` (line 258) and `version` (line 259) helpers.
- Success criteria: schemas exported; nothing else changes behaviour.
- Verify: `pnpm -r typecheck` exits 0.

### Task 1.6 — Schema test
- Goal: the migration applies and the key constraints hold.
- Target: `apps/crm/test/lms-schema.test.ts` (new). Copy setup from `apps/crm/test/inbox-schema.test.ts` (uses `resetDb`).
- Steps: write tests that
  1. insert a `learner_account` with `password_hash` NULL and `password_salt` NULL → succeeds;
  2. insert one with hash set and salt NULL → throws (CHECK);
  3. two `lms_program` rows with the same non-null `class_id` → second throws; two with NULL `class_id` → both succeed;
  4. two `lms_lesson` rows with same `(program_id, section_id)` → second throws;
  5. `SELECT learner_default_password_hash FROM org_setting LIMIT 1` runs without error.
  `seed/demo.sql` has no course/class rows: create them with the helpers in `apps/crm/test/helpers/learner-fixtures.ts` (read it first); `org_setting` rows come from `seed/demo.sql` (~line 259), which `resetDb` reloads.
- Verify: from `D:\TQD\CRM\apps\crm` run `pnpm test test/lms-schema.test.ts` → exits 0, output contains `passed` and no `failed`.

### Task 1.7 — Full regression
- Verify: `pnpm -r typecheck` exits 0 AND `pnpm -r test` exits 0 (CRM suite was 566 tests before this plan; the count must not drop).
- Write report `plans/reports/agy-261016-phase-01-lms-schema.md` listing files changed, test counts; last line `Status: DONE` (or BLOCKED with reason).

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
