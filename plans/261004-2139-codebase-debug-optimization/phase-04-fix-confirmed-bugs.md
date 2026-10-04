---
phase: 4
title: Sửa lỗi đã xác nhận kèm test hồi quy
status: pending
runtime: codex
depends_on: [1, 2, 3]
---

# Phase 04 — Sửa lỗi (ak-cook, ak-test, ak-code-review)

## Goal

Sửa các lỗi critical/high đã xác nhận trong ba báo cáo; mỗi lỗi có test hồi quy.

## Input

Trong thư mục `reports/` của plan này:

- `test-debug-report.md`
- `review-worker-api.md`
- `review-web-ui.md`

## Scope

- Được ghi: `apps/crm/src/**`, `apps/crm/test/**`, `packages/contracts/src/**`.
- Được ghi thêm: `reports/fix-log.md` của plan này.
- Không tạo migration mới, trừ khi lỗi bắt buộc phải có. Nếu cần, hỏi coordinator qua Orca trước.

## Steps

1. Lập danh sách lỗi critical/high có trạng thái CONFIRMED.
   - Với lỗi PLAUSIBLE: viết test tái hiện trước.
   - Không tái hiện được thì bỏ qua và ghi lý do.
2. Với mỗi lỗi:
   - viết test fail trước;
   - sửa theo nguyên nhân gốc;
   - chạy lại test đó.
3. Lỗi medium/low:
   - chỉ sửa khi nhỏ, rõ ràng và không đổi contract;
   - còn lại để cho phase 05.
4. Chạy `ak-test` (toàn bộ test, typecheck, build), rồi chạy `ak-code-review` trên diff.
5. Ghi `reports/fix-log.md`:
   - lỗi đã sửa, kèm file và test;
   - lỗi bỏ qua, kèm lý do.

## Danh sách sửa đã chốt (coordinator, sau khi đọc ba báo cáo)

Số trong ngoặc là số mục của báo cáo tương ứng. Sửa hết danh sách này; mục nào cần migration hoặc đổi contract thì hỏi coordinator qua Orca trước khi làm.

Backend (`review-worker-api.md`, `test-debug-report.md`):

1. Overview hiển thị kill switch ngược (#1). `agentWritesOpen` phải đúng khi `enabled = 0`, cùng nghĩa với `AGENT_WRITES_OPEN` trong `commands.ts`. Test cho cả hai giá trị.
2. KPI `/api/dashboard` bị cắt ở 500 lead (#2). Đếm KPI bằng SQL trong `leadScope`. Danh sách nào còn giới hạn thì trả `truncated`.
3. Tìm kiếm không giới hạn (#3) và tạo lead tải cả bảng account (#4). Giới hạn số dòng ở SQL trước khi lọc trong Worker; không kéo `contact_point` của lead ngoài trang kết quả. Nếu sửa triệt để cần cột tên đã fold (migration) thì chỉ làm phần giới hạn, ghi phần còn lại vào `fix-log.md` cho phase 05.
4. Replay MCP trong 5 phút (báo cáo test, mục Medium; review #12). Phải kiểm lại kill switch và phạm vi lead, dùng chung `replayInScope` nếu được. Test: bật kill switch giữa lần gọi đầu và lần replay thì nhận `KILL_SWITCH_ON`.
5. Bot nhận audit trong `get_lead` (#8). Khi `actor.kind === 'agent'`, bỏ `audit` khỏi chi tiết lead.
6. Gửi Lark trùng (#11). Giành lượt bằng `UPDATE ... WHERE id = ? AND status IN ('pending','failed')`, chỉ gửi khi `meta.changes = 1`. Không gọi Lark thật trong test.

Web (`review-web-ui.md`):

7. Trang lead (#1) và trang khách hàng (#2) phải gửi `q`, `status`, `stage`, `department` lên API, không lọc cục bộ trên 500/300 dòng. Số đếm trên tab không được sai khi danh sách bị giới hạn.
8. Ô giá trị Won có dấu phẩy (#3). Hiểu dấu phẩy là dấu phân cách hàng nghìn, hoặc báo lỗi rõ dưới ô nhập. Không được để nút bị khóa mà không có lời giải thích.
9. Thêm `errorComponent` cho root route (#4).
10. Trang `/audit` với vai trò sale (#6). Hiện cảnh báo phân quyền như trang `overview`.

Không làm trong phase này (để phase 05 đề xuất):

- khóa đăng nhập trả 423 (#9 backend), vì liên quan quyết định đăng nhập của user;
- index mới;
- audit quản trị (#7);
- task cũ sau khi đổi owner (#6 backend);
- tách bundle và các mục a11y hay trùng lặp code còn lại.

## Verify

- `pnpm -F @abm/crm test` exit 0.
- `pnpm -F @abm/crm typecheck` exit 0.
- `pnpm -F @abm/crm build` exit 0.
- Diff chỉ nằm trong Scope.
