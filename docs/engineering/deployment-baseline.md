# Baseline triển khai

Đây là quy trình dự kiến; hiện scaffold chưa có manifest Wrangler hay pipeline deploy. Phase 04 không đăng nhập Cloudflare, tạo remote resource hoặc deploy production. [Environments](environments.md) sở hữu binding convention; manifest khi triển khai là nguồn cấu hình thực tế.

## Release checklist

1. Chốt env, revision, migration/config versions và người thực hiện; staging resources/GoClaw riêng. User cấp phép remote actions; không lấy secret từ repo.
2. Chạy focused test rồi affected contract/type/build checks theo [test strategy](test-strategy.md); ADR proposed phải có bằng chứng PoC trước pilot.
3. Backup schema/data trước mọi migration; ghi Time Travel bookmark và export kiểm integrity, kiểm file/config recovery theo [backup plan](../operations/backup-restore-plan.md).
4. Review migration tương thích code hiện tại và code mới; áp migration trước code: `wrangler d1 migrations apply <database-binding> --env staging --remote`. Binding là tham số phải lấy từ manifest, không chạy placeholder. Migration không tương thích phải có kế hoạch expand/contract đã duyệt.
5. Deploy `wrangler deploy --env staging` theo từng app manifest; web Workers Static Assets và API cùng release contract. Production chỉ sau approval riêng và staging pass, không thuộc foundation.
6. Smoke auth/UI/REST/MCP, deny cases, audit/outbox, notification projection và kill switch; theo dõi error/queue backlog. Chỉ bật dispatcher sau reconciliation khi restore đã xảy ra.
7. Lưu revision, env, migration/config version, pass/fail và rollback target trong release record; không log secrets/binding credential.

## Rollback

`wrangler rollback --env staging` phục hồi phiên bản Worker sau khi chọn version đã kiểm; kiểm compatibility với schema hiện tại. Worker rollback khác restore DB: không undo migration hay dữ liệu. Ưu tiên forward migration có backup; DB restore cần user duyệt, maintenance, checkpoint và đối soát delivery ledger trước resume. Không rollback Worker consumer tới code tạo side effect lặp. CLI flags kiểm theo [Wrangler deploy/rollback](https://developers.cloudflare.com/workers/wrangler/commands/) của bản cài lúc vận hành.
