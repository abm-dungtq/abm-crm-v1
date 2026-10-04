# Orca cook checkpoint

## 1. Run và quyền

- Hiện tại: Run xong, 5/5 phase đã chấp nhận và commit. Không còn worker mở (worker-list reclaimable = 0).
- Tiếp theo: chờ user quyết định deploy eval và các mục cần quyết định trong optimization-proposal.md.
- Coordinator: Claude Code session `af0b2f0c-5425-4402-9c8c-f4b545e166aa`, Orca handle `term_8f722355-880a-48fc-948b-ccc821217a4f`.
- Run: `run_4aad719829ec`.
- Skill: `C:\Users\ABM\.claude\skills\orca-cook-plan\SKILL.md`. Plan: `D:\TQD\CRM\plans\261004-2139-codebase-debug-optimization\plan.md`.
- cwd/worktree: `D:\TQD\CRM`, branch `main`, worktree `current`.
- Cờ: không `--auto` → các câu hỏi duyệt của worker được chuyển cho user. Không `--advice`.
- Runtime theo yêu cầu user: codex, grok, antigravity (agy).
- Cook entrypoint dùng chung: `C:\Users\ABM\.agents\skills\ak-cook\SKILL.md`. Kèm `ak-test`, `ak-code-review` cùng thư mục.

## 2. Phases và attempts

| Phase / phụ thuộc | Runtime | Task / Dispatch | Lifecycle | Acceptance | Checkpoint |
|---|---|---|---|---|---|
| 01 test+debug / — | codex (GPT-6.1-Sol medium) | task_0b5a258cb85d / ctx_a382e0917acd / term_08ada978-4c4e-4a93-8ba8-4528a5782d0c | settled succeeded 21:50, released (terminal đóng) | verified: scope-guard 0 vi phạm; lỗi MCP replay vs kill switch kiểm lại trên `mcp-tools.ts:110`, `commands.ts:77` | commit `e7affcb` |
| 02 review backend / — | grok (Grok 4.7 high) | task_e6c67a064293 / ctx_f57753ffcb33 / term_3fcfc888-f317-4f07-b8ec-dbf384fe3270 | settled succeeded 21:52, released | verified: scope-guard 0 vi phạm; #1 kill switch ngược kiểm lại trên `overview.ts:58,159` | commit `23412eb` |
| 03 review web / — | antigravity | task_bcc59021e09d / ctx_212d31410ea0 / term_84d206f6-64f4-4bee-aa88-19879547b277 | settled succeeded 21:51, released | verified: scope-guard 0 vi phạm; High #1,#2,#3,#4 kiểm lại trên code (queries.ts:105/354, lead-actions.tsx:106, router.tsx:56). Ghi chú: #5 bundle, #6 audit 403 thực chất mức Medium | commit `68a5518` |
| 04 sửa lỗi / 01,02,03 (danh sách chốt, commit sau `23412eb`) | codex | task_d91c104223df / ctx_6533a7288a1e / term_8eb4002c-d593-41c7-9420-2ee348ad56e8 | settled succeeded 22:21, released | verified: coordinator chạy lại test 223/223, `pnpm -r test` 239/239, typecheck 0, build 0; scope-guard chỉ lệch `dist/` (gitignored); review diff mcp-tools/overview/approval-notify/commands | commit `0dba63d` |
| 05 tối ưu / 01,02,03 | antigravity | task_9e059caa2676 / ctx_3421263b53cd / term_4d17843c-79ff-401c-9c84-9113042f1b8c | settled succeeded 21:58, released | verified: scope-guard 0 vi phạm; coordinator sửa số migration đề xuất thành 0005/0006 | commit `cfa0d46` |

## 3. Câu hỏi và thao tác đang chờ

- Không có câu hỏi đang chờ.
- Đã trả lời `msg_29f82130f445` (phase 01, codex): cho phép chuyển test tạm sang `D:/TQD/crm-test-debug-ctx-a382e0917acd` (cùng ổ đĩa, ngoài repo), chạy một lần rồi xóa. Phase file đã cho phép test tạm ngoài repo nên không cần hỏi user. Ack `delivery_a76060b72e84`.

- Đã trả lời `msg_2197954a06a6` (phase 04): duyệt `?view=page` opt-in cho `/leads` và `/accounts` (mặc định vẫn trả mảng), KPI dashboard bằng SQL, giới hạn 2000 candidate, outbox `sending` (dòng kẹt > 5 phút giành lại được, có test), review delegate chỉ đọc. Lý do: thay đổi contract là cộng thêm, tương thích ngược, nằm trong phạm vi sửa lỗi của plan. Ack `delivery_40c4f04f046e`.
- Đã trả lời `msg_a4254cca985c` (phase 04): duyệt health KPI dashboard tính trên mẫu 500 kèm `truncated` (UI ghi là số tối thiểu); outbox dùng `sent_at` làm thời điểm claim khi `sending`, nhưng chỉ hiển thị là "đã gửi" khi `status='sent'`. Ack `delivery_923e21d1ccff`.

## 4. Việc tiếp theo và cổng

- Phase 01–03 chỉ được ghi file báo cáo của mình. Kiểm bằng `scope-guard.mjs check` với snapshot
  `scratchpad\scope-before-wave1.json` trước khi chấp nhận.
- Phase 04 sửa code: cần test/typecheck/build xanh do coordinator chạy lại.
- Không deploy, không ghi remote, không GoClaw/Lark. Cần user đồng ý cho mọi việc ngoài plan.

## 5. Bằng chứng và Project execution guide

### Project execution guide

| Việc | Lệnh | cwd | Nguồn | Trạng thái |
|---|---|---|---|---|
| Test CRM | `pnpm -F @abm/crm test` (vitest + `@cloudflare/vitest-plugin`, DEMO_MODE, header `X-Demo-User`) | `D:\TQD\CRM` | `apps/crm/package.json` | đã chạy: 202/202 pass lúc 2026-10-04 ~16:40 |
| Typecheck | `pnpm -F @abm/crm typecheck` | `D:\TQD\CRM` | `apps/crm/package.json` | đã chạy: exit 0 |
| Build | `pnpm -F @abm/crm build` | `D:\TQD\CRM` | `apps/crm/package.json` | đã chạy: exit 0 |
| Test mọi package | `pnpm -r test` | `D:\TQD\CRM` | `package.json` | có trong tài liệu |
| Dev API local | `pnpm -F @abm/crm dev:api` (port 8787) — không cần cho plan này | `D:\TQD\CRM` | `apps/crm/package.json` | có trong tài liệu |

Ghi chú công cụ:
- Không dùng `pnpm deploy` / `pnpm -F @abm/crm run deploy` (ngoài phạm vi).
- Git Bash trên máy này lỗi profile (`exp: command not found`): dùng PowerShell.

### Bằng chứng

- Chưa có.
