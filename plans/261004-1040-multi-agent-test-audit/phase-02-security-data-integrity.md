---
phase: 2
title: "Bảo mật, toàn vẹn dữ liệu, đồng thời"
status: completed
priority: P1
runtime: codex
dependencies: []
---

# Phase 02: Bảo mật, toàn vẹn dữ liệu, đồng thời

## Goal

Dùng `ak-test` để tìm lỗi phân quyền, rò rỉ dữ liệu, toàn vẹn ghi và xử lý đồng thời trong API CRM.

## Context

- Nguồn đúng: `docs/security/permission-matrix-v1.md`, `docs/security/` (ma trận rủi ro hành động nếu có), `docs/adr/` (ADR-003 guarded write, ADR-005 command pipeline), `docs/architecture/erd-v1.md`.
- Mã: `apps/crm/src/worker/{index,actor,scope,commands,queries,guarded-tx}.ts`, `apps/crm/migrations/0001_init.sql`, `apps/crm/wrangler.jsonc`, `packages/contracts/src/index.ts`.
- Chế độ demo: header `X-Demo-User` chỉ hợp lệ khi `DEMO_MODE=1`; đây là rút gọn có chủ đích của bản đánh giá, nhưng hành vi khi `DEMO_MODE` tắt hoặc user không tồn tại vẫn phải đúng.
- Test hiện có: `apps/crm/test/commands.test.ts`. Lệnh (từ `D:/TQD/CRM`): `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`.

## Góc kiểm tra

1. Xác thực: thiếu header, user không tồn tại, user bị khoá (nếu có), `DEMO_MODE` khác `1`.
2. Phân quyền theo đối tượng (IDOR): Sale đọc/ghi lead, task, account, approval, audit ngoài phạm vi qua mọi route GET và mọi command; Leader ngoài team; Admin không thấy dữ liệu khách.
3. Đầu vào: Zod chặn trường lạ, chuỗi rất dài, số âm, ngày không hợp lệ; tham số query (`stage`, `q`, `tab`, phân trang) không gây lỗi 500 hay SQL injection.
4. Lỗi trả về: không lộ stack, SQL hay dữ liệu ngoài phạm vi trong thông báo lỗi (kể cả chi tiết DUPLICATE_SUSPECTED).
5. Idempotency: cùng key khác body, khác actor cùng key, replay sau lỗi, key quá dài.
6. Guard ADR-003: stale version không đổi dữ liệu và không sinh audit/outbox; hai command song song chỉ một thắng; lỗi giữa batch rollback toàn bộ; `_guard` luôn rỗng sau batch.
7. Ràng buộc schema: CHECK của `lead` (next action, queue không owner, lost cần lý do), unique, khoá ngoại; thao tác nào có thể để dữ liệu vi phạm bất biến.
8. Audit/outbox: mọi command ghi đều có audit và outbox đúng actor, before/after đúng.

## Files

- Create: `apps/crm/test/security-*.test.ts` (chỉ test pass trên mã hiện tại).
- Create: `plans/261004-1040-multi-agent-test-audit/reports/phase-02-security-data-integrity.md`.
- Không sửa file nào khác. Không đụng Cloudflare remote.

## Steps

1. Đọc `ak-test` và `references/practical-principles-for-setting-up-and-running-tests.md`.
2. Chạy suite hiện có, ghi kết quả.
3. Lập bảng route × vai trò × kết quả mong đợi từ ma trận quyền, rồi kiểm tra từng ô bằng test.
4. Hành vi đúng → test pass. Hành vi sai → phát hiện kèm lệnh tái hiện; không commit test đỏ.
5. Chạy lại typecheck + test.

## Report format

Mỗi phát hiện: ID `S-xx`, mức độ (critical/high/medium/low), `file:line`, mô tả, bước tái hiện, mong đợi vs thực tế, nguồn quy tắc. Kèm bảng route × vai trò đã kiểm. Cuối báo cáo: test đã thêm, kết quả lệnh, phần chưa kiểm tra và lý do.

## Acceptance

- `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm test` pass.
- Báo cáo đủ định dạng; mỗi góc kiểm tra 1–8 có kết luận.
