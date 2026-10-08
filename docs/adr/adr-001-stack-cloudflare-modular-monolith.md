# ADR-001: Cloudflare modular monolith

Trạng thái: accepted [ADR-ACCEPTED]
Ngày: 2026-10-03

## Bối cảnh

[Plan](../../plans/261003-2239-abm-crm-foundation-poc/plan.md) chốt CRM toàn Cloudflare, GoClaw ngoài core, đủ 12 module theo ladder. [QĐ10](../decisions/business-decisions-v1.md) giao ADR cho phase 04; accepted theo authority phase và xác nhận coordinator, không phải tuyên bố mọi PoC đã pass.

## Quyết định

pnpm monorepo modular monolith: `apps/api` dùng Hono trên Workers cho REST + MCP Streamable HTTP không trạng thái; `apps/web` React + Vite + TanStack Router/Query, PWA qua Workers Static Assets. `packages/core` sở hữu domain/command/query/policy/approval/audit; `packages/contracts` sở hữu Zod command definitions dùng chung UI/REST/MCP.

D1 + Drizzle migrations; R2 private cho file; Queues + transactional outbox cho side effects; Cron Triggers cho SLA/roster reconciliation. Durable Objects chỉ dùng chống trùng lịch tài nguyên MVP3, không bổ sung cho các module khác. Vitest + `@cloudflare/vitest-pool-workers`; local/staging/production tách D1/R2/Queues/secrets theo [environments](../engineering/environments.md).

GoClaw chỉ gọi tool/API theo credential; không truy cập DB, không là nguồn dữ liệu chuẩn. App Lark CRM gửi notification/approval độc lập GoClaw. Phân module theo [repository structure](../engineering/repository-structure.md), không tách microservices khi chưa có nhu cầu.

## Phương án đã xét

- Twenty App: tham khảo UX/data model, hạ tầng không đáp ứng ràng buộc toàn Cloudflare.
- Fork Twenty: giữ stack/phụ thuộc khác và tăng chi phí port/bảo trì; loại.
- Laravel PRD 29.2: phù hợp kiến trúc truyền thống nhưng runtime không đáp ứng ràng buộc; loại.
- Core ABM trên Cloudflare: đáp ứng scope và quyền kiểm soát domain; chọn.

## Hệ quả

Đội sở hữu RBAC, migration, guarded write, restore và queue dedupe. Batch D1 chưa đủ chứng minh pattern nghiệp vụ; [ADR-003](adr-003-d1-guarded-write-pattern.md) còn proposed. Cloudflare dependency được chấp nhận, phải test remote trước pilot. Không triển khai production hoặc xây feature MVP1 trong phase này.

Cập nhật: ADR-008 (sidecar Zalo), ADR-010 (dispatcher lệnh lease D1).

## Bằng chứng/PoC

Nguồn thiết kế: [brainstorm](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md), [PRD 29/34](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md). Phase 01 đã scaffold workspace; các binding/deploy chưa có. Phase 05/06 kiểm D1/auth/actor riêng trước accepted ADR tương ứng; accepted stack không thay runtime evidence.
