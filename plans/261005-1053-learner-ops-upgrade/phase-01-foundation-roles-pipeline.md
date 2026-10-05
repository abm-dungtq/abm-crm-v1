---
phase: 1
title: "Nền tảng: vai trò mới, pipeline học viên, sản phẩm, đồng ý, ADR"
status: pending
priority: P1
effort: "2d"
dependencies: []
---

# Phase 01: Nền tảng

## Goal

Schema và hợp đồng dùng chung (`@abm/contracts`) hiểu được ba vai trò mới, pipeline `learner` cùng các stage của nó, sở hữu khách theo thời hạn giữ, danh mục sản phẩm, sản phẩm gắn trên khách và đồng ý theo mục đích. Luồng B2B chạy y như trước.

Mọi lệnh đều chạy từ `D:\TQD\CRM`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0006_learner_foundation.sql`
- Create: `apps/crm/test/helpers/reset-db.ts`
- Modify: 5 file test đang có hằng `TABLES`. Tìm bằng `Select-String -Path apps/crm/test/*.ts -Pattern "const TABLES"`.
- Modify: `packages/contracts/src/index.ts` (`ROLES`, stage, nguồn, lý do mất của luồng học viên, `LEARNER_JOURNEY`, `CONSENT_PURPOSES`, schema lệnh mới, `COMMANDS`)
- Modify: `apps/crm/src/worker/scope.ts` (`leadScope` cho vai trò mới; thêm `customerScope`)
- Modify: `apps/crm/src/worker/roster.ts` (`ROLE_ALIASES`, `placementError`)
- Modify: `apps/crm/src/worker/commands.ts` (handler `upsertProduct`, `recordConsent`)
- Modify: `apps/crm/src/worker/queries.ts` (`listProducts`)
- Modify: `apps/crm/src/worker/index.ts` (route `GET /products`)
- Modify: `apps/crm/src/web/components/layout.tsx` (`SCOPE_LABEL` cho vai trò mới; ẩn mục điều hướng B2B với vai trò mới)
- Create: `apps/crm/test/learner-foundation.test.ts`
- Create: `docs/adr/adr-007-learner-pipeline-and-fees.md`
- Modify: `docs/security/permission-matrix-v1.md` (thêm mục "Luồng học viên")

## Tasks

### Task 1.1: Gom phần reset DB của test vào một chỗ

- Goal: thêm bảng mới chỉ cần sửa một danh sách.
- Target: `apps/crm/test/helpers/reset-db.ts`, cùng 5 file test có `const TABLES`.
- Steps:
  1. Tạo `reset-db.ts`, export `TABLES` theo thứ tự xóa an toàn với khóa ngoại: bảng con trước, bảng cha sau. Lấy danh sách dài nhất trong 5 file làm gốc.
  2. Export hàm `resetDb(db, seedSql)` làm đúng ba việc mà `beforeEach` trong `commands.test.ts` (dòng 21-24) đang làm: áp migrations, xóa các bảng, chèn seed.
  3. Trong 5 file, thay danh sách `TABLES` và thân `beforeEach` bằng lời gọi `resetDb`. Giữ phần chèn dữ liệu riêng của từng file, nếu có.
- Success criteria: không còn file test nào tự khai báo `const TABLES`.
- Verify: chạy `pnpm -F @abm/crm test`, phải exit 0. Chạy `Select-String -Path apps/crm/test/*.test.ts -Pattern "const TABLES"`, phải không ra dòng nào.

### Task 1.2: Migration 0006

- Goal: có schema mới, dữ liệu cũ giữ nguyên.
- Target: `apps/crm/migrations/0006_learner_foundation.sql`.
- Steps:
  1. Dòng đầu: `PRAGMA defer_foreign_keys = ON;`
  2. **Dựng lại `app_user`** để đổi CHECK `role` thành `('sale','leader','head','director','admin','academic','teacher','accountant')`.
     - Lấy nguyên định nghĩa cột từ `0001_init.sql` (dòng 35-48), cộng thêm các cột đã `ALTER` trong `0003_user_auth.sql` (dòng 2-12, gồm cả các CHECK).
     - Trình tự: `CREATE TABLE app_user_new (...)`, rồi `INSERT INTO app_user_new SELECT * FROM app_user`, rồi `DROP TABLE app_user`, rồi `ALTER TABLE app_user_new RENAME TO app_user`.
     - Tạo lại mọi index của `app_user`. Tìm `ON app_user(` trong **mọi** file migration: có `app_user_lark_open_id` (UNIQUE, có `WHERE`, ở 0003) và index `organization_id` ở 0005.
     - Thứ tự cột của `app_user_new` phải đúng thứ tự cột của bảng thật hiện tại. Kiểm bằng `PRAGMA table_info(app_user)` trên D1 cục bộ sau khi chạy `pnpm -F @abm/crm db:migrate:local`.
  3. **Dựng lại `lead`** theo cùng cách. Định nghĩa gốc ở `0001_init.sql` (dòng 97-133), cộng cột `won_note` từ `0002`. Thêm:
     - cột `pipeline TEXT NOT NULL DEFAULT 'b2b' CHECK (pipeline IN ('b2b','learner'))`;
     - cột `partner_contract_id TEXT` (khóa ngoại thêm ở phase 02 qua kiểm tra trong lệnh, không dùng FK);
     - cột `lost_note` giữ như cũ;
     - CHECK `stage` mở rộng thêm `'trial_booked','trial_done','not_fit'`;
     - CHECK mới `(stage <> 'not_fit' OR lost_reason IS NOT NULL)`;
     - CHECK mới `(pipeline <> 'learner' OR status <> 'queue')`.
     - Tạo lại mọi index `ON lead(` có trong 0001 và 0005.
     - Cột mới đặt ở **cuối** bảng, để `INSERT ... SELECT *` không chạy được. Phải ghi rõ danh sách cột: `INSERT INTO lead_new (<các cột cũ>) SELECT <các cột cũ> FROM lead`.
  4. Thêm cột cho `contact`: `owner_user_id TEXT REFERENCES app_user(id)`, `hold_started_at TEXT`, `hold_expires_at TEXT`, `archived_at TEXT`. Thêm index `contact_owner ON contact(owner_user_id)`.
  5. `CREATE TABLE product`: `id`, `organization_id`, `name TEXT NOT NULL`, `description TEXT`, `price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0)`, `active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))`, `created_at`, `updated_at`, `version`, `last_txn_id`.
  6. `CREATE TABLE customer_product`:
     - cột: `id`, `contact_id` (FK contact), `product_id` (FK product), `attached_by_user_id`, `attached_at TEXT NOT NULL`, `detached_at TEXT`, `version`, `last_txn_id`, `created_at`, `updated_at`;
     - unique index một phần: `(contact_id, product_id) WHERE detached_at IS NULL`.
  7. `CREATE TABLE consent`:
     - cột: `id`, `contact_id` (FK contact), `purpose TEXT NOT NULL CHECK (purpose IN ('enrollment','fee','attendance','marketing','image'))`, `granted INTEGER NOT NULL CHECK (granted IN (0,1))`, `note TEXT`, `recorded_by_user_id`, `recorded_at TEXT NOT NULL`;
     - đây là bảng chỉ ghi thêm. Trạng thái hiện tại là dòng mới nhất của mỗi cặp (`contact_id`, `purpose`);
     - index `(contact_id, purpose, recorded_at)`.
  8. Thêm `product`, `customer_product`, `consent` vào `TABLES` trong `reset-db.ts`, đặt **trước** `contact` và `app_user`.
- Success criteria: migration chạy được trên D1 cục bộ và trong Vitest. Lead và user trong seed vẫn còn đủ.
- Verify:
  - `pnpm -F @abm/crm db:migrate:local` exit 0.
  - `pnpm -F @abm/crm test` exit 0.

### Task 1.3: Hợp đồng dùng chung (`@abm/contracts`)

- Goal: web và worker dùng chung một nguồn hằng số.
- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Thêm 3 phần tử vào `ROLES`:
     - `{ code: 'academic', label: 'Học vụ', scope: 'organization' }`
     - `{ code: 'teacher', label: 'Giáo viên', scope: 'class' }`
     - `{ code: 'accountant', label: 'Kế toán', scope: 'organization' }`
  2. Thêm `PIPELINES = ['b2b','learner'] as const` và type `PipelineCode`.
  3. Thêm `LEARNER_STAGES`, mỗi phần tử là `{code,label}`, theo thứ tự PRD §3:
     - `new` Mới
     - `contacted` Đang liên hệ
     - `qualified` Đủ điều kiện
     - `trial_booked` Đã hẹn học thử
     - `trial_done` Đã học thử
     - `won` Thắng
     - `lost` Mất
     - `not_fit` Không phù hợp

     Sửa `stageLabel(code, pipeline = 'b2b')` để tra theo đúng bảng của pipeline. Các chỗ gọi cũ không truyền `pipeline` vẫn chạy như trước.
  4. Thêm `LEARNER_LOST_REASONS`: `price` Giá, `schedule` Lịch, `competitor` Đối thủ, `no_response` Không phản hồi, `not_fit` Không hợp, `other` Khác. Chọn `other` thì bắt buộc có ghi chú.
  5. Thêm `LEARNER_JOURNEY` theo PRD §4, mỗi phần tử có `{ code, label, required, by }`, trong đó `by` là `'auto' | 'admissions'`:
     - `recorded` Ghi nhận, bắt buộc, `auto`
     - `contacted` Liên hệ, bắt buộc, `admissions`
     - `need_confirmed` Xác nhận nhu cầu, bắt buộc, `admissions`
     - `trial` Học thử, không bắt buộc, `auto` (có thể bỏ qua kèm lý do)
     - `enrolled` Chốt ghi danh, bắt buộc, `auto`
     - `placed` Chia lớp, bắt buộc, `auto`
     - `tuition_paid` Thu học phí khóa, bắt buộc, `auto`
     - `started` Vào học, không bắt buộc, `auto`

     Thêm `LEARNER_JOURNEY_VERSION = 1`.
  6. Thêm `CONSENT_PURPOSES`: `enrollment` Quản lý ghi danh, `fee` Thu học phí, `attendance` Điểm danh, `marketing` Liên hệ marketing, `image` Dùng hình ảnh. Mỗi phần tử có `defaultOn: false`.
  7. Thêm schema zod:
     - `upsertProductInput`: `{ id?, version?, name (1-160 ký tự), description? (≤2000), priceVnd (số nguyên ≥ 0, ≤ MAX_DEAL_VALUE), active (boolean) }`
     - `recordConsentInput`: `{ contactId, purpose (enum), granted (boolean), note? }`
  8. Thêm vào `COMMANDS`:
     - `upsertProduct`: roles `['academic','admin']`, riskLevel `low`, `expectedVersion: false`, `agentNeedsApproval: false`
     - `recordConsent`: roles `['sale','leader','admin']`, riskLevel `low`, `expectedVersion: false`, `agentNeedsApproval: false`
- Success criteria: typecheck xanh.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 1.4: Phạm vi đọc và nhập danh sách nhân sự

- Goal: vai trò mới không đọc được lead B2B. Roster nhập được vai trò mới.
- Target: `apps/crm/src/worker/scope.ts` (`leadScope`), `apps/crm/src/worker/roster.ts` (`ROLE_ALIASES`, `placementError`).
- Steps:
  1. Trong `leadScope`, `academic`, `teacher`, `accountant` rơi vào nhánh `default` (`0 = 1`). Thêm comment một dòng: các màn hình riêng của những vai trò này dùng truy vấn riêng.
  2. Thêm `customerScope(actor, alias = 'c')`, trả về `SqlFragment` lọc khách trên `contact`:
     - `sale`: `c.owner_user_id = ?`
     - `leader`: `c.owner_user_id IN (SELECT id FROM app_user WHERE team_id = ?)`
     - `admin` và `director`: `c.organization_id = ?`
     - các vai trò khác: `0 = 1`
  3. Thêm vào `ROLE_ALIASES`:
     - `hoc vu`, `academic` → `academic`
     - `giao vien`, `teacher` → `teacher`
     - `ke toan`, `accountant` → `accountant`
  4. `placementError`: ba vai trò mới được đối xử giống `director`/`admin`, tức là không có phòng ban và không có nhóm.
- Success criteria: test ở Task 1.7 xanh.
- Verify: no verification needed (Task 1.7).

### Task 1.5: Lệnh sản phẩm và đồng ý

- Goal: Học vụ hoặc Admin sửa được danh mục sản phẩm. Tuyển sinh ghi được đồng ý.
- Target: `apps/crm/src/worker/commands.ts` (thêm handler vào map `handlers`), `apps/crm/src/worker/queries.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. Handler `upsertProduct`:
     - không có `id` thì `tx.insertVersioned('product', …)`;
     - có `id` thì `tx.update('product', id, version, …)`;
     - luôn gọi `tx.audit('product', …)`.
  2. Handler `recordConsent`:
     - kiểm khách thuộc `customerScope` của actor; Admin luôn qua;
     - không thuộc thì `fail('FORBIDDEN', …)`;
     - chèn một dòng `consent` bằng `tx.insertDependent` hoặc lệnh insert thường của GuardedTx, theo mẫu của bảng `activity`;
     - ghi audit.
  3. `listProducts(db, actor)`:
     - trả `id`, `name`, `description`, `priceVnd`, `active`, `version`;
     - `sale` và `leader` chỉ thấy sản phẩm `active = 1`;
     - `teacher` nhận `FORBIDDEN`.
  4. Trong `index.ts`, thêm `GET /products`, gắn sau middleware `requireActor` giống các route `GET` khác.
- Success criteria: test ở Task 1.7 xanh.
- Verify: no verification needed (Task 1.7).

### Task 1.6: Web chấp nhận vai trò mới

- Goal: đăng nhập bằng vai trò mới không bị lỗi màn hình và không thấy menu B2B.
- Target: `apps/crm/src/web/components/layout.tsx` (mảng nav dòng 33-42, `SCOPE_LABEL`).
- Steps:
  1. Thêm nhãn `SCOPE_LABEL` cho `academic`, `teacher`, `accountant`.
  2. Gắn `roles: ['sale','leader','head','director','admin']` cho các mục nav B2B đang không có `roles`: Tổng quan, Pipeline, Lead, Khách hàng 360, Việc, Hàng chờ duyệt.
  3. Chạy typecheck. Sửa mọi chỗ `Record<RoleCode, …>` bị báo thiếu khóa.
- Success criteria: typecheck và build xanh.
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 1.7: Test nền tảng

- Goal: có test cho các bất biến của phase này.
- Target: `apps/crm/test/learner-foundation.test.ts` (dùng `resetDb`; mẫu gọi API lấy theo `commands.test.ts`).
- Steps: viết các test sau.
  1. Seed có thể chèn một user `academic`, một `teacher`, một `accountant` mà không lỗi CHECK.
  2. `GET /leads` với vai trò `academic` trả về danh sách rỗng.
  3. `upsertProduct`: `academic` thì OK, `sale` thì `FORBIDDEN`.
  4. `GET /products` với `sale` không thấy sản phẩm đã tắt. `teacher` nhận 403.
  5. `recordConsent`: ghi `granted: true` cho `marketing`, rồi đọc dòng mới nhất, phải là `granted = 1`.
  6. Lead B2B cũ trong seed có `pipeline = 'b2b'`.
  7. Roster preview với vai trò `Kế toán` và không có phòng ban thì hợp lệ.
- Success criteria: tất cả test xanh.
- Verify: `pnpm -F @abm/crm test -- learner-foundation` exit 0, output có `learner-foundation.test.ts`, không có `failed`. Sau đó chạy `pnpm -F @abm/crm test`, phải exit 0.

### Task 1.8: ADR và ma trận quyền

- Goal: các quyết định mới được ghi lại có nguồn.
- Target: `docs/adr/adr-007-learner-pipeline-and-fees.md`, `docs/security/permission-matrix-v1.md`.
- Steps:
  1. ADR-007 theo mẫu ADR-006 (đọc file đó để lấy cấu trúc). Nội dung:
     - pipeline `learner` chạy song song;
     - ba vai trò mới;
     - giữ khách 3 tháng;
     - học phí ghi trong CRM, thay QĐ8 cho luồng học viên; MISA chỉ còn dùng để xuất hóa đơn;
     - link tới PRD và báo cáo brainstorm.
  2. `permission-matrix-v1.md`: thêm mục `## Luồng học viên`, là bảng vai trò × thao tác lấy từ PRD §1-§11 cùng phần "Mặc định thiết kế" trong `plan.md`. Không sửa các hàng B2B đang có.
- Success criteria: các link trong ADR mở được.
- Verify: `Test-Path docs/adr/adr-007-learner-pipeline-and-fees.md` trả `True`.

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

- **Dựng lại bảng có thể làm mất dữ liệu nếu thứ tự cột sai.** Task 1.2 bắt kiểm bằng `PRAGMA table_info`. Trên eval chỉ chạy migration ở phase 07, sau khi đã sao lưu.
- **Rollback:** revert commit. Migration chưa được áp lên eval cho tới phase 07.
