---
phase: 3
title: "Endpoint /api/mcp và công cụ bot"
status: pending
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 03: Endpoint `/api/mcp` và công cụ bot

## Goal

GoClaw gọi `POST /api/mcp` (MCP Streamable HTTP, JSON-RPC) bằng Bearer token riêng của từng người, rồi đọc và ghi CRM qua đúng pipeline lệnh mà web dùng.

- Admin: ghi thẳng.
- Người khác: lệnh rủi ro tạo yêu cầu duyệt.

## Files to Create / Modify

- Create: `apps/crm/src/worker/mcp-routes.ts` (route, xác thực Bearer, JSON-RPC)
- Create: `apps/crm/src/worker/mcp-tools.ts` (danh sách công cụ, ánh xạ sang queries/commands)
- Modify: `apps/crm/src/worker/index.ts` (đăng ký `app.route('/mcp', mcpRoutes)` **trước** dòng `app.use('*', originGuard)`)
- Modify: `apps/crm/src/worker/commands.ts` (nhánh đề xuất cho agent; `decideApproval` áp dụng `agent_assign`)
- Modify: `apps/crm/src/web/pages/approvals.tsx`, `apps/crm/src/web/pages/lead-detail.tsx` (hiển thị payload `agent_assign`)
- Read only (mẫu): `poc/goclaw-identity/src/index.ts`, `poc/goclaw-identity/src/mcp-tools.ts`
- Create test: `apps/crm/test/mcp-gateway.test.ts`

## Tasks

### Task 3.1 — Route và xác thực Bearer

- Goal: chỉ request có Bearer hợp lệ mới vào được. Không bao giờ dùng cookie.
- Target: `apps/crm/src/worker/mcp-routes.ts`, `index.ts`.
- Steps:
  1. Tạo `mcpRoutes = new Hono<AppBindings>()`. Middleware chạy theo thứ tự:
     - (a) có header `Origin` → 403 `{error:'browser requests are not allowed'}`;
     - (b) thiếu `Authorization: Bearer <token>` → 401;
     - (c) tính `sha256(token)` (hex, dùng cùng hàm `sha256` như `commands.ts`; export nó nếu cần), tra `SELECT t.id, t.user_id FROM agent_token t WHERE t.token_hash = ? AND t.revoked_at IS NULL`;
     - (d) không có dòng → 401;
     - (e) `loadAgentActor(db, user_id)` trả null (user bị khóa) → 401;
     - (f) cập nhật `last_used_at` qua helper `background(c, promise)`, rồi `c.set('actor', actor)`.
     Tạo helper `background` trong `apps/crm/src/worker/env.ts` (hoặc file nhỏ `background.ts`): `try { c.executionCtx.waitUntil(p) } catch { await p }`. Lý do: test gọi `app.fetch(req, env)` không có ExecutionContext, và getter `c.executionCtx` của Hono ném lỗi khi thiếu. Mọi chỗ cần `waitUntil` trong kế hoạch này đều dùng `background`.
  2. Chỉ nhận `POST /` (GET trả 405), theo PoC `poc/goclaw-identity/src/index.ts`.
  3. Trong `index.ts`, thêm `app.route('/mcp', mcpRoutes)` ngay sau `app.get('/health', …)` và **trước** `app.use('*', originGuard)`.
  4. Không log token hay header Authorization.
- Success criteria: test 3.6 nhóm "auth" xanh.
- Verify: no verification needed (Task 3.6).

### Task 3.2 — Vỏ JSON-RPC

- Goal: trả lời đúng `initialize`, `notifications/initialized`, `tools/list`, `tools/call`.
- Target: `mcp-routes.ts`.
- Steps:
  1. Chép cách xử lý JSON-RPC từ `poc/goclaw-identity/src/index.ts`: không session id; trả `application/json`.
  2. `tools/call` gọi `callTool(c, name, args)` từ `mcp-tools.ts`.
     - Kết quả trả dạng `{content:[{type:'text', text: JSON.stringify(data)}]}`.
     - Lỗi nghiệp vụ trả `isError: true` kèm `code` và `message` tiếng Việt từ `ApiResult`.
  3. Ngoại lệ không lường trước trả lỗi JSON-RPC `-32603` với thông điệp chung, không lộ chi tiết.
- Success criteria: test 3.6 nhóm "protocol" xanh.
- Verify: no verification needed (Task 3.6).

### Task 3.3 — Công cụ đọc

- Goal: bot đọc được dữ liệu theo đúng phạm vi web.
- Target: `mcp-tools.ts`. Gọi lại các hàm trong `queries.ts`; SQL mới duy nhất được phép là tra `code → id` có `leadScope`.
- Công cụ:
  - `whoami` → `{id, displayName, role, team, department}`.
  - `search_leads {q?, status?, stage?}` → `listLeads`, tối đa 20 dòng. Mỗi dòng có `code`, tên khách, công ty, stage, owner, SĐT, email.
  - `get_lead {lead_code}` → tra `id` theo `code` trong phạm vi (`leadScope`), rồi `leadDetail`. Không thấy thì trả `NOT_FOUND` "Không tìm thấy lead trong phạm vi của bạn".
  - `my_tasks {status?}` → `listTasks`.
  - `dashboard_summary` → `dashboard`.
- Mỗi công cụ có `description` tiếng Việt và `inputSchema` JSON Schema.
- Success criteria: test 3.6 nhóm "read" xanh.
- Verify: no verification needed (Task 3.6).

### Task 3.4 — Công cụ ghi và nhánh đề xuất

- Goal: các lệnh ghi đi qua `runCommand`. Với agent không phải Admin, lệnh rủi ro thành yêu cầu duyệt.
- Target: `mcp-tools.ts`, `commands.ts`.
- Steps:
  1. Công cụ ghi và lệnh tương ứng:
     - `create_lead` → `createLead`
     - `log_activity {lead_code, type, summary, occurred_at?}` → `logActivity`
     - `complete_task {task_id, …}` → `completeTask`
     - `change_stage {lead_code, to_stage, lost_reason?, lost_note?, won_value?, won_note?, next_action?}` → `changeStage`
     - `assign_lead {lead_code, owner_email, next_action?}` → `assignLead` (tra `owner_user_id` theo email trong `app_user`)
     - `request_owner_change {lead_code, new_owner_email, reason}` → `requestOwnerChange`

     Đọc schema Zod tương ứng trong `packages/contracts/src/index.ts` để ánh xạ đúng tên trường.
  2. Adapter tra `lead.id` và `lead.version` theo `lead_code` ngay trước khi gọi, rồi điền `leadId`/`expectedVersion`.
  3. Idempotency. `runCommand` băm cả `expectedVersion` (`commands.ts:91`), nên gọi lặp sau khi version đã tăng sẽ bị `IDEMPOTENCY_CONFLICT`. Làm như sau:
     - key1 = `'mcp:' + sha256(toolName + canonicalJson(args))` (khóa sắp xếp). Gọi `runCommand` với key1.
     - Nếu trả `IDEMPOTENCY_CONFLICT`: đọc `created_at, result_json` của `idempotency_key` với `actor_user_id = actor.id AND key = key1`. `created_at` trong vòng 5 phút thì coi là gọi lặp và trả `result_json`. Cũ hơn thì là ý định mới: gọi lại với key2 = `'mcp:' + sha256(toolName + canonicalJson(args) + ':' + version)`.
     - Export `sha256` từ `commands.ts` (hiện chưa export) để dùng chung.
  4. Trong `runCommand`, đặt nhánh đề xuất tại chỗ chọn handler (~dòng 96, `const handler = handlers[name]`), tức **sau** bước idempotency replay để idempotency bao cả đề xuất:

     ```text
     nếu actor.kind === 'agent' && actor.role !== 'admin' && name ∈ {changeStage, assignLead}:
         chạy handler đề xuất thay cho handler thật
     ```

     Handler đề xuất:
     - kiểm `canSeeLead`;
     - kiểm `expectedVersion` khớp lead;
     - giữ ràng buộc "một yêu cầu pending mỗi lead" giống `requestOwnerChange`;
     - kiểm hợp lệ **trước** khi tạo, để đề xuất sai không nằm chờ mãi:
       - changeStage: tách các kiểm tra trong `applyStageChange` (~dòng 169-179: lead active, `allowedTransitions`, luật liên hệ lần đầu, trường bắt buộc của Won/Lost) thành `validateStageChange(lead, input)`, dùng chung cho handler thật và đề xuất;
       - assignLead: kiểm người nhận bằng cùng logic của `applyAssign` (bước 5);
     - insert `approval` với `kind = 'agent_stage_change'` (changeStage) hoặc `'agent_assign'` (assignLead), `target_version = lead.version`, `payload_json` = input đã parse, `requested_by_user_id = actor.id`, `requested_by_kind = 'agent'`, `status='pending'`;
     - ghi audit;
     - trả `{status:'pending_approval', approvalId, kind}`.
  5. Tách thân `assignLead` (~dòng 309-332) thành `applyAssign(db, tx, actor, lead, input)`. Hàm đã tổng quát cho Admin ở phase 01, và xử lý lead hàng chờ có `team_id` null bằng `lead.department_id`. Handler `assignLead` và nhánh `agent_assign` mới trong `decideApproval` cùng gọi `applyAssign`, với người duyệt làm actor, đúng như nhánh `agent_stage_change` hiện có. Mở rộng kiểu `ApprovalRow.kind` (~dòng 42) thêm `'agent_assign'`. Thêm `department_id`, `status` vào tham số `lead` của `mayDecideApproval` (`scope.ts`). Quyền duyệt `agent_assign` = Leader của nhóm (`leaderOnly` trả true cho `agent_assign`). Lead hàng chờ: Leader cùng `department_id` duyệt được. Mở rộng `mayDecideApproval` cho trường hợp này, kèm test.
  6. `requestOwnerChange` qua bot chạy như cũ. `requested_by_kind` đã lấy từ `actor.kind` (phase 02).
  7. Không có công cụ cho `decideApproval` và `releaseLead`.
  8. Kết quả `pending_approval` trả câu cho bot:
     - với stage thường: "Đã tạo yêu cầu. Bạn hoặc Leader xác nhận trên web: <origin>/approvals";
     - với Won/Lost, giao lead, chuyển người phụ trách: "Đã tạo yêu cầu, Leader sẽ được báo qua Lark".

     Không khẳng định "đã báo". `<origin>` lấy từ `new URL(c.req.url).origin`.
- Success criteria: test 3.6 nhóm "write" xanh.
- Verify: no verification needed (Task 3.6).

### Task 3.5 — Hiển thị `agent_assign` trên web

- Target: `approvals.tsx`, `lead-detail.tsx` (chỗ render loại approval).
- Steps:
  1. Thêm nhãn "Bot đề xuất giao lead". Hiện tên người nhận theo `payload.ownerUserId`; API đã trả tên thì dùng, chưa thì thêm vào query `listApprovals`.
  2. Nhãn `agent_stage_change` hiện tên người yêu cầu và chữ "qua bot".
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 3.6 — Test cổng MCP

- Target: tạo `apps/crm/test/mcp-gateway.test.ts`. Tạo token test bằng cách insert hash vào `agent_token` trong `beforeEach`, với token sinh ngẫu nhiên trong test.
- Test cases:
  1. **auth**:
     - không Bearer → 401;
     - cookie phiên Admin hợp lệ mà không Bearer → 401;
     - Bearer hợp lệ kèm header `Origin` → 403;
     - token đã thu hồi → 401;
     - user bị khóa → 401;
     - `GET /api/mcp` → 405.
  2. **protocol**: `initialize` trả `serverInfo`; `tools/list` có đúng 11 công cụ và không có `decide`/`release`.
  3. **read**:
     - Sale gọi `whoami` → đúng tên;
     - Sale gọi `get_lead` cho lead người khác → `NOT_FOUND`;
     - Admin gọi `search_leads` thấy lead mọi nhóm, có SĐT.
  4. **write**:
     - (a) Sale `log_activity` lead của mình → activity `actor_kind='agent'`, `actor_user_id` = Sale;
     - (b1) gọi lại y hệt ngay sau đó → cùng kết quả, số activity không tăng;
     - (b2) sửa `created_at` của dòng `idempotency_key` đó lùi 10 phút rồi gọi lại y hệt → tạo activity thứ hai (ý định mới);
     - (c) Sale `change_stage` sang stage thường → lead không đổi; approval `agent_stage_change` pending; Sale duyệt trên web (`POST /api/commands/decideApproval` bằng session) → lead đổi;
     - (d) Sale `change_stage` sang `won` → approval pending; Sale duyệt bị 403; Leader nhóm duyệt → lead won;
     - (e) Leader `assign_lead` → approval `agent_assign`; Leader duyệt trên web → lead có owner;
     - (f) Admin `change_stage` sang `won` → lead won ngay, audit `actor_kind='agent'` với Admin;
     - (g) Admin `assign_lead` → giao ngay;
     - (h) kill switch bật → Admin `log_activity` trả `KILL_SWITCH_ON`.
  5. `args` có `acting_user` hoặc `user_id` lạ thì bị bỏ qua: người ghi vẫn là chủ token.
- Verify: `pnpm -F @abm/crm test` exit 0, output không chứa `failed`; `pnpm -F @abm/crm typecheck` exit 0; `pnpm -F @abm/crm build` exit 0.
- Commit: `feat(crm): add MCP gateway for chat agents`.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.

Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same failure evidence to the user. Never continue by self-reasoning.

## Rollback

`git revert`. Route mới không có dữ liệu riêng ngoài các bảng của phase 02.
