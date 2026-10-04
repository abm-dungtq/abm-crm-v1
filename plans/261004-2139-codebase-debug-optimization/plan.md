---
title: Debug codebase CRM và đề xuất tối ưu (Orca điều phối codex, grok, agy)
status: completed
created: 2026-10-04
mode: orca-cook-plan
---

# Debug codebase CRM và đề xuất tối ưu

Ba runtime (Codex, Grok, Antigravity) cùng soát `apps/crm` và `packages/contracts`:
chạy test bằng `ak-test`, review bằng `ak-code-review`, sửa lỗi đã xác nhận, rồi viết
phương án tối ưu. Orca điều phối; coordinator chỉ giao việc, kiểm bằng chứng và commit.

## Phases

| # | Phase | Runtime | Phụ thuộc | Status |
|---|---|---|---|---|
| 01 | [Chạy test, typecheck, build và debug lỗi (ak-test)](phase-01-test-and-debug.md) | codex | — | completed |
| 02 | [Review worker/API và contracts (ak-code-review)](phase-02-review-worker-api.md) | grok | — | completed |
| 03 | [Review giao diện web (ak-code-review)](phase-03-review-web-ui.md) | antigravity | — | completed |
| 04 | [Sửa lỗi đã xác nhận kèm test hồi quy](phase-04-fix-confirmed-bugs.md) | codex | 01, 02, 03 | completed |
| 05 | [Phương án tối ưu codebase](phase-05-optimization-proposal.md) | antigravity | 01, 02, 03 | completed |

## Acceptance criteria

- Ba báo cáo 01–03 nằm trong `reports/` của plan này. Mỗi phát hiện có `file:dòng`,
  mức độ (critical/high/medium/low) và cách tái hiện hoặc bằng chứng.
- Lỗi critical/high đã xác nhận được sửa ở phase 04, mỗi lỗi có test hồi quy.
- Sau phase 04, `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`,
  `pnpm -F @abm/crm build` và `pnpm -r test` đều exit 0.
- `reports/optimization-proposal.md` xếp hạng đề xuất theo lợi ích, công sức và rủi ro.
  Phase này không sửa code.

## Ràng buộc chung

- Không deploy, không migration remote, không ghi D1 remote, không đụng GoClaw, Lark,
  MISA hay production. Không đổi kill switch.
- Không mở hoặc in: `.tokens.local`, `.admin-bootstrap.local`, `.env*`,
  `D:\Goclaw\data\*`, Cloudflare account ID. Không in secret vào báo cáo.
- Không sửa hay stage các file đang dở của user: `docs/README.md`,
  `docs/guides/lark-crm-e2e-test.md`, `poc/**`, `plans/reports/poc-goclaw-lark-identity-result.md`,
  `plans/261004-1457-crm-bot-gateway/**`, `plans/journals/**`, `.claude/**`.
- Worker không commit; coordinator commit theo từng phase.
- Không đưa mã plan, tên phase hay mã phát hiện vào code, tên test hay commit message.
- Không đổi public contract (API response, schema D1), trừ khi bắt buộc để sửa lỗi và có ghi rõ.
- Báo cáo viết tiếng Việt đơn giản.

## Ghi chú triển khai

- 2026-10-05 06:46: user đồng ý deploy bản sửa lỗi (commit `0dba63d`) lên eval. Không có migration. Version `c0601acd-3752-40a9-8e85-22dc9582606f`. Kiểm sau deploy: `/api/health` 200; `/api/overview` và `/api/mcp` chưa đăng nhập 401; `/api/mcp` có header Origin 403; `/overview` và `/leads` 200.
