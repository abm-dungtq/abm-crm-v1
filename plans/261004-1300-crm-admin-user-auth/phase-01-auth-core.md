---
phase: 01
title: "Lõi đăng nhập: schema, mật khẩu, phiên"
status: completed
dependsOn: []
---

# Phase 01 — Lõi đăng nhập

## Goal

Worker xác thực người dùng bằng cookie phiên khi `AUTH_MODE=password`, giữ chế độ demo cho test và local. Có endpoint đăng nhập, đăng xuất, đổi mật khẩu.

## Bối cảnh cần biết

- Shell: dùng PowerShell. Bash tool trên máy này hỏng (exit 127).
- Danh tính hiện tại: `apps/crm/src/worker/actor.ts` (`requireActor`, `loadActor`) chỉ nhận header `X-Demo-User` khi `DEMO_MODE=1`.
- Bảng `app_user` ở `apps/crm/migrations/0001_init.sql`; migration mới nhất là `0002_lead_won_note.sql`.
- Test dùng `@cloudflare/vitest-plugin`: `apps/crm/vitest.config.ts` đọc `wrangler.jsonc`; test gọi `app.fetch(request, { ...env, DEMO_MODE: '1' })`.
- `foldText`, `normalizeEmail` có sẵn ở `packages/contracts/src/index.ts`.

## Files

| Path | Action |
|---|---|
| `apps/crm/migrations/0003_user_auth.sql` | create |
| `apps/crm/src/worker/password.ts` | create |
| `apps/crm/src/worker/session.ts` | create |
| `apps/crm/src/worker/auth-routes.ts` | create |
| `apps/crm/src/worker/actor.ts` | modify |
| `apps/crm/src/worker/guarded-tx.ts` | modify (thêm `'app_user'` vào `GuardedTable`) |
| `apps/crm/src/worker/env.ts` | modify |
| `apps/crm/src/worker/index.ts` | modify |
| `apps/crm/vitest.config.ts` | modify |
| `apps/crm/test/auth-login.test.ts` | create |
| `packages/contracts/src/index.ts` | modify (thêm schema input đăng nhập/đổi mật khẩu, mã lỗi) |

## Tasks

### Task 1.1 — Migration `0003_user_auth.sql`
- Goal: schema có cột mật khẩu, khóa, Lark và bảng phiên.
- Target: `apps/crm/migrations/0003_user_auth.sql`.
- Steps:
  1. `ALTER TABLE app_user ADD COLUMN` lần lượt: `password_hash TEXT`, `password_salt TEXT`, `password_iterations INTEGER`, `must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1))`, `temp_password_expires_at TEXT`, `failed_login_count INTEGER NOT NULL DEFAULT 0`, `locked_until TEXT`, `lark_open_id TEXT`, `lark_link_status TEXT NOT NULL DEFAULT 'unlinked' CHECK (lark_link_status IN ('unlinked','linked','unmatched','error'))`, `lark_checked_at TEXT`.
  2. `CREATE UNIQUE INDEX app_user_lark_open_id ON app_user(lark_open_id) WHERE lark_open_id IS NOT NULL;`
  3. `CREATE TABLE user_session (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_user(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);` và `CREATE INDEX user_session_user ON user_session(user_id);`
  4. Thêm comment một dòng ở đầu file giải thích mục đích.
- Success: migration áp được trên D1 local.
- Verify: `pnpm -F @abm/crm test` exits 0 (migration chạy trong mọi test qua `applyD1Migrations`).

### Task 1.2 — Mã băm mật khẩu `password.ts`
- Goal: hàm băm và so mật khẩu bằng WebCrypto PBKDF2-SHA256.
- Target: `apps/crm/src/worker/password.ts`, exports `PASSWORD_ITERATIONS`, `PASSWORD_MIN_LENGTH`, `hashPassword(password, iterations?)`, `verifyPassword(password, stored)`, `generateTempPassword()`.
- Steps:
  1. `PASSWORD_ITERATIONS = 50_000` (giá trị tạm, phase 05 đo lại; workerd từ chối trên 100 000). `PASSWORD_MIN_LENGTH = 8`.
  2. `hashPassword`: salt 16 byte từ `crypto.getRandomValues`, `crypto.subtle.importKey('raw', ...,'PBKDF2')` + `deriveBits({name:'PBKDF2', hash:'SHA-256', salt, iterations}, key, 256)`. Trả `{ hash, salt, iterations }` dạng base64.
  3. `verifyPassword`: tính lại với salt và số vòng đã lưu, so sánh độ dài bằng nhau và XOR từng byte (không thoát sớm).
  4. `generateTempPassword()`: 12 ký tự ngẫu nhiên từ bảng chữ `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789` dùng `crypto.getRandomValues` (bỏ ký tự dễ nhầm).
- Success: băm cùng mật khẩu hai lần ra hai hash khác nhau; verify đúng trả true, sai trả false.
- Verify: no verification needed (Task 1.6 kiểm qua test đăng nhập).

### Task 1.3 — Phiên đăng nhập `session.ts`
- Goal: tạo, đọc, thu hồi phiên; cookie chỉ chứa token ngẫu nhiên, DB lưu SHA-256 của token.
- Target: `apps/crm/src/worker/session.ts`, exports `SESSION_COOKIE = 'abm_session'`, `SESSION_DAYS = 7`, `createSession(db, userId)`, `readSession(db, token)`, `revokeSession(db, token)`, `revokeUserSessions(db, userId)` (trả statement để đưa vào batch), `sessionCookie(token)`, `clearedSessionCookie()`.
- Steps:
  1. Token: 32 byte ngẫu nhiên, base64url. `id_hash` = hex SHA-256 của token.
  2. `readSession` trả `user_id` chỉ khi `revoked_at IS NULL AND expires_at > now`.
  3. Cookie: `abm_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`. Cookie xóa: `Max-Age=0`.
- Verify: no verification needed (Task 1.6).

### Task 1.4 — Chọn chế độ danh tính trong `actor.ts` và `env.ts`
- Goal: `AUTH_MODE=password` dùng cookie; nếu không, giữ nguyên hành vi demo hiện tại.
- Target: `env.ts` (`Env` thêm `AUTH_MODE?: string`; `AppBindings.Variables` thêm `mustChangePassword: boolean`), `actor.ts` (`requireActor`, `loadActor`).
- Steps:
  1. Trong `requireActor`: nếu `c.env.AUTH_MODE === 'password'` → đọc cookie `abm_session` (dùng `getCookie` từ `hono/cookie`), `readSession`, rồi `loadActor`. Không có hoặc không hợp lệ → 401 `UNAUTHENTICATED` "Phiên đăng nhập đã hết, đăng nhập lại". Header `X-Demo-User` bị bỏ qua hoàn toàn ở chế độ này.
  2. Ở chế độ password, nếu `must_change_password = 1` thì chỉ cho qua đúng ba đường dẫn `GET /api/me`, `POST /api/auth/change-password`, `POST /api/auth/logout` (so với `c.req.path`, có tiền tố `/api`); các route khác trả 403 mã `PASSWORD_CHANGE_REQUIRED`.
  3. Kiểm Origin **không** nằm trong `requireActor`, vì route đăng nhập đứng trước `requireActor`. Trong `index.ts`, ngay sau `app.get('/health', …)`, thêm `app.use('*', originGuard)`: chỉ khi `c.env.AUTH_MODE === 'password'` và method khác GET/HEAD, header `Origin` phải bằng `new URL(c.req.url).origin`; sai hoặc thiếu → 403 `FORBIDDEN`. Viết `originGuard` trong `session.ts` hoặc `auth-routes.ts`.
  4. Nhánh demo giữ nguyên code hiện tại (`DEMO_MODE === '1'`).
  5. `loadActor` đọc thêm `must_change_password`; `Actor` không đổi; đặt `c.set('mustChangePassword', ...)`.
- Verify: no verification needed (Task 1.6).

### Task 1.5 — Endpoint đăng nhập `auth-routes.ts`
- Goal: `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`.
- Target: `apps/crm/src/worker/auth-routes.ts` (Hono sub-app), gắn trong `index.ts` **trước** `app.use('*', requireActor)` cho login; logout và change-password đi sau `requireActor`.
- Steps:
  1. Thêm vào `packages/contracts/src/index.ts`: `loginInput = z.object({ email, password: z.string().min(1).max(200) })`, `changePasswordInput = z.object({ currentPassword, newPassword: z.string().min(8).max(200) })`; thêm mã lỗi `PASSWORD_CHANGE_REQUIRED`, `TEMP_PASSWORD_EXPIRED`, `ACCOUNT_LOCKED` vào mảng `ERROR_CODES` (`packages/contracts/src/index.ts`, khoảng dòng 95). Không cần sửa map `STATUS` trong `index.ts` (chỉ `runCommand` dùng); các route auth tự trả status: 403, 401, 423.
  2. Login: chỉ khi `AUTH_MODE === 'password'`, ngược lại 404. Chuẩn hoá email bằng `normalizeEmail`. Tìm user `status='active'`. Lỗi chung cho email không tồn tại, chưa có mật khẩu hoặc sai mật khẩu: 401 "Email hoặc mật khẩu không đúng".
  3. Nếu `locked_until > now` → 423 `ACCOUNT_LOCKED` "Đăng nhập sai quá nhiều lần, thử lại sau 5 phút".
  4. Sai mật khẩu: `failed_login_count + 1`; khi đạt 10 thì đặt `locked_until = now + 5 phút` và reset bộ đếm về 0.
  5. Đúng mật khẩu nhưng `must_change_password = 1` và `temp_password_expires_at < now` → 401 `TEMP_PASSWORD_EXPIRED` "Mật khẩu tạm đã hết hạn, liên hệ Admin".
  6. Thành công: reset `failed_login_count = 0, locked_until = NULL`, `createSession`, set cookie, trả `{ ok: true, data: { mustChangePassword } }`.
  7. Logout: `revokeSession` + cookie xóa.
  8. Change-password: kiểm `currentPassword`; `newPassword` khác mật khẩu cũ và dài ≥ 8. Ghi bằng `GuardedTx` (`command='changePassword'`): thêm `'app_user'` vào `GuardedTable` trong `guarded-tx.ts`, đọc `version` của user, gọi `tx.update('app_user', id, version, { password_hash, password_salt, password_iterations, must_change_password: 0, temp_password_expires_at: null })` làm anchor; rồi `tx.raw(revokeUserSessions(db, id))`, `tx.raw(<INSERT phiên mới>)`, `tx.audit('app_user', id, null, null)`, `await tx.commit()`. Version lệch → 409 `STALE_VERSION`. Set cookie phiên mới.
  9. Bộ đếm đăng nhập sai và khóa tạm ghi bằng `db.prepare(...).run()` thường, **không** qua `GuardedTx`.
  10. Không bao giờ log hay đưa mật khẩu vào `audit_log`; audit đổi mật khẩu có `before_json` và `after_json` là `null`.
- Verify: no verification needed (Task 1.6).

### Task 1.6 — Cấu hình test và test đăng nhập
- Goal: test cũ vẫn chạy chế độ demo; test mới chạy chế độ password.
- Target: `apps/crm/vitest.config.ts`, `apps/crm/test/auth-login.test.ts`.
- Steps:
  1. Trong `vitest.config.ts`, thêm vào `miniflare.bindings`: `AUTH_MODE: ''` để test mặc định không ở chế độ password, kể cả khi `wrangler.jsonc` sau này đặt `AUTH_MODE`.
  2. Viết `auth-login.test.ts`, seed giống `test/security-api.test.ts` (copy khối `tables`/`beforeEach`, thêm `'user_session'` vào đầu danh sách `tables`). Helper gọi `app.fetch(req, { ...env, AUTH_MODE: 'password' })`, gửi `Origin: http://crm.test` cho request POST, giữ cookie trả về.
  3. Trong `beforeEach` đặt mật khẩu cho `u-lan` bằng `hashPassword` rồi UPDATE trực tiếp.
  4. Test đầu tiên của file: `expect(env.AUTH_MODE).toBe('')`, để thấy ngay nếu binding không ghi đè được `wrangler.jsonc`.
  5. Test bắt buộc, mỗi test một `test(...)`:
     - đăng nhập đúng → 200 + header `Set-Cookie` chứa `abm_session=` và `HttpOnly`; `GET /api/me` với cookie → 200, `data.id === 'u-lan'`.
     - sai mật khẩu → 401; email lạ → 401 cùng message.
     - sai 10 lần → lần 11 với mật khẩu đúng trả 423.
     - header `X-Demo-User: u-bgd` không có cookie ở chế độ password → 401.
     - mật khẩu tạm (`must_change_password=1`, hạn tương lai) → login 200, `GET /api/leads` 403 `PASSWORD_CHANGE_REQUIRED`; đổi mật khẩu → 200; `GET /api/leads` với cookie mới → 200; cookie cũ → 401.
     - mật khẩu tạm hết hạn → 401 `TEMP_PASSWORD_EXPIRED`.
     - logout → cookie cũ trả 401.
     - user `status='disabled'` → login 401.
     - `POST /api/auth/login` không có `Origin` (hoặc Origin khác) ở chế độ password → 403, kể cả khi mật khẩu đúng.
     - Cookie gửi qua header `Cookie: abm_session=<token>` lấy từ `Set-Cookie` của response trước (`app.fetch` không tự giữ cookie).
     - sau tất cả thao tác: `SELECT COUNT(*) FROM audit_log WHERE after_json LIKE '%<mật khẩu dùng trong test>%'` = 0.
- Success: mọi test mới xanh, test cũ không đổi kết quả.
- Verify: `pnpm -F @abm/crm test` exits 0 and output contains `passed` và không chứa `failed`. Rồi `pnpm -F @abm/crm typecheck` exits 0.

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

## Rollback

Xóa file mới, `git checkout` các file đã sửa. Migration chưa áp lên remote ở phase này.
