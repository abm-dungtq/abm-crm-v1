# Phase 04 — ADR và ma trận chính sách

Tasks 4.1–4.9 hoàn thành và mọi Verify tương ứng pass trên Git Bash tại D:/TQD/CRM. Task 4.10 commit/Verify thuộc coordinator theo trả lời Orca; worker không stage hoặc commit. Không sửa plan.md, status phase khác, DB, remote resource, GoClaw hoặc MISA.

## Quyết định supervisor

Coordinator trả lời blocking ask: giữ BGĐ duyệt export cuối theo QĐ5; Department Head review scope. R2 dùng versioning cấp ứng dụng bằng immutable keys + metadata vì native bucket versioning không hỗ trợ. ADR-001/005 accepted theo authority phase; ADR-002/003/004 proposed tới PoC. CSKH/Triển khai/Kế toán và audit-view chi tiết proposed, deny mặc định và chốt trước plan MVP2/MVP3. Không gắn user approval cho ma trận; navigation docs/README.md được phép cập nhật. Commit và Verify 4.10 coordinator-owned, worker_done sau 4.1–4.9.

## Verify thực hiện nguyên văn

Mỗi lệnh chạy qua Git Bash, exit code 0. Không thay grep/test bằng check khác.

### Task 4.1 — PASS

```bash
grep -c 'ADR-ACCEPTED' /d/TQD/CRM/docs/adr/adr-001-stack-cloudflare-modular-monolith.md
```

Output: `1`.

### Task 4.2 — PASS

```bash
grep -c 'Cf-Access-Jwt-Assertion' /d/TQD/CRM/docs/adr/adr-002-web-auth.md
```

Output: `1`.

### Task 4.3 — PASS

```bash
grep -c 'CHECK (ok = 1)' /d/TQD/CRM/docs/adr/adr-003-d1-guarded-write-pattern.md
```

Output: `1`.

### Task 4.4 — PASS

```bash
grep -c 'updatedInput' /d/TQD/CRM/docs/adr/adr-004-chat-actor-identity.md
```

Output: `2`.

### Task 4.5 — PASS

```bash
grep -c 'STALE_VERSION' /d/TQD/CRM/docs/adr/adr-005-command-contracts.md
```

Output: `1`.

### Task 4.6 — PASS

```bash
cd /d/TQD/CRM && for r in Sale Leader 'Department Head' BGĐ Admin 'Agent nhóm'; do grep -q "$r" docs/security/permission-matrix-v1.md || echo MISSING $r; done; echo DONE
```

Output: `DONE`.

### Task 4.7 — PASS

```bash
grep -c 'approval' /d/TQD/CRM/docs/security/action-risk-matrix-v1.md
```

Output: `10`.

### Task 4.8a — PASS

```bash
grep -c 'Time Travel' /d/TQD/CRM/docs/operations/backup-restore-plan.md
```

Output: `4`.

### Task 4.8b — PASS

```bash
test -s /d/TQD/CRM/docs/engineering/test-strategy.md && echo OK
```

Output: `OK`.

### Task 4.9 — PASS

```bash
cd /d/TQD/CRM && for f in docs/engineering/environments.md docs/engineering/seed-config-structure.md docs/engineering/deployment-baseline.md docs/security/security-baseline.md; do test -s $f || echo MISSING $f; done; grep -q '## Audit convention' docs/engineering/coding-conventions.md || echo MISSING audit; echo DONE
```

Output: `DONE`.

### Task 4.10 — DELEGATED, chưa chạy bởi worker

```bash
cd /d/TQD/CRM && git add docs && git commit -m "docs: add ADRs, permission and action-risk matrices" && git log -1 --oneline
```

Coordinator chịu trách nhiệm commit và ghi evidence output chứa ADRs; worker không coi bước này pass.

## Review bổ sung

`git diff --check` pass; mọi local relative link trong 15 docs sở hữu resolve tới file thật. Review trực tiếp: nonce/missing-row guard đúng template phase; actor từ credential, group projection không phụ thuộc quyền DM, approval và kill switch không bypass, audit/outbox/idempotency cùng batch. Mỗi tài liệu dưới 800 dòng. Không tạo test runtime cho thay đổi chỉ markdown; remote concurrency/auth/restore vẫn do PoC sở hữu.

Nguồn Cloudflare được đọc: [R2 compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [pricing](https://www.cloudflare.com/plans/zero-trust-services/). Daily export không thay RPO 1 giờ; Free/Paid PITR window phân biệt với backup retention 30 ngày.

## Còn lại

Coordinator commit/review; user review ma trận ở gate phase 08, quyền role tương lai trước plan MVP2/MVP3; phase 05/06 cung cấp runtime evidence và chuyển ADR proposed nếu đạt. Danh sách phòng ban/nhóm/Leader trước plan MVP1, mẫu sản phẩm trước MVP2, lịch làm việc trước vận hành chưa tự điền. Không có blocker cho phạm vi worker đã được supervisor xác nhận.

