# Orca cook checkpoint — multi-agent test audit

## 1. Run and authority

- Hiện tại: đợt 1 — phase 01 (claude) + phase 02 (codex). Phase 03 (antigravity) chờ chỗ trống; phase 04 chờ 01–03.
- Tiếp theo: theo dõi 01 và 02 bằng `check --wait` (≤60s), xử lý câu hỏi, chấp nhận + commit từng phase.
- Coordinator: Claude Code, terminal `term_8f722355-880a-48fc-948b-ccc821217a4f`. Run `run_715a6126d381`.
- Skill: `C:/Users/ABM/.claude/skills/orca-cook-plan/SKILL.md`. Plan: `D:/TQD/CRM/plans/261004-1040-multi-agent-test-audit/plan.md`. Worktree: `D:/TQD/CRM` (current, nhánh main, baseline 92cf488).
- Flags: không `--auto` → câu hỏi duyệt chuyển cho user. Không flag cook. Runtime theo phase (do plan chỉ định): claude, codex, antigravity; model = mặc định cấu hình (không override).
- Cook entrypoint: claude `C:/Users/ABM/.claude/skills/ak-cook/SKILL.md` (`/ak:cook`); codex/antigravity `C:/Users/ABM/.agents/skills/ak-cook/SKILL.md` (`$ak-cook` / đọc trực tiếp). ak-test tương ứng: `.claude/skills/ak-test`, `.agents/skills/ak-test`.
- Orca 1.4.219, app local.

## 2. Phases and attempts

| Phase / deps / scope | Task / Dispatch / worker | Lifecycle | Acceptance | Checkpoint |
| --- | --- | --- | --- | --- |
| 01 / — / `apps/crm/test/domain-*.test.ts`, reports/phase-01 | task_bf3fb5ffa5d7 / ctx_83c1bc68c9c4 / claude / term_27e7fedc-96f0-4664-a284-6afe1b921d8a | settled succeeded, released | Verified: 4 file test 69/69 pass, worker tsconfig sạch, scope đúng; 13 phát hiện D-01..D-13 | 6cf7f50 |
| 02 / — / `apps/crm/test/security-*.test.ts`, reports/phase-02 | task_a01caf94f3d4 / ctx_cbe99d2a2ede / codex / term_b7861389-70ec-46ce-8990-2264ed23e8fc | settled succeeded | Verified: typecheck sạch, 110/110 test kết hợp, scope đúng; 10 phát hiện S-01..S-10 | commit phase 02 |
| 03 / — / reports/phase-03 | task_ca0bb1c4589c / ctx_d743a7233bd8 / antigravity / term_1d6d9408-64bc-4dd0-b2cd-a6dc5e019076 | running (screen: đọc skill, 11:01) | — | — |
| 04 / 01,02,03 / reports/phase-04 | task_66658f22016f / chưa dispatch | — | — | — |

Scope snapshot đợt 1: `<scratchpad>/snapshot-wave1.json` (chụp ngay sau dispatch 01/02, 10:47). Allow: `apps/crm/test/domain-*.test.ts`, `apps/crm/test/security-*.test.ts`, `plans/261004-1040-multi-agent-test-audit/reports/**`.

## 3. Pending questions and operations

Không có.

## 4. Next actions and gates

1. Dispatch 01 (claude) và 02 (codex) với `--worktree current`.
2. Khi một trong hai được chấp nhận + commit: dispatch 03 (antigravity); xác nhận trên màn hình worker thật sự chạy (agy từng treo 503).
3. Sau 01–03: chạy typecheck + test trên cây kết hợp, rồi dispatch 04.

## 5. Evidence and project execution guide

Project execution guide (từ `D:/TQD/CRM`, nguồn `apps/crm/package.json`, `docs/engineering/test-strategy.md`):

| Thao tác | Lệnh | cwd | Trạng thái |
| --- | --- | --- | --- |
| Test CRM | `pnpm -F @abm/crm test` | `D:/TQD/CRM` | verified 2026-10-04 (20/20, commit 7795c95) |
| Typecheck | `pnpm -F @abm/crm typecheck`; `pnpm -F @abm/contracts typecheck` | `D:/TQD/CRM` | verified, sạch |
| Build web | `pnpm -F @abm/crm build` | `D:/TQD/CRM` | verified |
| D1 local | `npx wrangler d1 migrations apply abm-crm-eval --local`; `npx wrangler d1 execute abm-crm-eval --local --file seed/demo.sql` | `D:/TQD/CRM/apps/crm` | documented (seed chỉ INSERT → cần state trống) |
| Dev server | `npx wrangler dev --port 8787` sau `pnpm build` | `D:/TQD/CRM/apps/crm` | documented; cổng 8787 trống lúc 10:45 |

Không có dependency trình duyệt trong workspace; không thêm dependency mới (quyết định plan). Không đụng Cloudflare remote.
