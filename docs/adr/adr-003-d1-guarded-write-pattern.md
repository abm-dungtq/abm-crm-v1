# ADR-003: Guarded write nguyên tử trên D1

Trạng thái: proposed [ADR-PROPOSED]
Ngày: 2026-10-03

## Bối cảnh

[ERD](../architecture/erd-v1.md) yêu cầu optimistic concurrency, audit, outbox và idempotency cùng transaction. UPDATE không khớp version trả 0 dòng, không tự gây lỗi. Guard chỉ kiểm version mới có thể nhầm kết quả của writer thắng với writer thua.

## Quyết định

Mỗi command ghi thực hiện một `db.batch([...])`; bảng mutable sửa có điều kiện có `version` và `last_txn_id TEXT`. Nonce ULID mới cho mỗi invocation, kể cả retry; idempotency key của yêu cầu giữ ổn định, khác với nonce.

```sql
CREATE TABLE _guard(ok INTEGER NOT NULL CHECK (ok = 1));
-- ?5 = txn nonce (ULID mới cho mỗi lần gọi command)
UPDATE lead SET stage_id=?1, version=version+1, updated_at=?2, last_txn_id=?5 WHERE id=?3 AND version=?4;
INSERT INTO _guard(ok) VALUES ((SELECT COALESCE((SELECT 1 FROM lead WHERE id=?3 AND version=?4+1 AND last_txn_id=?5), 0)));
INSERT INTO audit_log(...) SELECT ... FROM lead WHERE id=?3 AND version=?4+1 AND last_txn_id=?5;
INSERT INTO outbox(...) SELECT ... FROM lead WHERE id=?3 AND version=?4+1 AND last_txn_id=?5;
DELETE FROM _guard;
```

SQL trên là template thiết kế, chưa là migration runnable; dấu `...` phải được thay bởi cột/bindings typed khi triển khai. Ngoài version/id, UPDATE thực tế phải kiểm organization và scope đã xác thực. Mỗi record sửa trong command nhiều entity phải có guard riêng; các guard cùng batch trước khi ghi audit/outbox/result idempotency. Bảng append-only không cần last_txn_id. Chỉ command layer dùng _guard; không có write path bypass.

Writer thua không có nonce của writer thắng, nên CHECK fail và rollback cả batch. Record không tồn tại cho COALESCE = 0 cũng phải fail. Không dùng `changes()`. Kiểm actor, scope, kill switch, approval đúng payload/version trước batch; không dùng pre-read thay optimistic lock. Idempotency result và approval consumption phải nguyên tử với mutation; cùng key khác actor/payload là conflict, replay cùng payload trả kết quả cũ sau kiểm quyền hiện tại.

## Phương án đã xét

- Pre-read rồi UPDATE: race, không bảo vệ audit/outbox.
- Guard chỉ `version=?4+1`: có thể lọt writer thua; loại.
- `changes()`: không dựa vào hành vi chưa chứng minh trong batch.
- Durable Object cho mọi ghi: thêm điều phối ngoài nhu cầu; DO chỉ dành reservation MVP3.

## Hệ quả

Guard lỗi không được biến thành success; stale version trả `STALE_VERSION`, không replay side effect. Guard/constraint bất thường cần phân loại nội bộ, không trả raw SQL/PII. Migrations phải backup trước apply. Pattern chưa accepted trước PoC remote.

## Bằng chứng/PoC

[D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) mô tả rollback khi statement lỗi. Phase 05 phải chứng minh stale write, missing row, hai writer song song (một thắng), lỗi giữa batch, không audit/outbox mồ côi, idempotency và Time Travel restore trên staging cô lập; không dùng local pass thay remote evidence.
