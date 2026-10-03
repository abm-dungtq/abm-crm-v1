---
title: "ABM Agentic CRM — Foundation (MVP0) và PoC"
description: "Chốt decision pack, ERD, ADR, ma trận quyền và chứng minh D1, danh tính GoClaw/Lark, MISA trước khi xây MVP1."
status: pending
priority: P1
effort: "3-4 tuần"
branch: main
tags: [infra, backend, database, auth, docs, experimental]
blockedBy: []
blocks: []
created: 2026-10-03
---

# ABM Agentic CRM — Foundation (MVP0) và PoC

## Kết quả cần đạt

Khi xong plan này, MVP0 của PRD đạt exit gate (PRD mục 34.6): mọi quyết định mục 43 có câu trả lời được user ký duyệt; ERD v1, ADR và các ma trận quyền nằm trong `docs/`; ba PoC trên hạ tầng thật có bằng chứng pass/fail. Chỉ khi đó mới lập plan MVP1.

Nguồn contract: [brainstorm report](../reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md). Gói nguồn: `D:/TQD/CRM/.orca/drops/abm-agentic-crm-cook-20261003-201748.zip` (PRD v2.1, thiết kế, phản biện, GoClaw handoff).

## Quyết định đã chốt (không mở lại)

- B2B sale + quản lý việc đội sale là pipeline đầu, dùng stage mẫu PRD 10.2.
- Agent GoClaw có từ MVP0/1. Kênh nội bộ là Lark; mỗi nhóm Lark là một phòng ban; mỗi nhân viên liên kết tài khoản một lần qua DM bot.
- Trong nhóm: pipeline phòng ban xem được; hoa hồng, lý do Lost, dữ liệu cá nhân khách chỉ qua DM. Web áp RBAC cá nhân/team.
- Toàn bộ CRM trên Cloudflare (Workers, D1, R2, Queues, Cron); GoClaw chạy ngoài, user là admin duy nhất.
- MISA AMIS là nguồn thực thu; bảng kế toán duyệt dùng import/đối soát.
- Agent MVP1 tự làm: ghi hoạt động, tạo việc tiếp/nhắc, tạo lead có kiểm trùng. Phải duyệt: đổi stage, Won/Lost, đổi owner, gửi ra ngoài.
- Pilot 15–50 người. RPO ≤ 1 giờ, RTO ≤ 4 giờ.
- Repo `D:/TQD/CRM`, nhánh `main`. Không có `--yagni`: giữ đủ 12 module theo ladder.

## Non-goals của plan này

Không xây tính năng MVP1 cho người dùng thật; không deploy production; không sửa MISA; không migrate dữ liệu thật; không đổi cấu hình GoClaw production khi chưa backup và chưa có user đồng ý từng bước.

## Phases

| # | Phase | Pha | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 01 | [Khởi tạo repo và workspace](phase-01-repo-workspace-bootstrap.md) | A | — | pending |
| 02 | [Decision pack mục 43 PRD](phase-02-business-decision-pack.md) | A | 01 | pending |
| 03 | [ERD v1 và state model](phase-03-erd-state-model.md) | A | 02 | pending |
| 04 | [ADR và ma trận quyền/rủi ro](phase-04-adr-policy-matrices.md) | A | 02, 03 | pending |
| 05 | [PoC D1 guarded write, concurrency, restore](phase-05-poc-d1-guarded-write.md) | B | 01, 04 (ADR-003 draft) | pending |
| 06 | [PoC GoClaw + Lark identity, kill switch, GoClaw down](phase-06-poc-goclaw-lark-identity.md) | B | 01, 04 (ADR-002/004 draft) | pending |
| 07 | [PoC MISA coverage (song song, không chặn)](phase-07-poc-misa-coverage.md) | B | 02 | pending |
| 08 | [MVP0 exit gate, runbook GoClaw, tài sản đào tạo](phase-08-mvp0-exit-gate.md) | A+B | 02–07 | pending |

Phase 05, 06, 07 chạy song song được; file ownership tách theo thư mục `poc/d1-guard/`, `poc/goclaw-identity/`, `docs/integrations/misa/`.

## Acceptance criteria

1. `docs/decisions/business-decisions-v1.md` trả lời đủ 11 quyết định mục 43, các deliverables business PRD 34.2 (QĐ12–14, Product Master mẫu, Handover Schema, Entitlement Model v0) và 10 câu exit gate PRD 34.6, có dấu `[APPROVED]` của user.
2. `docs/architecture/erd-v1.md` có ERD mermaid cho MVP1 đầy đủ và roadmap entity cho MVP2–5.
3. Năm ADR (001–005) trạng thái `accepted [ADR-ACCEPTED]`: stack, auth web, D1 write pattern, actor/danh tính chat, command contracts.
4. `docs/security/permission-matrix-v1.md` và `docs/security/action-risk-matrix-v1.md` khớp quyết định đã chốt.
5. PoC D1: test pass cho stale write rollback, hai writer song song, rollback giữa batch, restore Time Travel trên D1 remote cô lập.
6. PoC GoClaw: bằng chứng ghi lại (log/ảnh) cho từng kịch bản identity; kết luận chọn cơ chế 1, 2 hoặc 3 trong ADR-004.
7. PoC MISA: báo cáo coverage với kết luận API hay import file.
8. `plans/reports/mvp0-exit-gate-*.md` kết luận go/no-go cho MVP1; `docs/operations/goclaw-runbook.md` và `docs/training/mvp0/` (PRD 34.4) hoàn thành.
9. Baseline kỹ thuật PRD 34.3 đủ: environments, seed/config, deployment, security baseline, audit convention, test strategy, backup/restore plan.

## Roadmap sau MVP0 (lập plan riêng cho từng bậc)

| Bậc | Module PRD | Agent | Gate chính |
|---|---|---|---|
| MVP1 | 1 Customer 360 cơ bản, 2 Lead/Ownership, 3 Pipeline/Activity/Follow-up, 12 Task/Audit/Dashboard/Notification (phần cơ bản) | Agent Sales trong nhóm Lark: tra cứu, ghi hoạt động, nhắc việc, báo cáo CRM; thẻ duyệt Lark | PRD 35.8 + actor spoofing bị từ chối, permission parity UI/REST/MCP, idempotency, kill switch |
| MVP2 | 4 Product/Pricing/Knowledge, 5 Proposal/Contract/Order/Payment reference, 6 Handover, 8 Entitlement | Soạn proposal/handover, theo dõi quyền lợi | PRD 36.8 + finance provenance, không sinh entitlement trùng |
| MVP3 | 7 Program Operations, 9 Customer Success, 10 Retention (phần renewal) | Agent Delivery/CSKH | PRD 37.6 + chống trùng lịch tài nguyên (Durable Object) |
| MVP4 | 11 Omnichannel, 12 Workflow/Automation đầy đủ, 10 Upsell/Referral | Agent theo kênh khách hàng | PRD 38.6 + dedupe/replay, handoff người–agent |
| MVP5 | 12 Governance hoàn thiện, digital workforce | Specialist agents, evaluation, cost/quota | PRD 39.7 + core chạy độc lập khi GoClaw tắt |

## Rủi ro chính

- GoClaw có thể không liên kết Lark open_id với người dùng như tài liệu mô tả (build đã patch). Phase 06 kiểm ngày đầu; nếu fail, chuyển cơ chế 2 rồi 3.
- D1 guard pattern chưa có bằng chứng runtime. Phase 05 quyết định.
- MISA API có thể không mở cho tài khoản ABM. Phase 07 có đường lui import file.
- User là admin GoClaw duy nhất: mọi thao tác trên GoClaw cần user thực hiện hoặc đồng ý, và runbook phải viết lại.

## Supervision

Plan viết theo `--advice`: executor yếu hơn chạy được; mỗi phase có Failure Protocol dừng và hỏi `kongming` khi Verify fail.
