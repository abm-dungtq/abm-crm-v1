# ABM CRM

ABM CRM quản lý bán hàng B2B, vận hành học viên và công việc nội bộ của đội ABM. Hệ thống chạy trên Cloudflare (Workers, D1, R2, Durable Objects), nối với GoClaw để chạy các agent AI và lấy MISA AMIS làm nguồn thực thu.

Xem [mục lục tài liệu](docs/README.md) để đọc yêu cầu, quyết định và quy ước kỹ thuật.

Phần dưới đây dành cho người hoặc agent mới nhận việc trên một máy khác. Đọc hết trước khi sửa code.

## 1. Repo có gì

Repo là pnpm workspace (`apps/*`, `packages/*`, `poc/*`).

| Đường dẫn | Là gì | Chạy ở đâu |
| --- | --- | --- |
| `apps/crm` | Web CRM (React + TanStack Router) và Worker API (Hono, REST + MCP). Có inbox đa kênh, chat nội bộ, công việc, thông báo, LMS admin. | Worker `abm-crm-eval` |
| `apps/lms` | Cổng học viên (`wrangler.jsonc`) và Worker nội dung cẩm nang (`wrangler.content.jsonc`). | Worker `abm-lms`, `abm-lms-content` |
| `apps/zalo-bridge` | Tiến trình Node giữ phiên Zalo cá nhân (zca-js), đẩy tin vào CRM, gọi GoClaw. | Máy Windows của công ty, cạnh GoClaw |
| `packages/contracts` | Zod schema và hợp đồng command dùng chung cho UI, REST và MCP. | — |
| `packages/lms-core` | Logic LMS dùng chung giữa CRM và LMS. | — |
| `poc/*` | Thử nghiệm nền tảng (D1 guard, định danh GoClaw). | Chỉ test |
| `docs/` | Tài liệu bền vững: ADR, kiến trúc, bảo mật, hướng dẫn. | — |
| `plans/` | Kế hoạch theo phase, báo cáo (`plans/reports/`), nhật ký (`plans/journals/`). | — |

Ba Worker dùng chung một D1 là `abm-crm-eval`. Migration nằm trong `apps/crm/migrations/` (đã tới `0030`). Origin các Worker nằm trong file `wrangler*.jsonc`; CRM ở `https://abm-crm-eval.ngulongyquan.workers.dev`.

## 2. Cài đặt trên máy mới

Yêu cầu: Node 22 trở lên, pnpm đúng bản trong `package.json` (`packageManager`), Git. Lệnh mẫu dùng PowerShell trên Windows.

```powershell
git clone https://github.com/abm-dungtq/abm-crm-v1.git
cd abm-crm-v1
corepack enable
pnpm install
pnpm -r typecheck
pnpm -r test
```

Cả hai lệnh cuối phải thoát với mã 0 trước khi bắt đầu sửa. Lần phát hành gần nhất có CRM 674 test đạt và 2 bỏ qua, bridge 114, LMS 17, lms-core 12. Test không gọi mạng: chúng chạy trên D1 giả lập và nạp toàn bộ migration.

### Chạy CRM ở máy local

Làm trong `apps/crm`:

```powershell
pnpm db:migrate:local
pnpm db:seed:local
node scripts/bootstrap-admin.mjs --local --email admin@demo.abm.example
pnpm dev:api   # Worker ở cổng 8787
pnpm dev       # web Vite, gọi API ở trên
```

Mật khẩu tạm của Admin được ghi vào `apps/crm/.admin-bootstrap.local`. Nếu muốn màn hình chọn vai trò demo thay vì đăng nhập, tạo `apps/crm/.dev.vars` với hai dòng `AUTH_MODE=` và `DEMO_MODE=1`. Chi tiết xem [môi trường](docs/engineering/environments.md).

Chạy xong thì tắt dev server. Không mở thêm dev server mới khi cổng đang bận; hãy tắt tiến trình cũ trước.

## 3. Những thứ không có trong Git

Các file sau bị `.gitignore` chặn. Máy mới phải tự có nếu cần deploy hoặc chạy bridge. Không bao giờ commit chúng và không in giá trị ra log hay báo cáo.

| Thứ cần có | Dùng để | Lấy ở đâu |
| --- | --- | --- |
| Đăng nhập Cloudflare (`pnpm exec wrangler login`) | Deploy, migration remote, `wrangler tail` | Tài khoản Cloudflare của chủ dự án |
| `~/.abm/vapid-private.txt`, `vapid-public.txt`, `vapid-subject.txt` | Khóa Web Push | Chép từ máy quản trị cũ. Đổi khóa thì mọi thiết bị phải bật lại thông báo. |
| `~/.abm/content-signing-secret` | Khóa ký link nội dung LMS, ba Worker phải cùng giá trị | Chép từ máy quản trị cũ |
| `~/.abm/lms-publish-token` | Token đăng cẩm nang LMS | Chép, hoặc cấp lại bằng `scripts/issue-lms-publish-token.mjs` |
| `apps/zalo-bridge/.env` | `CRM_BASE_URL`, `BRIDGE_SECRET`, `GOCLAW_API_KEY` | Mẫu ở `apps/zalo-bridge/.env.example`; giá trị lấy từ máy cũ |
| `apps/zalo-bridge/.sessions/` | Phiên đăng nhập Zalo đã lưu | Chỉ có trên máy đang chạy bridge. Máy mới thì quét QR lại từ trang Inbox. |
| `apps/crm/.dev.vars`, `.admin-bootstrap.local`, `.tokens.local` | Cấu hình và mật khẩu local | Tự tạo lại theo mục 2 |
| `exports/` | Bản sao lưu D1 trước migration | Giữ trên máy cũ; không cần cho việc phát triển |

Secret của Worker (`BRIDGE_SECRET`, `FB_*`, `ZALO_OA_*`, `TYPESAFE_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CONTENT_SIGNING_SECRET`...) đã nằm trên Cloudflare. Danh sách đầy đủ ở `apps/crm/src/worker/env.ts`. Xem bằng `pnpm exec wrangler secret list` trong `apps/crm`.

## 4. Máy Windows chạy GoClaw và Zalo bridge

GoClaw (cài ở `D:\Goclaw`, API `http://127.0.0.1:18790/v1`, ra ngoài qua Cloudflare Tunnel) và Zalo bridge chạy trên cùng một máy Windows của công ty, không chạy trên VPS. Khi máy này tắt, lệnh gửi Zalo nằm chờ trong D1 và chạy tiếp khi bridge kết nối lại. Trợ lý trong chat CRM sẽ báo "đang offline".

Bridge tự khởi động bằng Task Scheduler, tên task là "ABM Zalo Bridge". Script nạp `.env` trước rồi mới chạy. Cài lại task (không cần quyền Admin), từ thư mục gốc repo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps\zalo-bridge\scripts\install-startup-task.ps1
```

Log nằm ở `apps/zalo-bridge/logs/bridge.log`. Nếu chuyển bridge sang máy khác thì phải dừng task trên máy cũ trước, vì mỗi số Zalo chỉ được có một phiên. Đọc thêm [ADR-008](docs/adr/adr-008-zalo-bridge-sidecar.md) và [agent GoClaw cho Inbox](docs/integrations/goclaw-inbox-agents.md).

Mọi thay đổi cấu hình GoClaw (tạo agent, sửa prompt, đổi model, cấp key) phải được user đồng ý trước, và phải sao lưu GoClaw trước khi sửa.

## 5. Đang làm tới đâu (cập nhật 2026-10-26)

Plan đang mở: [261025-1500 chat nội bộ, công việc và agent](plans/261025-1500-internal-chat-tasks-agents/plan.md). Phase 01–06 đã xong. Phase 07 (phát hành) đã deploy ngày 26/10 và đang chờ user tự kiểm. Chi tiết ở [báo cáo phát hành](plans/reports/deploy-261026-internal-chat-tasks-agents.md).

Việc còn lại, tất cả cần user làm hoặc đồng ý:

| Bước | Việc |
| --- | --- |
| 7.4 | Thử chat giữa hai máy (tin hiện trong 2 giây), push trên Android/máy tính và iPhone đã thêm CRM ra màn hình chính, Kanban, hộp thoại việc tiếp theo |
| 7.5.3 | Cấp key `crm-user` cho từng người: `node scripts/issue-agent-tokens.mjs --server 01a1062a-ce8f-77b8-a16d-d69a39b2a6f5 --email …` (cwd `apps/crm`) |
| 7.5.5 | Thử chat riêng với Trợ lý, gọi `@Trợ lý` trong nhóm, thẻ đề xuất việc, thử khi GoClaw offline |
| 7.6.2–3 | Tạo token ở `/settings/agents`, gắn vào Claude Code/Codex/Antigravity, đọc thử nhóm test rồi thu hồi |
| 7.7 | Một ca chuyển người thật và bản tóm tắt 21:00 hiện trong nhóm "Inbox" của chat CRM |
| 7.8 | Chỉ khi 7.4, 7.5 và 7.7 đạt: xóa secret `LARK_APP_ID`, `LARK_APP_SECRET`, tắt app Lark và kênh `abm-lark` |

Việc đang treo khác:
- Cloudflare Stream cho video LMS chưa bật, nên các biến `STREAM_*` chưa đặt.
- Lớp kiểm tra chuyển người dùng TypeSafe Jev đang ở chế độ shadow, và key cần đổi.
- Nên tạo sẵn một tài khoản `[TEST]` để agent tự kiểm được các phần cần đăng nhập.

Muốn nắm lịch sử nhanh, đọc theo thứ tự: `plans/journals/` (mới nhất trước), báo cáo `deploy-*` trong `plans/reports/`, rồi các ADR trong `docs/adr/`.

## 6. Quy tắc làm việc

**Giao tiếp.** Báo cáo cho user bằng tiếng Việt đơn giản và giải nghĩa thuật ngữ. Câu đầu tiên nói kết quả.

**Kế hoạch và báo cáo.**
- Plan đặt ở `plans/{yyMMdd-HHmm}-{slug}/`, gồm `plan.md` và các file phase.
- Báo cáo đặt ở `plans/reports/{loại}-{yyMMdd-HHmm}-{slug}.md`.
- Chỉ tạo file Markdown trong `plans/` hoặc `docs/`. Docs chỉ sửa khi hành vi, cách cài, lệnh, kiến trúc hoặc bảo mật thay đổi.

**Code.**
- Theo [quy ước lập trình](docs/engineering/coding-conventions.md).
- Mọi ghi dữ liệu nghiệp vụ đi qua command trong `packages/contracts` và guarded write ([ADR-003](docs/adr/adr-003-d1-guarded-write-pattern.md)), để UI, REST và MCP dùng chung một quyền và một validation. Tin chat thì không đi qua audit.
- Migration mới đánh số nối tiếp trong `apps/crm/migrations/`. SQLite không bỏ được `NOT NULL`, nên khi cần thì rebuild bảng theo mẫu `0006_learner_foundation.sql`.
- Không đặt mã plan, mã phase hay mã finding vào comment, tên test hoặc commit.

**Kiểm.** Chạy test hẹp trước: `pnpm --filter @abm/crm exec vitest run test/<file>.test.ts`. Sau đó chạy `pnpm -r typecheck` và `pnpm -r test`. Không giấu test lỗi, không nới test cho qua.

**Gói Free của Cloudflare.** Mỗi ngày tối đa 100k request Worker, 100k request Durable Object và 100k lượt ghi D1. Mỗi lần chạy cron tối đa 50 truy vấn D1. Không polling dày. Có test đếm số truy vấn; hãy giữ chúng đạt.

**Thao tác remote phải được user cho phép từng lần.** Đó là deploy, `wrangler --remote`, xóa hoặc đặt secret, sửa GoClaw, gửi tin thật. Trước mọi migration hoặc sửa dữ liệu hàng loạt:
1. Sao lưu D1: `pnpm exec wrangler d1 export abm-crm-eval --remote --output exports/<tên>.sql`.
2. Ghi lại bookmark Time Travel.

Thứ tự phát hành là migration rồi mới deploy. Xem [deploy](docs/engineering/deployment-baseline.md) và [sao lưu](docs/operations/backup-restore-plan.md).

```powershell
pnpm --filter @abm/crm run deploy
pnpm --filter @abm/lms run deploy
pnpm --filter @abm/lms deploy:content
```

Không rollback CRM về bản không có lớp `ChatHub`, vì Cloudflare sẽ từ chối. Hãy sửa tiến (fix forward).

**Git.**
- Commit theo conventional commits (`feat(crm): …`, `fix(inbox): …`, `docs(plan): …`). Chỉ commit hoặc push khi user yêu cầu.
- Không commit `.env`, `.dev.vars`, token, khóa hay dữ liệu cá nhân. Rà diff trước khi push.

**Giọng bot Zalo.** Nick Zalo là nick cá nhân. Bot không nói "chuyển nhân viên"; bot đưa lý do tự nhiên và gắn dòng `HANDOFF` ẩn. Xem [ADR-009](docs/adr/adr-009-customer-facing-bot.md).

## 7. Tài liệu nên đọc trước

1. [ADR-001 stack](docs/adr/adr-001-stack-cloudflare-modular-monolith.md) và [ADR-005 command contracts](docs/adr/adr-005-command-contracts.md)
2. [Môi trường và biến](docs/engineering/environments.md)
3. [ERD](docs/architecture/erd-v1.md), [ma trận quyền](docs/security/permission-matrix-v1.md)
4. [ADR-012 chat nội bộ](docs/adr/adr-012-internal-chat-in-crm.md), [kết nối agent AI](docs/guides/connect-ai-agents.md)
5. [Agent GoClaw cho Inbox](docs/integrations/goclaw-inbox-agents.md), [ADR-010 hàng lệnh](docs/adr/adr-010-leased-command-dispatcher.md)
6. [Cổng học viên LMS](docs/adr/adr-011-learner-lms-portal.md), [đăng cẩm nang](docs/guides/lms-publish-handbook.md)
