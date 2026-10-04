---
phase: 1
title: API overview + KPI + kanban + chờ duyệt + bot/Lark
status: pending
---

# Phase 01 — API `/api/overview`, KPI, kanban, chờ duyệt, bot/Lark

## Goal

Admin và Giám đốc mở trang `/overview` và thấy ba phần:

- dải KPI toàn công ty;
- kanban gồm Hàng chờ, 7 stage đang mở, Won và Lost trong kỳ;
- khung yêu cầu chờ duyệt và khung sức khỏe bot/Lark.

Mọi vai trò khác nhận 403.

## Files

| Hành động | File |
|---|---|
| Tạo | `apps/crm/src/worker/overview.ts` |
| Sửa | `apps/crm/src/worker/queries.ts`: export `needsAttention` |
| Sửa | `apps/crm/src/worker/index.ts`: route `GET /overview` |
| Tạo | `apps/crm/test/overview.test.ts` |
| Sửa | `apps/crm/src/web/types.ts`: type `Overview` |
| Tạo | `apps/crm/src/web/pages/overview.tsx` |
| Sửa | `apps/crm/src/web/router.tsx`: route `/overview` |
| Sửa | `apps/crm/src/web/components/layout.tsx`: mục nav |
| Sửa | `apps/crm/src/web/styles.css`: chỉ thêm class mới |

## Contract của response (phase 01)

```ts
// GET /api/overview?period=month|quarter|year&department=<department id>
{
  period: { key: 'month' | 'quarter' | 'year'; start: string /* YYYY-MM-DD, Saigon */ };
  departments: { id: string; name: string }[];          // mọi phòng ban của tổ chức, xếp theo tên
  departmentId: string | null;                          // bộ lọc đang áp dụng
  truncated: { shown: number; total: number } | null;   // khác null khi số lead bị cắt ở giới hạn 2000
  kpi: {
    openLeads: number; pipelineValue: number; queueLeads: number;
    wonCount: number; wonValue: number; lostCount: number; lostValue: number;
    winRate: number | null;                             // won / (won + lost) trong kỳ, null nếu cả hai bằng 0
    overdueTasks: number; slaBreaches: number; pendingApprovals: number; agentActionsToday: number;
  };
  columns: {
    key: 'queue' | StageCode;                           // 'queue', 7 ACTIVE_STAGES, 'won', 'lost'
    count: number; value: number; atRisk: number;
    leads: OverviewCard[];                              // tối đa 8, lead rủi ro lên trước, sau đó theo updated_at mới nhất
  }[];
  approvals: {
    byKind: { kind: string; count: number }[];
    oldest: { id: string; kind: string; toStage: string | null; leadId: string; leadCode: string;
              requester: string | null; requestedByKind: 'human' | 'agent'; createdAt: string }[]; // pending, cũ nhất trước, tối đa 10
  };
  bot: { agentWritesOpen: boolean; activeTokens: number; agentWrites7d: number; outbox: { status: string; count: number }[] };
}
type OverviewCard = { id: string; code: string; title: string /* tên account, nếu không có thì tên contact */; ownerName: string | null;
  value: number | null; risk: boolean; nextActionDueAt: string | null; closedAt: string | null };
```

Định nghĩa:

- `openLeads`: lead có `status='active'`.
- `queueLeads`: lead có `status='queue'`.
- Won/Lost: `status` tương ứng và `closed_at >= periodStartUtc`.
- `periodStartUtc = new Date(`${start}T00:00:00+07:00`).toISOString()`.
- `start` lấy theo `vnDate(now)`:
  - month: `YYYY-MM-01`;
  - quarter: tháng đầu quý, `YYYY-{01|04|07|10}-01`;
  - year: `YYYY-01-01`.
- `slaBreaches`: số lead active thỏa `needsAttention`.
- `overdueTasks`: task `status='open'` và `due_at < now`, đếm trong phạm vi lead.
- `agentActionsToday`: số dòng `audit_log` có `actor_kind='agent'` và `created_at >= todayStartUtc`. Ba số của bot (`agentActionsToday`, `agentWrites7d`, `activeTokens`) và `outbox` luôn tính cho toàn hệ thống, bỏ qua bộ lọc phòng ban.
- `agentWritesOpen`: `COALESCE((SELECT MAX(enabled) FROM agent_kill_switch), 0) = 1`.
- `activeTokens`: số `agent_token` có `revoked_at IS NULL`.
- `agentWrites7d`: số `audit_log` có `actor_kind='agent'` trong 7 ngày gần nhất.
- `outbox`: `SELECT status, COUNT(*) FROM outbox GROUP BY status`.

## Tasks

### Task 1.1 — Export `needsAttention` để dùng chung

- Goal: `dashboard()` và overview dùng chung một định nghĩa "lead có rủi ro".
- Target: `apps/crm/src/worker/queries.ts`. Dời hàm nội bộ `needsAttention` trong `dashboard()` ra cấp module.
- Steps:
  1. Thêm, ngay sau `export type LeadItem`:
     ```ts
     /** A lead is at risk when its Next Action is overdue, first contact is late, or the stage SLA is breached. */
     export const needsAttention = (l: Pick<LeadItem, 'health'>) => l.health.nextActionOverdue
       || Boolean(l.health.firstContact && l.health.firstContact.state !== 'ok' && l.health.firstContact.state !== 'warn')
       || l.health.stageSla?.state === 'breach';
     ```
  2. Xóa hằng `needsAttention` bên trong `dashboard()`; dòng `attention: active.filter(needsAttention)` vẫn giữ nguyên.
  3. Export `LEAD_SELECT`, `toLeadItem`, `vnDate` và kiểu `LeadListRow` bằng cách thêm `export` vào khai báo hiện có. Không đổi thân hàm.
- Success criteria: typecheck qua và test hiện có vẫn qua.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 1.2 — Viết `overviewData()`

- Goal: hàm server trả đúng contract phase 01.
- Target: tạo `apps/crm/src/worker/overview.ts`, export `async function overviewData(db: D1Database, actor: Actor, opts: { period?: string; departmentId?: string })` và `export const canSeeOverview = (actor: Actor) => actor.role === 'admin' || actor.role === 'director'`.
- Steps:
  1. Phạm vi: `const scope = leadScope(actor)`. Khi có `departmentId`, thêm `l.department_id = ?` vào điều kiện. Mọi truy vấn lead, task và approval đều dùng điều kiện này.
  2. Đọc phòng ban: `SELECT id, name FROM department WHERE organization_id = ? ORDER BY name`, bind `actor.organizationId`. Nếu `departmentId` không có trong danh sách thì coi như `null`.
  3. Đếm chính xác bằng SQL:
     ```sql
     SELECT l.status, l.stage, COUNT(*) n, COALESCE(SUM(l.expected_value),0) v FROM lead l
     WHERE <scope> AND (l.status IN ('queue','active') OR l.closed_at >= ?) GROUP BY l.status, l.stage
     ```
     Bind `periodStartUtc`. Từ kết quả tính:
     - cột `queue`: mọi dòng có status `queue`, không phân stage;
     - từng stage active;
     - `won`, `lost`;
     - các KPI tương ứng.
  4. Thẻ và rủi ro: `${LEAD_SELECT} WHERE <scope> AND (l.status IN ('queue','active') OR l.closed_at >= ?) ORDER BY l.updated_at DESC LIMIT 2000`, map qua `toLeadItem(row, now)`. `total` = tổng `n` ở bước 3. Nếu `total > rows.length` thì đặt `truncated = { shown, total }`.
  5. Với mỗi cột:
     - `atRisk` = số lead có `needsAttention`, chỉ tính cho lead active;
     - `leads` = sắp lead rủi ro lên trước, giữ thứ tự `updated_at`, lấy 8 lead đầu, map sang `OverviewCard`.
     - Riêng Won/Lost thì sắp theo `closedAt` mới nhất và `risk: false`.
  6. `overdueTasks`: `SELECT COUNT(*) n FROM task tk JOIN lead l ON l.id = tk.lead_id WHERE <scope> AND tk.status = 'open' AND tk.due_at < ?`, bind `now.toISOString()`.
  7. Approvals pending trong phạm vi:
     - `byKind`: `GROUP BY ap.kind`.
     - `oldest`: `ORDER BY ap.created_at ASC LIMIT 10`, join `lead l` để lấy `l.code` và `app_user ru` để lấy `display_name` làm `requester`.
     - `toStage` lấy bằng `json_extract(ap.payload_json, '$.toStage')`.
  8. Bot/Lark lấy theo các định nghĩa ở mục Contract. `todayStartUtc` = `new Date(`${vnDate(now)}T00:00:00+07:00`).toISOString()`.
  9. Không bao giờ select `contact_point`, `before_json` hay `after_json`.
- Success criteria: hàm compile và trả object đúng contract.
- Verify: no verification needed (Task 1.4 test hàm này qua API).

### Task 1.3 — Route API

- Goal: `GET /api/overview` chỉ cho admin và director.
- Target: `apps/crm/src/worker/index.ts`, đặt ngay sau route `app.get('/admin/overview', ...)`.
- Steps:
  1. Import `canSeeOverview` và `overviewData` từ `./overview`.
  2. Thêm route:
     ```ts
     app.get('/overview', async (c) => {
       const actor = c.get('actor');
       if (!canSeeOverview(actor)) return c.json(forbidden, 403);
       return c.json(data(await overviewData(c.env.DB, actor, { period: c.req.query('period'), departmentId: c.req.query('department') || undefined })));
     });
     ```
     Dùng biến `forbidden` có sẵn, chính là biến mà route `/admin/overview` đang dùng.
- Verify: no verification needed (Task 1.4).

### Task 1.4 — Test

- Target: tạo `apps/crm/test/overview.test.ts`, copy phần setup (`TABLES`, `beforeEach`, helper `get`) từ `test/domain-read-models.test.ts`. Danh sách bảng phải có thêm `agent_token` ở đầu nếu file kia chưa có.
- Các test, tên viết bằng tiếng Anh và mô tả hành vi:
  1. `only admin and director can open the overview`: `u-admin` và `u-bgd` nhận 200; `u-head`, `u-hung`, `u-lan` nhận 403.
  2. `overview counts match the database`: `kpi.openLeads` bằng `SELECT COUNT(*) FROM lead WHERE status='active'`, `kpi.queueLeads` bằng số lead `status='queue'`. Tổng `count` của các cột `ACTIVE_STAGES` bằng `openLeads`. Cột `queue` có `count` bằng `queueLeads`.
  3. `a director placed in a department still sees the whole organization`: chạy `UPDATE app_user SET department_id='dep-kd' WHERE id='u-bgd'`, rồi so `kpi` của `u-bgd` với `kpi` của `u-admin`: phải bằng nhau.
  4. `the department filter narrows every count`: insert `department` mới `dep-x`. Gọi `?department=dep-x` thì `openLeads` = 0 và `queueLeads` = 0. Gọi `?department=dep-kd` thì `openLeads` bằng số khi không lọc. Gọi `?department=khong-ton-tai` thì `departmentId` = null.
  5. `win rate counts only leads closed in the period`:
     - `UPDATE lead SET status='won', stage='won', closed_at=<now ISO>, next_action_task_id=NULL` cho 2 lead active;
     - `status='lost', stage='lost', lost_reason='price'` cho 1 lead;
     - đặt `closed_at` của mọi lead won/lost khác về `2000-01-01T00:00:00Z`.
     Kỳ vọng `wonCount`=2, `lostCount`=1, `winRate` gần đúng `2/3` (`toBeCloseTo`). Nếu CHECK constraint chặn update thì xem cách các test khác tạo lead won/lost và làm theo; không tắt constraint.
  6. `overview never carries customer contact details`:
     - lấy toàn bộ `value` trong `contact_point`;
     - `JSON.stringify(response)` không chứa giá trị nào trong đó;
     - và không chứa các chuỗi `"before"`, `"after"`, `"phone"`, `"email"`.
  7. `unknown period falls back to month`: `?period=abc` thì `period.key` = `month`.
- Verify: `pnpm -F @abm/crm exec vitest run test/overview.test.ts` exit 0 và in `7 passed`.

### Task 1.5 — Type web và trang

- Target:
  - `apps/crm/src/web/types.ts`: thêm `export interface Overview` khớp contract và `OverviewCard`.
  - Tạo `apps/crm/src/web/pages/overview.tsx`.
- Steps:
  1. `OverviewPage`:
     - `useActor()`; nếu role không phải `admin`/`director` thì render `<Alert tone="warn">Chỉ Admin và Giám đốc xem trang này.</Alert>` (như `admin.tsx`).
     - State `period` (mặc định `'month'`) và `department` (mặc định `''`).
     - `useApi<Overview>(`/overview?period=${period}${department ? `&department=${department}` : ''}`)`.
  2. Page head:
     - `<h1>Toàn cảnh</h1>`;
     - sub: "Pipeline đang mở là số hiện tại; Won/Lost và tỉ lệ chốt tính từ {start} đến nay.";
     - hai `select` có `label` (dùng class `visually-hidden` như `pipeline.tsx`): Kỳ (Tháng này / Quý này / Năm nay) và Phòng ban (Tất cả + danh sách).
  3. Nếu `truncated` khác null thì hiện `<Alert tone="warn">` với nội dung "Đang tính trên {shown}/{total} lead…".
  4. KPI dùng component `Kpi` có sẵn và class `kpis`:
     - Lead đang mở (note: giá trị pipeline);
     - Hàng chờ;
     - Won (note: giá trị);
     - Lost (note: giá trị);
     - Tỉ lệ chốt (`—` nếu null, nếu không thì phần trăm làm tròn);
     - Việc quá hạn;
     - Lead có rủi ro;
     - Chờ duyệt;
     - Bot hôm nay.
     Dùng `tone` danger hoặc warn giống `dashboard.tsx`.
  5. Kanban dùng class `board`, `column` và `deal-card` có sẵn. Mỗi cột:
     - header: tên cột (`'queue'` → "Hàng chờ", `won`/`lost` → `stageLabel`), count, `fmtMoney(value)`, và badge danger nếu `atRisk > 0`;
     - thẻ: mã lead, title link tới `/leads/$leadId`, owner, giá trị, hạn Next Action (`fmtDue`); đặt `data-alert` theo `risk`;
     - khi `count > leads.length` thì thêm link "+{count - leads.length} nữa" tới `/leads` với search: queue → `{ tab: 'queue' }`, won → `{ tab: 'won' }`, lost → `{ tab: 'lost' }`, stage → `{ tab: 'active', stage }`.
  6. Dưới kanban là `cols-2`, gồm hai card:
     - **Chờ duyệt**: chip theo loại, và danh sách `oldest` có mã lead link, người gửi kèm hậu tố " (bot)" khi `requestedByKind === 'agent'`, cùng tuổi tính bằng `fmtDue` hoặc ngày.
     - **Bot & Lark**: trạng thái "Bot được ghi" / "Bot đang khóa ghi", số token, thao tác bot 7 ngày, outbox theo trạng thái.
       Nhãn: pending → "Chờ gửi", sent → "Đã gửi", failed → "Lỗi", no_recipient → "Không có người nhận", skipped → "Bỏ qua".
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 1.6 — Route và menu

- Target:
  - `apps/crm/src/web/router.tsx`: import `OverviewPage`, thêm `createRoute({ getParentRoute: () => rootRoute, path: '/overview', component: OverviewPage })` ngay sau route `/`.
  - `apps/crm/src/web/components/layout.tsx`: thêm `{ to: '/overview', label: 'Toàn cảnh', icon: 'trophy', roles: ['admin', 'director'] }` ngay sau mục `/pipeline`.
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 1.7 — Hồi quy toàn bộ

- Verify: `pnpm -F @abm/crm test` exit 0, không có dòng `FAIL`, và tổng số test tăng đúng 7 so với trước phase.

### Task 1.8 — Commit

- Stage chỉ các file trong bảng Files.
- Message: `feat(crm): add organization overview board for admin and director`.
- Verify: `git status --short` không còn file nào trong bảng Files.

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
