---
phase: 2
title: Ma trận nhiệt, khối lượng Sale, nguồn lead, audit gần đây, lọc lead theo phòng ban
status: pending
depends_on: [1]
---

# Phase 02 — Ma trận nhiệt, khối lượng Sale, nguồn lead, audit gần đây

## Goal

Trang `/overview` có thêm bốn phần:

- ma trận nhiệt phòng ban hoặc team × stage, người xem chuyển được giữa hai kiểu;
- bảng khối lượng việc theo Sale;
- bảng nguồn lead kèm tỉ lệ chốt;
- 20 thao tác audit gần nhất.

Bấm vào một ô của ma trận sẽ mở `/leads` đã lọc đúng stage và phòng ban.

## Files

| Hành động | File |
|---|---|
| Sửa | `apps/crm/src/worker/overview.ts`: thêm `matrix`, `workload`, `sources`, `recentAudit` |
| Sửa | `apps/crm/src/worker/queries.ts`: `LeadFilter.departmentId`; `listLeads` lọc `l.department_id = ?` |
| Sửa | `apps/crm/src/worker/index.ts`: route `/leads` đọc query `department` |
| Sửa | `apps/crm/test/overview.test.ts` |
| Sửa | `apps/crm/src/web/types.ts` |
| Sửa | `apps/crm/src/web/pages/overview.tsx` |
| Sửa | `apps/crm/src/web/pages/leads.tsx`: đọc search `department`, gửi lên API |
| Sửa | `apps/crm/src/web/router.tsx`: `LeadsSearch.department` |
| Sửa | `apps/crm/src/web/styles.css`: class `heat` mới |

## Contract bổ sung

```ts
matrix: {
  stages: StageCode[];                                   // ACTIVE_STAGES
  departments: MatrixRow[];                              // mỗi phòng ban trong phạm vi (sau bộ lọc)
  teams: MatrixRow[];                                    // mỗi team, kèm departmentId
};
type MatrixRow = { id: string; name: string; departmentId: string;
  cells: { stage: StageCode; count: number; value: number; atRisk: number }[] };   // chỉ lead active
workload: { id: string; name: string; teamName: string | null; open: number; overdue: number; stale: number; won: number; lost: number }[]; // won/lost trong kỳ, xếp theo open giảm dần
sources: { code: string; total: number; won: number; lost: number; winRate: number | null }[]; // total = lead tạo trong kỳ; won/lost = đóng trong kỳ
recentAudit: { id: string; command: string; entity: string; leadId: string; leadCode: string; actorName: string | null; actorKind: string; createdAt: string }[]; // 20 dòng
```

## Tasks

### Task 2.1 — Lọc lead theo phòng ban

- Target: `apps/crm/src/worker/queries.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. Thêm `departmentId?: string` vào `LeadFilter`. Trong `listLeads`, nếu có giá trị thì `where.push('l.department_id = ?'); binds.push(filter.departmentId)`.
  2. Trong route `app.get('/leads', ...)`, thêm `departmentId: c.req.query('department') || undefined`.
- Verify: no verification needed (Task 2.4).

### Task 2.2 — Bổ sung `overviewData`

- Target: `apps/crm/src/worker/overview.ts`.
- Steps:
  1. `matrix`: dùng lại danh sách lead đã map ở Task 1.2 bước 4, chỉ lấy lead `status='active'`.
     - Gom theo `department_id` và theo `team_id`. Lead không có team thì không vào hàng team.
     - Muốn có `department_id`/`team_id` trên mỗi dòng thì đọc thẳng từ row SQL: thêm `l.department_id` vào select bằng cách chạy truy vấn riêng `SELECT l.id, l.department_id, l.team_id FROM lead l WHERE <scope> AND l.status='active'` rồi map theo `id`. Không sửa `LEAD_SELECT`.
     - Tên phòng ban lấy từ danh sách `departments`. Tên team lấy bằng `SELECT id, name, department_id FROM team`, lọc theo các phòng ban của tổ chức.
     - Mỗi hàng có đủ ô cho cả 7 stage; ô trống thì count = 0.
  2. `workload`:
     - SQL `SELECT u.id, u.display_name, t.name team_name FROM app_user u LEFT JOIN team t ON t.id = u.team_id WHERE u.organization_id = ? AND u.status='active' AND u.role IN ('sale','leader')`, thêm `AND u.department_id = ?` khi có bộ lọc;
     - đếm từ danh sách lead:
       - open = active;
       - overdue = `health.nextActionOverdue`;
       - stale = `stageSla.state === 'breach'`;
       - won/lost = đóng trong kỳ.
     - Bỏ người có tất cả số bằng 0.
  3. `sources`:
     ```sql
     SELECT l.source,
       SUM(CASE WHEN l.created_at >= ? THEN 1 ELSE 0 END) total,
       SUM(CASE WHEN l.status='won' AND l.closed_at >= ? THEN 1 ELSE 0 END) won,
       SUM(CASE WHEN l.status='lost' AND l.closed_at >= ? THEN 1 ELSE 0 END) lost
     FROM lead l WHERE <scope> GROUP BY l.source
     ```
     Bỏ dòng có cả ba số bằng 0; `winRate` tính như KPI.
  4. `recentAudit`:
     - import `AUDIT_SELECT` từ `queries.ts` (thêm `export` vào khai báo, không đổi nội dung);
     - chạy `${AUDIT_SELECT} WHERE <scope> ORDER BY al.created_at DESC LIMIT 20`;
     - map **chỉ** các trường trong contract. Không gọi `toAudit`, không đọc `before_json`/`after_json`.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 2.3 — Giao diện

- Target: `apps/crm/src/web/types.ts`, `apps/crm/src/web/pages/overview.tsx`, `apps/crm/src/web/pages/leads.tsx`, `apps/crm/src/web/router.tsx`, `apps/crm/src/web/styles.css`.
- Steps:
  1. Thêm các type ở mục Contract bổ sung vào `Overview`.
  2. `router.tsx`:
     - thêm `department?: string` vào `LeadsSearch`;
     - `validateSearch` thêm `department: typeof s.department === 'string' && s.department ? s.department : undefined`.
  3. `leads.tsx`:
     - đọc `search.department`;
     - khi có giá trị thì thêm `&department=${encodeURIComponent(search.department)}` vào đường dẫn API đang dùng;
     - hiện một chip "Phòng ban đã lọc" kèm nút xóa lọc (navigate với `department: undefined`).
  4. `overview.tsx`: thêm card **Ma trận nhiệt** ngay dưới kanban.
     - Có nút chuyển hai trạng thái "Theo phòng ban" / "Theo team", dùng `button` có `aria-pressed`.
     - Bảng: hàng = phòng ban hoặc team, cột = stage.
     - Mỗi ô là `Link` tới `/leads` với search `{ tab: 'active', stage, department: row.departmentId }`, ghi count và `fmtMoney(value)`.
     - Thuộc tính `data-heat` của ô theo tỉ lệ `atRisk / count`: `0` khi count = 0 hoặc atRisk = 0, `1` khi ≤ 0,25, `2` khi ≤ 0,5, `3` khi > 0,5.
     - Bảng nằm trong `div.table-wrap` để tự cuộn ngang ở khổ hẹp.
  5. Thêm `cols-2` thứ hai gồm ba card:
     - **Khối lượng theo Sale**: bảng `table responsive` như "Theo Sale" của `dashboard.tsx`;
     - **Nguồn lead**: dùng `sourceLabel(code)` từ `@abm/contracts`, tỉ lệ chốt hiện `—` khi null;
     - **Thao tác gần đây**: danh sách gồm thời điểm, tên người làm kèm " (bot)" khi `actorKind === 'agent'`, command, và mã lead link `/leads/$leadId`.
  6. `styles.css`, chỉ thêm, không sửa class cũ:
     ```css
     .heat td a { display: block; padding: 6px 8px; border-radius: var(--radius-sm); text-decoration: none; color: var(--text); }
     .heat td a[data-heat='1'] { background: color-mix(in srgb, var(--warn, #d97706) 15%, transparent); }
     .heat td a[data-heat='2'] { background: color-mix(in srgb, var(--danger) 20%, transparent); }
     .heat td a[data-heat='3'] { background: color-mix(in srgb, var(--danger) 35%, transparent); }
     ```
     Trước khi dùng, kiểm `styles.css` có biến `--warn` hay không. Nếu không có thì giữ fallback như trên.
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 2.4 — Test bổ sung

- Target: `apps/crm/test/overview.test.ts`.
- Thêm các test:
  1. `matrix rows add up to the open leads`: tổng `count` mọi ô trong `matrix.departments` bằng `kpi.openLeads`. Tổng ô của `matrix.teams` nhỏ hơn hoặc bằng `kpi.openLeads`.
  2. `recent audit shows who did what without the change details`: tạo một activity qua `POST /api/commands/logActivity` (theo mẫu các test khác) rồi gọi overview. `recentAudit.length` ≥ 1, phần tử đầu không có khóa `before` hay `after`.
  3. `leads can be filtered by department`: `GET /api/leads?status=active&department=dep-x` (với `dep-x` insert mới) trả mảng rỗng; `department=dep-kd` trả số lead bằng khi không lọc.
  4. Test PII hiện có (Task 1.4 #6) phải tiếp tục qua với response mới.
- Verify: `pnpm -F @abm/crm exec vitest run test/overview.test.ts` exit 0 và in `10 passed`.

### Task 2.5 — Kiểm giao diện thật ở 375px và 1280px

- Steps:
  1. Chạy nền `pnpm -F @abm/crm dev:api` (port 8787) và `pnpm -F @abm/crm dev`. Trước đó kiểm cổng đã có tiến trình chưa (`netstat -ano | findstr :8787`); nếu có tiến trình cũ do mình mở thì dừng nó, không mở thêm cổng khác.
  2. D1 local phải có dữ liệu: chạy `pnpm -F @abm/crm db:migrate:local` và `db:seed:local` nếu chưa có. Đăng nhập theo cách chạy local của dự án; nếu local dùng `AUTH_MODE=password` mà không có tài khoản thử, ghi "chưa kiểm tay" và dừng bước này, không tạo tài khoản thật.
  3. Mở `/overview` bằng Chrome tool ở hai bề rộng 375 và 1280. Chạy `document.documentElement.scrollWidth <= window.innerWidth`.
  4. Dừng cả hai tiến trình dev sau khi kiểm.
- Verify: biểu thức ở bước 3 trả `true` ở cả hai bề rộng. Nếu bước 2 không đăng nhập được thì ghi rõ "chưa kiểm tay" trong báo cáo; đây không tính là thất bại.

### Task 2.6 — Hồi quy và commit

- Verify: `pnpm -F @abm/crm test` exit 0 và không có `FAIL`; `pnpm -F @abm/crm typecheck` exit 0; `pnpm -F @abm/crm build` exit 0.
- Commit:
  - stage chỉ các file trong bảng Files;
  - message `feat(crm): add heat map, workload and recent activity to the overview`.

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
