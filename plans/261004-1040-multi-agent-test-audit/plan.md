---
title: "Kiểm thử đa chiều CRM bằng Claude, Codex và Antigravity"
description: "Ba agent khác nhau chạy ak-test trên apps/crm theo ba góc nhìn, sau đó đối chiếu chéo và hợp nhất phát hiện lỗi."
status: completed
priority: P1
effort: "1 ngày"
branch: main
tags: [testing, qa, security, frontend]
blockedBy: []
blocks: []
created: 2026-10-04
---

# Kiểm thử đa chiều CRM bằng Claude, Codex và Antigravity

## Kết quả cần đạt

Mỗi agent (Claude Code, Codex, Antigravity) chạy `ak-test` trên codebase `apps/crm` + `packages/contracts` theo một góc nhìn riêng, viết báo cáo phát hiện có bằng chứng tái hiện, và bổ sung test cho các hành vi đúng chưa được phủ. Phase cuối kiểm chứng chéo từng phát hiện, loại trùng, xếp mức độ và đề xuất plan sửa.

## Quy trình (dùng lại được)

1. Coordinator chạy `/orca-cook-plan` trên plan này. Mỗi phase là một phiên agent mới trong Orca chạy `ak-cook` với phase file; phase file yêu cầu dùng `ak-test` cho phần phân tích và kiểm thử.
2. Đợt 1: phase 01 (Claude) và phase 02 (Codex) chạy song song vì ghi vào file test khác nhau. Phase 03 (Antigravity) chạy khi có chỗ trống, chỉ ghi báo cáo.
3. Phase 04 (Claude, phiên mới) chỉ chạy sau khi 01–03 được chấp nhận và checkpoint.
4. Chạy lại cho vòng sau: tạo plan mới cùng cấu trúc, đổi ngày; giữ nguyên phân vai runtime để các góc nhìn vẫn độc lập.

## Quyết định

- Không sửa mã sản phẩm trong plan này. Lỗi đã xác nhận được ghi vào báo cáo kèm cách tái hiện; việc sửa là plan riêng sau khi user duyệt.
- Test mới phải pass trên mã hiện tại. Không commit test đỏ, không dùng `skip`/`todo`/`it.fails` để giấu lỗi; lỗi được chứng minh bằng lệnh tái hiện trong báo cáo.
- Không thêm dependency mới vào workspace (tránh đụng `pnpm-lock.yaml` giữa các worker song song).
- Không đụng Cloudflare remote (Worker `abm-crm-eval`, D1 remote). Chỉ chạy local.
- Mỗi worker không commit; coordinator commit theo phase.

## Non-goals

Sửa lỗi sản phẩm; refactor; đổi CI; deploy; tối ưu test suite.

## Phases

| # | Phase | Runtime | Phụ thuộc | Ghi được | Trạng thái |
|---|---|---|---|---|---|
| 01 | [Đúng nghiệp vụ và API](phase-01-domain-api-correctness.md) | claude | — | `apps/crm/test/domain-*.test.ts`, báo cáo 01 | completed |
| 02 | [Bảo mật, toàn vẹn dữ liệu, đồng thời](phase-02-security-data-integrity.md) | codex | — | `apps/crm/test/security-*.test.ts`, báo cáo 02 | completed |
| 03 | [Giao diện, E2E, khả năng tiếp cận](phase-03-ui-e2e-accessibility.md) | antigravity | — | báo cáo 03 | completed (dừng sớm theo user) |
| 04 | [Đối chiếu chéo và hợp nhất](phase-04-cross-verify-consolidate.md) | claude | 01, 02, 03 | báo cáo tổng hợp | completed (coordinator tổng hợp theo user) |

Kết quả: [báo cáo tổng hợp](reports/phase-04-consolidated-findings.md). Sửa lỗi bằng `/ak:fix` theo quyết định user ghi trong báo cáo đó: [báo cáo sửa lỗi](reports/fix-consolidated-findings.md).

Báo cáo nằm trong `plans/261004-1040-multi-agent-test-audit/reports/`.

## Acceptance

1. Ba báo cáo phase 01–03 tồn tại, mỗi phát hiện có: vị trí `file:line`, mức độ, lệnh hoặc bước tái hiện, kết quả mong đợi và thực tế.
2. `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm test` pass trên cây kết hợp sau đợt 1.
3. Báo cáo phase 04 liệt kê từng phát hiện với trạng thái đã tái hiện / không tái hiện / trùng, xếp theo mức độ, và đề xuất phạm vi plan sửa.
4. Không có thay đổi ngoài phạm vi ghi của từng phase.
